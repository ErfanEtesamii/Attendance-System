// A1 (فاز ۱۳): سرویس ویرایش برنامه‌ی هفتگی کارمند توسط ادمین/سرپرست.
//
// تقسیم A1 به سه بخش:
//   A1-۱ (انجام‌شده): مجوز plan.edit_team، اسکوپ نقش، تعیین هفته و قفل (PLAN_LOCKED / MONTH_CLOSED).
//        قواعد قفل و اعتبارسنجی یک تسک از weeklyPlanService صادر می‌شود و اینجا کپی نمی‌شود.
//   A1-۲ (انجام‌شده): تصمیم علامت‌گذاری تسک مدیر (migration ۰۳۳: manager_locked/edited_by_user_id/edited_at) + توابع repository.
//   A1-۳ (این بخش، انجام‌شده): addTask / updateTask / removeTask / moveTask / reorderTasks.
//        هیچ audit/اعلانی اینجا نیست (A2)؛ هر تابع before/after را برمی‌گرداند تا route برای audit استفاده کند.
//
// A2 (فاز ۱۳) به پنج بخش تقسیم شده است؛ وضعیت هر بخش:
//   A2-۱ (انجام‌شده): GET /admin/users/:id/plan ← getPlanState (فقط‌خواندنی) + version + route جدید employeePlan.js.
//   A2-۲ (انجام‌شده): endpointهای نوشتن (POST/PATCH/DELETE/reorder) روی توابع A1-۳؛ پاسخ = getPlanState تازه (withState/taskOwnerId).
//   A2-۳ (انجام‌شده): همزمانی — version = شمارنده‌ی weekly_plans.version (migration ۰۳۴)؛ همه‌ی نوشتن‌ها expectedVersion می‌گیرند ⇒ PLAN_CONFLICT (۴۰۹).
//   A2-۴ (انجام‌شده): audit weekly_plan_edited_by_manager — در route (employeePlan.js) با before/after همین توابع؛ سرویس هنوز audit نمی‌نویسد.
//   A2-۵ (انجام‌شده): اعلان تجمیعی دستی (POST .../plan/notify + notificationEvents.weeklyPlanEditedByManager). این فایل فقط «خلاصه‌ی تغییرهای
//        اطلاع‌داده‌نشده» را از audit می‌سازد (pendingNotify)؛ ارسال و ثبت رکورد «اعلان شد» در route است (مثل audit در A2-۴).
// قواعد (همه سمت سرور):
//   • مجوز: plan.edit_team — admin همه‌ی کارمندان (سرپرست‌ها هم)؛ manager فقط کارمندان مستقیمش؛ hr و کارمند ندارند.
//   • برنامه‌ی «خودِ» actor از این مسیر ممنوع است (SELF_NOT_ALLOWED)؛ او از Mini App ویرایش می‌کند.
//   • کارمند غیرفعال یا ناموجود ⇒ USER_NOT_FOUND (همان رفتار urgentTaskService).
//   • فقط هفته‌های آینده قابل ویرایش‌اند؛ هفته‌ی شروع‌شده ⇒ PLAN_LOCKED، ماه بسته ⇒ MONTH_CLOSED (هر دو ۴۰۹).
//   • تسک فوری تنها استثنای قفل است و فقط از urgentTaskService (E1) می‌آید؛ این سرویس آن را دور نمی‌زند.
const usersRepository = require('../repositories/usersRepository');
const plansRepo = require('../repositories/weeklyPlanRepository');
const calendarService = require('../engine/calendarService');
const weeklyPlan = require('./weeklyPlanService');
const { hasPermission } = require('../middleware/permissions');
const employeeWeek = require('./employeeWeekService'); // فقط canView (اسکوپ خواندن؛ منبع واحد با F1)
const { dayNumber, addDays } = require('../utils/shiftDay');
const auditRepository = require('../repositories/auditRepository');
const { getDb } = require('../db/connection');

const ERROR_STATUS = {
  FORBIDDEN: 403, SELF_NOT_ALLOWED: 403, NOT_IN_SCOPE: 403,
  USER_NOT_FOUND: 404, TASK_NOT_FOUND: 404,
  PLAN_LOCKED: 409, MONTH_CLOSED: 409, PLAN_CONFLICT: 409,
  SYSTEM_TASK_READONLY: 409, URGENT_TASK_READONLY: 409,
  INVALID_VERSION: 400,
  NOTHING_TO_NOTIFY: 409, NOTIFY_FAILED: 502,
};
const statusOf = (code) => ERROR_STATUS[code] || 400;

// خطاهای weeklyPlanService status ندارند؛ اینجا برای route ها اضافه می‌شود.
const fail = (code, error, extra = {}) => ({ ok: false, code, error, status: statusOf(code), ...extra });
const withStatus = (f) => (f && f.ok === false && f.status === undefined ? { ...f, status: statusOf(f.code) } : f);

/**
 * بررسی همزمانی (A2-۳). expectedVersion همان plan.version است که UI آخرین‌بار دیده:
 *   undefined ⇒ بررسی نمی‌شود (فراخواننده‌های برنامه‌نویسی/سازگاری)؛ UI همیشه می‌فرستد.
 *   null ⇒ «برنامه‌ای وجود نداشت» (برنامه‌ی ناموجود version=null دارد).
 *   عدد صحیح (یا رشته‌ی عددی) ⇒ باید با نسخه‌ی فعلی برابر باشد.
 * در همان فراخوانیِ sync و قبل از هر نوشتن اجرا می‌شود، پس بین بررسی و نوشتن چیزی فاصله نمی‌اندازد.
 * @returns {null|{ok:false}} null = مجاز
 */
function versionFailure(plan, expectedVersion) {
  if (expectedVersion === undefined) return null;
  let expected = null;
  if (expectedVersion !== null) {
    const n = typeof expectedVersion === 'string' && /^\d+$/.test(expectedVersion.trim()) ? Number(expectedVersion) : expectedVersion;
    if (!Number.isInteger(n) || n < 1) return fail('INVALID_VERSION', 'نسخه‌ی برنامه نامعتبر است.');
    expected = n;
  }
  const current = plan ? plan.version : null;
  if (expected !== current) return fail('PLAN_CONFLICT', 'برنامه در این فاصله تغییر کرده؛ صفحه را تازه کنید.');
  return null;
}

/** آیا actor مجاز است برنامه‌ی target را ویرایش کند؟ → null (مجاز) یا fail(...). ترتیب: مجوز، وجود کارمند، خود، اسکوپ تیم. */
function scopeFailure(actor, target) {
  if (!actor || !hasPermission(actor.role, 'plan.edit_team')) return fail('FORBIDDEN', 'برای ویرایش برنامه‌ی کارمندان مجوز لازم را ندارید.');
  if (!target || !target.is_active) return fail('USER_NOT_FOUND', 'کارمند یافت نشد.');
  if (target.id === actor.id) return fail('SELF_NOT_ALLOWED', 'برنامه‌ی خودتان را از این مسیر نمی‌توانید ویرایش کنید؛ از Mini App استفاده کنید.');
  if (actor.role === 'manager' && target.manager_id !== actor.id) return fail('NOT_IN_SCOPE', 'این کارمند در تیم شما نیست.');
  return null;
}

/** تعیین هفته‌ی هدف: خالی ⇒ هفته‌ی بعد؛ در غیر این صورت باید دقیقاً روز شروع هفته (weekStartDay) باشد. بدون دسترسی به DB. */
function resolveWeekStart(weekStartInput, ctx) {
  if (weekStartInput === undefined || weekStartInput === null || weekStartInput === '') {
    return { ok: true, weekStart: weeklyPlan.targetWeek('next', ctx) };
  }
  const valid = typeof weekStartInput === 'string' && dayNumber(weekStartInput) !== null
    && calendarService.weekStartOf(weekStartInput, ctx.settings.weekStartDay) === weekStartInput;
  if (!valid) return fail('INVALID_WEEK', 'تاریخ شروع هفته نامعتبر است (باید اولین روز یک هفته باشد).');
  return { ok: true, weekStart: weekStartInput };
}

/**
 * گیت مشترکِ همه‌ی عملیات ویرایش: مجوز + اسکوپ + هفته‌ی معتبر + قفل. هیچ نوشتنی در دیتابیس انجام نمی‌دهد
 * (ساخت برنامه‌ی draft خالی در A1-۳ و فقط بعد از موفق‌شدن اعتبارسنجی انجام می‌شود).
 * @param {object} actor ردیف کاربرِ مدیر
 * @param {number|string} employeeId شناسه‌ی کارمند
 * @param {string} [weekStartInput] YYYY-MM-DD و باید دقیقاً روز شروع هفته (weekStartDay) باشد؛ پیش‌فرض: هفته‌ی بعد
 * @param {{now?: Date, expectedVersion?: number|string|null}} [opts] expectedVersion: نسخه‌ی دیده‌شده‌ی UI (A2-۳؛ نبودن = بدون بررسی)
 * @returns {{ok: true, target: object, weekStart: string, ctx: object}|{ok: false, code: string, error: string, status: number}}
 */
function openWeek(actor, employeeId, weekStartInput, { now, expectedVersion } = {}) {
  const id = Number(employeeId);
  const target = Number.isInteger(id) && id > 0 ? usersRepository.findById(id) : null;
  const denied = scopeFailure(actor, target);
  if (denied) return denied;

  const ctx = weeklyPlan.context(now);
  const wk = resolveWeekStart(weekStartInput, ctx);
  if (!wk.ok) return wk;
  const weekStart = wk.weekStart;
  const locked = weeklyPlan.lockFailure(weekStart, ctx);
  if (locked) return withStatus(locked);
  const conflict = versionFailure(plansRepo.findByUserWeek(target.id, weekStart), expectedVersion);
  if (conflict) return conflict;
  return { ok: true, target, weekStart, ctx };
}

// ---------- A1-۳: عملیات ویرایش تسک ----------
// قرارداد مشترک: همه‌ی توابع sync هستند و { ok: true, ... } یا { ok: false, code, error, status } برمی‌گردانند.
// نتیجه‌ی موفق: { task, plan: {id, weekStart, status, updatedAt}, changed, before?, after? } — before/after برای audit در A2.
// تسک‌هایی که مدیر اضافه/ویرایش/جابه‌جا می‌کند manager_locked=۱ می‌گیرند (migration ۰۳۳)؛ reorder و حذف علامت نمی‌زنند.
// هیچ‌یک از این توابع وضعیت برنامه (draft/submitted) را تغییر نمی‌دهد.
const toId = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };

// تسک + علامت‌های مدیر برای خروجی (presentTask خروجی کارمند را عوض نمی‌کنیم؛ A3 آن را جدا گسترش می‌دهد)
const presentTask = (t) => ({
  ...weeklyPlan.presentTask(t),
  managerLocked: !!t.manager_locked, editedByUserId: t.edited_by_user_id || null, editedAt: t.edited_at || null,
});
const presentPlan = (p) => ({ id: p.id, weekStart: p.week_start_date, status: p.status, updatedAt: p.updated_at });

/** مثل openWeek ولی برای عملیات روی یک تسک موجود: هفته از خودِ برنامه‌ی تسک می‌آید (نه ورودی). */
function openTask(actor, employeeId, taskId, { now, expectedVersion } = {}) {
  const id = toId(employeeId);
  const target = id ? usersRepository.findById(id) : null;
  const denied = scopeFailure(actor, target);
  if (denied) return denied;

  const tid = toId(taskId);
  const task = tid ? plansRepo.findTask(tid) : null;
  const plan = task ? plansRepo.findById(task.plan_id) : null;
  // تسکِ ناموجود، حذف‌شده یا متعلق به برنامه‌ی کارمند دیگری ⇒ TASK_NOT_FOUND
  if (!task || task.deleted_at || !plan || plan.user_id !== target.id) return fail('TASK_NOT_FOUND', 'تسک در برنامه‌ی این کارمند یافت نشد.');

  // مستقیم از lockFailure (نه openWeek): اگر weekStartDay بعداً عوض شده باشد، برنامه‌ی آینده‌ی موجود نباید ویرایش‌ناپذیر شود.
  const locked = weeklyPlan.lockFailure(plan.week_start_date, weeklyPlan.context(now));
  if (locked) return withStatus(locked);
  const conflict = versionFailure(plan, expectedVersion);
  if (conflict) return conflict;

  if (task.is_system) return fail('SYSTEM_TASK_READONLY', 'تسک سیستمی قابل ویرایش یا حذف نیست.');
  if (task.is_urgent) return fail('URGENT_TASK_READONLY', 'تسک فوری از این مسیر قابل ویرایش یا حذف نیست؛ از بخش تسک فوری استفاده کنید.');
  return { ok: true, target, task, plan };
}

/** افزودن تسک به برنامه‌ی یک هفته‌ی آینده (برنامه‌ی خالیِ draft در صورت نبود ساخته می‌شود، فقط بعد از موفق‌شدن اعتبارسنجی). */
function addTask(actor, employeeId, weekStartInput, input, { now, expectedVersion } = {}) {
  const gate = openWeek(actor, employeeId, weekStartInput, { now, expectedVersion });
  if (!gate.ok) return gate;
  const v = weeklyPlan.validateTask(input, 'تسک', gate.weekStart);
  if (v.error) return withStatus(v.error);

  const existing = plansRepo.findByUserWeek(gate.target.id, gate.weekStart);
  if (existing && plansRepo.countOrdinaryTasks(existing.id) + 1 > weeklyPlan.MAX_TASKS) {
    return fail('TOO_MANY_TASKS', `حداکثر ${weeklyPlan.MAX_TASKS} تسک مجاز است.`);
  }
  let task; let plan;
  getDb().transaction(() => {
    plan = existing || plansRepo.getOrCreate(gate.target.id, gate.weekStart);
    task = plansRepo.addTask(plan.id, { ...v.task, managerLocked: true, editedByUserId: actor.id });
    plansRepo.touch(plan.id);
  })();
  return { ok: true, changed: true, task: presentTask(task), after: presentTask(task), plan: presentPlan(plansRepo.findById(plan.id)) };
}

const PATCH_KEYS = ['title', 'description', 'plannedDate', 'priority'];

/** ویرایش بخشی از تسک (title/description/plannedDate/priority). فیلدِ نیامده دست‌نخورده می‌ماند؛ plannedDate=null یعنی «هر روز». */
function updateTask(actor, employeeId, taskId, patch, { now, expectedVersion } = {}) {
  const gate = openTask(actor, employeeId, taskId, { now, expectedVersion });
  if (!gate.ok) return gate;
  const { task: cur, plan } = gate;
  const p = patch && typeof patch === 'object' ? patch : {};
  if (!PATCH_KEYS.some((k) => p[k] !== undefined)) return fail('NOTHING_TO_UPDATE', 'هیچ فیلد قابل‌ویرایشی ارسال نشده است.');

  const merged = {
    title: p.title !== undefined ? p.title : cur.title,
    description: p.description !== undefined ? p.description : (cur.description || ''),
    plannedDate: p.plannedDate !== undefined ? p.plannedDate : cur.planned_date,
    priority: p.priority !== undefined ? p.priority : cur.priority,
  };
  const v = weeklyPlan.validateTask(merged, 'تسک', plan.week_start_date);
  if (v.error) return withStatus(v.error);

  const before = presentTask(cur);
  const n = v.task;
  const unchanged = cur.title === n.title && (cur.description || null) === n.description
    && (cur.planned_date || null) === n.plannedDate && cur.priority === n.priority;
  if (unchanged) return { ok: true, changed: false, task: before, before, after: before, plan: presentPlan(plan) }; // بدون نوشتن/علامت‌گذاری

  let row;
  getDb().transaction(() => {
    plansRepo.updateTask(cur.id, { title: n.title, description: n.description, plannedDate: n.plannedDate, priority: n.priority });
    row = plansRepo.markManagerEdited(cur.id, actor.id);
    plansRepo.touch(plan.id);
  })();
  const after = presentTask(row);
  return { ok: true, changed: true, task: after, before, after, plan: presentPlan(plansRepo.findById(plan.id)) };
}

/** حذف نرم (soft delete) تسک عادی. before = تسکِ حذف‌شده برای audit. */
function removeTask(actor, employeeId, taskId, { now, expectedVersion } = {}) {
  const gate = openTask(actor, employeeId, taskId, { now, expectedVersion });
  if (!gate.ok) return gate;
  const before = presentTask(gate.task);
  getDb().transaction(() => {
    plansRepo.markManagerEdited(gate.task.id, actor.id); // A3-۲: زمانِ تغییر مدیر برای بنر کارمند (تسکِ حذف‌شده از دید کارمند پنهان است)
    plansRepo.softDeleteTask(gate.task.id);
    plansRepo.touch(gate.plan.id);
  })();
  return { ok: true, changed: true, task: before, before, plan: presentPlan(plansRepo.findById(gate.plan.id)) };
}

/** جابه‌جایی روز تسک (فقط plannedDate؛ null = «هر روز»). نبودنِ plannedDate خطاست تا «فراموش‌شده» با «هر روز» اشتباه نشود. */
function moveTask(actor, employeeId, taskId, plannedDate, opts = {}) {
  if (plannedDate === undefined) return fail('INVALID_DATE', 'تاریخ جدید مشخص نشده است (برای «هر روز» مقدار null بفرستید).');
  return updateTask(actor, employeeId, taskId, { plannedDate }, opts);
}

/**
 * ترتیب‌دهی: orderedIds = شناسه‌ی تسک‌های عادیِ برنامه به ترتیب دلخواه (می‌تواند زیرمجموعه باشد، مثلاً فقط یک روز).
 * تسک‌های فهرست‌شده همان «جایگاه‌هایی» (sort_order) را که از قبل داشتند به ترتیب جدید می‌گیرند؛ بقیه‌ی تسک‌ها (سیستمی/فوری/روزهای دیگر) سر جای خود می‌مانند.
 * علامت manager_locked نمی‌زند (ترتیب محتوای تسک نیست).
 */
function reorderTasks(actor, employeeId, weekStartInput, orderedIds, { now, expectedVersion } = {}) {
  const gate = openWeek(actor, employeeId, weekStartInput, { now, expectedVersion });
  if (!gate.ok) return gate;
  const ids = Array.isArray(orderedIds) ? orderedIds.map(toId) : null;
  if (!ids || !ids.length || ids.length > weeklyPlan.MAX_TASKS + 5 || ids.some((x) => x === null) || new Set(ids).size !== ids.length) {
    return fail('INVALID_ORDER', 'فهرست ترتیب باید آرایه‌ای ناتهی از شناسه‌های یکتای تسک باشد.');
  }
  const plan = plansRepo.findByUserWeek(gate.target.id, gate.weekStart);
  const active = plan ? plansRepo.listTasks(plan.id) : []; // مرتب بر اساس sort_order, id
  const byId = new Map(active.map((t) => [t.id, t]));
  for (const id of ids) {
    const t = byId.get(id);
    if (!t) return fail('TASK_NOT_FOUND', 'تسک در برنامه‌ی این کارمند یافت نشد.');
    if (t.is_system) return fail('SYSTEM_TASK_READONLY', 'تسک سیستمی قابل جابه‌جایی نیست.');
    if (t.is_urgent) return fail('URGENT_TASK_READONLY', 'تسک فوری قابل جابه‌جایی نیست.');
  }
  // جایگاه‌ها: اگر sort_order تکراری باشد اول همه‌ی تسک‌های فعال ۱..N شماره‌گذاری می‌شوند تا نتیجه قطعی باشد.
  const hasDup = new Set(active.map((t) => t.sort_order)).size !== active.length;
  const slotOf = new Map(active.map((t, i) => [t.id, hasDup ? i + 1 : t.sort_order]));
  const slots = ids.map((id) => slotOf.get(id)).sort((a, b) => a - b);
  const finalOrder = new Map(slotOf);
  ids.forEach((id, i) => finalOrder.set(id, slots[i]));
  const items = active.filter((t) => finalOrder.get(t.id) !== t.sort_order).map((t) => ({ id: t.id, sortOrder: finalOrder.get(t.id) }));
  const idsBefore = active.filter((t) => ids.includes(t.id)).map((t) => t.id);
  if (!items.length) return { ok: true, changed: false, order: idsBefore, plan: presentPlan(plan) };

  getDb().transaction(() => {
    plansRepo.reorderTasks(items);
    plansRepo.touch(plan.id);
  })();
  const order = plansRepo.listTasks(plan.id).filter((t) => ids.includes(t.id)).map((t) => t.id);
  return { ok: true, changed: true, before: idsBefore, order, plan: presentPlan(plansRepo.findById(plan.id)) };
}

// ---------- A2-۱: خواندن وضعیت برنامه‌ی یک هفته (فقط‌خواندنی) ----------
// نسخه‌ی برنامه برای تشخیص همزمانی (A2-۳): شمارنده‌ی weekly_plans.version (migration ۰۳۴؛ با تریگر در هر تغییرِ برنامه یا تسک‌هایش
// — از هر مسیری — یکی زیاد می‌شود). برنامه‌ی ناموجود ⇒ null. تنها نقطه‌ی تعریف version همین تابع است.
const planVersion = (plan) => (plan ? plan.version : null);

/**
 * وضعیت برنامه‌ی یک هفته‌ی کارمند برای پنل (هیچ نوشتنی در دیتابیس ندارد؛ برنامه‌ی ناموجود ساخته نمی‌شود).
 * اسکوپ خواندن همان F1: team.week_view + canView (admin/hr همه، manager فقط کارمندان مستقیمش).
 * @param {string} [startInput] هر تاریخ داخل هفته (YYYY-MM-DD)؛ به شروع هفته (weekStartDay) نرمال می‌شود؛ پیش‌فرض: هفته‌ی بعد.
 * @returns {{ok: true, employee, weekStart, weekEnd, isNextWeek, plan, tasks}|{ok: false, code, error, status}}
 *   plan = {id, status, version, updatedAt, submittedAt, supervisorComment, editable, lockReason, minTasks, maxTasks}
 *   editable = «این actor الان می‌تواند برنامه را ویرایش کند» (مجوز plan.edit_team + اسکوپ + بدون قفل) — فقط راهنمای UI؛ گیت اصلی در عملیات نوشتن است.
 */
function getPlanState(actor, employeeId, startInput, { now } = {}) {
  const id = toId(employeeId);
  const target = id ? usersRepository.findById(id) : null;
  if (!target) return fail('USER_NOT_FOUND', 'کارمند یافت نشد.');
  if (!actor || !hasPermission(actor.role, 'team.week_view') || !employeeWeek.canView(actor, target)) {
    return fail('FORBIDDEN', 'این کارمند خارج از دامنه‌ی دسترسی شماست.');
  }

  const ctx = weeklyPlan.context(now);
  let weekStart;
  if (startInput === undefined || startInput === null || startInput === '') {
    weekStart = weeklyPlan.targetWeek('next', ctx);
  } else {
    if (typeof startInput !== 'string' || dayNumber(startInput) === null) return fail('INVALID_WEEK', 'تاریخ هفته نامعتبر است (YYYY-MM-DD).');
    weekStart = calendarService.weekStartOf(startInput, ctx.settings.weekStartDay);
  }

  const lockReason = weeklyPlan.lockReason(weekStart, ctx);
  const plan = plansRepo.findByUserWeek(target.id, weekStart);
  const editable = scopeFailure(actor, target) === null && !lockReason;
  const tasks = (plan ? plansRepo.listTasks(plan.id) : []).map((t) => ({
    ...presentTask(t), canEdit: editable && !t.is_system && !t.is_urgent,
  }));
  return {
    ok: true,
    employee: { id: target.id, fullName: target.full_name, managerId: target.manager_id || null },
    weekStart, weekEnd: addDays(weekStart, 6),
    isNextWeek: weekStart === weeklyPlan.targetWeek('next', ctx),
    plan: {
      id: plan ? plan.id : null, status: plan ? plan.status : 'draft',
      version: planVersion(plan), updatedAt: plan ? plan.updated_at : null, submittedAt: plan ? plan.submitted_at : null,
      supervisorComment: plan ? plan.supervisor_comment : null,
      editable, lockReason,
      minTasks: ctx.settings.planMinTasks, maxTasks: weeklyPlan.MAX_TASKS,
    },
    tasks,
  };
}

/** شناسه‌ی کارمندِ مالکِ یک تسک (برای مسیرهایی که فقط taskId دارند)؛ تسک ناموجود/حذف‌شده ⇒ null. اسکوپ را بررسی نمی‌کند (کار توابع A1 است). */
function taskOwnerId(taskId) {
  const tid = toId(taskId);
  const task = tid ? plansRepo.findTask(tid) : null;
  const plan = task && !task.deleted_at ? plansRepo.findById(task.plan_id) : null;
  return plan ? plan.user_id : null;
}

/**
 * نتیجه‌ی یک عملیات نوشتن (خروجی add/update/remove/reorder) را به «وضعیت تازه‌ی برنامه» تبدیل می‌کند تا UI حدس نزند:
 * { ok, ...getPlanState, changed, task? }. خطا بدون تغییر برمی‌گردد. هفته از r.plan.weekStart می‌آید.
 */
function withState(actor, employeeId, r, { now } = {}) {
  if (!r.ok) return r;
  const state = getPlanState(actor, employeeId, r.plan.weekStart, { now });
  if (!state.ok) return state;
  return { ...state, changed: r.changed, ...(r.task ? { task: r.task } : {}) };
}

// ---------- A2-۵: خلاصه‌ی تغییرهای اطلاع‌داده‌نشده (برای اعلان تجمیعی) ----------
const AUDIT_EDIT_ACTION = 'weekly_plan_edited_by_manager'; // A2-۴ (route employeePlan.js)
const AUDIT_NOTIFY_ACTION = 'weekly_plan_manager_notified'; // رکوردِ «اعلان شد»؛ meta.upToAuditId = آخرین رکورد ویرایشِ پوشش‌داده‌شده

/**
 * رکوردهای ویرایش (خروجی auditRepository.listPlanEditEventsPending) ⇒ { added, edited, removed, total, upToAuditId }.
 * شمارش «خالصِ» هر تسک است نه هر کلیک: افزودن+حذفِ همان تسک در یک بازه ⇒ هیچ (کارمند هرگز آن را ندیده)؛ افزودن+چند ویرایش ⇒ ۱ افزودن؛
 * چند ویرایش ⇒ ۱ ویرایش؛ ویرایش+حذف ⇒ ۱ حذف. reorder شمرده نمی‌شود (محتوای تسک نیست) و total را زیاد نمی‌کند، ولی در upToAuditId می‌آید.
 */
function summarizeEdits(rows) {
  const opsByTask = new Map();
  let upToAuditId = 0;
  for (const row of rows) {
    upToAuditId = Math.max(upToAuditId, row.id);
    let d = null;
    try { d = JSON.parse(row.details); } catch (_) { d = null; }
    if (!d || d.op === 'reorder' || !d.taskId) continue;
    if (!opsByTask.has(d.taskId)) opsByTask.set(d.taskId, []);
    opsByTask.get(d.taskId).push(d.op);
  }
  const s = { added: 0, edited: 0, removed: 0 };
  for (const ops of opsByTask.values()) {
    const first = ops[0];
    const last = ops[ops.length - 1];
    if (last === 'remove') { if (first !== 'add') s.removed += 1; } else if (first === 'add') s.added += 1; else s.edited += 1;
  }
  return { ...s, total: s.added + s.edited + s.removed, upToAuditId };
}

/**
 * آماده‌سازی اعلان تجمیعی: مجوز + اسکوپ (مثل ویرایش)، تعیین هفته (پیش‌فرض: هفته‌ی بعد)، خلاصه‌ی تغییرهای بعد از آخرین اعلان.
 * قفل هفته/نسخه بررسی نمی‌شود (اطلاع‌دادنِ تغییرهای انجام‌شده ممنوع نیست). هیچ نوشتنی ندارد؛ ارسال و ثبت رکورد «اعلان شد» با route است.
 * @returns {{ok: true, target, plan, summary}|{ok: false, code, error, status}} بدون تغییرِ اطلاع‌داده‌نشده ⇒ NOTHING_TO_NOTIFY (۴۰۹)
 */
function pendingNotify(actor, employeeId, weekStartInput, { now } = {}) {
  const id = toId(employeeId);
  const target = id ? usersRepository.findById(id) : null;
  const denied = scopeFailure(actor, target);
  if (denied) return denied;
  const wk = resolveWeekStart(weekStartInput, weeklyPlan.context(now));
  if (!wk.ok) return wk;
  const plan = plansRepo.findByUserWeek(target.id, wk.weekStart);
  const summary = plan
    ? summarizeEdits(auditRepository.listPlanEditEventsPending(plan.id, { editAction: AUDIT_EDIT_ACTION, notifyAction: AUDIT_NOTIFY_ACTION }))
    : null;
  if (!summary || !summary.total) return fail('NOTHING_TO_NOTIFY', 'تغییر اطلاع‌داده‌نشده‌ای برای این برنامه وجود ندارد.');
  return { ok: true, target, plan, summary };
}

module.exports = { scopeFailure, openWeek, statusOf, planVersion, getPlanState, taskOwnerId, withState, addTask, updateTask, removeTask, moveTask, reorderTasks, summarizeEdits, pendingNotify, AUDIT_NOTIFY_ACTION };

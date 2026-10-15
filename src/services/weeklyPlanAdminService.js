// A1 (فاز ۱۳): سرویس ویرایش برنامه‌ی هفتگی کارمند توسط ادمین/سرپرست.
//
// تقسیم A1 به سه بخش:
//   A1-۱ (انجام‌شده): مجوز plan.edit_team، اسکوپ نقش، تعیین هفته و قفل (PLAN_LOCKED / MONTH_CLOSED).
//        قواعد قفل و اعتبارسنجی یک تسک از weeklyPlanService صادر می‌شود و اینجا کپی نمی‌شود.
//   A1-۲ (انجام‌شده): تصمیم علامت‌گذاری تسک مدیر (migration ۰۳۳: manager_locked/edited_by_user_id/edited_at) + توابع repository.
//   A1-۳ (این بخش، انجام‌شده): addTask / updateTask / removeTask / moveTask / reorderTasks.
//        هیچ audit/اعلانی اینجا نیست (A2)؛ هر تابع before/after را برمی‌گرداند تا route برای audit استفاده کند.
//
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
const { dayNumber } = require('../utils/shiftDay');
const { getDb } = require('../db/connection');

const ERROR_STATUS = {
  FORBIDDEN: 403, SELF_NOT_ALLOWED: 403, NOT_IN_SCOPE: 403,
  USER_NOT_FOUND: 404, TASK_NOT_FOUND: 404,
  PLAN_LOCKED: 409, MONTH_CLOSED: 409, PLAN_CONFLICT: 409,
  SYSTEM_TASK_READONLY: 409, URGENT_TASK_READONLY: 409,
};
const statusOf = (code) => ERROR_STATUS[code] || 400;

// خطاهای weeklyPlanService status ندارند؛ اینجا برای route ها اضافه می‌شود.
const fail = (code, error, extra = {}) => ({ ok: false, code, error, status: statusOf(code), ...extra });
const withStatus = (f) => (f && f.ok === false && f.status === undefined ? { ...f, status: statusOf(f.code) } : f);

/** آیا actor مجاز است برنامه‌ی target را ویرایش کند؟ → null (مجاز) یا fail(...). ترتیب: مجوز، وجود کارمند، خود، اسکوپ تیم. */
function scopeFailure(actor, target) {
  if (!actor || !hasPermission(actor.role, 'plan.edit_team')) return fail('FORBIDDEN', 'برای ویرایش برنامه‌ی کارمندان مجوز لازم را ندارید.');
  if (!target || !target.is_active) return fail('USER_NOT_FOUND', 'کارمند یافت نشد.');
  if (target.id === actor.id) return fail('SELF_NOT_ALLOWED', 'برنامه‌ی خودتان را از این مسیر نمی‌توانید ویرایش کنید؛ از Mini App استفاده کنید.');
  if (actor.role === 'manager' && target.manager_id !== actor.id) return fail('NOT_IN_SCOPE', 'این کارمند در تیم شما نیست.');
  return null;
}

/**
 * گیت مشترکِ همه‌ی عملیات ویرایش: مجوز + اسکوپ + هفته‌ی معتبر + قفل. هیچ نوشتنی در دیتابیس انجام نمی‌دهد
 * (ساخت برنامه‌ی draft خالی در A1-۳ و فقط بعد از موفق‌شدن اعتبارسنجی انجام می‌شود).
 * @param {object} actor ردیف کاربرِ مدیر
 * @param {number|string} employeeId شناسه‌ی کارمند
 * @param {string} [weekStartInput] YYYY-MM-DD و باید دقیقاً روز شروع هفته (weekStartDay) باشد؛ پیش‌فرض: هفته‌ی بعد
 * @returns {{ok: true, target: object, weekStart: string, ctx: object}|{ok: false, code: string, error: string, status: number}}
 */
function openWeek(actor, employeeId, weekStartInput, { now } = {}) {
  const id = Number(employeeId);
  const target = Number.isInteger(id) && id > 0 ? usersRepository.findById(id) : null;
  const denied = scopeFailure(actor, target);
  if (denied) return denied;

  const ctx = weeklyPlan.context(now);
  let weekStart;
  if (weekStartInput === undefined || weekStartInput === null || weekStartInput === '') {
    weekStart = weeklyPlan.targetWeek('next', ctx);
  } else {
    const valid = typeof weekStartInput === 'string' && dayNumber(weekStartInput) !== null
      && calendarService.weekStartOf(weekStartInput, ctx.settings.weekStartDay) === weekStartInput;
    if (!valid) return fail('INVALID_WEEK', 'تاریخ شروع هفته نامعتبر است (باید اولین روز یک هفته باشد).');
    weekStart = weekStartInput;
  }
  const locked = weeklyPlan.lockFailure(weekStart, ctx);
  if (locked) return withStatus(locked);
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
function openTask(actor, employeeId, taskId, { now } = {}) {
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

  if (task.is_system) return fail('SYSTEM_TASK_READONLY', 'تسک سیستمی قابل ویرایش یا حذف نیست.');
  if (task.is_urgent) return fail('URGENT_TASK_READONLY', 'تسک فوری از این مسیر قابل ویرایش یا حذف نیست؛ از بخش تسک فوری استفاده کنید.');
  return { ok: true, target, task, plan };
}

/** افزودن تسک به برنامه‌ی یک هفته‌ی آینده (برنامه‌ی خالیِ draft در صورت نبود ساخته می‌شود، فقط بعد از موفق‌شدن اعتبارسنجی). */
function addTask(actor, employeeId, weekStartInput, input, { now } = {}) {
  const gate = openWeek(actor, employeeId, weekStartInput, { now });
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
function updateTask(actor, employeeId, taskId, patch, { now } = {}) {
  const gate = openTask(actor, employeeId, taskId, { now });
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
function removeTask(actor, employeeId, taskId, { now } = {}) {
  const gate = openTask(actor, employeeId, taskId, { now });
  if (!gate.ok) return gate;
  const before = presentTask(gate.task);
  getDb().transaction(() => {
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
function reorderTasks(actor, employeeId, weekStartInput, orderedIds, { now } = {}) {
  const gate = openWeek(actor, employeeId, weekStartInput, { now });
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

module.exports = { scopeFailure, openWeek, statusOf, addTask, updateTask, removeTask, moveTask, reorderTasks };

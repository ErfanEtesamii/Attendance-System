// برنامه‌ی هفتگی (D3): خواندن/ذخیره‌ی پیش‌نویس/ثبت نهایی + پیشنهاد انتقال و کپی از هفته‌ی قبل.
// قواعد (سمت سرور، نه UI):
//   • هفته‌ی هدف: next (هفته‌ی بعد) | current؛ شروع هفته از تنظیم weekStartDay.
//   • قبل از شروع هفته‌ی هدف: ویرایش آزاد (افزودن/ویرایش/حذف حتی بعد از ثبت). بعد از شروع: فقط «افزودن» و «انتقال» (تغییر planned_date)؛
//     حذف/تغییر عنوان/توضیح/اولویت رد می‌شود (EDIT_RESTRICTED).
//   • هر تغییرِ بعد از ثبت ⇒ audit (weekly_plan_changed) + اعلان به سرپرست.
//   • ماه بسته ⇒ فقط‌خواندنی (MONTH_CLOSED). حداکثر ۳۰ تسک؛ عنوان ≤۱۲۰؛ توضیح ≤۵۰۰؛ planned_date داخل همان هفته یا خالی («هر روز»).
//   • تسک سیستمی (is_system) هرگز حذف/ویرایش نمی‌شود و در شمارش حداقل/سقف نمی‌آید.
const settingsRepository = require('../repositories/settingsRepository');
const plansRepo = require('../repositories/weeklyPlanRepository');
const logsRepo = require('../repositories/taskLogRepository');
const monthClosuresRepository = require('../repositories/monthClosuresRepository');
const auditRepository = require('../repositories/auditRepository');
const calendarService = require('../engine/calendarService');
const notificationEvents = require('./notificationEvents');
const { sanitizeText } = require('../utils/sanitize');
const { todayInZone } = require('../utils/time');
const { addDays, dayNumber } = require('../utils/shiftDay');

const MAX_TASKS = 30;
const TITLE_MAX = 120;
const DESC_MAX = 500;
const PRIORITIES = ['low', 'normal', 'high'];

const fail = (code, error, extra = {}) => ({ ok: false, code, error, ...extra });
const clean = (v, max) => sanitizeText(v == null ? '' : String(v), max + 1).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();

function context(now = new Date()) {
  const settings = settingsRepository.getAll();
  const today = todayInZone(settings.timezone, now);
  return { settings, today, thisWeek: calendarService.weekStartOf(today, settings.weekStartDay) };
}

function targetWeek(which, ctx) {
  if (which === 'current') return ctx.thisWeek;
  if (which === 'next' || which === undefined) return addDays(ctx.thisWeek, 7);
  return null;
}

const presentTask = (t) => ({
  id: t.id, title: t.title, description: t.description || '', plannedDate: t.planned_date || null, priority: t.priority,
  isSystem: !!t.is_system, systemKey: t.system_key || null, carriedFromTaskId: t.carried_from_task_id || null,
});

// آخرین پاسخ هر تسک (برای «ناتمام»)
function lastLogStatus(taskId) {
  const logs = logsRepo.listByTask(taskId);
  return logs.length ? logs[logs.length - 1].status : null;
}

// تسک‌های هفته‌ی قبل که تمام نشده‌اند (بدون پاسخ، نیمه‌کاره یا انجام‌نشده) و هنوز به هفته‌ی دیگری منتقل نشده‌اند
function carryOverCandidates(userId, weekStart) {
  const prev = plansRepo.findByUserWeek(userId, addDays(weekStart, -7));
  if (!prev) return [];
  const alreadyCarried = new Set();
  const cur = plansRepo.findByUserWeek(userId, weekStart);
  if (cur) plansRepo.listTasks(cur.id).forEach((t) => { if (t.carried_from_task_id) alreadyCarried.add(t.carried_from_task_id); });
  return plansRepo.listTasks(prev.id)
    .filter((t) => !t.is_system && !alreadyCarried.has(t.id) && lastLogStatus(t.id) !== 'done')
    .map(presentTask);
}

function copyCandidates(userId, weekStart) {
  const prev = plansRepo.findByUserWeek(userId, addDays(weekStart, -7));
  return prev ? plansRepo.listTasks(prev.id).filter((t) => !t.is_system).map(presentTask) : [];
}

function isMonthClosed(weekStart) {
  return monthClosuresRepository.findClosedOverlapping(weekStart, addDays(weekStart, 6)).length > 0;
}

// وضعیت ویرایش برای هفته‌ی هدف
function editMode(weekStart, ctx) {
  if (isMonthClosed(weekStart)) return 'readonly';
  return ctx.today < weekStart ? 'free' : 'restricted';
}

function getPlan(user, which, { now } = {}) {
  const ctx = context(now);
  const weekStart = targetWeek(which, ctx);
  if (!weekStart) return fail('INVALID_WEEK', 'week باید next یا current باشد.');
  const plan = plansRepo.findByUserWeek(user.id, weekStart);
  const planDay = calendarService.getPlanDay(user, weekStart, { settings: ctx.settings });
  return {
    ok: true,
    week: which === 'current' ? 'current' : 'next',
    weekStart, weekEnd: addDays(weekStart, 6),
    planDay,
    status: plan ? plan.status : 'draft',
    submittedAt: plan ? plan.submitted_at : null,
    supervisorSeenAt: plan ? plan.supervisor_seen_at : null,
    supervisorComment: plan ? plan.supervisor_comment : null,
    editMode: editMode(weekStart, ctx),
    minTasks: ctx.settings.planMinTasks,
    maxTasks: MAX_TASKS,
    tasks: plan ? plansRepo.listTasks(plan.id).map(presentTask) : [],
    carryOver: carryOverCandidates(user.id, weekStart),
    previousWeekTasks: copyCandidates(user.id, weekStart),
    frequentTitles: plansRepo.topTitles(user.id, 5),
  };
}

function validateTasks(input, weekStart, user) {
  if (!Array.isArray(input)) return { error: fail('INVALID_TASKS', 'tasks باید آرایه باشد.') };
  if (input.length > MAX_TASKS + 5) return { error: fail('TOO_MANY_TASKS', `حداکثر ${MAX_TASKS} تسک مجاز است.`) };
  const weekEnd = addDays(weekStart, 6);
  const out = [];
  for (let i = 0; i < input.length; i += 1) {
    const t = input[i] || {};
    const n = i + 1;
    const title = clean(t.title, TITLE_MAX);
    if (!title) return { error: fail('TITLE_REQUIRED', `عنوان تسک ${n} الزامی است.`) };
    if (title.length > TITLE_MAX) return { error: fail('TITLE_TOO_LONG', `عنوان تسک ${n} حداکثر ${TITLE_MAX} نویسه است.`) };
    const description = clean(t.description, DESC_MAX);
    if (description.length > DESC_MAX) return { error: fail('DESCRIPTION_TOO_LONG', `توضیح تسک ${n} حداکثر ${DESC_MAX} نویسه است.`) };
    const priority = t.priority === undefined || t.priority === null || t.priority === '' ? 'normal' : t.priority;
    if (!PRIORITIES.includes(priority)) return { error: fail('INVALID_PRIORITY', `اولویت تسک ${n} نامعتبر است.`) };
    let plannedDate = t.plannedDate === undefined || t.plannedDate === '' ? null : t.plannedDate;
    if (plannedDate !== null) {
      if (typeof plannedDate !== 'string' || dayNumber(plannedDate) === null) return { error: fail('INVALID_DATE', `تاریخ تسک ${n} نامعتبر است.`) };
      if (plannedDate < weekStart || plannedDate > weekEnd) return { error: fail('DATE_OUT_OF_WEEK', `تاریخ تسک ${n} باید داخل همین هفته باشد.`) };
    }
    let id = null;
    if (t.id !== undefined && t.id !== null) {
      id = Number(t.id);
      if (!Number.isInteger(id) || id <= 0) return { error: fail('INVALID_ID', `شناسه‌ی تسک ${n} نامعتبر است.`) };
    }
    let carried = null;
    if (t.carriedFromTaskId !== undefined && t.carriedFromTaskId !== null) {
      carried = Number(t.carriedFromTaskId);
      const src = Number.isInteger(carried) ? plansRepo.findTask(carried) : null;
      const srcPlan = src ? plansRepo.findById(src.plan_id) : null;
      if (!srcPlan || srcPlan.user_id !== user.id) return { error: fail('INVALID_CARRY', `منبع انتقال تسک ${n} معتبر نیست.`) };
    }
    out.push({ id, title, description: description || null, plannedDate, priority, carriedFromTaskId: carried });
  }
  return { tasks: out };
}

// تغییرِ بعد از ثبت: audit + اعلان به سرپرست (ضدخطا)
function reportChange(user, plan, summary) {
  try {
    auditRepository.logEvent({ userId: user.id, action: 'weekly_plan_changed', details: { planId: plan.id, weekStart: plan.week_start_date, ...summary } });
    notificationEvents.weeklyPlanChanged(user, plan, summary);
  } catch (err) {
    console.error('[weeklyPlan] ثبت تغییر ناموفق (نادیده گرفته شد):', err.message);
  }
}

/**
 * ذخیره‌ی پیش‌نویس/ویرایش. input.tasks = وضعیت مطلوب فهرست تسک‌ها.
 * free: تسک‌های حذف‌شده از فهرست soft-delete می‌شوند. restricted: فقط افزودن و تغییر plannedDate؛ بقیه رد.
 */
function saveDraft(user, which, tasksInput, { now } = {}) {
  const ctx = context(now);
  const weekStart = targetWeek(which, ctx);
  if (!weekStart) return fail('INVALID_WEEK', 'week باید next یا current باشد.');
  const mode = editMode(weekStart, ctx);
  if (mode === 'readonly') return fail('MONTH_CLOSED', 'این هفته در ماهِ بسته‌شده است و فقط‌خواندنی است.');
  const v = validateTasks(tasksInput, weekStart, user);
  if (v.error) return v.error;

  const plan = plansRepo.getOrCreate(user.id, weekStart);
  const existing = plansRepo.listTasks(plan.id);
  const userTasks = existing.filter((t) => !t.is_system);
  const byId = new Map(userTasks.map((t) => [t.id, t]));
  const keepIds = new Set();
  for (const t of v.tasks) {
    if (t.id !== null) {
      if (!byId.has(t.id)) return fail('TASK_NOT_FOUND', 'تسکِ ارسال‌شده در برنامه‌ی شما نیست.');
      keepIds.add(t.id);
    }
  }
  const adds = v.tasks.filter((t) => t.id === null);
  const edits = [];
  const removes = mode === 'free' ? userTasks.filter((t) => !keepIds.has(t.id)) : [];
  for (const t of v.tasks.filter((x) => x.id !== null)) {
    const cur = byId.get(t.id);
    const changedMeta = cur.title !== t.title || (cur.description || null) !== t.description || cur.priority !== t.priority;
    const changedDate = (cur.planned_date || null) !== t.plannedDate;
    if (mode === 'restricted' && changedMeta) return fail('EDIT_RESTRICTED', 'پس از شروع هفته فقط افزودن تسک و انتقال تاریخ مجاز است.');
    if (changedMeta || changedDate) edits.push({ cur, t });
  }
  if (userTasks.length - removes.length + adds.length > MAX_TASKS) return fail('TOO_MANY_TASKS', `حداکثر ${MAX_TASKS} تسک مجاز است.`);

  const { getDb } = require('../db/connection');
  getDb().transaction(() => {
    for (const r of removes) plansRepo.softDeleteTask(r.id);
    for (const { cur, t } of edits) plansRepo.updateTask(cur.id, { title: t.title, description: t.description, plannedDate: t.plannedDate, priority: t.priority });
    for (const t of adds) plansRepo.addTask(plan.id, { title: t.title, description: t.description, plannedDate: t.plannedDate, priority: t.priority, carriedFromTaskId: t.carriedFromTaskId });
    plansRepo.touch(plan.id);
  })();
  if (plan.status === 'submitted' && (adds.length || edits.length || removes.length)) {
    reportChange(user, plan, { added: adds.length, edited: edits.length, removed: removes.length });
  }
  return getPlan(user, which, { now });
}

function submit(user, which, { now } = {}) {
  const ctx = context(now);
  const weekStart = targetWeek(which, ctx);
  if (!weekStart) return fail('INVALID_WEEK', 'week باید next یا current باشد.');
  if (editMode(weekStart, ctx) === 'readonly') return fail('MONTH_CLOSED', 'این هفته در ماهِ بسته‌شده است و فقط‌خواندنی است.');
  const plan = plansRepo.findByUserWeek(user.id, weekStart);
  const count = plan ? plansRepo.listTasks(plan.id).filter((t) => !t.is_system).length : 0;
  const min = Math.max(0, ctx.settings.planMinTasks);
  if (count < min) return fail('TOO_FEW_TASKS', `برای ثبت برنامه حداقل ${min} تسک لازم است.`, { count, min });
  if (count > MAX_TASKS) return fail('TOO_MANY_TASKS', `حداکثر ${MAX_TASKS} تسک مجاز است.`);
  if (plan.status === 'submitted') return getPlan(user, which, { now }); // idempotent
  plansRepo.markSubmitted(plan.id);
  auditRepository.logEvent({ userId: user.id, action: 'weekly_plan_submitted', details: { planId: plan.id, weekStart, tasks: count } });
  return getPlan(user, which, { now });
}

module.exports = { getPlan, saveDraft, submit, targetWeek, context, MAX_TASKS, TITLE_MAX, DESC_MAX };

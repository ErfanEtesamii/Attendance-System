// گزارش روزانه‌ی تسک‌ها (D6): ساخت فهرست تسک‌های «امروز» و ثبت پاسخ‌ها.
// «امروز» = record_date کاربر (شیفت شب ⇒ روزِ شروع شیفت)، نه تاریخ تقویمیِ خام.
//
// فهرست تسک‌های روز D (پاسخ‌نداده‌ها):
//   ۱) تسک‌های برنامه‌ی همین هفته با planned_date = D
//   ۲) تسک‌های «هر روز» (planned_date خالی) که هنوز تمام نشده‌اند: آخرین پاسخ done نیست، «حذف» نشده و به روزِ بعد از D منتقل نشده
//   ۳) تسک‌های انتقال‌یافته به D (reschedule_to = D) از هر هفته
//   ۴) تسک سیستمی (is_system) طبق همان قواعد ۱ و ۲ (D9 آن‌ها را با planned_date می‌سازد)
//   منهای تسک‌هایی که برای D پاسخ دارند. مرخصی/ماموریتِ تأییدشده‌ی تمام‌روز ⇒ فهرست خالی.
//
// انتقال (reschedule) روی پاسخ‌های «انجام‌نشده/نیمه‌کاره»: tomorrow (روز کاریِ بعدی) | date | drop.
//   drop در ستون reschedule_to به‌صورت رشته‌ی 'drop' ذخیره می‌شود (ستون TEXT است؛ تاریخ‌ها همیشه YYYY-MM-DD).
// پارامتر date (اختیاری) فقط برای تست/backfill آینده است؛ route آن را نمی‌دهد.
// تسک «خارج از برنامه» (extra): به برنامه‌ی همین هفته با system_key='out_of_plan' اضافه و همان لحظه done ثبت می‌شود.
const plansRepo = require('../repositories/weeklyPlanRepository');
const logsRepo = require('../repositories/taskLogRepository');
const settingsRepository = require('../repositories/settingsRepository');
const monthClosuresRepository = require('../repositories/monthClosuresRepository');
const attendanceRepository = require('../repositories/attendanceRepository');
const calendarService = require('../engine/calendarService');
const { sanitizeText } = require('../utils/sanitize');
const { addDays, dayNumber } = require('../utils/shiftDay');
const { getDb } = require('../db/connection');

const REASON_CODES = ['no_time', 'needs_more_time', 'blocked_by_others', 'priority_changed', 'technical_issue', 'other'];
const STATUSES = ['done', 'partial', 'not_done'];
const OUT_OF_PLAN_KEY = 'out_of_plan';
const MAX_EXTRA = 10;
const MAX_RESCHEDULE_DAYS = 60;
const DROP = 'drop';

const fail = (code, error, extra = {}) => ({ ok: false, code, error, ...extra });
const clean = (v, max) => sanitizeText(v == null ? '' : String(v), max + 1).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
const PRIORITY_RANK = { high: 0, normal: 1, low: 2 };

/** تاریخ «امروز» کاربر (record_date). */
function reportDateFor(user, now = new Date()) {
  return attendanceRepository.currentRecordDate(user.id, now);
}

function fullDayOff(user, date, settings) {
  const cal = calendarService.getCalendarDay(user, date, { settings });
  return calendarService.fullyOnApprovedLeave(user, date, cal);
}

const present = (t, extra = {}) => ({
  id: t.id, title: t.title, description: t.description || '', priority: t.priority,
  plannedDate: t.planned_date || null, isSystem: !!t.is_system, systemKey: t.system_key || null,
  outOfPlan: t.system_key === OUT_OF_PLAN_KEY, ...extra,
});

function lastLog(taskId) {
  const logs = logsRepo.listByTask(taskId);
  return logs.length ? logs[logs.length - 1] : null;
}

/** تسک‌های پاسخ‌نداده‌ی روز D. */
function buildList(user, date, settings) {
  const weekStart = calendarService.weekStartOf(date, settings.weekStartDay);
  const plan = plansRepo.findByUserWeek(user.id, weekStart);
  const answeredIds = new Set(logsRepo.listByUserDate(user.id, date).map((l) => l.task_id));
  const picked = new Map();
  const add = (t, source) => { if (t && !t.deleted_at && !answeredIds.has(t.id) && !picked.has(t.id)) picked.set(t.id, present(t, { source })); };

  if (plan) {
    for (const t of plansRepo.listTasks(plan.id)) {
      if (t.planned_date) { if (t.planned_date === date) add(t, 'planned'); continue; }
      const last = lastLog(t.id);
      if (!last) { add(t, 'everyday'); continue; }
      if (last.status === 'done' || last.reschedule_to === DROP) continue;
      if (last.reschedule_to && last.reschedule_to > date) continue; // به آینده منتقل شده
      add(t, 'everyday');
    }
  }
  for (const l of logsRepo.listRescheduledTo(user.id, date)) {
    const t = plansRepo.findTask(l.task_id);
    if (!t) continue;
    const last = lastLog(t.id);
    if (last && last.status === 'done') continue;
    add(t, 'rescheduled');
  }
  return [...picked.values()].sort((a, b) => (PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]) || (a.id - b.id));
}

/** GET /miniapp/daily-tasks */
function getDailyTasks(user, { now, date: forcedDate } = {}) {
  const settings = settingsRepository.getAll();
  const date = forcedDate || reportDateFor(user, now);
  const answered = logsRepo.listByUserDate(user.id, date).map((l) => {
    const t = plansRepo.findTask(l.task_id);
    return t ? { taskId: l.task_id, title: t.title, status: l.status, reasonCode: l.reason_code, reasonText: l.reason_text, rescheduleTo: l.reschedule_to, outOfPlan: t.system_key === OUT_OF_PLAN_KEY } : null;
  }).filter(Boolean);
  const off = fullDayOff(user, date, settings);
  return {
    ok: true, date, fullDayOff: off,
    tasks: off ? [] : buildList(user, date, settings),
    answered, reasonCodes: REASON_CODES,
  };
}

function nextWorkingDay(user, date, settings) {
  for (let i = 1; i <= 14; i += 1) {
    const d = addDays(date, i);
    if (calendarService.getCalendarDay(user, d, { settings }).isWorkingDay) return d;
  }
  return addDays(date, 1);
}

function validateAnswer(a, n, user, date, settings, byId) {
  if (!a || typeof a !== 'object') return { error: fail('INVALID_ANSWER', `پاسخ ${n} نامعتبر است.`) };
  const taskId = Number(a.taskId);
  if (!Number.isInteger(taskId) || taskId <= 0) return { error: fail('INVALID_TASK', `شناسه‌ی تسک در پاسخ ${n} نامعتبر است.`) };
  const task = byId.get(taskId);
  if (!task) {
    const answered = logsRepo.findByTaskDate(taskId, date);
    return { error: answered ? fail('ALREADY_ANSWERED', `تسک پاسخ ${n} قبلاً پاسخ داده شده است.`) : fail('TASK_NOT_FOUND', `تسک پاسخ ${n} در فهرست امروز شما نیست.`) };
  }
  if (!STATUSES.includes(a.status)) return { error: fail('INVALID_STATUS', `وضعیت پاسخ ${n} نامعتبر است (done | partial | not_done).`) };
  const out = { taskId, status: a.status, reasonCode: null, reasonText: null, rescheduleTo: null };
  if (a.status === 'done') {
    if (a.reschedule) return { error: fail('RESCHEDULE_NOT_ALLOWED', `برای تسکِ انجام‌شده (پاسخ ${n}) انتقال معنا ندارد.`) };
    return { out };
  }
  const code = a.reasonCode;
  if (!REASON_CODES.includes(code)) return { error: fail('REASON_REQUIRED', `برای پاسخ ${n} انتخاب علت الزامی است.`) };
  const text = clean(a.reasonText, 300);
  if (text.length > 300) return { error: fail('REASON_TOO_LONG', `متن علت پاسخ ${n} حداکثر ۳۰۰ نویسه است.`) };
  if (code === 'other' && text.length < 5) return { error: fail('REASON_TEXT_REQUIRED', `برای علت «سایر» در پاسخ ${n} حداقل ۵ نویسه توضیح لازم است.`) };
  out.reasonCode = code;
  out.reasonText = text || null;
  if (a.reschedule !== undefined && a.reschedule !== null) {
    const r = a.reschedule;
    const type = r && typeof r === 'object' ? r.type : null;
    if (type === 'tomorrow') out.rescheduleTo = nextWorkingDay(user, date, settings);
    else if (type === DROP) out.rescheduleTo = DROP;
    else if (type === 'date') {
      const d = r.date;
      if (typeof d !== 'string' || dayNumber(d) === null) return { error: fail('INVALID_DATE', `تاریخ انتقال پاسخ ${n} نامعتبر است.`) };
      if (d <= date || d > addDays(date, MAX_RESCHEDULE_DAYS)) return { error: fail('DATE_OUT_OF_RANGE', `تاریخ انتقال پاسخ ${n} باید بعد از امروز و حداکثر ${MAX_RESCHEDULE_DAYS} روز آینده باشد.`) };
      out.rescheduleTo = d;
    } else return { error: fail('INVALID_RESCHEDULE', `نوع انتقال پاسخ ${n} نامعتبر است (tomorrow | date | drop).`) };
  }
  return { out };
}

function validateExtras(input) {
  if (input === undefined || input === null) return { extras: [] };
  if (!Array.isArray(input)) return { error: fail('INVALID_EXTRA', 'extra باید آرایه باشد.') };
  if (input.length > MAX_EXTRA) return { error: fail('TOO_MANY_EXTRA', `حداکثر ${MAX_EXTRA} کار خارج از برنامه در هر بار ثبت می‌شود.`) };
  const extras = [];
  for (let i = 0; i < input.length; i += 1) {
    const e = input[i] || {};
    const title = clean(e.title, 120);
    if (!title) return { error: fail('TITLE_REQUIRED', `عنوان کار خارج از برنامه ${i + 1} الزامی است.`) };
    if (title.length > 120) return { error: fail('TITLE_TOO_LONG', `عنوان کار خارج از برنامه ${i + 1} حداکثر ۱۲۰ نویسه است.`) };
    const description = clean(e.description, 500);
    if (description.length > 500) return { error: fail('DESCRIPTION_TOO_LONG', `توضیح کار خارج از برنامه ${i + 1} حداکثر ۵۰۰ نویسه است.`) };
    extras.push({ title, description: description || null });
  }
  return { extras };
}

/**
 * POST /miniapp/daily-report  { answers: [{taskId, status, reasonCode?, reasonText?, reschedule?}], extra: [{title, description?}] }
 * همه‌یاهیچ: اول همه‌چیز اعتبارسنجی، بعد یک تراکنش. پاسخِ ناقص مجاز است (کامل‌بودنِ گزارش را گیت خروج D7 می‌سنجد).
 */
function submitDailyReport(user, body, { now, date: forcedDate } = {}) {
  const settings = settingsRepository.getAll();
  const date = forcedDate || reportDateFor(user, now);
  const b = body && typeof body === 'object' ? body : {};
  const answersIn = b.answers === undefined ? [] : b.answers;
  if (!Array.isArray(answersIn)) return fail('INVALID_ANSWERS', 'answers باید آرایه باشد.');
  if (answersIn.length > 100) return fail('TOO_MANY_ANSWERS', 'تعداد پاسخ‌ها بیش از حد مجاز است.');
  if (monthClosuresRepository.findClosedOverlapping(date, date).length > 0) return fail('MONTH_CLOSED', 'این روز در ماهِ بسته‌شده است و گزارش آن فقط‌خواندنی است.');
  if (fullDayOff(user, date, settings)) return fail('FULL_DAY_OFF', 'امروز مرخصی/ماموریتِ تمام‌روز دارید و گزارش تسک لازم نیست.');

  const byId = new Map(buildList(user, date, settings).map((t) => [t.id, t]));
  const seen = new Set();
  const answers = [];
  for (let i = 0; i < answersIn.length; i += 1) {
    const v = validateAnswer(answersIn[i], i + 1, user, date, settings, byId);
    if (v.error) return v.error;
    if (seen.has(v.out.taskId)) return fail('DUPLICATE_ANSWER', `تسک پاسخ ${i + 1} بیش از یک‌بار ارسال شده است.`);
    seen.add(v.out.taskId);
    answers.push(v.out);
  }
  const ex = validateExtras(b.extra);
  if (ex.error) return ex.error;
  if (!answers.length && !ex.extras.length) return fail('EMPTY_REPORT', 'هیچ پاسخی ارسال نشده است.');

  getDb().transaction(() => {
    for (const a of answers) {
      logsRepo.upsert({ taskId: a.taskId, userId: user.id, logDate: date, status: a.status, reasonCode: a.reasonCode, reasonText: a.reasonText, rescheduleTo: a.rescheduleTo });
    }
    if (ex.extras.length) {
      const plan = plansRepo.getOrCreate(user.id, calendarService.weekStartOf(date, settings.weekStartDay));
      for (const e of ex.extras) {
        const t = plansRepo.addTask(plan.id, { title: e.title, description: e.description, plannedDate: date, priority: 'normal', systemKey: OUT_OF_PLAN_KEY });
        logsRepo.upsert({ taskId: t.id, userId: user.id, logDate: date, status: 'done' });
      }
    }
  })();
  const fresh = getDailyTasks(user, { now, date });
  return { ...fresh, saved: { answers: answers.length, extra: ex.extras.length } };
}

module.exports = { getDailyTasks, submitDailyReport, buildList, reportDateFor, REASON_CODES, OUT_OF_PLAN_KEY, DROP };

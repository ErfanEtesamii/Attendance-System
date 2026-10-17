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
// پارامتر date (D7-ب): route می‌تواند requestedDate بدهد (query/body)؛ همیشه با resolveReportDate اعتبارسنجی می‌شود:
//   • date = امروز (record_date) ⇒ عادی؛ اگر رکوردِ امروز خروج خورده/خودکار-بسته شده، پاسخ «دیرهنگام» (answered_late=1) است.
//   • date در گذشته ⇒ فقط با رکورد حضور و بدون ماهِ بسته؛ دو حالت مجاز:
//       - backfill: رکورد بدون خروج (خودکار-بسته) تا reportBackfillDays روز؛
//       - «بعداً پر می‌کنم»: حالت soft و حداکثر ۲۴ ساعت بعد از خروج.
//     پاسخ‌های دیرهنگام همیشه answered_late=1 و انتقال «فردا/تاریخ» نسبت به «امروزِ واقعی» محاسبه می‌شود (نه روزِ گزارش).
//   • date آینده ⇒ رد. گزینه‌ی date (بدون requestedDate) فقط برای تست/فراخوانِ مورد اعتماد است و اعتبارسنجی نمی‌شود.
// تسک «خارج از برنامه» (extra): به برنامه‌ی همین هفته با system_key='out_of_plan' اضافه و همان لحظه done ثبت می‌شود.
// پیام تشویقی (D8): برای هر پاسخ در applyReport ساخته و در encouragement_text ذخیره می‌شود (اگر encouragementsEnabled روشن باشد).
//   done ⇒ یکی از سه دسته (اولویت: ۱۰۰٪ روز ← اولویت بالا ← رگه ← ساده)؛ partial/not_done ⇒ فقط «ممنون که علتش را نوشتی».
// اولویت و گیت خروج (A1):
//   • تسک high و normal «الزامی»اند: تا done نشوند (یا partial/not_done همراه با علت) ثبت خروج مسدود است.
//   • تسک low «اختیاری»ست (present ⇒ optional:true): در فهرست می‌آید و پاسخش (و پیام تشویقی‌اش) مثل بقیه ذخیره می‌شود،
//     ولی نه در pendingTasks/تصمیم گیت شمرده می‌شود و نه در بنر/گزارش‌های معطل (A2). تسک سیستمی هیچ‌وقت اختیاری نیست.
//   • پاسخ‌نداده‌های اختیاری جدا در optionalTasks برمی‌گردند تا UI بتواند همراه الزامی‌ها نشانشان دهد.
const plansRepo = require('../repositories/weeklyPlanRepository');
const logsRepo = require('../repositories/taskLogRepository');
const settingsRepository = require('../repositories/settingsRepository');
const monthClosuresRepository = require('../repositories/monthClosuresRepository');
const attendanceRepository = require('../repositories/attendanceRepository');
const calendarService = require('../engine/calendarService');
const encouragements = require('../content/encouragements');
const teamReview = require('./teamReviewService');
const { sanitizeText } = require('../utils/sanitize');
const { addDays, dayNumber, dayDiff } = require('../utils/shiftDay');
const { getDb } = require('../db/connection');

const REASON_CODES = ['no_time', 'needs_more_time', 'blocked_by_others', 'priority_changed', 'technical_issue', 'other'];
const STATUSES = ['done', 'partial', 'not_done'];
const OUT_OF_PLAN_KEY = 'out_of_plan';
const MAX_EXTRA = 10;
const MAX_NOTE = 500;
const MAX_RESCHEDULE_DAYS = 60;
const DROP = 'drop';
const LATE_SOFT_WINDOW_MS = 24 * 60 * 60 * 1000;

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

/** تسک اختیاری (A1): اولویت low و غیرسیستمی. */
const isOptionalRow = (t) => !!t && t.priority === 'low' && !t.is_system;

const present = (t, extra = {}) => ({
  id: t.id, title: t.title, description: t.description || '', priority: t.priority,
  plannedDate: t.planned_date || null, isSystem: !!t.is_system, systemKey: t.system_key || null,
  outOfPlan: t.system_key === OUT_OF_PLAN_KEY, optional: isOptionalRow(t),
  isUrgent: !!t.is_urgent, assignedByUserId: t.assigned_by_user_id || null, assignedByName: t.assigned_by_name || null, urgentNote: t.urgent_note || null, urgentDeadlineTime: t.urgent_deadline_time || null, ...extra,
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
  // تسک فوری (E1) بالای فهرست؛ سپس اولویت و شناسه. فوری همیشه priority=high است ⇒ مثل high مانع خروج است (گیت تغییری نکرده).
  return [...picked.values()].sort((a, b) => (Number(b.isUrgent) - Number(a.isUrgent)) || (PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]) || (a.id - b.id));
}

function recordOn(user, date) {
  return attendanceRepository.listByUserAndRange(user.id, date, date)[0] || null;
}

/**
 * تعیین تاریخ گزارش و «دیرهنگام»بودن. خروجی: { ok:true, date, cur, late, source, record } | fail(...)
 * source: 'normal' | 'after_checkout' | 'backfill' | 'soft_later'
 */
function resolveReportDate(user, { now = new Date(), date: trustedDate, requestedDate } = {}, settings = settingsRepository.getAll()) {
  const cur = reportDateFor(user, now);
  if (trustedDate) return { ok: true, date: trustedDate, cur, late: false, source: 'normal', record: null };
  const explicit = requestedDate !== undefined && requestedDate !== null && requestedDate !== '';
  const date = explicit ? requestedDate : cur;
  if (explicit && (typeof date !== 'string' || dayNumber(date) === null)) return fail('INVALID_DATE', 'تاریخ گزارش نامعتبر است (قالب YYYY-MM-DD).');
  if (date > cur) return fail('DATE_IN_FUTURE', 'گزارشِ روزِ آینده ممکن نیست.');
  const record = recordOn(user, date);
  if (date === cur) {
    const closedAlready = !!(record && (record.check_out_time || record.status === 'incomplete'));
    return { ok: true, date, cur, late: closedAlready, source: closedAlready ? 'after_checkout' : 'normal', record };
  }
  if (monthClosuresRepository.findClosedOverlapping(date, date).length > 0) return fail('MONTH_CLOSED', 'این روز در ماهِ بسته‌شده است و گزارش آن فقط‌خواندنی است.');
  if (!record) return fail('NO_RECORD', 'برای این روز رکورد حضور ندارید؛ گزارش آن ممکن نیست.');
  if (!record.check_out_time) { // رکوردِ خودکار-بسته (یا بدون خروج) ⇒ backfill
    if (dayDiff(cur, date) > settings.reportBackfillDays) return fail('BACKFILL_EXPIRED', `مهلت تکمیل گزارش این روز (${settings.reportBackfillDays} روز) تمام شده است.`);
    return { ok: true, date, cur, late: true, source: 'backfill', record };
  }
  if (settings.dailyReportGateMode !== 'soft') return fail('LATE_NOT_ALLOWED', 'تکمیل دیرهنگام گزارش برای این روز مجاز نیست.');
  const outAt = Date.parse(record.check_out_time);
  if (!Number.isFinite(outAt) || now.getTime() - outAt > LATE_SOFT_WINDOW_MS) return fail('LATE_WINDOW_EXPIRED', 'مهلت ۲۴ ساعته‌ی تکمیل گزارش این روز تمام شده است.');
  return { ok: true, date, cur, late: true, source: 'soft_later', record };
}

/** GET /miniapp/report-backfill — روزهایی که هنوز گزارشِ دیرهنگام می‌پذیرند (برای بنر UI). حالت off ⇒ خالی. */
function getBackfillStatus(user, { now = new Date() } = {}) {
  const settings = settingsRepository.getAll();
  const cur = reportDateFor(user, now);
  const out = { ok: true, mode: settings.dailyReportGateMode, backfillDays: settings.reportBackfillDays, days: [] };
  if (settings.dailyReportGateMode === 'off') return out;
  const span = Math.max(1, Math.min(14, settings.reportBackfillDays));
  for (let i = 0; i <= span; i += 1) {
    const date = addDays(cur, -i);
    const r = resolveReportDate(user, { now, requestedDate: date }, settings);
    if (!r.ok || !r.late) continue;
    if (fullDayOff(user, date, settings)) continue;
    teamReview.prepareDay(user, date, settings, { late: true }); // D9-ب: تسک سیستمیِ روزِ گذشته همین‌جا ساخته/همگام می‌شود تا شمارش pending کمتر از واقعیت نباشد
    const pending = buildList(user, date, settings).filter((t) => !t.optional); // A2: تسک اختیاری (low) پاسخ‌نشده معطل/هشدار نیست
    if (!pending.length) continue;
    out.days.push({ date, source: r.source, pendingCount: pending.length, titles: pending.slice(0, 3).map((t) => t.title) });
  }
  return out;
}

/** GET /miniapp/daily-tasks */
function getDailyTasks(user, { now, date: forcedDate, requestedDate } = {}) {
  const settings = settingsRepository.getAll();
  const resolved = resolveReportDate(user, { now, date: forcedDate, requestedDate }, settings);
  if (!resolved.ok) return resolved;
  const { date } = resolved;
  const answered = logsRepo.listByUserDate(user.id, date).map((l) => {
    const t = plansRepo.findTask(l.task_id);
    return t ? { taskId: l.task_id, title: t.title, status: l.status, reasonCode: l.reason_code, reasonText: l.reason_text, rescheduleTo: l.reschedule_to, outOfPlan: t.system_key === OUT_OF_PLAN_KEY } : null;
  }).filter(Boolean);
  const off = fullDayOff(user, date, settings);
  if (!off) teamReview.prepareDay(user, date, settings, { late: resolved.late }); // D9: تسک سیستمیِ سرپرست (ساخت + done خودکار)
  const tasks = off ? [] : buildList(user, date, settings);
  return {
    ok: true, date, today: resolved.cur, late: resolved.late, source: resolved.source, mode: settings.dailyReportGateMode, fullDayOff: off,
    tasks,
    teamReview: teamReview.gateInfo(user, date, tasks, settings), // D9-ب: مشاهده‌نشده‌ها / گزارش‌نداده‌ها (فقط وقتی تسک سیستمی در فهرست است)
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

/** توضیحِ انجام (A1): undefined/null/خالی ⇒ null؛ غیرمتن ⇒ INVALID_NOTE؛ بیش از ۵۰۰ نویسه (پس از پاک‌سازی) ⇒ NOTE_TOO_LONG. */
function noteOf(raw) {
  if (raw === undefined || raw === null) return { value: null };
  if (typeof raw !== 'string') return { error: 'INVALID_NOTE' };
  const text = clean(raw, MAX_NOTE);
  if (text.length > MAX_NOTE) return { error: 'NOTE_TOO_LONG' };
  return { value: text || null };
}

function validateAnswer(a, n, user, date, settings, byId, base = date) {
  if (!a || typeof a !== 'object') return { error: fail('INVALID_ANSWER', `پاسخ ${n} نامعتبر است.`) };
  const taskId = Number(a.taskId);
  if (!Number.isInteger(taskId) || taskId <= 0) return { error: fail('INVALID_TASK', `شناسه‌ی تسک در پاسخ ${n} نامعتبر است.`) };
  const task = byId.get(taskId);
  if (!task) {
    const answered = logsRepo.findByTaskDate(taskId, date);
    return { error: answered && answered.user_id === user.id ? fail('ALREADY_ANSWERED', `تسک پاسخ ${n} قبلاً پاسخ داده شده است.`) : fail('TASK_NOT_FOUND', `تسک پاسخ ${n} در فهرست امروز شما نیست.`) };
  }
  if (!STATUSES.includes(a.status)) return { error: fail('INVALID_STATUS', `وضعیت پاسخ ${n} نامعتبر است (done | partial | not_done).`) };
  if (task.isUrgent && a.reschedule && typeof a.reschedule === 'object' && a.reschedule.type === DROP) { // E1: انتقال مجاز است، حذف (drop) نه
    return { error: fail('URGENT_DROP_NOT_ALLOWED', `تسک فوری (پاسخ ${n}) را نمی‌توان حذف کرد؛ می‌توانید آن را به روز دیگری منتقل کنید.`) };
  }
  if (task.systemKey === teamReview.REVIEW_KEY) { // D9: «انجام شد» فقط با مشاهده‌ی واقعیِ گزارش‌ها (خودکار ثبت می‌شود)؛ انتقال/حذفِ تسک سیستمی معنا ندارد
    if (a.status === 'done') return { error: fail('REVIEW_INCOMPLETE', `پاسخ ${n}: «انجام شد» برای این تسک فقط پس از مشاهده‌ی گزارش همه‌ی اعضای دارای گزارش ثبت می‌شود.`) };
    if (a.reschedule !== undefined && a.reschedule !== null) return { error: fail('RESCHEDULE_NOT_ALLOWED', `انتقال/حذفِ تسک سیستمی (پاسخ ${n}) مجاز نیست.`) };
  }
  const out = { taskId, status: a.status, reasonCode: null, reasonText: null, rescheduleTo: null, note: null };
  if (a.status === 'done') {
    if (a.reschedule) return { error: fail('RESCHEDULE_NOT_ALLOWED', `برای تسکِ انجام‌شده (پاسخ ${n}) انتقال معنا ندارد.`) };
    // A1 (فاز ۱۵): توضیحِ اختیاریِ انجام؛ برای partial/not_done نادیده گرفته می‌شود (آن‌ها reasonText دارند)
    const note = noteOf(a.note);
    if (note.error) return { error: fail(note.error, `توضیح انجام در پاسخ ${n} ${note.error === 'NOTE_TOO_LONG' ? `حداکثر ${MAX_NOTE} نویسه` : 'باید متن باشد'}.`) };
    out.note = note.value;
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
    if (type === 'tomorrow') out.rescheduleTo = nextWorkingDay(user, base, settings);
    else if (type === DROP) out.rescheduleTo = DROP;
    else if (type === 'date') {
      const d = r.date;
      if (typeof d !== 'string' || dayNumber(d) === null) return { error: fail('INVALID_DATE', `تاریخ انتقال پاسخ ${n} نامعتبر است.`) };
      if (d <= base || d > addDays(base, MAX_RESCHEDULE_DAYS)) return { error: fail('DATE_OUT_OF_RANGE', `تاریخ انتقال پاسخ ${n} باید بعد از امروز و حداکثر ${MAX_RESCHEDULE_DAYS} روز آینده باشد.`) };
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

/** اعتبارسنجی بدنه‌ی گزارش (بدون نوشتن). خروجی: { error } | { answers, extras, pendingIds }. */
function prepareReport(user, body, date, settings, { base = date } = {}) {
  const b = body && typeof body === 'object' ? body : {};
  const answersIn = b.answers === undefined ? [] : b.answers;
  if (!Array.isArray(answersIn)) return { error: fail('INVALID_ANSWERS', 'answers باید آرایه باشد.') };
  if (answersIn.length > 100) return { error: fail('TOO_MANY_ANSWERS', 'تعداد پاسخ‌ها بیش از حد مجاز است.') };
  if (monthClosuresRepository.findClosedOverlapping(date, date).length > 0) return { error: fail('MONTH_CLOSED', 'این روز در ماهِ بسته‌شده است و گزارش آن فقط‌خواندنی است.') };
  if (fullDayOff(user, date, settings)) return { error: fail('FULL_DAY_OFF', 'امروز مرخصی/ماموریتِ تمام‌روز دارید و گزارش تسک لازم نیست.') };

  teamReview.prepareDay(user, date, settings, { late: base !== date }); // D9 (نوشتنِ ساختاری/مشتق‌شده، نه پاسخ کاربر)
  const list = buildList(user, date, settings);
  const byId = new Map(list.map((t) => [t.id, t]));
  const seen = new Set();
  const answers = [];
  for (let i = 0; i < answersIn.length; i += 1) {
    const v = validateAnswer(answersIn[i], i + 1, user, date, settings, byId, base);
    if (v.error) return { error: v.error };
    if (seen.has(v.out.taskId)) return { error: fail('DUPLICATE_ANSWER', `تسک پاسخ ${i + 1} بیش از یک‌بار ارسال شده است.`) };
    seen.add(v.out.taskId);
    answers.push(v.out);
  }
  const ex = validateExtras(b.extra);
  if (ex.error) return { error: ex.error };
  const open = list.filter((t) => !seen.has(t.id));
  // pending = الزامی‌های پاسخ‌نداده (مبنای گیت)؛ optional = اختیاری‌های (low) پاسخ‌نداده (فقط برای نمایش)
  return { answers, extras: ex.extras, pending: open.filter((t) => !t.optional), optional: open.filter((t) => t.optional) };
}

// ---------- پیام تشویقی (D8) ----------
const STREAK_LOOKBACK_DAYS = 30;

/** تعداد روزهای (دارای پاسخ) پیاپیِ قبل از date که همه‌ی پاسخ‌هایشان done بوده؛ روزهای بدون پاسخ (تعطیل/مرخصی) رگه را نمی‌شکنند. */
function streakBefore(userId, date) {
  const logs = logsRepo.listByUserRange(userId, addDays(date, -STREAK_LOOKBACK_DAYS), addDays(date, -1));
  const allDone = new Map(); // روز ⇒ آیا همه‌ی پاسخ‌های آن روز done است
  for (const l of logs) allDone.set(l.log_date, allDone.get(l.log_date) !== false && l.status === 'done');
  let n = 0;
  for (const d of [...allDone.keys()].sort().reverse()) {
    if (!allDone.get(d)) break;
    n += 1;
  }
  return n;
}

/**
 * پیام‌های تشویقیِ یک گزارش، به ترتیب [...answers, ...extras]. خاموش بودن تنظیم ⇒ همه null.
 * قوانین: آخرین تسکِ done که روز را ۱۰۰٪ می‌کند ⇒ high/fullDay (فقط وقتی روز ≥ ۲ تسک دارد)؛ تسک با اولویت بالا ⇒ high/priority؛
 * رگه ≥ STREAK_MIN روز ⇒ streak؛ وگرنه simple. هیچ قالبی در ۵ پیام اخیرِ کاربر (و همین گزارش) تکرار نمی‌شود.
 */
function buildEncouragements(user, date, settings, { answers, extras }) {
  const items = [
    ...answers.map((a) => { const t = plansRepo.findTask(a.taskId); return { taskId: a.taskId, status: a.status, title: t ? t.title : '', priority: t ? t.priority : 'normal' }; }),
    ...extras.map((e) => ({ taskId: null, status: 'done', title: e.title, priority: 'normal' })),
  ];
  if (!settings.encouragementsEnabled) return items.map(() => null);

  const answeredIds = new Set(answers.map((a) => a.taskId));
  const prior = logsRepo.listByUserDate(user.id, date).filter((l) => !answeredIds.has(l.task_id));
  const remaining = buildList(user, date, settings).filter((t) => !answeredIds.has(t.id));
  const dayAllDone = remaining.length === 0 && prior.every((l) => l.status === 'done') && items.every((i) => i.status === 'done');
  const dayTaskCount = items.length + prior.length;
  const streakActive = streakBefore(user.id, date) + (dayAllDone ? 1 : 0) >= encouragements.STREAK_MIN;
  let lastDone = -1;
  items.forEach((it, i) => { if (it.status === 'done') lastDone = i; });

  let recent = logsRepo.listRecentEncouragements(user.id).filter((t) => encouragements.templateIndexOf(t) >= 0).slice(0, encouragements.RECENT_WINDOW);
  return items.map((it, i) => {
    let category = 'simple'; let variant;
    if (dayAllDone && dayTaskCount >= 2 && i === lastDone) { category = 'high'; variant = 'fullDay'; }
    else if (it.priority === 'high') { category = 'high'; variant = 'priority'; }
    else if (streakActive) category = 'streak';
    const text = encouragements.encouragementFor({ status: it.status, category, variant, name: user.full_name, task: it.title, recent });
    if (it.status === 'done') recent = [text, ...recent].slice(0, encouragements.RECENT_WINDOW);
    return text;
  });
}

/** نوشتن پاسخ‌ها و تسک‌های «خارج از برنامه». باید داخل تراکنشِ فراخوان (یا همین تابع) اجرا شود. */
function applyReport(user, date, settings, { answers, extras }, { late = false } = {}) {
  let texts;
  try {
    texts = buildEncouragements(user, date, settings, { answers, extras });
  } catch (err) { // پیام تشویقی تزئینی است؛ خطا در ساختش نباید گزارش/خروج را بشکند
    console.error('[encouragements] خطا (نادیده گرفته شد):', err && err.message ? err.message : err);
    texts = [...answers, ...extras].map(() => null);
  }
  const out = [];
  answers.forEach((a, i) => {
    logsRepo.upsert({ taskId: a.taskId, userId: user.id, logDate: date, status: a.status, reasonCode: a.reasonCode, reasonText: a.reasonText, rescheduleTo: a.rescheduleTo, encouragementText: texts[i], answeredLate: late, note: a.note || null });
    out.push({ taskId: a.taskId, status: a.status, text: texts[i] });
  });
  if (extras.length) {
    const plan = plansRepo.getOrCreate(user.id, calendarService.weekStartOf(date, settings.weekStartDay));
    extras.forEach((e, j) => {
      const t = plansRepo.addTask(plan.id, { title: e.title, description: e.description, plannedDate: date, priority: 'normal', systemKey: OUT_OF_PLAN_KEY });
      const text = texts[answers.length + j];
      logsRepo.upsert({ taskId: t.id, userId: user.id, logDate: date, status: 'done', encouragementText: text, answeredLate: late });
      out.push({ taskId: t.id, status: 'done', text });
    });
  }
  return out.filter((e) => e.text);
}

/**
 * POST /miniapp/daily-report  { answers: [{taskId, status, reasonCode?, reasonText?, reschedule?}], extra: [{title, description?}] }
 * همه‌یاهیچ: اول همه‌چیز اعتبارسنجی، بعد یک تراکنش. پاسخِ ناقص مجاز است (کامل‌بودنِ گزارش را گیت خروج D7 می‌سنجد).
 */
function submitDailyReport(user, body, { now, date: forcedDate, requestedDate } = {}) {
  const settings = settingsRepository.getAll();
  const resolved = resolveReportDate(user, { now, date: forcedDate, requestedDate }, settings);
  if (!resolved.ok) return resolved;
  const { date, late } = resolved;
  const base = late && resolved.cur > date ? resolved.cur : date; // انتقالِ پاسخ‌های دیرهنگام نسبت به امروزِ واقعی
  const prep = prepareReport(user, body, date, settings, { base });
  if (prep.error) return prep.error;
  if (!prep.answers.length && !prep.extras.length) return fail('EMPTY_REPORT', 'هیچ پاسخی ارسال نشده است.');
  const messages = getDb().transaction(() => applyReport(user, date, settings, prep, { late }))();
  const fresh = getDailyTasks(user, { now, date });
  return { ...fresh, late, source: resolved.source, saved: { answers: prep.answers.length, extra: prep.extras.length }, encouragements: messages };
}

// ---------- برداشتن پاسخ و ویرایش توضیحِ انجام (A1، فاز ۱۵) ----------
// تاریخ فقط با resolveReportDate تعیین می‌شود (همان پنجره‌ی تکمیلِ دیرهنگام/backfill و همان خطاهای MONTH_CLOSED/NO_RECORD/BACKFILL_EXPIRED/...).
// مالکیت: ردیفِ پاسخ باید مالِ همین کاربر باشد؛ وگرنه TASK_NOT_FOUND (وجودِ پاسخِ دیگران لو نمی‌رود).
function ownedLog(user, taskIdIn, date) {
  const taskId = Number(taskIdIn);
  if (!Number.isInteger(taskId) || taskId <= 0) return fail('INVALID_TASK', 'شناسه‌ی تسک نامعتبر است.');
  if (monthClosuresRepository.findClosedOverlapping(date, date).length > 0) return fail('MONTH_CLOSED', 'این روز در ماهِ بسته‌شده است و گزارش آن فقط‌خواندنی است.');
  const log = logsRepo.findByTaskDate(taskId, date);
  if (!log || log.user_id !== user.id) return fail('TASK_NOT_FOUND', 'پاسخی برای این تسک در این روز پیدا نشد.');
  return { ok: true, taskId, log, task: plansRepo.findTask(taskId) };
}

/**
 * POST /miniapp/daily-report/undo  { taskId, date? } — برداشتنِ پاسخ (تیک).
 *   • عادی/انتقال‌یافته: ردیفِ پاسخ حذف می‌شود ⇒ تسک خودکار به buildList برمی‌گردد (و اگر پاسخ انتقال بود، از روز مقصد هم برمی‌خیزد).
 *   • «خارج از برنامه» (out_of_plan): خودِ تسک حذف نرم می‌شود (وگرنه با planned_date دوباره بی‌پاسخ ظاهر می‌شد)؛ ردیفِ پاسخ هم حذف می‌شود.
 *   • تسک سیستمیِ «بررسی گزارش تیم»: قابل واگرد نیست (REVIEW_TASK_LOCKED).
 */
function undoAnswer(user, { taskId, date: requestedDate, now } = {}) {
  const settings = settingsRepository.getAll();
  const resolved = resolveReportDate(user, { now, requestedDate }, settings);
  if (!resolved.ok) return resolved;
  const { date } = resolved;
  const own = ownedLog(user, taskId, date);
  if (!own.ok) return own;
  if (own.task && own.task.system_key === teamReview.REVIEW_KEY) return fail('REVIEW_TASK_LOCKED', 'پاسخ تسک «بررسی گزارش تیم» را نمی‌توان برداشت؛ وضعیتِ آن با مشاهده‌ی گزارش‌ها ثبت می‌شود.');
  const outOfPlan = !!(own.task && own.task.system_key === OUT_OF_PLAN_KEY);
  getDb().transaction(() => {
    logsRepo.remove(own.taskId, date);
    if (outOfPlan) plansRepo.softDeleteTask(own.taskId);
  })();
  const fresh = getDailyTasks(user, { now, date });
  return { ...fresh, undone: { taskId: own.taskId, date, outOfPlan, previousStatus: own.log.status } };
}

/** PATCH /miniapp/daily-report/note  { taskId, date?, note } — ویرایش/پاک‌کردنِ توضیحِ انجام (فقط برای done؛ note خالی ⇒ پاک). */
function updateNote(user, { taskId, date: requestedDate, note, now } = {}) {
  const settings = settingsRepository.getAll();
  const resolved = resolveReportDate(user, { now, requestedDate }, settings);
  if (!resolved.ok) return resolved;
  const { date } = resolved;
  const own = ownedLog(user, taskId, date);
  if (!own.ok) return own;
  if (own.log.status !== 'done') return fail('NOTE_ONLY_FOR_DONE', 'توضیحِ انجام فقط برای تسکِ «انجام‌شده» ثبت می‌شود.');
  const n = noteOf(note);
  if (n.error) return fail(n.error, n.error === 'NOTE_TOO_LONG' ? `توضیح انجام حداکثر ${MAX_NOTE} نویسه است.` : 'توضیح باید متن باشد.');
  const updated = logsRepo.setNote(own.taskId, date, n.value);
  return { ok: true, taskId: own.taskId, date, note: updated.note || null, cleared: !updated.note };
}

// ---------- گیت خروج (D7) ----------
// تصمیم برای /check-out بر پایه‌ی dailyReportGateMode:
//   enforce ⇒ اگر بعد از اعمال پاسخ‌های همین درخواست هنوز تسکِ پاسخ‌نداده مانده باشد: block (چیزی ذخیره نمی‌شود)
//   soft    ⇒ خروج مجاز است؛ پاسخ‌های ارسال‌شده ذخیره می‌شوند و pendingTasks برای یادآوری برمی‌گردد
//   off     ⇒ گیت اعمال نمی‌شود (اگر کلاینت پاسخ فرستاده باشد همچنان ذخیره می‌شود)
// ماهِ بسته یا مرخصی/ماموریتِ تمام‌روز ⇒ گیت اعمال نمی‌شود (و ارسال گزارش رد می‌شود).
// پاسخ‌ها فقط وقتی ذخیره می‌شوند که خروج هم ثبت شود: دو مرحله‌ی «تصمیم» و «commitAtomic».
// خطای داخلی در ارزیابیِ گیت ⇒ fail-open (ثبت تردد نباید بشکند).
//   خروجی: { action: 'allow'|'block'|'remind'|'invalid', report, pendingTasks, mode, date, error?, code? }
function hasReportInput(body) {
  return !!body && typeof body === 'object' && (body.answers !== undefined || body.extra !== undefined);
}

function checkoutGate(user, recordDate, body) {
  const out = { action: 'allow', report: null, pendingTasks: [], optionalTasks: [], mode: 'off', date: recordDate };
  try {
    const settings = settingsRepository.getAll();
    out.mode = settings.dailyReportGateMode;
    const provided = hasReportInput(body);
    if (out.mode !== 'enforce' && out.mode !== 'soft' && !provided) return out;
    // planGateStartDate (شروع اعمال الزام برنامه/گزارش): پیش از آن تاریخ، سؤالی پرسیده نمی‌شود (پاسخ‌های ارسالیِ کلاینت همچنان ذخیره می‌شوند)
    if (!provided && settings.planGateStartDate && recordDate < settings.planGateStartDate) return out;

    const closed = monthClosuresRepository.findClosedOverlapping(recordDate, recordDate).length > 0;
    if (closed || fullDayOff(user, recordDate, settings)) {
      if (!provided) return out; // گیت اعمال نمی‌شود
    }
    const prep = prepareReport(user, provided ? body : {}, recordDate, settings);
    if (prep.error) return { ...out, action: 'invalid', error: prep.error.error, code: prep.error.code };
    if (prep.answers.length || prep.extras.length) out.report = { answers: prep.answers, extras: prep.extras, settings };
    out.pendingTasks = prep.pending;
    out.optionalTasks = prep.optional;
    if (out.mode === 'off' || !out.pendingTasks.length) return out;
    out.teamReview = teamReview.gateInfo(user, recordDate, out.pendingTasks, settings); // D9-ب (برای ۴۰۹/یادآوری؛ null اگر تسک سیستمی نیست)
    out.action = out.mode === 'enforce' ? 'block' : 'remind';
    return out;
  } catch (err) {
    console.error('[dailyReportGate] خطا (نادیده گرفته شد، خروج مجاز):', err && err.message ? err.message : err);
    return { action: 'allow', report: null, pendingTasks: [], optionalTasks: [], mode: out.mode, date: recordDate, failedOpen: true };
  }
}

const BLOCK_MSG_MAX_TITLES = 5;
const BLOCK_MSG_TITLE_LEN = 40;

/** متن ۴۰۹ گیت خروج (A1): کدام تسک‌ها مانع‌اند و چه کاری لازم است (تکمیل یا نوشتن علت). pendingTasks فقط الزامی‌هاست. */
function blockMessage(pendingTasks) {
  const list = Array.isArray(pendingTasks) ? pendingTasks : [];
  if (!list.length) return 'قبل از خروج، وضعیت تسک‌های امروزتان را مشخص کنید؛ اگر انجام نشده، علتش را بنویسید.';
  const clip = (s) => (s.length > BLOCK_MSG_TITLE_LEN ? `${s.slice(0, BLOCK_MSG_TITLE_LEN - 1)}…` : s);
  const label = (t) => (t.systemKey === teamReview.REVIEW_KEY ? `«${clip(t.title)}» (مشاهده‌ی گزارش‌ها یا ثبت علت)` : `«${clip(t.title)}»`);
  const names = list.slice(0, BLOCK_MSG_MAX_TITLES).map(label).join('، ');
  const more = list.length > BLOCK_MSG_MAX_TITLES ? ` و ${list.length - BLOCK_MSG_MAX_TITLES} مورد دیگر` : '';
  return `برای ثبت خروج، ${list.length} تسک با اولویت بالا یا عادی هنوز بدون پاسخ است: ${names}${more}. قبل از خروج وضعیت تسک‌های امروزتان را مشخص کنید: هرکدام را «انجام شد» بزنید یا اگر انجام نشده، وضعیت «انجام نشد/نیمه‌کاره» را همراه با علتش ثبت کنید. تسک‌های اولویت کم مانع خروج نیستند.`;
}

/** fn (ثبت خروج) و ذخیره‌ی گزارش در «یک» تراکنش؛ خطا در هرکدام ⇒ هیچ‌کدام ثبت نمی‌شود. */
function commitAtomic(user, gate, fn) {
  return getDb().transaction(() => {
    if (gate && gate.report) gate.report.encouragements = applyReport(user, gate.date, gate.report.settings, gate.report);
    return fn();
  })();
}

module.exports = { undoAnswer, updateNote, getDailyTasks, submitDailyReport, resolveReportDate, getBackfillStatus, checkoutGate, commitAtomic, blockMessage, buildList, reportDateFor, REASON_CODES, OUT_OF_PLAN_KEY, DROP };

// تسک سیستمی سرپرست + «مشاهده‌ی گزارش» (D9 — بخش اول: منطق، داده و API).
//
// قواعد:
//   • برای هر سرپرست (role = manager) و ادمینِ دارای زیردست، در هر «روز کاری» یک تسک سیستمی review_team_reports ساخته می‌شود
//     (plan_tasks با is_system=1 و planned_date = همان روز؛ غیرقابل‌حذف/ویرایش — weeklyPlanService تسک‌های سیستمی را دست نمی‌زند).
//   • «روز قبل» = آخرین روز کاریِ قبل از آن روز در تقویم همان سرپرست (calendarService.getPreviousWorkingDay؛ آخر هفته/تعطیلی لحاظ می‌شود).
//     تاریخ مرورشده ذخیره نمی‌شود و هر بار از تقویم محاسبه می‌شود (تغییر تعطیلات بعداً درست اعمال شود).
//   • تیم = زیردست‌های مستقیم فعال (users.manager_id = سرپرست). اگر هیچ‌یک از اعضا در آن روز کاری/بدون گزارش نبودند ⇒ تسک ساخته نمی‌شود.
//   • «دارای گزارش» = عضوی که در آن روز حداقل یک ردیف task_daily_logs دارد. وضعیت هر عضو:
//       reviewed | unreviewed (دارای گزارش) · no_report (روز کاری بوده ولی گزارش نداده) · off (آن روز تعطیل/مرخصیِ تمام‌روز و بدون گزارش).
//   • تسک done است وقتی «همه‌ی اعضای دارای گزارش» مشاهده شده باشند (گزارش‌نداده‌ها شرط نیستند). done خودکار در task_daily_logs
//     نوشته می‌شود (بدون پیام تشویقی) و تسک از فهرست پاسخ‌نداده‌ها/گیت خروج بیرون می‌رود؛ اگر سرپرست قبلاً «انجام نشد + علت» داده باشد و
//     بعداً همه را مشاهده کند، همان ردیف به done ارتقا می‌یابد (وضعیت واقعی ملاک است).
//   • مشاهده‌ی گزارش (markReviewed): فقط manager/admin؛ manager فقط برای تیم خودش، admin برای هر کاربرِ دیگر؛ عضو باید در آن روز گزارش داشته باشد؛
//     تاریخ نه آینده و نه بیش از ۶۰ روز قبل؛ ماه بسته ⇒ رد. idempotent؛ audit فقط وقتی ردیف تازه است یا کامنت/واکنش عوض شده.
//   • (D9-ب) gateInfo: فهرست «مشاهده‌نشده‌ها» و «گزارش‌نداده‌ها» (جدا از هم) برای پاسخ ۴۰۹ گیت خروج و daily-tasks؛ برای هر مشاهده‌نشده خلاصه‌ی گزارش هم می‌آید.
//   • (D9-ب) کامنتِ تازه/تغییرکرده ⇒ اعلان درون‌پنلی + تلگرام به کارمند (notificationEvents.reportCommented؛ خطایش مشاهده را نمی‌شکند).
//   • نوشتن‌های خودکارِ این ماژول (ساخت تسک/done) ساختاری و مشتق‌شده‌اند، نه «پاسخ کاربر»؛ خطایشان هرگز گزارش/خروج را نمی‌شکند.
const settingsRepository = require('../repositories/settingsRepository');
const usersRepository = require('../repositories/usersRepository');
const plansRepo = require('../repositories/weeklyPlanRepository');
const logsRepo = require('../repositories/taskLogRepository');
const reviewsRepo = require('../repositories/reportReviewRepository');
const monthClosuresRepository = require('../repositories/monthClosuresRepository');
const attendanceRepository = require('../repositories/attendanceRepository');
const auditRepository = require('../repositories/auditRepository');
const calendarService = require('../engine/calendarService');
const { sanitizeText } = require('../utils/sanitize');
const { addDays, dayNumber } = require('../utils/shiftDay');

const REVIEW_KEY = 'review_team_reports';
const TITLE = 'بررسی گزارش روز قبلِ تیم';
const DESCRIPTION = 'گزارش تسک‌های روز کاریِ قبل اعضای تیم را مشاهده کنید.';
const REACTIONS = ['like', 'great', 'thanks'];
const COMMENT_MAX = 300;
const MAX_LOOKBACK_DAYS = 60;

const fail = (code, error, extra = {}) => ({ ok: false, code, error, ...extra });
const clean = (v, max) => sanitizeText(v == null ? '' : String(v), max + 1).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();

const isReviewer = (user) => !!user && (user.role === 'manager' || user.role === 'admin');

// کد خطا ⇒ وضعیت HTTP (مشترک بین Mini App و پنل)
const ERROR_STATUS = { FORBIDDEN: 403, SUBJECT_NOT_IN_SCOPE: 403, USER_NOT_FOUND: 404, NO_REPORT: 404, MONTH_CLOSED: 409 };
const statusOf = (code) => ERROR_STATUS[code] || 400;

/** زیردست‌های مستقیمِ فعال (فقط برای manager/admin). */
function teamOf(user) {
  if (!isReviewer(user)) return [];
  return usersRepository.listUsers({ onlyActive: true, managerId: user.id }).filter((u) => u.id !== user.id);
}

function workedOn(member, date, settings) {
  const cal = calendarService.getCalendarDay(member, date, { settings });
  return cal.isWorkingDay && !calendarService.fullyOnApprovedLeave(member, date, cal);
}

/** «روز قبل» برای تسکِ روز date: آخرین روز کاریِ قبل در تقویم سرپرست (یا null). */
function reviewDateFor(user, date, settings = settingsRepository.getAll()) {
  return calendarService.getPreviousWorkingDay(user, date, { settings });
}

/**
 * وضعیت مشاهده‌ی گزارش‌های تیم برای روز reviewDate.
 * خروجی: { reviewDate, members:[{userId,fullName,department,status,reviewedAt,comment,reaction}], unreviewed, noReport,
 *          reportCount, reviewedCount, complete, applicable }
 *   complete = هیچ عضوِ دارای گزارشِ مشاهده‌نشده نمانده (بدون عضو/بدون گزارش هم true)
 *   applicable = حداقل یک عضو آن روز کاری بوده یا گزارش دارد (شرط ساخته‌شدن تسک)
 */
function reviewState(user, reviewDate, settings = settingsRepository.getAll()) {
  const team = teamOf(user);
  const ids = team.map((m) => m.id);
  const withReport = new Set(logsRepo.listUserIdsWithLogsOnDate(ids, reviewDate));
  const reviews = new Map(reviewsRepo.listByReviewerSubjectsDate(user.id, ids, reviewDate).map((r) => [r.subject_user_id, r]));
  const members = team.map((m) => {
    const rev = reviews.get(m.id) || null;
    const hasReport = withReport.has(m.id);
    let status;
    if (hasReport) status = rev ? 'reviewed' : 'unreviewed';
    else status = workedOn(m, reviewDate, settings) ? 'no_report' : 'off';
    return { userId: m.id, fullName: m.full_name, department: m.department || null, status, reviewedAt: rev ? rev.reviewed_at : null, comment: rev ? rev.comment : null, reaction: rev ? rev.reaction : null };
  });
  const unreviewed = members.filter((m) => m.status === 'unreviewed');
  const noReport = members.filter((m) => m.status === 'no_report');
  const reviewedCount = members.filter((m) => m.status === 'reviewed').length;
  return {
    reviewDate, members, unreviewed, noReport,
    reportCount: reviewedCount + unreviewed.length, reviewedCount,
    complete: unreviewed.length === 0,
    applicable: members.some((m) => m.status !== 'off'),
  };
}

const SUMMARY_MAX_ITEMS = 30;

/** خلاصه‌ی گزارش یک عضو در یک روز (برای مرور سرپرست): شمارش‌ها + فهرست تسک‌ها با وضعیت/علت. */
function reportSummaryOf(userId, date) {
  const items = [];
  for (const l of logsRepo.listByUserDate(userId, date)) {
    const t = plansRepo.findTask(l.task_id);
    if (!t) continue;
    items.push({ title: t.title, status: l.status, reasonCode: l.reason_code || null, reasonText: l.reason_text || null, outOfPlan: t.system_key === 'out_of_plan', answeredLate: !!l.answered_late });
  }
  const planned = items.filter((i) => !i.outOfPlan);
  const done = planned.filter((i) => i.status === 'done').length;
  return {
    total: planned.length, done,
    partial: planned.filter((i) => i.status === 'partial').length,
    notDone: planned.filter((i) => i.status === 'not_done').length,
    extra: items.length - planned.length,
    percent: planned.length ? Math.round((done / planned.length) * 100) : null,
    items: items.slice(0, SUMMARY_MAX_ITEMS),
  };
}

/** به هر عضوِ دارای گزارش (مشاهده‌شده/نشده) خلاصه‌ی گزارش را می‌چسباند (درجا؛ state.unreviewed همان اشیاء members است). */
function attachReports(state) {
  for (const m of state.members) {
    if (m.status === 'unreviewed' || m.status === 'reviewed') m.report = reportSummaryOf(m.userId, state.reviewDate);
  }
  return state;
}

/**
 * اطلاعات گیت خروج سرپرست (D9-ب): اگر تسک سیستمیِ «بررسی گزارش تیم» در فهرست پاسخ‌نداده‌ها هست،
 * مشاهده‌نشده‌ها (با خلاصه‌ی گزارش) و گزارش‌نداده‌ها را «جدا از هم» برمی‌گرداند؛ وگرنه null.
 * ضدخطا: هر مشکلی ⇒ null (فقط جزئیاتِ اضافیِ پاسخ ۴۰۹ از دست می‌رود؛ خودِ گیت دست نمی‌خورد).
 */
function gateInfo(user, date, pendingTasks, settings = settingsRepository.getAll()) {
  try {
    if (!isReviewer(user)) return null;
    const task = (pendingTasks || []).find((t) => t && t.systemKey === REVIEW_KEY);
    if (!task) return null;
    const reviewDate = reviewDateFor(user, date, settings);
    if (!reviewDate) return null;
    const state = attachReports(reviewState(user, reviewDate, settings));
    const brief = (m) => ({ userId: m.userId, fullName: m.fullName, department: m.department });
    return {
      taskId: task.id, reviewDate,
      unreviewed: state.unreviewed.map((m) => ({ ...brief(m), report: m.report })),
      noReport: state.noReport.map(brief),
      reportCount: state.reportCount, reviewedCount: state.reviewedCount,
    };
  } catch (err) {
    console.error('[teamReview] gateInfo ناموفق (نادیده گرفته شد):', sanitizeText(err && err.message ? err.message : String(err), 200));
    return null;
  }
}

function findTask(user, date, settings) {
  const plan = plansRepo.findByUserWeek(user.id, calendarService.weekStartOf(date, settings.weekStartDay));
  return plan ? plansRepo.findSystemTaskOnDate(plan.id, REVIEW_KEY, date) : null;
}

/** ساخت (idempotent) تسک سیستمیِ روز date. خروجی: ردیف تسک | null (شرایط ساخت نبود). */
function ensureTask(user, date, settings = settingsRepository.getAll()) {
  if (!isReviewer(user) || dayNumber(date) === null) return null;
  const existing = findTask(user, date, settings);
  if (existing) return existing;
  if (monthClosuresRepository.findClosedOverlapping(date, date).length > 0) return null;
  const cal = calendarService.getCalendarDay(user, date, { settings });
  if (!cal.isWorkingDay || calendarService.fullyOnApprovedLeave(user, date, cal)) return null;
  const reviewDate = reviewDateFor(user, date, settings);
  if (!reviewDate) return null;
  if (!reviewState(user, reviewDate, settings).applicable) return null;
  const plan = plansRepo.getOrCreate(user.id, calendarService.weekStartOf(date, settings.weekStartDay));
  return plansRepo.addTask(plan.id, { title: TITLE, description: DESCRIPTION, plannedDate: date, priority: 'normal', isSystem: true, systemKey: REVIEW_KEY });
}

/**
 * اگر شرط done برقرار است، ردیف done را (بدون پیام تشویقی) می‌نویسد/ارتقا می‌دهد. خروجی: true اگر چیزی نوشته شد.
 * late: پاسخِ مربوط به روز گذشته (backfill/دیرهنگام).
 */
function syncCompletion(user, date, settings = settingsRepository.getAll(), { late = false } = {}) {
  const task = findTask(user, date, settings);
  if (!task) return false;
  const reviewDate = reviewDateFor(user, date, settings);
  if (!reviewDate) return false;
  if (!reviewState(user, reviewDate, settings).complete) return false;
  const log = logsRepo.findByTaskDate(task.id, date);
  if (log && log.status === 'done') return false;
  logsRepo.upsert({ taskId: task.id, userId: user.id, logDate: date, status: 'done', answeredLate: late });
  return true;
}

/** ساخت + همگام‌سازی برای روز date؛ هر خطا فقط لاگ می‌شود (فراخوان: taskReportService). */
function prepareDay(user, date, settings = settingsRepository.getAll(), { late = false } = {}) {
  try {
    if (!isReviewer(user)) return;
    ensureTask(user, date, settings);
    syncCompletion(user, date, settings, { late });
  } catch (err) {
    console.error('[teamReview] خطا (نادیده گرفته شد):', sanitizeText(err && err.message ? err.message : String(err), 200));
  }
}

const presentReview = (r) => ({ reviewerId: r.reviewer_id, subjectUserId: r.subject_user_id, reportDate: r.report_date, reviewedAt: r.reviewed_at, comment: r.comment || null, reaction: r.reaction || null });

function reportDateBounds(user, now) {
  const cur = attendanceRepository.currentRecordDate(user.id, now);
  return { cur, oldest: addDays(cur, -MAX_LOOKBACK_DAYS) };
}

/** GET /miniapp/team-review?date= — وضعیت مشاهده‌ی گزارش‌های تیم (پیش‌فرض: «روز قبل» نسبت به امروزِ سرپرست). */
function getTeamReview(user, { date, now = new Date(), detail = false } = {}) {
  if (!isReviewer(user)) return fail('FORBIDDEN', 'فقط سرپرست یا ادمین به گزارش‌های تیم دسترسی دارد.');
  const settings = settingsRepository.getAll();
  const { cur, oldest } = reportDateBounds(user, now);
  let reviewDate;
  if (date === undefined || date === null || date === '') {
    reviewDate = reviewDateFor(user, cur, settings);
    if (!reviewDate) return { ok: true, today: cur, reviewDate: null, members: [], unreviewed: [], noReport: [], reportCount: 0, reviewedCount: 0, complete: true, applicable: false };
  } else {
    if (typeof date !== 'string' || dayNumber(date) === null) return fail('INVALID_DATE', 'تاریخ نامعتبر است (قالب YYYY-MM-DD).');
    if (date > cur) return fail('DATE_IN_FUTURE', 'گزارشِ روزِ آینده وجود ندارد.');
    if (date < oldest) return fail('DATE_TOO_OLD', `فقط گزارش‌های ${MAX_LOOKBACK_DAYS} روز اخیر قابل مشاهده است.`);
    reviewDate = date;
  }
  const state = reviewState(user, reviewDate, settings);
  return { ok: true, today: cur, ...(detail ? attachReports(state) : state) };
}

/**
 * POST /miniapp/report-reviews — «مشاهده شد» روی گزارش یک عضو در یک روز + کامنت/واکنش اختیاری.
 * input: { subjectUserId, reportDate, comment?, reaction? }
 */
function markReviewed(reviewer, input, { now = new Date(), ip = null } = {}) {
  if (!isReviewer(reviewer)) return fail('FORBIDDEN', 'فقط سرپرست یا ادمین می‌تواند گزارش را مشاهده کند.');
  const b = input && typeof input === 'object' ? input : {};
  const subjectId = Number(b.subjectUserId);
  if (!Number.isInteger(subjectId) || subjectId <= 0) return fail('INVALID_SUBJECT', 'شناسه‌ی کارمند نامعتبر است.');
  const reportDate = b.reportDate;
  if (typeof reportDate !== 'string' || dayNumber(reportDate) === null) return fail('INVALID_DATE', 'تاریخ گزارش نامعتبر است (قالب YYYY-MM-DD).');
  const { cur, oldest } = reportDateBounds(reviewer, now);
  if (reportDate > cur) return fail('DATE_IN_FUTURE', 'گزارشِ روزِ آینده وجود ندارد.');
  if (reportDate < oldest) return fail('DATE_TOO_OLD', `فقط گزارش‌های ${MAX_LOOKBACK_DAYS} روز اخیر قابل مشاهده است.`);

  const subject = usersRepository.findById(subjectId);
  if (!subject) return fail('USER_NOT_FOUND', 'کارمند پیدا نشد.');
  const inScope = subject.id !== reviewer.id && (reviewer.role === 'admin' || subject.manager_id === reviewer.id);
  if (!inScope) return fail('SUBJECT_NOT_IN_SCOPE', 'این کارمند عضو تیم شما نیست.');

  let comment;
  if (b.comment !== undefined && b.comment !== null && b.comment !== '') {
    comment = clean(b.comment, COMMENT_MAX);
    if (comment.length > COMMENT_MAX) return fail('COMMENT_TOO_LONG', `کامنت حداکثر ${COMMENT_MAX} نویسه است.`);
  }
  let reaction;
  if (b.reaction !== undefined && b.reaction !== null && b.reaction !== '') {
    if (!REACTIONS.includes(b.reaction)) return fail('INVALID_REACTION', `واکنش نامعتبر است (${REACTIONS.join(' | ')}).`);
    reaction = b.reaction;
  }
  if (monthClosuresRepository.findClosedOverlapping(reportDate, reportDate).length > 0) return fail('MONTH_CLOSED', 'این روز در ماهِ بسته‌شده است و فقط‌خواندنی است.');
  if (!logsRepo.listByUserDate(subject.id, reportDate).length) return fail('NO_REPORT', 'این کارمند برای آن روز گزارشی ثبت نکرده است.');

  const before = reviewsRepo.find(reviewer.id, subject.id, reportDate);
  const row = reviewsRepo.upsert({ reviewerId: reviewer.id, subjectUserId: subject.id, reportDate, comment: comment === undefined ? null : comment, reaction: reaction === undefined ? null : reaction });
  const changed = !before || (comment !== undefined && comment !== before.comment) || (reaction !== undefined && reaction !== before.reaction);
  if (changed) {
    auditRepository.logEvent({ userId: reviewer.id, action: 'report_reviewed', ipAddress: ip, details: { subjectUserId: subject.id, reportDate, hasComment: !!row.comment, reaction: row.reaction || null, firstTime: !before } });
  }
  if (comment && (!before || comment !== before.comment)) { // کامنتِ تازه/تغییرکرده ⇒ اعلان به کارمند (ضدخطا)
    try {
      require('./notificationEvents').reportCommented({ reviewer, subject, reportDate, comment: row.comment, reaction: row.reaction });
    } catch (err) {
      console.error('[teamReview] اعلان کامنت ناموفق (نادیده گرفته شد):', sanitizeText(err && err.message ? err.message : String(err), 200));
    }
  }
  const settings = settingsRepository.getAll();
  try { // تسکِ «امروز» سرپرست ممکن است با همین مشاهده کامل شده باشد
    ensureTask(reviewer, cur, settings);
    syncCompletion(reviewer, cur, settings);
  } catch (err) {
    console.error('[teamReview] همگام‌سازی پس از مشاهده ناموفق (نادیده گرفته شد):', sanitizeText(err && err.message ? err.message : String(err), 200));
  }
  return { ok: true, review: presentReview(row), state: reviewState(reviewer, reportDate, settings) };
}

module.exports = { teamOf, reviewDateFor, reviewState, reportSummaryOf, gateInfo, statusOf, ERROR_STATUS, ensureTask, syncCompletion, prepareDay, getTeamReview, markReviewed, isReviewer, REVIEW_KEY, TITLE, REACTIONS, COMMENT_MAX, MAX_LOOKBACK_DAYS };

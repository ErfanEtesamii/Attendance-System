// صفحه‌ی «گزارش‌های تیم» (D10): برنامه‌ی هفتگی · گزارش روزانه · معطل‌مانده‌ها · بررسی‌نشده‌ها.
// اسکوپ نقش (سمت سرور): کارمند فقط خودش | سرپرست فقط زیردست‌های مستقیمش | ادمین و hr همه‌ی کاربران فعالِ دیگر (hr فقط‌خواندنی).
// «مشاهده شد»/کامنت از مسیرهای D9 (teamReviewService.markReviewed) انجام می‌شود؛ این ماژول فقط می‌خواند.
const settingsRepository = require('../repositories/settingsRepository');
const usersRepository = require('../repositories/usersRepository');
const plansRepo = require('../repositories/weeklyPlanRepository');
const logsRepo = require('../repositories/taskLogRepository');
const reviewsRepo = require('../repositories/reportReviewRepository');
const attendanceRepository = require('../repositories/attendanceRepository');
const calendarService = require('../engine/calendarService');
const teamReview = require('./teamReviewService');
const { addDays, dayNumber } = require('../utils/shiftDay');

const TABS = ['daily', 'plan', 'stuck', 'unreviewed'];
const STUCK_MIN = 2; // دو بار پشت‌سرهم منتقل‌شده
const STUCK_LOOKBACK_DAYS = 35;
const MAX_LOOKBACK_DAYS = teamReview.MAX_LOOKBACK_DAYS;

const fail = (code, error) => ({ ok: false, code, error });
const ERROR_STATUS = { FORBIDDEN: 403, SUBJECT_NOT_IN_SCOPE: 403 };
const statusOf = (code) => ERROR_STATUS[code] || 400;

/** کاربرانی که viewer حق دیدن گزارششان را دارد. */
function scopeUsers(viewer) {
  if (!viewer) return [];
  if (viewer.role === 'manager') return teamReview.teamOf(viewer);
  if (viewer.role === 'admin' || viewer.role === 'hr') return usersRepository.listUsers({ onlyActive: true }).filter((u) => u.id !== viewer.id);
  return [viewer]; // employee و هر نقش ناشناخته: فقط خودش
}

const canWrite = (viewer) => teamReview.isReviewer(viewer);

function notDoneItems(summary) {
  return summary.items.filter((i) => !i.outOfPlan && i.status !== 'done');
}

function dailyRow(viewer, member, date, settings) {
  const logs = logsRepo.listByUserDate(member.id, date);
  const hasReport = logs.length > 0;
  let status;
  const reviews = reviewsRepo.listBySubjectDate(member.id, date);
  const mine = reviews.find((r) => r.reviewer_id === viewer.id) || null;
  const review = mine || reviews[0] || null;
  if (hasReport) status = (canWrite(viewer) ? mine : review) ? 'reviewed' : 'unreviewed';
  else {
    const cal = calendarService.getCalendarDay(member, date, { settings });
    status = cal.isWorkingDay && !calendarService.fullyOnApprovedLeave(member, date, cal) ? 'no_report' : 'off';
  }
  const row = { userId: member.id, fullName: member.full_name, department: member.department || null, status, hasReport, reviewedAt: review ? review.reviewed_at : null, comment: review ? review.comment || null : null, reaction: review ? review.reaction || null : null };
  if (hasReport) {
    const s = teamReview.reportSummaryOf(member.id, date);
    row.summary = { total: s.total, done: s.done, partial: s.partial, notDone: s.notDone, extra: s.extra, percent: s.percent };
    row.notDone = notDoneItems(s).map((i) => ({ title: i.title, status: i.status, reasonCode: i.reasonCode, reasonText: i.reasonText }));
    row.extras = s.items.filter((i) => i.outOfPlan).map((i) => i.title);
  }
  return row;
}

function planRow(member, weekStart) {
  const plan = plansRepo.findByUserWeek(member.id, weekStart);
  const row = { userId: member.id, fullName: member.full_name, department: member.department || null, weekStart, status: plan ? plan.status : 'none', submitted: !!(plan && plan.status === 'submitted'), tasks: [] };
  if (plan) {
    row.tasks = plansRepo.listTasks(plan.id).filter((t) => !t.is_system).map((t) => ({ title: t.title, plannedDate: t.planned_date || null, priority: t.priority }));
    row.supervisorComment = plan.supervisor_comment || null;
  }
  return row;
}

/** تسک‌هایی که دست‌کم STUCK_MIN بار پشت‌سرهم منتقل شده‌اند و هنوز done نشده‌اند. */
function stuckRows(users, cur) {
  const logs = logsRepo.listRangeWithTasks(users.map((u) => u.id), addDays(cur, -STUCK_LOOKBACK_DAYS), cur);
  const byTask = new Map();
  for (const l of logs) {
    if (l.task_is_system || l.task_deleted_at) continue;
    if (!byTask.has(l.task_id)) byTask.set(l.task_id, []);
    byTask.get(l.task_id).push(l);
  }
  const byUser = new Map(users.map((u) => [u.id, { userId: u.id, fullName: u.full_name, department: u.department || null, tasks: [] }]));
  for (const arr of byTask.values()) {
    if (arr.some((l) => l.status === 'done')) continue;
    let n = 0;
    for (let i = arr.length - 1; i >= 0; i -= 1) { if (arr[i].reschedule_to && arr[i].reschedule_to !== 'drop') n += 1; else break; }
    if (n >= STUCK_MIN) {
      const last = arr[arr.length - 1];
      byUser.get(last.user_id).tasks.push({ taskId: last.task_id, title: last.task_title, carriedCount: n, lastDate: last.log_date, lastReason: last.reason_code || null, rescheduleTo: last.reschedule_to });
    }
  }
  return [...byUser.values()].filter((r) => r.tasks.length);
}

function teamSummary(rows) {
  const withSum = rows.filter((r) => r.summary && r.summary.total);
  const total = withSum.reduce((a, r) => a + r.summary.total, 0);
  const done = withSum.reduce((a, r) => a + r.summary.done, 0);
  return { members: rows.length, reports: rows.filter((r) => r.hasReport).length, noReport: rows.filter((r) => r.status === 'no_report').length, unreviewed: rows.filter((r) => r.status === 'unreviewed').length, percent: total ? Math.round((done / total) * 100) : null };
}

/**
 * input: { tab, date?, weekStart?, userId? }
 * ⇒ { ok, tab, readOnly, scope, ... } یا { ok:false, code, error }.
 */
function getReports(viewer, input = {}, { now = new Date() } = {}) {
  if (!viewer) return fail('FORBIDDEN', 'دسترسی ندارید.');
  const tab = input.tab || 'daily';
  if (!TABS.includes(tab)) return fail('INVALID_TAB', `tab باید یکی از ${TABS.join(' | ')} باشد.`);
  const settings = settingsRepository.getAll();
  const cur = attendanceRepository.currentRecordDate(viewer.id, now);
  let users = scopeUsers(viewer);
  if (input.userId !== undefined && input.userId !== null && input.userId !== '') {
    const id = Number(input.userId);
    const one = users.find((u) => u.id === id);
    if (!Number.isInteger(id) || !one) return fail('SUBJECT_NOT_IN_SCOPE', 'این کاربر در محدوده‌ی دسترسی شما نیست.');
    users = [one];
  }
  const base = { ok: true, tab, readOnly: !canWrite(viewer), scope: viewer.role === 'employee' ? 'self' : (viewer.role === 'manager' ? 'team' : 'all'), today: cur };

  if (tab === 'plan') {
    let weekStart = input.weekStart;
    if (weekStart === undefined || weekStart === '' || weekStart === null) weekStart = calendarService.weekStartOf(cur, settings.weekStartDay);
    else if (typeof weekStart !== 'string' || dayNumber(weekStart) === null) return fail('INVALID_DATE', 'weekStart نامعتبر است (YYYY-MM-DD).');
    else weekStart = calendarService.weekStartOf(weekStart, settings.weekStartDay);
    const rows = users.map((u) => planRow(u, weekStart));
    return { ...base, weekStart, members: rows, summary: { members: rows.length, submitted: rows.filter((r) => r.submitted).length, missing: rows.filter((r) => !r.submitted).length } };
  }
  if (tab === 'stuck') return { ...base, members: stuckRows(users, cur) };

  // daily / unreviewed
  let date = input.date;
  if (date === undefined || date === '' || date === null) {
    date = calendarService.getPreviousWorkingDay(viewer, cur, { settings });
    if (!date) return { ...base, date: null, members: [], summary: teamSummary([]) };
  } else {
    if (typeof date !== 'string' || dayNumber(date) === null) return fail('INVALID_DATE', 'تاریخ نامعتبر است (قالب YYYY-MM-DD).');
    if (date > cur) return fail('DATE_IN_FUTURE', 'گزارشِ روزِ آینده وجود ندارد.');
    if (date < addDays(cur, -MAX_LOOKBACK_DAYS)) return fail('DATE_TOO_OLD', `فقط گزارش‌های ${MAX_LOOKBACK_DAYS} روز اخیر قابل مشاهده است.`);
  }
  let rows = users.map((u) => dailyRow(viewer, u, date, settings));
  const summary = teamSummary(rows);
  if (tab === 'unreviewed') rows = canWrite(viewer) ? rows.filter((r) => r.status === 'unreviewed') : [];
  return { ...base, date, members: rows, summary };
}

module.exports = { getReports, scopeUsers, stuckRows, statusOf, TABS, STUCK_MIN };

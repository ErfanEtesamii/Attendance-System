// خروجی XLSX برنامه/گزارش تسک‌ها + شاخص‌های مدیریتی (D13).
// اسکوپ نقش از teamReportsService.scopeUsers (کارمند خودش، سرپرست تیم، admin/hr همه). فقط ساخت داده؛ ارسال و audit در route (sendSheets؛
// محافظت exportSafety — خنثی‌سازی formula injection — در buildWorkbook/sendCsv اعمال می‌شود، پس متن‌های آزاد کاربر (عنوان تسک/علت/کامنت) امن‌اند).
const settingsRepository = require('../repositories/settingsRepository');
const usersRepository = require('../repositories/usersRepository');
const plansRepo = require('../repositories/weeklyPlanRepository');
const logsRepo = require('../repositories/taskLogRepository');
const reviewsRepo = require('../repositories/reportReviewRepository');
const calendarService = require('../engine/calendarService');
const { planSatisfied } = require('./planGateService');
const teamReports = require('./teamReportsService');
const { REASON_LABELS, STATUS_LABELS } = require('../content/reportLabels');
const { isoDateToJalaliString } = require('../utils/jalali');
const { todayInZone } = require('../utils/time');
const { addDays, dayNumber, dayDiff } = require('../utils/shiftDay');

const MAX_RANGE_DAYS = 93;
const OUT_OF_PLAN_KEY = 'out_of_plan';
const fail = (code, error) => ({ ok: false, code, error });
const jal = (iso) => { try { return iso ? isoDateToJalaliString(iso) : ''; } catch (_) { return ''; } };
const PLAN_STATUS = { submitted: 'ثبت‌شده', draft: 'پیش‌فرض/پیش‌نویس', none: 'ثبت نشده' };
const PRIORITY = { low: 'کم', normal: 'عادی', high: 'بالا' };

function resolveRange(input, settings, now) {
  const today = todayInZone(settings.timezone, now);
  const to = input.to || today;
  const from = input.from || addDays(to, -29);
  if (dayNumber(from) === null || dayNumber(to) === null) return fail('INVALID_DATE', 'from و to باید به‌صورت YYYY-MM-DD باشند.');
  if (from > to) return fail('INVALID_RANGE', 'from نباید بعد از to باشد.');
  if (dayDiff(to, from) + 1 > MAX_RANGE_DAYS) return fail('RANGE_TOO_LONG', `بازه حداکثر ${MAX_RANGE_DAYS} روز است.`);
  return { ok: true, from, to };
}

function scoped(viewer, userId) {
  let users = teamReports.scopeUsers(viewer);
  if (userId !== undefined && userId !== null && userId !== '') {
    users = users.filter((u) => String(u.id) === String(userId));
    if (!users.length) return fail('SUBJECT_NOT_IN_SCOPE', 'این کاربر در محدوده‌ی دسترسی شما نیست.');
  }
  return { ok: true, users };
}

/** @returns {{ ok, from, to, sheets: Array<{name, headers, rows}>, count }} */
function buildTaskSheets(viewer, input = {}, { now = new Date() } = {}) {
  const settings = settingsRepository.getAll();
  const range = resolveRange(input, settings, now);
  if (!range.ok) return range;
  const sc = scoped(viewer, input.userId);
  if (!sc.ok) return sc;
  const { from, to } = range;
  const users = sc.users;
  const byId = new Map(users.map((u) => [u.id, u]));
  const ids = users.map((u) => u.id);

  // شیت ۱: برنامه‌ی هفتگی
  const wFrom = calendarService.weekStartOf(from, settings.weekStartDay);
  const wTo = calendarService.weekStartOf(to, settings.weekStartDay);
  const planRows = [];
  for (const u of users) {
    for (const plan of plansRepo.listByUserRange(u.id, wFrom, wTo)) {
      const tasks = plansRepo.listTasks(plan.id).filter((t) => !t.is_system);
      const head = [plan.week_start_date, jal(plan.week_start_date), u.full_name || '', u.department || '', PLAN_STATUS[plan.status] || plan.status];
      if (!tasks.length) planRows.push([...head, '', '', '', '']);
      tasks.forEach((t) => planRows.push([...head, t.title, t.planned_date || '', t.planned_date ? jal(t.planned_date) : 'هر روز', PRIORITY[t.priority] || t.priority]));
    }
  }
  // شیت ۲: گزارش روزانه
  const logs = logsRepo.listRangeWithTasks(ids, from, to).filter((l) => !l.task_is_system);
  const reviewCache = new Map();
  const reviewOf = (uid, date) => {
    const k = `${uid}|${date}`;
    if (!reviewCache.has(k)) {
      const rs = reviewsRepo.listBySubjectDate(uid, date);
      reviewCache.set(k, rs.find((r) => r.reviewer_id === viewer.id) || rs[0] || null);
    }
    return reviewCache.get(k);
  };
  const dailyRows = logs.map((l) => {
    const u = byId.get(l.user_id);
    const rv = reviewOf(l.user_id, l.log_date);
    return [l.log_date, jal(l.log_date), u ? u.full_name : '', u ? (u.department || '') : '', l.task_title, l.task_system_key === OUT_OF_PLAN_KEY ? 'بله' : 'خیر',
      STATUS_LABELS[l.status] || l.status, l.reason_code ? (REASON_LABELS[l.reason_code] || l.reason_code) : '', l.reason_text || '',
      l.reschedule_to === 'drop' ? 'حذف شد' : (l.reschedule_to || ''), l.answered_late ? 'بله' : 'خیر', rv ? 'بله' : 'خیر', rv && rv.comment ? rv.comment : ''];
  });
  // شیت ۳: خلاصه به‌ازای فرد
  const summaryRows = users.map((u) => {
    const mine = logs.filter((l) => l.user_id === u.id);
    const planned = mine.filter((l) => l.task_system_key !== OUT_OF_PLAN_KEY);
    const done = planned.filter((l) => l.status === 'done').length;
    return [u.full_name || '', u.department || '', new Set(mine.map((l) => l.log_date)).size, planned.length, done, planned.length ? Math.round((done / planned.length) * 100) : '', mine.length - planned.length];
  });
  return {
    ok: true, from, to, count: planRows.length + dailyRows.length,
    sheets: [
      { name: 'خلاصه', headers: ['نام', 'دپارتمان', 'روزهای دارای گزارش', 'تسک برنامه‌ریزی‌شده', 'انجام‌شده', 'درصد انجام', 'خارج از برنامه'], rows: summaryRows },
      { name: 'برنامه هفتگی', headers: ['شروع هفته', 'شروع هفته (شمسی)', 'نام', 'دپارتمان', 'وضعیت برنامه', 'تسک', 'روز برنامه', 'روز برنامه (شمسی)', 'اولویت'], rows: planRows },
      { name: 'گزارش روزانه', headers: ['تاریخ', 'تاریخ (شمسی)', 'نام', 'دپارتمان', 'تسک', 'خارج از برنامه', 'وضعیت', 'علت', 'توضیح علت', 'انتقال', 'گزارش دیرهنگام', 'مشاهده شد', 'کامنت'], rows: dailyRows },
    ],
  };
}

function nextWorkingDay(user, date, settings) {
  for (let i = 1; i <= 14; i += 1) {
    const d = addDays(date, i);
    if (calendarService.getCalendarDay(user, d, { settings }).isWorkingDay) return d;
  }
  return addDays(date, 1);
}

function localDate(iso, tz) {
  const d = new Date(/^\d{4}-\d{2}-\d{2} \d/.test(iso) ? `${iso.replace(' ', 'T')}Z` : iso);
  return Number.isNaN(d.getTime()) ? null : todayInZone(tz, d);
}

/**
 * شاخص‌های مدیریتی (اسکوپ نقش):
 *  teams[]: به‌ازای هر سرپرست — نرخ انجام تسک تیم، تعداد برنامه‌ریزی/انجام
 *  reviewers[]: نرخ «بررسی به‌موقع» = سهم گزارش‌های اعضا که تا پایانِ روز کاریِ بعدی مشاهده شده‌اند
 *  unplanned: افراد با برنامه‌ی هفته‌ی بعدِ برآورده‌نشده (و تعدادشان)
 *  managerConfiguredNotSubmitted: برنامه‌ی تنظیم‌شده توسط سرپرست که کارمند هنوز ارسال نهایی نکرده است
 */
function taskKpis(viewer, input = {}, { now = new Date() } = {}) {
  const settings = settingsRepository.getAll();
  const range = resolveRange(input, settings, now);
  if (!range.ok) return range;
  const { from, to } = range;
  const users = teamReports.scopeUsers(viewer);
  const ids = users.map((u) => u.id);
  const all = usersRepository.listUsers({ onlyActive: true });
  const byId = new Map(all.map((u) => [u.id, u]));
  const logs = logsRepo.listRangeWithTasks(ids, from, to).filter((l) => !l.task_is_system);
  const bossOf = (u) => { const b = u.manager_id ? byId.get(u.manager_id) : null; return b && b.is_active !== 0 ? b : null; };

  const teams = new Map();
  const teamOf = (u) => { const b = bossOf(u); const key = b ? b.id : 0; if (!teams.has(key)) teams.set(key, { managerId: b ? b.id : null, managerName: b ? b.full_name : 'بدون سرپرست', members: new Set(), planned: 0, done: 0 }); return teams.get(key); };
  users.forEach((u) => teamOf(u).members.add(u.id));
  for (const l of logs) {
    if (l.task_system_key === OUT_OF_PLAN_KEY) continue;
    const t = teamOf(byId.get(l.user_id) || { manager_id: null });
    t.planned += 1; if (l.status === 'done') t.done += 1;
  }
  const teamRows = [...teams.values()].map((t) => ({ managerId: t.managerId, managerName: t.managerName, members: t.members.size, planned: t.planned, done: t.done, completionRate: t.planned ? Math.round((t.done / t.planned) * 100) : null }));

  // بررسی به‌موقع
  const rev = new Map();
  const seen = new Set();
  for (const l of logs) {
    const k = `${l.user_id}|${l.log_date}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const u = byId.get(l.user_id);
    const boss = u && bossOf(u);
    if (!boss) continue;
    if (!rev.has(boss.id)) rev.set(boss.id, { reviewerId: boss.id, reviewerName: boss.full_name, reports: 0, reviewed: 0, onTime: 0 });
    const r = rev.get(boss.id);
    r.reports += 1;
    const row = reviewsRepo.find(boss.id, u.id, l.log_date);
    if (row) {
      r.reviewed += 1;
      const when = localDate(row.reviewed_at, settings.timezone);
      if (when && when <= nextWorkingDay(u, l.log_date, settings)) r.onTime += 1;
    }
  }
  const reviewerRows = [...rev.values()].map((r) => ({ ...r, onTimeRate: r.reports ? Math.round((r.onTime / r.reports) * 100) : null }));

  const nextWeek = addDays(calendarService.weekStartOf(to, settings.weekStartDay), 7);
  const managerConfiguredNotSubmitted = [];
  const unplanned = users.filter((u) => {
    const p = plansRepo.findByUserWeek(u.id, nextWeek);
    if (p && p.status !== 'submitted' && plansRepo.countManagerTasks(p.id) > 0) {
      managerConfiguredNotSubmitted.push({ userId: u.id, fullName: u.full_name, department: u.department || null });
    }
    return !planSatisfied(u.id, nextWeek, settings.planMinTasks);
  }).map((u) => ({ userId: u.id, fullName: u.full_name, department: u.department || null }));

  return {
    ok: true, from, to, nextWeekStart: nextWeek, teams: teamRows, reviewers: reviewerRows,
    unplanned: { count: unplanned.length, users: unplanned },
    managerConfiguredNotSubmitted: { count: managerConfiguredNotSubmitted.length, users: managerConfiguredNotSubmitted },
  };
}

/**
 * گزارش کامل تسک‌ها برای خروجی Excel — به‌ازای هر تسکِ هر روز: وضعیت (انجام شد/نیمه‌کاره/انجام نشد/پاسخ داده نشده)،
 * توضیحِ انجام (note)، علت و توضیح علتِ انجام‌نشدن. فیلتر: userId (فرد) | managerId (تیم = اعضای مستقیم یک سرپرست) | هیچ‌کدام (کل دامنه‌ی دسترسی).
 * شیت‌ها: «ریز تسک‌ها» (CSV همین شیت است)، «خلاصه افراد»، «خلاصه تیم‌ها» (آخرین ردیف = «کل مجموعه»).
 * «پاسخ داده نشده» = تسک برنامه‌ی روزِ مشخص (planned_date) که تا امروز گذشته و برایش پاسخی نیست؛ تسک‌های «هر روز» (بدون planned_date) شمرده نمی‌شوند.
 * اسکوپ نقش با teamReports.scopeUsers: مدیر کل/hr همه، سرپرست تیم خودش، کارمند فقط خودش. فقط ساخت داده؛ ارسال و audit در route.
 */
function buildTaskReportSheets(viewer, input = {}, { now = new Date() } = {}) {
  const settings = settingsRepository.getAll();
  const range = resolveRange(input, settings, now);
  if (!range.ok) return range;
  const sc = scoped(viewer, input.userId);
  if (!sc.ok) return sc;
  const { from, to } = range;
  const today = todayInZone(settings.timezone, now);
  let users = sc.users;
  if (input.managerId !== undefined && input.managerId !== null && input.managerId !== '') {
    users = users.filter((u) => String(u.manager_id) === String(input.managerId));
    if (!users.length) return fail('SUBJECT_NOT_IN_SCOPE', 'این تیم در محدوده‌ی دسترسی شما نیست یا عضوی ندارد.');
  }
  const byId = new Map(users.map((u) => [u.id, u]));
  const ids = users.map((u) => u.id);
  const everyone = new Map(usersRepository.listUsers({}).map((u) => [u.id, u]));
  const teamName = (u) => { const b = u.manager_id ? everyone.get(u.manager_id) : null; return b ? `تیم ${b.full_name}` : 'بدون سرپرست'; };
  const yesNo = (v) => (v ? 'بله' : 'خیر');

  const rows = []; // { date, userId, cells }
  const answered = new Set(); // `${userId}|${taskId}|${date}`
  for (const l of logsRepo.listRangeWithTaskDetails(ids, from, to)) {
    if (l.task_is_system) continue;
    const u = byId.get(l.user_id);
    answered.add(`${l.user_id}|${l.task_id}|${l.log_date}`);
    rows.push({
      date: l.log_date, userId: l.user_id, status: l.status, extra: l.task_system_key === OUT_OF_PLAN_KEY,
      cells: [l.log_date, jal(l.log_date), u ? u.full_name || '' : '', u ? u.department || '' : '', u ? teamName(u) : '', l.task_title, l.task_description || '',
        PRIORITY[l.task_priority] || l.task_priority || '', STATUS_LABELS[l.status] || l.status, l.note || '',
        l.reason_code ? (REASON_LABELS[l.reason_code] || l.reason_code) : '', l.reason_text || '',
        l.reschedule_to === 'drop' ? 'حذف شد' : (l.reschedule_to || ''), yesNo(l.task_system_key === OUT_OF_PLAN_KEY), yesNo(l.answered_late)],
    });
  }
  // تسک‌های برنامه‌ی روزِ مشخص که تا امروز گذشته‌اند و پاسخ ندارند
  const wFrom = calendarService.weekStartOf(from, settings.weekStartDay);
  const wTo = calendarService.weekStartOf(to, settings.weekStartDay);
  for (const u of users) {
    for (const plan of plansRepo.listByUserRange(u.id, wFrom, wTo)) {
      for (const t of plansRepo.listTasks(plan.id)) {
        if (t.is_system || !t.planned_date || t.planned_date < from || t.planned_date > to || t.planned_date > today) continue;
        if (answered.has(`${u.id}|${t.id}|${t.planned_date}`)) continue;
        rows.push({
          date: t.planned_date, userId: u.id, status: 'unanswered', extra: false,
          cells: [t.planned_date, jal(t.planned_date), u.full_name || '', u.department || '', teamName(u), t.title, t.description || '',
            PRIORITY[t.priority] || t.priority || '', 'پاسخ داده نشده', '', '', '', '', 'خیر', 'خیر'],
        });
      }
    }
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.cells[2] || '').localeCompare(b.cells[2] || '', 'fa')));

  const tally = (list) => {
    const planned = list.filter((r) => !r.extra);
    const c = (st) => planned.filter((r) => r.status === st).length;
    const done = c('done');
    return { total: planned.length, done, partial: c('partial'), notDone: c('not_done'), unanswered: c('unanswered'), percent: planned.length ? Math.round((done / planned.length) * 100) : '', extra: list.length - planned.length };
  };
  const personRows = users.map((u) => {
    const t = tally(rows.filter((r) => r.userId === u.id));
    return [u.full_name || '', u.department || '', teamName(u), t.total, t.done, t.partial, t.notDone, t.unanswered, t.percent, t.extra];
  });
  const teamKeys = [...new Set(users.map(teamName))].sort((a, b) => a.localeCompare(b, 'fa'));
  const teamRows = teamKeys.map((k) => {
    const mem = users.filter((u) => teamName(u) === k).map((u) => u.id);
    const t = tally(rows.filter((r) => mem.includes(r.userId)));
    return [k, mem.length, t.total, t.done, t.partial, t.notDone, t.unanswered, t.percent, t.extra];
  });
  const all = tally(rows);
  teamRows.push(['کل مجموعه', users.length, all.total, all.done, all.partial, all.notDone, all.unanswered, all.percent, all.extra]);

  return {
    ok: true, from, to, count: rows.length,
    sheets: [
      { name: 'ریز تسک‌ها', headers: ['تاریخ', 'تاریخ (شمسی)', 'نام', 'دپارتمان', 'تیم', 'تسک', 'توضیح تسک', 'اولویت', 'وضعیت', 'توضیح انجام', 'علت انجام‌نشدن', 'توضیح علت', 'انتقال', 'خارج از برنامه', 'گزارش دیرهنگام'], rows: rows.map((r) => r.cells) },
      { name: 'خلاصه افراد', headers: ['نام', 'دپارتمان', 'تیم', 'کل تسک‌ها', 'انجام‌شده', 'نیمه‌کاره', 'انجام‌نشده', 'پاسخ داده نشده', 'درصد انجام', 'خارج از برنامه'], rows: personRows },
      { name: 'خلاصه تیم‌ها', headers: ['تیم', 'تعداد اعضا', 'کل تسک‌ها', 'انجام‌شده', 'نیمه‌کاره', 'انجام‌نشده', 'پاسخ داده نشده', 'درصد انجام', 'خارج از برنامه'], rows: teamRows },
    ],
  };
}

module.exports = { buildTaskSheets, buildTaskReportSheets, taskKpis, resolveRange, MAX_RANGE_DAYS };

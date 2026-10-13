// گزارش شبانه‌ی تسک‌ها برای سرپرست (D11) — ساخت متن پیام‌ها (خالص از بات؛ ارسال در nightlyReview.js).
// گیرنده‌ها: هر کاربر غیرادمین به «سرپرست مستقیمِ فعالِ» خودش گزارش می‌شود (سرپرست‌ها ⇒ مدیر بالادست)؛ بدون سرپرست ⇒ همه‌ی ادمین‌ها.
// ادمین‌ها علاوه بر آن «خلاصه‌ی کل شرکت» (درصد به تفکیک تیم، تیم‌های بدون بررسی، افراد بدون برنامه) می‌گیرند.
// سقف تلگرام ۴۰۹۶ نویسه: بلوک‌ها بدون شکستن وسط یک عضو تقسیم می‌شوند (حداکثر MAX_PARTS پیام)؛ باقی ⇒ خلاصه + دکمه‌ی پنل.
const usersRepository = require('../repositories/usersRepository');
const settingsRepository = require('../repositories/settingsRepository');
const plansRepo = require('../repositories/weeklyPlanRepository');
const logsRepo = require('../repositories/taskLogRepository');
const reviewsRepo = require('../repositories/reportReviewRepository');
const calendarService = require('../engine/calendarService');
const teamReports = require('./teamReportsService');
const teamReview = require('./teamReviewService');
const taskReportService = require('./taskReportService');
const { REASON_LABELS } = require('../content/reportLabels');
const { isoDateToJalaliString } = require('../utils/jalali');
const { addDays } = require('../utils/shiftDay');

const TG_LIMIT = 4096;
const SAFE_LIMIT = 3900; // حاشیه برای عنوان/پانویس
const MAX_PARTS = 3;
const MAX_ITEMS_PER_MEMBER = 5;
const MAX_COMMENT_BUTTONS = 8;
const OUT_OF_PLAN_KEY = 'out_of_plan';

const jd = (iso) => { try { return isoDateToJalaliString(iso) || iso; } catch (_) { return iso; } };
const pct = (done, total) => (total ? Math.round((done / total) * 100) : null);

/** گزارش یک عضو برای روز date؛ null اگر آن روز برایش کاری/غیرمرخصی نبوده. */
function memberReport(member, date, settings) {
  const cal = calendarService.getCalendarDay(member, date, { settings });
  if (!cal.isWorkingDay || calendarService.fullyOnApprovedLeave(member, date, cal)) return null;
  const logs = logsRepo.listByUserDate(member.id, date);
  const items = [];
  for (const l of logs) {
    const t = plansRepo.findTask(l.task_id);
    if (t) items.push({ log: l, task: t });
  }
  const planned = items.filter((i) => i.task.system_key !== OUT_OF_PLAN_KEY && !i.task.is_system);
  const done = planned.filter((i) => i.log.status === 'done').length;
  const notDone = planned.filter((i) => i.log.status !== 'done').map((i) => ({
    title: i.task.title, status: i.log.status, reason: i.log.reason_code ? (REASON_LABELS[i.log.reason_code] || i.log.reason_code) : null, reasonCode: i.log.reason_code,
    carry: i.log.reschedule_to === 'drop' ? 'حذف شد' : (i.log.reschedule_to ? `منتقل به ${jd(i.log.reschedule_to)}` : 'بدون انتقال'),
  }));
  const weekStart = calendarService.weekStartOf(date, settings.weekStartDay);
  const planDay = calendarService.getPlanDay(member, weekStart, { settings });
  const nextPlan = plansRepo.findByUserWeek(member.id, addDays(weekStart, 7));
  const hasReport = logs.length > 0;
  const planMissing = settings.planGateMode !== 'off' && planDay === date && !(nextPlan && nextPlan.status === 'submitted');
  // ویژگی‌ی برنامه/گزارش برای این عضو «در استفاده» نیست (نه گزارشی، نه تسکِ انتظار، نه الزام برنامه) ⇒ نویز نمی‌سازیم
  if (!hasReport && !planMissing && taskReportService.buildList(member, date, settings).length === 0) return null;
  return {
    member, hasReport, total: planned.length, done, percent: pct(done, planned.length), notDone,
    extra: items.length - planned.length,
    planMissing,
    reviewed: null, // پر می‌شود توسط buildFor
  };
}

function memberBlock(r, stuckTasks) {
  const lines = [];
  const head = r.hasReport
    ? (r.total ? `• ${r.member.full_name} — ${r.done} از ${r.total} انجام شد (${r.percent}٪)` : `• ${r.member.full_name} — گزارش ثبت شد (فقط کار خارج از برنامه)`)
    : `• ${r.member.full_name} — گزارش نداده ⚠️`;
  lines.push(head);
  r.notDone.slice(0, MAX_ITEMS_PER_MEMBER).forEach((n) => lines.push(`   ✗ ${n.title}${n.reason ? ` — ${n.reason}` : ''} (${n.carry})`));
  if (r.notDone.length > MAX_ITEMS_PER_MEMBER) lines.push(`   … و ${r.notDone.length - MAX_ITEMS_PER_MEMBER} مورد دیگر`);
  if (r.extra > 0) lines.push(`   ➕ ${r.extra} کار خارج از برنامه`);
  (stuckTasks || []).slice(0, 3).forEach((t) => lines.push(`   🔴 معطل‌مانده: ${t.title} (${t.carriedCount} بار منتقل شده)`));
  if (r.planMissing) lines.push('   ⚠️ برنامه‌ی هفته‌ی بعد ثبت نشده');
  return lines.join('\n');
}

function topReasons(reports, n = 3) {
  const c = new Map();
  reports.forEach((r) => r.notDone.forEach((x) => { if (x.reasonCode) c.set(x.reasonCode, (c.get(x.reasonCode) || 0) + 1); }));
  return [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${REASON_LABELS[k] || k} (${v})`);
}

function summaryLines(reports) {
  const total = reports.reduce((a, r) => a + r.total, 0);
  const done = reports.reduce((a, r) => a + r.done, 0);
  const lines = [`📊 خلاصه‌ی تیم: ${total ? `${pct(done, total)}٪ انجام (${done} از ${total})` : 'تسکی ثبت نشده'}`];
  const reasons = topReasons(reports);
  if (reasons.length) lines.push(`علت‌های پرتکرار: ${reasons.join('، ')}`);
  return lines;
}

/** تقسیم بلوک‌ها به پیام‌های ≤ SAFE_LIMIT؛ بیش از MAX_PARTS ⇒ بقیه خلاصه می‌شود. ⇒ { parts, omitted } */
function pack(header, blocks, footerLines = []) {
  const parts = [];
  let cur = header;
  let used = 0;
  for (let i = 0; i < blocks.length; i += 1) {
    const b = blocks[i];
    if (cur.length + b.length + 2 > SAFE_LIMIT && cur !== header) {
      parts.push(cur);
      if (parts.length >= MAX_PARTS) return { parts: closeWith(parts, blocks.length - used, footerLines), omitted: blocks.length - used };
      cur = `${header} (ادامه)`;
    }
    cur += `\n\n${b.length > SAFE_LIMIT ? `${b.slice(0, SAFE_LIMIT - 20)}…` : b}`;
    used += 1;
  }
  const withFooter = footerLines.length ? `${cur}\n\n${footerLines.join('\n')}` : cur;
  if (withFooter.length <= SAFE_LIMIT) parts.push(withFooter);
  else if (parts.length < MAX_PARTS - 1) { parts.push(cur); parts.push(footerLines.join('\n').slice(0, TG_LIMIT - 1)); } // خلاصه در پیام جدا
  else parts.push(`${withFooter.slice(0, TG_LIMIT - 2)}…`);
  return { parts: parts.slice(0, MAX_PARTS), omitted: 0 };
}

function closeWith(parts, omitted, footerLines) {
  const last = parts.length - 1;
  parts[last] = `${parts[last]}\n\n… و ${omitted} عضو دیگر — جزئیات در «🖥 گزارش کامل در پنل»${footerLines.length ? `\n\n${footerLines.join('\n')}` : ''}`;
  return parts;
}

/** گیرنده → اعضایی که باید گزارششان را ببیند. */
function assignments() {
  const all = usersRepository.listUsers({ onlyActive: true });
  const byId = new Map(all.map((u) => [u.id, u]));
  const admins = all.filter((u) => u.role === 'admin');
  const map = new Map();
  const add = (reviewer, member) => { if (!map.has(reviewer.id)) map.set(reviewer.id, { reviewer, members: [] }); map.get(reviewer.id).members.push(member); };
  for (const u of all) {
    if (u.role === 'admin') continue;
    const boss = u.manager_id ? byId.get(u.manager_id) : null;
    if (boss && (boss.role === 'manager' || boss.role === 'admin') && boss.id !== u.id) add(boss, u);
    else admins.forEach((a) => add(a, u));
  }
  return map;
}

function companySummary(date, settings, allReports) {
  const byTeam = new Map(); // نام سرپرست → گزارش‌ها
  const all = usersRepository.listUsers({ onlyActive: true });
  const byId = new Map(all.map((u) => [u.id, u]));
  for (const r of allReports) {
    const boss = r.member.manager_id ? byId.get(r.member.manager_id) : null;
    const key = boss ? `تیم ${boss.full_name}` : 'بدون سرپرست';
    if (!byTeam.has(key)) byTeam.set(key, []);
    byTeam.get(key).push(r);
  }
  const lines = ['🏢 خلاصه‌ی کل شرکت'];
  for (const [team, rs] of byTeam) {
    const t = rs.reduce((a, r) => a + r.total, 0); const d = rs.reduce((a, r) => a + r.done, 0);
    lines.push(`• ${team}: ${t ? `${pct(d, t)}٪` : '—'} (${rs.length} نفر)`);
  }
  const noReview = [];
  for (const u of all.filter((x) => x.role === 'manager')) {
    const members = allReports.filter((r) => r.member.manager_id === u.id && r.hasReport);
    if (members.length && members.every((r) => !reviewsRepo.find(u.id, r.member.id, date))) noReview.push(u.full_name);
  }
  if (noReview.length) lines.push(`🔎 تیم‌های بدون بررسی: ${noReview.join('، ')}`);
  const noPlan = allReports.filter((r) => r.planMissing).map((r) => r.member.full_name);
  if (noPlan.length) lines.push(`⚠️ بدون برنامه‌ی هفته‌ی بعد: ${noPlan.join('، ')}`);
  const noReport = allReports.filter((r) => !r.hasReport).length;
  if (noReport) lines.push(`⚠️ گزارش‌نداده: ${noReport} نفر`);
  return lines;
}

/**
 * @returns {Array<{ reviewer, messages: string[], omitted: number, commentTargets: Array<{userId, name}>, date }>}
 */
function buildNightlyTaskReports(date, { settings = settingsRepository.getAll() } = {}) {
  const out = [];
  const assigned = assignments();
  const everyReport = [];
  const perReviewer = new Map();
  for (const [rid, { reviewer, members }] of assigned) {
    const reports = members.map((m) => memberReport(m, date, settings)).filter(Boolean);
    reports.forEach((r) => everyReport.push(r));
    perReviewer.set(rid, { reviewer, reports });
  }
  const stuckAll = new Map();
  teamReports.stuckRows(everyReport.map((r) => r.member), date).forEach((s) => stuckAll.set(s.userId, s.tasks));

  const admins = usersRepository.listUsers({ onlyActive: true }).filter((u) => u.role === 'admin');
  const targets = new Map([...perReviewer]);
  admins.forEach((a) => { if (!targets.has(a.id)) targets.set(a.id, { reviewer: a, reports: [] }); });

  for (const [, { reviewer, reports }] of targets) {
    const isAdmin = reviewer.role === 'admin';
    if (!reports.length && !isAdmin) continue;
    const header = `📋 گزارش تسک‌های امروز — ${jd(date)}`;
    const blocks = reports.map((r) => memberBlock(r, stuckAll.get(r.member.id)));
    const footer = reports.length ? summaryLines(reports) : [];
    if (isAdmin && everyReport.length) footer.push('', ...companySummary(date, settings, everyReport));
    if (!blocks.length && !footer.length) continue;
    const { parts, omitted } = pack(header, blocks, footer);
    out.push({
      reviewer, messages: parts, omitted, date,
      commentTargets: reports.filter((r) => r.hasReport).slice(0, MAX_COMMENT_BUTTONS).map((r) => ({ userId: r.member.id, name: r.member.full_name })),
    });
  }
  return out;
}

module.exports = { buildNightlyTaskReports, memberReport, memberBlock, pack, assignments, TG_LIMIT, SAFE_LIMIT, MAX_PARTS };

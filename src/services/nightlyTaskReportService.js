// گزارش شبانه‌ی تسک‌ها برای سرپرست (D11) — ساخت متن پیام‌ها (خالص از بات؛ ارسال در nightlyReview.js).
// گیرنده‌ها (H2): سرپرست ⇒ فقط اعضای مستقیم خودش؛ ادمین ⇒ همه‌ی کاربران فعالِ غیرادمین، گروه‌بندی‌شده به تفکیک «تیم <سرپرست>» / «بدون سرپرست»
// + «خلاصه‌ی کل شرکت» (درصد و تسک‌های بدون وضعیتِ هر تیم، تیم‌های بدون بررسی، افراد بدون برنامه) که همیشه در «آخرین پیام» می‌آید.
// شمارش (H1): taskDayTally — تسک‌های پاسخ‌نداده هم در total می‌آیند (دیگر «گزارش نداده» نداریم؛ «⏳ N بدون وضعیت»).
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
const { taskDayTally } = require('./taskDayTally');
const attendanceRepository = require('../repositories/attendanceRepository');
const { REASON_LABELS } = require('../content/reportLabels');
const { isoDateToJalaliString } = require('../utils/jalali');
const { addDays } = require('../utils/shiftDay');

const TG_LIMIT = 4096;
const SAFE_LIMIT = 3900; // حاشیه برای عنوان/پانویس
const MAX_PARTS = 3; // سرپرست؛ ادمین ⇒ تنظیم taskReportAdminMaxParts
const MAX_ITEMS_PER_MEMBER = 5;
const MAX_COMMENT_BUTTONS = 8;
const NO_TEAM = 'بدون سرپرست';
const MAX_FOOTER = 1800; // سقف پانویس (خلاصه‌ی تیم/شرکت) در آخرین پیام
const OMIT_RESERVE = 160; // جا برای «… و N نفر دیگر — جزئیات در پنل»

const jd = (iso) => { try { return isoDateToJalaliString(iso) || iso; } catch (_) { return iso; } };
const pct = (done, total) => (total ? Math.round((done / total) * 100) : null);

/** عضو در این روز رکورد حضورِ بازِ (ورود بدون خروج) دارد؟ (ضدخطا) */
function hasOpenRecord(member, date) {
  try {
    const rec = attendanceRepository.listByUserAndRange(member.id, date, date)[0];
    return !!(rec && rec.check_in_time && !rec.check_out_time);
  } catch (_) { return false; }
}

/**
 * گزارش یک عضو برای روز date؛ null اگر آن روز غیرکاری/مرخصیِ تمام‌روز بوده یا هیچ تسک/گزارشِ مرتبطی نداشته (و برنامه‌ی هفته‌ی بعدش هم مشکلی ندارد).
 * شمارش از taskDayTally (H1): total شامل پاسخ‌نداده‌های الزامی هم هست.
 */
function memberReport(member, date, settings) {
  const tally = taskDayTally(member, date, settings);
  if (!tally) return null;
  const weekStart = calendarService.weekStartOf(date, settings.weekStartDay);
  const planDay = calendarService.getPlanDay(member, weekStart, { settings });
  const nextPlan = plansRepo.findByUserWeek(member.id, addDays(weekStart, 7));
  const planMissing = settings.planGateMode !== 'off' && planDay === date && !(nextPlan && nextPlan.status === 'submitted');
  if (!tally.relevant && !planMissing) return null;
  return {
    member, tally, hasReport: tally.hasReport, total: tally.total, done: tally.done, percent: tally.percent,
    notDone: tally.notDone, dropped: tally.dropped, pending: tally.pending, pendingCount: tally.pendingCount,
    extra: tally.extra, noteCount: tally.noteCount, planMissing,
    stillOpen: hasOpenRecord(member, date),
    noStatus: tally.total > 0 && tally.pendingCount === tally.total, // هیچ‌کدام از تسک‌ها وضعیت نگرفته‌اند
  };
}

function memberBlock(r, stuckTasks) {
  const lines = [];
  const name = r.member.full_name;
  const t = r.tally || {};
  const partialAndNot = (t.notDoneCount !== undefined) ? t.notDoneCount : r.notDone.length;
  if (r.total > 0) {
    const bits = [`${r.done} از ${r.total} انجام شد${r.percent !== null && !r.noStatus ? ` (${r.percent}٪)` : ''}`];
    if (partialAndNot > 0) bits.push(`${partialAndNot} نیمه/انجام‌نشده`);
    if (r.pendingCount > 0) bits.push(r.noStatus ? `⏳ ${r.pendingCount} بدون وضعیت` : `${r.pendingCount} بدون وضعیت`);
    lines.push(`• ${name} — ${bits.join(' · ')}`);
  } else if (r.extra > 0) lines.push(`• ${name} — گزارش ثبت شد (فقط کار خارج از برنامه)`);
  else lines.push(`• ${name} — تسکی برای شمارش نیست`);
  // ✗ (پاسخ‌داده‌شده و done نشده) سپس ⏳ (بدون وضعیت)؛ جمعاً حداکثر MAX_ITEMS_PER_MEMBER خط
  const rows = [
    ...r.notDone.map((n) => `   ✗ ${n.title}${n.reason ? ` — ${n.reason}` : ''} (${n.carry})`),
    ...(r.dropped || []).map((n) => `   ✗ ${n.title}${n.reason ? ` — ${n.reason}` : ''} (${n.carry})`),
    ...r.pending.map((p) => `   ⏳ ${p.isUrgent ? '⚡ ' : (p.priority === 'high' ? '🔴 ' : '')}${p.title}`),
  ];
  rows.slice(0, MAX_ITEMS_PER_MEMBER).forEach((x) => lines.push(x));
  if (rows.length > MAX_ITEMS_PER_MEMBER) lines.push(`   … و ${rows.length - MAX_ITEMS_PER_MEMBER} مورد دیگر`);
  if (r.extra > 0 && r.total > 0) lines.push(`   ➕ ${r.extra} کار خارج از برنامه`);
  if (r.noteCount > 0) lines.push(`   📝 ${r.noteCount} توضیح انجام`);
  if (r.stillOpen) lines.push('   ⏳ هنوز خروج نزده — وضعیت لحظه‌ای');
  (stuckTasks || []).slice(0, 3).forEach((s) => lines.push(`   🔴 معطل‌مانده: ${s.title} (${s.carriedCount} بار منتقل شده)`));
  if (r.planMissing) lines.push('   ⚠️ برنامه‌ی هفته‌ی بعد ثبت نشده');
  return lines.join('\n');
}

function topReasons(reports, n = 3) {
  const c = new Map();
  reports.forEach((r) => r.notDone.forEach((x) => { if (x.reasonCode) c.set(x.reasonCode, (c.get(x.reasonCode) || 0) + 1); }));
  return [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${REASON_LABELS[k] || k} (${v})`);
}

function summaryLines(reports, title = 'خلاصه‌ی تیم') {
  const total = reports.reduce((a, r) => a + r.total, 0);
  const done = reports.reduce((a, r) => a + r.done, 0);
  const pending = reports.reduce((a, r) => a + r.pendingCount, 0);
  const lines = [`📊 ${title}: ${total ? `${pct(done, total)}٪ انجام (${done} از ${total})` : 'تسکی ثبت نشده'}`];
  if (pending) lines.push(`⏳ ${pending} تسک بدون وضعیت`);
  const reasons = topReasons(reports);
  if (reasons.length) lines.push(`علت‌های پرتکرار: ${reasons.join('، ')}`);
  return lines;
}

/**
 * تقسیم بلوک‌ها به پیام‌های ≤ SAFE_LIMIT؛ بیش از maxParts ⇒ بقیه خلاصه می‌شود. ⇒ { parts, omitted }
 * blocks: رشته یا { text, heading } (heading = عنوان گروه/تیم؛ در شروع هر پیام یا تغییر گروه تکرار می‌شود).
 * footerLines همیشه در «آخرین پیام» می‌آید و جایش از قبل رزرو می‌شود (هیچ پیامی از ۴۰۹۶ نمی‌گذرد).
 */
function pack(header, blocks, footerLines = [], { maxParts = MAX_PARTS } = {}) {
  const cap = Math.max(1, Math.floor(maxParts) || MAX_PARTS);
  const kept = [];
  let flen = 0;
  for (const line of footerLines) { // پانویس سقف دارد تا برای بلوک‌ها جا بماند (خط‌به‌خط بریده می‌شود)
    if (flen + line.length + 1 > MAX_FOOTER) { kept.push('…'); break; }
    kept.push(line); flen += line.length + 1;
  }
  const footer = kept.join('\n');
  const reserve = footer ? footer.length + 2 : 0;
  const norm = blocks.map((b) => (typeof b === 'string' ? { text: b, heading: null } : b));
  const parts = [];
  let cur = header;
  let curHeading = null;
  let empty = true; // در پیامِ جاری هنوز بلوکی نیست
  let used = 0;
  const isLast = () => parts.length === cap - 1;
  const budget = () => (isLast() ? SAFE_LIMIT - reserve - OMIT_RESERVE : SAFE_LIMIT);
  for (const b of norm) {
    const text = b.text.length > 1500 ? `${b.text.slice(0, 1480)}…` : b.text;
    const piece = () => (b.heading && b.heading !== curHeading ? `\n\n${b.heading}\n${text}` : `\n\n${text}`);
    let add = piece();
    if (!empty && cur.length + add.length > budget()) {
      if (isLast()) break;
      parts.push(cur);
      cur = `${header} (ادامه)`; curHeading = null; empty = true;
      add = piece();
    }
    cur += add; empty = false;
    if (b.heading) curHeading = b.heading;
    used += 1;
  }
  const omitted = norm.length - used;
  if (omitted > 0) cur += `\n\n… و ${omitted} نفر دیگر — جزئیات در «🖥 گزارش کامل در پنل»`;
  if (footer) {
    if (cur.length + reserve > SAFE_LIMIT && !isLast()) { parts.push(cur); cur = header; }
    cur += `\n\n${footer}`;
  }
  parts.push(cur);
  return { parts: parts.map((p) => (p.length > TG_LIMIT ? `${p.slice(0, TG_LIMIT - 2)}…` : p)), omitted };
}

/** گیرنده → اعضایی که باید گزارششان را ببیند (فقط سرپرست/ادمین مستقیم؛ H2 در recipientsMap بازتعریف می‌شود). */
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

/**
 * H2: گیرنده‌ها و دامنه‌ی هرکدام ⇒ Map(reviewerId → { reviewer, members, scope:'team'|'all' }).
 * سرپرست (manager) = همان assignments() (فقط اعضای مستقیم، بدون عضو ⇒ نیست)؛ ادمین = همه‌ی کاربران فعالِ غیرادمین (حتی اگر عضو مستقیمش نباشند).
 */
function recipientsMap() {
  const all = usersRepository.listUsers({ onlyActive: true });
  const everyone = all.filter((u) => u.role !== 'admin');
  const map = new Map();
  for (const [rid, v] of assignments()) {
    if (v.reviewer.role === 'manager' && v.members.length) map.set(rid, { reviewer: v.reviewer, members: v.members, scope: 'team' });
  }
  for (const a of all.filter((u) => u.role === 'admin')) map.set(a.id, { reviewer: a, members: everyone, scope: 'all' });
  return map;
}

const teamKeyOf = (member, byId) => {
  const boss = member.manager_id ? byId.get(member.manager_id) : null;
  return boss && boss.id !== member.id ? `تیم ${boss.full_name}` : NO_TEAM;
};

function companySummary(date, settings, allReports) {
  const byTeam = new Map(); // نام تیم → گزارش‌ها
  const all = usersRepository.listUsers({ onlyActive: true });
  const byId = new Map(all.map((u) => [u.id, u]));
  for (const r of allReports) {
    const key = teamKeyOf(r.member, byId);
    if (!byTeam.has(key)) byTeam.set(key, []);
    byTeam.get(key).push(r);
  }
  const lines = ['🏢 خلاصه‌ی کل شرکت'];
  for (const [team, rs] of [...byTeam].sort((x, y) => (x[0] === NO_TEAM) - (y[0] === NO_TEAM) || x[0].localeCompare(y[0], 'fa'))) {
    const t = rs.reduce((a, r) => a + r.total, 0); const d = rs.reduce((a, r) => a + r.done, 0); const p = rs.reduce((a, r) => a + r.pendingCount, 0);
    lines.push(`• ${team}: ${t ? `${pct(d, t)}٪` : '—'} (${rs.length} نفر)${p ? ` · ⏳ ${p} بدون وضعیت` : ''}`);
  }
  const noReview = [];
  for (const u of all.filter((x) => x.role === 'manager')) {
    const members = allReports.filter((r) => r.member.manager_id === u.id && r.hasReport);
    if (members.length && members.every((r) => !reviewsRepo.find(u.id, r.member.id, date))) noReview.push(u.full_name);
  }
  if (noReview.length) lines.push(`🔎 تیم‌های بدون بررسی: ${noReview.join('، ')}`);
  const noPlan = allReports.filter((r) => r.planMissing).map((r) => r.member.full_name);
  if (noPlan.length) lines.push(`⚠️ بدون برنامه‌ی هفته‌ی بعد: ${noPlan.join('، ')}`);
  const noStatus = allReports.filter((r) => r.noStatus).length;
  if (noStatus) lines.push(`⚠️ بدون هیچ وضعیتی: ${noStatus} نفر`);
  return lines;
}

/**
 * @returns {Array<{ reviewer, messages: string[], omitted: number, commentTargets: Array<{userId, name}>, date, scope, memberIds: number[], everyReport?: object[] }>}
 * گزارش هر عضو فقط یک‌بار ساخته می‌شود (یکتا بر اساس member.id)؛ خلاصه‌ی شرکت/معطل‌مانده‌ها از همین فهرست یکتا.
 */
function buildNightlyTaskReports(date, { settings = settingsRepository.getAll() } = {}) {
  const out = [];
  const recipients = recipientsMap();
  const byMember = new Map(); // member.id → گزارش (یا null)
  const reportOf = (m) => { if (!byMember.has(m.id)) byMember.set(m.id, memberReport(m, date, settings)); return byMember.get(m.id); };
  for (const { members } of recipients.values()) members.forEach(reportOf);
  const everyReport = [...byMember.values()].filter(Boolean);
  const stuckAll = new Map();
  teamReports.stuckRows(everyReport.map((r) => r.member), date).forEach((s) => stuckAll.set(s.userId, s.tasks));
  const all = usersRepository.listUsers({ onlyActive: true });
  const byId = new Map(all.map((u) => [u.id, u]));
  const adminMax = Math.min(10, Math.max(1, Math.floor(Number(settings.taskReportAdminMaxParts)) || 6));

  for (const { reviewer, members, scope } of recipients.values()) {
    const reports = members.map(reportOf).filter(Boolean);
    const isAdmin = scope === 'all';
    if (!reports.length && !isAdmin) continue;
    const header = `📋 گزارش تسک‌های امروز — ${jd(date)}`;
    let blocks;
    if (isAdmin) {
      const teams = new Map();
      for (const r of reports) { const k = teamKeyOf(r.member, byId); if (!teams.has(k)) teams.set(k, []); teams.get(k).push(r); }
      blocks = [];
      for (const [team, rs] of [...teams].sort((x, y) => (x[0] === NO_TEAM) - (y[0] === NO_TEAM) || x[0].localeCompare(y[0], 'fa'))) {
        rs.forEach((r) => blocks.push({ heading: `👥 ${team}`, text: memberBlock(r, stuckAll.get(r.member.id)) }));
      }
    } else blocks = reports.map((r) => memberBlock(r, stuckAll.get(r.member.id)));
    const footer = reports.length ? summaryLines(reports, isAdmin ? 'خلاصه‌ی همه' : 'خلاصه‌ی تیم') : [];
    if (isAdmin && everyReport.length) footer.push('', ...companySummary(date, settings, everyReport));
    if (!blocks.length && !footer.length) continue;
    const { parts, omitted } = pack(header, blocks, footer, { maxParts: isAdmin ? adminMax : MAX_PARTS });
    // دکمه‌ی «مشاهده شد/کامنت» فقط برای زیردست‌های «مستقیمِ» گیرنده (markReviewed همین اسکوپ را اعمال می‌کند)؛ بقیه فقط‌خواندنی
    const canReview = teamReview.isReviewer(reviewer);
    out.push({
      reviewer, messages: parts, omitted, date, scope, memberIds: reports.map((r) => r.member.id),
      commentTargets: reports.filter((r) => canReview && r.hasReport && r.member.manager_id === reviewer.id).slice(0, MAX_COMMENT_BUTTONS).map((r) => ({ userId: r.member.id, name: r.member.full_name })),
    });
  }
  out.everyReport = everyReport;
  return out;
}

module.exports = { buildNightlyTaskReports, memberReport, memberBlock, pack, assignments, recipientsMap, summaryLines, TG_LIMIT, SAFE_LIMIT, MAX_PARTS };

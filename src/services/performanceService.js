// نمودار عملکرد کارمند (مثل Search Console) + حقوق دقیق.
//
// قراردادها:
//   • هیچ منطق محاسباتی تازه‌ای برای حضور/تأخیر/اضافه‌کاری اینجا نیست؛ همه‌چیز از «گزارش ماهانه» (computeMonthlyReport → computeDay) می‌آید.
//     این سرویس فقط روزهای چند ماه شمسی را کنار هم می‌گذارد، بازه را برش می‌دهد و با «دوره‌ی قبل» مقایسه می‌کند.
//   • اسکوپ نقش را فراخواننده (route) قبلاً اعمال کرده؛ این سرویس خودش دسترسی تعیین نمی‌کند.
//   • حقوق = ساعت مفیدِ (با مأموریت) × نرخ ساعتی؛ دقیقاً همان فرمول کارت «کارکرد تخمینی ماه» در Mini App (earningsService.calculateAmountToman)،
//     با همان استثناها: روز دارای اعتراضِ باز و روزِ «ورود بدون خروج» در جمع نمی‌آید. نرخ فقط در خروجی‌های payroll می‌آید (مجوز payroll.read).
//   • «امروز» به وقت شرکت (timezone تنظیمات) است و now قابل‌تزریق برای تست.

const { computeMonthlyReport } = require('./monthlyReportService');
const { calculateAmountToman } = require('./earningsService');
const { taskDayTally } = require('./taskDayTally');
const dayService = require('../engine/dayService');
const attendanceRepository = require('../repositories/attendanceRepository');
const breakRepository = require('../repositories/breakRepository');
const disputeRepository = require('../repositories/disputeRepository');
const usersRepository = require('../repositories/usersRepository');
const { jalaliPartsOfDateString } = require('../utils/jalali');
const { zonedTimeToUtc, minutesSinceMidnight } = require('../utils/time');
const insightsLib = require('./performanceInsights');

class PerformanceError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// کلید بازه → تعداد روز. «24h» = امروز (نمای ساعت‌به‌ساعت)؛ «۱ ماه» = ۳۰ روز اخیر.
const PRESETS = Object.freeze({ '24h': 1, '3d': 3, '6d': 6, '30d': 30, '90d': 90 });
const MAX_CUSTOM_DAYS = 366;

const shiftIso = (iso, days) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;
const sum = (arr) => arr.reduce((t, v) => t + (v || 0), 0);

/** بازه‌ی درخواستی ⇒ { key, from, to, days }؛ دوره‌ی قبل = همان طول، بلافاصله قبل از from */
function resolveRange({ range, from, to, today }) {
  const key = range === undefined || range === '' || range === null ? '30d' : String(range);
  let a;
  let b;
  if (key === 'custom') {
    if (!DATE_RE.test(String(from || '')) || !DATE_RE.test(String(to || ''))) throw new PerformanceError('INVALID_RANGE', 'برای بازه‌ی دلخواه، from و to باید YYYY-MM-DD باشند.');
    a = from; b = to;
    if (a > b) throw new PerformanceError('INVALID_RANGE', 'تاریخ شروع باید قبل از پایان باشد.');
    if (daysBetween(a, b) > MAX_CUSTOM_DAYS) throw new PerformanceError('RANGE_TOO_LONG', `بازه‌ی دلخواه حداکثر ${MAX_CUSTOM_DAYS} روز است.`);
  } else if (Object.prototype.hasOwnProperty.call(PRESETS, key)) {
    b = today; a = shiftIso(today, -(PRESETS[key] - 1));
  } else {
    throw new PerformanceError('INVALID_RANGE', 'range باید یکی از 24h، 3d، 6d، 30d، 90d یا custom باشد.');
  }
  const days = daysBetween(a, b);
  return { key, from: a, to: b, days, previous: { from: shiftIso(a, -days), to: shiftIso(a, -1) } };
}

/** ماه‌های شمسیِ پوشاننده‌ی [from, to] */
function monthsCovering(from, to) {
  const out = [];
  const seen = new Set();
  for (let d = from; d <= to; d = shiftIso(d, 1)) {
    const p = jalaliPartsOfDateString(d);
    if (!p) continue;
    const k = `${p.jy}-${p.jm}`;
    if (!seen.has(k)) { seen.add(k); out.push({ year: p.jy, month: p.jm }); }
  }
  return out;
}

/** روزهای گزارش ماهانه‌ی چند کاربر در [from, to] ⇒ Map(userId ⇒ Map(date ⇒ dayRow)) + today */
function collectDays(users, from, to, now) {
  const ctx = dayService.loadContext();
  const byUser = new Map(users.map((u) => [u.id, new Map()]));
  let today = null;
  for (const { year, month } of monthsCovering(from, to)) {
    const rep = computeMonthlyReport({ users, year, month, now, context: ctx, includeDays: true, includeBalances: false });
    today = rep.today;
    for (const u of rep.users) {
      const m = byUser.get(u.user.id);
      for (const d of u.days || []) if (d.date >= from && d.date <= to) m.set(d.date, d);
    }
  }
  return { byUser, today };
}

// ---------- شاخص‌های روزانه ----------
const WORKED = new Set(['present', 'late', 'incomplete']);

function metricsOfDay(d, today) {
  const useless = (d.flags || []).includes('missing_checkout'); // ساعت مفیدِ بی‌معنا
  const worked = WORKED.has(d.status);
  const effective = d.effectiveWithMission != null ? d.effectiveWithMission : d.effective;
  const useful = !useless && effective != null ? effective : 0;
  const workingPast = d.kind !== 'holiday' && d.kind !== 'weekend' && d.date < today && (d.expected > 0 || d.status === 'absent');
  let shortfall = 0;
  if (workingPast) {
    if (d.status === 'absent') shortfall = d.expected;
    else if ((d.status === 'present' || d.status === 'late') && d.effective != null && !useless) shortfall = Math.max(0, d.expected - d.effective);
  }
  return {
    date: d.date,
    status: d.status,
    expected: d.expected || 0,
    useful,
    overtime: d.overtimePayableFinal != null ? d.overtimePayableFinal : (d.overtimePayable || 0),
    shortfall,
    late: d.late || 0,
    earlyLeave: d.earlyLeave || 0,
    breaks: (d.breakPaid || 0) + (d.breakUnpaid || 0),
    leave: d.leaveMinutes || 0,
    remote: d.remoteMinutes || 0,
    present: worked && d.status !== 'incomplete' ? 1 : 0,
    flags: d.flags || [],
    otRaw: d.overtimePayable || 0,
    otApproval: d.approvalStatus || null,
    viaRemote: !!d.viaRemote,
    checkIn: null,
    checkOut: null,
  };
}

const METRIC_KEYS = ['useful', 'overtime', 'shortfall', 'late', 'earlyLeave', 'breaks', 'remote', 'present', 'tasksDone'];

function sumMetrics(rows) {
  const t = {};
  for (const k of METRIC_KEYS) t[k] = sum(rows.map((r) => r[k]));
  t.expected = sum(rows.map((r) => r.expected));
  t.lateDays = rows.filter((r) => r.late > 0).length;
  t.absentDays = rows.filter((r) => r.status === 'absent').length;
  t.tasksTotal = sum(rows.map((r) => r.tasksTotal));
  t.taskRate = t.tasksTotal > 0 ? Math.round((t.tasksDone / t.tasksTotal) * 1000) / 10 : null;
  return t;
}

function withTasks(user, rows, settings) {
  for (const r of rows) {
    let tally = null;
    try { tally = taskDayTally(user, r.date, settings); } catch (_) { tally = null; }
    r.tasksTotal = tally ? tally.total : 0;
    r.tasksDone = tally ? tally.done : 0;
  }
  return rows;
}

function rowsFor(user, dayMap, from, to, today, settings, { tasks = true } = {}) {
  const rows = [];
  for (let d = from; d <= to; d = shiftIso(d, 1)) {
    const day = dayMap.get(d);
    if (!day) continue;
    rows.push(metricsOfDay(day, today));
  }
  return tasks ? withTasks(user, rows, settings) : rows.map((r) => ({ ...r, tasksDone: 0, tasksTotal: 0 }));
}

// ---------- نمای ساعت‌به‌ساعتِ یک روز ----------
// ۲۴ سطل یک‌ساعته به وقت شرکت: دقیقه‌ی حضور (بازه‌های ورود/خروج) و دقیقه‌ی استراحت.
function overlapMinutes(a0, a1, b0, b1) {
  const s = Math.max(a0, b0); const e = Math.min(a1, b1);
  return e > s ? (e - s) / 60000 : 0;
}

function hourlyOfDay(user, date, { now, timezone }) {
  const edges = Array.from({ length: 25 }, (_, h) => (h === 24
    ? zonedTimeToUtc(shiftIso(date, 1), '00:00', timezone).getTime()
    : zonedTimeToUtc(date, `${String(h).padStart(2, '0')}:00`, timezone).getTime()));
  const present = Array(24).fill(0);
  const onBreak = Array(24).fill(0);
  const rec = attendanceRepository.listByUserIdsAndRange([user.id], date, date).find((r) => r.record_date === date);
  const events = [];
  if (rec && rec.check_in_time) {
    const nowMs = new Date(now).getTime();
    for (const seg of attendanceRepository.listSegments(rec.id)) {
      const a = Date.parse(seg.check_in_time);
      const b = seg.check_out_time ? Date.parse(seg.check_out_time) : nowMs;
      if (Number.isFinite(a) && Number.isFinite(b) && b > a) events.push({ kind: 'segment', start: seg.check_in_time, end: seg.check_out_time || null, open: !seg.check_out_time });
      if (Number.isFinite(a) && Number.isFinite(b) && b > a) {
        for (let h = 0; h < 24; h += 1) present[h] += overlapMinutes(a, b, edges[h], edges[h + 1]);
      }
    }
    for (const br of breakRepository.listByAttendanceRecord(rec.id)) {
      const a = Date.parse(br.start_time);
      const b = br.end_time ? Date.parse(br.end_time) : nowMs;
      if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) continue;
      events.push({ kind: 'break', start: br.start_time, end: br.end_time || null, open: !br.end_time });
      for (let h = 0; h < 24; h += 1) onBreak[h] += overlapMinutes(a, b, edges[h], edges[h + 1]);
    }
  }
  const r1 = (x) => Math.round(x * 10) / 10;
  const hours = present.map((p, h) => {
    const br = Math.min(onBreak[h], p);
    return { hour: h, present: r1(p), onBreak: r1(br), working: r1(Math.max(0, p - br)) };
  });
  return { date, hours, events };
}

// ساعت ورود/خروج هر روز (دقیقه از نیمه‌شب به وقت شرکت). خروجِ روزِ «ورود بدون خروج» نمی‌آید.
function attachTimes(rowsByUser, recordsByUser, timezone) {
  for (const [uid, rows] of rowsByUser) {
    const recs = recordsByUser.get(uid) || new Map();
    for (const r of rows) {
      const rec = recs.get(r.date);
      if (!rec || !rec.check_in_time) continue;
      r.checkIn = minutesSinceMidnight(rec.check_in_time, timezone);
      if (rec.check_out_time && !(r.flags || []).includes('missing_checkout')) r.checkOut = minutesSinceMidnight(rec.check_out_time, timezone);
    }
  }
}

function recordsMap(userIds, from, to) {
  const out = new Map(userIds.map((id) => [id, new Map()]));
  for (const rec of attendanceRepository.listByUserIdsAndRange(userIds, from, to)) out.get(rec.user_id).set(rec.record_date, rec);
  return out;
}

// ---------- API: عملکرد یک کارمند ----------
/**
 * @param {object} p
 * @param {object} p.user ردیف users
 * @param {object} p.range خروجی resolveRange
 * @param {boolean} [p.includePayroll] اگر true نرخ و حقوق هم می‌آید (فراخواننده مجوز payroll.read را چک کرده)
 */
function employeePerformance({ user, range, now, includePayroll = false }) {
  const nowDate = now === undefined ? new Date() : new Date(now);
  const ctx = dayService.loadContext();
  const { byUser, today } = collectDays([user], range.previous.from, range.to, nowDate);
  const dayMap = byUser.get(user.id);
  const cur = rowsFor(user, dayMap, range.from, range.to, today, ctx.settings);
  const prev = rowsFor(user, dayMap, range.previous.from, range.previous.to, today, ctx.settings);
  attachTimes(new Map([[user.id, cur.concat(prev)]]), recordsMap([user.id], range.previous.from, range.to), ctx.timezone);
  const out = {
    user: { id: user.id, fullName: user.full_name, personnelCode: user.personnel_code, department: user.department || null, role: user.role, isActive: !!user.is_active },
    range: { key: range.key, from: range.from, to: range.to, days: range.days, previous: range.previous },
    today,
    series: cur,
    previousSeries: prev,
    totals: sumMetrics(cur),
    previousTotals: sumMetrics(prev),
    insights: insightsLib.computeInsights(cur, today),
    previousInsights: insightsLib.computeInsights(prev, today),
    tasks: insightsLib.loadTasks(user, range.from, range.to),
    leaves: insightsLib.loadLeaves(user, range.from, range.to),
    disputes: insightsLib.loadDisputes(user, range.from, range.to),
    hourly: range.days === 1 ? hourlyOfDay(user, range.from, { now: nowDate, timezone: ctx.timezone }) : null,
  };
  if (includePayroll) {
    out.payroll = payrollOfRows(user, dayMap, range.from, range.to);
    out.payroll.previousAmountToman = payrollOfRows(user, dayMap, range.previous.from, range.previous.to).amountToman;
  }
  return out;
}

// ---------- API: بازرسی یک روز (مثل URL Inspection) ----------
function dayInspection({ user, date, now, includePayroll = false }) {
  const nowDate = now === undefined ? new Date() : new Date(now);
  const ctx = dayService.loadContext();
  const { byUser, today } = collectDays([user], date, date, nowDate);
  const dayMap = byUser.get(user.id);
  const day = dayMap.get(date);
  if (!day) throw new PerformanceError('NO_DAY', 'برای این روز داده‌ای نیست.');
  const row = metricsOfDay(day, today);
  attachTimes(new Map([[user.id, [row]]]), recordsMap([user.id], date, date), ctx.timezone);
  const rec = attendanceRepository.listByUserIdsAndRange([user.id], date, date).find((r) => r.record_date === date) || null;
  const leaveRepository = require('../repositories/leaveRepository');
  const remoteRepository = require('../repositories/remoteWorkRepository');
  const disputes = rec ? disputeRepository.listByUser(user.id).filter((d) => d.attendance_record_id === rec.id) : [];
  let tally = null;
  try { tally = taskDayTally(user, date, ctx.settings); } catch (_) { tally = null; }
  const out = {
    date, today,
    day: { ...row, kind: day.kind, holidayTitle: day.holidayTitle || null, expected: day.expected, effective: day.effective, earlyLeave: day.earlyLeave || 0, breakPaid: day.breakPaid || 0, breakUnpaid: day.breakUnpaid || 0, missionMinutes: day.missionMinutes || 0, overtimePayableFinal: day.overtimePayableFinal != null ? day.overtimePayableFinal : null },
    record: rec ? {
      status: rec.status, checkIn: rec.check_in_time, checkOut: rec.check_out_time,
      segments: attendanceRepository.listSegments(rec.id).map((s) => ({ in: s.check_in_time, out: s.check_out_time || null })),
      breaks: breakRepository.listByAttendanceRecord(rec.id).map((b) => ({ type: b.break_type, start: b.start_time, end: b.end_time || null })),
    } : null,
    leaves: leaveRepository.listApprovedOnDate(user.id, date).map((l) => ({ id: l.id, kind: l.kind, type: l.type_title || null, reason: l.reason || null })),
    remote: remoteRepository.listForUserDate(user.id, date).map((s) => ({ status: s.status, start: s.start_at, end: s.end_at || null, autoClosed: !!s.auto_closed })),
    disputes: disputes.map((d) => ({ id: d.id, status: d.status, message: d.message, createdAt: d.created_at })),
    tasks: tally ? { total: tally.total, done: tally.done, partial: tally.partial, percent: tally.percent, notDone: tally.notDone, pending: tally.pending, extras: tally.extras } : null,
    hourly: hourlyOfDay(user, date, { now: nowDate, timezone: ctx.timezone }),
  };
  if (includePayroll) out.payroll = payrollOfRows(user, dayMap, date, date);
  return out;
}

// ---------- API: نمای تیم برای همان بازه ----------
function teamOverview({ users, range, now }) {
  const nowDate = now === undefined ? new Date() : new Date(now);
  const ctx = dayService.loadContext();
  const { byUser, today } = collectDays(users, range.previous.from, range.to, nowDate);
  const recs = recordsMap(users.map((u) => u.id), range.from, range.to);
  const rowsById = new Map();
  const rows = users.map((u) => {
    const dayMap = byUser.get(u.id);
    const cur = rowsFor(u, dayMap, range.from, range.to, today, ctx.settings, { tasks: false }); // درصد تسک فقط در نمای یک کارمند (هزینه‌ی پرسوجو)
    const prev = rowsFor(u, dayMap, range.previous.from, range.previous.to, today, ctx.settings, { tasks: false });
    attachTimes(new Map([[u.id, cur]]), recs, ctx.timezone);
    rowsById.set(u.id, cur);
    const t = sumMetrics(cur);
    const p = sumMetrics(prev);
    const ins = insightsLib.computeInsights(cur, today);
    return {
      user: { id: u.id, fullName: u.full_name, personnelCode: u.personnel_code, department: u.department || null, role: u.role },
      totals: t,
      previousUseful: p.useful,
      attendanceRate: ins.attendanceRate, punctualityRate: ins.punctualityRate, fulfillmentRate: ins.fulfillmentRate, avgCheckIn: ins.avgCheckIn, avgCheckOut: ins.avgCheckOut,
      streakOnTime: ins.streakOnTime.longest,
      spark: cur.map((r) => r.useful),
    };
  });
  // سری روزانه‌ی کل تیم (جمع شاخص‌ها به‌ازای هر روز) + تعداد حاضر/غایب
  const daily = new Map();
  for (const list of rowsById.values()) {
    for (const r of list) {
      const d = daily.get(r.date) || { date: r.date, useful: 0, overtime: 0, shortfall: 0, late: 0, breaks: 0, present: 0, absent: 0, lateCount: 0 };
      d.useful += r.useful; d.overtime += r.overtime; d.shortfall += r.shortfall; d.late += r.late; d.breaks += r.breaks;
      if (r.status === 'present' || r.status === 'late') d.present += 1;
      if (r.status === 'absent') d.absent += 1;
      if (r.late > 0) d.lateCount += 1;
      daily.set(r.date, d);
    }
  }
  const tot = (k) => sum(rows.map((r) => r.totals[k]));
  const rates = rows.map((r) => r.attendanceRate).filter((v) => v != null);
  const punct = rows.map((r) => r.punctualityRate).filter((v) => v != null);
  const departments = new Map();
  for (const r of rows) {
    const k = r.user.department || 'بدون دپارتمان';
    const d = departments.get(k) || { department: k, employees: 0, useful: 0, overtime: 0, shortfall: 0, late: 0, absentDays: 0 };
    d.employees += 1; d.useful += r.totals.useful; d.overtime += r.totals.overtime; d.shortfall += r.totals.shortfall; d.late += r.totals.late; d.absentDays += r.totals.absentDays;
    departments.set(k, d);
  }
  return {
    range: { key: range.key, from: range.from, to: range.to, days: range.days }, today, rows,
    daily: [...daily.values()].sort((x, y) => x.date.localeCompare(y.date)),
    departments: [...departments.values()].sort((x, y) => y.useful - x.useful),
    totals: {
      useful: tot('useful'), overtime: tot('overtime'), shortfall: tot('shortfall'), late: tot('late'), lateDays: tot('lateDays'), absentDays: tot('absentDays'),
      previousUseful: sum(rows.map((r) => r.previousUseful)),
      attendanceRate: rates.length ? Math.round((sum(rates) / rates.length) * 10) / 10 : null,
      punctualityRate: punct.length ? Math.round((sum(punct) / punct.length) * 10) / 10 : null,
    },
  };
}

// ---------- حقوق ----------
function openDisputeDates(userId, from, to) {
  return new Set(disputeRepository.listOpenInRange(from, to).filter((d) => d.user_id === userId).map((d) => d.record_date).filter(Boolean));
}

/** حقوق روزانه‌ی یک کاربر از روزهای گزارش ماهانه (rate از repository؛ null ⇒ نرخ تعریف نشده) */
function payrollOfRows(user, dayMap, from, to) {
  const rateKt = usersRepository.getHourlyRateKt(user.id);
  const disputed = openDisputeDates(user.id, from, to);
  const days = [];
  let minutes = 0;
  let overtime = 0;
  for (let d = from; d <= to; d = shiftIso(d, 1)) {
    const day = dayMap.get(d);
    if (!day) continue;
    const hasWork = day.effectiveWithMission != null || day.effective != null;
    if (!hasWork && !WORKED.has(day.status)) continue;
    let excluded = null;
    if (disputed.has(d)) excluded = 'open_dispute';
    else if ((day.flags || []).includes('missing_checkout')) excluded = 'missing_checkout';
    const useful = excluded || day.effectiveWithMission == null ? 0 : Number(day.effectiveWithMission);
    const ot = day.overtimePayableFinal != null ? day.overtimePayableFinal : (day.overtimePayable || 0);
    if (!excluded) { minutes += useful; overtime += ot; }
    days.push({ date: d, status: day.status, usefulMinutes: useful, overtimeMinutes: excluded ? 0 : ot, amountToman: calculateAmountToman(useful, rateKt), excluded });
  }
  return {
    rateKt: rateKt === undefined ? null : rateKt,
    usefulMinutes: minutes,
    overtimeMinutes: overtime,
    amountToman: calculateAmountToman(minutes, rateKt === undefined ? null : rateKt),
    excludedDays: days.filter((x) => x.excluded).map((x) => ({ date: x.date, reason: x.excluded })),
    days: days.filter((x) => x.usefulMinutes > 0 || x.excluded),
  };
}

/** حقوق ماهانه‌ی همه‌ی کاربران داده‌شده (جدول + جمع)؛ withDays ⇒ ریز روزانه هم */
function monthlyPayroll({ users, year, month, now, withDays = false }) {
  const nowDate = now === undefined ? new Date() : new Date(now);
  const rep = computeMonthlyReport({ users, year, month, now: nowDate, includeDays: true, includeBalances: false });
  const rows = rep.users.map((r) => {
    const dayMap = new Map((r.days || []).map((d) => [d.date, d]));
    const user = users.find((u) => u.id === r.user.id);
    const p = payrollOfRows(user, dayMap, rep.from, rep.to);
    const row = {
      user: r.user,
      rateKt: p.rateKt,
      usefulMinutes: p.usefulMinutes,
      overtimeMinutes: p.overtimeMinutes,
      amountToman: p.amountToman,
      excludedDays: p.excludedDays,
      workedDays: p.days.filter((x) => x.usefulMinutes > 0).length,
      lateMinutes: r.time.lateMinutes,
      shortfallMinutes: r.time.shortfallMinutes,
      projectedAmountToman: null,
      avgPerWorkedDayToman: null,
    };
    // پیش‌بینی پایان ماه (فقط ماه جاری): نرخ فعلی روزهای کاریِ سپری‌شده × کل روزهای کاری ماه
    const elapsed = (r.days || []).filter((d) => d.date < rep.today && (d.expected > 0 || d.status === 'absent')).length;
    const total = r.calendar ? r.calendar.expectedWorkDays : 0;
    if (p.amountToman != null && row.workedDays > 0) row.avgPerWorkedDayToman = Math.round(p.amountToman / row.workedDays);
    if (p.amountToman != null && elapsed > 0 && total > elapsed && rep.today >= rep.from && rep.today <= rep.to) row.projectedAmountToman = Math.round((p.amountToman / elapsed) * total);
    row.elapsedWorkDays = elapsed; row.totalWorkDays = total;
    if (withDays) row.days = p.days;
    return row;
  });
  const priced = rows.filter((r) => r.amountToman != null);
  const amounts = priced.map((r) => r.amountToman).sort((a, b) => a - b);
  const depts = new Map();
  for (const r of rows) {
    const k = r.user.department || 'بدون دپارتمان';
    const d = depts.get(k) || { department: k, employees: 0, amountToman: 0, usefulMinutes: 0 };
    d.employees += 1; d.amountToman += r.amountToman || 0; d.usefulMinutes += r.usefulMinutes;
    depts.set(k, d);
  }
  const projected = rows.some((r) => r.projectedAmountToman != null);
  return {
    year, month, label: rep.label, from: rep.from, to: rep.to, today: rep.today,
    rows,
    totals: {
      amountToman: sum(priced.map((r) => r.amountToman)),
      usefulMinutes: sum(rows.map((r) => r.usefulMinutes)),
      overtimeMinutes: sum(rows.map((r) => r.overtimeMinutes)),
      employees: rows.length,
      withoutRate: rows.filter((r) => r.rateKt == null).length,
      excludedDays: sum(rows.map((r) => r.excludedDays.length)),
      averageToman: amounts.length ? Math.round(sum(amounts) / amounts.length) : null,
      medianToman: amounts.length ? amounts[Math.floor(amounts.length / 2)] : null,
      projectedAmountToman: projected ? sum(rows.map((r) => (r.projectedAmountToman != null ? r.projectedAmountToman : (r.amountToman || 0)))) : null,
    },
    departments: [...depts.values()].sort((a, b) => b.amountToman - a.amountToman),
  };
}

/** حقوق ماه + مقایسه با ماه شمسی قبل (برای هر کارمند و جمع) */
function monthlyPayrollCompared({ users, year, month, now, withDays = false }) {
  const cur = monthlyPayroll({ users, year, month, now, withDays });
  const py = month === 1 ? year - 1 : year; const pm = month === 1 ? 12 : month - 1;
  const prev = monthlyPayroll({ users, year: py, month: pm, now });
  const prevBy = new Map(prev.rows.map((r) => [r.user.id, r]));
  for (const r of cur.rows) { const p = prevBy.get(r.user.id); r.previousAmountToman = p ? p.amountToman : null; r.previousUsefulMinutes = p ? p.usefulMinutes : 0; }
  cur.previous = { year: py, month: pm, label: prev.label, totals: prev.totals };
  return cur;
}

module.exports = {
  PerformanceError, PRESETS, resolveRange, monthsCovering, metricsOfDay, hourlyOfDay,
  employeePerformance, dayInspection, teamOverview, monthlyPayroll, monthlyPayrollCompared, payrollOfRows,
};

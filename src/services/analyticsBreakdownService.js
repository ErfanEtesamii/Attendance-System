// تحلیل‌های ماهانه/بازه‌ای (S5-6b): رتبه‌ی اضافه‌کاری و کسری، نرخ حضور، مرخصی به‌تفکیک نوع، توزیع ساعت ورود.
//
// ماهانه‌ها «توابع خالص روی خروجی گزارش ماهانه» هستند (computeMonthlyReport یا snapshot ماه بسته): هیچ منطق جدیدی برای
// اضافه‌کاری/کسری/حضور/مرخصی اینجا نیست و عدد تحلیل همیشه با گزارش ماهانه یکی است. فقط توزیع ساعت ورود از رکوردها می‌آید
// (ساعت ورود به وقت شرکت، با یک کوئری IN از repository).
//
// تعریف‌ها (در خروجی هم آمده‌اند):
//   • اضافه‌کاری = «قابل‌پرداخت» ماهانه (پس از تأیید و سقف)؛ خام/معلق هم کنارش می‌آید. فقط مقدار مثبت رتبه می‌گیرد.
//   • کسری = time.shortfallMinutes گزارش ماهانه؛ نسبت کسری = کسری ÷ دقیقه‌ی مورد انتظار (null اگر مورد انتظار صفر).
//   • نرخ حضور = روز حضور ÷ (روز حضور + روز غیبت). مرخصی/مأموریت/تعطیل/روز آینده/امروزِ در جریان در مخرج نیستند؛ مخرج صفر ⇒ null.
//   • رتبه‌بندی استاندارد (مساوی ⇒ رتبه‌ی یکسان، رتبه‌ی بعدی می‌پرد: ۱،۲،۲،۴).

const attendanceRepository = require('../repositories/attendanceRepository');
const dayService = require('../engine/dayService');
const { minutesSinceMidnight } = require('../utils/time');
const { AnalyticsError, MAX_RANGE_DAYS, MAX_SERIES, NO_DEPARTMENT } = require('./analyticsService');

const MAX_LIMIT = 100;
const BIN_SIZES = [10, 15, 20, 30, 60];
const pad = (n) => String(n).padStart(2, '0');
const hhmm = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const round4 = (x) => Math.round(x * 10000) / 10000;
const depOf = (u) => (u.user.department || '').trim() || NO_DEPARTMENT;

function parseLimit(raw, fallback = 10) {
  if (raw === undefined || raw === '') return fallback;
  if (!/^\d+$/.test(String(raw)) || Number(raw) < 1 || Number(raw) > MAX_LIMIT) throw new AnalyticsError('INVALID_LIMIT', `limit باید عددی بین ۱ و ${MAX_LIMIT} باشد.`);
  return Number(raw);
}

// فقط مقدار مثبت؛ رتبه روی کل فهرست مرتب‌شده حساب می‌شود و limit فقط «تعداد ردیف خروجی» را می‌بُرد (هم‌رتبه‌ها پشت مرز limit می‌افتند)
function rankRows(rows, valueOf, limit) {
  const sorted = rows.filter((r) => valueOf(r) > 0).sort((a, b) => valueOf(b) - valueOf(a) || a.user.fullName.localeCompare(b.user.fullName, 'fa'));
  let rank = 0;
  let prev = null;
  return sorted.map((row, i) => {
    if (valueOf(row) !== prev) { rank = i + 1; prev = valueOf(row); }
    return { rank, row };
  }).slice(0, limit);
}

const brief = (u) => ({ id: u.user.id, fullName: u.user.fullName, personnelCode: u.user.personnelCode || null, department: u.user.department || null });

/** رتبه‌ی اضافه‌کاری قابل‌پرداخت ماهانه */
function rankOvertime(report, { limit = 10 } = {}) {
  const ranked = rankRows(report.users, (u) => u.overtime.payableMinutes, limit);
  return {
    metric: 'overtime', definition: 'اضافه‌کاری قابل‌پرداخت ماهانه (پس از تأیید و سقف)؛ فقط مقدار مثبت',
    overtimePolicy: report.overtimePolicy,
    rows: ranked.map(({ rank, row }) => ({ rank, user: brief(row), payableMinutes: row.overtime.payableMinutes, rawMinutes: row.overtime.rawMinutes, pendingMinutes: row.overtime.pendingMinutes, clippedMinutes: row.overtime.clippedMinutes })),
  };
}

/** رتبه‌ی کسری کار ماهانه */
function rankShortfall(report, { limit = 10 } = {}) {
  const ranked = rankRows(report.users, (u) => u.time.shortfallMinutes, limit);
  return {
    metric: 'shortfall', definition: 'کسری کار ماهانه (غیبت = کل ساعت مورد انتظار؛ روز حاضر = مورد انتظار − مفید)؛ روز ناقص/باز در کسری نیست',
    rows: ranked.map(({ rank, row }) => ({
      rank, user: brief(row), shortfallMinutes: row.time.shortfallMinutes, expectedMinutes: row.time.expectedMinutes,
      shortfallRatio: row.time.expectedMinutes > 0 ? round4(row.time.shortfallMinutes / row.time.expectedMinutes) : null,
      incompleteDays: row.attendance.incompleteDays,
    })),
  };
}

const rateOf = (present, absent) => (present + absent > 0 ? round4(present / (present + absent)) : null);

/** نرخ حضور ماهانه (کل، یا به‌تفکیک دپارتمان/فرد) */
function attendanceRate(report, { groupBy = 'none' } = {}) {
  if (!['none', 'department', 'user'].includes(groupBy)) throw new AnalyticsError('INVALID_GROUP', 'groupBy باید none، department یا user باشد.');
  const stat = (list) => {
    const s = list.reduce((a, u) => ({ presentDays: a.presentDays + u.attendance.presentDays, absentDays: a.absentDays + u.attendance.absentDays, expectedWorkDays: a.expectedWorkDays + u.calendar.expectedWorkDays, lateDays: a.lateDays + u.attendance.lateDays }), { presentDays: 0, absentDays: 0, expectedWorkDays: 0, lateDays: 0 });
    return { ...s, rate: rateOf(s.presentDays, s.absentDays) };
  };
  let groups = [];
  if (groupBy === 'department') {
    const by = new Map();
    for (const u of report.users) { const k = depOf(u); if (!by.has(k)) by.set(k, []); by.get(k).push(u); }
    groups = [...by.entries()].sort((a, b) => a[0].localeCompare(b[0], 'fa')).map(([label, list]) => ({ key: `d:${label}`, label, department: label, employees: list.length, ...stat(list) }));
  } else if (groupBy === 'user') {
    groups = report.users.map((u) => ({ key: `u${u.user.id}`, label: u.user.fullName, userId: u.user.id, department: u.user.department || null, employees: 1, ...stat([u]) }));
  }
  if (groups.length > MAX_SERIES) throw new AnalyticsError('TOO_MANY_SERIES', `تعداد گروه‌ها (${groups.length}) از سقف ${MAX_SERIES} بیشتر است؛ با فیلتر دپارتمان محدودش کنید.`);
  return { definition: 'روز حضور ÷ (روز حضور + روز غیبت)؛ مرخصی، مأموریت، تعطیل، روز آینده و امروزِ در جریان در مخرج نیستند', total: { employees: report.users.length, ...stat(report.users) }, groupBy, groups };
}

/** مرخصی/مأموریت ماهانه به‌تفکیک نوع (کل، یا به‌تفکیک دپارتمان) */
function leaveByType(report, { groupBy = 'none' } = {}) {
  if (!['none', 'department'].includes(groupBy)) throw new AnalyticsError('INVALID_GROUP', 'groupBy برای مرخصی باید none یا department باشد.');
  const acc = (list) => {
    const m = new Map();
    for (const u of list) {
      for (const t of u.leave.byType || []) {
        const key = t.leaveTypeId === null || t.leaveTypeId === undefined ? 'manual' : String(t.leaveTypeId);
        const cur = m.get(key) || { leaveTypeId: t.leaveTypeId === undefined ? null : t.leaveTypeId, title: t.title, kind: t.kind, days: 0, minutes: 0, users: new Set() };
        cur.days += t.days; cur.minutes += t.minutes;
        if (t.days > 0 || t.minutes > 0) cur.users.add(u.user.id);
        m.set(key, cur);
      }
    }
    return [...m.values()].map((t) => ({ leaveTypeId: t.leaveTypeId, title: t.title, kind: t.kind, days: t.days, minutes: t.minutes, employees: t.users.size })).sort((a, b) => b.days - a.days || b.minutes - a.minutes || a.title.localeCompare(b.title, 'fa'));
  };
  const out = { definition: 'مرخصی/مأموریت تأییدشده‌ی ماه به‌تفکیک نوع (روز تمام‌روز، دقیقه‌ی ساعتی/نیم‌روز، تعداد کارمند)', types: acc(report.users), groupBy, groups: [] };
  if (groupBy === 'department') {
    const by = new Map();
    for (const u of report.users) { const k = depOf(u); if (!by.has(k)) by.set(k, []); by.get(k).push(u); }
    out.groups = [...by.entries()].sort((a, b) => a[0].localeCompare(b[0], 'fa')).map(([label, list]) => ({ key: `d:${label}`, label, department: label, employees: list.length, types: acc(list) }));
  }
  return out;
}

/**
 * توزیع ساعت ورود (به وقت شرکت) روی رکوردهای دارای ورود در بازه.
 * @returns {{binMinutes, count, earliest, latest, median, bins: Array<{from,to,count}>}}  bins از اولین تا آخرین سطل غیرخالی، پیوسته (خالی‌ها صفر)
 */
function checkinDistribution({ users, from, to, binMinutes = 30, context } = {}) {
  if (!BIN_SIZES.includes(binMinutes)) throw new AnalyticsError('INVALID_BIN', `binMinutes باید یکی از ${BIN_SIZES.join('، ')} باشد.`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '') || from > to) throw new AnalyticsError('INVALID_RANGE', 'from و to باید YYYY-MM-DD معتبر و from ≤ to باشند.');
  const days = Math.round((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000) + 1;
  if (days > MAX_RANGE_DAYS) throw new AnalyticsError('RANGE_TOO_LARGE', `بازه نباید بیشتر از ${MAX_RANGE_DAYS} روز باشد.`);
  const ctx = context || dayService.loadContext();
  const records = users.length ? attendanceRepository.listByUserIdsAndRange(users.map((u) => u.id), from, to) : [];
  const mins = [];
  let invalid = 0;
  for (const r of records) {
    if (!r.check_in_time) continue;
    let m;
    try { m = minutesSinceMidnight(r.check_in_time, ctx.timezone); } catch (_) { m = NaN; }
    if (Number.isFinite(m)) mins.push(Math.floor(m)); else invalid += 1;
  }
  mins.sort((a, b) => a - b);
  const base = { from, to, binMinutes, count: mins.length, invalidCount: invalid };
  if (!mins.length) return { ...base, earliest: null, latest: null, median: null, bins: [] };
  const counts = new Map();
  for (const m of mins) { const k = Math.floor(m / binMinutes); counts.set(k, (counts.get(k) || 0) + 1); }
  const lo = Math.floor(mins[0] / binMinutes);
  const hi = Math.floor(mins[mins.length - 1] / binMinutes);
  const bins = [];
  for (let k = lo; k <= hi; k += 1) bins.push({ from: hhmm(k * binMinutes), to: hhmm(Math.min(1440, (k + 1) * binMinutes) % 1440), count: counts.get(k) || 0 });
  const mid = mins.length % 2 ? mins[(mins.length - 1) / 2] : Math.round((mins[mins.length / 2 - 1] + mins[mins.length / 2]) / 2);
  return { ...base, earliest: hhmm(mins[0]), latest: hhmm(mins[mins.length - 1]), median: hhmm(mid), bins };
}

module.exports = { rankOvertime, rankShortfall, attendanceRate, leaveByType, checkinDistribution, parseLimit, MAX_LIMIT, BIN_SIZES };

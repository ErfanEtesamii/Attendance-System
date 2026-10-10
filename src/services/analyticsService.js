// تحلیل روند تأخیر (S5-6a): روند هفتگی/ماهانه (کل، به‌تفکیک دپارتمان یا فرد) و مقایسه‌ی یک ماه شمسی با ماه قبل.
//
// «تأخیر» همان تعریف موتور است (dayService.summarizeRecord: lateMinutes > 0، با شیفت/تنظیمات هر کاربر)، نه شرط جدای SQL؛
// پس عدد تحلیل با گزارش ماهانه/روزانه ناسازگار نمی‌شود. SQL فقط در repository است (رکوردها یک‌جا با IN خوانده می‌شوند، بدون N+1).
// نرخ تأخیر = روز با تأخیر ÷ روز حضور (روزی که ورود دارد)؛ حضور صفر ⇒ null (نه صفر و نه تقسیم بر صفر).
// هفته‌ی شمسی از «شنبه» شروع می‌شود. بازه‌ی هر سطل کامل (۷ روزه / کل ماه) گزارش می‌شود؛ فقط رکوردهای داخل [from, to] شمرده می‌شوند.
// سطل‌های بدون رکورد هم با صفر می‌آیند تا نمودار (S5-7a) سوراخ نداشته باشد.

const jalaali = require('jalaali-js');
const attendanceRepository = require('../repositories/attendanceRepository');
const dayService = require('../engine/dayService');
const { MONTH_NAMES, jalaliMonthRangeOf } = require('../utils/jalali');
const { todayDateString } = require('../utils/serverTime');

const MAX_RANGE_DAYS = 800; // ≈ ۲ سال و کمی بیشتر؛ سقف حجم محاسبه
const MAX_SERIES = 100; // سقف تعداد سری (کاربر/دپارتمان) در یک پاسخ
const NO_DEPARTMENT = 'بدون دپارتمان';

class AnalyticsError extends Error {
  constructor(code, message) { super(message); this.name = 'AnalyticsError'; this.code = code; }
}

const pad = (n) => String(n).padStart(2, '0');
const toIso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const parseIso = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const addDays = (iso, n) => { const d = parseIso(iso); d.setUTCDate(d.getUTCDate() + n); return toIso(d); };
const diffDays = (a, b) => Math.round((parseIso(b) - parseIso(a)) / 86400000);

// شنبه = ۰ … جمعه = ۶
const saturdayIndex = (iso) => (parseIso(iso).getUTCDay() + 1) % 7;
const weekStartOf = (iso) => addDays(iso, -saturdayIndex(iso));
function jalaliOf(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return jalaali.toJalaali(y, m, d);
}
const jalaliLabel = (iso) => { const j = jalaliOf(iso); return `${j.jy}/${pad(j.jm)}/${pad(j.jd)}`; };

// فهرست سطل‌های پیوسته‌ی پوشاننده‌ی [from, to]
function makeBuckets(from, to, granularity) {
  const out = [];
  if (granularity === 'week') {
    for (let s = weekStartOf(from); s <= to; s = addDays(s, 7)) {
      out.push({ key: s, from: s, to: addDays(s, 6), label: `هفته‌ی ${jalaliLabel(s)}` });
    }
    return out;
  }
  let { jy, jm } = jalaliOf(from);
  const last = jalaliOf(to);
  while (jy < last.jy || (jy === last.jy && jm <= last.jm)) {
    const r = jalaliMonthRangeOf(jy, jm);
    out.push({ key: `${jy}-${pad(jm)}`, from: r.from, to: r.to, label: `${MONTH_NAMES[jm - 1]} ${jy}` });
    jm += 1;
    if (jm > 12) { jm = 1; jy += 1; }
  }
  return out;
}

function bucketKeyOf(iso, granularity) {
  if (granularity === 'week') return weekStartOf(iso);
  const j = jalaliOf(iso);
  return `${j.jy}-${pad(j.jm)}`;
}

const emptyStat = () => ({ presentDays: 0, lateCount: 0, lateMinutes: 0 });
const finish = (s) => ({ ...s, lateRate: s.presentDays > 0 ? Math.round((s.lateCount / s.presentDays) * 10000) / 10000 : null });

// رکوردها ⇒ برای هر رکورد { userId, date, late, lateMinutes } (فقط رکورد دارای ورود)
function lateFacts(users, from, to, context) {
  const ids = users.map((u) => u.id);
  const records = attendanceRepository.listByUserIdsAndRange(ids, from, to);
  const facts = [];
  for (const r of records) {
    if (!r.check_in_time) continue;
    const s = dayService.summarizeRecord(r, { context });
    const lateMinutes = s.lateMinutes > 0 ? s.lateMinutes : 0;
    facts.push({ userId: r.user_id, date: r.record_date, late: lateMinutes > 0, lateMinutes });
  }
  return facts;
}

// کلید/برچسب سری هر کاربر برحسب groupBy
function seriesDefs(users, groupBy) {
  if (groupBy === 'user') return users.map((u) => ({ key: `u${u.id}`, label: u.full_name, userId: u.id, of: (x) => x.userId === u.id }));
  if (groupBy === 'department') {
    const deps = [...new Set(users.map((u) => (u.department || '').trim() || NO_DEPARTMENT))].sort((a, b) => a.localeCompare(b, 'fa'));
    const dep = new Map(users.map((u) => [u.id, (u.department || '').trim() || NO_DEPARTMENT]));
    return deps.map((d) => ({ key: `d:${d}`, label: d, department: d, of: (x) => dep.get(x.userId) === d }));
  }
  return [{ key: 'all', label: 'همه', of: () => true }];
}

function checkGroup(users, groupBy) {
  if (!['none', 'department', 'user'].includes(groupBy)) throw new AnalyticsError('INVALID_GROUP', 'groupBy باید none، department یا user باشد.');
  const defs = seriesDefs(users, groupBy);
  if (defs.length > MAX_SERIES) throw new AnalyticsError('TOO_MANY_SERIES', `تعداد سری‌ها (${defs.length}) از سقف ${MAX_SERIES} بیشتر است؛ با فیلتر دپارتمان محدودش کنید.`);
  return defs;
}

/**
 * روند تأخیر.
 * @param {{users: object[], from: string, to: string, granularity?: 'week'|'month', groupBy?: 'none'|'department'|'user', context?: object}} p
 * @returns {{from,to,granularity,groupBy,buckets: object[], series: Array<{key,label,userId?,department?,points: object[],total: object}>}}
 */
function lateTrend({ users, from, to, granularity = 'week', groupBy = 'none', context } = {}) {
  if (!['week', 'month'].includes(granularity)) throw new AnalyticsError('INVALID_GRANULARITY', 'granularity باید week یا month باشد.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '')) throw new AnalyticsError('INVALID_RANGE', 'from و to باید YYYY-MM-DD باشند.');
  if (from > to) throw new AnalyticsError('INVALID_RANGE', 'from نمی‌تواند بعد از to باشد.');
  if (diffDays(from, to) + 1 > MAX_RANGE_DAYS) throw new AnalyticsError('RANGE_TOO_LARGE', `بازه نباید بیشتر از ${MAX_RANGE_DAYS} روز باشد.`);
  const defs = checkGroup(users, groupBy);
  const ctx = context || dayService.loadContext();
  const buckets = makeBuckets(from, to, granularity);
  const facts = users.length ? lateFacts(users, from, to, ctx) : [];

  const series = defs.map((def) => {
    const acc = new Map(buckets.map((b) => [b.key, emptyStat()]));
    const total = emptyStat();
    for (const f of facts) {
      if (!def.of(f)) continue;
      const a = acc.get(bucketKeyOf(f.date, granularity));
      for (const t of [a, total]) { t.presentDays += 1; if (f.late) { t.lateCount += 1; t.lateMinutes += f.lateMinutes; } }
    }
    const s = { key: def.key, label: def.label, points: buckets.map((b) => ({ bucket: b.key, ...finish(acc.get(b.key)) })), total: finish(total) };
    if (def.userId !== undefined) s.userId = def.userId;
    if (def.department !== undefined) s.department = def.department;
    return s;
  });
  return { from, to, granularity, groupBy, buckets, series };
}

function previousMonthOf(year, month) { return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 }; }

function monthStats(facts, range, of) {
  const s = emptyStat();
  for (const f of facts) {
    if (f.date < range.from || f.date > range.to || !of(f)) continue;
    s.presentDays += 1;
    if (f.late) { s.lateCount += 1; s.lateMinutes += f.lateMinutes; }
  }
  return finish(s);
}

const pct = (cur, prev) => (prev > 0 ? Math.round(((cur - prev) / prev) * 10000) / 100 : null);
function delta(cur, prev) {
  return {
    lateCount: cur.lateCount - prev.lateCount,
    lateMinutes: cur.lateMinutes - prev.lateMinutes,
    lateCountPercent: pct(cur.lateCount, prev.lateCount), // null ⇒ ماه قبل تأخیری نداشته (درصد بی‌معنی)
    lateRatePoints: cur.lateRate === null || prev.lateRate === null ? null : Math.round((cur.lateRate - prev.lateRate) * 10000) / 10000, // اختلاف مطلق نرخ (۰.۰۵ = ۵ واحد درصد)
  };
}

/**
 * مقایسه‌ی تأخیر ماه شمسی با ماه قبلش (کل و به‌تفکیک groupBy).
 * ماه جاری هنوز تمام نشده ⇒ current.partial = true؛ برای مقایسه‌ی منصفانه «نرخ تأخیر» را ببینید نه تعداد.
 */
function compareLate({ users, year, month, groupBy = 'none', context, today = todayDateString() } = {}) {
  const cur = jalaliMonthRangeOf(year, month);
  const pm = previousMonthOf(year, month);
  const prev = jalaliMonthRangeOf(pm.year, pm.month);
  const defs = checkGroup(users, groupBy);
  const ctx = context || dayService.loadContext();
  const facts = users.length ? lateFacts(users, prev.from, cur.to, ctx) : [];
  const build = (of) => {
    const c = monthStats(facts, cur, of);
    const p = monthStats(facts, prev, of);
    return { current: c, previous: p, delta: delta(c, p) };
  };
  const total = build(() => true);
  return {
    year, month,
    current: { year, month, label: cur.label, from: cur.from, to: cur.to, partial: today <= cur.to, ...total.current },
    previous: { year: pm.year, month: pm.month, label: prev.label, from: prev.from, to: prev.to, ...total.previous },
    delta: total.delta,
    groupBy,
    groups: groupBy === 'none' ? [] : defs.map((d) => ({ key: d.key, label: d.label, ...(d.userId !== undefined ? { userId: d.userId } : {}), ...(d.department !== undefined ? { department: d.department } : {}), ...build(d.of) })),
  };
}

module.exports = { lateTrend, compareLate, makeBuckets, weekStartOf, AnalyticsError, MAX_RANGE_DAYS, MAX_SERIES, NO_DEPARTMENT };

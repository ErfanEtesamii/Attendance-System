// S5-7b: هشدار الگوها — «نشانه»ی آماری روی رفتار تردد (نه اتهام). فقط‌خواندنی و فقط API.
//
// منبع داده‌ها همان‌هایی است که بقیه‌ی تحلیل‌ها دارند، پس تعریف تأخیر/غیبت/تعطیلی با گزارش ماهانه یکی است:
//   • ریز روزانه‌ی ماه: computeMonthlyReport({ includeDays: true }) (وضعیت هر روز از موتور و تقویم/شیفت/مرخصی)
//   • ساعت‌های ورود/خروج: رکوردهای همان ماه (به وقت شرکت، دقت دقیقه)
//   • مبنای «افزایش ناگهانی»: lateTrend ماهانه‌ی چند ماه قبل (همان تعریف تأخیر موتور)
// قواعد خالص در utils/patternRules.js هستند؛ این‌جا فقط داده جمع و آستانه‌ها از تنظیمات (گروه «الگوهای رفتاری») خوانده می‌شود.
// ماه همیشه «زنده» محاسبه می‌شود (ماه بسته‌شده هم؛ ویرایشش قفل است پس عدد زنده با snapshot برابر می‌ماند).
// اسکوپ کاربران را فراخواننده تعیین می‌کند (route با visibleUsers/canAccessUser)؛ این سرویس خودش دسترسی نمی‌سنجد.

const attendanceRepository = require('../repositories/attendanceRepository');
const dayService = require('../engine/dayService');
const { computeMonthlyReport } = require('./monthlyReportService');
const { lateTrend, MAX_SERIES } = require('./analyticsService');
const { jalaliMonthRangeOf } = require('../utils/jalali');
const { minutesSinceMidnight } = require('../utils/time');
const rules = require('../utils/patternRules');

const DISCLAIMER = 'این‌ها «نشانه/الگو»ی آماری هستند، نه اتهام یا حکم؛ پیش از هر برداشتی با خودِ فرد و شرایط کاری‌اش (جابه‌جایی شیفت، مأموریت، ثبت دستی و…) بررسی شود.';

const RULE_META = [
  { id: 'consecutive_late', title: 'تأخیر پشت‌سرهم', threshold: 'consecutiveLateDays' },
  { id: 'weekday_late', title: 'تأخیر مکرر یک روز هفته', threshold: 'weekdayLateMinCount' },
  { id: 'weekend_adjacent_absence', title: 'غیبت چسبیده به آخر هفته/تعطیلی', threshold: 'weekendAbsenceMinCount' },
  { id: 'sudden_increase', title: 'افزایش ناگهانی تأخیر', threshold: 'suddenIncreaseFactor' },
  { id: 'identical_times', title: 'ساعت‌های دقیقاً یکسان', threshold: 'identicalTimeMinDays' },
];

// تنظیمات ⇒ آستانه‌ها (یک‌جا، تا تست و route از همین نقشه استفاده کنند)
function thresholdsFrom(s) {
  return {
    consecutiveLateDays: s.patternConsecutiveLateDays,
    weekdayLateMinCount: s.patternWeekdayLateMinCount,
    weekdayLateMinSharePercent: s.patternWeekdayLateMinSharePercent,
    weekdayLateMarginPercent: s.patternWeekdayLateMarginPercent,
    weekendAbsenceMinCount: s.patternWeekendAbsenceMinCount,
    weekendAbsenceMinSharePercent: s.patternWeekendAbsenceMinSharePercent,
    suddenIncreaseFactor: s.patternSuddenIncreaseFactor,
    suddenIncreaseMinExtraLate: s.patternSuddenIncreaseMinExtraLate,
    baselineMonths: s.patternBaselineMonths,
    baselineMinMonths: s.patternBaselineMinMonths,
    minPresentDays: s.patternMinPresentDays,
    identicalTimeMinDays: s.patternIdenticalTimeMinDays,
    identicalTimeMinSharePercent: s.patternIdenticalTimeMinSharePercent,
  };
}

function shiftMonth(year, month, delta) {
  const idx = year * 12 + (month - 1) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}
const bucketKey = (year, month) => `${year}-${String(month).padStart(2, '0')}`;

// ساعت ورود/خروج هر کاربر به دقیقه‌ی وقت شرکت؛ زمان نامعتبر ⇒ NaN (قاعده نادیده می‌گیرد)
function timesByUser(ids, range, timezone) {
  const out = new Map();
  if (!ids.length) return out;
  const minute = (v) => { if (!v) return null; try { const m = minutesSinceMidnight(v, timezone); return Number.isFinite(m) ? Math.floor(m) : NaN; } catch (_) { return NaN; } };
  for (const r of attendanceRepository.listByUserIdsAndRange(ids, range.from, range.to)) {
    if (!r.check_in_time) continue;
    if (!out.has(r.user_id)) out.set(r.user_id, []);
    out.get(r.user_id).push({ date: r.record_date, inMinute: minute(r.check_in_time), outMinute: minute(r.check_out_time) });
  }
  return out;
}

// مبنا و ماه جاری برای «افزایش ناگهانی»: ⇒ Map(userId ⇒ { current, baseline[] })
function monthlyLateStats(users, year, month, baselineMonths, context) {
  const first = shiftMonth(year, month, -baselineMonths);
  const from = jalaliMonthRangeOf(first.year, first.month).from;
  const to = jalaliMonthRangeOf(year, month).to;
  const curKey = bucketKey(year, month);
  const out = new Map();
  for (let i = 0; i < users.length; i += MAX_SERIES) { // سقف سری در یک پاسخ lateTrend
    const chunk = users.slice(i, i + MAX_SERIES);
    const trend = lateTrend({ users: chunk, from, to, granularity: 'month', groupBy: 'user', context });
    for (const s of trend.series) {
      const baseline = []; let current = { presentDays: 0, lateCount: 0 };
      for (const p of s.points) {
        if (p.bucket === curKey) current = { presentDays: p.presentDays, lateCount: p.lateCount };
        else baseline.push({ label: p.bucket, presentDays: p.presentDays, lateCount: p.lateCount });
      }
      out.set(s.userId, { current, baseline });
    }
  }
  return out;
}

/**
 * @param {{users: object[], year: number, month: number, now?: Date|string, context?: object}} p
 * @returns {object} { year, month, label, from, to, source, disclaimer, thresholds, rules[], summary, users[] } فقط کاربران دارای دست‌کم یک نشانه
 */
function detectPatterns({ users, year, month, now, context } = {}) {
  const ctx = context || dayService.loadContext();
  const t = thresholdsFrom(ctx.settings);
  const range = jalaliMonthRangeOf(year, month); // RangeError برای ورودی نامعتبر
  const list = Array.isArray(users) ? users.filter(Boolean) : [];
  const ids = list.map((u) => u.id);

  const report = computeMonthlyReport({ users: list, year, month, now, context: ctx, includeDays: true, includeBalances: false });
  const times = timesByUser(ids, range, ctx.timezone);
  const needIncrease = t.suddenIncreaseFactor > 0 && list.length > 0;
  const stats = needIncrease ? monthlyLateStats(list, year, month, t.baselineMonths, ctx) : new Map();

  const found = [];
  for (const rec of report.users) {
    const findings = [
      ...rules.consecutiveLate(rec.days, { minDays: t.consecutiveLateDays }),
      ...rules.weekdayLate(rec.days, { minCount: t.weekdayLateMinCount, minSharePercent: t.weekdayLateMinSharePercent, marginPercent: t.weekdayLateMarginPercent }),
      ...rules.weekendAdjacentAbsence(rec.days, { minCount: t.weekendAbsenceMinCount, minSharePercent: t.weekendAbsenceMinSharePercent }),
    ];
    const st = stats.get(rec.user.id);
    if (st) {
      findings.push(...rules.suddenIncrease(st.current, st.baseline, {
        factor: t.suddenIncreaseFactor, minExtraLate: t.suddenIncreaseMinExtraLate, minPresentDays: t.minPresentDays, minBaselineMonths: t.baselineMinMonths,
      }));
    }
    findings.push(...rules.identicalTimes(times.get(rec.user.id) || [], { minDays: t.identicalTimeMinDays, minSharePercent: t.identicalTimeMinSharePercent }));
    if (findings.length) found.push({ user: { id: rec.user.id, fullName: rec.user.fullName, personnelCode: rec.user.personnelCode || null, department: rec.user.department || null }, findings });
  }
  found.sort((a, b) => b.findings.length - a.findings.length || a.user.fullName.localeCompare(b.user.fullName, 'fa'));

  const byRule = Object.fromEntries(rules.RULE_IDS.map((id) => [id, 0]));
  let total = 0;
  for (const u of found) for (const f of u.findings) { byRule[f.rule] += 1; total += 1; }

  return {
    year, month, label: range.label, from: range.from, to: range.to, today: report.today, source: 'live',
    disclaimer: DISCLAIMER,
    thresholds: t,
    rules: RULE_META.map((m) => ({ id: m.id, title: m.title, enabled: t[m.threshold] > 0 })),
    summary: { usersAnalyzed: list.length, usersWithFindings: found.length, findings: total, byRule },
    users: found,
  };
}

module.exports = { detectPatterns, thresholdsFrom, shiftMonth, DISCLAIMER, RULE_META };

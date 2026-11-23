// Phase 20 — برآورد کارکرد ماهانه‌ی شخصی برای Mini App.
// نرخ فقط در repository خوانده می‌شود و هرگز به پاسخ API برنمی‌گردد.
const usersRepository = require('../repositories/usersRepository');
const disputeRepository = require('../repositories/disputeRepository');
const { computeMonthlyReport } = require('./monthlyReportService');
const { jalaliPartsOfDateString } = require('../utils/jalali');

// مبلغ یک بازه از روزهای کارکرد با نرخِ «همان روز» (تاریخچه‌ی نرخ). days: [{ date, minutes }]؛ timeline از usersRepository.getRateTimeline.
// بدون تغییر نرخ در بازه ⇒ دقیقاً فرمول قبلی (جمع دقیقه × نرخ، یک‌بار گرد)؛ با چند نرخ ⇒ جمع مبلغ روزها (روز بدون نرخ حساب نمی‌شود).
function amountForDays(days, timeline) {
  const withMinutes = days.filter((d) => Number(d.minutes) > 0);
  const total = withMinutes.reduce((t, d) => t + Number(d.minutes), 0);
  const rates = withMinutes.map((d) => usersRepository.rateOn(timeline, d.date));
  const distinct = new Set(rates.map((r) => (r === undefined ? null : r)));
  if (distinct.size <= 1) {
    const r = distinct.size ? [...distinct][0] : (timeline.current === undefined ? null : timeline.current);
    return { rateKt: r, amountToman: calculateAmountToman(total, r), multiRate: false };
  }
  let amount = 0;
  withMinutes.forEach((d, i) => { if (rates[i] != null) amount += calculateAmountToman(d.minutes, rates[i]); });
  return { rateKt: null, amountToman: amount, multiRate: true };
}

function calculateAmountToman(usefulMinutes, rateKt) {
  if (rateKt == null) return null;
  return Math.round(Number(usefulMinutes || 0) * Number(rateKt) * 1000 / 60);
}

function earningsForUser(user, settings, { today } = {}) {
  // این guard باید پیش از گزارش ماهانه باشد: /today بسیار پرتکرار است.
  if (!settings.showEarningsCard) return null;

  const timeline = usersRepository.getRateTimeline(user.id, 'rate');
  if (timeline.current == null && !timeline.rows.some((r) => r.value != null)) return null;

  const parts = jalaliPartsOfDateString(today);
  if (!parts) return null;
  const report = computeMonthlyReport({
    users: [user], year: parts.jy, month: parts.jm, includeDays: true, includeBalances: false,
  });
  const disputedDates = new Set(
    disputeRepository.listOpenInRange(report.from, report.to)
      .filter((dispute) => dispute.user_id === user.id)
      .map((dispute) => dispute.record_date)
      .filter(Boolean),
  );
  // مثل جمع ماهانه‌ی monthlyReportService: روزِ گذشته‌ی «ورود بدون خروج» (missing_checkout) ساعت مفیدِ بی‌معنا می‌دهد (موتور تا now می‌شمارد) و در جمع نمی‌آید.
  const excludedDays = [];
  const dayMinutes = [];
  const usefulMinutes = (report.users[0]?.days || []).reduce((total, day) => {
    if (disputedDates.has(day.date)) { excludedDays.push({ date: day.date, reason: 'open_dispute' }); return total; }
    if ((day.flags || []).includes('missing_checkout')) { excludedDays.push({ date: day.date, reason: 'missing_checkout' }); return total; }
    if (day.effectiveWithMission == null) return total;
    dayMinutes.push({ date: day.date, minutes: Number(day.effectiveWithMission) });
    return total + Number(day.effectiveWithMission);
  }, 0);
  const priced = amountForDays(dayMinutes, timeline);

  return {
    enabled: true,
    usefulMinutes,
    amountToman: priced.amountToman,
    monthLabel: report.label,
    excludedDays,
  };
}

module.exports = { calculateAmountToman, amountForDays, earningsForUser };

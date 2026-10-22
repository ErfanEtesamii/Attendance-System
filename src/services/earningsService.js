// Phase 20 — برآورد کارکرد ماهانه‌ی شخصی برای Mini App.
// نرخ فقط در repository خوانده می‌شود و هرگز به پاسخ API برنمی‌گردد.
const usersRepository = require('../repositories/usersRepository');
const disputeRepository = require('../repositories/disputeRepository');
const { computeMonthlyReport } = require('./monthlyReportService');
const { jalaliPartsOfDateString } = require('../utils/jalali');

function calculateAmountToman(usefulMinutes, rateKt) {
  if (rateKt == null) return null;
  return Math.round(Number(usefulMinutes || 0) * Number(rateKt) * 1000 / 60);
}

function earningsForUser(user, settings, { today } = {}) {
  // این guard باید پیش از گزارش ماهانه باشد: /today بسیار پرتکرار است.
  if (!settings.showEarningsCard) return null;

  const rateKt = usersRepository.getHourlyRateKt(user.id);
  if (rateKt == null) return null;

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
  const usefulMinutes = (report.users[0]?.days || []).reduce((total, day) => (
    disputedDates.has(day.date) ? total : total + Number(day.effectiveWithMission || 0)
  ), 0);

  return {
    enabled: true,
    usefulMinutes,
    amountToman: calculateAmountToman(usefulMinutes, rateKt),
    monthLabel: report.label,
  };
}

module.exports = { calculateAmountToman, earningsForUser };

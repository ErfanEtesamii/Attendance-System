// نرخ ساعتی و کسر بیمه تاریخ‌دار: تغییر از یک تاریخ به بعد اعمال می‌شود و ماه‌های قبل با مقدار قبلی می‌مانند.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { zonedTimeToUtc } = require('../src/utils/time');

describe('نرخ و بیمه تاریخ‌دار', () => {
  let F; let users; let attendance; let perf; let earnings;
  before(() => {
    resetDb(); F = require('./helpers/factories'); users = require('../src/repositories/usersRepository');
    attendance = require('../src/repositories/attendanceRepository'); perf = require('../src/services/performanceService'); earnings = require('../src/services/earningsService');
  });
  after(() => cleanup());

  test('بدون effectiveFrom: جایگزینی ساده مثل قبل؛ با آن: تاریخ‌دار', () => {
    const u = F.makeUser();
    users.setHourlyRateKt(u.id, 60);
    assert.equal(users.getHourlyRateKt(u.id, '2026-01-01'), 60);
    users.setHourlyRateKt(u.id, 80, { effectiveFrom: '2026-12-01' });
    assert.equal(users.getHourlyRateKt(u.id), 80); // ستون = آخرین مقدار
    assert.equal(users.getHourlyRateKt(u.id, '2026-11-30'), 60);
    assert.equal(users.getHourlyRateKt(u.id, '2026-12-01'), 80);
    users.setHourlyRateKt(u.id, 90); // جایگزینی ساده ⇒ تاریخچه پاک می‌شود و ستون/تاریخچه ناسازگار نمی‌ماند
    assert.equal(users.getHourlyRateKt(u.id, '2026-11-30'), 90);
  });

  test('بیمه هم تاریخ‌دار است', () => {
    const u = F.makeUser();
    users.setInsuranceDeductionToman(u.id, 2500000);
    users.setInsuranceDeductionToman(u.id, 3000000, { effectiveFrom: '2026-12-01' });
    assert.equal(users.getInsuranceDeductionToman(u.id, '2026-11-15'), 2500000);
    assert.equal(users.getInsuranceDeductionToman(u.id, '2026-12-15'), 3000000);
  });

  test('حقوق: تغییر نرخ وسط ماه ⇒ هر روز با نرخ همان روز؛ ماه قبل از تغییر با نرخ قبلی', () => {
    const u = F.makeUser();
    const T = (d, h) => zonedTimeToUtc(d, h, 'Asia/Tehran').toISOString();
    const mk = (d) => attendance.createManual({ userId: u.id, recordDate: d, checkInTime: T(d, '08:00'), checkOutTime: T(d, '09:00'), status: 'normal' });
    ['2026-12-02', '2026-12-10'].forEach(mk); // آذر ۱۴۰۵ (۱۱ و ۱۹ آذر)
    users.setHourlyRateKt(u.id, 60);
    users.setHourlyRateKt(u.id, 120, { effectiveFrom: '2026-12-05' });
    const dec = perf.monthlyPayroll({ users: [users.findById(u.id)], year: 1405, month: 9, now: '2026-12-31T12:00:00Z', withDays: true });
    const row = dec.rows[0];
    // روز اول ۶۰ هزار تومان/ساعت، روز دوم ۱۲۰ ⇒ ۶۰٬۰۰۰ + ۱۲۰٬۰۰۰ تومان
    assert.equal(row.amountToman, 180000);
    assert.equal(row.rateChanged, true);
    assert.equal(row.rateKt, 120); // نرخ پایان ماه
    // ماه آبان (قبل از تغییر): همان نرخ قبلی
    const nov = perf.monthlyPayroll({ users: [users.findById(u.id)], year: 1405, month: 8, now: '2026-12-31T12:00:00Z' });
    assert.equal(nov.rows[0].rateKt, 60);
  });

  test('کارت کارکرد Mini App با همان تاریخچه محاسبه می‌شود', () => {
    assert.equal(typeof earnings.amountForDays, 'function');
    const tl = { current: 120, rows: [{ from: '0000-00-00', value: 60 }, { from: '2026-12-05', value: 120 }] };
    assert.deepEqual(earnings.amountForDays([{ date: '2026-12-02', minutes: 60 }, { date: '2026-12-10', minutes: 60 }], tl).amountToman, 180000);
    assert.equal(earnings.amountForDays([{ date: '2026-12-10', minutes: 60 }], tl).amountToman, 120000);
  });
});

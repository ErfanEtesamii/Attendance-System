// خروجی xlsx حقوق و عملکرد (performanceExportService) روی دیتابیس نمونه: شکل شیت‌ها، ارقام، راهنما، و عدم نشت نرخ در خروجی عملکرد بدون payroll.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const attendanceRepo = require('../src/repositories/attendanceRepository');
const usersRepo = require('../src/repositories/usersRepository');
const settingsRepo = require('../src/repositories/settingsRepository');
const { getDb } = require('../src/db/connection');
const { zonedTimeToUtc } = require('../src/utils/time');
const { makeUser } = require('./helpers/factories');
const perf = require('../src/services/performanceService');
const { buildPayrollSheets, buildPerformanceSheets } = require('../src/services/performanceExportService');

describe('خروجی اکسل حقوق و عملکرد', () => {
  const at = (date, hhmm) => zonedTimeToUtc(date, hhmm, 'Asia/Tehran').toISOString();
  const rec = (userId, date, inn, out) => attendanceRepo.createManual({ userId, recordDate: date, checkInTime: at(date, inn), checkOutTime: out ? at(date, out) : null, status: 'normal' });
  let a; let b;
  before(() => {
    resetDb();
    settingsRepo.update({ overtimeEnabled: true });
    a = makeUser({ role: 'employee', name: 'الف', department: 'فنی' });
    b = makeUser({ role: 'employee', name: 'ب', department: 'مالی' });
    for (const u of usersRepo.listUsers({})) getDb().prepare("UPDATE users SET created_at = '2020-01-01 00:00:00' WHERE id = ?").run(u.id);
    usersRepo.setHourlyRateKt(a.id, 60); // هر دقیقه ۱۰۰۰ تومان؛ ب بدون نرخ
    rec(a.id, '2026-08-23', '08:00', '18:30'); rec(a.id, '2026-08-24', '08:40', '17:30'); rec(b.id, '2026-08-23', '09:00', '17:00');
  });
  after(() => cleanup());

  const users = () => usersRepo.listUsers({}).filter((u) => [a.id, b.id].includes(u.id));
  const col = (s, title) => s.headers.indexOf(title);
  const sameWidth = (sheets) => { for (const s of sheets) for (const r of s.rows) assert.equal(r.length, s.headers.length, `${s.name}: ${JSON.stringify(r)}`); };

  test('حقوق: شیت‌ها، جمع، بدون‌نرخ خالی، راهنما همه‌ی ستون‌ها را دارد', () => {
    const data = perf.monthlyPayrollCompared({ users: users(), year: 1405, month: 6, withDays: true });
    const sheets = buildPayrollSheets(data);
    assert.deepEqual(sheets.map((s) => s.name), ['حقوق کارکنان', 'ریز روزانه حقوق', 'دپارتمان‌ها', 'روزهای خارج‌شده', 'مشخصات گزارش', 'راهنما']);
    sameWidth(sheets);
    const [sum, daily] = sheets;
    assert.equal(sum.rows.length, 3, 'دو کارمند + ردیف جمع');
    const rowA = sum.rows.find((r) => r[0] === 'الف'); const rowB = sum.rows.find((r) => r[0] === 'ب');
    assert.equal(rowA[col(sum, 'نرخ ساعتی (هزار تومان)')], 60);
    assert.equal(rowA[col(sum, 'حقوق (تومان)')], rowA[col(sum, 'ساعت مفید (دقیقه)')] * 1000);
    assert.equal(rowB[col(sum, 'حقوق (تومان)')], '');
    assert.equal(rowB[col(sum, 'وضعیت')], 'بدون نرخ');
    assert.equal(sum.rows[2][0], 'جمع');
    assert.equal(sum.rows[2][col(sum, 'حقوق (تومان)')], rowA[col(sum, 'حقوق (تومان)')]);
    assert.ok(daily.rows.length >= 3);
    const guide = sheets[5];
    for (const s of sheets.slice(0, 4)) for (const h of s.headers) assert.ok(guide.rows.some((g) => g[0] === s.name && g[1] === h), `راهنما: ${s.name}/${h}`);
  });

  test('عملکرد: خلاصه، رتبه، ریز روزانه، روند تیم؛ با payroll نرخ می‌آید و بدون آن نمی‌آید', () => {
    const range = perf.resolveRange({ range: 'custom', from: '2026-08-22', to: '2026-08-28', today: '2026-08-30' });
    for (const withPay of [true, false]) {
      const data = perf.teamDetailed({ users: users(), range, now: '2026-08-30T10:00:00Z', includePayroll: withPay });
      const sheets = buildPerformanceSheets(data, { includePayroll: withPay });
      assert.deepEqual(sheets.map((s) => s.name), ['خلاصه عملکرد', 'ریز روزانه', 'روند روزانه تیم', 'دپارتمان‌ها', 'روز هفته', 'تسک‌ها و علت‌ها', 'مرخصی و مأموریت', 'مشخصات گزارش', 'راهنما']);
      sameWidth(sheets);
      const [sum, daily, trend] = sheets;
      assert.equal(sum.rows.length, 2);
      const rowA = sum.rows.find((r) => r[col(sum, 'نام کارمند')] === 'الف');
      assert.ok(rowA[col(sum, 'ساعت مفید (دقیقه)')] > 0);
      assert.equal(rowA[col(sum, 'میانگین ساعت ورود')] !== '', true);
      assert.equal(daily.rows.filter((r) => r[0] === 'الف').length, 7);
      assert.ok(trend.rows.length === 7);
      assert.equal(sum.headers.includes('حقوق بازه (تومان)'), withPay);
      assert.equal(daily.headers.includes('مبلغ روز (تومان)'), withPay);
      if (!withPay) assert.ok(!JSON.stringify(sheets).includes('نرخ ساعتی'), 'بدون payroll.read نرخ در هیچ شیتی نیست');
      if (withPay) assert.equal(rowA[col(sum, 'نرخ ساعتی (هزار تومان)')], 60);
      const guide = sheets[8];
      for (const s of sheets.slice(0, 7)) for (const h of s.headers) assert.ok(guide.rows.some((g) => g[0] === s.name && g[1] === h), `راهنما: ${s.name}/${h}`);
    }
  });
});

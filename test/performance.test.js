// عملکرد کارمند + حقوق: route واقعی + دیتابیس نمونه. نرخ فقط برای admin (payroll.read)؛ سرپرست/hr/کارمند هرگز نرخ و حقوق نمی‌بینند.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const attendanceRepo = require('../src/repositories/attendanceRepository');
const usersRepo = require('../src/repositories/usersRepository');
const settingsRepo = require('../src/repositories/settingsRepository');
const { getDb } = require('../src/db/connection');
const { zonedTimeToUtc } = require('../src/utils/time');
const { makeUser, sessionCookie } = require('./helpers/factories');
const perf = require('../src/services/performanceService');

describe('resolveRange (خالص)', () => {
  test('پیش‌تنظیم‌ها نسبت به امروز؛ دوره‌ی قبل هم‌طول و چسبیده', () => {
    const r = perf.resolveRange({ range: '6d', today: '2026-08-30' });
    assert.deepEqual([r.from, r.to, r.days], ['2026-08-25', '2026-08-30', 6]);
    assert.deepEqual(r.previous, { from: '2026-08-19', to: '2026-08-24' });
    assert.equal(perf.resolveRange({ range: '24h', today: '2026-08-30' }).days, 1);
    assert.equal(perf.resolveRange({ today: '2026-08-30' }).days, 30);
  });
  test('ورودی نامعتبر ⇒ PerformanceError', () => {
    for (const bad of [{ range: 'x' }, { range: 'custom' }, { range: 'custom', from: '2026-09-02', to: '2026-09-01' }, { range: 'custom', from: '2020-01-01', to: '2026-01-01' }]) {
      assert.throws(() => perf.resolveRange({ ...bad, today: '2026-08-30' }), perf.PerformanceError);
    }
  });
});

describe('API عملکرد و حقوق', () => {
  const at = (date, hhmm) => zonedTimeToUtc(date, hhmm, 'Asia/Tehran').toISOString();
  const rec = (userId, date, inn, out) => attendanceRepo.createManual({ userId, recordDate: date, checkInTime: at(date, inn), checkOutTime: out ? at(date, out) : null, status: 'normal' });
  let server; let base; let a; const ck = {};
  before(async () => {
    resetDb();
    settingsRepo.update({ overtimeEnabled: true });
    const admin = makeUser({ role: 'admin', name: 'ادمین' });
    const manager = makeUser({ role: 'manager', name: 'سرپرست' });
    const hr = makeUser({ role: 'hr', name: 'منابع' });
    a = makeUser({ role: 'employee', name: 'الف', managerId: manager.id });
    const other = makeUser({ role: 'employee', name: 'ب' });
    for (const u of usersRepo.listUsers({})) getDb().prepare("UPDATE users SET created_at = '2020-01-01 00:00:00' WHERE id = ?").run(u.id);
    usersRepo.setHourlyRateKt(a.id, 60); // ۶۰ هزار تومان/ساعت ⇒ هر دقیقه دقیقاً ۱۰۰۰ تومان
    rec(a.id, '2026-08-23', '08:00', '18:30'); rec(a.id, '2026-08-24', '08:40', '17:30'); rec(other.id, '2026-08-23', '09:00', '17:00');
    Object.assign(ck, { admin: sessionCookie(admin.id), manager: sessionCookie(manager.id), hr: sessionCookie(hr.id), employee: sessionCookie(a.id), otherId: other.id });
    const { createApp } = require('../src/server');
    server = createApp().listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => { if (server) server.close(); cleanup(); });
  const call = async (who, u) => { const r = await fetch(base + u, { headers: { cookie: ck[who], 'x-requested-with': 'AttendancePanel' } }); return { status: r.status, json: await r.json().catch(() => ({})) }; };
  const RANGE = 'range=custom&from=2026-08-22&to=2026-08-28';

  test('ادمین: سری روزانه + مقایسه + حقوق دقیق (دقیقه × ۱۰۰۰ تومان)', async () => {
    const r = await call('admin', `/api/admin/performance/employee/${a.id}?${RANGE}`);
    assert.equal(r.status, 200);
    assert.ok(r.json.series.length >= 2);
    assert.ok(r.json.totals.useful > 0);
    assert.ok(r.json.previousTotals);
    assert.equal(r.json.hourly, null);
    assert.equal(r.json.payroll.rateKt, 60);
    assert.equal(r.json.payroll.amountToman, r.json.payroll.usefulMinutes * 1000);
  });

  test('نمای ۲۴ ساعت: ۲۴ سطل و جمع حضور ≈ مدت ورود تا خروج', async () => {
    const r = await call('admin', `/api/admin/performance/employee/${a.id}?range=custom&from=2026-08-23&to=2026-08-23`);
    assert.equal(r.json.hourly.hours.length, 24);
    const present = r.json.hourly.hours.reduce((t, h) => t + h.present, 0);
    assert.ok(Math.abs(present - 630) < 1, `present=${present}`);
  });

  test('سرپرست/hr: عملکرد بله، اما نرخ و حقوق هرگز', async () => {
    for (const who of ['manager', 'hr']) {
      const r = await call(who, `/api/admin/performance/employee/${a.id}?${RANGE}`);
      assert.equal(r.status, 200, who);
      assert.equal(r.json.payroll, undefined, who);
      assert.doesNotMatch(JSON.stringify(r.json), /rateKt|amountToman/);
      assert.equal((await call(who, '/api/admin/payroll?year=1405&month=6')).status, 403, who);
      assert.equal((await call(who, `/api/admin/payroll/${a.id}?year=1405&month=6`)).status, 403, who);
    }
  });

  test('اسکوپ: سرپرست کارمند تیم دیگر را نمی‌بیند؛ کارمند هیچ‌کدام', async () => {
    assert.equal((await call('manager', `/api/admin/performance/employee/${ck.otherId}?${RANGE}`)).status, 403);
    assert.equal((await call('employee', `/api/admin/performance/employee/${a.id}?${RANGE}`)).status, 403);
    assert.equal((await call('employee', '/api/admin/performance/team')).status, 403);
    assert.equal((await call('employee', '/api/admin/payroll?year=1405&month=6')).status, 403);
    const team = await call('manager', `/api/admin/performance/team?${RANGE}`);
    assert.deepEqual(team.json.rows.map((x) => x.user.id), [a.id]);
  });

  test('بازه‌ی نامعتبر ⇒ ۴۰۰', async () => {
    assert.equal((await call('admin', `/api/admin/performance/employee/${a.id}?range=bogus`)).status, 400);
    assert.equal((await call('admin', `/api/admin/performance/employee/abc?${RANGE}`)).status, 400);
    assert.equal((await call('admin', '/api/admin/payroll?year=1405&month=13')).status, 400);
  });

  test('حقوق ماهانه: جمع = مجموع ردیف‌ها؛ کارمند بدون نرخ در جمع نمی‌آید؛ ریز روزانه', async () => {
    const r = await call('admin', '/api/admin/payroll?year=1405&month=6');
    assert.equal(r.status, 200);
    const row = r.json.rows.find((x) => x.user.id === a.id);
    assert.equal(row.rateKt, 60);
    assert.equal(row.amountToman, row.usefulMinutes * 1000);
    const noRate = r.json.rows.find((x) => x.user.id === ck.otherId);
    assert.equal(noRate.amountToman, null);
    assert.equal(r.json.totals.amountToman, row.amountToman);
    assert.equal(r.json.totals.withoutRate >= 1, true);
    const d = await call('admin', `/api/admin/payroll/${a.id}?year=1405&month=6`);
    assert.equal(d.status, 200);
    assert.equal(d.json.days.length, 2);
  });
  test('داده‌ی غنی: بینش‌ها، دوره‌ی قبل، تسک/مرخصی/اعتراض، بازرسی روز و تجمیع تیم', async () => {
    const r = await call('admin', `/api/admin/performance/employee/${a.id}?${RANGE}`);
    assert.ok(Array.isArray(r.json.previousSeries));
    assert.equal(r.json.insights.byWeekday.length, 7);
    assert.ok(r.json.insights.presentDays >= 2);
    assert.ok(r.json.previousInsights);
    assert.ok(r.json.tasks && Array.isArray(r.json.tasks.reasons));
    assert.ok(Array.isArray(r.json.leaves));
    assert.equal(typeof r.json.disputes.open, 'number');
    const day = await call('admin', `/api/admin/performance/employee/${a.id}/day?date=2026-08-23`);
    assert.equal(day.status, 200);
    assert.equal(day.json.hourly.hours.length, 24);
    assert.ok(day.json.record.segments.length >= 1);
    assert.equal(day.json.payroll.rateKt, 60);
    assert.equal((await call('manager', `/api/admin/performance/employee/${a.id}/day?date=2026-08-23`)).json.payroll, undefined);
    assert.equal((await call('employee', `/api/admin/performance/employee/${a.id}/day?date=2026-08-23`)).status, 403);
    assert.equal((await call('admin', `/api/admin/performance/employee/${a.id}/day?date=bad`)).status, 400);
    const team = await call('admin', `/api/admin/performance/team?${RANGE}`);
    assert.ok(team.json.daily.length >= 2);
    assert.ok(team.json.departments.length >= 1);
    assert.ok(team.json.totals.attendanceRate != null);
    const pay = await call('admin', '/api/admin/payroll?year=1405&month=6');
    assert.ok(pay.json.previous && pay.json.previous.totals);
    assert.ok(Array.isArray(pay.json.departments));
  });
});

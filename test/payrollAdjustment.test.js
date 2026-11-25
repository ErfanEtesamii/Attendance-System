// تعدیل دستی حقوق ماهانه: فقط owner ثبت/حذف می‌کند؛ مبلغ = ساعت × نرخ پایان ماه؛ در حقوق ماهانه و خروجی اعمال می‌شود.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { zonedTimeToUtc } = require('../src/utils/time');

let hasDeps = true;
try { require.resolve('express'); } catch (_) { hasDeps = false; }

describe('تعدیل دستی حقوق', { skip: hasDeps ? false : 'express نصب نیست' }, () => {
  let server, base, owner, admin, ownerCookie, adminCookie, F, users, attendance, perf, u;
  before(async () => {
    resetDb();
    F = require('./helpers/factories'); users = require('../src/repositories/usersRepository');
    attendance = require('../src/repositories/attendanceRepository'); perf = require('../src/services/performanceService');
    const { createApp } = require('../src/server');
    owner = F.makeUser({ role: 'owner' }); admin = F.makeUser({ role: 'admin' });
    ownerCookie = F.sessionCookie(owner.id); adminCookie = F.sessionCookie(admin.id);
    server = createApp().listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
    u = F.makeUser();
    users.setHourlyRateKt(u.id, 60);
    const T = (d, h) => zonedTimeToUtc(d, h, 'Asia/Tehran').toISOString();
    attendance.createManual({ userId: u.id, recordDate: '2026-12-02', checkInTime: T('2026-12-02', '08:00'), checkOutTime: T('2026-12-02', '09:00'), status: 'normal' });
  });
  after(() => { if (server) server.close(); cleanup(); });
  const call = (cookie, method, url, body) => fetch(base + '/api' + url, { method, headers: { 'content-type': 'application/json', 'x-requested-with': 'AttendancePanel', cookie }, body: body ? JSON.stringify(body) : undefined });
  const row = () => perf.monthlyPayroll({ users: [users.findById(u.id)], year: 1405, month: 9, now: '2026-12-31T12:00:00Z' }).rows[0];

  test('admin ثبت نمی‌کند (۴۰۳)؛ owner می‌کند؛ ورودی نامعتبر ۴۰۰', async () => {
    const body = { year: 1405, month: 9, hours: -0.5, reason: 'توافق با شرکت' };
    assert.equal((await call(adminCookie, 'POST', `/admin/payroll/${u.id}/adjustments`, body)).status, 403);
    assert.equal((await call(ownerCookie, 'POST', `/admin/payroll/${u.id}/adjustments`, { ...body, hours: 0 })).status, 400);
    assert.equal((await call(ownerCookie, 'POST', `/admin/payroll/${u.id}/adjustments`, { ...body, reason: '' })).status, 400);
    assert.equal(row().amountToman, 60000);
    const ok = await call(ownerCookie, 'POST', `/admin/payroll/${u.id}/adjustments`, body);
    assert.equal(ok.status, 201);
  });

  test('کسر ۳۰ دقیقه ⇒ ۶۰٬۰۰۰ − ۳۰٬۰۰۰؛ ماه دیگر بی‌اثر؛ admin فهرست را می‌بیند؛ حذف برمی‌گرداند', async () => {
    const r = row();
    assert.equal(r.baseAmountToman, 60000);
    assert.equal(r.adjustmentMinutes, -30);
    assert.equal(r.adjustmentToman, -30000);
    assert.equal(r.amountToman, 30000);
    const other = perf.monthlyPayroll({ users: [users.findById(u.id)], year: 1405, month: 8, now: '2026-12-31T12:00:00Z' }).rows[0];
    assert.equal(other.adjustmentMinutes, 0);
    const list = await (await call(adminCookie, 'GET', `/admin/payroll/${u.id}/adjustments?year=1405&month=9`)).json();
    assert.equal(list.adjustments.length, 1);
    assert.equal((await call(adminCookie, 'DELETE', `/admin/payroll/adjustments/${list.adjustments[0].id}`)).status, 403);
    assert.equal((await call(ownerCookie, 'DELETE', `/admin/payroll/adjustments/${list.adjustments[0].id}`)).status, 200);
    assert.equal(row().amountToman, 60000);
  });
});

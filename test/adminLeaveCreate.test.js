// S4-10d: ثبت مرخصی/مأموریت توسط سرپرست/ادمین در پنل روی leaveService — دلیل اجباری، اسکوپ، معافیت از گذشته/پیش‌اطلاع، مانده و force فقط ادمین، audit؛
// و محاسبه‌ی دوباره‌ی مدت هنگام ویرایش تاریخ.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

describe('ثبت مرخصی توسط مدیر (S4-10d)', () => {
  let server; let base; let cookies; let U; let db; let annual; let settingsRepo; let balanceSvc;
  before(async () => {
    db = resetDb();
    const F = require('./helpers/factories');
    const typesRepo = require('../src/repositories/leaveTypesRepository');
    settingsRepo = require('../src/repositories/settingsRepository');
    balanceSvc = require('../src/services/leaveBalanceService');
    const { createApp } = require('../src/server');
    const manager = F.makeUser({ role: 'manager' });
    U = {
      admin: F.makeUser({ role: 'admin' }), hr: F.makeUser({ role: 'hr' }), manager,
      emp: F.makeUser({ managerId: manager.id }), other: F.makeUser(), employee: F.makeUser({ managerId: manager.id }),
    };
    annual = typesRepo.findByCode('annual');
    typesRepo.updateLeaveType(annual.id, { allowedUnits: ['day', 'half_day', 'hour'] });
    cookies = Object.fromEntries(Object.entries(U).map(([k, u]) => [k, F.sessionCookie(u.id)]));
    server = createApp().listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => { if (server) server.close(); cleanup(); });

  async function hit(role, method, url, body) {
    const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json', cookie: cookies[role], 'x-requested-with': 'AttendancePanel' }, body: method === 'GET' ? undefined : JSON.stringify(body || {}) });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  }
  const post = (role, body) => hit(role, 'POST', '/api/admin/leave-requests', body);
  const lastAudit = (action) => {
    const row = db.prepare('SELECT * FROM audit_log WHERE action = ? ORDER BY id DESC LIMIT 1').get(action);
    return row ? JSON.parse(row.details) : null;
  };

  test('دسترسی: کارمند و hr ممنوع؛ سرپرست فقط تیم خودش؛ دلیل اجباری', async () => {
    const body = { userId: U.emp.id, leaveTypeId: annual.id, startDate: '2027-02-01', endDate: '2027-02-01', reason: 'ثبت دستی' };
    assert.equal((await post('employee', body)).status, 403);
    assert.equal((await post('hr', body)).status, 403);
    assert.equal((await post('manager', { ...body, userId: U.other.id })).status, 403);
    assert.equal((await post('admin', { ...body, userId: 999999 })).status, 404);
    assert.equal((await post('admin', { ...body, reason: '  ' })).status, 400);
    assert.equal((await post('admin', { ...body, reason: undefined })).status, 400);
  });

  test('ثبت ساعتی توسط ادمین: وضعیت پیش‌فرض approved، مدت، audit با دلیل و before/after؛ endDate اختیاری', async () => {
    const r = await post('admin', { userId: U.emp.id, leaveTypeId: annual.id, unit: 'hour', startDate: '2027-02-02', startTime: '10:00', endTime: '12:00', reason: 'هماهنگی تلفنی' });
    assert.equal(r.status, 201);
    assert.deepEqual([r.json.unit, r.json.duration_minutes, r.json.status, r.json.approver_id], ['hour', 120, 'approved', U.admin.id]);
    const d = lastAudit('leave_request_created_by_admin');
    assert.equal(d.reason, 'هماهنگی تلفنی');
    assert.equal(d.changes.unit.after, 'hour');
    assert.equal(d.changes.duration_minutes.after, 120);
    assert.equal(d.force, false);
  });

  test('سرپرست برای تیمش؛ معاف از گذشته/پیش‌اطلاع؛ تداخل و واحدِ غیرمجاز رد می‌شود', async () => {
    settingsRepo.setValue('leaveAllowPastRequests', false);
    settingsRepo.setValue('leaveMinNoticeHours', 72);
    const ok = await post('manager', { userId: U.emp.id, leaveTypeId: annual.id, startDate: '2020-01-04', endDate: '2020-01-04', reason: 'ثبت با تأخیر' });
    assert.equal(ok.status, 201, 'گذشته‌ی دور هم برای مدیر مجاز است');
    settingsRepo.resetValue('leaveAllowPastRequests');
    settingsRepo.resetValue('leaveMinNoticeHours');
    const dup = await post('admin', { userId: U.emp.id, leaveTypeId: annual.id, startDate: '2020-01-04', endDate: '2020-01-04', reason: 'تکراری' });
    assert.equal(dup.status, 400);
    assert.equal(dup.json.code, 'OVERLAP');
    const mission = require('../src/repositories/leaveTypesRepository').findByCode('mission');
    const bad = await post('admin', { userId: U.emp.id, leaveTypeId: mission.id, unit: 'hour', startDate: '2027-02-03', startTime: '10:00', endTime: '11:00', reason: 'x' });
    assert.equal(bad.json.code, 'UNIT_NOT_ALLOWED');
  });

  test('مانده در حالت block: سرپرست رد می‌شود؛ force فقط ادمین و در audit ثبت می‌شود', async () => {
    settingsRepo.setValue('leaveBalancePolicy', 'block');
    const body = { userId: U.employee.id, leaveTypeId: annual.id, startDate: '2027-03-01', endDate: '2027-03-01', reason: 'ثبت' };
    const blocked = await post('manager', body);
    assert.equal(blocked.json.code, 'INSUFFICIENT_BALANCE');
    assert.equal((await post('manager', { ...body, force: true })).status, 403);
    assert.equal((await post('admin', body)).json.code, 'INSUFFICIENT_BALANCE');
    const forced = await post('admin', { ...body, force: true });
    assert.equal(forced.status, 201);
    assert.equal(lastAudit('leave_request_created_by_admin').force, true);
    balanceSvc.setEntitlement({ userId: U.employee.id, leaveTypeId: annual.id, jalaliYear: 1405, entitledMinutes: 100000, actor: U.admin.id, reason: 'تست' });
    assert.equal((await post('manager', { ...body, startDate: '2027-03-02', endDate: '2027-03-02' })).status, 201, 'با مانده‌ی کافی بدون force هم ثبت می‌شود');
    settingsRepo.resetValue('leaveBalancePolicy');
  });

  test('ویرایش تاریخ: مدت دوباره محاسبه می‌شود؛ تداخل با درخواست دیگر ⇒ ۴۰۰؛ ساعتی با دو روز ⇒ ۴۰۰', async () => {
    const a = await post('admin', { userId: U.other.id, leaveTypeId: annual.id, startDate: '2027-04-04', endDate: '2027-04-04', reason: 'الف' });
    const b = await post('admin', { userId: U.other.id, leaveTypeId: annual.id, startDate: '2027-04-07', endDate: '2027-04-07', reason: 'ب' });
    assert.equal(a.json.duration_minutes, 510);
    const ext = await hit('admin', 'PATCH', `/api/admin/leave-requests/${a.json.id}`, { endDate: '2027-04-05' });
    assert.equal(ext.status, 200);
    assert.equal(ext.json.duration_minutes, 1020);
    const clash = await hit('admin', 'PATCH', `/api/admin/leave-requests/${a.json.id}`, { endDate: '2027-04-07' });
    assert.equal(clash.status, 400);
    assert.equal(clash.json.code, 'OVERLAP');
    const hourly = await post('admin', { userId: U.other.id, leaveTypeId: annual.id, unit: 'hour', startDate: '2027-04-10', startTime: '09:00', endTime: '10:00', reason: 'ج' });
    const twoDays = await hit('admin', 'PATCH', `/api/admin/leave-requests/${hourly.json.id}`, { endDate: '2027-04-11' });
    assert.equal(twoDays.status, 400);
    assert.ok(b.json.id);
  });
});

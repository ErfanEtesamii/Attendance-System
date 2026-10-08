// S4-11a: زنجیره‌ی تأیید چندمرحله‌ای مرخصی — مراحل از تنظیمات، تصمیم سرپرست/ادمین/hr، رد در مرحله‌ی ۲، تک‌مرحله‌ای پیش‌فرض، سازگاری با درخواست بدون زنجیره.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

describe('زنجیره‌ی تأیید مرخصی (S4-11a)', () => {
  let server; let base; let cookies; let U; let db; let annual; let mission; let settingsRepo; let leaveService; let approvals; let leaveRepo;
  before(async () => {
    db = resetDb();
    const F = require('./helpers/factories');
    const typesRepo = require('../src/repositories/leaveTypesRepository');
    settingsRepo = require('../src/repositories/settingsRepository');
    leaveService = require('../src/services/leaveService');
    approvals = require('../src/services/leaveApprovalService');
    leaveRepo = require('../src/repositories/leaveRepository');
    const { createApp } = require('../src/server');
    const manager = F.makeUser({ role: 'manager' });
    U = {
      admin: F.makeUser({ role: 'admin' }), hr: F.makeUser({ role: 'hr' }), manager, manager2: F.makeUser({ role: 'manager' }),
      emp: F.makeUser({ managerId: manager.id }), loner: F.makeUser(),
    };
    annual = typesRepo.findByCode('annual');
    mission = typesRepo.findByCode('mission');
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
  const decide = (role, id, d, note) => hit(role, 'POST', `/api/admin/leave-requests/${id}/${d}`, note ? { note } : {});
  let dayN = 0;
  // هر تست روز تازه می‌گیرد تا تداخلی پیش نیاید؛ بازه‌ی span روزِ شنبه‌به‌بعد
  const make = (user, { type = annual, span = 1 } = {}) => {
    dayN += 1;
    const start = new Date(Date.UTC(2027, 7, 7 + dayN * 14)); // شنبه‌های دور از هم
    const end = new Date(start.getTime() + (span - 1) * 86400000);
    const iso = (d) => d.toISOString().slice(0, 10);
    const r = leaveService.create({ userId: user.id, leaveTypeId: type.id, startDate: iso(start), endDate: iso(end) });
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    return r.request;
  };
  const rows = (id) => approvals.getChain(id).map((r) => [r.step, r.approverRole, r.status, r.decidedBy]);
  const notifCount = (userId) => db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id = ?').get(userId).n;
  const reset = () => { for (const k of ['leaveApprovalExtraStepDays', 'leaveApprovalExtraStepTypes', 'leaveApprovalExtraStepRole']) settingsRepo.resetValue(k); };

  test('پیش‌فرض تک‌مرحله‌ای: سرپرست مستقیم تأیید می‌کند ⇒ approved؛ سرپرست دیگر ممنوع؛ کارمندِ بدون سرپرست ⇒ مرحله‌ی admin', async () => {
    reset();
    const req = make(U.emp);
    assert.deepEqual([req.current_step, rows(req.id).length], [1, 1]);
    assert.equal((await decide('manager2', req.id, 'approve')).status, 403);
    const ok = await decide('manager', req.id, 'approve');
    assert.deepEqual([ok.status, ok.json.status, ok.json.completed], [200, 'approved', true]);
    assert.deepEqual(rows(req.id), [[1, 'manager', 'approved', U.manager.id]]);
    assert.equal(leaveRepo.findById(req.id).current_step, null);
    assert.equal((await decide('admin', req.id, 'reject')).json.code, 'ALREADY_DECIDED');

    const solo = make(U.loner);
    assert.deepEqual(rows(solo.id).map((r) => r[1]), ['admin']);
    assert.equal((await decide('manager', solo.id, 'approve')).status, 403);
    assert.equal((await decide('admin', solo.id, 'approve')).json.status, 'approved');
  });

  test('بیش از N روز ⇒ دو مرحله: تأیید مرحله‌ی ۱ هنوز pending و بدون اعلان به کارمند؛ مرحله‌ی ۲ فقط admin؛ تأیید نهایی ⇒ اعلان', async () => {
    reset();
    settingsRepo.setValue('leaveApprovalExtraStepDays', 2);
    const short = make(U.emp, { span: 2 });
    assert.equal(rows(short.id).length, 1, 'دقیقاً N روز ⇒ بدون مرحله‌ی اضافه');
    const req = make(U.emp, { span: 3 });
    assert.deepEqual(rows(req.id).map((r) => r[1]), ['manager', 'admin']);
    const before = notifCount(U.emp.id);
    const s1 = await decide('manager', req.id, 'approve');
    assert.deepEqual([s1.status, s1.json.status, s1.json.completed, s1.json.nextRole, s1.json.current_step], [200, 'pending', false, 'admin', 2]);
    assert.equal(notifCount(U.emp.id), before, 'تصمیم میانی اعلانی برای کارمند ندارد');
    assert.equal((await decide('manager', req.id, 'approve')).status, 403, 'مرحله‌ی ۲ با ادمین است');
    const list = (await hit('admin', 'GET', '/api/admin/leave-requests?status=pending')).json.find((x) => x.id === req.id);
    assert.deepEqual([list.currentStep, list.awaitingRole], [2, 'admin']);
    const s2 = await decide('admin', req.id, 'approve');
    assert.deepEqual([s2.json.status, s2.json.completed], ['approved', true]);
    assert.equal(notifCount(U.emp.id), before + 1);
    assert.deepEqual(rows(req.id), [[1, 'manager', 'approved', U.manager.id], [2, 'admin', 'approved', U.admin.id]]);
  });

  test('رد در مرحله‌ی ۲ ⇒ کل درخواست رد؛ مرحله‌ی ۱ تأییدشده می‌ماند؛ audit مرحله‌ی میانی و نهایی', async () => {
    reset();
    settingsRepo.setValue('leaveApprovalExtraStepDays', 1);
    const req = make(U.emp, { span: 2 });
    await decide('manager', req.id, 'approve');
    const rej = await decide('admin', req.id, 'reject', 'بودجه');
    assert.deepEqual([rej.status, rej.json.status, rej.json.completed], [200, 'rejected', true]);
    assert.deepEqual(rows(req.id), [[1, 'manager', 'approved', U.manager.id], [2, 'admin', 'rejected', U.admin.id]]);
    assert.equal(approvals.getChain(req.id)[1].note, 'بودجه');
    const actions = db.prepare("SELECT action FROM audit_log WHERE action LIKE 'leave_request_%' ORDER BY id DESC LIMIT 2").all().map((r) => r.action);
    assert.deepEqual(actions, ['leave_request_rejected', 'leave_request_step_approved']);
  });

  test('رد در مرحله‌ی ۱ فوراً نهایی است و مرحله‌ی ۲ هرگز فعال نمی‌شود', async () => {
    reset();
    settingsRepo.setValue('leaveApprovalExtraStepTypes', 'annual');
    const req = make(U.emp);
    assert.equal(rows(req.id).length, 2);
    assert.equal((await decide('manager', req.id, 'reject')).json.status, 'rejected');
    assert.deepEqual(rows(req.id).map((r) => r[2]), ['rejected', 'pending']);
    assert.equal(leaveRepo.findById(req.id).current_step, null);
  });

  test('نوع خاص + نقش hr: hr فقط مرحله‌ی خودش را می‌تواند؛ ادمین هر مرحله را؛ نوع دیگر مرحله‌ی اضافه ندارد', async () => {
    reset();
    settingsRepo.setValue('leaveApprovalExtraStepTypes', 'annual, sick');
    settingsRepo.setValue('leaveApprovalExtraStepRole', 'hr');
    const req = make(U.emp);
    assert.deepEqual(rows(req.id).map((r) => r[1]), ['manager', 'hr']);
    assert.equal((await decide('hr', req.id, 'approve')).status, 403, 'نوبت سرپرست است');
    assert.equal((await decide('admin', req.id, 'approve')).json.completed, false, 'ادمین به‌جای سرپرست');
    assert.equal(approvals.getChain(req.id)[0].decidedBy, U.admin.id);
    assert.equal((await decide('manager', req.id, 'approve')).status, 403, 'نوبت hr است');
    const fin = await decide('hr', req.id, 'approve');
    assert.deepEqual([fin.status, fin.json.status], [200, 'approved']);
    assert.equal(rows(make(U.emp, { type: mission }).id).length, 1, 'نوع خارج از فهرست مرحله‌ی اضافه ندارد');
  });

  test('ادمین admin هر دو مرحله‌ی admin را یکی می‌کند؛ ثبت مستقیم توسط مدیر و PATCH وضعیت زنجیره را بازتنظیم می‌کند؛ درخواست بدون زنجیره تک‌مرحله‌ای است', async () => {
    reset();
    settingsRepo.setValue('leaveApprovalExtraStepTypes', 'annual');
    assert.deepEqual(rows(make(U.loner).id).map((r) => r[1]), ['admin'], 'بدون سرپرست + نقش admin ⇒ یک مرحله');

    const created = await hit('admin', 'POST', '/api/admin/leave-requests', { userId: U.emp.id, leaveTypeId: annual.id, startDate: '2028-01-08', endDate: '2028-01-08', reason: 'ثبت مدیر' });
    assert.equal(created.json.status, 'approved');
    assert.deepEqual([rows(created.json.id).length, leaveRepo.findById(created.json.id).current_step], [0, null]);
    const back = await hit('admin', 'PATCH', `/api/admin/leave-requests/${created.json.id}`, { status: 'pending' });
    assert.equal(back.status, 200);
    assert.deepEqual([rows(created.json.id).length, leaveRepo.findById(created.json.id).current_step], [2, 1]);
    assert.equal((await hit('admin', 'PATCH', `/api/admin/leave-requests/${created.json.id}`, { status: 'rejected' })).status, 200);
    assert.equal(rows(created.json.id).length, 0);

    const legacy = leaveRepo.createLeaveRequest({ userId: U.emp.id, startDate: '2028-02-06', endDate: '2028-02-06', leaveType: 'leave' });
    assert.equal(legacy.current_step, null);
    assert.equal(approvals.awaitingRole(legacy), 'manager');
    assert.equal((await decide('manager2', legacy.id, 'approve')).status, 403);
    assert.equal((await decide('manager', legacy.id, 'approve')).json.status, 'approved');
    reset();
  });

  test('حذف درخواست زنجیره‌اش را هم پاک می‌کند', async () => {
    reset();
    const req = make(U.emp);
    assert.equal((await hit('admin', 'DELETE', `/api/admin/leave-requests/${req.id}`)).status, 200);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM leave_approvals WHERE leave_request_id = ?').get(req.id).n, 0);
  });
});

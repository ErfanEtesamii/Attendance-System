// فاز D (بخش ۲): جانشین سرپرست — ستون deputy_id، قواعد اعتبارسنجی، فعال‌شدن فقط با غیبت سرپرست، تصمیم/اعلان/تسک فوری/اجازه‌ی ورود،
// حذف کاربر. بخش API فقط با express نصب‌شده اجرا می‌شود.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

let hasDeps = true;
try { require.resolve('express'); } catch (_) { hasDeps = false; }

describe('جانشین سرپرست — سرویس و مصرف‌کننده‌ها', () => {
  let db, F, users, deputySvc, approvals, leaveService, annual, events, lateLimit, urgent, repo;
  let mgr, dep, other, emp, admin, n = 0;

  before(() => {
    db = resetDb();
    F = require('./helpers/factories');
    users = require('../src/repositories/usersRepository');
    deputySvc = require('../src/services/supervisorDeputyService');
    approvals = require('../src/services/leaveApprovalService');
    leaveService = require('../src/services/leaveService');
    annual = require('../src/repositories/leaveTypesRepository').findByCode('annual');
    events = require('../src/services/notificationEvents');
    lateLimit = require('../src/services/lateLimitService');
    urgent = require('../src/services/urgentTaskService');
    repo = require('../src/repositories/leaveRepository');
    admin = F.makeUser({ role: 'admin' });
  });
  after(() => cleanup());
  beforeEach(() => {
    db.prepare('UPDATE users SET deputy_id = NULL').run();
    db.prepare('DELETE FROM notifications').run();
    mgr = F.makeUser({ role: 'manager' });
    dep = F.makeUser({ role: 'manager' });
    other = F.makeUser({ role: 'manager' });
    emp = F.makeUser({ managerId: mgr.id });
  });

  const fresh = (u) => users.findById(u.id);
  const setDeputy = (m, d) => users.updateUser(m.id, { deputy_id: d ? d.id : null });
  const make = (user) => {
    n += 1;
    // n-امین روز کاری (شنبه تا چهارشنبه) از ۲۰۲۸-۰۱-۰۱ (شنبه)؛ هر درخواست تاریخ متفاوت و کاری
    const d = new Date(Date.UTC(2028, 0, 1));
    d.setUTCDate(d.getUTCDate() + Math.floor(n / 5) * 7 + (n % 5));
    const start = d.toISOString().slice(0, 10);
    const r = leaveService.create({ userId: user.id, leaveTypeId: annual.id, startDate: start, endDate: start });
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    return r.request;
  };
  const notes = (userId, id) => db.prepare("SELECT * FROM notifications WHERE user_id = ? AND type = 'leave_requested'").all(userId).filter((x) => x.data.includes(`"requestId":${id}`));

  test('migration: ستون deputy_id هست و بدون جانشین هیچ اثری ندارد', () => {
    assert.ok(db.prepare("PRAGMA table_info('users')").all().some((c) => c.name === 'deputy_id'));
    assert.equal(fresh(mgr).deputy_id, null);
    assert.equal(deputySvc.activeDeputyOf(fresh(mgr)), null);
    const req = make(emp);
    assert.equal(approvals.canDecide(dep, repo.findById(req.id)), false);
    assert.equal(approvals.decidingDeputyOf(emp), null);
  });

  test('اعتبارسنجی انتخاب جانشین', () => {
    assert.equal(deputySvc.validateDeputy(mgr, dep), null);
    assert.ok(deputySvc.validateDeputy(mgr, mgr), 'خودش');
    assert.ok(deputySvc.validateDeputy(mgr, null), 'ناموجود');
    assert.ok(deputySvc.validateDeputy(mgr, admin), 'ادمین جانشین نمی‌شود');
    assert.ok(deputySvc.validateDeputy(mgr, F.makeUser({ role: 'employee' })), 'کارمند');
    assert.ok(deputySvc.validateDeputy(mgr, F.makeUser({ role: 'manager', active: false })), 'غیرفعال');
    assert.ok(deputySvc.validateDeputy(admin, dep), 'سرپرستِ هدف باید manager باشد');
  });

  test('فعال‌شدن جانشین فقط با غیبت سرپرست: مرخصی/ماموریت تمام‌روز یا غیرفعال بودن', () => {
    setDeputy(mgr, dep);
    const day = F.workdayDate(3);
    const now = new Date(`${day}T08:00:00Z`);
    assert.equal(deputySvc.isAbsent(fresh(mgr), { now }), false);
    assert.equal(deputySvc.activeDeputyOf(fresh(mgr), { now }), null, 'سرپرست حاضر است');
    F.makeApprovedMission(mgr.id, day);
    assert.equal(deputySvc.isAbsent(fresh(mgr), { now }), true);
    assert.equal(deputySvc.activeDeputyOf(fresh(mgr), { now }).id, dep.id);
    assert.equal(deputySvc.actsFor(fresh(dep), mgr.id, { now }), true);
    assert.equal(deputySvc.actsFor(fresh(other), mgr.id, { now }), false);
    assert.deepEqual(deputySvc.coveredManagers(fresh(dep), { now }).map((m) => m.id), [mgr.id]);
    // جانشین هم همان روز غایب باشد ⇒ نه
    F.makeApprovedMission(dep.id, day);
    assert.equal(deputySvc.activeDeputyOf(fresh(mgr), { now }), null);
    // روز دیگر (سرپرست حاضر) ⇒ نه
    assert.equal(deputySvc.activeDeputyOf(fresh(mgr), { now: new Date(`${F.workdayDate(4)}T08:00:00Z`) }), null);
    // غیرفعال‌بودن سرپرست ⇒ غایب؛ جانشین غیرفعال ⇒ هیچ
    const mgr2 = F.makeUser({ role: 'manager', active: false });
    const dep2 = F.makeUser({ role: 'manager' });
    setDeputy(mgr2, dep2);
    assert.equal(deputySvc.activeDeputyOf(fresh(mgr2)).id, dep2.id);
    users.updateUser(dep2.id, { is_active: 0 });
    assert.equal(deputySvc.activeDeputyOf(fresh(mgr2)), null);
  });

  test('تصمیم مرخصی: جانشینِ فعال می‌تواند؛ سرپرست حاضر ⇒ جانشین نمی‌تواند؛ دیگران نه؛ برای خودش نه', () => {
    setDeputy(mgr, dep);
    const req = make(emp);
    assert.equal(approvals.canDecide(fresh(dep), repo.findById(req.id)), false, 'سرپرست حاضر و فعال است');
    users.updateUser(mgr.id, { is_active: 0 });
    assert.equal(approvals.canDecide(fresh(dep), repo.findById(req.id)), true);
    assert.equal(approvals.canDecide(fresh(other), repo.findById(req.id)), false);
    assert.equal(approvals.decide({ requestId: req.id, actor: fresh(other), decision: 'approve' }).code, 'FORBIDDEN');
    // درخواست خودِ جانشین (عضو همین تیم) را خودش تصمیم نمی‌دهد
    users.updateUser(dep.id, { manager_id: mgr.id });
    const own = make(fresh(dep));
    assert.equal(approvals.canDecide(fresh(dep), repo.findById(own.id)), false);
    users.updateUser(dep.id, { manager_id: null });
    const ok = approvals.decide({ requestId: req.id, actor: fresh(dep), decision: 'approve' });
    assert.deepEqual([ok.ok, ok.finalStatus], [true, 'approved']);
    assert.equal(repo.findById(req.id).approver_id, dep.id);
    assert.equal(approvals.decide({ requestId: req.id, actor: admin, decision: 'reject' }).code, 'ALREADY_DECIDED');
  });

  test('اعلان: جانشینِ فعال علاوه بر ادمین‌ها گیرنده است؛ بدون غیبت یا بدون جانشین ⇒ مثل قبل', async () => {
    setDeputy(mgr, dep);
    const r1 = make(emp);
    await events.leaveRequested(r1);
    assert.equal(notes(dep.id, r1.id).length, 0, 'سرپرست حاضر ⇒ جانشین اعلان نمی‌گیرد');
    assert.equal(notes(mgr.id, r1.id).length, 1);
    users.updateUser(mgr.id, { is_active: 0 });
    const r2 = make(emp);
    await events.leaveRequested(r2);
    assert.equal(notes(dep.id, r2.id).length, 1);
    assert.equal(notes(admin.id, r2.id).length, 1);
    assert.equal(notes(mgr.id, r2.id).length, 0, 'سرپرستِ غیرفعال اعلان نمی‌گیرد');
    assert.equal(notes(other.id, r2.id).length, 0);
  });

  test('اجازه‌ی ورود و تسک فوری: جانشینِ فعال در محدوده‌ی تیم سرپرست', () => {
    setDeputy(mgr, dep);
    assert.equal(lateLimit.canDecide(fresh(dep), fresh(emp)), false);
    assert.equal(urgent.scopeFailure(fresh(dep), fresh(emp)).code, 'NOT_IN_SCOPE');
    users.updateUser(mgr.id, { is_active: 0 });
    assert.equal(lateLimit.canDecide(fresh(dep), fresh(emp)), true);
    assert.equal(urgent.scopeFailure(fresh(dep), fresh(emp)), null);
    assert.equal(lateLimit.canDecide(fresh(other), fresh(emp)), false);
    assert.equal(urgent.scopeFailure(fresh(other), fresh(emp)).code, 'NOT_IN_SCOPE');
    assert.equal(lateLimit.canDecide(admin, fresh(emp)), true);
  });

  test('حذف دائمی جانشین ⇒ deputy_id سرپرست NULL می‌شود', () => {
    setDeputy(mgr, dep);
    users.deleteUserPermanently(dep.id);
    assert.equal(fresh(mgr).deputy_id, null);
  });
});

describe('جانشین سرپرست — API', { skip: hasDeps ? false : 'express نصب نیست (npm install)' }, () => {
  let server, base, db, F, users, mgr, dep, emp, admin, hr, adminCookie;

  before(async () => {
    db = resetDb();
    F = require('./helpers/factories');
    users = require('../src/repositories/usersRepository');
    const { createApp } = require('../src/server');
    mgr = F.makeUser({ role: 'manager' });
    dep = F.makeUser({ role: 'manager' });
    emp = F.makeUser({ managerId: mgr.id });
    admin = F.makeUser({ role: 'admin' });
    hr = F.makeUser({ role: 'hr' });
    adminCookie = F.sessionCookie(admin.id);
    server = createApp().listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => { if (server) server.close(); cleanup(); });
  beforeEach(() => { db.prepare('UPDATE users SET deputy_id = NULL').run(); db.prepare('DELETE FROM audit_log').run(); });

  async function hit(cookie, method, url, body) {
    const res = await fetch(base + url, {
      method,
      headers: { 'content-type': 'application/json', 'x-requested-with': 'AttendancePanel', cookie },
      body: body && method !== 'GET' ? JSON.stringify(body) : undefined,
    });
    let json = null; try { json = await res.json(); } catch (_) { /* خالی */ }
    return { status: res.status, json };
  }
  const url = (id) => `/api/admin/supervisors/${id}/deputy`;
  const audits = () => db.prepare("SELECT action FROM audit_log WHERE action LIKE 'supervisor_deputy_%'").all();

  test('فقط admin/owner؛ manager/hr/employee ⇒ ۴۰۳', async () => {
    for (const u of [mgr, hr, emp]) {
      const c = F.sessionCookie(u.id);
      assert.equal((await hit(c, 'GET', url(mgr.id))).status, 403);
      assert.equal((await hit(c, 'PUT', url(mgr.id), { deputyId: dep.id, reason: 'x' })).status, 403);
    }
    assert.equal(users.findById(mgr.id).deputy_id, null);
  });

  test('PUT: دلیل اجباری، اعتبارسنجی، audit؛ همان مقدار ⇒ بدون audit؛ null ⇒ حذف', async () => {
    assert.equal((await hit(adminCookie, 'PUT', url(mgr.id), { deputyId: dep.id })).status, 400, 'بدون دلیل');
    assert.equal((await hit(adminCookie, 'PUT', url(mgr.id), { deputyId: mgr.id, reason: 'x' })).status, 400, 'خودش');
    assert.equal((await hit(adminCookie, 'PUT', url(mgr.id), { deputyId: admin.id, reason: 'x' })).status, 400, 'ادمین');
    assert.equal((await hit(adminCookie, 'PUT', url(mgr.id), { deputyId: 999999, reason: 'x' })).status, 404);
    assert.equal((await hit(adminCookie, 'PUT', url(emp.id), { deputyId: dep.id, reason: 'x' })).status, 400, 'هدف باید سرپرست باشد');
    assert.equal(audits().length, 0);
    const ok = await hit(adminCookie, 'PUT', url(mgr.id), { deputyId: dep.id, reason: 'مرخصی' });
    assert.deepEqual([ok.status, ok.json.changed], [200, true]);
    assert.equal(users.findById(mgr.id).deputy_id, dep.id);
    assert.deepEqual(audits().map((a) => a.action), ['supervisor_deputy_set']);
    const same = await hit(adminCookie, 'PUT', url(mgr.id), { deputyId: dep.id, reason: 'x' });
    assert.equal(same.json.changed, false);
    assert.equal(audits().length, 1);
    const clr = await hit(adminCookie, 'PUT', url(mgr.id), { deputyId: null, reason: 'برگشت' });
    assert.equal(clr.json.changed, true);
    assert.equal(users.findById(mgr.id).deputy_id, null);
    assert.deepEqual(audits().map((a) => a.action), ['supervisor_deputy_set', 'supervisor_deputy_cleared']);
  });

  test('GET: جانشین و گزینه‌ها؛ فهرست سرپرست‌ها فیلد deputy دارد', async () => {
    await hit(adminCookie, 'PUT', url(mgr.id), { deputyId: dep.id, reason: 'x' });
    const g = await hit(adminCookie, 'GET', url(mgr.id));
    assert.equal(g.status, 200);
    assert.equal(g.json.deputy.id, dep.id);
    assert.ok(g.json.candidates.some((c) => c.id === dep.id));
    assert.ok(!g.json.candidates.some((c) => c.id === mgr.id));
    const list = await hit(adminCookie, 'GET', '/api/admin/supervisors');
    const row = list.json.supervisors.find((s) => s.id === mgr.id);
    assert.equal(row.deputy.id, dep.id);
    assert.equal(row.deputy.covering, false);
  });
});

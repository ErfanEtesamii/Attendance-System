// S4-4a: نقش hr (منابع انسانی) — دیدن همه‌ی کاربران بدون اسکوپ تیم، ابطال نشست با تغییر نقش، ساخت کاربر hr.
// ماتریس کامل نقش × route (شامل hr) در test/permissionRoutes.test.js است.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

let hasDeps = true;
try { require.resolve('express'); } catch (_) { hasDeps = false; }

describe('نقش hr (S4-4a)', { skip: hasDeps ? false : 'express نصب نیست (npm install)' }, () => {
  let server, base, f, usersRepository, leaveRepository;
  let admin, hr, mgrA, mgrB, empA, empB, loose;

  before(async () => {
    resetDb();
    f = require('./helpers/factories');
    usersRepository = require('../src/repositories/usersRepository');
    leaveRepository = require('../src/repositories/leaveRepository');
    const { createApp } = require('../src/server');
    admin = f.makeUser({ role: 'admin' });
    hr = f.makeUser({ role: 'hr' });
    mgrA = f.makeUser({ role: 'manager' });
    mgrB = f.makeUser({ role: 'manager' });
    empA = f.makeUser({ role: 'employee', managerId: mgrA.id });
    empB = f.makeUser({ role: 'employee', managerId: mgrB.id });
    loose = f.makeUser({ role: 'employee' }); // بدون سرپرست
    for (const e of [empA, empB]) {
      leaveRepository.createLeaveRequest({ userId: e.id, startDate: '2026-09-20', endDate: '2026-09-20', leaveType: 'leave', reason: 'تست' });
    }
    server = createApp().listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => { if (server) server.close(); cleanup(); });

  async function hit(cookie, method, url, body) {
    const headers = { 'content-type': 'application/json', 'x-requested-with': 'AttendancePanel', cookie };
    const res = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    let json = null;
    try { json = await res.json(); } catch (_) { /* بدنه خالی */ }
    return { status: res.status, json };
  }
  const ids = (j) => (Array.isArray(j) ? j : j.users || j.items || []).map((u) => u.id).sort((a, b) => a - b);

  test('hr همه‌ی کاربران و مرخصی‌ها را می‌بیند (بدون اسکوپ تیم)؛ سرپرست فقط تیم خودش', async () => {
    const all = usersRepository.listUsers({}).map((u) => u.id).sort((a, b) => a - b);
    const asHr = await hit(f.sessionCookie(hr.id), 'GET', '/api/admin/users');
    assert.equal(asHr.status, 200);
    assert.deepEqual(ids(asHr.json), all);
    const asMgr = await hit(f.sessionCookie(mgrA.id), 'GET', '/api/admin/users');
    assert.deepEqual(ids(asMgr.json), [empA.id]);

    const leaves = await hit(f.sessionCookie(hr.id), 'GET', '/api/admin/leave-requests?status=all');
    assert.equal(leaves.status, 200);
    assert.deepEqual(leaves.json.map((r) => r.employee.id).sort((a, b) => a - b), [empA.id, empB.id]);
    const det = await hit(f.sessionCookie(hr.id), 'GET', `/api/admin/users/${loose.id}/details`);
    assert.equal(det.status, 200); // کاربر بدون سرپرست هم قابل مشاهده است
    assert.deepEqual(det.json.audit, [], 'سابقه‌ی ممیزی فقط برای admin است');
  });

  test('تغییر نقش به hr: session_version بالا می‌رود و نشست قبلی باطل می‌شود؛ نشست جدید نقش hr دارد', async () => {
    const target = f.makeUser({ role: 'employee' });
    const oldCookie = f.sessionCookie(target.id, { sessionVersion: usersRepository.findById(target.id).session_version, globalEpoch: 0 });
    assert.equal((await hit(oldCookie, 'GET', '/api/admin/me')).status, 200);

    const patch = await hit(f.sessionCookie(admin.id), 'PATCH', `/api/admin/users/${target.id}`, { role: 'hr' });
    assert.equal(patch.status, 200);
    const after = usersRepository.findById(target.id);
    assert.equal(after.role, 'hr');
    assert.equal(after.session_version, target.session_version + 1);

    const stale = await hit(oldCookie, 'GET', '/api/admin/me');
    assert.equal(stale.status, 401);
    assert.equal(stale.json.code, 'SESSION_REVOKED');
    const fresh = await hit(f.sessionCookie(target.id, { sessionVersion: after.session_version, globalEpoch: 0 }), 'GET', '/api/admin/me');
    assert.equal(fresh.status, 200);
    assert.equal(fresh.json.role, 'hr');
  });

  test('ساخت کاربر با نقش hr توسط ادمین ذخیره می‌شود؛ نقش ناشناخته همچنان employee می‌شود؛ hr نمی‌تواند نقش/کاربر بسازد', async () => {
    const adminCookie = f.sessionCookie(admin.id);
    const made = await hit(adminCookie, 'POST', '/api/admin/users', { fullName: 'منابع انسانی ۲', role: 'hr' });
    assert.equal(made.status, 201);
    assert.equal(usersRepository.findById(made.json.id).role, 'hr');
    const odd = await hit(adminCookie, 'POST', '/api/admin/users', { fullName: 'ناشناخته', role: 'boss' });
    assert.equal(usersRepository.findById(odd.json.id).role, 'employee');

    const hrCookie = f.sessionCookie(hr.id);
    assert.equal((await hit(hrCookie, 'POST', '/api/admin/users', { fullName: 'x', role: 'admin' })).status, 403);
    assert.equal((await hit(hrCookie, 'PATCH', `/api/admin/users/${hr.id}`, { role: 'admin' })).status, 403);
    assert.equal(usersRepository.findById(hr.id).role, 'hr');
  });
});

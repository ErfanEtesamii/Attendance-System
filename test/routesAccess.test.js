// ماتریس دسترسی روی route های واقعی (نقش × route) با بالا آوردن اپ واقعی روی یک پورت تصادفی.
// نیاز به وابستگی‌های نصب‌شده پروژه دارد (express و ...)؛ اگر نصب نباشند این فایل skip می‌شود.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

let hasDeps = true;
try {
  require.resolve('express');
} catch (_) {
  hasDeps = false;
}

describe('ماتریس نقش × route (/api/admin/*)', { skip: hasDeps ? false : 'express نصب نیست (npm install)' }, () => {
  let server, base, admin, mgrA, mgrB, empA1, empA2, empB1;
  let cookies;

  before(async () => {
    resetDb();
    const { makeUser, sessionCookie } = require('./helpers/factories');
    const { createApp } = require('../src/server');
    admin = makeUser({ role: 'admin' });
    mgrA = makeUser({ role: 'manager' });
    mgrB = makeUser({ role: 'manager' });
    empA1 = makeUser({ role: 'employee', managerId: mgrA.id });
    empA2 = makeUser({ role: 'employee', managerId: mgrA.id });
    empB1 = makeUser({ role: 'employee', managerId: mgrB.id });
    cookies = {
      none: undefined,
      employee: sessionCookie(empA1.id),
      managerA: sessionCookie(mgrA.id),
      admin: sessionCookie(admin.id),
    };
    server = createApp().listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => {
    if (server) server.close();
    cleanup();
  });

  async function hit(role, method, url, body) {
    const headers = { 'content-type': 'application/json', 'x-requested-with': 'AttendancePanel' };
    if (cookies[role]) headers.cookie = cookies[role];
    const res = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    let json = null;
    try { json = await res.json(); } catch (_) { /* بدنه خالی */ }
    return { status: res.status, json };
  }

  test('health عمومی است', async () => {
    assert.equal((await hit('none', 'GET', '/api/health')).status, 200);
  });

  test('همه routeهای /api/admin/* (جز ورود و public-config) بدون سشن ← ۴۰۱', async () => {
    const urls = [
      ['GET', '/api/admin/me'], ['GET', '/api/admin/dashboard'], ['GET', '/api/admin/users'],
      ['POST', '/api/admin/users'], ['GET', '/api/admin/settings'], ['PATCH', '/api/admin/settings'],
      ['GET', '/api/admin/audit-log'], ['GET', '/api/admin/system'], ['GET', '/api/admin/system/status'], ['POST', '/api/admin/broadcast'],
      ['GET', '/api/admin/overview'], ['GET', '/api/admin/attendance'], ['GET', '/api/admin/disputes'],
    ];
    for (const [m, u] of urls) assert.equal((await hit('none', m, u)).status, 401, `${m} ${u}`);
  });

  test('مسیرهای قدیمی فاز ۱ (/api/users، /api/attendance/*، /api/audit-log) حذف شده‌اند (۴۰۴ حتی برای ادمین)', async () => {
    for (const role of ['none', 'admin']) {
      for (const [m, u] of [
        ['GET', '/api/users'], ['POST', '/api/users'], ['GET', '/api/users/1'], ['PATCH', '/api/users/1'], ['DELETE', '/api/users/1'],
        ['GET', '/api/audit-log'], ['GET', '/api/attendance/today?userId=1'],
        ['POST', '/api/attendance/check-in'], ['POST', '/api/attendance/check-out'],
        ['POST', '/api/attendance/break/start'], ['POST', '/api/attendance/break/end'],
      ]) {
        assert.equal((await hit(role, m, u, m === 'GET' ? undefined : { userId: 1 })).status, 404, `${role} ${m} ${u}`);
      }
    }
  });

  test('ورود/پیکربندی عمومی پنل بدون سشن در دسترس است (نه ۴۰۱)', async () => {
    assert.equal((await hit('none', 'GET', '/api/admin/public-config')).status, 200);
    assert.notEqual((await hit('none', 'POST', '/api/admin/auth/code', { code: '00000000' })).status, 404);
  });

  test('کارمند: فقط لیست سفید؛ بقیه ۴۰۳', async () => {
    assert.equal((await hit('employee', 'GET', '/api/admin/me')).status, 200);
    for (const [m, u] of [
      ['GET', '/api/admin/users'], ['POST', '/api/admin/users'], ['GET', '/api/admin/settings'],
      ['GET', '/api/admin/audit-log'], ['GET', '/api/admin/system'], ['GET', '/api/admin/dashboard'],
      ['POST', '/api/admin/broadcast'],
    ]) {
      assert.equal((await hit('employee', m, u)).status, 403, `${m} ${u}`);
    }
  });

  test('کارمند فقط جزئیات خودش را می‌بیند، نه همکار هم‌تیمی را', async () => {
    assert.equal((await hit('employee', 'GET', `/api/admin/users/${empA1.id}/details`)).status, 200);
    assert.equal((await hit('employee', 'GET', `/api/admin/users/${empA2.id}/details`)).status, 403);
    assert.equal((await hit('employee', 'GET', `/api/admin/users/${empB1.id}/details`)).status, 403);
  });

  test('سرپرست: اسکوپ تیم خودش؛ عملیات فقط‌ادمین ۴۰۳', async () => {
    const users = await hit('managerA', 'GET', '/api/admin/users');
    assert.equal(users.status, 200);
    assert.deepEqual(users.json.map((u) => u.id).sort(), [empA1.id, empA2.id].sort());

    const dash = await hit('managerA', 'GET', '/api/admin/dashboard');
    assert.equal(dash.json.totalEmployees, 2);

    assert.equal((await hit('managerA', 'GET', `/api/admin/users/${empA1.id}`)).status, 200);
    assert.equal((await hit('managerA', 'GET', `/api/admin/users/${empB1.id}`)).status, 403);
    assert.equal((await hit('managerA', 'GET', `/api/admin/users/${empB1.id}/details`)).status, 403);

    for (const [m, u] of [
      ['POST', '/api/admin/users'], ['PATCH', `/api/admin/users/${empA1.id}`], ['DELETE', `/api/admin/users/${empA1.id}`],
      ['PATCH', '/api/admin/settings'], ['GET', '/api/admin/audit-log'], ['GET', '/api/admin/system'],
      ['POST', '/api/admin/broadcast'],
    ]) {
      assert.equal((await hit('managerA', m, u)).status, 403, `${m} ${u}`);
    }
  });

  test('ادمین: همه کاربران را می‌بیند و به عملیات مدیریتی دسترسی دارد', async () => {
    const users = await hit('admin', 'GET', '/api/admin/users');
    assert.equal(users.status, 200);
    assert.equal(users.json.length, 6);
    for (const u of ['/api/admin/settings', '/api/admin/audit-log', '/api/admin/system', '/api/admin/dashboard']) {
      assert.equal((await hit('admin', 'GET', u)).status, 200, u);
    }
  });

  test('مسیر ناشناخته زیر /api/admin بدون سشن ۴۰۱ و با سشن کارمند ۴۰۳ است (default-deny)', async () => {
    assert.equal((await hit('none', 'GET', '/api/admin/not-a-real-route')).status, 401);
    assert.equal((await hit('employee', 'GET', '/api/admin/not-a-real-route')).status, 403);
  });
});

test('این فایل بدون وابستگی‌ها هم بارگذاری می‌شود', () => assert.ok(true));

// ماتریس دسترسی سطح middleware (بدون نیاز به express): requireAdminAuth / requireStaff / requireFullAdmin / لیست سفید کارمند.
// ماتریس سطح route واقعی در test/routesAccess.test.js است (نیاز به express نصب‌شده).
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { requireAdminAuth, requireStaff, requireFullAdmin, EMPLOYEE_ALLOWED } = require('../src/middleware/adminAuth');
const usersRepository = require('../src/repositories/usersRepository');
const { makeUser, sessionCookie, fakeReq, runMiddleware } = require('./helpers/factories');

after(cleanup);

let admin, manager, employee;
beforeEach(() => {
  resetDb();
  admin = makeUser({ role: 'admin' });
  manager = makeUser({ role: 'manager' });
  employee = makeUser({ role: 'employee', managerId: manager.id });
});

const call = (user, method, url, extra = {}) =>
  runMiddleware(requireAdminAuth, fakeReq({ method, url, cookie: user ? sessionCookie(user.id) : undefined, ...extra }));

describe('requireAdminAuth — احراز هویت', () => {
  test('بدون کوکی ← ۴۰۱', () => {
    assert.equal(call(null, 'GET', '/api/admin/me').status, 401);
  });
  test('کوکی دستکاری‌شده / با راز اشتباه / منقضی ← ۴۰۱', () => {
    const good = sessionCookie(admin.id);
    assert.equal(call(null, 'GET', '/api/admin/me', { cookie: good.slice(0, -3) + 'abc' }).status, 401);
    assert.equal(call(null, 'GET', '/api/admin/me', { cookie: sessionCookie(admin.id, { secret: 'wrong-secret-wrong-secret-0123456789' }) }).status, 401); // secret-scan:allow (راز اشتباهِ عمدی)
    assert.equal(call(null, 'GET', '/api/admin/me', { cookie: sessionCookie(admin.id, { maxAgeSeconds: -10 }) }).status, 401);
  });
  test('کاربر غیرفعال یا حذف‌شده ← ۴۰۳ (is_active در هر درخواست چک می‌شود)', () => {
    // غیرفعال‌شدن از طریق repository، session_version را بالا می‌برد (بخش ۲-الف)؛ سشنی که با نسخه‌ی تازه صادر شود ۴۰۳ می‌گیرد
    const inactive = makeUser({ role: 'admin', active: false });
    const fresh = usersRepository.findById(inactive.id);
    assert.equal(call(inactive, 'GET', '/api/admin/me', { cookie: sessionCookie(inactive.id, { sessionVersion: fresh.session_version }) }).status, 403);
    // ویرایش مستقیم دیتابیس (بدون bump) هم همچنان ۴۰۳ است: is_active در هر درخواست چک می‌شود
    const cookie = sessionCookie(admin.id);
    require('../src/db/connection').getDb().prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(admin.id);
    assert.equal(call(null, 'GET', '/api/admin/me', { cookie }).status, 403);
    assert.equal(call(null, 'GET', '/api/admin/me', { cookie: sessionCookie(987654) }).status, 403);
  });
  test('ادمین و سرپرست فعال عبور می‌کنند و req.adminUser ست می‌شود', () => {
    const req = fakeReq({ cookie: sessionCookie(manager.id) });
    const r = runMiddleware(requireAdminAuth, req);
    assert.equal(r.nextCalled, true);
    assert.equal(req.adminUser.id, manager.id);
  });
});

describe('لیست سفید کارمند (default-deny)', () => {
  test('هر ورودی لیست سفید برای کارمند عبور می‌کند (با query و اسلش پایانی)', () => {
    const samples = {
      '/api/admin/me': 'GET',
      '/api/admin/me/permissions': 'GET', // S4-4b
      '/api/admin/attendance?from=2026-01-01': 'GET',
      '/api/admin/attendance/export': 'GET',
      '/api/admin/attendance-records/12': 'GET',
      '/api/admin/users/5/details': 'GET',
      '/api/admin/leave-requests': 'GET',
      '/api/admin/disputes': 'GET',
      '/api/admin/reports/summary': 'GET',
      '/api/admin/notifications?unread=1': 'GET', // S4-5b
      '/api/admin/notifications/unread-count': 'GET',
      '/api/admin/notifications/7/read': 'POST',
      '/api/admin/notifications/read-all': 'POST',
      '/api/admin/auth/logout': 'POST',
      '/api/admin/me/': 'GET',
    };
    for (const [url, method] of Object.entries(samples)) {
      assert.equal(call(employee, method, url).nextCalled, true, `${method} ${url}`);
    }
    // هر الگوی لیست سفید حداقل در یکی از نمونه‌ها پوشش داده شده (اگر کسی ورودی جدید اضافه کند این تست یادآوری می‌کند)
    assert.equal(EMPLOYEE_ALLOWED.length, 14, 'لیست سفید تغییر کرده؛ ماتریس تست را به‌روز کنید');
  });

  test('هر چیزی خارج از لیست سفید برای کارمند ۴۰۳ است (از جمله route های آینده)', () => {
    const denied = [
      ['GET', '/api/admin/users'],
      ['POST', '/api/admin/users'],
      ['PATCH', '/api/admin/users/3'],
      ['DELETE', '/api/admin/users/3'],
      ['GET', '/api/admin/users/export'],
      ['GET', '/api/admin/settings'],
      ['PATCH', '/api/admin/settings'],
      ['GET', '/api/admin/audit-log'],
      ['GET', '/api/admin/system'],
      ['GET', '/api/admin/system/backup'],
      ['POST', '/api/admin/broadcast'],
      ['GET', '/api/admin/dashboard'],
      ['GET', '/api/admin/overview'],
      ['PATCH', '/api/admin/attendance-records/1'],
      ['DELETE', '/api/admin/attendance-records/1'],
      ['POST', '/api/admin/leave-requests'],
      ['POST', '/api/admin/leave-requests/1/approve'],
      ['POST', '/api/admin/disputes/1/resolve'],
      ['GET', '/api/admin/suspicious'],
      ['POST', '/api/admin/suspicious/1/review'],
      ['GET', '/api/admin/some-future-feature'],
      ['GET', '/api/admin/notifications/7'], // S4-5b: فقط الگوهای دقیق مجازند
      ['POST', '/api/admin/notifications'],
      ['DELETE', '/api/admin/notifications/7'],
    ];
    for (const [method, url] of denied) {
      assert.equal(call(employee, method, url).status, 403, `${method} ${url}`);
    }
  });

  test('دور زدن لیست سفید با مسیر/متد/query ساختگی ممکن نیست', () => {
    const tricks = [
      ['POST', '/api/admin/me'], // متد اشتباه
      ['POST', '/api/admin/me/permissions'], // متد اشتباه (S4-4b)
      ['GET', '/api/admin/me/permissions/extra'],
      ['GET', '/api/admin/users?next=/admin/me'], // الگو داخل query
      ['GET', '/api/admin/me/../users'],
      ['GET', '/api/admin/attendance-records/1/../../users'],
      ['GET', '/api/admin/attendance-records/abc'],
      ['GET', '/api/admin/users/1/details/extra'],
      ['PATCH', '/api/admin/attendance-records/12'],
    ];
    for (const [method, url] of tricks) {
      assert.equal(call(employee, method, url).status, 403, `${method} ${url}`);
    }
  });

  test('سرپرست و ادمین به لیست سفید محدود نیستند', () => {
    for (const u of [manager, admin]) {
      assert.equal(call(u, 'GET', '/api/admin/settings').nextCalled, true);
      assert.equal(call(u, 'GET', '/api/admin/some-future-feature').nextCalled, true);
    }
  });
});

describe('requireStaff / requireFullAdmin', () => {
  const run = (mw, user) => {
    const req = fakeReq();
    req.adminUser = user;
    return runMiddleware(mw, req);
  };
  test('requireStaff: سرپرست و ادمین بله؛ کارمند و بی‌هویت خیر', () => {
    assert.equal(run(requireStaff, admin).nextCalled, true);
    assert.equal(run(requireStaff, manager).nextCalled, true);
    assert.equal(run(requireStaff, employee).status, 403);
    assert.equal(run(requireStaff, undefined).status, 403);
  });
  test('requireFullAdmin: فقط ادمین', () => {
    assert.equal(run(requireFullAdmin, admin).nextCalled, true);
    assert.equal(run(requireFullAdmin, manager).status, 403);
    assert.equal(run(requireFullAdmin, employee).status, 403);
    assert.equal(run(requireFullAdmin, undefined).status, 403);
  });
});

// S4-3b/S4-3c: قفل‌کردن نگاشت مجوز روی routeهای مهاجرت‌شده (نیمه‌ی اول: users, attendance, disputes؛ نیمه‌ی دوم: بقیه‌ی /api/admin/*).
// برای هر route و هر نقش، نتیجه‌ی گارد با رفتار قبلی (requireStaff / requireFullAdmin / بدون گارد + لیست سفید کارمند) برابر است.
// تشخیص «رد شدن توسط گارد» از ۴۰۳ اسکوپ: پیام ۴۰۳ گارد مجوز یکتاست.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

let hasDeps = true;
try { require.resolve('express'); } catch (_) { hasDeps = false; }

const GUARD_MSG = 'برای این عملیات مجوز لازم را ندارید.';

// [method, url, who] — who: کدام نقش‌ها از گارد رد می‌شوند (گارد مجوز یا لیست سفید کارمند).
const E = 'employee';
const M = 'manager';
const A = 'admin';
const H = 'hr';

// hr (S4-4a): فقط‌خواندنی همه؛ همین routeها برای hr مجازند و بقیه (همه‌ی نوشتن‌ها، تنظیمات، ممیزی، سیستم، شیفت، مشکوک) ۴۰۳ گارد مجوز می‌دهند.
const HR_ALLOWED = new Set([
  'GET /api/admin/me', 'GET /api/admin/me/permissions', 'GET /api/admin/dashboard', 'GET /api/admin/overview', 'GET /api/admin/live', 'GET /api/admin/nightly-review', 'GET /api/admin/calendar?year=1405&month=1',
  'GET /api/admin/users', 'GET /api/admin/users/export', 'GET /api/admin/users/999999', 'GET /api/admin/users/999999/details',
  'GET /api/admin/attendance', 'GET /api/admin/attendance/export', 'GET /api/admin/attendance-records/999999',
  'GET /api/admin/disputes', 'GET /api/admin/leave-requests', 'GET /api/admin/leave-types', 'GET /api/admin/leave-types/999999', 'GET /api/admin/leave-balances', 'GET /api/admin/leave-balances/999999/adjustments', 'GET /api/admin/reports/export', 'GET /api/admin/reports/summary',
]);
const ROUTES = [
  ['GET', '/api/admin/users', [M, A]],
  ['GET', '/api/admin/users/export', [M, A]],
  ['GET', '/api/admin/users/999999', [M, A]],
  ['GET', '/api/admin/users/999999/details', [E, M, A]],
  ['POST', '/api/admin/users/999999/message', [M, A]],
  ['POST', '/api/admin/users', [A]],
  ['PATCH', '/api/admin/users/999999', [A]],
  ['POST', '/api/admin/users/999999/revoke-sessions', [A]],
  ['DELETE', '/api/admin/users/999999', [A]],
  ['GET', '/api/admin/attendance', [E, M, A]],
  ['GET', '/api/admin/attendance/export', [E, M, A]],
  ['GET', '/api/admin/attendance-records/999999', [E, M, A]],
  ['POST', '/api/admin/attendance-records', [M, A]],
  ['PATCH', '/api/admin/attendance-records/999999', [M, A]],
  ['DELETE', '/api/admin/attendance-records/999999', [M, A]],
  ['POST', '/api/admin/attendance-records/999999/breaks', [M, A]],
  ['PATCH', '/api/admin/break-records/999999', [M, A]],
  ['DELETE', '/api/admin/break-records/999999', [M, A]],
  ['GET', '/api/admin/disputes', [E, M, A]],
  ['POST', '/api/admin/disputes/999999/resolve', [M, A]],
  ['POST', '/api/admin/disputes/999999/reopen', [M, A]],
];

// نیمه‌ی دوم (S4-3c). عنصر چهارم 'skip' = اجرای واقعی برای نقش مجاز عوارض دارد (ارسال همگانی، ابطال همه‌ی نشست‌ها، بک‌آپ)،
// پس فقط ردشدن نقش‌های ممنوع بررسی می‌شود.
const ROUTES_2 = [
  ['GET', '/api/admin/me', [E, M, A]],
  ['GET', '/api/admin/me/permissions', [E, M, A]], // S4-4b
  ['GET', '/api/admin/dashboard', [M, A]],
  ['GET', '/api/admin/overview', [M, A]],
  ['GET', '/api/admin/live', [M, A]],
  ['GET', '/api/admin/nightly-review', [M, A]],
  ['GET', '/api/admin/calendar?year=1405&month=1', [M, A]], // S4-14a: dashboard.read (hr از HR_ALLOWED)
  ['GET', '/api/admin/leave-requests', [E, M, A]],
  ['POST', '/api/admin/leave-requests/999999/approve', [M, H, A]], // S4-11a: hr از guard رد می‌شود (leave.approve.hr)؛ تصمیم مرحله با سرویس
  ['GET', '/api/admin/leave-queue', [M, H, A]], // S4-13a: صف تأیید (leave.approve یا leave.approve.hr)؛ اسکوپ/تصمیم هر مرحله در route/سرویس
  ['POST', '/api/admin/leave-queue/bulk', [M, H, A]],
  ['POST', '/api/admin/leave-requests', [M, A]],
  ['GET', '/api/admin/leave-types', [M, A]], // S4-7a: خواندن leave.read؛ نوشتن settings.edit (فقط ادمین)
  ['GET', '/api/admin/leave-types/999999', [M, A]],
  ['POST', '/api/admin/leave-types', [A]],
  ['PATCH', '/api/admin/leave-types/999999', [A]],
  ['DELETE', '/api/admin/leave-types/999999', [A]],
  ['GET', '/api/admin/leave-balances', [E, M, A]], // S4-9c: leave.balance.read (اسکوپ در route)
  ['GET', '/api/admin/leave-balances/999999/adjustments', [E, M, A]],
  ['POST', '/api/admin/leave-balances/adjust', [A]], // leave.balance.edit فقط admin
  ['PUT', '/api/admin/leave-balances/entitlement', [A]],
  ['PATCH', '/api/admin/leave-requests/999999', [M, A]],
  ['DELETE', '/api/admin/leave-requests/999999', [M, A]],
  ['GET', '/api/admin/overtime-approvals', [M, A]],
  ['POST', '/api/admin/overtime-approvals/999999/approve', [M, A]],
  ['GET', '/api/admin/reports/export', [M, A]],
  ['GET', '/api/admin/reports/summary', [E, M, A]],
  ['GET', '/api/admin/holidays', [M, A]],
  ['GET', '/api/admin/settings', [M, A]],
  ['GET', '/api/admin/settings/items', [M, A]],
  ['POST', '/api/admin/holidays/import', [A]],
  ['POST', '/api/admin/holidays', [A]],
  ['PUT', '/api/admin/holidays/999999', [A]],
  ['DELETE', '/api/admin/holidays/999999', [A]],
  ['PATCH', '/api/admin/settings', [A]],
  ['PUT', '/api/admin/settings/no_such_key', [A]],
  ['POST', '/api/admin/settings/no_such_key/reset', [A]],
  ['GET', '/api/admin/shifts', [M, A]],
  ['GET', '/api/admin/shifts/999999', [M, A]],
  ['POST', '/api/admin/shifts', [A]],
  ['PATCH', '/api/admin/shifts/999999', [A]],
  ['DELETE', '/api/admin/shifts/999999', [A]],
  ['PUT', '/api/admin/users/999999/shift', [A]],
  ['GET', '/api/admin/audit-log', [A]],
  ['GET', '/api/admin/audit-log/export', [A]],
  ['GET', '/api/admin/audit-actions', [A]],
  ['GET', '/api/admin/suspicious', [M, A]],
  ['POST', '/api/admin/suspicious/999999/review', [M, A]],
  ['GET', '/api/admin/system', [A]],
  ['GET', '/api/admin/system/status', [A]],
  ['POST', '/api/admin/broadcast', [A], 'skip'],
  ['POST', '/api/admin/system/revoke-all-sessions', [A], 'skip'],
  ['GET', '/api/admin/system/backup', [A], 'skip'],
];

describe('گارد مجوز routeهای /api/admin/* (S4-3b/S4-3c)', { skip: hasDeps ? false : 'express نصب نیست (npm install)' }, () => {
  let server, base, cookies;

  before(async () => {
    resetDb();
    const { makeUser, sessionCookie } = require('./helpers/factories');
    const { createApp } = require('../src/server');
    const admin = makeUser({ role: 'admin' });
    const hr = makeUser({ role: 'hr' });
    const mgr = makeUser({ role: 'manager' });
    const emp = makeUser({ role: 'employee', managerId: mgr.id });
    cookies = { employee: sessionCookie(emp.id), manager: sessionCookie(mgr.id), admin: sessionCookie(admin.id), hr: sessionCookie(hr.id) };
    server = createApp().listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => { if (server) server.close(); cleanup(); });

  async function hit(role, method, url) {
    const headers = { 'content-type': 'application/json', 'x-requested-with': 'AttendancePanel', cookie: cookies[role] };
    const res = await fetch(base + url, { method, headers, body: method === 'GET' || method === 'DELETE' ? undefined : '{}' });
    let json = null;
    try { json = await res.json(); } catch (_) { /* بدنه‌ی غیر JSON (CSV) */ }
    return { status: res.status, json };
  }

  // «مجاز»: از گارد عبور کرده؛ یعنی نه ۴۰۱ و نه پیام گارد مجوز (۴۰۳ اسکوپ/۴۰۴/۴۰۰ بعدی مجاز است).
  // «ممنوع»: ۴۰۳ (برای کارمند ممکن است پیام لیست سفید باشد؛ برای سرپرست/ادمین پیام گارد مجوز).
  for (const [method, url, allowed, skip] of [...ROUTES, ...ROUTES_2]) {
    test(`${method} ${url}`, async () => {
      for (const role of [E, M, A, H]) {
        const allow = allowed.includes(role) || (role === H && HR_ALLOWED.has(`${method} ${url}`));
        if (allow && skip) continue;
        const r = await hit(role, method, url);
        if (allow) {
          assert.notEqual(r.status, 401, `${role}`);
          assert.notEqual(r.json && r.json.error, GUARD_MSG, `${role} نباید توسط گارد رد شود`);
        } else {
          assert.equal(r.status, 403, `${role} باید ۴۰۳ بگیرد`);
          if (role !== 'employee') assert.equal(r.json.error, GUARD_MSG, `${role} پیام گارد مجوز`);
        }
      }
    });
  }
});

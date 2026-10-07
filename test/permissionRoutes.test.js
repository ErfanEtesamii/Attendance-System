// S4-3b: قفل‌کردن نگاشت مجوز روی routeهای مهاجرت‌شده (users, attendance, disputes).
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

describe('گارد مجوز routeهای users/attendance/disputes (S4-3b)', { skip: hasDeps ? false : 'express نصب نیست (npm install)' }, () => {
  let server, base, cookies;

  before(async () => {
    resetDb();
    const { makeUser, sessionCookie } = require('./helpers/factories');
    const { createApp } = require('../src/server');
    const admin = makeUser({ role: 'admin' });
    const mgr = makeUser({ role: 'manager' });
    const emp = makeUser({ role: 'employee', managerId: mgr.id });
    cookies = { employee: sessionCookie(emp.id), manager: sessionCookie(mgr.id), admin: sessionCookie(admin.id) };
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
    for (const [method, url, allowed] of ROUTES) {
    test(`${method} ${url}`, async () => {
      for (const role of [E, M, A]) {
        const r = await hit(role, method, url);
        const allow = allowed.includes(role);
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

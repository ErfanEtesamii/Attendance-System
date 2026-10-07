// S3-9e: صفحه‌ی «شیفت‌ها» و کارت انتساب شیفت در پرونده‌ی کارمند. اجرای واقعی views-shifts.js با AP ساختگی (بدون مرورگر)
// + API واقعی برای فیلد جدید shiftId در /admin/users/:id/details. تست دستی مرورگر در گزارش S3-9e آمده است.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let hasDeps = true;
try { require.resolve('express'); } catch (_) { hasDeps = false; }

function loadShiftViews(apiImpl, { reasonAnswer = 'دلیل تست' } = {}) {
  const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const toasts = [];
  const AP = {
    views: {}, nav: [], state: { isAdmin: true },
    $: (...a) => AP.$impl(...a), $impl: () => null, $$: () => [], esc,
    fmt: { num: (n) => String(n) },
    icon: () => '', badge: (cls, text) => `<span class="badge ${cls}">${esc(text)}</span>`, avatar: (n) => `<i>${esc(n)}</i>`,
    view(id, def) { AP.views[id] = def; if (def.nav) AP.nav.push({ id, ...def.nav }); },
    api: apiImpl, toast: (m, err) => toasts.push([m, !!err]), refresh: () => { toasts.push(['refresh']); },
    attempt: async (fn, ok) => { try { const r = await fn(); if (ok) AP.toast(ok); return r === undefined ? true : r; } catch (e) { AP.toast(e.message, true); return false; } },
    askReason: async () => reasonAnswer,
    formData: (form) => form.__data,
  };
  const src = fs.readFileSync(path.join(__dirname, '..', 'public-admin', 'js', 'views-shifts.js'), 'utf8');
  vm.runInNewContext(src, { window: { AP }, document: {}, console });
  return { AP, toasts };
}

const shift = (o = {}) => ({ id: 1, name: 'صبح', startTime: '08:00', endTime: '16:30', graceLateMinutes: 10, graceEarlyMinutes: 5, workDays: [0, 1, 2, 3, 6], overnight: false, maxLunchMinutes: 60, fixedLunchDeductMinutes: 0, userCount: 2, ...o });

describe('صفحه‌ی شیفت‌ها و انتساب (S3-9e)', () => {
  test('ناوبری فقط‌ادمین؛ لیست با ساعت، روزهای کاری به ترتیب شنبه→جمعه، مهلت‌ها، ناهار، تعداد کاربران و دکمه‌های ویرایش/حذف', async () => {
    const calls = [];
    const { AP } = loadShiftViews(async (p) => { calls.push(p); return [shift(), shift({ id: 2, name: 'شب', startTime: '22:00', endTime: '06:00', overnight: true, userCount: 0, workDays: [4, 5], maxLunchMinutes: 0, fixedLunchDeductMinutes: 30 })]; });
    const def = AP.views.shifts;
    assert.ok(def && def.admin, 'فقط ادمین');
    assert.ok(AP.nav.some((n) => n.id === 'shifts' && n.admin));
    const { html } = await def.render();
    assert.deepEqual(calls, ['/admin/shifts']);
    assert.match(html, /08:00 – 16:30/);
    assert.match(html, /شنبه، یکشنبه، دوشنبه، سه‌شنبه، چهارشنبه/);
    assert.match(html, /پنجشنبه، جمعه/);
    assert.match(html, /10 \/ 5 دقیقه/);
    assert.match(html, /حداکثر 60/);
    assert.match(html, /کسر ثابت 30/);
    assert.match(html, /data-users="1"/);
    assert.doesNotMatch(html, /data-users="2"/, 'بدون کارمند دکمه‌ی فهرست ندارد');
    assert.match(html, /badge purple">شب/);
    for (const id of [1, 2]) { assert.match(html, new RegExp(`data-edit="${id}"`)); assert.match(html, new RegExp(`data-del="${id}"`)); }
    assert.match(html, /id="shift-add"/);
  });

  test('حالت خالی و escape نام شیفت', async () => {
    let { AP } = loadShiftViews(async () => []);
    assert.match((await AP.views.shifts.render()).html, /هنوز شیفتی تعریف نشده است/);
    ({ AP } = loadShiftViews(async () => [shift({ name: '<img src=x onerror=alert(1)>' })]));
    const { html } = await AP.views.shifts.render();
    assert.doesNotMatch(html, /<img src=x/);
    assert.match(html, /&lt;img src=x/);
  });

  test('کارت انتساب: گزینه‌ی «بدون شیفت»، شیفت فعلی selected، بدون شیفت تعریف‌شده ⇒ دکمه غیرفعال، escape', () => {
    const { AP } = loadShiftViews(async () => []);
    const withShift = AP.shiftAssignCard({ id: 7, shiftId: 2 }, [shift(), shift({ id: 2, name: '<b>شب</b>', overnight: true })]);
    assert.match(withShift, /<option value="" >|<option value="">|<option value=""/);
    assert.match(withShift, /<option value="2" selected>/);
    assert.doesNotMatch(withShift, /<option value="1" selected>/);
    assert.doesNotMatch(withShift, /<b>شب<\/b>/);
    assert.match(withShift, /، شب\)/);
    const none = AP.shiftAssignCard({ id: 7, shiftId: null }, [shift()]);
    assert.match(none, /<option value="" selected>/);
    const empty = AP.shiftAssignCard({ id: 7, shiftId: null }, []);
    assert.match(empty, /type="submit" disabled/);
  });

  test('انتساب: PUT /admin/users/:id/shift با دلیل؛ بدون تغییر ⇒ هیچ درخواستی؛ برداشتن شیفت ⇒ shiftId=null؛ لغو دلیل ⇒ هیچ درخواستی', async () => {
    const calls = [];
    const { AP, toasts } = loadShiftViews(async (p, o) => { calls.push([p, o]); return { changed: true }; });
    // bindShiftAssign فرم را با $ پیدا می‌کند؛ در AP ساختگی $ فرم تزریق‌شده را برمی‌گرداند
    const run = async (value) => {
      let handler;
      const form = { shiftId: { value }, addEventListener: (ev, fn) => { if (ev === 'submit') handler = fn; } };
      AP.$impl = () => form;
      AP.bindShiftAssign({}, { id: 7, fullName: 'علی', shiftId: 1 });
      await handler({ preventDefault() {} });
    };

    await run('1'); // بدون تغییر
    assert.equal(calls.length, 0);
    await run('2');
    assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), ['/admin/users/7/shift', { method: 'PUT', body: { shiftId: 2, reason: 'دلیل تست' } }]); // JSON: اشیاء vm هم‌ریشه نیستند
    await run('');
    assert.deepEqual(JSON.parse(JSON.stringify(calls[1][1].body)), { shiftId: null, reason: 'دلیل تست' });
    assert.ok(toasts.some((t) => t[0] === 'شیفت کارمند ذخیره شد.'));
    assert.ok(toasts.some((t) => t[0] === 'refresh'));

    const { AP: AP2 } = loadShiftViews(async () => { throw new Error('نباید صدا زده شود'); }, { reasonAnswer: null });
    let h2; const f2 = { shiftId: { value: '3' }, addEventListener: (ev, fn) => { h2 = fn; } };
    AP2.$impl = () => f2;
    AP2.bindShiftAssign({}, { id: 7, fullName: 'علی', shiftId: null });
    await h2({ preventDefault() {} });
  });
});

describe('API: shiftId در details کاربر (S3-9e)', { skip: hasDeps ? false : 'express نصب نیست (npm install)' }, () => {
  let server, base, cookie, emp, shiftsRepo;
  before(async () => {
    resetDb();
    const { makeUser, sessionCookie } = require('./helpers/factories');
    const { createApp } = require('../src/server');
    shiftsRepo = require('../src/repositories/shiftsRepository');
    const admin = makeUser({ role: 'admin' });
    emp = makeUser({ role: 'employee' });
    cookie = sessionCookie(admin.id);
    server = createApp().listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => { if (server) server.close(); cleanup(); });

  const hit = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json', 'x-requested-with': 'AttendancePanel', cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, json: await res.json() };
  };

  test('details: shiftId=null بدون شیفت؛ بعد از انتساب با PUT همان id؛ بعد از برداشتن دوباره null', async () => {
    assert.equal((await hit('GET', `/api/admin/users/${emp.id}/details`)).json.user.shiftId, null);
    const s = shiftsRepo.createShift({ name: 'صبح', startTime: '08:00', endTime: '16:00', graceLateMinutes: 0, graceEarlyMinutes: 0, workDays: [6, 0, 1, 2, 3], overnight: false, maxLunchMinutes: 0, fixedLunchDeductMinutes: 0 });
    assert.equal((await hit('PUT', `/api/admin/users/${emp.id}/shift`, { shiftId: s.id, reason: 'تست' })).json.changed, true);
    assert.equal((await hit('GET', `/api/admin/users/${emp.id}/details`)).json.user.shiftId, s.id);
    assert.equal((await hit('PUT', `/api/admin/users/${emp.id}/shift`, { shiftId: null, reason: 'تست' })).json.changed, true);
    assert.equal((await hit('GET', `/api/admin/users/${emp.id}/details`)).json.user.shiftId, null);
  });
});

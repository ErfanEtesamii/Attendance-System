// S3-9b: API تعطیلات (اعتبارسنجی فارسی، کامل/نیم‌روز، دامنه‌ی دپارتمان، ویرایش، حذف، audit، دسترسی)
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

let hasDeps = true;
try { require.resolve('express'); } catch (_) { hasDeps = false; }

describe('API تعطیلات (S3-9b)', { skip: hasDeps ? false : 'express نصب نیست (npm install)' }, () => {
  let server, base, db, cookies;

  before(async () => {
    db = resetDb();
    const { makeUser, sessionCookie } = require('./helpers/factories');
    const { createApp } = require('../src/server');
    const admin = makeUser({ role: 'admin' });
    const manager = makeUser({ role: 'manager' });
    const employee = makeUser({ role: 'employee', department: 'مالی' });
    cookies = { admin: sessionCookie(admin.id), manager: sessionCookie(manager.id), employee: sessionCookie(employee.id) };
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
    const res = await fetch(base + url, { method, headers, body: body && method !== 'GET' ? JSON.stringify(body) : undefined });
    let json = null;
    try { json = await res.json(); } catch (_) { /* بدنه خالی */ }
    return { status: res.status, json };
  }
  const auditRows = (action) => db.prepare('SELECT * FROM audit_log WHERE action = ? ORDER BY id').all(action);
  const details = (row) => JSON.parse(row.details);

  test('ورودی قدیمی { date, title } همچنان تعطیلی کامل برای همه می‌سازد + audit', async () => {
    const r = await hit('admin', 'POST', '/api/admin/holidays', { date: '2026-03-21', title: 'نوروز' });
    assert.equal(r.status, 201);
    assert.equal(r.json.kind, 'full');
    assert.equal(r.json.scope, 'all');
    assert.equal(r.json.half_end_time, null);
    assert.equal(r.json.warning, undefined);
    const rows = auditRows('holiday_added');
    assert.equal(rows.length, 1);
    assert.equal(details(rows[0]).date, '2026-03-21');
    assert.equal(details(rows[0]).kind, 'full');
  });

  test('اعتبارسنجی: تاریخ/عنوان/نوع/ساعت نیم‌روز/دامنه/دپارتمان نامعتبر ⇒ ۴۰۰ فارسی و بدون ذخیره', async () => {
    const bad = [
      [{ date: '2026-02-30', title: 'x' }, /تاریخ/],
      [{ date: '1405/01/01', title: 'x' }, /تاریخ/],
      [{ date: '2026-04-01', title: '   ' }, /عنوان/],
      [{ date: '2026-04-01', title: 'x'.repeat(101) }, /۱۰۰/],
      [{ date: '2026-04-01', title: 'x', kind: 'quarter' }, /نوع/],
      [{ date: '2026-04-01', title: 'x', kind: 'half' }, /ساعت پایان/],
      [{ date: '2026-04-01', title: 'x', kind: 'half', halfEndTime: '25:00' }, /ساعت پایان/],
      [{ date: '2026-04-01', title: 'x', scope: 'team' }, /دامنه/],
      [{ date: '2026-04-01', title: 'x', scope: 'department', department: '  ' }, /دپارتمان/],
    ];
    for (const [body, re] of bad) {
      const r = await hit('admin', 'POST', '/api/admin/holidays', body);
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.match(r.json.error, re, JSON.stringify(body));
    }
    assert.equal(db.prepare('SELECT COUNT(*) c FROM holidays').get().c, 1, 'فقط نوروز ذخیره شده است');
  });

  test('نیم‌روز و دپارتمانی: ذخیره با نرمال‌سازی ساعت؛ دپارتمان بدون کاربر ⇒ هشدار (نه خطا)؛ تکراری ⇒ ۴۰۹', async () => {
    const half = await hit('admin', 'POST', '/api/admin/holidays', { date: '2026-04-02', title: 'نیم‌روز', kind: 'half', halfEndTime: '9:05', scope: 'all', department: 'نادیده' });
    assert.equal(half.status, 201);
    assert.equal(half.json.kind, 'half');
    assert.equal(half.json.half_end_time, '09:05');
    assert.equal(half.json.department, '', 'برای دامنه‌ی all دپارتمان نادیده می‌ماند');

    const dept = await hit('admin', 'POST', '/api/admin/holidays', { date: '2026-04-02', title: 'تعطیلی مالی', scope: 'department', department: ' مالی ' });
    assert.equal(dept.status, 201, 'همان تاریخ با دامنه‌ی دیگر مجاز است');
    assert.equal(dept.json.department, 'مالی');
    assert.equal(dept.json.warning, undefined);

    const ghost = await hit('admin', 'POST', '/api/admin/holidays', { date: '2026-04-03', title: 'ناشناس', scope: 'department', department: 'بایگانی' });
    assert.equal(ghost.status, 201);
    assert.match(ghost.json.warning, /هیچ کاربری/);

    const dup = await hit('admin', 'POST', '/api/admin/holidays', { date: '2026-04-02', title: 'دوباره', scope: 'department', department: 'مالی' });
    assert.equal(dup.status, 409);
    const dupAll = await hit('admin', 'POST', '/api/admin/holidays', { date: '2026-03-21', title: 'تکرار نوروز' });
    assert.equal(dupAll.status, 409);
  });

  test('ویرایش: قبل/بعد در audit، تغییر نوع و دامنه، ۴۰۴ برای ناموجود، ۴۰۹ برای برخورد با ردیف دیگر، ۴۰۰ برای نامعتبر', async () => {
    const list = (await hit('admin', 'GET', '/api/admin/holidays')).json;
    const half = list.find((h) => h.title === 'نیم‌روز');
    const noruz = list.find((h) => h.title === 'نوروز');

    const ok = await hit('admin', 'PUT', `/api/admin/holidays/${half.id}`, { date: '2026-04-02', title: 'تعطیل کامل شد', kind: 'full', reason: 'ابلاغیه' });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.kind, 'full');
    assert.equal(ok.json.half_end_time, null, 'با تبدیل به کامل ساعت پاک می‌شود');
    const row = auditRows('holiday_updated')[0];
    const d = details(row);
    assert.equal(d.holidayId, half.id);
    assert.equal(d.before.kind, 'half');
    assert.equal(d.before.halfEndTime, '09:05');
    assert.equal(d.after.kind, 'full');
    assert.equal(d.after.title, 'تعطیل کامل شد');
    assert.equal(d.reason, 'ابلاغیه');

    assert.equal((await hit('admin', 'PUT', '/api/admin/holidays/99999', { date: '2026-04-02', title: 'x' })).status, 404);
    const clash = await hit('admin', 'PUT', `/api/admin/holidays/${half.id}`, { date: '2026-03-21', title: 'x' });
    assert.equal(clash.status, 409);
    assert.equal(db.prepare('SELECT holiday_date FROM holidays WHERE id = ?').get(half.id).holiday_date, '2026-04-02', 'بعد از ۴۰۹ ردیف دست‌نخورده');
    assert.equal((await hit('admin', 'PUT', `/api/admin/holidays/${noruz.id}`, { date: '2026-03-21', title: '', })).status, 400);
    // ذخیره بدون تغییر تاریخ/دامنه روی همان ردیف برخورد نیست
    assert.equal((await hit('admin', 'PUT', `/api/admin/holidays/${noruz.id}`, { date: '2026-03-21', title: 'نوروز ۱۴۰۵' })).status, 200);
  });

  test('حذف: audit با مشخصات ردیف، ۴۰۴ برای ناموجود', async () => {
    const list = (await hit('admin', 'GET', '/api/admin/holidays')).json;
    const target = list.find((h) => h.title === 'ناشناس');
    assert.equal((await hit('admin', 'DELETE', `/api/admin/holidays/${target.id}`)).status, 200);
    assert.equal(db.prepare('SELECT COUNT(*) c FROM holidays WHERE id = ?').get(target.id).c, 0);
    const d = details(auditRows('holiday_removed').pop());
    assert.equal(d.title, 'ناشناس');
    assert.equal(d.department, 'بایگانی');
    assert.equal((await hit('admin', 'DELETE', `/api/admin/holidays/${target.id}`)).status, 404);
  });

  test('دسترسی: سرپرست فقط می‌خواند، کارمند ۴۰۳ و بدون سشن ۴۰۱؛ نوشتن بدون هدر CSRF ۴۰۳', async () => {
    assert.equal((await hit('manager', 'GET', '/api/admin/holidays')).status, 200);
    for (const [m, u, b] of [['POST', '/api/admin/holidays', { date: '2026-05-01', title: 'x' }], ['PUT', '/api/admin/holidays/1', { date: '2026-05-01', title: 'x' }], ['DELETE', '/api/admin/holidays/1']]) {
      assert.equal((await hit('manager', m, u, b)).status, 403, `${m} سرپرست`);
      assert.equal((await hit('employee', m, u, b)).status, 403, `${m} کارمند`);
      assert.equal((await hit('anon', m, u, b)).status, 401, `${m} بدون سشن`);
    }
    const res = await fetch(`${base}/api/admin/holidays`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: cookies.admin }, body: JSON.stringify({ date: '2026-05-01', title: 'x' }) });
    assert.equal(res.status, 403);
  });
});

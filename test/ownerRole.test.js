// نقش owner (مالک سیستم): ابرمجموعه‌ی admin + بخش‌های فقط-owner؛ خارج از فهرست کارمندان و آمار؛ ارتقا فقط با آیدی تلگرام.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

let hasDeps = true;
try { require.resolve('express'); } catch (_) { hasDeps = false; }

describe('نقش owner', { skip: hasDeps ? false : 'express نصب نیست (npm install)' }, () => {
  let server, base, db, F, usersRepository, attendanceRepository, owner, admin, emp;
  let cookies;

  before(async () => {
    db = resetDb();
    F = require('./helpers/factories');
    usersRepository = require('../src/repositories/usersRepository');
    attendanceRepository = require('../src/repositories/attendanceRepository');
    const { createApp } = require('../src/server');
    owner = F.makeUser({ role: 'owner', name: 'مالک' });
    admin = F.makeUser({ role: 'admin', name: 'ادمین' });
    emp = F.makeUser({ role: 'employee', name: 'کارمند' });
    cookies = { owner: F.sessionCookie(owner.id), admin: F.sessionCookie(admin.id) };
    server = createApp().listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => { if (server) server.close(); cleanup(); });

  async function hit(who, method, url, body) {
    const res = await fetch(base + url, {
      method,
      headers: { 'content-type': 'application/json', 'x-requested-with': 'AttendancePanel', cookie: cookies[who] },
      body: body && method !== 'GET' ? JSON.stringify(body) : undefined,
    });
    let json = null;
    try { json = await res.json(); } catch (_) { /* بدنه خالی */ }
    return { status: res.status, json };
  }

  test('owner می‌تواند وارد پنل شود و مجوزهای فقط-owner را دارد؛ admin ندارد', async () => {
    const o = await hit('owner', 'GET', '/api/admin/me/permissions');
    assert.equal(o.status, 200);
    assert.ok(o.json.permissions.includes('system.manage'));
    assert.ok(o.json.permissions.includes('admins.manage'));
    const a = await hit('admin', 'GET', '/api/admin/me/permissions');
    assert.equal(a.status, 200);
    assert.ok(!a.json.permissions.includes('system.manage'));
    assert.ok(!a.json.permissions.includes('admins.manage'));
  });

  test('owner در فهرست کارمندان نمی‌آید (پیش‌فرض)، با includeOwner می‌آید', async () => {
    assert.ok(!usersRepository.listUsers({}).some((u) => u.id === owner.id));
    assert.ok(usersRepository.listUsers({ includeOwner: true }).some((u) => u.id === owner.id));
    for (const who of ['owner', 'admin']) {
      const r = await hit(who, 'GET', '/api/admin/users');
      assert.equal(r.status, 200);
      assert.ok(!r.json.some((u) => u.id === owner.id), `${who}: owner نباید در فهرست باشد`);
      assert.ok(r.json.some((u) => u.id === emp.id));
    }
  });

  test('رکورد تردد تستیِ owner در فهرست حضور شرکت نمی‌آید ولی ثبت آن ممکن است', () => {
    const rec = attendanceRepository.recordCheckIn(owner.id, '192.168.10.5');
    assert.ok(rec && rec.id, 'owner می‌تواند ورود بزند (تست)');
    const rows = attendanceRepository.search({ from: '2000-01-01', to: '2999-12-31', userIds: null });
    assert.ok(!rows.some((r) => r.user_id === owner.id));
    assert.ok(!attendanceRepository.listAllToday().some((r) => r.user_id === owner.id));
  });

  test('سیستم و امنیت فقط owner: admin ۴۰۳، owner از گارد رد می‌شود', async () => {
    for (const [m, u] of [['GET', '/api/admin/system/reset/options'], ['POST', '/api/admin/system/reset/preview'], ['POST', '/api/admin/system/history-purge/preview']]) {
      assert.equal((await hit('admin', m, u, {})).status, 403, `admin ${u}`);
      const r = await hit('owner', m, u, {});
      assert.notEqual(r.status, 403, `owner ${u}`);
      assert.notEqual(r.status, 401, `owner ${u}`);
    }
    // وضعیت سیستم (system.read) برای admin باز می‌ماند
    assert.equal((await hit('admin', 'GET', '/api/admin/system')).status, 200);
  });

  test('مدیریت adminها فقط owner: admin نمی‌تواند admin بسازد/نقش بدهد/حذف کند', async () => {
    const mk = await hit('admin', 'POST', '/api/admin/users', { fullName: 'ادمین جدید', role: 'admin', telegramUserId: '777001' });
    assert.equal(mk.status, 403);
    const mkOwner = await hit('owner', 'POST', '/api/admin/users', { fullName: 'ادمین جدید', role: 'admin', telegramUserId: '777001' });
    assert.equal(mkOwner.status, 201);
    const newAdminId = mkOwner.json.id;

    // admin نمی‌تواند کارمند را admin کند
    assert.equal((await hit('admin', 'PATCH', `/api/admin/users/${emp.id}`, { role: 'admin' })).status, 403);
    // admin نمی‌تواند admin دیگر را ویرایش/حذف/خارج کند
    assert.equal((await hit('admin', 'PATCH', `/api/admin/users/${newAdminId}`, { department: 'x' })).status, 403);
    assert.equal((await hit('admin', 'DELETE', `/api/admin/users/${newAdminId}`)).status, 403);
    assert.equal((await hit('admin', 'POST', `/api/admin/users/${newAdminId}/revoke-sessions`, { reason: 'تست' })).status, 403);
    // ولی کارمند عادی را می‌تواند مدیریت کند
    assert.equal((await hit('admin', 'PATCH', `/api/admin/users/${emp.id}`, { department: 'مالی' })).status, 200);
    // owner می‌تواند
    assert.equal((await hit('owner', 'PATCH', `/api/admin/users/${newAdminId}`, { department: 'x' })).status, 200);
    assert.equal((await hit('owner', 'DELETE', `/api/admin/users/${newAdminId}?force=1`)).status, 200);
  });

  test('نقش owner از طریق API/پنل نه داده می‌شود و نه تغییر می‌کند؛ owner را فقط خودش می‌تواند ویرایش کند', async () => {
    assert.equal((await hit('owner', 'PATCH', `/api/admin/users/${emp.id}`, { role: 'owner' })).status, 403);
    assert.equal((await hit('owner', 'POST', '/api/admin/users', { fullName: 'x', role: 'owner' })).status, 403);
    assert.equal((await hit('admin', 'PATCH', `/api/admin/users/${owner.id}`, { department: 'x' })).status, 403);
    assert.equal((await hit('admin', 'DELETE', `/api/admin/users/${owner.id}`)).status, 403);
    // owner نمی‌تواند نقش خودش را عوض کند
    assert.equal((await hit('owner', 'PATCH', `/api/admin/users/${owner.id}`, { role: 'admin' })).status, 403);
    assert.equal(usersRepository.findById(owner.id).role, 'owner');
  });

  test('ensureOwner: ارتقای ادمین/کارمند موجود، idempotent، ساخت کاربر جدید، باطل‌شدن نشست‌های قبلی', () => {
    const { ensureOwner } = require('../src/services/ownerBootstrap');
    const target = F.makeUser({ role: 'admin', name: 'ادمین فعلی' });
    const mgr = F.makeUser({ role: 'manager' });
    usersRepository.updateUser(target.id, { manager_id: mgr.id });
    const before = usersRepository.findById(target.id).session_version;

    const r1 = ensureOwner(target.telegram_user_id, { source: 'test' });
    assert.equal(r1.status, 'promoted');
    assert.equal(r1.user.role, 'owner');
    assert.equal(r1.user.manager_id, null);
    assert.ok(r1.user.session_version > before, 'نشست‌های قبلی باطل می‌شود');

    const r2 = ensureOwner(target.telegram_user_id, { source: 'test' });
    assert.equal(r2.status, 'unchanged');
    assert.equal(r2.user.session_version, r1.user.session_version);

    const r3 = ensureOwner('888123', { fullName: 'مالک تازه', source: 'test' });
    assert.equal(r3.status, 'created');
    assert.equal(r3.user.role, 'owner');

    assert.throws(() => ensureOwner('abc'), /عدد/);
  });
});

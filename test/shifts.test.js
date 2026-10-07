// S3-6a: ساختار شیفت — migration ۰۰۹، اعتبارسنجی خالص، repository، API CRUD + انتساب (دسترسی، دلیل اجباری، audit).
// موتور محاسبه تغییر نکرده؛ این فایل هیچ رفتار computeDay را نمی‌سنجد. API روی اپ واقعی؛ بدون express نصب‌شده skip می‌شود.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

let hasDeps = true;
try { require.resolve('express'); } catch (_) { hasDeps = false; }

describe('شیفت‌های کاری — migration، اعتبارسنجی و repository (S3-6a)', () => {
  let db;
  before(() => { db = resetDb(); });
  after(cleanup);

  test('migration ۰۰۹: جدول و ستون users.shift_id (nullable، روی کاربران موجود NULL)، اجرای دوباره بی‌خطا، FK و CHECKها', () => {
    const cols = db.prepare("PRAGMA table_info('work_shifts')").all().map((c) => c.name);
    for (const c of ['name', 'start_time', 'end_time', 'grace_late_minutes', 'grace_early_minutes', 'work_days', 'overnight', 'max_lunch_minutes', 'fixed_lunch_deduct_minutes']) assert.ok(cols.includes(c), c);
    const shiftCol = db.prepare("PRAGMA table_info('users')").all().find((c) => c.name === 'shift_id');
    assert.ok(shiftCol && shiftCol.notnull === 0 && shiftCol.dflt_value === null);
    const { makeUser } = require('./helpers/factories');
    assert.equal(db.prepare('SELECT shift_id FROM users WHERE id = ?').get(makeUser().id).shift_id, null);
    assert.doesNotThrow(() => require('../src/db/migrations/009_work_shifts').up(db));
    assert.equal(db.prepare("SELECT COUNT(*) n FROM schema_migrations WHERE name = '009_work_shifts'").get().n, 1);

    const ins = (name, extra = '') => db.exec(`INSERT INTO work_shifts (name, start_time, end_time${extra ? ', ' + extra.split('=')[0] : ''}) VALUES ('${name}', '08:00', '16:00'${extra ? ', ' + extra.split('=')[1] : ''})`);
    ins('م۱');
    assert.throws(() => ins('م۱'), /UNIQUE/);
    assert.throws(() => ins('م۲', 'grace_late_minutes=-1'), /CHECK/);
    assert.throws(() => ins('م۳', 'overnight=2'), /CHECK/);
    assert.throws(() => db.exec('UPDATE users SET shift_id = 9999 WHERE id = 1'), /FOREIGN KEY/);
  });

  test('اعتبارسنجی خالص: پیش‌فرض‌ها، نرمال‌سازی ساعت/روزها، و جدول موارد نامعتبر (شیفت شب، مرز، تکراری)', () => {
    const { validateShiftInput } = require('../src/utils/shiftValidation');
    const ok = validateShiftInput({ name: '  صبح ', startTime: '8:00', endTime: '16:30' });
    assert.deepEqual(ok, { ok: true, value: { name: 'صبح', startTime: '08:00', endTime: '16:30', graceLateMinutes: 0, graceEarlyMinutes: 0, workDays: [0, 1, 2, 3, 6], overnight: false, maxLunchMinutes: 0, fixedLunchDeductMinutes: 0 } });
    const night = validateShiftInput({ name: 'شب', startTime: '22:00', endTime: '06:00', overnight: true, workDays: [3, 6, 0], graceLateMinutes: '10' });
    assert.equal(night.ok, true);
    assert.deepEqual([night.value.workDays, night.value.overnight, night.value.graceLateMinutes], [[0, 3, 6], true, 10]);

    const base = { name: 'x', startTime: '08:00', endTime: '16:00' };
    const invalid = [
      [{ ...base, name: '   ' }, 'name'], [{ ...base, name: 'a'.repeat(61) }, 'name'],
      [{ name: 'x', endTime: '16:00' }, 'startTime'], [{ ...base, startTime: '24:00' }, 'startTime'], [{ ...base, endTime: '9:7' }, 'endTime'],
      [{ ...base, endTime: '08:00' }, 'endTime'], // شروع = پایان
      [{ ...base, startTime: '22:00', endTime: '06:00' }, 'overnight'], // رد از نیمه‌شب بدون overnight
      [{ ...base, overnight: true }, 'overnight'], // overnight با پایان بعد از شروع
      [{ ...base, graceLateMinutes: -1 }, 'graceLateMinutes'], [{ ...base, graceEarlyMinutes: 721 }, 'graceEarlyMinutes'], [{ ...base, graceLateMinutes: 1.5 }, 'graceLateMinutes'],
      [{ ...base, maxLunchMinutes: 481 }, 'maxLunchMinutes'], [{ ...base, fixedLunchDeductMinutes: 'x' }, 'fixedLunchDeductMinutes'],
      [{ ...base, workDays: [] }, 'workDays'], [{ ...base, workDays: [7] }, 'workDays'], [{ ...base, workDays: [1, 1] }, 'workDays'], [{ ...base, workDays: 'sat' }, 'workDays'],
      [{ ...base, overnight: 'maybe' }, 'overnight'], [{ ...base, foo: 1 }, 'foo'],
    ];
    for (const [input, field] of invalid) {
      const r = validateShiftInput(input);
      assert.equal(r.ok, false, JSON.stringify(input));
      assert.equal(r.field, field, JSON.stringify(input));
      assert.match(r.error, /[\u0600-\u06FF]/);
    }
    assert.deepEqual(validateShiftInput({ graceLateMinutes: 5 }, { partial: true }), { ok: true, value: { graceLateMinutes: 5 } });
  });

  test('repository: ایجاد/خواندن نرمال‌شده، ویرایش، userCount، work_days خراب ⇒ [] بدون exception، حذف فقط وقتی استفاده نشده', () => {
    const shifts = require('../src/repositories/shiftsRepository');
    const users = require('../src/repositories/usersRepository');
    const { makeUser } = require('./helpers/factories');
    const s = shifts.createShift({ name: 'ریپو', startTime: '07:00', endTime: '15:00', graceLateMinutes: 5, graceEarlyMinutes: 3, workDays: [6, 0], overnight: false, maxLunchMinutes: 45, fixedLunchDeductMinutes: 30 });
    assert.deepEqual([s.name, s.startTime, s.graceLateMinutes, s.workDays, s.overnight, s.maxLunchMinutes, s.userCount], ['ریپو', '07:00', 5, [0, 6], false, 45, 0]);
    assert.equal(shifts.updateShift(s.id, { endTime: '15:30', overnight: false, workDays: [1] }).endTime, '15:30');
    assert.deepEqual(shifts.findById(s.id).workDays, [1]);

    const u = makeUser();
    assert.equal(users.setUserShift(u.id, s.id).shift_id, s.id);
    assert.equal(shifts.findById(s.id).userCount, 1);
    assert.equal(shifts.deleteShiftIfUnused(s.id), false, 'منتسب دارد ⇒ حذف نمی‌شود');
    assert.ok(shifts.findById(s.id));
    assert.equal(users.setUserShift(999999, s.id), null);
    users.setUserShift(u.id, null);
    db.prepare('UPDATE work_shifts SET work_days = ? WHERE id = ?').run('{خراب', s.id);
    assert.deepEqual(shifts.findById(s.id).workDays, []);
    assert.equal(shifts.deleteShiftIfUnused(s.id), true);
    assert.equal(shifts.findById(s.id), null);
  });
});

describe('API شیفت‌ها (S3-6a)', { skip: hasDeps ? false : 'express نصب نیست (npm install)' }, () => {
  let server, base, db, cookies, emp, mgr, mgrEmp, otherEmp;

  before(async () => {
    db = resetDb();
    const { makeUser, sessionCookie } = require('./helpers/factories');
    const { createApp } = require('../src/server');
    const admin = makeUser({ role: 'admin' });
    mgr = makeUser({ role: 'manager' });
    mgrEmp = makeUser({ role: 'employee', managerId: mgr.id });
    otherEmp = makeUser({ role: 'employee' });
    emp = makeUser({ role: 'employee' });
    cookies = { admin: sessionCookie(admin.id), manager: sessionCookie(mgr.id), employee: sessionCookie(emp.id) };
    server = createApp().listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => {
    if (server) server.close();
    cleanup();
  });

  async function hit(role, method, url, body, { csrf = true } = {}) {
    const headers = { 'content-type': 'application/json' };
    if (csrf) headers['x-requested-with'] = 'AttendancePanel';
    if (cookies[role]) headers.cookie = cookies[role];
    const res = await fetch(base + url, { method, headers, body: body !== undefined && method !== 'GET' ? JSON.stringify(body) : undefined });
    let json = null;
    try { json = await res.json(); } catch (_) { /* بدنه خالی */ }
    return { status: res.status, json };
  }
  const auditRows = (action) => db.prepare('SELECT * FROM audit_log WHERE action = ? ORDER BY id').all(action).map((r) => ({ ...r, details: JSON.parse(r.details) }));
  const good = { name: 'صبح', startTime: '08:00', endTime: '16:30', graceLateMinutes: 10, reason: 'شیفت اصلی شرکت' };

  test('دسترسی: بدون سشن ۴۰۱، کارمند ۴۰۳، سرپرست فقط خواندن، بدون هدر CSRF ۴۰۳؛ هیچ رد‌شده‌ای چیزی ننوشته است', async () => {
    assert.equal((await hit('none', 'GET', '/api/admin/shifts')).status, 401);
    assert.equal((await hit('employee', 'GET', '/api/admin/shifts')).status, 403);
    assert.equal((await hit('employee', 'POST', '/api/admin/shifts', good)).status, 403);
    assert.equal((await hit('manager', 'GET', '/api/admin/shifts')).status, 200);
    for (const [m, u, b] of [['POST', '/api/admin/shifts', good], ['PATCH', '/api/admin/shifts/1', { name: 'x', reason: 'r' }], ['DELETE', '/api/admin/shifts/1', { reason: 'r' }], ['PUT', `/api/admin/users/${mgrEmp.id}/shift`, { shiftId: null, reason: 'r' }]]) {
      assert.equal((await hit('manager', m, u, b)).status, 403, `manager ${m} ${u}`);
    }
    assert.equal((await hit('admin', 'POST', '/api/admin/shifts', good, { csrf: false })).status, 403);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM work_shifts').get().n, 0);
    assert.equal(auditRows('shift_created').length, 0);
  });

  test('ایجاد/ویرایش/خواندن: دلیل اجباری، اعتبارسنجی ۴۰۰، نام تکراری ۴۰۹، no-op، ویرایش ناسازگار (فقط overnight) ردّ می‌شود، audit با قبل/بعد', async () => {
    assert.equal((await hit('admin', 'POST', '/api/admin/shifts', { ...good, reason: '  ' })).status, 400);
    const bad = await hit('admin', 'POST', '/api/admin/shifts', { ...good, endTime: '07:00' });
    assert.equal(bad.status, 400);
    assert.equal(bad.json.field, 'overnight');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM work_shifts').get().n, 0);

    const created = await hit('admin', 'POST', '/api/admin/shifts', good);
    assert.equal(created.status, 201);
    assert.deepEqual([created.json.name, created.json.startTime, created.json.graceLateMinutes, created.json.workDays, created.json.overnight, created.json.userCount], ['صبح', '08:00', 10, [0, 1, 2, 3, 6], false, 0]);
    const id = created.json.id;
    assert.equal((await hit('admin', 'POST', '/api/admin/shifts', good)).status, 409);
    const cAudit = auditRows('shift_created');
    assert.equal(cAudit.length, 1);
    assert.deepEqual([cAudit[0].details.shiftId, cAudit[0].details.reason, cAudit[0].details.source], [id, 'شیفت اصلی شرکت', 'admin_panel']);

    const night = await hit('admin', 'POST', '/api/admin/shifts', { name: 'شب', startTime: '22:00', endTime: '06:00', overnight: true, workDays: [6, 0, 1], reason: 'شیفت شب' });
    assert.equal(night.status, 201);
    assert.equal((await hit('admin', 'PATCH', `/api/admin/shifts/${id}`, { name: 'شب', reason: 'r' })).status, 409);
    assert.equal((await hit('admin', 'PATCH', `/api/admin/shifts/${night.json.id}`, { overnight: false, reason: 'r' })).status, 400, 'ساعت‌ها با مقدار ادغام‌شده سنجیده می‌شوند');

    assert.equal((await hit('admin', 'PATCH', `/api/admin/shifts/${id}`, { endTime: '17:00' })).status, 400, 'بدون دلیل');
    const upd = await hit('admin', 'PATCH', `/api/admin/shifts/${id}`, { endTime: '17:00', graceLateMinutes: 10, workDays: [0, 1, 2, 3, 6], reason: 'افزایش ساعت کار' });
    assert.equal(upd.status, 200);
    assert.equal(upd.json.changed, true);
    assert.equal(upd.json.shift.endTime, '17:00');
    const uAudit = auditRows('shift_updated');
    assert.equal(uAudit.length, 1);
    assert.deepEqual(uAudit[0].details.changes, { endTime: { before: '16:30', after: '17:00' } }, 'فقط فیلدهای واقعاً تغییرکرده');
    const noop = await hit('admin', 'PATCH', `/api/admin/shifts/${id}`, { endTime: '17:00', reason: 'تکرار' });
    assert.deepEqual([noop.status, noop.json.changed], [200, false]);
    assert.equal(auditRows('shift_updated').length, 1);

    assert.equal((await hit('admin', 'PATCH', '/api/admin/shifts/99999', { name: 'x', reason: 'r' })).status, 404);
    assert.equal((await hit('admin', 'GET', '/api/admin/shifts/abc')).status, 404);
    const list = await hit('manager', 'GET', '/api/admin/shifts');
    assert.deepEqual(list.json.map((s) => s.name).sort(), ['شب', 'صبح']);
  });

  test('انتساب: دلیل اجباری، شیفت/کاربر ناموجود ۴۰۴، no-op، برداشتن با null، audit؛ جزئیات شیفت برای سرپرست فقط تیم خودش', async () => {
    const shiftId = (await hit('admin', 'GET', '/api/admin/shifts')).json.find((s) => s.name === 'صبح').id;
    const url = (uid) => `/api/admin/users/${uid}/shift`;
    assert.equal((await hit('admin', 'PUT', url(mgrEmp.id), { shiftId })).status, 400, 'بدون دلیل');
    assert.equal((await hit('admin', 'PUT', url(mgrEmp.id), { reason: 'r' })).status, 400, 'بدون shiftId');
    assert.equal((await hit('admin', 'PUT', url(mgrEmp.id), { shiftId: 99999, reason: 'r' })).status, 404);
    assert.equal((await hit('admin', 'PUT', url(99999), { shiftId, reason: 'r' })).status, 404);
    assert.equal(db.prepare('SELECT shift_id FROM users WHERE id = ?').get(mgrEmp.id).shift_id, null);

    const a1 = await hit('admin', 'PUT', url(mgrEmp.id), { shiftId, reason: 'تغییر شیفت کارمند' });
    assert.deepEqual([a1.status, a1.json.changed, a1.json.shiftId, a1.json.shift.name], [200, true, shiftId, 'صبح']);
    assert.equal((await hit('admin', 'PUT', url(otherEmp.id), { shiftId, reason: 'r' })).json.changed, true);
    assert.equal((await hit('admin', 'PUT', url(mgrEmp.id), { shiftId, reason: 'تکرار' })).json.changed, false);
    const aud = auditRows('user_shift_assigned');
    assert.equal(aud.length, 2);
    assert.deepEqual(aud[0].details.changes, { shiftId: { before: null, after: shiftId } });
    assert.equal(aud[0].details.targetUserId, mgrEmp.id);

    const detailAdmin = await hit('admin', 'GET', `/api/admin/shifts/${shiftId}`);
    assert.deepEqual([detailAdmin.json.userCount, detailAdmin.json.users.map((u) => u.id).sort()], [2, [mgrEmp.id, otherEmp.id].sort()]);
    const detailMgr = await hit('manager', 'GET', `/api/admin/shifts/${shiftId}`);
    assert.deepEqual(detailMgr.json.users.map((u) => u.id), [mgrEmp.id], 'سرپرست کاربران تیم دیگر را نمی‌بیند');

    const off = await hit('admin', 'PUT', url(otherEmp.id), { shiftId: null, reason: 'برداشتن شیفت' });
    assert.deepEqual([off.json.changed, off.json.shiftId, off.json.shift], [true, null, null]);
    assert.equal(auditRows('user_shift_assigned')[2].details.changes.shiftId.after, null);
  });

  test('حذف: شیفت دارای کاربر ۴۰۹ HAS_USERS (بدون تغییر)؛ پس از برداشتن انتساب با دلیل حذف و audit می‌شود (دلیل از query هم پذیرفته است)', async () => {
    const shiftId = (await hit('admin', 'GET', '/api/admin/shifts')).json.find((s) => s.name === 'صبح').id; // mgrEmp هنوز منتسب است
    assert.equal((await hit('admin', 'DELETE', `/api/admin/shifts/${shiftId}`)).status, 400, 'بدون دلیل');
    const blocked = await hit('admin', 'DELETE', `/api/admin/shifts/${shiftId}`, { reason: 'پاک‌سازی' });
    assert.deepEqual([blocked.status, blocked.json.code, blocked.json.userCount], [409, 'HAS_USERS', 1]);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM work_shifts WHERE id = ?').get(shiftId).n, 1);
    assert.equal(auditRows('shift_deleted').length, 0);

    await hit('admin', 'PUT', `/api/admin/users/${mgrEmp.id}/shift`, { shiftId: null, reason: 'آزادسازی' });
    const del = await hit('admin', 'DELETE', `/api/admin/shifts/${shiftId}?reason=${encodeURIComponent('شیفت منسوخ')}`);
    assert.deepEqual([del.status, del.json.ok], [200, true]);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM work_shifts WHERE id = ?').get(shiftId).n, 0);
    const aud = auditRows('shift_deleted');
    assert.equal(aud.length, 1);
    assert.deepEqual([aud[0].details.shiftId, aud[0].details.shift.name, aud[0].details.reason], [shiftId, 'صبح', 'شیفت منسوخ']);
    assert.equal((await hit('admin', 'DELETE', `/api/admin/shifts/${shiftId}`, { reason: 'دوباره' })).status, 404);
  });
});

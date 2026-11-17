// مرحله ۲ (فاز A): سقف ماهانه‌ی اصلاح رکورد توسط سرپرست (پیش‌فرض ۳). بخش سرویس بدون express؛ بخش API فقط با express نصب‌شده.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

let hasDeps = true;
try { require.resolve('express'); } catch (_) { hasDeps = false; }

const registry = require('../src/utils/settingsRegistry');
const settingsRepository = require('../src/repositories/settingsRepository');
const quota = require('../src/services/recordEditQuotaService');

const NOW = new Date('2026-11-10T08:00:00Z'); // آبان ۱۴۰۵ (۱۹ آبان)
const insert = (db, userId, action, at, details = {}) => db.prepare('INSERT INTO audit_log (user_id, action, occurred_at, details) VALUES (?, ?, ?, ?)').run(userId, action, at, JSON.stringify(details));
const sql = (iso) => iso.slice(0, 19).replace('T', ' ');

describe('سقف اصلاح رکورد سرپرست — تنظیمات و سرویس', () => {
  let db, F, mgr, mgr2, admin, owner;
  before(() => {
    db = resetDb();
    F = require('./helpers/factories');
    mgr = F.makeUser({ role: 'manager' });
    mgr2 = F.makeUser({ role: 'manager' });
    admin = F.makeUser({ role: 'admin' });
    owner = F.makeUser({ role: 'owner' });
  });
  after(() => cleanup());
  beforeEach(() => {
    db.prepare('DELETE FROM audit_log').run();
    settingsRepository.resetValue('supervisorRecordEditMonthlyLimit');
    settingsRepository.resetValue('supervisorRecordEditCountMode');
  });

  test('رجیستری: پیش‌فرض ۳، بازه ۰–۱۰۰، حالت شمارش operation|record', () => {
    assert.deepEqual(registry.selfCheck(), []);
    const all = settingsRepository.getAll();
    assert.equal(all.supervisorRecordEditMonthlyLimit, 3);
    assert.equal(all.supervisorRecordEditCountMode, 'operation');
    assert.equal(registry.getDef('supervisorRecordEditMonthlyLimit').group, 'supervisors');
    assert.equal(registry.validate('supervisorRecordEditMonthlyLimit', 0).ok, true);
    assert.equal(registry.validate('supervisorRecordEditMonthlyLimit', 100).ok, true);
    assert.equal(registry.validate('supervisorRecordEditMonthlyLimit', 101).ok, false);
    assert.equal(registry.validate('supervisorRecordEditMonthlyLimit', -1).ok, false);
    assert.equal(registry.validate('supervisorRecordEditMonthlyLimit', 'x').ok, false);
    assert.equal(registry.validate('supervisorRecordEditCountMode', 'record').ok, true);
    assert.equal(registry.validate('supervisorRecordEditCountMode', 'both').ok, false);
    assert.equal(settingsRepository.getItem('supervisorRecordEditMonthlyLimit').section, 'سقف‌ها');
  });

  test('سه اصلاح مجاز؛ چهارمی ۴۰۹ با پیام و بدون audit اصلاح؛ رویداد blocked ثبت می‌شود', () => {
    for (let i = 0; i < 3; i += 1) {
      assert.equal(quota.assertCanEdit(mgr, { recordId: i + 1 }, { now: NOW }).ok, true);
      insert(db, mgr.id, 'attendance_record_manually_fixed', sql(NOW.toISOString()), { recordId: i + 1 });
    }
    const r = quota.assertCanEdit(mgr, { recordId: 9, targetUserId: 5 }, { now: NOW });
    assert.equal(r.ok, false);
    assert.equal(r.status, 409);
    assert.equal(r.code, 'RECORD_EDIT_LIMIT_REACHED');
    assert.match(r.error, /سقف اصلاح رکورد در این ماه \(3 بار\) تمام شده است/);
    const blocked = db.prepare("SELECT * FROM audit_log WHERE action = 'record_edit_limit_blocked'").all();
    assert.equal(blocked.length, 1);
    const d = JSON.parse(blocked[0].details);
    assert.equal(d.used, 3); assert.equal(d.limit, 3); assert.equal(d.targetUserId, 5);
    assert.equal(db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action = 'attendance_record_manually_fixed'").get().c, 3);
    assert.equal(quota.getUsage(mgr, NOW).remaining, 0);
  });

  test('limit=0 ⇒ بدون سقف؛ تغییر limit بدون ری‌استارت اثر می‌کند', () => {
    for (let i = 0; i < 5; i += 1) insert(db, mgr.id, 'break_record_deleted', sql(NOW.toISOString()), { recordId: i });
    assert.equal(quota.assertCanEdit(mgr, { recordId: 99 }, { now: NOW }).ok, false);
    settingsRepository.setValue('supervisorRecordEditMonthlyLimit', 0);
    assert.equal(quota.assertCanEdit(mgr, { recordId: 99 }, { now: NOW }).ok, true);
    settingsRepository.setValue('supervisorRecordEditMonthlyLimit', 6);
    assert.equal(quota.assertCanEdit(mgr, { recordId: 99 }, { now: NOW }).ok, true);
    assert.equal(quota.getUsage(mgr, NOW).remaining, 1);
  });

  test('ادمین/مالک معاف؛ سرپرست دیگر سهم جدا دارد؛ اصلاح ادمین به سهم سرپرست نمی‌رود', () => {
    for (let i = 0; i < 3; i += 1) insert(db, mgr.id, 'attendance_record_deleted', sql(NOW.toISOString()), { recordId: i });
    for (let i = 0; i < 10; i += 1) insert(db, admin.id, 'attendance_record_manually_fixed', sql(NOW.toISOString()), { recordId: i });
    assert.equal(quota.assertCanEdit(admin, {}, { now: NOW }).ok, true);
    assert.equal(quota.assertCanEdit(owner, {}, { now: NOW }).ok, true);
    assert.equal(quota.getUsage(admin, NOW).exempt, true);
    assert.equal(quota.assertCanEdit(mgr2, { recordId: 1 }, { now: NOW }).ok, true);
    assert.equal(quota.getUsage(mgr2, NOW).used, 0);
    assert.equal(quota.getUsage(mgr, NOW).used, 3);
  });

  test('همه‌ی انواع عملیات (رکورد/نوبت/استراحت/دورکاری) شمرده می‌شوند', () => {
    const acts = ['attendance_record_manually_created', 'attendance_segment_manually_edited', 'break_record_manually_created', 'remote_work_adjust'];
    acts.forEach((a, i) => insert(db, mgr.id, a, sql(NOW.toISOString()), { recordId: i + 1, sessionId: i + 1 }));
    insert(db, mgr.id, 'leave_approved', sql(NOW.toISOString()), {}); // غیر اصلاح رکورد
    settingsRepository.setValue('supervisorRecordEditMonthlyLimit', 10);
    assert.equal(quota.getUsage(mgr, NOW).used, 4);
  });

  test('مرز ماه شمسی: آخرین ثانیه‌ی ماه قبل نمی‌شمارد؛ اولین ثانیه‌ی ماه می‌شمارد؛ شروع ماه بعد صفر می‌شود', () => {
    // آبان ۱۴۰۵ = ۱۴۰۵-۰۸-۲۳(میلادی ۲۰۲۶-۱۰-۲۳) تا ۲۰۲۶-۱۱-۲۱ به وقت تهران (UTC+3:30)
    insert(db, mgr.id, 'attendance_record_deleted', '2026-10-22 20:29:59', { recordId: 1 }); // آخرین ثانیه‌ی مهر
    insert(db, mgr.id, 'attendance_record_deleted', '2026-10-22 20:30:00', { recordId: 2 }); // اولین ثانیه‌ی آبان
    insert(db, mgr.id, 'attendance_record_deleted', '2026-11-21 20:29:59', { recordId: 3 }); // آخرین ثانیه‌ی آبان
    assert.equal(quota.getUsage(mgr, new Date('2026-11-21T20:29:59Z')).used, 2);
    assert.equal(quota.getUsage(mgr, new Date('2026-11-21T20:30:00Z')).used, 0); // اول آذر
    assert.equal(quota.getUsage(mgr, new Date('2026-10-22T20:29:59Z')).used, 1); // هنوز مهر
  });

  test('mode=record: چند اصلاح روی یک رکورد یک بار؛ اصلاح دوباره‌ی همان رکوردِ شمرده‌شده حتی در سقف مجاز است', () => {
    settingsRepository.setValue('supervisorRecordEditCountMode', 'record');
    settingsRepository.setValue('supervisorRecordEditMonthlyLimit', 2);
    for (let i = 0; i < 3; i += 1) insert(db, mgr.id, 'attendance_record_manually_fixed', sql(NOW.toISOString()), { recordId: 1 });
    insert(db, mgr.id, 'break_record_manually_created', sql(NOW.toISOString()), { recordId: 2 });
    assert.equal(quota.getUsage(mgr, NOW).used, 2);
    assert.equal(quota.assertCanEdit(mgr, { recordId: 1 }, { now: NOW }).ok, true); // همان رکورد
    assert.equal(quota.assertCanEdit(mgr, { recordId: 2 }, { now: NOW }).ok, true);
    assert.equal(quota.assertCanEdit(mgr, { recordId: 3 }, { now: NOW }).ok, false); // رکورد تازه
    settingsRepository.setValue('supervisorRecordEditCountMode', 'operation'); // در حالت operation همان سه+یک اصلاح = ۴
    assert.equal(quota.getUsage(mgr, NOW).used, 4);
  });

  test('مقدار خراب/خطای خواندن تنظیم ⇒ پیش‌فرض ۳ (نه بدون سقف)', () => {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('supervisor_record_edit_monthly_limit', 'garbage')").run();
    assert.equal(quota.getUsage(mgr, NOW).limit, 3);
    const orig = settingsRepository.getAll;
    settingsRepository.getAll = () => { throw new Error('boom'); };
    try { assert.equal(quota.getUsage(mgr, NOW).limit, 3); } finally { settingsRepository.getAll = orig; }
  });
});

describe('سقف اصلاح رکورد سرپرست — API', { skip: hasDeps ? false : 'express نصب نیست (npm install)' }, () => {
  let server, base, db, F, mgr, emp, other, admin, hr, mgrCookie, adminCookie;

  before(async () => {
    db = resetDb();
    F = require('./helpers/factories');
    const { createApp } = require('../src/server');
    mgr = F.makeUser({ role: 'manager' });
    emp = F.makeUser({ role: 'employee', managerId: mgr.id });
    other = F.makeUser({ role: 'employee' });
    admin = F.makeUser({ role: 'admin' });
    hr = F.makeUser({ role: 'hr' });
    mgrCookie = F.sessionCookie(mgr.id);
    adminCookie = F.sessionCookie(admin.id);
    server = createApp().listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => { if (server) server.close(); cleanup(); });
  beforeEach(() => { settingsRepository.resetValue('supervisorRecordEditMonthlyLimit'); settingsRepository.resetValue('supervisorRecordEditCountMode'); });

  async function hit(cookie, method, url, body) {
    const res = await fetch(base + url, {
      method,
      headers: { 'content-type': 'application/json', 'x-requested-with': 'AttendancePanel', cookie },
      body: body && method !== 'GET' ? JSON.stringify(body) : undefined,
    });
    let json = null; try { json = await res.json(); } catch (_) { /* خالی */ }
    return { status: res.status, json };
  }
  const create = (cookie, n, userId = emp.id) => {
    const date = F.workdayDate(n);
    return hit(cookie, 'POST', '/api/admin/attendance-records', { userId, date, checkInTime: `${date}T04:30:00.000Z`, checkOutTime: `${date}T13:00:00.000Z`, status: 'normal', reason: 'تست' });
  };

  test('سرپرست: سه ایجاد موفق، چهارمی ۴۰۹ بدون تغییر داده؛ سهمیه‌ی GET درست؛ ادمین معاف و کارمند/hr بدون دسترسی', async () => {
    const ids = [];
    for (let n = 1; n <= 3; n += 1) { const r = await create(mgrCookie, n); assert.equal(r.status, 201); ids.push(r.json.id); }
    const before = db.prepare('SELECT COUNT(*) c FROM attendance_records').get().c;
    const r4 = await create(mgrCookie, 4);
    assert.equal(r4.status, 409);
    assert.equal(r4.json.code, 'RECORD_EDIT_LIMIT_REACHED');
    assert.equal(db.prepare('SELECT COUNT(*) c FROM attendance_records').get().c, before);

    // سایر مسیرهای نوشتن هم بسته‌اند
    const patch = await hit(mgrCookie, 'PATCH', `/api/admin/attendance-records/${ids[0]}`, { status: 'late', reason: 'x' });
    assert.equal(patch.status, 409);
    const del = await hit(mgrCookie, 'DELETE', `/api/admin/attendance-records/${ids[0]}`, { reason: 'x' });
    assert.equal(del.status, 409);
    const seg = await hit(mgrCookie, 'POST', `/api/admin/attendance-records/${ids[0]}/segments`, { checkInTime: new Date().toISOString(), reason: 'x' });
    assert.equal(seg.status, 409);
    const brk = await hit(mgrCookie, 'POST', `/api/admin/attendance-records/${ids[0]}/breaks`, { startTime: new Date().toISOString(), reason: 'x' });
    assert.equal(brk.status, 409);

    const q = await hit(mgrCookie, 'GET', '/api/admin/me/record-edit-quota');
    assert.equal(q.status, 200);
    assert.equal(q.json.limit, 3); assert.equal(q.json.used, 3); assert.equal(q.json.remaining, 0);

    // ادمین (حتی روی کارمند همان سرپرست) معاف است و به سهم سرپرست نمی‌رود
    assert.equal((await create(adminCookie, 5)).status, 201);
    assert.equal((await hit(mgrCookie, 'GET', '/api/admin/me/record-edit-quota')).json.used, 3);
    assert.equal((await hit(adminCookie, 'GET', '/api/admin/me/record-edit-quota')).json.exempt, true);

    assert.equal((await hit(F.sessionCookie(emp.id), 'GET', '/api/admin/me/record-edit-quota')).status, 403);
    assert.equal((await hit(F.sessionCookie(hr.id), 'GET', '/api/admin/me/record-edit-quota')).status, 403);

    // بالا بردن سقف از تنظیمات بدون ری‌استارت
    settingsRepository.setValue('supervisorRecordEditMonthlyLimit', 5);
    assert.equal((await create(mgrCookie, 6)).status, 201);
  });

  test('کارمند خارج از تیم ⇒ ۴۰۳ (نه ۴۰۹) حتی در سقف؛ هم‌زمان‌ها از سقف نمی‌گذرند', async () => {
    settingsRepository.setValue('supervisorRecordEditMonthlyLimit', 5); // از تست قبل ۴ اصلاح مصرف شده
    const used = (await hit(mgrCookie, 'GET', '/api/admin/me/record-edit-quota')).json;
    const left = used.remaining;
    const out = await create(mgrCookie, 20, other.id);
    assert.equal(out.status, 403);
    const rs = await Promise.all(Array.from({ length: left + 3 }, (_, i) => create(mgrCookie, 30 + i)));
    assert.equal(rs.filter((r) => r.status === 201).length, left);
    assert.equal(rs.filter((r) => r.status === 409).length, 3);
  });
});

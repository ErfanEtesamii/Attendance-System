// فاز D (بخش ۱): استثنا برای هر سرپرست — اولویت استثنا > تنظیم سراسری. بخش API فقط با express نصب‌شده.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

let hasDeps = true;
try { require.resolve('express'); } catch (_) { hasDeps = false; }

const settingsRepository = require('../src/repositories/settingsRepository');
const repo = require('../src/repositories/supervisorOverridesRepository');
const overrides = require('../src/services/supervisorOverrideService');
const keys = require('../src/utils/supervisorOverrideKeys');
const quota = require('../src/services/recordEditQuotaService');

const NOW = new Date('2026-11-10T08:00:00Z');

describe('استثنای سرپرست — کلیدها، مخزن و سرویس', () => {
  let db, F, mgr, mgr2, admin;
  before(() => {
    db = resetDb();
    F = require('./helpers/factories');
    mgr = F.makeUser({ role: 'manager' });
    mgr2 = F.makeUser({ role: 'manager' });
    admin = F.makeUser({ role: 'admin' });
  });
  after(() => cleanup());
  beforeEach(() => {
    db.prepare('DELETE FROM supervisor_overrides').run();
    db.prepare('DELETE FROM audit_log').run();
    settingsRepository.resetValue('supervisorRecordEditMonthlyLimit');
    settingsRepository.resetValue('nightlyReviewSendEnabled');
  });

  test('migration: جدول وجود دارد و بدون سطر هیچ اثری ندارد', () => {
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='supervisor_overrides'").get());
    assert.equal(db.prepare('SELECT COUNT(*) c FROM supervisor_overrides').get().c, 0);
    assert.equal(overrides.overrideOf(mgr, 'nightlyReviewSendEnabled'), undefined);
    assert.equal(overrides.effective(mgr, 'nightlyReviewSendEnabled', true), true);
  });

  test('کلیدهای مجاز و اعتبارسنجی مقدار', () => {
    for (const k of keys.SUPERVISOR_OVERRIDE_KEYS) assert.ok(require('../src/utils/settingsRegistry').getDef(k), `کلید ${k} در رجیستری نیست`);
    assert.equal(keys.validateOverride('nightlyReviewSendEnabled', false).ok, true);
    assert.equal(keys.validateOverride('nightlyReviewSendEnabled', 'false').ok, false);
    assert.equal(keys.validateOverride('nightlyReviewSendEnabled', 1).ok, false);
    assert.equal(keys.validateOverride('supervisorRecordEditMonthlyLimit', 0).ok, true);
    assert.equal(keys.validateOverride('supervisorRecordEditMonthlyLimit', 100).ok, true);
    assert.equal(keys.validateOverride('supervisorRecordEditMonthlyLimit', 101).ok, false);
    assert.equal(keys.validateOverride('supervisorRecordEditMonthlyLimit', -1).ok, false);
    assert.equal(keys.validateOverride('supervisorRecordEditMonthlyLimit', 2.5).ok, false);
    assert.equal(keys.validateOverride('supervisorRecordEditMonthlyLimit', '3').ok, false);
    assert.equal(keys.validateOverride('lateMonthlyLimit', 1).ok, false); // خارج از فهرست مجاز
    assert.equal(keys.validateOverride('__proto__', true).ok, false);
  });

  test('مخزن: set/get/upsert/remove/mapForKey و حذف دائمی کاربر ⇒ پاک‌شدن استثناها', () => {
    repo.set(mgr.id, 'morningDigestEnabled', false);
    repo.set(mgr2.id, 'morningDigestEnabled', true);
    assert.equal(repo.get(mgr.id, 'morningDigestEnabled'), false);
    repo.set(mgr.id, 'morningDigestEnabled', true); // upsert
    assert.equal(db.prepare('SELECT COUNT(*) c FROM supervisor_overrides WHERE user_id = ?').get(mgr.id).c, 1);
    assert.deepEqual([...repo.mapForKey('morningDigestEnabled').entries()].sort(), [[mgr.id, true], [mgr2.id, true]].sort());
    assert.deepEqual(repo.listByUser(mgr.id), { morningDigestEnabled: true });
    assert.equal(repo.remove(mgr.id, 'morningDigestEnabled'), true);
    assert.equal(repo.remove(mgr.id, 'morningDigestEnabled'), false);
    require('../src/repositories/usersRepository').deleteUserPermanently(mgr2.id);
    assert.equal(db.prepare('SELECT COUNT(*) c FROM supervisor_overrides').get().c, 0);
    mgr2 = F.makeUser({ role: 'manager' });
  });

  test('سرویس: اولویت استثنا؛ فقط manager؛ مقدار خراب نادیده؛ anyOverrideEquals', () => {
    repo.set(mgr.id, 'nightlyReviewSendEnabled', false);
    assert.equal(overrides.effective(mgr, 'nightlyReviewSendEnabled', true), false);
    assert.equal(overrides.effective(mgr2, 'nightlyReviewSendEnabled', true), true);
    // برای نقش‌های دیگر هرگز اعمال نمی‌شود (حتی اگر سطری باشد)
    db.prepare("INSERT INTO supervisor_overrides (user_id, key, value) VALUES (?, 'nightlyReviewSendEnabled', 'false')").run(admin.id);
    assert.equal(overrides.effective(admin, 'nightlyReviewSendEnabled', true), true);
    // استثنای روشن وقتی سراسری خاموش است
    settingsRepository.setValue('nightlyReviewSendEnabled', false);
    repo.set(mgr2.id, 'nightlyReviewSendEnabled', true);
    assert.equal(overrides.effective(mgr2, 'nightlyReviewSendEnabled', false), true);
    assert.equal(overrides.anyOverrideEquals('nightlyReviewSendEnabled', true), true);
    // مقدار خراب/خارج از بازه ⇒ نادیده
    db.prepare("UPDATE supervisor_overrides SET value = 'garbage' WHERE user_id = ?").run(mgr.id);
    assert.equal(overrides.overrideOf(mgr, 'nightlyReviewSendEnabled'), undefined);
    db.prepare("INSERT OR REPLACE INTO supervisor_overrides (user_id, key, value) VALUES (?, 'supervisorRecordEditMonthlyLimit', '500')").run(mgr.id);
    assert.equal(overrides.overrideOf(mgr, 'supervisorRecordEditMonthlyLimit'), undefined);
    assert.equal(overrides.overrideOf(mgr, 'lateMonthlyLimit'), undefined);
  });

  test('سقف اصلاح رکورد: استثنای همین سرپرست اثر می‌کند؛ بقیه سراسری می‌مانند؛ ۰ = بدون سقف', () => {
    assert.equal(quota.getUsage(mgr, NOW).limit, 3);
    repo.set(mgr.id, 'supervisorRecordEditMonthlyLimit', 1);
    assert.equal(quota.getUsage(mgr, NOW).limit, 1);
    assert.equal(quota.getUsage(mgr2, NOW).limit, 3);
    const ins = (userId) => db.prepare('INSERT INTO audit_log (user_id, action, occurred_at, details) VALUES (?, ?, ?, ?)').run(userId, 'attendance_record_manually_fixed', '2026-11-05 08:00:00', JSON.stringify({ recordId: 1 }));
    ins(mgr.id);
    assert.equal(quota.assertCanEdit(mgr, { recordId: 2 }, { now: NOW }).ok, false);
    assert.equal(quota.assertCanEdit(mgr2, { recordId: 2 }, { now: NOW }).ok, true);
    repo.set(mgr.id, 'supervisorRecordEditMonthlyLimit', 0);
    assert.equal(quota.assertCanEdit(mgr, { recordId: 2 }, { now: NOW }).ok, true);
    assert.equal(quota.getUsage(mgr, NOW).unlimited, true);
    // استثنا روی ادمین (معاف) بی‌اثر است
    assert.equal(quota.getUsage(admin, NOW).exempt, true);
  });
});

describe('استثنای سرپرست — API', { skip: hasDeps ? false : 'express نصب نیست (npm install)' }, () => {
  let server, base, db, F, mgr, mgr2, emp, admin, owner, hr, adminCookie, ownerCookie;

  before(async () => {
    db = resetDb();
    F = require('./helpers/factories');
    const { createApp } = require('../src/server');
    mgr = F.makeUser({ role: 'manager' });
    mgr2 = F.makeUser({ role: 'manager' });
    emp = F.makeUser({ role: 'employee', managerId: mgr.id });
    admin = F.makeUser({ role: 'admin' });
    owner = F.makeUser({ role: 'owner' });
    hr = F.makeUser({ role: 'hr' });
    adminCookie = F.sessionCookie(admin.id);
    ownerCookie = F.sessionCookie(owner.id);
    server = createApp().listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => { if (server) server.close(); cleanup(); });
  beforeEach(() => { db.prepare('DELETE FROM supervisor_overrides').run(); db.prepare('DELETE FROM audit_log').run(); });

  async function hit(cookie, method, url, body) {
    const res = await fetch(base + url, {
      method,
      headers: { 'content-type': 'application/json', 'x-requested-with': 'AttendancePanel', cookie },
      body: body && method !== 'GET' ? JSON.stringify(body) : undefined,
    });
    let json = null; try { json = await res.json(); } catch (_) { /* خالی */ }
    return { status: res.status, json };
  }
  const url = (id, key) => `/api/admin/supervisors/${id}/overrides${key ? `/${key}` : ''}`;

  test('فقط admin/owner؛ manager/hr/employee ⇒ ۴۰۳', async () => {
    for (const u of [mgr, hr, emp]) {
      const c = F.sessionCookie(u.id);
      assert.equal((await hit(c, 'GET', url(mgr.id))).status, 403);
      assert.equal((await hit(c, 'PUT', url(mgr.id, 'morningDigestEnabled'), { value: false, reason: 'x' })).status, 403);
      assert.equal((await hit(c, 'DELETE', url(mgr.id, 'morningDigestEnabled'), { reason: 'x' })).status, 403);
    }
    assert.equal(db.prepare('SELECT COUNT(*) c FROM supervisor_overrides').get().c, 0);
  });

  test('GET: همه‌ی کلیدها با مقدار سراسری/استثنا/مؤثر', async () => {
    const r = await hit(adminCookie, 'GET', url(mgr.id));
    assert.equal(r.status, 200);
    assert.equal(r.json.items.length, keys.SUPERVISOR_OVERRIDE_KEYS.length);
    const lim = r.json.items.find((i) => i.key === 'supervisorRecordEditMonthlyLimit');
    assert.equal(lim.global, 3); assert.equal(lim.hasOverride, false); assert.equal(lim.effective, 3);
    await hit(adminCookie, 'PUT', url(mgr.id, 'supervisorRecordEditMonthlyLimit'), { value: 7, reason: 'تست' });
    const r2 = await hit(adminCookie, 'GET', url(mgr.id));
    const lim2 = r2.json.items.find((i) => i.key === 'supervisorRecordEditMonthlyLimit');
    assert.equal(lim2.override, 7); assert.equal(lim2.effective, 7); assert.equal(lim2.global, 3);
  });

  test('PUT: دلیل اجباری (جز owner)، اعتبارسنجی، audit، بدون تغییر ⇒ بدون audit', async () => {
    const k = 'nightlyReviewSendEnabled';
    assert.equal((await hit(adminCookie, 'PUT', url(mgr.id, k), { value: false })).status, 400);
    assert.equal((await hit(adminCookie, 'PUT', url(mgr.id, k), { value: 'no', reason: 'x' })).status, 400);
    assert.equal((await hit(adminCookie, 'PUT', url(mgr.id, 'lateMonthlyLimit'), { value: 1, reason: 'x' })).status, 400);
    assert.equal((await hit(adminCookie, 'PUT', url(mgr.id, 'supervisorRecordEditMonthlyLimit'), { value: 101, reason: 'x' })).status, 400);
    assert.equal(db.prepare('SELECT COUNT(*) c FROM supervisor_overrides').get().c, 0);

    const ok = await hit(adminCookie, 'PUT', url(mgr.id, k), { value: false, reason: 'مرخصی طولانی' });
    assert.equal(ok.status, 200); assert.equal(ok.json.changed, true);
    assert.equal(repo.get(mgr.id, k), false);
    const rows = db.prepare("SELECT details FROM audit_log WHERE action = 'supervisor_override_set'").all();
    assert.equal(rows.length, 1);
    assert.match(rows[0].details, /nightlyReviewSendEnabled/);
    const again = await hit(adminCookie, 'PUT', url(mgr.id, k), { value: false, reason: 'تکرار' });
    assert.equal(again.json.changed, false);
    assert.equal(db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action = 'supervisor_override_set'").get().c, 1);
    // owner بدون دلیل مجاز است
    assert.equal((await hit(ownerCookie, 'PUT', url(mgr2.id, k), { value: true })).status, 200);
  });

  test('هدف غیرسرپرست/ناموجود ⇒ ۴۰۰/۴۰۴؛ DELETE: دلیل اجباری، حذف، idempotent', async () => {
    assert.equal((await hit(adminCookie, 'PUT', url(emp.id, 'morningDigestEnabled'), { value: false, reason: 'x' })).status, 400);
    assert.equal((await hit(adminCookie, 'PUT', url(admin.id, 'morningDigestEnabled'), { value: false, reason: 'x' })).status, 400);
    assert.equal((await hit(adminCookie, 'GET', url(999999))).status, 404);

    await hit(adminCookie, 'PUT', url(mgr.id, 'morningDigestEnabled'), { value: false, reason: 'x' });
    assert.equal((await hit(adminCookie, 'DELETE', url(mgr.id, 'morningDigestEnabled'), {})).status, 400);
    const del = await hit(adminCookie, 'DELETE', url(mgr.id, 'morningDigestEnabled'), { reason: 'برگشت' });
    assert.equal(del.status, 200); assert.equal(del.json.removed, true);
    assert.equal(repo.get(mgr.id, 'morningDigestEnabled'), undefined);
    assert.equal(db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action = 'supervisor_override_cleared'").get().c, 1);
    const del2 = await hit(adminCookie, 'DELETE', url(mgr.id, 'morningDigestEnabled'), { reason: 'دوباره' });
    assert.equal(del2.json.removed, false);
    assert.equal(db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action = 'supervisor_override_cleared'").get().c, 1);
  });
});

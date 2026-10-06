// S2-6a: ساختار آرشیو audit (migration 007) و تنظیمات audit_retention_months / audit_archive_enabled.
// هنوز هیچ Job یا انتقالی وجود ندارد؛ این تست‌ها همین را هم تضمین می‌کنند.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const F = require('./helpers/factories');
const settings = require('../src/repositories/settingsRepository');
const auditRepository = require('../src/repositories/auditRepository');
const usersRepository = require('../src/repositories/usersRepository');

let hasDeps = true;
try { require.resolve('express'); } catch (_) { hasDeps = false; }

describe('آرشیو audit — ساختار و تنظیمات (S2-6a)', () => {
  let db;
  before(() => { db = resetDb(); });
  after(() => cleanup());

  test('migration 007: جدول آرشیو با همان ستون‌های audit_log، ایندکس‌ها، خالی و idempotent', () => {
    const cols = (t) => db.pragma(`table_info(${t})`).map((c) => `${c.name}:${c.type}`);
    assert.deepEqual(cols('audit_log_archive'), cols('audit_log'));
    const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map((r) => r.name);
    for (const n of ['idx_audit_archive_occurred', 'idx_audit_archive_user', 'idx_audit_occurred']) assert.ok(idx.includes(n), n);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM audit_log_archive').get().n, 0);
    // id آرشیو AUTOINCREMENT نیست (id اصلی در S2-6c حفظ می‌شود) و occurred_at پیش‌فرض ندارد
    const sql = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'audit_log_archive'").get().sql;
    assert.doesNotMatch(sql, /AUTOINCREMENT/i);
    assert.equal(db.pragma('table_info(audit_log_archive)').find((c) => c.name === 'occurred_at').dflt_value, null);
    assert.doesNotThrow(() => require('../src/db/migrations/007_audit_archive').up(db), 'اجرای دوباره بی‌خطاست');
    assert.equal(db.prepare("SELECT name FROM schema_migrations WHERE name = '007_audit_archive'").all().length, 1);
  });

  test('تنظیمات: پیش‌فرض ۲۴ ماه و خاموش؛ مقدار نامعتبر/خارج از بازه نادیده؛ بقیه‌ی تنظیمات دست‌نخورده؛ چیزی منتقل نمی‌شود', () => {
    db.exec("DELETE FROM settings WHERE key IN ('audit_retention_months', 'audit_archive_enabled')");
    const before = settings.getAll();
    assert.equal(before.auditRetentionMonths, 24);
    assert.equal(before.auditArchiveEnabled, false);
    assert.equal(settings.getAuditRetentionMonths(), 24);
    assert.equal(settings.isAuditArchiveEnabled(), false);

    for (const bad of [0, -1, 241, 'abc', '12abc', 1.5, '', null]) {
      assert.equal(settings.update({ auditRetentionMonths: bad }).auditRetentionMonths, 24, `نامعتبر: ${bad}`);
    }
    assert.equal(settings.update({ auditRetentionMonths: '12' }).auditRetentionMonths, 12);
    assert.equal(settings.getAuditRetentionMonths(), 12);
    assert.equal(settings.update({ auditRetentionMonths: 999 }).auditRetentionMonths, 12, 'خارج از بازه مقدار قبلی را عوض نمی‌کند');
    // مقدار خراب در DB ⇒ پیش‌فرض (نه NaN)
    db.prepare("UPDATE settings SET value = 'x' WHERE key = 'audit_retention_months'").run();
    assert.equal(settings.getAll().auditRetentionMonths, 24);
    assert.equal(settings.getAuditRetentionMonths(), 24);

    assert.equal(settings.update({ auditArchiveEnabled: true }).auditArchiveEnabled, true);
    assert.equal(settings.isAuditArchiveEnabled(), true);
    assert.equal(settings.update({ auditArchiveEnabled: 'abc' }).auditArchiveEnabled, true, 'نامعتبر نادیده');
    assert.equal(settings.update({ auditArchiveEnabled: 'false' }).auditArchiveEnabled, false);

    // تنظیم‌های قبلی همان‌اند
    const { auditRetentionMonths, auditArchiveEnabled, ...rest } = settings.getAll();
    const { auditRetentionMonths: _a, auditArchiveEnabled: _b, ...rest0 } = before;
    assert.deepEqual(rest, rest0);

    // روشن‌بودن آرشیو هنوز چیزی را جابه‌جا نمی‌کند (Job در S2-6b/6c)
    auditRepository.logEvent({ action: 'old_event', details: { n: 1 } });
    db.prepare("UPDATE audit_log SET occurred_at = '2000-01-01 00:00:00'").run();
    settings.update({ auditArchiveEnabled: true });
    assert.ok(db.prepare('SELECT COUNT(*) n FROM audit_log').get().n >= 1);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM audit_log_archive').get().n, 0);
    settings.update({ auditArchiveEnabled: false });
  });

  test('حذف دائمی کاربر: ردیف‌های audit و آرشیو حذف نمی‌شوند، فقط user_id = NULL (بدون خطای FK)', () => {
    const u = F.makeUser();
    const live = auditRepository.logEvent({ userId: u.id, action: 'x_live' });
    db.prepare('INSERT INTO audit_log_archive (id, user_id, action, occurred_at, details) VALUES (?, ?, ?, ?, ?)')
      .run(live.id + 1000, u.id, 'x_archived', '2001-02-03 04:05:06', '{"a":1}');
    assert.doesNotThrow(() => usersRepository.deleteUserPermanently(u.id));
    assert.equal(db.prepare('SELECT user_id FROM audit_log WHERE id = ?').get(live.id).user_id, null);
    const arch = db.prepare('SELECT * FROM audit_log_archive WHERE id = ?').get(live.id + 1000);
    assert.equal(arch.user_id, null);
    assert.equal(arch.action, 'x_archived');
    assert.equal(arch.occurred_at, '2001-02-03 04:05:06');
    assert.equal(arch.details, '{"a":1}');
    db.exec('DELETE FROM audit_log_archive');
  });

  test('API تنظیمات: ادمین می‌خواند/می‌نویسد و audit می‌ماند؛ سرپرست نمی‌نویسد', { skip: hasDeps ? false : 'express نصب نیست' }, async () => {
    const { createApp } = require('../src/server');
    const admin = F.makeUser({ role: 'admin' });
    const mgr = F.makeUser({ role: 'manager' });
    const server = createApp().listen(0);
    await new Promise((r) => server.once('listening', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    const hit = async (user, method, body) => {
      const res = await fetch(`${base}/api/admin/settings`, {
        method,
        headers: { 'content-type': 'application/json', 'x-requested-with': 'AttendancePanel', cookie: F.sessionCookie(user.id) },
        body: method === 'GET' ? undefined : JSON.stringify(body),
      });
      return { status: res.status, json: await res.json() };
    };
    try {
      const got = await hit(admin, 'GET');
      assert.equal(got.json.auditRetentionMonths, 24);
      assert.equal(got.json.auditArchiveEnabled, false);
      const set = await hit(admin, 'PATCH', { auditRetentionMonths: 36, auditArchiveEnabled: true });
      assert.equal(set.status, 200);
      assert.equal(set.json.auditRetentionMonths, 36);
      assert.equal(set.json.auditArchiveEnabled, true);
      assert.equal((await hit(mgr, 'PATCH', { auditRetentionMonths: 1 })).status, 403);
      assert.equal(settings.getAuditRetentionMonths(), 36);
    } finally {
      server.close();
      settings.update({ auditRetentionMonths: 24, auditArchiveEnabled: false });
    }
  });
});

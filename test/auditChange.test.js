// S4-1a: auditRepository.logChange — diff فقط فیلدهای تغییرکرده، حذف فیلدهای حساس، sanitizeText،
// و بی‌تغییر ماندن جدول audit_log و ورودی‌های قدیمی (logEvent).
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { getDb } = require('../src/db/connection');
const auditRepository = require('../src/repositories/auditRepository');
const { buildChanges, isSensitiveKey } = require('../src/utils/auditDiff');
const { makeUser } = require('./helpers/factories');

const details = (row) => JSON.parse(row.details);

let admin; let other; let third;
before(() => {
  resetDb();
  // audit_log.user_id کلید خارجی به users است؛ actorها باید کاربر واقعی باشند
  admin = makeUser({ role: 'admin' });
  other = makeUser({ role: 'manager' });
  third = makeUser();
});
after(() => { cleanup(); });

describe('diff: فقط فیلدهای تغییرکرده', () => {
  test('ویرایش: فقط role و department؛ قبل/بعد دقیق، actor/ip/entity درست', () => {
    const row = auditRepository.logChange({
      actor: admin.id,
      action: 'user_updated',
      entityType: 'user',
      entityId: 12,
      before: { full_name: 'علی', role: 'employee', department: 'فنی', is_active: 1 },
      after: { full_name: 'علی', role: 'manager', department: 'مالی', is_active: 1 },
      reason: 'ارتقا',
      ip: '192.168.10.5',
    });
    assert.equal(row.user_id, admin.id);
    assert.equal(row.action, 'user_updated');
    assert.equal(row.ip_address, '192.168.10.5');
    assert.deepEqual(details(row), {
      entityType: 'user',
      entityId: 12,
      changes: {
        role: { before: 'employee', after: 'manager' },
        department: { before: 'فنی', after: 'مالی' },
      },
      reason: 'ارتقا',
    });
  });

  test('ایجاد (before=null) همه‌ی فیلدهای after و حذف (after=null) همه‌ی فیلدهای before را می‌آورد', () => {
    const created = details(auditRepository.logChange({ actor: admin.id, action: 'holiday_created', entityType: 'holiday', entityId: 3, before: null, after: { date: '2026-10-09', title: 'تعطیل' } }));
    assert.deepEqual(created.changes, { date: { before: null, after: '2026-10-09' }, title: { before: null, after: 'تعطیل' } });
    const removed = details(auditRepository.logChange({ actor: admin.id, action: 'holiday_removed', entityType: 'holiday', entityId: 3, before: { date: '2026-10-09' }, after: null }));
    assert.deepEqual(removed.changes, { date: { before: '2026-10-09', after: null } });
  });

  test('تغییرنکرده حساب نمی‌شود: ترتیب کلید، آبجکت/آرایه‌ی تودرتوی برابر، Date برابر، undefined≡null', () => {
    const { changes } = buildChanges(
      { a: 1, nested: { x: 1, y: [1, 2] }, when: new Date('2026-10-07T10:00:00Z'), gone: undefined },
      { nested: { y: [1, 2], x: 1 }, a: 1, when: new Date('2026-10-07T10:00:00Z'), gone: null },
    );
    assert.deepEqual(changes, {});
    const diff = buildChanges({ nested: { y: [1, 2] } }, { nested: { y: [1, 3] } }).changes;
    assert.deepEqual(diff, { nested: { before: { y: [1, 2] }, after: { y: [1, 3] } } });
  });

  test('هیچ فیلدی تغییر نکرده ⇒ باز هم رکورد ثبت می‌شود (changes خالی)؛ actor آبجکت و null پذیرفته است', () => {
    const row = auditRepository.logChange({ actor: { id: other.id, role: 'manager' }, action: 'session_revoked', entityType: 'session', entityId: 'abc', before: { v: 1 }, after: { v: 1 } });
    assert.equal(row.user_id, other.id);
    assert.deepEqual(details(row), { entityType: 'session', entityId: 'abc', changes: {} });
    assert.equal(auditRepository.logChange({ action: 'system_job', entityType: 'job' }).user_id, null);
  });

  test('رشته‌ی بلند کوتاه می‌شود (۵۰۰ نویسه) اما تشخیص تغییر روی مقدار کامل است', () => {
    const base = 'x'.repeat(600);
    const { changes } = buildChanges({ note: base }, { note: `${base}y` });
    assert.equal(Object.keys(changes).length, 1, 'تفاوت بعد از نویسه‌ی ۵۰۰ هم تغییر است');
    assert.ok(changes.note.after.length <= 501);
  });
});

describe('راز ذخیره نمی‌شود', () => {
  const FAKE_TOKEN = '123456789:AAEhBP0av28ZVxxxxxxxxxxxxxxxxxxxxxxxx'; // secret-scan:allow (توکن ساختگی)

  test('فیلدهای token/secret/hash/password/api_key حذف می‌شوند؛ در هیچ‌جای details و audit_log دیده نمی‌شوند', () => {
    const row = auditRepository.logChange({
      actor: admin.id,
      action: 'user_updated',
      entityType: 'user',
      entityId: 5,
      before: { full_name: 'الف', password_hash: 'OLD-HASH-VALUE', api_token: 'OLD-TOKEN-VALUE', session_secret: 'OLD-SECRET-VALUE', apiKey: 'OLD-KEY-VALUE' },
      after: { full_name: 'ب', password_hash: 'NEW-HASH-VALUE', api_token: 'NEW-TOKEN-VALUE', session_secret: 'NEW-SECRET-VALUE', apiKey: 'NEW-KEY-VALUE' },
    });
    const d = details(row);
    assert.deepEqual(d.changes, { full_name: { before: 'الف', after: 'ب' } });
    assert.deepEqual(d.redacted.sort(), ['apiKey', 'api_token', 'password_hash', 'session_secret']);
    const stored = getDb().prepare('SELECT details FROM audit_log WHERE id = ?').get(row.id).details;
    for (const secret of ['OLD-HASH-VALUE', 'NEW-HASH-VALUE', 'OLD-TOKEN-VALUE', 'NEW-TOKEN-VALUE', 'OLD-SECRET-VALUE', 'NEW-SECRET-VALUE', 'OLD-KEY-VALUE', 'NEW-KEY-VALUE']) {
      assert.ok(!stored.includes(secret), `${secret} نباید ذخیره شود`);
    }
  });

  test('حساس‌ها در عمق هم حذف می‌شوند؛ فیلد حساسِ تغییرنکرده اصلاً اثری ندارد', () => {
    const row = auditRepository.logChange({
      actor: admin.id,
      action: 'settings_updated',
      entityType: 'settings',
      before: { cfg: { host: 'a', auth: { token: 'DEEP-TOKEN-1', user: 'u' } }, secret_key: 'SAME' },
      after: { cfg: { host: 'b', auth: { token: 'DEEP-TOKEN-2', user: 'u' } }, secret_key: 'SAME' },
    });
    const d = details(row);
    assert.deepEqual(d.changes, { cfg: { before: { host: 'a', auth: { user: 'u' } }, after: { host: 'b', auth: { user: 'u' } } } });
    assert.equal(d.redacted, undefined);
    assert.ok(!row.details.includes('DEEP-TOKEN'));
  });

  test('توکن بات داخل متن عادی (مقدار فیلد و reason) با sanitizeText ⇒ [REDACTED]', () => {
    const row = auditRepository.logChange({
      actor: admin.id,
      action: 'monitor_updated',
      entityType: 'alert',
      entityId: 1,
      before: { message: 'ok' },
      after: { message: `خطا: https://api.telegram.org/bot${FAKE_TOKEN}/getMe` },
      reason: `بررسی ${FAKE_TOKEN}`,
    });
    assert.ok(!row.details.includes(FAKE_TOKEN));
    assert.ok(!row.details.includes('AAEhBP0av28Z'));
    const d = details(row);
    assert.match(d.changes.message.after, /\[REDACTED\]/);
    assert.match(d.reason, /\[REDACTED\]/);
  });

  test('isSensitiveKey: نام‌های رایج حساس بله، نام‌های عادی خیر', () => {
    for (const k of ['token', 'telegram_token', 'sessionSecret', 'password_hash', 'passwd', 'api_key', 'API-KEY']) assert.ok(isSensitiveKey(k), k);
    for (const k of ['full_name', 'role', 'session_version', 'telegram_user_id', 'department']) assert.ok(!isSensitiveKey(k), k);
  });
});

describe('سازگاری با ساختار قدیمی', () => {
  test('ستون‌های audit_log تغییر نکرده و logEvent قدیمی مثل قبل کار می‌کند', () => {
    const cols = getDb().prepare('PRAGMA table_info(audit_log)').all().map((c) => c.name);
    assert.deepEqual(cols, ['id', 'user_id', 'action', 'occurred_at', 'ip_address', 'details']);
    const legacy = auditRepository.logEvent({ userId: third.id, action: 'legacy_action', ipAddress: '10.0.0.1', details: { source: 'admin_panel', fields: ['a'] } });
    assert.equal(legacy.user_id, third.id);
    assert.deepEqual(details(legacy), { source: 'admin_panel', fields: ['a'] });
    assert.equal(auditRepository.logEvent({ action: 'plain', details: 'متن آزاد' }).details, 'متن آزاد');
  });

  test('رکورد logChange با search/listByUser/listActions خوانده می‌شود', () => {
    auditRepository.logChange({ actor: third.id, action: 'findme_changed', entityType: 'x', entityId: 1, before: { a: 1 }, after: { a: 2 } });
    assert.equal(auditRepository.search({ action: 'findme_changed' }).length, 1);
    assert.equal(auditRepository.search({ q: 'findme' }).length, 1);
    assert.ok(auditRepository.listByUser(third.id).some((r) => r.action === 'findme_changed'));
    assert.ok(auditRepository.listActions().some((a) => a.action === 'findme_changed'));
  });

  test('ورودی نامعتبر: بدون action/entityType یا before غیرآبجکت یا actor غیرعددی ⇒ خطای صریح و رکوردی ثبت نمی‌شود', () => {
    const count = () => getDb().prepare('SELECT COUNT(*) AS n FROM audit_log').get().n;
    const n0 = count();
    assert.throws(() => auditRepository.logChange({ entityType: 'x' }), /action/);
    assert.throws(() => auditRepository.logChange({ action: 'a' }), /entityType/);
    assert.throws(() => auditRepository.logChange({ action: 'a', entityType: 'x', before: 'str' }), /before/);
    assert.throws(() => auditRepository.logChange({ action: 'a', entityType: 'x', after: [1] }), /after/);
    assert.throws(() => auditRepository.logChange({ actor: 'admin', action: 'a', entityType: 'x' }), /actor/);
    assert.equal(count(), n0);
  });
});

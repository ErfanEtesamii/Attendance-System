// S4-2a: API خواندن audit — فیلتر کاربر/عمل/موجودیت/بازه روی لیست و CSV؛ ورودی قدیمی ساده؛ دسترسی همان قبلی (فقط ادمین کل).
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

let hasDeps = true;
try { require.resolve('express'); } catch (_) { hasDeps = false; }

describe('API خواندن audit با فیلتر (S4-2a)', { skip: hasDeps ? false : 'express نصب نیست (npm install)' }, () => {
  let server, base, db, cookies, admin, other, repo;

  before(async () => {
    db = resetDb();
    const F = require('./helpers/factories');
    repo = require('../src/repositories/auditRepository');
    const { createApp } = require('../src/server');
    admin = F.makeUser({ role: 'admin' });
    other = F.makeUser({ role: 'admin' });
    const manager = F.makeUser({ role: 'manager' });
    cookies = { admin: F.sessionCookie(admin.id), manager: F.sessionCookie(manager.id) };

    // ردیف‌های جدید (logChange) با زمان‌های مشخص + ردیف قدیمی متنی/غیر JSON + ردیف JSON بدون entityType
    const mk = (o, at) => { const r = repo.logChange(o); db.prepare('UPDATE audit_log SET occurred_at = ? WHERE id = ?').run(at, r.id); return r; };
    mk({ actor: admin.id, action: 'employee_profile_edited', entityType: 'user', entityId: 12, before: { role: 'employee' }, after: { role: 'manager' } }, '2026-09-01 08:00:00');
    mk({ actor: admin.id, action: 'employee_deleted', entityType: 'user', entityId: 13, before: { role: 'employee' }, after: null }, '2026-09-10 08:00:00');
    mk({ actor: other.id, action: 'holiday_added', entityType: 'holiday', entityId: 12, before: null, after: { title: 'ن' } }, '2026-09-20 08:00:00');
    mk({ actor: other.id, action: 'settings_updated', entityType: 'settings', entityId: 'workDayEnd', before: { workDayEnd: '16:30' }, after: { workDayEnd: '17:00' } }, '2026-10-01 08:00:00');
    const legacyText = repo.logEvent({ userId: admin.id, action: 'legacy_text', details: 'متن ساده، نه JSON' });
    db.prepare('UPDATE audit_log SET occurred_at = ? WHERE id = ?').run('2026-09-05 08:00:00', legacyText.id);
    const legacyJson = repo.logEvent({ userId: admin.id, action: 'legacy_json', details: { source: 'admin_panel', targetUserId: 12 } });
    db.prepare('UPDATE audit_log SET occurred_at = ? WHERE id = ?').run('2026-09-06 08:00:00', legacyJson.id);

    server = createApp().listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => { if (server) server.close(); cleanup(); });

  async function get(role, url) {
    const headers = {};
    if (cookies[role]) headers.cookie = cookies[role];
    const res = await fetch(base + url, { headers });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) { /* CSV */ }
    return { status: res.status, json, text };
  }
  const actions = (r) => r.json.map((x) => x.action);

  test('ورودی قدیمی ساده: بدون فیلتر همه‌ی ردیف‌ها (جدیدترین اول)، userId/action/q مثل قبل', async () => {
    const all = await get('admin', '/api/admin/audit-log');
    assert.equal(all.status, 200);
    assert.ok(all.json.length >= 6);
    assert.equal(all.json[0].action, 'settings_updated');
    assert.ok(all.json[0].userFullName);

    assert.deepEqual(actions(await get('admin', `/api/admin/audit-log?userId=${other.id}`)), ['settings_updated', 'holiday_added']);
    assert.deepEqual(actions(await get('admin', '/api/admin/audit-log?action=employee_deleted')), ['employee_deleted']);
    assert.deepEqual(actions(await get('admin', `/api/admin/audit-log?q=${encodeURIComponent('متن ساده')}`)), ['legacy_text']);
  });

  test('فیلتر موجودیت: entityType و entityId (عدد و رشته)، ردیف‌های قدیمی نه می‌خوانند نه خطا می‌دهند', async () => {
    assert.deepEqual(actions(await get('admin', '/api/admin/audit-log?entityType=user')), ['employee_deleted', 'employee_profile_edited']);
    assert.deepEqual(actions(await get('admin', '/api/admin/audit-log?entityType=user&entityId=12')), ['employee_profile_edited']);
    assert.deepEqual(actions(await get('admin', '/api/admin/audit-log?entityId=12')).sort(), ['employee_profile_edited', 'holiday_added']);
    assert.deepEqual(actions(await get('admin', '/api/admin/audit-log?entityType=settings&entityId=workDayEnd')), ['settings_updated']);
    const none = await get('admin', '/api/admin/audit-log?entityType=nothing');
    assert.equal(none.status, 200);
    assert.deepEqual(none.json, []);
  });

  test('ترکیب فیلترها با AND و بازه‌ی تاریخ (شامل دو سر)؛ بازه + کاربر + موجودیت', async () => {
    assert.deepEqual(actions(await get('admin', '/api/admin/audit-log?from=2026-09-10&to=2026-09-20')), ['holiday_added', 'employee_deleted']);
    assert.deepEqual(actions(await get('admin', `/api/admin/audit-log?userId=${admin.id}&entityType=user&from=2026-09-05`)), ['employee_deleted']);
    assert.deepEqual(actions(await get('admin', `/api/admin/audit-log?userId=${other.id}&action=employee_deleted`)), []);
  });

  test('ورودی نامعتبر ⇒ ۴۰۰ فارسی: userId، تاریخ، from>to، پارامتر تکراری، include_archive', async () => {
    for (const url of ['userId=abc', 'from=2026-13-40', 'from=1405/01/01', 'from=2026-10-02&to=2026-10-01', 'action=a&action=b', 'entityType=a&entityType=b', 'include_archive=maybe']) {
      const r = await get('admin', `/api/admin/audit-log?${url}`);
      assert.equal(r.status, 400, url);
      assert.ok(r.json.error, url);
      assert.equal((await get('admin', `/api/admin/audit-log/export?${url}`)).status, 400, `export ${url}`);
    }
  });

  test('CSV با همان فیلترها؛ قالب پیش‌فرض بدون تغییر؛ userId تنها مثل قبل', async () => {
    const r = await get('admin', '/api/admin/audit-log/export?entityType=user&from=2026-09-05');
    assert.equal(r.status, 200);
    assert.match(r.text, /ردیف/);
    assert.ok(r.text.includes('employee_deleted'));
    assert.ok(!r.text.includes('employee_profile_edited'), 'قبل از from است');
    assert.ok(!r.text.includes('holiday_added'), 'entityType دیگر');
    assert.ok(!r.text.includes('منبع'), 'بدون include_archive ستون منبع نیست');

    const legacy = await get('admin', `/api/admin/audit-log/export?userId=${other.id}`);
    assert.equal(legacy.status, 200);
    assert.ok(legacy.text.includes('settings_updated') && legacy.text.includes('holiday_added'));
    assert.ok(!legacy.text.includes('employee_deleted'));
    assert.ok((await get('admin', '/api/admin/audit-log/export')).text.includes('legacy_text'));
  });

  test('include_archive با فیلتر موجودیت کار می‌کند؛ دسترسی: سرپرست و بدون سشن بسته', async () => {
    assert.equal(repo.archiveBatch('2026-09-02 00:00:00', 100), 1); // فقط ردیف 09-01 (user/12)
    assert.deepEqual(actions(await get('admin', '/api/admin/audit-log?entityType=user&entityId=12')), [], 'بدون آرشیو دیده نمی‌شود');
    const arch = await get('admin', '/api/admin/audit-log?entityType=user&entityId=12&include_archive=1');
    assert.deepEqual(actions(arch), ['employee_profile_edited']);
    assert.equal(arch.json[0].archived, true);

    for (const u of ['/api/admin/audit-log?entityType=user', '/api/admin/audit-log/export?entityType=user']) {
      assert.equal((await get('manager', u)).status, 403, u);
      assert.equal((await get(undefined, u)).status, 401, u);
    }
  });
});

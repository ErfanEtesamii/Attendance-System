// S4-1b: routeهای کاربران، نقش، سشن‌ها و تنظیمات با auditRepository.logChange ثبت می‌شوند؛ قبل/بعد دقیق، فقط فیلدهای تغییرکرده.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

let hasDeps = true;
try { require.resolve('express'); } catch (_) { hasDeps = false; }

describe('audit با قالب logChange — کاربران/سشن/تنظیمات (S4-1b)', { skip: hasDeps ? false : 'express نصب نیست (npm install)' }, () => {
  let server, base, db, admin, cookie, F;

  before(async () => {
    db = resetDb();
    F = require('./helpers/factories');
    const { createApp } = require('../src/server');
    admin = F.makeUser({ role: 'admin' });
    cookie = F.sessionCookie(admin.id);
    server = createApp().listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => { if (server) server.close(); cleanup(); });

  async function hit(method, url, body) {
    const res = await fetch(base + url, {
      method,
      headers: { 'content-type': 'application/json', 'x-requested-with': 'AttendancePanel', cookie },
      body: body && method !== 'GET' ? JSON.stringify(body) : undefined,
    });
    let json = null;
    try { json = await res.json(); } catch (_) { /* بدنه خالی */ }
    return { status: res.status, json };
  }
  const last = (action) => db.prepare('SELECT * FROM audit_log WHERE action = ? ORDER BY id DESC LIMIT 1').get(action);
  const d = (row) => JSON.parse(row.details);

  test('ایجاد/ویرایش/حذف کاربر: قبل/بعد دقیق (نقش و دپارتمان)، actor/ip/source/targetUserId، فیلد تغییرنکرده ثبت نمی‌شود', async () => {
    const created = await hit('POST', '/api/admin/users', { fullName: 'علی رضایی', personnelCode: 'P-77', department: 'فنی', role: 'employee', telegramUserId: '555001' });
    assert.equal(created.status, 201);
    const id = created.json.id;
    let row = last('employee_added');
    assert.equal(row.user_id, admin.id);
    assert.ok(row.ip_address);
    let det = d(row);
    assert.equal(det.source, 'admin_panel');
    assert.equal(det.entityType, 'user');
    assert.equal(det.entityId, id);
    assert.equal(det.targetUserId, id);
    assert.deepEqual(det.changes.full_name, { before: null, after: 'علی رضایی' });
    assert.deepEqual(det.changes.role, { before: null, after: 'employee' });

    const edited = await hit('PATCH', `/api/admin/users/${id}`, { role: 'manager', department: 'مالی', fullName: 'علی رضایی' });
    assert.equal(edited.status, 200);
    det = d(last('employee_profile_edited'));
    assert.deepEqual(det.changes, {
      role: { before: 'employee', after: 'manager' },
      department: { before: 'فنی', after: 'مالی' },
    });
    assert.equal(det.targetUserId, id);
    assert.deepEqual(det.fields, ['full_name', 'department', 'role']);
    assert.ok(!JSON.stringify(det).includes('session_version'), 'ستون‌های سیستمی در diff پروفایل نیست');

    const removed = await hit('DELETE', `/api/admin/users/${id}`);
    assert.equal(removed.status, 200);
    det = d(last('employee_deleted'));
    assert.deepEqual(det.changes.full_name, { before: 'علی رضایی', after: null });
    assert.deepEqual(det.changes.role, { before: 'manager', after: null });
    assert.equal(det.targetUserId, id);
    assert.ok(det.removed);
  });

  test('ابطال سشن یک کاربر: قبل/بعد session_version و دلیل ثبت می‌شود', async () => {
    const u = F.makeUser({ role: 'employee' });
    const sv = db.prepare('SELECT session_version FROM users WHERE id = ?').get(u.id).session_version;
    const r = await hit('POST', `/api/admin/users/${u.id}/revoke-sessions`, { reason: 'گوشی گم شد' });
    assert.equal(r.status, 200);
    let det = d(last('user_sessions_revoked'));
    assert.deepEqual(det.changes, { session_version: { before: sv, after: sv + 1 } });
    assert.equal(det.reason, 'گوشی گم شد');
    assert.equal(det.targetUserId, u.id);
    assert.equal(det.entityId, u.id);
  });

  test('تنظیمات: PATCH فقط کلیدهای تغییرکرده را در changes می‌آورد و fields کلیدهای ارسالی را؛ PUT/reset با entityId=key', async () => {
    const p = await hit('PATCH', '/api/admin/settings', { workDayEnd: '17:45', repeatedLatenessThreshold: 3 });
    assert.equal(p.status, 200);
    let det = d(last('settings_updated'));
    assert.equal(det.entityType, 'settings');
    assert.deepEqual(det.changes, { workDayEnd: { before: '16:30', after: '17:45' } });
    assert.deepEqual(det.fields, ['workDayEnd', 'repeatedLatenessThreshold']);
    assert.equal(det.source, 'admin_panel');

    const put = await hit('PUT', '/api/admin/settings/lateCheckinGraceMinutes', { value: 25, reason: 'سیاست جدید' });
    assert.equal(put.status, 200);
    det = d(last('settings_updated'));
    assert.equal(det.entityId, 'lateCheckinGraceMinutes');
    assert.deepEqual(det.changes, { lateCheckinGraceMinutes: { before: 15, after: 25 } });
    assert.equal(det.reason, 'سیاست جدید');

    const reset = await hit('POST', '/api/admin/settings/lateCheckinGraceMinutes/reset', { reason: 'برگشت' });
    assert.equal(reset.status, 200);
    det = d(last('settings_reset'));
    assert.deepEqual(det.changes, { lateCheckinGraceMinutes: { before: 25, after: 15 } });
  });

  test('پروفایل کارمند: رویدادهای «درباره‌ی او» با targetUserId هنوز پیدا می‌شوند و راز در audit نیست', async () => {
    const u = F.makeUser({ role: 'employee' });
    await hit('PATCH', `/api/admin/users/${u.id}`, { department: 'بایگانی' });
    const det = await hit('GET', `/api/admin/users/${u.id}/details`);
    assert.equal(det.status, 200);
    assert.ok(det.json.audit.some((a) => a.action === 'employee_profile_edited'), 'رویداد ویرایش در پرونده‌ی کاربر دیده می‌شود');
    const all = db.prepare('SELECT details FROM audit_log').all().map((r) => r.details).join('\n');
    assert.ok(!all.includes(process.env.TELEGRAM_BOT_TOKEN), 'توکن بات هرگز در audit نیست');
  });

  // آخر از همه: بعد از ابطال سراسری کوکی ثابت تست باطل می‌شود
  test('ابطال سراسری سشن‌ها: قبل/بعد epoch و دلیل', async () => {
    const settingsRepository = require('../src/repositories/settingsRepository');
    const epoch = settingsRepository.getGlobalSessionEpoch();
    const all = await hit('POST', '/api/admin/system/revoke-all-sessions', { reason: 'چرخش راز', includeSelf: false });
    assert.equal(all.status, 200);
    const det = d(last('all_sessions_revoked'));
    assert.deepEqual(det.changes, { epoch: { before: epoch, after: epoch + 1 } });
    assert.equal(det.entityType, 'session');
    assert.equal(det.reason, 'چرخش راز');
    assert.equal(det.includeSelf, false);
  });
});

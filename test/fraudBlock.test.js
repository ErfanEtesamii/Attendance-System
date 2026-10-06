// S2-4e-3: تنظیم block_on_shared_device (پیش‌فرض خاموش). روشن ⇒ فقط قاعده‌ی الف ثبت را رد می‌کند و audit می‌شود.
// اصل: بدون device، خطای تشخیص یا تنظیم خراب ⇒ هرگز مسدود نمی‌شود (fail-open).
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

let hasDeps = true;
try {
  require.resolve('express');
} catch (_) {
  hasDeps = false;
}

const DEV_X = 'dev-x-00000000000001';
const DEV_Y = 'dev-y-00000000000001';

describe('بلوک اختیاری device مشترک (S2-4e-3)', { skip: hasDeps ? false : 'express نصب نیست (npm install)' }, () => {
  let server; let base; let F; let db; let settings; let fraud;
  const TOKEN = process.env.TELEGRAM_BOT_TOKEN;

  function signInitData(telegramId) {
    const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: Number(telegramId), first_name: 'تست' }) });
    const dcs = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
    const secret = crypto.createHmac('sha256', 'WebAppData').update(TOKEN).digest();
    params.set('hash', crypto.createHmac('sha256', secret).update(dcs).digest('hex'));
    return params.toString();
  }
  async function post(user, action, body = {}) {
    const headers = { 'content-type': 'application/json', 'x-telegram-init-data': signInitData(user.telegram_user_id) };
    const res = await fetch(`${base}/api/miniapp/${action}`, { method: 'POST', headers, body: JSON.stringify(body) });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  }
  const rec = (u) => db.prepare('SELECT * FROM attendance_records WHERE user_id = ?').get(u.id);
  const eventTypes = () => db.prepare('SELECT event_type FROM suspicious_events').all().map((e) => e.event_type).sort();
  const audits = (action) => db.prepare('SELECT * FROM audit_log WHERE action = ?').all(action);

  before(async () => {
    db = resetDb();
    F = require('./helpers/factories');
    const config = require('../src/config');
    config.allowedNetworkCidr = '127.0.0.0/8';
    settings = require('../src/repositories/settingsRepository');
    fraud = require('../src/utils/fraudDetection');
    const { createApp } = require('../src/server');
    server = createApp().listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => {
    if (server) server.close();
    cleanup();
  });
  beforeEach(() => {
    for (const t of ['suspicious_events', 'break_records', 'attendance_records', 'audit_log']) db.exec(`DELETE FROM ${t}`);
    settings.update({ blockOnSharedDevice: false });
  });

  test('تنظیم: پیش‌فرض خاموش، مقدار نامعتبر نادیده، و ۵ تنظیم قبلی دست‌نخورده', () => {
    db.exec("DELETE FROM settings WHERE key = 'block_on_shared_device'");
    const before5 = { ...settings.getAll() };
    assert.equal(before5.blockOnSharedDevice, false);
    assert.equal(settings.isBlockOnSharedDeviceEnabled(), false);
    assert.equal(settings.update({ blockOnSharedDevice: true }).blockOnSharedDevice, true);
    assert.equal(settings.isBlockOnSharedDeviceEnabled(), true);
    assert.equal(settings.update({ blockOnSharedDevice: 'abc' }).blockOnSharedDevice, true, 'مقدار نامعتبر نادیده گرفته می‌شود');
    assert.equal(settings.update({ blockOnSharedDevice: 'false' }).blockOnSharedDevice, false);
    const { blockOnSharedDevice, ...rest } = settings.getAll();
    const { blockOnSharedDevice: _b, ...rest0 } = before5;
    assert.deepEqual(rest, rest0);
  });

  test('خاموش (پیش‌فرض): device مشترک فقط نشانه می‌سازد، ثبت مسدود نمی‌شود', async () => {
    const a = F.makeUser(); const b = F.makeUser();
    assert.equal((await post(a, 'check-in', { deviceId: DEV_X })).status, 201);
    assert.equal((await post(b, 'check-in', { deviceId: DEV_X })).status, 201);
    assert.ok(eventTypes().includes('shared_device'));
    assert.equal(audits('check_in_blocked').length, 0);
  });

  test('روشن: ورود/خروج با device کاربر دیگر رد و audit می‌شود؛ بدون device، device خودِ کاربر و device آزاد مجازند', async () => {
    settings.update({ blockOnSharedDevice: true });
    const a = F.makeUser(); const b = F.makeUser(); const c = F.makeUser();
    assert.equal((await post(a, 'check-in', { deviceId: DEV_X })).status, 201);

    // ورود b با device a ⇒ 403، رکوردی ساخته نمی‌شود، audit و نشانه‌ی «blocked» ثبت می‌شود
    const blocked = await post(b, 'check-in', { deviceId: DEV_X });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.json.code, 'shared_device_blocked');
    assert.equal(rec(b), undefined);
    const ad = audits('check_in_blocked');
    assert.equal(ad.length, 1);
    assert.equal(ad[0].user_id, b.id);
    assert.deepEqual(JSON.parse(ad[0].details).otherUserIds, [a.id]);
    const ev = db.prepare("SELECT * FROM suspicious_events WHERE event_type = 'shared_device'").get();
    assert.deepEqual(JSON.parse(ev.user_ids), [a.id, b.id].sort((x, y) => x - y));
    assert.equal(JSON.parse(ev.details).blocked, true);

    // b با device آزاد، و c بدون device ⇒ ثبت می‌شود
    assert.equal((await post(b, 'check-in', { deviceId: DEV_Y })).status, 201);
    assert.equal((await post(c, 'check-in', {})).status, 201);
    // خروجِ b با device a ⇒ رد؛ رکورد بدون خروج می‌ماند. خروج a با device خودش مجاز است
    assert.equal((await post(b, 'check-out', { deviceId: DEV_X })).status, 403);
    assert.equal(rec(b).check_out_time, null);
    assert.equal(audits('check_out_blocked').length, 1);
    assert.equal((await post(a, 'check-out', { deviceId: DEV_X })).status, 200);
    assert.equal((await post(b, 'check-out', { deviceId: DEV_Y })).status, 200);
  });

  test('فقط قاعده‌ی الف مسدود می‌کند؛ خرابی تشخیص/تنظیم ⇒ fail-open', async () => {
    settings.update({ blockOnSharedDevice: true });
    // قاعده‌ی ب (یک IP loopback، فاصله‌ی کم) با deviceهای متفاوت ⇒ فقط نشانه، نه بلوک
    const a = F.makeUser(); const b = F.makeUser();
    assert.equal((await post(a, 'check-in', { deviceId: DEV_X })).status, 201);
    assert.equal((await post(b, 'check-in', { deviceId: DEV_Y })).status, 201);
    assert.ok(eventTypes().includes('same_ip_close'));
    assert.equal(audits('check_in_blocked').length, 0);

    const origErr = console.error;
    const origA = fraud.detectSharedDevice;
    const origEnabled = settings.isBlockOnSharedDeviceEnabled;
    console.error = () => {};
    try {
      // خرابی قاعده‌ی الف ⇒ مسدود نمی‌شود و ثبت موفق است
      fraud.detectSharedDevice = () => { throw new Error('boom rule'); };
      const c = F.makeUser();
      assert.equal((await post(c, 'check-in', { deviceId: DEV_X })).status, 201);
      fraud.detectSharedDevice = origA;
      // خرابی خواندن تنظیم ⇒ مسدود نمی‌شود
      settings.isBlockOnSharedDeviceEnabled = () => { throw new Error('settings down'); };
      const d = F.makeUser();
      assert.equal((await post(d, 'check-in', { deviceId: DEV_X })).status, 201);
      assert.ok(rec(c) && rec(d));
    } finally {
      console.error = origErr;
      fraud.detectSharedDevice = origA;
      settings.isBlockOnSharedDeviceEnabled = origEnabled;
    }
    assert.equal(audits('check_in_blocked').length, 0);
  });
});

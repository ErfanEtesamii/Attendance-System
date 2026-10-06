// S2-4e-2: اتصال تشخیص مورد مشکوک به ورود/خروج Mini App و nightlyReview.
// اصل اصلی: هر خطا در تشخیص هرگز ثبت تردد یا ارسال مرور شبانه را نمی‌شکند. (بدون block؛ آن S2-4e-3 است.)
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
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

describe('اتصال تشخیص مورد مشکوک (S2-4e-2)', { skip: hasDeps ? false : 'express نصب نیست (npm install)' }, () => {
  let server; let base; let F; let db;
  let fraud; let fraudRunner; let suspiciousRepository;
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
  const events = () => db.prepare('SELECT event_type, user_ids FROM suspicious_events ORDER BY id').all();
  const types = () => events().map((e) => e.event_type).sort();

  before(async () => {
    db = resetDb();
    F = require('./helpers/factories');
    const config = require('../src/config');
    config.allowedNetworkCidr = '127.0.0.0/8'; // تست روی loopback اجرا می‌شود
    fraud = require('../src/utils/fraudDetection');
    fraudRunner = require('../src/utils/fraudRunner');
    suspiciousRepository = require('../src/repositories/suspiciousRepository');
    const { createApp } = require('../src/server');
    server = createApp().listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => {
    if (server) server.close();
    cleanup();
  });

  test('ورود: دو کاربر با یک device و یک IP ⇒ بعد از ثبت دوم نشانه ساخته می‌شود؛ ثبت‌ها موفق', async () => {
    const a = F.makeUser(); const b = F.makeUser();
    assert.equal((await post(a, 'check-in', { deviceId: DEV_X })).status, 201);
    assert.deepEqual(events(), [], 'با یک کاربر نشانه‌ای نیست');
    assert.equal((await post(b, 'check-in', { deviceId: DEV_X })).status, 201);
    assert.deepEqual(types(), ['same_ip_close', 'shared_device']);
    for (const u of [a, b]) {
      assert.ok(db.prepare('SELECT 1 FROM attendance_records WHERE user_id = ? AND check_in_time IS NOT NULL').get(u.id));
    }
  });

  test('خروج هم تشخیص را اجرا می‌کند (device فقط در خروج مشترک می‌شود)', async () => {
    db.exec('DELETE FROM suspicious_events');
    db.exec('DELETE FROM break_records');
    db.exec('DELETE FROM attendance_records');
    const a = F.makeUser(); const b = F.makeUser();
    // IP هر دو loopback است؛ N را با تغییر زمان ثبت‌های ورود از محدوده خارج می‌کنیم تا فقط شباهت device بماند
    assert.equal((await post(a, 'check-in', { deviceId: DEV_X })).status, 201);
    assert.equal((await post(b, 'check-in', { deviceId: DEV_Y })).status, 201);
    db.exec("UPDATE attendance_records SET check_in_time = '2000-01-01T00:00:00.000Z'");
    db.exec('DELETE FROM suspicious_events');
    assert.equal((await post(b, 'check-out', { deviceId: DEV_X })).status, 200);
    assert.ok(types().includes('shared_device'), 'خروج با device کاربر دیگر باید نشانه بسازد');
  });

  test('خرابی عمدی در تشخیص: ورود و خروج همچنان موفق و ذخیره می‌شوند', async () => {
    db.exec('DELETE FROM suspicious_events');
    db.exec('DELETE FROM break_records');
    db.exec('DELETE FROM attendance_records');
    const origErr = console.error;
    const origA = fraud.detectSharedDevice;
    const origCreate = suspiciousRepository.create;
    const origRun = fraudRunner.runFraudChecks;
    console.error = () => {};
    try {
      // سطح ۱: قاعده می‌ترکد و ثبت نشانه هم می‌ترکد
      fraud.detectSharedDevice = () => { throw new Error('boom rule'); };
      suspiciousRepository.create = () => { throw new Error('boom db'); };
      const u1 = F.makeUser();
      assert.equal((await post(u1, 'check-in', { deviceId: DEV_X })).status, 201);
      assert.equal((await post(u1, 'check-out', { deviceId: DEV_X })).status, 200);
      // سطح ۲: خود runFraudChecks استثنا بدهد
      fraudRunner.runFraudChecks = () => { throw new Error('boom runner'); };
      const u2 = F.makeUser();
      assert.equal((await post(u2, 'check-in', { deviceId: DEV_Y })).status, 201);
      assert.equal((await post(u2, 'check-out', { deviceId: DEV_Y })).status, 200);
      for (const u of [u1, u2]) {
        const r = db.prepare('SELECT * FROM attendance_records WHERE user_id = ?').get(u.id);
        assert.ok(r.check_in_time && r.check_out_time, 'ورود و خروج باید ذخیره شده باشد');
      }
      assert.deepEqual(events(), []);
      assert.equal(fraudRunner.runFraudChecksSafe({ date: '2026-10-06' }).ok, false);
    } finally {
      console.error = origErr;
      fraud.detectSharedDevice = origA;
      suspiciousRepository.create = origCreate;
      fraudRunner.runFraudChecks = origRun;
    }
  });

  test('nightlyReview: جاروی تشخیص اجرا می‌شود و با خرابی تشخیص هم پیام شبانه ارسال می‌شود', async () => {
    db.exec('DELETE FROM suspicious_events');
    db.exec('DELETE FROM break_records');
    db.exec('DELETE FROM attendance_records');
    const { sendNightlyReview } = require('../src/bot/scheduler/nightlyReview');
    const { todayDateString } = require('../src/utils/serverTime');
    const today = todayDateString();
    const manager = F.makeUser({ role: 'manager' });
    const e1 = F.makeUser({ managerId: manager.id }); const e2 = F.makeUser({ managerId: manager.id });
    const ins = db.prepare('INSERT INTO attendance_records (user_id, record_date, check_in_time, check_in_ip, check_in_device) VALUES (?, ?, ?, ?, ?)');
    ins.run(e1.id, today, `${today}T05:00:00.000Z`, '10.0.0.1', DEV_X);
    ins.run(e2.id, today, `${today}T06:00:00.000Z`, '10.0.0.2', DEV_X); // ثبت‌های بدون مسیر Mini App (جاروی شبانه باید بگیرد)

    const sent = [];
    const bot = { sendMessage: async (chatId, text) => { sent.push({ chatId, text }); } };
    await sendNightlyReview(bot);
    assert.deepEqual(types(), ['shared_device']);
    assert.equal(sent.length, 1);

    // با خرابی کامل تشخیص: پیام همچنان ارسال می‌شود و Job نمی‌شکند
    db.exec('DELETE FROM suspicious_events');
    const origErr = console.error;
    const origRun = fraudRunner.runFraudChecks;
    console.error = () => {};
    fraudRunner.runFraudChecks = () => { throw new Error('boom runner'); };
    try {
      await assert.doesNotReject(() => sendNightlyReview(bot));
    } finally {
      console.error = origErr;
      fraudRunner.runFraudChecks = origRun;
    }
    assert.equal(sent.length, 2);
    assert.deepEqual(events(), []);
  });
});

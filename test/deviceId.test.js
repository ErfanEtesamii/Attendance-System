// S2-3: جمع‌آوری device_id در ورود/خروج Mini App (بدون هیچ قاعده‌ی تشخیص).
// اصل اصلی تست‌ها: device/UA فقط ذخیره می‌شود و هرگز روی موفقیت/زمان ثبت تردد اثر ندارد.
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

const { normalizeDeviceId, normalizeUserAgent, extractDeviceInfo } = require('../src/utils/deviceInfo');

const DEV_A = '3f2b8c1e-9a4d-4e57-8b21-6c0d5e7f1a90'; // UUID معتبر
const DEV_B = 'abcdef0123456789abcdef0123456789'; // hex ۳۲ نویسه‌ای (مسیر fallback کلاینت)

describe('اعتبارسنجی device_id و UA (توابع خالص)', () => {
  test('فرمت معتبر پذیرفته می‌شود', () => {
    assert.equal(normalizeDeviceId(DEV_A), DEV_A);
    assert.equal(normalizeDeviceId(DEV_B), DEV_B);
    assert.equal(normalizeDeviceId('A'.repeat(16)), 'A'.repeat(16));
    assert.equal(normalizeDeviceId('a_b-c'.repeat(12) + 'abcd'), 'a_b-c'.repeat(12) + 'abcd'); // ۶۴ نویسه
  });

  test('فرمت نامعتبر ⇒ null (کوتاه، بلند، نویسه‌ی ممنوع، نوع غلط)', () => {
    const bad = [
      '', 'short', 'a'.repeat(15), 'a'.repeat(65), `${DEV_A} `, ` ${DEV_A}`, 'abc def ghi jkl mno pqr',
      "x'; DROP TABLE users;--xxxxxxxx", '<script>alert(1)</script>', 'شناسه-فارسی-شناسه-فارسی', 'a'.repeat(15) + '\n',
      null, undefined, 123456789012345678, {}, [], [DEV_A], { toString: () => DEV_A }, true,
    ];
    for (const v of bad) assert.equal(normalizeDeviceId(v), null, `باید رد شود: ${JSON.stringify(v)}`);
  });

  test('UA: کوتاه‌سازی، حذف نویسه‌های کنترلی، خالی ⇒ null', () => {
    assert.equal(normalizeUserAgent('Mozilla/5.0 (Android 14) Telegram'), 'Mozilla/5.0 (Android 14) Telegram');
    assert.equal(normalizeUserAgent('x'.repeat(500)).length, 200);
    assert.equal(normalizeUserAgent('a\r\nb\u0000c\td'), 'a b c d');
    assert.equal(normalizeUserAgent('   '), null);
    assert.equal(normalizeUserAgent(''), null);
    assert.equal(normalizeUserAgent(undefined), null);
    assert.equal(normalizeUserAgent(['x']), null);
  });

  test('extractDeviceInfo هرگز استثنا نمی‌دهد (بدنه/هدر خراب ⇒ null)', () => {
    const hostileBody = { get deviceId() { throw new Error('boom'); } };
    assert.deepEqual(extractDeviceInfo({ body: hostileBody, get: () => 'UA' }), { deviceId: null, userAgent: null });
    assert.deepEqual(extractDeviceInfo({ body: { deviceId: DEV_A }, get() { throw new Error('boom'); } }), { deviceId: null, userAgent: null });
    assert.deepEqual(extractDeviceInfo({}), { deviceId: null, userAgent: null });
    assert.deepEqual(extractDeviceInfo(undefined), { deviceId: null, userAgent: null });
    assert.deepEqual(extractDeviceInfo({ body: { deviceId: DEV_A }, get: () => 'UA/1' }), { deviceId: DEV_A, userAgent: 'UA/1' });
  });
});

describe('migration 005 و repository', () => {
  before(() => resetDb());
  after(() => cleanup());

  test('چهار ستون nullable بدون پیش‌فرض اضافه شده و اجرای دوباره‌ی up بی‌خطر است', () => {
    const { getDb } = require('../src/db/connection');
    const db = getDb();
    const cols = db.prepare("PRAGMA table_info('attendance_records')").all();
    for (const name of ['check_in_device', 'check_out_device', 'check_in_ua', 'check_out_ua']) {
      const c = cols.find((x) => x.name === name);
      assert.ok(c, `ستون ${name} باید باشد`);
      assert.equal(c.notnull, 0, `${name} باید nullable باشد`);
      assert.equal(c.dflt_value, null);
    }
    require('../src/db/migrations/005_attendance_devices').up(db); // دوباره: duplicate column ندهد
    assert.equal(db.prepare("PRAGMA table_info('attendance_records')").all().length, cols.length);
  });

  test('بات/فراخوانی بدون device و ثبت دستی ادمین: ستون‌ها NULL', () => {
    const F = require('./helpers/factories');
    const repo = require('../src/repositories/attendanceRepository');
    const u1 = F.makeUser();
    const rec = repo.recordCheckIn(u1.id, '192.168.10.5'); // بدون آرگومان سوم، مثل مسیرهای قدیمی
    assert.equal(rec.check_in_device, null);
    assert.equal(rec.check_in_ua, null);
    const out = repo.recordCheckOut(rec.id, '192.168.10.5');
    assert.equal(out.check_out_device, null);
    assert.equal(out.check_out_ua, null);
    const u2 = F.makeUser();
    const manual = repo.createManual({ userId: u2.id, recordDate: '2026-01-10', checkInTime: '2026-01-10T05:00:00.000Z', checkOutTime: '2026-01-10T13:00:00.000Z' });
    for (const k of ['check_in_device', 'check_out_device', 'check_in_ua', 'check_out_ua']) assert.equal(manual[k], null, k);
  });
});

describe('ورود/خروج Mini App با device_id (HTTP)', { skip: hasDeps ? false : 'express نصب نیست (npm install)' }, () => {
  let server, base, config, F;
  const TOKEN = process.env.TELEGRAM_BOT_TOKEN;

  function signInitData(telegramId) {
    const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: Number(telegramId), first_name: 'تست' }) });
    const dcs = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
    const secret = crypto.createHmac('sha256', 'WebAppData').update(TOKEN).digest();
    params.set('hash', crypto.createHmac('sha256', secret).update(dcs).digest('hex'));
    return params.toString();
  }

  before(async () => {
    resetDb();
    F = require('./helpers/factories');
    config = require('../src/config');
    config.allowedNetworkCidr = '127.0.0.0/8'; // تست روی loopback اجرا می‌شود
    const { createApp } = require('../src/server');
    server = createApp().listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => {
    if (server) server.close();
    cleanup();
  });

  async function post(user, action, body, ua = 'TestUA/1.0 (Telegram)') {
    const headers = { 'content-type': 'application/json', 'x-telegram-init-data': signInitData(user.telegram_user_id) };
    if (ua) headers['user-agent'] = ua;
    const res = await fetch(`${base}/api/miniapp/${action}`, { method: 'POST', headers, body: JSON.stringify(body) });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  }
  const row = (userId) => require('../src/db/connection').getDb().prepare('SELECT * FROM attendance_records WHERE user_id = ?').get(userId);

  test('ورود و خروج با device معتبر: هر دو جدا ذخیره می‌شوند، UA از هدر واقعی', async () => {
    const u = F.makeUser();
    assert.equal((await post(u, 'check-in', { deviceId: DEV_A })).status, 201);
    assert.equal((await post(u, 'check-out', { deviceId: DEV_B }, 'OtherUA/2.0')).status, 200);
    const r = row(u.id);
    assert.equal(r.check_in_device, DEV_A);
    assert.equal(r.check_out_device, DEV_B);
    assert.equal(r.check_in_ua, 'TestUA/1.0 (Telegram)');
    assert.equal(r.check_out_ua, 'OtherUA/2.0');
  });

  test('بدون device: ثبت می‌شود، ستون‌های device و UA فقط طبق هدر (device=NULL)', async () => {
    const u = F.makeUser();
    assert.equal((await post(u, 'check-in', {})).status, 201);
    assert.equal((await post(u, 'check-out', {})).status, 200);
    const r = row(u.id);
    assert.equal(r.check_in_device, null);
    assert.equal(r.check_out_device, null);
    assert.ok(r.check_in_time && r.check_out_time);
  });

  test('فرمت نامعتبر device ⇒ ثبت موفق ولی device نادیده (انواع ورودی خراب)', async () => {
    const bads = ['short', 'x'.repeat(200), "'; DROP TABLE users;--aaaaaaaa", { a: 1 }, [DEV_A], 12345678901234567890, null, true];
    for (const bad of bads) {
      const u = F.makeUser();
      const inRes = await post(u, 'check-in', { deviceId: bad });
      assert.equal(inRes.status, 201, `check-in با ${JSON.stringify(bad)}`);
      const outRes = await post(u, 'check-out', { deviceId: bad });
      assert.equal(outRes.status, 200, `check-out با ${JSON.stringify(bad)}`);
      const r = row(u.id);
      assert.equal(r.check_in_device, null);
      assert.equal(r.check_out_device, null);
      assert.ok(r.check_in_ua, 'UA مستقل از device ذخیره می‌شود');
    }
  });

  test('UA خیلی بلند کوتاه می‌شود و نبودنش مشکلی ایجاد نمی‌کند', async () => {
    const u = F.makeUser();
    assert.equal((await post(u, 'check-in', { deviceId: DEV_A }, 'U'.repeat(5000))).status, 201);
    assert.equal(row(u.id).check_in_ua.length, 200);
    const u2 = F.makeUser();
    assert.equal((await post(u2, 'check-in', { deviceId: DEV_A }, null)).status, 201);
  });

  test('device روی زمان و اعتبار ثبت اثر ندارد: زمان از سرور، فیلدهای ادعایی نادیده، ورود تکراری هنوز رد می‌شود', async () => {
    const u = F.makeUser();
    const before = Date.now();
    const res = await post(u, 'check-in', { deviceId: DEV_A, check_in_time: '2001-01-01T00:00:00.000Z', check_in_ip: '1.2.3.4', status: 'late' });
    const after = Date.now();
    assert.equal(res.status, 201);
    const t = Date.parse(row(u.id).check_in_time);
    assert.ok(t >= before - 1000 && t <= after + 1000, 'زمان ورود باید زمان سرور باشد');
    assert.notEqual(row(u.id).check_in_ip, '1.2.3.4');
    assert.equal(row(u.id).status, 'normal');
    const dup = await post(u, 'check-in', { deviceId: DEV_B });
    assert.equal(dup.status, 400, 'ورود دوم همان روز مثل قبل رد می‌شود');
    assert.equal(row(u.id).check_in_device, DEV_A, 'ورود رد‌شده device را عوض نمی‌کند');
  });

  test('شناسه‌ی هر دو کاربر روی یک device هر دو ذخیره می‌شود (مبنای قاعده‌ی S2-4b، بدون مسدودسازی)', async () => {
    const u1 = F.makeUser();
    const u2 = F.makeUser();
    assert.equal((await post(u1, 'check-in', { deviceId: DEV_A })).status, 201);
    assert.equal((await post(u2, 'check-in', { deviceId: DEV_A })).status, 201);
    assert.equal(row(u1.id).check_in_device, DEV_A);
    assert.equal(row(u2.id).check_in_device, DEV_A);
  });
});

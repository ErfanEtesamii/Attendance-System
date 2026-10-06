// S2-4b: قاعده‌ی الف (یک device برای دو کاربر در یک روز) — تابع خالص، بدون DB.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { detectSharedDevice, EVENT_SHARED_DEVICE } = require('../src/utils/fraudDetection');

const D1 = 'device-aaaaaaaaaaaaaaaa';
const D2 = 'device-bbbbbbbbbbbbbbbb';
const rec = (id, user_id, record_date, inDev = null, outDev = null) =>
  ({ id, user_id, record_date, check_in_device: inDev, check_out_device: outDev });

describe('detectSharedDevice (S2-4b)', () => {
  test('مثبت: دو کاربر با یک device در یک روز ⇒ یک نشانه با شکل ورودی repository', () => {
    const out = detectSharedDevice([rec(11, 2, '2026-10-01', D1), rec(10, 1, '2026-10-01', D1)]);
    assert.equal(out.length, 1);
    assert.equal(out[0].eventType, EVENT_SHARED_DEVICE);
    assert.deepEqual(out[0].userIds, [1, 2]);
    assert.deepEqual(out[0].recordIds, [10, 11]);
    assert.equal(out[0].eventDate, '2026-10-01');
    assert.equal(out[0].details.deviceId, D1);
    assert.equal(out[0].details.userCount, 2);
  });

  test('مثبت: ورود یکی و خروج دیگری با یک device هم دیده می‌شود؛ سه کاربر ⇒ یک نشانه', () => {
    const a = detectSharedDevice([rec(1, 1, '2026-10-01', D1, null), rec(2, 2, '2026-10-01', D2, D1)]);
    assert.equal(a.length, 1);
    assert.deepEqual(a[0].userIds, [1, 2]);
    const b = detectSharedDevice([rec(1, 1, '2026-10-01', D1), rec(2, 2, '2026-10-01', D1), rec(3, 3, '2026-10-01', D1)]);
    assert.equal(b.length, 1);
    assert.deepEqual(b[0].userIds, [1, 2, 3]);
  });

  test('منفی: یک کاربر با یک device (ورود و خروج) ⇒ هیچ', () => {
    assert.deepEqual(detectSharedDevice([rec(1, 1, '2026-10-01', D1, D1)]), []);
  });

  test('منفی: دو کاربر با deviceهای متفاوت، یا همان device در روزهای مختلف ⇒ هیچ', () => {
    assert.deepEqual(detectSharedDevice([rec(1, 1, '2026-10-01', D1), rec(2, 2, '2026-10-01', D2)]), []);
    assert.deepEqual(detectSharedDevice([rec(1, 1, '2026-10-01', D1), rec(2, 2, '2026-10-02', D1)]), []);
  });

  test('منفی: device خالی/نامعتبر (بات، ثبت دستی، فرمت خراب) هرگز نشانه نمی‌سازد', () => {
    assert.deepEqual(detectSharedDevice([rec(1, 1, '2026-10-01'), rec(2, 2, '2026-10-01')]), []);
    assert.deepEqual(detectSharedDevice([rec(1, 1, '2026-10-01', 'short'), rec(2, 2, '2026-10-01', 'short')]), []);
  });

  test('ورودی خراب ⇒ استثنا نمی‌دهد؛ ورودی تغییر نمی‌کند؛ خروجی قطعی و مرتب', () => {
    assert.deepEqual(detectSharedDevice(null), []);
    assert.deepEqual(detectSharedDevice([null, {}, rec(1, 'x', '2026-10-01', D1)]), []);
    const input = [rec(4, 2, '2026-10-02', D2), rec(3, 1, '2026-10-02', D2), rec(2, 2, '2026-10-01', D1), rec(1, 1, '2026-10-01', D1)];
    const copy = JSON.parse(JSON.stringify(input));
    const out = detectSharedDevice(input);
    assert.deepEqual(input, copy);
    assert.deepEqual(out.map((e) => e.eventDate), ['2026-10-01', '2026-10-02']);
  });
});

// S2-4d: قاعده‌ی ج (تغییر ناگهانی دستگاه نسبت به الگوی اخیر) — تابع خالص، بدون DB.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  detectDeviceChange,
  EVENT_DEVICE_CHANGE,
  DEFAULT_DEVICE_CHANGE_LOOKBACK_DAYS,
  DEFAULT_DEVICE_CHANGE_MIN_HISTORY_DAYS,
} = require('../src/utils/fraudDetection');

const DEV_A = 'aaaaaaaaaaaaaaaaaaaa0001';
const DEV_B = 'bbbbbbbbbbbbbbbbbbbb0002';
const DEV_C = 'cccccccccccccccccccc0003';
// روز n‌ام اکتبر ۲۰۲۶
const day = (n) => `2026-10-${String(n).padStart(2, '0')}`;
let nextId = 1;
const rec = (user_id, d, inDev, outDev = inDev) => ({
  id: nextId++, user_id, record_date: day(d), check_in_device: inDev, check_out_device: outDev,
});
// روزهای from..to با یک device
const run = (user_id, from, to, dev) => {
  const out = [];
  for (let d = from; d <= to; d += 1) out.push(rec(user_id, d, dev));
  return out;
};

describe('detectDeviceChange (S2-4d)', () => {
  test('مثبت: چند روز یک device و بعد device کاملاً جدید ⇒ یک نشانه با شکل ورودی repository', () => {
    nextId = 100;
    const records = [...run(1, 1, 5, DEV_A), rec(1, 6, DEV_B)];
    const out = detectDeviceChange(records);
    assert.equal(out.length, 1);
    assert.equal(out[0].eventType, EVENT_DEVICE_CHANGE);
    assert.deepEqual(out[0].userIds, [1]);
    assert.deepEqual(out[0].recordIds, [105]);
    assert.equal(out[0].eventDate, day(6));
    assert.deepEqual(out[0].details, {
      rule: 'C',
      newDevices: [DEV_B],
      baselineDevices: [DEV_A],
      historyDays: 5,
      lookbackDays: DEFAULT_DEVICE_CHANGE_LOOKBACK_DAYS,
      minHistoryDays: DEFAULT_DEVICE_CHANGE_MIN_HISTORY_DAYS,
    });

    // device ورود و خروج متفاوت، هر دو جدید ⇒ هر دو در newDevices؛ فقط اولین روز تغییر گزارش می‌شود
    const two = detectDeviceChange([...run(1, 1, 4, DEV_A), rec(1, 5, DEV_B, DEV_C), rec(1, 6, DEV_B)]);
    assert.equal(two.length, 1);
    assert.equal(two[0].eventDate, day(5));
    assert.deepEqual(two[0].details.newDevices, [DEV_B, DEV_C]);

    // دو کاربر مستقل ⇒ هر کدام نشانه‌ی خودش، مرتب بر اساس (تاریخ، کاربر)
    const both = detectDeviceChange([
      ...run(2, 1, 3, DEV_A), rec(2, 4, DEV_C), ...run(1, 1, 3, DEV_B), rec(1, 4, DEV_C),
    ]);
    assert.deepEqual(both.map((e) => e.userIds[0]), [1, 2]);
  });

  test('منفی: همان device، استفاده‌ی همزمان از قدیمی و جدید، تاریخچه‌ی کم، خارج از پنجره، ردیف بدون device', () => {
    // همان device
    assert.deepEqual(detectDeviceChange(run(1, 1, 8, DEV_A)), []);
    // قدیمی + جدید در همان روز (دو رکورد یا ورود/خروج) ⇒ نشانه نیست
    assert.deepEqual(detectDeviceChange([...run(1, 1, 5, DEV_A), rec(1, 6, DEV_B, DEV_A)]), []);
    assert.deepEqual(detectDeviceChange([...run(1, 1, 5, DEV_A), rec(1, 6, DEV_B), rec(1, 6, DEV_A)]), []);
    // تاریخچه‌ی کم (۲ روز < ۳) ⇒ کاربر تازه‌وارد/بدون الگو
    assert.deepEqual(detectDeviceChange([...run(1, 1, 2, DEV_A), rec(1, 3, DEV_B)]), []);
    // تاریخچه خارج از پنجره‌ی ۷ روزه (روزهای ۱ تا ۳؛ روز ۱۲ فقط روزهای ۵ تا ۱۱ را می‌بیند)
    assert.deepEqual(detectDeviceChange([...run(1, 1, 3, DEV_A), rec(1, 12, DEV_B)]), []);
    // ردیف‌های بدون device/نامعتبر (بات، ثبت دستی، کلاینت قدیمی) تاریخچه حساب نمی‌شوند و نشانه نمی‌سازند
    const noDev = [rec(1, 1, null), rec(1, 2, 'short'), rec(1, 3, undefined), rec(1, 4, null), rec(1, 5, DEV_B)];
    assert.deepEqual(detectDeviceChange(noDev), []);
    assert.deepEqual(detectDeviceChange([...run(1, 1, 5, DEV_A), rec(1, 6, null), rec(1, 7, 'x')]), []);
    // device کاربر دیگر روی الگوی این کاربر اثر ندارد
    assert.deepEqual(detectDeviceChange([...run(1, 1, 5, DEV_A), ...run(2, 1, 6, DEV_B)]), []);
    // روز بعد از تغییر که همان device جدید دوباره دیده شود ⇒ تکرار نمی‌شود
    assert.equal(detectDeviceChange([...run(1, 1, 5, DEV_A), ...run(1, 6, 9, DEV_B)]).length, 1);
  });

  test('آستانه‌ها: lookbackDays، minHistoryDays (مرز)، targetDate، گزینه‌ی نامعتبر ⇒ پیش‌فرض', () => {
    const base = run(1, 1, 3, DEV_A);
    // مرز minHistoryDays: دقیقاً ۳ روز تاریخچه ⇒ نشانه؛ با آستانه‌ی ۴ ⇒ هیچ
    assert.equal(detectDeviceChange([...base, rec(1, 4, DEV_B)], { minHistoryDays: 3 }).length, 1);
    assert.deepEqual(detectDeviceChange([...base, rec(1, 4, DEV_B)], { minHistoryDays: 4 }), []);
    // آستانه‌ی کمتر: ۲ روز تاریخچه با minHistoryDays=2 ⇒ نشانه
    assert.equal(detectDeviceChange([...run(1, 1, 2, DEV_A), rec(1, 3, DEV_B)], { minHistoryDays: 2 }).length, 1);
    // مرز lookbackDays: روز ۸ با lookbackDays=7 روزهای ۱ تا ۷ را می‌بیند، با lookbackDays=2 فقط روزهای ۶ و ۷ را
    const wide = [...run(1, 1, 7, DEV_A), rec(1, 8, DEV_B)];
    assert.equal(detectDeviceChange(wide, { lookbackDays: 7 }).length, 1);
    assert.deepEqual(detectDeviceChange(wide, { lookbackDays: 2 }), []); // ۲ روز < ۳
    assert.equal(detectDeviceChange(wide, { lookbackDays: 2, minHistoryDays: 2 }).length, 1);
    // targetDate: فقط همان روز ارزیابی می‌شود
    const two = [...run(1, 1, 3, DEV_A), rec(1, 4, DEV_B), ...run(2, 1, 3, DEV_A), rec(2, 6, DEV_C)];
    assert.equal(detectDeviceChange(two).length, 2);
    assert.deepEqual(detectDeviceChange(two, { targetDate: day(4) }).map((e) => e.userIds[0]), [1]);
    assert.deepEqual(detectDeviceChange(two, { targetDate: day(5) }), []);
    // گزینه‌ی نامعتبر ⇒ پیش‌فرض (و targetDate نامعتبر ⇒ همه‌ی روزها)
    const bad = { lookbackDays: -1, minHistoryDays: 'x', targetDate: 'not-a-date' };
    assert.deepEqual(detectDeviceChange(two, bad), detectDeviceChange(two));
    assert.deepEqual(detectDeviceChange(two, { lookbackDays: 0, minHistoryDays: 1.5 }), detectDeviceChange(two));
  });

  test('ورودی خراب ⇒ []، ورودی تغییر نمی‌کند، خروجی مستقل از ترتیب ورودی', () => {
    for (const bad of [null, undefined, {}, 'x', 5]) assert.deepEqual(detectDeviceChange(bad), []);
    const records = [...run(1, 1, 4, DEV_A), rec(1, 5, DEV_B)];
    const dirty = [null, undefined, 7, {}, { user_id: 'x', record_date: day(1) },
      { user_id: 1, record_date: '2026-13-40', check_in_device: DEV_C },
      { user_id: 1, record_date: 20261001, check_in_device: DEV_C }, ...records];
    const snapshot = JSON.stringify(dirty);
    const out = detectDeviceChange(dirty);
    assert.equal(JSON.stringify(dirty), snapshot);
    assert.equal(out.length, 1);
    assert.deepEqual(out, detectDeviceChange(records.slice().reverse()));
  });
});

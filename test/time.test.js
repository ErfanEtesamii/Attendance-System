// S3-2a: helperهای زمان و تنظیم timezone. همه‌ی تبدیل‌ها با منطقه‌ی «صریح» و لحظه‌های ثابت (مستقل از ساعت سرور).
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const time = require('../src/utils/time');
const settings = require('../src/repositories/settingsRepository');
const serverTime = require('../src/utils/serverTime');

describe('زمان و TIMEZONE (S3-2a)', () => {
  let db;
  before(() => { db = resetDb(); });
  after(cleanup);

  test('اعتبار نام منطقه: IANA معتبر (و نرمال‌سازی حروف)، آفست/خالی/ناشناخته رد', () => {
    assert.equal(time.normalizeTimezone('Asia/Tehran'), 'Asia/Tehran');
    assert.equal(time.normalizeTimezone(' asia/tehran '), 'Asia/Tehran');
    assert.equal(time.normalizeTimezone('UTC'), 'UTC');
    assert.equal(time.isValidTimezone('America/New_York'), true);
    ['', '  ', '+03:30', '03:30', 'Mars/Base', 'Asia/', 'Asia//Tehran', 5, null, undefined, {}].forEach((v) => {
      assert.equal(time.isValidTimezone(v), false, JSON.stringify(v));
    });
    assert.throws(() => time.formatDate(new Date(), 'Mars/Base'), RangeError);
    assert.throws(() => time.formatDate('not-a-date', 'UTC'), RangeError);
  });

  test('تبدیل UTC → وقت شرکت با timezone ثابت: عبور از نیمه‌شب، 00 نه 24، روز هفته، مستقل از TZ سیستم', () => {
    const at = (iso, tz) => ({
      date: time.formatDate(iso, tz), time: time.formatTime(iso, tz), mins: time.minutesSinceMidnight(iso, tz), dow: time.dayOfWeek(iso, tz),
    });
    // تهران = UTC+03:30 (بدون DST)
    assert.deepEqual(at('2026-10-06T04:30:00.000Z', 'Asia/Tehran'), { date: '2026-10-06', time: '08:00', mins: 480, dow: 2 });
    assert.deepEqual(at('2026-10-06T20:29:59.999Z', 'Asia/Tehran'), { date: '2026-10-06', time: '23:59', mins: 1439, dow: 2 });
    assert.deepEqual(at('2026-10-06T20:30:00.000Z', 'Asia/Tehran'), { date: '2026-10-07', time: '00:00', mins: 0, dow: 3 }, 'نیمه‌شب تهران');
    assert.equal(time.formatDateTime(new Date('2026-12-31T21:00:00Z'), 'Asia/Tehran'), '2027-01-01 00:30', 'عبور از سال');
    // همان لحظه در منطقه‌های دیگر
    assert.deepEqual(at('2026-10-06T20:30:00.000Z', 'UTC'), { date: '2026-10-06', time: '20:30', mins: 1230, dow: 2 });
    assert.equal(time.formatDateTime('2026-01-15T12:00:00Z', 'America/New_York'), '2026-01-15 07:00', 'زمستان UTC-5');
    assert.equal(time.formatDateTime('2026-07-15T12:00:00Z', 'America/New_York'), '2026-07-15 08:00', 'تابستان UTC-4 (DST)');
    assert.equal(time.todayInZone('Asia/Tehran', new Date('2026-10-06T21:00:00Z')), '2026-10-07');
    assert.equal(time.todayInZone('UTC', new Date('2026-10-06T21:00:00Z')), '2026-10-06');

    // نتیجه نباید به TZ پروسه وابسته باشد
    const original = process.env.TZ;
    try {
      for (const tz of ['America/Los_Angeles', 'Pacific/Kiritimati', 'Asia/Tehran']) {
        process.env.TZ = tz;
        assert.equal(time.formatDateTime('2026-10-06T20:30:00Z', 'Asia/Tehran'), '2026-10-07 00:00', `TZ=${tz}`);
        assert.equal(time.minutesSinceMidnight('2026-10-06T04:30:00Z', 'Asia/Tehran'), 480, `TZ=${tz}`);
      }
    } finally {
      if (original === undefined) delete process.env.TZ; else process.env.TZ = original;
    }
    // قرارداد ذخیره‌سازی دست‌نخورده: serverTime همچنان ISO/UTC می‌دهد
    assert.match(serverTime.nowIso(), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.match(serverTime.todayDateString(), /^\d{4}-\d{2}-\d{2}$/);
  });

  test('وقت دیواری شرکت → UTC (معکوس) و رفت‌وبرگشت، شامل DST و ورودی نامعتبر', () => {
    const iso = (d, h, tz) => time.zonedTimeToUtc(d, h, tz).toISOString();
    assert.equal(iso('2026-10-06', '08:00', 'Asia/Tehran'), '2026-10-06T04:30:00.000Z');
    assert.equal(iso('2026-10-07', '00:00', 'Asia/Tehran'), '2026-10-06T20:30:00.000Z');
    assert.equal(iso('2026-10-07', undefined, 'Asia/Tehran'), '2026-10-06T20:30:00.000Z', 'ساعت پیش‌فرض 00:00');
    assert.equal(iso('2026-01-15', '09:00', 'America/New_York'), '2026-01-15T14:00:00.000Z');
    assert.equal(iso('2026-07-15', '09:00', 'America/New_York'), '2026-07-15T13:00:00.000Z', 'DST');
    assert.equal(iso('2026-03-08', '02:30', 'America/New_York'), '2026-03-08T07:30:00.000Z', 'ساعت ناموجود جهش DST: بعد از جهش');
    // رفت‌وبرگشت روی چند لحظه
    for (const [d, h, tz] of [['2026-10-06', '23:59', 'Asia/Tehran'], ['2026-11-01', '01:30', 'America/New_York'], ['2027-02-28', '12:00', 'Europe/Berlin']]) {
      const back = time.zonedTimeToUtc(d, h, tz);
      assert.equal(time.formatDate(back, tz), d);
      assert.equal(time.formatTime(back, tz), h);
    }
    ['2026-02-30', '2026-13-01', '2026-1-1', 'x'].forEach((d) => assert.throws(() => time.zonedTimeToUtc(d, '08:00', 'UTC'), RangeError, d));
    ['24:00', '08:60', '8:00'].forEach((h) => assert.throws(() => time.zonedTimeToUtc('2026-10-06', h, 'UTC'), RangeError, h));
  });

  test('تنظیم timezone: پیش‌فرض Asia/Tehran، اعتبارسنجی، مقدار خراب ⇒ پیش‌فرض، helperها بدون آرگومان از تنظیم می‌خوانند', () => {
    db.exec("DELETE FROM settings WHERE key = 'timezone'");
    assert.equal(settings.getTimezone(), 'Asia/Tehran');
    assert.equal(settings.getAll().timezone, 'Asia/Tehran');
    assert.equal(time.getTimezone(), 'Asia/Tehran');
    assert.equal(time.formatTime('2026-10-06T04:30:00Z'), '08:00');

    assert.equal(settings.update({ timezone: 'Europe/Berlin' }).timezone, 'Europe/Berlin');
    assert.equal(db.prepare("SELECT value FROM settings WHERE key = 'timezone'").get().value, 'Europe/Berlin');
    assert.equal(time.formatTime('2026-10-06T04:30:00Z'), '06:30', 'بدون tz صریح، تنظیم جدید اعمال می‌شود');
    assert.equal(time.formatTime('2026-10-06T04:30:00Z', 'Asia/Tehran'), '08:00', 'tz صریح بر تنظیم مقدم است');

    for (const bad of ['Mars/Base', '+03:30', '', 5]) {
      assert.equal(settings.update({ timezone: bad }).timezone, 'Europe/Berlin', `نامعتبر: ${JSON.stringify(bad)}`);
    }
    assert.equal(settings.update({ timezone: ' asia/tehran ' }).timezone, 'Asia/Tehran', 'نرمال‌سازی');
    assert.equal(require('../src/utils/settingsRegistry').validate('timezone', 'Nope/Zone').ok, false);

    db.prepare("UPDATE settings SET value = 'garbage' WHERE key = 'timezone'").run();
    assert.equal(settings.getTimezone(), 'Asia/Tehran', 'مقدار خراب در DB ⇒ پیش‌فرض');
    assert.equal(settings.getItem('timezone').type, 'timezone');
  });
});

// S3-10a: public-admin/js/jalali.js (تبدیل شمسی↔میلادی در مرورگر). مقایسه‌ی کامل با jalaali-js (کتابخانه‌ی سمت سرور) + لنگرهای تقویم واقعی.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const jalaali = require('jalaali-js');
const J = require(path.join(__dirname, '..', 'public-admin', 'js', 'jalali.js'));

describe('jalali.js (S3-10a)', () => {
  test('لنگرهای تقویم رسمی: ۱ فروردین، سال کبیسه (۳۰ اسفند ۱۴۰۳ و ۱۳۹۹)، اسفند سال غیرکبیسه ۲۹ روز', () => {
    assert.equal(J.jalaliToIso(1405, 1, 1), '2026-03-21');
    assert.equal(J.jalaliToIso(1404, 1, 1), '2025-03-21');
    assert.equal(J.jalaliToIso(1403, 12, 30), '2025-03-20'); // ۳۰ اسفند کبیسه
    assert.equal(J.jalaliToIso(1399, 12, 30), '2021-03-20');
    assert.equal(J.isLeap(1403), true);
    assert.equal(J.isLeap(1404), false);
    assert.equal(J.monthLength(1403, 12), 30);
    assert.equal(J.monthLength(1404, 12), 29);
    assert.equal(J.monthLength(1404, 6), 31);
    assert.equal(J.monthLength(1404, 7), 30);
    assert.deepEqual(J.isoToJalali('2025-03-20'), { jy: 1403, jm: 12, jd: 30 });
    assert.deepEqual(J.isoToJalali('2025-03-21'), { jy: 1404, jm: 1, jd: 1 });
    assert.deepEqual(J.isoToJalali('2026-10-07'), { jy: 1405, jm: 7, jd: 15 });
  });

  test('رفت‌وبرگشت و برابری با jalaali-js روی همه‌ی روزهای سال‌های −۶۰ تا ۳۱۷۶ (طول ماه، شمسی→میلادی، میلادی→شمسی)', () => {
    let n = 0;
    for (let jy = -60; jy < 3177; jy += 1) {
      for (let jm = 1; jm <= 12; jm += 1) {
        const len = jalaali.jalaaliMonthLength(jy, jm);
        assert.equal(J.monthLength(jy, jm), len, `${jy}/${jm}`);
        for (let jd = 1; jd <= len; jd += 1) {
          const g = jalaali.toGregorian(jy, jm, jd);
          assert.deepEqual(J.toGregorian(jy, jm, jd), { gy: g.gy, gm: g.gm, gd: g.gd }, `${jy}/${jm}/${jd}`);
          assert.deepEqual(J.toJalali(g.gy, g.gm, g.gd), { jy, jm, jd }, `${g.gy}-${g.gm}-${g.gd}`);
          n += 1;
        }
      }
    }
    assert.ok(n > 1000000);
  });

  test('هر روز میلادی ۱۹۰۰ تا ۲۱۰۰ دقیقاً یک روز بعد از دیروزش است (پیوستگی) و با jalaali-js یکی است', () => {
    let prev = null;
    for (let t = Date.UTC(1900, 0, 1); t <= Date.UTC(2100, 11, 31); t += 86400000) {
      const d = new Date(t);
      const gy = d.getUTCFullYear(); const gm = d.getUTCMonth() + 1; const gd = d.getUTCDate();
      const j = J.toJalali(gy, gm, gd);
      const ref = jalaali.toJalaali(gy, gm, gd);
      assert.deepEqual(j, { jy: ref.jy, jm: ref.jm, jd: ref.jd }, `${gy}-${gm}-${gd}`);
      if (prev) {
        const next = prev.jd < J.monthLength(prev.jy, prev.jm) ? { jy: prev.jy, jm: prev.jm, jd: prev.jd + 1 }
          : prev.jm < 12 ? { jy: prev.jy, jm: prev.jm + 1, jd: 1 } : { jy: prev.jy + 1, jm: 1, jd: 1 };
        assert.deepEqual(j, next);
      }
      prev = j;
    }
  });

  test('اعتبارسنجی: ۳۰ اسفند سال غیرکبیسه، ماه/روز خارج از بازه، میلادی نامعتبر، سال خارج از پشتیبانی', () => {
    assert.equal(J.isValid(1404, 12, 30), false);
    assert.equal(J.isValid(1403, 12, 30), true);
    assert.equal(J.isValid(1405, 13, 1), false);
    assert.equal(J.isValid(1405, 7, 31), false);
    assert.equal(J.isValid(1405, 1, 0), false);
    assert.equal(J.isValid(1405.5, 1, 1), false);
    assert.equal(J.isValid(3178, 1, 1), false);
    assert.throws(() => J.toGregorian(1404, 12, 30), RangeError);
    assert.throws(() => J.toJalali(2025, 2, 30), RangeError);
    assert.throws(() => J.toJalali(2023, 2, 29), RangeError);
    assert.doesNotThrow(() => J.toJalali(2024, 2, 29));
    assert.equal(J.isoToJalali('2025-13-01'), null);
    assert.equal(J.isoToJalali('نامعتبر'), null);
  });

  test('اعداد: فارسی/عربی/انگلیسی در ورودی (parse) و خروجی فارسی یا انگلیسی', () => {
    assert.equal(J.toEnDigits('۱۴۰۵/٠١/۰۱'), '1405/01/01');
    assert.equal(J.toFaDigits('1405/01/01'), '۱۴۰۵/۰۱/۰۱');
    for (const s of ['۱۴۰۵/۰۱/۰۱', '1405/01/01', '1405-1-1', '۱۴۰۵.۱.۱', '١٤٠٥/١/١', ' 1405 / 1 / 1 ', '۱۴۰۵،۱،۱']) {
      assert.deepEqual(J.parse(s), { jy: 1405, jm: 1, jd: 1 }, s);
    }
    for (const s of ['1404/12/30', '1405/13/01', '1405/1', 'abc', '', null, undefined, '1405/01/01/01', '05/01/01']) assert.equal(J.parse(s), null, String(s));
    assert.equal(J.parseToIso('۱۴۰۳/۱۲/۳۰'), '2025-03-20');
    assert.equal(J.parseToIso('۱۴۰۴/۱۲/۳۰'), null);
    const j = { jy: 1405, jm: 1, jd: 1 };
    assert.equal(J.format(j), '۱۴۰۵/۰۱/۰۱');
    assert.equal(J.format(j, { digits: 'en' }), '1405/01/01');
    assert.equal(J.format(j, { digits: 'en', sep: '-' }), '1405-01-01');
    assert.equal(J.formatLong(j), '۱ فروردین ۱۴۰۵');
    assert.equal(J.formatLong({ jy: 1403, jm: 12, jd: 30 }, { digits: 'en' }), '30 اسفند 1403');
    assert.equal(J.formatIso('2026-03-21'), '۱۴۰۵/۰۱/۰۱');
    assert.equal(J.formatIso('2026-03-21', { long: true }), '۱ فروردین ۱۴۰۵');
    assert.equal(J.formatIso('bad'), '');
  });

  test('نام ماه‌ها و روز هفته (شنبه=۰)', () => {
    assert.equal(J.MONTH_NAMES.length, 12);
    assert.deepEqual([J.MONTH_NAMES[0], J.MONTH_NAMES[11]], ['فروردین', 'اسفند']);
    assert.equal(J.WEEKDAY_NAMES[0], 'شنبه');
    assert.equal(J.WEEKDAY_NAMES[6], 'جمعه');
    assert.equal(J.weekdayName('2026-10-07'), 'چهارشنبه');
    assert.equal(J.weekdayName('2026-10-03'), 'شنبه');
    assert.equal(J.weekdayName('2026-10-09'), 'جمعه');
    assert.equal(J.weekdayIndex('x'), -1);
    for (let t = Date.UTC(2020, 0, 1); t < Date.UTC(2030, 0, 1); t += 86400000 * 7) {
      const d = new Date(t);
      assert.equal(J.weekdayIndex(d.toISOString().slice(0, 10)), (d.getUTCDay() + 1) % 7);
    }
  });

  test('بدون CDN/وابستگی: فایل require و fetch و import ندارد و در مرورگر window.Jalali می‌سازد', () => {
    const fs = require('fs');
    const vm = require('vm');
    const src = fs.readFileSync(path.join(__dirname, '..', 'public-admin', 'js', 'jalali.js'), 'utf8');
    assert.doesNotMatch(src, /require\(|import\s|fetch\(|https?:\/\//);
    const win = {};
    vm.runInNewContext(src, { self: win });
    assert.equal(win.Jalali.jalaliToIso(1405, 1, 1), '2026-03-21');
  });
});

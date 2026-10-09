// S4-14a: کمک‌تابع‌های ماه شمسیِ صریح (jalaliMonthRangeOf / jalaliMonthDates) — لنگرهای تقویم رسمی، کبیسه، ورودی نامعتبر.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { jalaliMonthRangeOf, jalaliMonthDates } = require('../src/utils/jalali');

describe('jalaliMonthRangeOf / jalaliMonthDates (S4-14a)', () => {
  test('فروردین ۱۴۰۵: ۳۱ روز از ۲۰۲۶-۰۳-۲۱ تا ۲۰۲۶-۰۴-۲۰', () => {
    const r = jalaliMonthRangeOf(1405, 1);
    assert.equal(r.from, '2026-03-21');
    assert.equal(r.to, '2026-04-20');
    assert.equal(r.daysInMonth, 31);
    assert.ok(r.label.startsWith('فروردین'));
  });
  test('اسفند: کبیسه (۱۴۰۳) ۳۰ روز، غیرکبیسه (۱۴۰۴) ۲۹ روز', () => {
    const leap = jalaliMonthDates(1403, 12);
    assert.equal(leap.length, 30);
    assert.equal(leap[leap.length - 1], '2025-03-20');
    const normal = jalaliMonthDates(1404, 12);
    assert.equal(normal.length, 29);
    assert.equal(normal[normal.length - 1], '2026-03-20');
  });
  test('تاریخ‌ها پشت‌سرهم و یکتا هستند', () => {
    const dates = jalaliMonthDates(1405, 7);
    for (let i = 1; i < dates.length; i += 1) {
      const diff = (Date.parse(`${dates[i]}T00:00:00Z`) - Date.parse(`${dates[i - 1]}T00:00:00Z`)) / 86400000;
      assert.equal(diff, 1);
    }
  });
  test('ورودی نامعتبر ⇒ RangeError', () => {
    assert.throws(() => jalaliMonthRangeOf(1405, 0), RangeError);
    assert.throws(() => jalaliMonthRangeOf(1405, 13), RangeError);
    assert.throws(() => jalaliMonthRangeOf('1405', 1), RangeError);
    assert.throws(() => jalaliMonthDates(1405.5, 1), RangeError);
  });
});

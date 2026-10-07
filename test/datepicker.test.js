// S3-10b: منطق خالص datepicker شمسی (شبکه‌ی ماه، جابه‌جایی کیبورد، افزودن ماه) + وابستگی/ساختار فایل.
// رفتار DOM (باز/بستن، کیبورد، تایپ، مقدار میلادی فرم) در مرورگر واقعی تست شد؛ شرح در CHANGELOG.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const J = require('../public-admin/js/jalali.js');
const DP = require('../public-admin/js/datepicker.js');

describe('datepicker شمسی (S3-10b)', () => {
  test('شبکه‌ی ماه: هفته از شنبه، طول ماه درست، خانه‌های خالی، جمعه‌ها ستون آخر، مهر ۱۴۰۵ از جمعه شروع می‌شود', () => {
    const weeks = DP.monthGrid(1405, 7); // ۱ مهر ۱۴۰۵ = ۲۰۲۶-۰۹-۲۳ (چهارشنبه)
    assert.ok(weeks.every((w) => w.length === 7));
    const days = weeks.flat().filter(Boolean);
    assert.equal(days.length, 30);
    assert.equal(days[0].iso, '2026-09-23');
    assert.equal(weeks[0].findIndex(Boolean), 4, 'چهارشنبه = ستون پنجم از شنبه');
    assert.ok(days.filter((d) => d.weekday === 6).every((d) => J.weekdayName(d.iso) === 'جمعه'));
    assert.equal(DP.monthGrid(1403, 12).flat().filter(Boolean).length, 30, 'اسفند کبیسه');
    assert.equal(DP.monthGrid(1404, 12).flat().filter(Boolean).length, 29);
    assert.equal(DP.monthGrid(1405, 1).flat().filter(Boolean)[0].iso, '2026-03-21');
    for (const [jy, jm] of [[1404, 1], [1404, 6], [1405, 12], [1399, 12]]) {
      const w = DP.monthGrid(jy, jm);
      const ds = w.flat().filter(Boolean);
      assert.equal(ds.length, J.monthLength(jy, jm));
      assert.ok(w.length <= 6);
      ds.forEach((d, i) => assert.equal(J.weekdayIndex(d.iso), d.weekday, `${jy}/${jm}/${i + 1}`));
    }
  });

  test('addMonths: عبور از سال، کلمپ روز (۳۱ شهریور + ۱ ⇒ ۳۰ مهر)، اسفند کبیسه ↔ غیرکبیسه', () => {
    const j = (iso) => J.formatIso(iso, { digits: 'en' });
    assert.equal(j(DP.addMonths(J.jalaliToIso(1405, 6, 31), 1)), '1405/07/30');
    assert.equal(j(DP.addMonths(J.jalaliToIso(1405, 12, 29), 1)), '1406/01/29');
    assert.equal(j(DP.addMonths(J.jalaliToIso(1405, 1, 1), -1)), '1404/12/01');
    assert.equal(j(DP.addMonths(J.jalaliToIso(1403, 12, 30), 12)), '1404/12/29');
    assert.equal(j(DP.addMonths(J.jalaliToIso(1405, 5, 15), 24)), '1407/05/15');
  });

  test('کیبورد (RTL): → روز قبل، ← روز بعد، ↑/↓ ±۷، Page ±ماه، Shift+Page ±سال، Home/End، کلید دیگر ⇒ null', () => {
    const d = J.jalaliToIso(1405, 7, 15);
    const f = (iso) => J.formatIso(iso, { digits: 'en' });
    assert.equal(f(DP.navigate(d, 'ArrowRight')), '1405/07/14');
    assert.equal(f(DP.navigate(d, 'ArrowLeft')), '1405/07/16');
    assert.equal(f(DP.navigate(d, 'ArrowUp')), '1405/07/08');
    assert.equal(f(DP.navigate(d, 'ArrowDown')), '1405/07/22');
    assert.equal(f(DP.navigate(d, 'PageUp')), '1405/06/15');
    assert.equal(f(DP.navigate(d, 'PageDown', true)), '1406/07/15');
    assert.equal(f(DP.navigate(d, 'Home')), '1405/07/01');
    assert.equal(f(DP.navigate(d, 'End')), '1405/07/30');
    assert.equal(f(DP.navigate(J.jalaliToIso(1403, 12, 5), 'End')), '1403/12/30');
    assert.equal(f(DP.navigate(J.jalaliToIso(1405, 1, 1), 'ArrowRight')), '1404/12/29', 'عبور از سال');
    assert.equal(DP.navigate(d, 'a'), null);
  });

  test('بدون CDN/شبکه؛ در مرورگر JalaliDatepicker می‌سازد و به window.Jalali تکیه دارد؛ CSS فقط متغیر/مقدار محلی', () => {
    const dir = path.join(__dirname, '..', 'public-admin');
    const src = fs.readFileSync(path.join(dir, 'js', 'datepicker.js'), 'utf8');
    assert.doesNotMatch(src, /fetch\(|XMLHttpRequest|https?:\/\/|innerHTML\s*=\s*[^;]*input\.value/);
    const win = { Jalali: J };
    vm.runInNewContext(src, { self: win });
    assert.equal(typeof win.JalaliDatepicker.attach, 'function');
    assert.doesNotMatch(fs.readFileSync(path.join(dir, 'css', 'datepicker.css'), 'utf8'), /@import|url\(/);
  });
});

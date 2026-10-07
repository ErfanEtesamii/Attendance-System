// تبدیل تاریخ شمسی ↔ میلادی برای پنل (S3-10a) — بدون وابستگی و بدون CDN. در مرورگر `window.Jalali`، در Node با require.
// الگوریتم: همان جدول «نقطه‌های شکست» ۳۳ساله‌ی jalaali-js (MIT، © Behrang Noruzi Niya؛ محاسبه‌ی کبیسه‌ی تقویم رسمی)،
// عمداً یکسان با کتابخانه‌ای که سرور (holidayInput.js) می‌خواند تا تاریخ پنل و سرور هیچ‌وقت اختلاف یک‌روزه نداشته باشند.
// تست مقایسه با jalaali-js روی کل بازه: test/jalali.test.js. محدوده‌ی پشتیبانی: سال شمسی −۶۱ تا ۳۱۷۶ (دو طرفه؛ آخرین ماه‌های ۳۱۷۷ فقط شمسی→میلادی).
//
// قرارداد: ماه ۱..۱۲؛ تاریخ میلادی به‌صورت { gy, gm, gd } و شمسی { jy, jm, jd }؛ رشته‌ی ISO میلادی «YYYY-MM-DD» (همان فرمت DB).
// روز هفته: شنبه = ۰ … جمعه = ۶ (ترتیب هفته‌ی ایرانی).

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Jalali = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var BREAKS = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];
  var MONTH_NAMES = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
  // شنبه … جمعه
  var WEEKDAY_NAMES = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'];

  function div(a, b) { return ~~(a / b); }
  function mod(a, b) { return a - ~~(a / b) * b; }

  // ---------- اعداد فارسی/عربی/انگلیسی ----------
  var FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
  function toEnDigits(input) {
    return String(input == null ? '' : input)
      .replace(/[۰-۹]/g, function (c) { return String(c.charCodeAt(0) - 0x06F0); })
      .replace(/[٠-٩]/g, function (c) { return String(c.charCodeAt(0) - 0x0660); });
  }
  function toFaDigits(input) {
    return String(input == null ? '' : input).replace(/[0-9]/g, function (c) { return FA_DIGITS[Number(c)]; });
  }

  // ---------- میلادی ↔ شماره‌ی روز ژولیانی ----------
  function g2d(gy, gm, gd) {
    var d = div((gy + div(gm - 8, 6) + 100100) * 1461, 4) + div(153 * mod(gm + 9, 12) + 2, 5) + gd - 34840408;
    return d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  }
  function jdnToGregorian(jdn) {
    var j = 4 * jdn + 139361631;
    j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
    var i = div(mod(j, 1461), 4) * 5 + 308;
    var gd = div(mod(i, 153), 5) + 1;
    var gm = mod(div(i, 153), 12) + 1;
    var gy = div(j, 1461) - 100100 + div(8 - gm, 6);
    return { gy: gy, gm: gm, gd: gd };
  }

  // ---------- هسته‌ی تقویم شمسی ----------
  // خروجی: { leap: ۰ برای کبیسه (۱..۴ = فاصله از کبیسه‌ی بعدی)، gy: سال میلادی شروع سال شمسی، march: روز فروردین‌ماه‌ی میلادی }
  function jalCal(jy, withoutLeap) {
    var bl = BREAKS.length;
    var gy = jy + 621;
    var leapJ = -14;
    var jp = BREAKS[0];
    var jm, jump = 0, leap, leapG, march, n, i;
    if (jy < jp || jy >= BREAKS[bl - 1]) throw new RangeError('سال شمسی نامعتبر: ' + jy);
    for (i = 1; i < bl; i += 1) {
      jm = BREAKS[i];
      jump = jm - jp;
      if (jy < jm) break;
      leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
      jp = jm;
    }
    n = jy - jp;
    leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
    if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
    leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
    march = 20 + leapJ - leapG;
    if (withoutLeap) return { gy: gy, march: march };
    if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
    leap = mod(mod(n + 1, 33) - 1, 4);
    if (leap === -1) leap = 4;
    return { leap: leap, gy: gy, march: march };
  }

  function isLeap(jy) { return jalCal(jy, false).leap === 0; }
  function monthLength(jy, jm) {
    if (jm < 1 || jm > 12) throw new RangeError('ماه نامعتبر: ' + jm);
    if (jm <= 6) return 31;
    if (jm <= 11) return 30;
    return isLeap(jy) ? 30 : 29;
  }
  function isValid(jy, jm, jd) {
    if (![jy, jm, jd].every(Number.isInteger)) return false;
    if (jy < BREAKS[0] || jy >= BREAKS[BREAKS.length - 1]) return false;
    return jm >= 1 && jm <= 12 && jd >= 1 && jd <= monthLength(jy, jm);
  }

  function j2d(jy, jm, jd) {
    var r = jalCal(jy, true);
    return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
  }
  function d2j(jdn) {
    var gy = jdnToGregorian(jdn).gy;
    var jy = gy - 621;
    var r = jalCal(jy, false);
    var jdn1f = g2d(gy, 3, r.march);
    var jm, jd;
    var k = jdn - jdn1f;
    if (k >= 0) {
      if (k <= 185) return { jy: jy, jm: 1 + div(k, 31), jd: mod(k, 31) + 1 };
      k -= 186;
    } else {
      jy -= 1;
      k += 179;
      if (r.leap === 1) k += 1;
    }
    jm = 7 + div(k, 30);
    jd = mod(k, 30) + 1;
    return { jy: jy, jm: jm, jd: jd };
  }

  function isValidGregorian(gy, gm, gd) {
    if (![gy, gm, gd].every(Number.isInteger) || gm < 1 || gm > 12 || gd < 1) return false;
    var dt = new Date(Date.UTC(2000, gm - 1, gd)); // سال ۲۰۰۰ کبیسه است؛ طول ماه را فقط برای گرفتن سقف روز می‌خواهیم
    dt.setUTCFullYear(gy);
    return dt.getUTCFullYear() === gy && dt.getUTCMonth() === gm - 1 && dt.getUTCDate() === gd;
  }

  // ---------- API عمومی ----------
  function toJalali(gy, gm, gd) {
    if (!isValidGregorian(gy, gm, gd)) throw new RangeError('تاریخ میلادی نامعتبر: ' + gy + '-' + gm + '-' + gd);
    return d2j(g2d(gy, gm, gd));
  }
  function toGregorian(jy, jm, jd) {
    if (!isValid(jy, jm, jd)) throw new RangeError('تاریخ شمسی نامعتبر: ' + jy + '/' + jm + '/' + jd);
    return jdnToGregorian(j2d(jy, jm, jd));
  }

  var pad2 = function (n) { return (n < 10 ? '0' : '') + n; };
  var pad4 = function (n) { return ('0000' + n).slice(-4); };

  // 'YYYY-MM-DD' (میلادی، همان فرمت DB) ↔ شی‌ء شمسی
  function parseIso(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(toEnDigits(iso).trim());
    if (!m) return null;
    var gy = +m[1], gm = +m[2], gd = +m[3];
    return isValidGregorian(gy, gm, gd) ? { gy: gy, gm: gm, gd: gd } : null;
  }
  function isoToJalali(iso) {
    var g = parseIso(iso);
    return g ? toJalali(g.gy, g.gm, g.gd) : null;
  }
  function jalaliToIso(jy, jm, jd) {
    var g = toGregorian(jy, jm, jd);
    return pad4(g.gy) + '-' + pad2(g.gm) + '-' + pad2(g.gd);
  }

  // ورودی کاربر: «۱۴۰۵/۰۱/۰۱»، «1405-1-1»، «۱۴۰۵.۱.۱»، «١٤٠٥/١/١» … ⇒ { jy, jm, jd } یا null (فرمت/تاریخ نامعتبر؛ مثلاً ۳۰ اسفند سال غیرکبیسه)
  function parse(text) {
    var s = toEnDigits(text).trim().replace(/[‌‏‎٫٬]/g, '').replace(/[،,،]/g, '/');
    var m = /^(\d{3,4})\s*[\/\-.]\s*(\d{1,2})\s*[\/\-.]\s*(\d{1,2})$/.exec(s);
    if (!m) return null;
    var jy = +m[1], jm = +m[2], jd = +m[3];
    return isValid(jy, jm, jd) ? { jy: jy, jm: jm, jd: jd } : null;
  }
  function parseToIso(text) {
    var j = parse(text);
    return j ? jalaliToIso(j.jy, j.jm, j.jd) : null;
  }

  // قالب‌بندی: opts.digits = 'fa' (پیش‌فرض) | 'en'؛ opts.sep (پیش‌فرض '/')
  function applyDigits(s, digits) { return digits === 'en' ? s : toFaDigits(s); }
  function format(j, opts) {
    var o = opts || {};
    var sep = o.sep == null ? '/' : o.sep;
    return applyDigits(pad4(j.jy) + sep + pad2(j.jm) + sep + pad2(j.jd), o.digits);
  }
  function formatLong(j, opts) { // «۱ فروردین ۱۴۰۵»
    var o = opts || {};
    return applyDigits(j.jd + ' ', o.digits) + MONTH_NAMES[j.jm - 1] + ' ' + applyDigits(String(j.jy), o.digits);
  }
  function formatIso(iso, opts) { // ISO میلادی ⇒ متن شمسی؛ ورودی نامعتبر ⇒ ''
    var j = isoToJalali(iso);
    return j ? ((opts && opts.long) ? formatLong(j, opts) : format(j, opts)) : '';
  }

  function weekdayIndex(iso) { // شنبه=۰ … جمعه=۶؛ نامعتبر ⇒ -1
    var g = parseIso(iso);
    if (!g) return -1;
    var jdn = g2d(g.gy, g.gm, g.gd);
    return mod(jdn + 2, 7); // JDN%7: ۰=دوشنبه … ۵=شنبه؛ با افزودن ۲ شنبه ۰ می‌شود
  }
  function weekdayName(iso) { var i = weekdayIndex(iso); return i < 0 ? '' : WEEKDAY_NAMES[i]; }

  return {
    MONTH_NAMES: MONTH_NAMES,
    WEEKDAY_NAMES: WEEKDAY_NAMES,
    toEnDigits: toEnDigits,
    toFaDigits: toFaDigits,
    isLeap: isLeap,
    monthLength: monthLength,
    isValid: isValid,
    toJalali: toJalali,
    toGregorian: toGregorian,
    parseIso: parseIso,
    isoToJalali: isoToJalali,
    jalaliToIso: jalaliToIso,
    parse: parse,
    parseToIso: parseToIso,
    format: format,
    formatLong: formatLong,
    formatIso: formatIso,
    weekdayIndex: weekdayIndex,
    weekdayName: weekdayName,
  };
}));

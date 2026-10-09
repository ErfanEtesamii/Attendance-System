// کمک‌تابع‌های تقویم شمسی. طبق درخواست، گزارش‌های ماهانه باید بر اساس ماه شمسی باشند
// نه میلادی. تبدیل تاریخ‌ها با کتابخانه jalaali-js انجام می‌شود؛ خود این ماژول فقط
// توابع پرکاربرد پروژه (شروع/پایان ماه شمسی جاری یا قبلی، برچسب فارسی ماه) را فراهم می‌کند.

const jalaali = require('jalaali-js');

const MONTH_NAMES = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند',
];

function pad(n, len = 2) {
  return String(n).padStart(len, '0');
}

function gregorianToDateString({ gy, gm, gd }) {
  return `${pad(gy, 4)}-${pad(gm)}-${pad(gd)}`;
}

function toJalaliFromDate(date = new Date()) {
  return jalaali.toJalaali(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

// آیا امروز (یا تاریخ داده‌شده) روز اول یک ماه شمسی است؟
// از این تابع در Job روزانه گزارش ماهانه استفاده می‌شود تا نیازی به cron مبتنی بر روز میلادی نباشد
// (چون شروع ماه شمسی روی تقویم میلادی هر سال جابه‌جا می‌شود).
function isFirstDayOfJalaliMonth(date = new Date()) {
  return toJalaliFromDate(date).jd === 1;
}

// بازه (شروع/پایان به فرمت YYYY-MM-DD میلادی، برای کوئری روی attendance_records) و برچسب فارسی
// مربوط به «ماه شمسی جاری» یا «ماه شمسی قبلی» را برمی‌گرداند.
function jalaliMonthRange({ previous = false, date = new Date() } = {}) {
  const j = toJalaliFromDate(date);
  let { jy, jm } = j;

  if (previous) {
    jm -= 1;
    if (jm === 0) {
      jm = 12;
      jy -= 1;
    }
  }

  const daysInMonth = jalaali.jalaaliMonthLength(jy, jm);
  const startGregorian = jalaali.toGregorian(jy, jm, 1);
  const endGregorian = jalaali.toGregorian(jy, jm, daysInMonth);

  return {
    from: gregorianToDateString(startGregorian),
    to: gregorianToDateString(endGregorian),
    label: `${MONTH_NAMES[jm - 1]} ${jy}`,
    jy,
    jm,
  };
}

// از ابتدای ماه شمسی جاری تا امروز (برای /report - «از ابتدای ماه جاری»)
function jalaliMonthToDateRange(date = new Date()) {
  const range = jalaliMonthRange({ date });
  const today = gregorianToDateString({
    gy: date.getFullYear(),
    gm: date.getMonth() + 1,
    gd: date.getDate(),
  });
  return { from: range.from, to: today, label: range.label };
}

// S3-11c: ستون «تاریخ شمسی» در CSVها. خروجی «YYYY/MM/DD» با ارقام انگلیسی (برای مرتب‌سازی/فیلتر در اکسل)؛ ورودی نامعتبر/خالی ⇒ ''.
const pad2 = (n) => String(n).padStart(2, '0');
function isoDateToJalaliString(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso == null ? '' : iso));
  if (!m) return '';
  const [gy, gm, gd] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(2000, gm - 1, gd));
  d.setUTCFullYear(gy);
  if (gm < 1 || gm > 12 || d.getUTCFullYear() !== gy || d.getUTCMonth() !== gm - 1 || d.getUTCDate() !== gd) return '';
  try {
    const j = jalaali.toJalaali(gy, gm, gd);
    return `${j.jy}/${pad2(j.jm)}/${pad2(j.jd)}`;
  } catch (_) { return ''; }
}

// لحظه‌ی ذخیره‌شده (UTC: «YYYY-MM-DD HH:MM:SS» دیتابیس یا ISO) ⇒ تاریخ شمسیِ همان لحظه به وقت شرکت (نه منطقه‌ی سرور)
function instantToJalaliString(value, tz) {
  if (!value) return '';
  const s = String(value);
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s) ? `${s.replace(' ', 'T')}Z` : s;
  try {
    return isoDateToJalaliString(require('./time').formatDate(iso, tz));
  } catch (_) { return ''; }
}

// S4-9a: سال شمسیِ یک تاریخ میلادی «YYYY-MM-DD» (بدون وابستگی به ساعت/منطقه‌ی زمانی سیستم) — نامعتبر ⇒ null.
function jalaliYearOfDateString(iso) {
  const m = typeof iso === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso) : null;
  if (!m) return null;
  const gy = Number(m[1]);
  const gm = Number(m[2]);
  const gd = Number(m[3]);
  const check = new Date(Date.UTC(gy, gm - 1, gd));
  if (check.getUTCFullYear() !== gy || check.getUTCMonth() !== gm - 1 || check.getUTCDate() !== gd) return null;
  return jalaali.toJalaali(gy, gm, gd).jy;
}

// S4-9a: اولین و آخرین روز (میلادی، YYYY-MM-DD) یک سال شمسی؛ jy باید عدد صحیح باشد.
function jalaliYearToDateRange(jy) {
  if (!Number.isInteger(jy)) throw new RangeError('سال شمسی باید عدد صحیح باشد.');
  const last = jalaali.jalaaliMonthLength(jy, 12);
  return {
    from: gregorianToDateString(jalaali.toGregorian(jy, 1, 1)),
    to: gregorianToDateString(jalaali.toGregorian(jy, 12, last)),
  };
}

// S4-14a: بازه‌ی میلادیِ یک ماه شمسیِ دلخواه (برخلاف jalaliMonthRange که از تاریخ «الان» می‌گیرد؛ اینجا jy/jm صریح داده می‌شود).
function jalaliMonthRangeOf(jy, jm) {
  if (!Number.isInteger(jy) || !Number.isInteger(jm) || jm < 1 || jm > 12) {
    throw new RangeError('سال/ماه شمسی نامعتبر است.');
  }
  const daysInMonth = jalaali.jalaaliMonthLength(jy, jm);
  const startGregorian = jalaali.toGregorian(jy, jm, 1);
  const endGregorian = jalaali.toGregorian(jy, jm, daysInMonth);
  return {
    from: gregorianToDateString(startGregorian),
    to: gregorianToDateString(endGregorian),
    daysInMonth,
    label: `${MONTH_NAMES[jm - 1]} ${jy}`,
  };
}

// S4-14a: فهرست همه‌ی تاریخ‌های میلادیِ یک ماه شمسی، روز به روز (برای ساخت شبکه‌ی تقویم).
function jalaliMonthDates(jy, jm) {
  const { daysInMonth } = jalaliMonthRangeOf(jy, jm);
  const dates = [];
  for (let d = 1; d <= daysInMonth; d += 1) {
    dates.push(gregorianToDateString(jalaali.toGregorian(jy, jm, d)));
  }
  return dates;
}

module.exports = {
  isoDateToJalaliString,
  instantToJalaliString,
  MONTH_NAMES,
  toJalaliFromDate,
  isFirstDayOfJalaliMonth,
  jalaliMonthRange,
  jalaliMonthRangeOf,
  jalaliMonthDates,
  jalaliMonthToDateRange,
  jalaliYearOfDateString,
  jalaliYearToDateRange,
};

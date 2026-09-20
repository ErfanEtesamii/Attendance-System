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

module.exports = {
  MONTH_NAMES,
  toJalaliFromDate,
  isFirstDayOfJalaliMonth,
  jalaliMonthRange,
  jalaliMonthToDateRange,
};

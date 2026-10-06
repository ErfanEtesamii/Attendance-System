// wrapper سازگاری (S3-2c): محاسبه‌ی روز کاری به src/engine/computeDay.js و src/engine/dayService.js منتقل شد.
// این فایل حذف نشده تا هر require قدیمی همچنان کار کند؛ summarizeRecord/summarizeRange فقط به dayService ارجاع می‌دهند
// (همان شکل خروجی قبلی). کد جدید مستقیم از dayService استفاده کند. منطق قدیمی (برای تست تطبیق) در
// test/fixtures/legacyWorkHours.js منجمد شده است.
// ماندگار: formatMinutes (قالب نمایش) و timeStringToMinutes (پارسر ساده‌ی HH:MM).

const dayService = require('../engine/dayService');
const timeUtil = require('./time');

function timeStringToMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// ⚠️ تغییر نسبت به قبل: دقیقه‌ی ساعت دیواریِ «شرکت» (timezone تنظیمات) می‌دهد، نه ساعت سیستم‌عامل.
function minutesSinceMidnight(date) {
  return timeUtil.minutesSinceMidnight(date);
}

function formatMinutes(totalMinutes) {
  const sign = totalMinutes < 0 ? '-' : '';
  const abs = Math.abs(Math.round(totalMinutes));
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${h} ساعت و ${m} دقیقه`;
}

function summarizeRecord(record) {
  return dayService.summarizeRecord(record);
}

function summarizeRange(records) {
  return dayService.summarizeRange(records);
}

module.exports = {
  timeStringToMinutes,
  minutesSinceMidnight,
  formatMinutes,
  summarizeRecord,
  summarizeRange,
};

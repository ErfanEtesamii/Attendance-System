// محاسبات سبک ساعت کاری، فقط برای مصرف بات (گزارش‌ها/یادآوری‌ها) در فاز ۳.
// ⚠️ این ماژول موقتی است: موتور محاسبه رسمی و کامل طبق سند در فاز ۵ ساخته می‌شود
// و همان زمان جایگزین/تکمیل این فایل خواهد شد. منطق تشخیص تأخیر/زودتر رفتن اینجا
// عمداً ساده نگه داشته شده تا فقط برای گزارش‌دهی و یادآوری در فاز ۳ کافی باشد.

const settingsRepository = require('../repositories/settingsRepository');
const breakRepository = require('../repositories/breakRepository');

function timeStringToMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function formatMinutes(totalMinutes) {
  const sign = totalMinutes < 0 ? '-' : '';
  const abs = Math.abs(Math.round(totalMinutes));
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${h} ساعت و ${m} دقیقه`;
}

// خلاصه یک رکورد روزانه: دقیقه مفید کاری، تأخیر، زودتر رفتن، اضافه‌کاری.
// اگر هنوز خروج ثبت نشده، effectiveMinutes تا همین لحظه (زمان سرور) محاسبه می‌شود.
function summarizeRecord(record) {
  const result = {
    effectiveMinutes: null,
    lateMinutes: 0,
    earlyLeaveMinutes: 0,
    overtimeMinutes: 0,
    isOpen: false,
  };

  if (!record || !record.check_in_time) return result;

  const checkIn = new Date(record.check_in_time);
  const checkOut = record.check_out_time ? new Date(record.check_out_time) : null;
  const breakMinutes = breakRepository.totalBreakMinutes(record.id);

  const settings = settingsRepository.getAll();
  const workStart = timeStringToMinutes(settings.workDayStart);
  const workEnd = timeStringToMinutes(settings.workDayEnd);
  const checkInMinutes = minutesSinceMidnight(checkIn);

  if (checkInMinutes > workStart) {
    result.lateMinutes = checkInMinutes - workStart;
  }

  const endForCalc = checkOut || new Date();
  result.isOpen = !checkOut;
  const grossMinutes = Math.max(0, (endForCalc.getTime() - checkIn.getTime()) / 60000);
  result.effectiveMinutes = Math.max(0, Math.round(grossMinutes - breakMinutes));

  if (checkOut) {
    const checkOutMinutes = minutesSinceMidnight(checkOut);
    if (checkOutMinutes < workEnd) {
      result.earlyLeaveMinutes = workEnd - checkOutMinutes;
    } else {
      result.overtimeMinutes = checkOutMinutes - workEnd;
    }
  }

  return result;
}

// جمع‌بندی چند رکورد (برای /report و /team_report)
function summarizeRange(records) {
  let totalEffective = 0;
  let lateCount = 0;
  let earlyLeaveCount = 0;
  let incompleteCount = 0;

  for (const record of records) {
    const summary = summarizeRecord(record);
    if (summary.effectiveMinutes) totalEffective += summary.effectiveMinutes;
    if (summary.lateMinutes > 0) lateCount += 1;
    if (summary.earlyLeaveMinutes > 0) earlyLeaveCount += 1;
    if (record.status === 'incomplete') incompleteCount += 1;
  }

  return { totalEffective, lateCount, earlyLeaveCount, incompleteCount, dayCount: records.length };
}

module.exports = {
  timeStringToMinutes,
  minutesSinceMidnight,
  formatMinutes,
  summarizeRecord,
  summarizeRange,
};

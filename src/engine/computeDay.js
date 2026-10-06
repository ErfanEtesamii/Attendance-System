// S3-2b: موتور خالص محاسبه‌ی یک روز کاری.
// computeDay({ record, breaks, settings, now, timezone }) دقیقاً همان منطق فعلی workHours.summarizeRecord را می‌دهد
// (بدون تغییر عددی)، با این تفاوت که «ساعت دیواری» با timezone صریح (src/utils/time.js) حساب می‌شود، نه ساعت سیستم‌عامل.
//
// خالص است: هیچ دسترسی به DB/repository/settings/ساعت سیستم ندارد (now و timezone ورودی‌اند) و ورودی‌ها را تغییر نمی‌دهد.
// هنوز هیچ مصرف‌کننده‌ای به این فایل وصل نیست (مهاجرت در S3-2c؛ تطبیق با workHours قدیمی در S3-2d).
//
// ورودی:
//   record   : ردیف attendance_records (check_in_time/check_out_time به‌صورت ISO UTC و status) یا null
//   breaks   : ردیف‌های break_records ({ start_time, end_time })؛ فقط استراحت‌های «بسته‌شده» حساب می‌شوند (مثل قبل)
//   settings : { workDayStart, workDayEnd } با قالب HH:MM؛ اختیاری (S3-3a): lateGraceMinutes (عدد ≥ ۰، پیش‌فرض ۰)،
//              lateCountsFrom ('shift_start' | 'after_grace'، پیش‌فرض 'shift_start')؛ (S3-3b) earlyGraceMinutes (عدد ≥ ۰، پیش‌فرض ۰)
//   now      : لحظه‌ی «الان» برای رکورد باز (Date یا ISO)؛ پیش‌فرض new Date()
//   timezone : نام IANA؛ پیش‌فرض Asia/Tehran
// خروجی (همه دقیقه، عدد صحیح مگر null):
//   expected    : طول روز کاری رسمی = پایان − شروع (حداقل ۰)
//   workedGross : مدت بین ورود و خروج (یا now برای رکورد باز)، گرد شده؛ بدون ورود ⇒ null
//   break       : مجموع استراحت‌های بسته‌شده (جمع میلی‌ثانیه‌ها، سپس گرد)
//   effective   : max(0, round(workedGross خام − break))؛ بدون ورود ⇒ null
//   late        : تأخیر ورود. ورود تا «شروع + مهلت» (شامل خودِ مرز) ⇒ ۰؛ بعد از آن: shift_start ⇒ ورود − شروع (کل تأخیر)،
//                 after_grace ⇒ ورود − (شروع + مهلت). مهلت ۰ (پیش‌فرض) ⇒ هر دو حالت دقیقاً مثل قبل
//   earlyLeave  : زودتر رفتن. خروج تا «پایان − مهلت» (شامل خودِ مرز) ⇒ ۰؛ زودتر از آن ⇒ پایان − خروج (کل دقیقه‌ها، نه فقط مازاد بر مهلت).
//                 مهلت ۰ (پیش‌فرض) ⇒ دقیقاً مثل قبل
//   overtime    : خروج از پایان کار به بعد (خروج دقیقاً روی پایان ⇒ ۰). خروج داخل مهلت (پیش از پایان) نه زودتر رفتن است نه اضافه‌کاری
//   isOpen      : ورود دارد ولی خروج ندارد
//   flags       : فعلاً همیشه [] (پرچم‌ها و داده‌ی خراب در S3-4b)
//   status      : status ذخیره‌شده‌ی رکورد (normal|late|incomplete|leave|holiday) بدون تغییر؛ بدون رکورد null
// ورودی نامعتبر (زمان خراب، settings ناقص/نامعتبر، timezone ناشناخته) ⇒ RangeError/TypeError.
//
// ⚠️ رفتار موروثی عمداً حفظ شده: late/earlyLeave/overtime فقط بر پایه‌ی «دقیقه‌ی ساعت دیواری» است و تاریخ را نمی‌بیند
// (خروج بعد از نیمه‌شب مثل قبل «زودتر رفتن» حساب می‌شود؛ شیفت شب در S3-6c).

const { DEFAULT_TIMEZONE, normalizeTimezone, minutesSinceMidnight } = require('../utils/time');

const LATE_COUNTS_FROM = ['shift_start', 'after_grace'];

// مهلت (دقیقه): نبودن ⇒ ۰؛ باید عدد متناهی ≥ ۰ باشد
function graceMinutes(value, name) {
  const v = value === undefined ? 0 : value;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new RangeError(`settings.${name} باید عدد ≥ ۰ باشد.`);
  return v;
}

function hhmmToMinutes(value, name) {
  const m = typeof value === 'string' ? /^\s*(\d{1,2}):(\d{2})\s*$/.exec(value) : null;
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new RangeError(`settings.${name} باید HH:MM معتبر باشد.`);
  return Number(m[1]) * 60 + Number(m[2]);
}

function toDate(value, name) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) throw new RangeError(`${name} زمان معتبر نیست.`);
  return d;
}

// مجموع استراحت‌های بسته‌شده: مثل breakRepository.totalBreakMinutes (جمع ms سپس گرد؛ بدون clamp)
function sumBreakMinutes(breaks) {
  let totalMs = 0;
  for (const b of breaks || []) {
    if (b && b.end_time) totalMs += toDate(b.end_time, 'break.end_time').getTime() - toDate(b.start_time, 'break.start_time').getTime();
  }
  return Math.round(totalMs / 60000);
}

function computeDay({ record, breaks, settings, now, timezone } = {}) {
  if (!settings || typeof settings !== 'object') throw new TypeError('settings الزامی است.');
  const workStart = hhmmToMinutes(settings.workDayStart, 'workDayStart');
  const workEnd = hhmmToMinutes(settings.workDayEnd, 'workDayEnd');
  const lateGrace = graceMinutes(settings.lateGraceMinutes, 'lateGraceMinutes');
  const earlyGrace = graceMinutes(settings.earlyGraceMinutes, 'earlyGraceMinutes');
  const lateCountsFrom = settings.lateCountsFrom === undefined ? 'shift_start' : settings.lateCountsFrom;
  if (!LATE_COUNTS_FROM.includes(lateCountsFrom)) throw new RangeError(`settings.lateCountsFrom باید یکی از ${LATE_COUNTS_FROM.join('، ')} باشد.`);
  const tz = timezone === undefined ? DEFAULT_TIMEZONE : normalizeTimezone(timezone);
  if (!tz) throw new RangeError('timezone نامعتبر است.');

  const result = {
    expected: Math.max(0, workEnd - workStart),
    workedGross: null,
    break: 0,
    effective: null,
    late: 0,
    earlyLeave: 0,
    overtime: 0,
    isOpen: false,
    flags: [],
    status: record && record.status !== undefined ? record.status : null,
  };

  result.break = sumBreakMinutes(breaks);
  if (!record || !record.check_in_time) return result;

  const checkIn = toDate(record.check_in_time, 'check_in_time');
  const checkOut = record.check_out_time ? toDate(record.check_out_time, 'check_out_time') : null;

  const checkInMinutes = minutesSinceMidnight(checkIn, tz);
  const lateLine = workStart + lateGrace; // تا خودِ این لحظه تأخیر نیست
  if (checkInMinutes > lateLine) result.late = checkInMinutes - (lateCountsFrom === 'after_grace' ? lateLine : workStart);

  const end = checkOut || (now === undefined ? new Date() : toDate(now, 'now'));
  result.isOpen = !checkOut;
  const gross = Math.max(0, (end.getTime() - checkIn.getTime()) / 60000);
  result.workedGross = Math.round(gross);
  result.effective = Math.max(0, Math.round(gross - result.break));

  if (checkOut) {
    const checkOutMinutes = minutesSinceMidnight(checkOut, tz);
    if (checkOutMinutes < workEnd) {
      if (checkOutMinutes < workEnd - earlyGrace) result.earlyLeave = workEnd - checkOutMinutes; // تا خودِ «پایان − مهلت» زودتر رفتن نیست
    } else {
      result.overtime = checkOutMinutes - workEnd;
    }
  }
  return result;
}

module.exports = { computeDay, hhmmToMinutes, sumBreakMinutes };

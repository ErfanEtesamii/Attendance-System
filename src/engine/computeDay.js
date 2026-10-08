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
//              lateCountsFrom ('shift_start' | 'after_grace'، پیش‌فرض 'shift_start')؛ (S3-3b) earlyGraceMinutes (عدد ≥ ۰، پیش‌فرض ۰)؛
//              (S3-4a) maxLunchMinutes (حداکثر ناهار مجاز؛ عدد ≥ ۰، پیش‌فرض ۰ = بدون سقف)،
//              fixedLunchDeductMinutes (کسر ثابت ناهار وقتی ناهار ثبت نشده؛ عدد ≥ ۰، پیش‌فرض ۰ = خاموش)؛
//              (S3-4b) longOpenBreakMinutes (آستانه‌ی استراحتِ بازِ طولانی؛ عدد > ۰، پیش‌فرض ۱۲۰)،
//              outsideShiftMarginMinutes (حاشیه‌ی مجاز ورود/خروج دور از شیفت؛ عدد ≥ ۰، پیش‌فرض ۱۲۰)؛
//              (S3-5a) اضافه‌کاری قابل‌پرداخت: overtimeEnabled (boolean، پیش‌فرض false)، overtimeMinMinutes (حداقل آستانه، ≥ ۰، پیش‌فرض ۰)،
//              overtimeDailyCapMinutes (سقف روزانه، ≥ ۰، پیش‌فرض ۰ = بدون سقف)، overtimeFactor / overtimeHolidayFactor (ضریب، ≥ ۰، پیش‌فرض ۱)،
//              overtimeRoundStep (گام گرد‌کردن به دقیقه، > ۰، پیش‌فرض ۱)، overtimeRounding ('down' | 'nearest' | 'up'، پیش‌فرض 'down')
//   shift    : (S3-6b) اختیاری؛ شیفت کاربر به شکل خروجی shiftsRepository ({ startTime, endTime, graceLateMinutes, graceEarlyMinutes,
//              overnight, maxLunchMinutes, fixedLunchDeductMinutes, ... }). null/undefined ⇒ «شیفت پیش‌فرض» = همان settings (رفتار قبلی، بدون تغییر).
//              با شیفت، این شش مقدار از شیفت می‌آیند و جایگزین (نه جمع با) تنظیمات سراسری می‌شوند: شروع/پایان (workDayStart/End)،
//              مهلت تأخیر/زودتر رفتن (lateGraceMinutes/earlyGraceMinutes) و قاعده‌ی ناهار (maxLunchMinutes/fixedLunchDeductMinutes)؛ ۰ در شیفت
//              یعنی «خاموش/بدون مهلت»، نه «از تنظیمات بگیر». بقیه‌ی تنظیمات (lateCountsFrom، اضافه‌کاری، آستانه‌ها، حاشیه‌ی خارج از شیفت) سراسری می‌مانند.
//              شیفت ناسازگار (overnight با پایان ≥ شروع، یا پایان < شروع بدون overnight، ساعت نامعتبر) ⇒ RangeError.
//   calendar : (S3-7c) اختیاری؛ خروجی getCalendarDay همان روز ({ isWorkingDay, kind, expectedEnd, ... }). null/undefined ⇒ رفتار قبلی (بدون تقویم).
//              فقط سه چیز را عوض می‌کند (بقیه‌ی قواعد دست‌نخورده):
//              • روز کاری نیم‌روز (kind='half' و شیفت غیرشب): پایانِ مؤثر = calendar.expectedEnd (در صورتی که بین شروع و پایان عادی باشد، وگرنه نادیده)؛
//                پس expected کوتاه‌تر می‌شود و زودتر رفتن/اضافه‌کاری نسبت به همین پایان سنجیده می‌شود.
//              • روز غیرکاری (isWorkingDay=false: آخر هفته، تعطیلی کامل، روز غیرکاری شیفت): expected = ۰، late = ۰، earlyLeave = ۰ و «کل کار» اضافه‌کاری است:
//                overtime = workedGross (برای رکورد بسته‌شده؛ مثل اضافه‌کاری عادی استراحت از آن کم نمی‌شود). ضریب اضافه‌کاری = overtimeHolidayFactor.
//                پرچم outside_shift برای چنین روزی داده نمی‌شود (پنجره‌ی کاری وجود ندارد).
//              • calendar.isWorkingDay باید boolean باشد (وگرنه RangeError)؛ ساخت calendar با خود فراخواننده است (dayService.computeRecordDay).
//   approvedLeaves : (S4-8b-1) اختیاری؛ آرایه‌ی پنجره‌های مرخصی/مأموریتِ «تأییدشده‌ی همین روز» به شکل [{ start, end }] بر پایه‌ی همان «دقیقه از نیمه‌شب»
//              که شروع/پایان کار با آن حساب می‌شود (شیفت شب: روز بعد = ۱۴۴۰+). ساخت پنجره‌ها با فراخواننده است (leaveUnits.leaveWindowsOnDate)؛ موتور DB نمی‌خواند.
//              null/undefined/[] ⇒ رفتار قبلی بدون هیچ تغییر. هر پنجره به [شروع، پایانِ] روز بریده و پنجره‌های هم‌پوشان/چسبیده ادغام می‌شوند (دوبار شمرده نمی‌شوند).
//              • expected = (پایان − شروع) − مجموع پنجره‌ها (حداقل ۰)؛ روز غیرکاری همچنان ۰ است و پنجره در آن بی‌اثر است.
//              • «شروعِ مؤثر» = شروع کار پس از رد شدن از پنجره‌های چسبیده به آن (مرخصی صبح/ساعتیِ اول وقت)؛ «پایانِ مؤثر» به همین ترتیب از انتها.
//                late از شروعِ مؤثر (و مهلت از همان) سنجیده می‌شود و دقیقه‌های داخل هر پنجره‌ی مرخصی از آن کم می‌شود؛ earlyLeave نسبت به پایانِ مؤثر سنجیده می‌شود
//                و دقیقه‌های داخل پنجره از آن کم می‌شود. خروج داخل پنجره‌ی انتهاییِ مرخصی (پیش از پایان کار، پس از پایانِ مؤثر) نه زودتر رفتن است نه اضافه‌کاری.
//              • روز کاملاً در مرخصی (مجموع پنجره‌ها ≥ طول روز) ⇒ expected = ۰، late = ۰، earlyLeave = ۰. overtime (خروج پس از پایانِ کار) و پرچم‌ها بدون تغییر می‌مانند.
//              • پنجره‌ی نامعتبر (غیر شیء، start/end غیرعدد/غیرمتناهی، start < ۰ یا end ≤ start) ⇒ RangeError.
//   now      : لحظه‌ی «الان» برای رکورد باز (Date یا ISO)؛ پیش‌فرض new Date()
//   timezone : نام IANA؛ پیش‌فرض Asia/Tehran
// خروجی (همه دقیقه، عدد صحیح مگر null):
//   expected    : طول روز کاری رسمی = پایان − شروع (حداقل ۰)
//   workedGross : مدت بین ورود و خروج (یا now برای رکورد باز)، گرد شده؛ بدون ورود ⇒ null
//   break       : مجموع استراحت‌های بسته‌شده (همه‌ی نوع‌ها؛ جمع میلی‌ثانیه‌ها، سپس گرد) + breakAuto (کسر ثابت ناهار، پایین)
//   breakAuto   : (S3-4a) کسر ثابت ناهار برای روزی که «ناهار ثبت نشده». فقط وقتی fixedLunchDeductMinutes > ۰، رکورد خروج دارد
//                 (رکورد باز هنوز به ناهار نرسیده فرض می‌شود) و هیچ ردیف استراحتی از نوع lunch (بسته یا باز) ندارد. مقدار =
//                 min(کسر ثابت، workedGross) تا استراحت از مدت کار بیشتر نشود. استراحت کوتاه (short_break) «ناهار ثبت‌شده» نیست
//   breakExcess : (S3-4a) مازاد ناهارِ ثبت‌شده بر maxLunchMinutes = max(0، جمع ناهارهای بسته‌شده − سقف)؛ سقف ۰ ⇒ ۰. فقط اطلاعاتی است:
//                 مازاد همچنان از ساعت مفید کم می‌شود (زمان واقعاً بیرون بوده)؛ پرچم‌گذاری آن در S3-4b. استراحت کوتاه شامل سقف نیست
//   effective   : max(0, round(workedGross خام − break))؛ بدون ورود ⇒ null
//   late        : تأخیر ورود. ورود تا «شروع + مهلت» (شامل خودِ مرز) ⇒ ۰؛ بعد از آن: shift_start ⇒ ورود − شروع (کل تأخیر)،
//                 after_grace ⇒ ورود − (شروع + مهلت). مهلت ۰ (پیش‌فرض) ⇒ هر دو حالت دقیقاً مثل قبل
//   earlyLeave  : زودتر رفتن. خروج تا «پایان − مهلت» (شامل خودِ مرز) ⇒ ۰؛ زودتر از آن ⇒ پایان − خروج (کل دقیقه‌ها، نه فقط مازاد بر مهلت).
//                 مهلت ۰ (پیش‌فرض) ⇒ دقیقاً مثل قبل
//   overtime    : خروج از پایان کار به بعد (خروج دقیقاً روی پایان ⇒ ۰). خروج داخل مهلت (پیش از پایان) نه زودتر رفتن است نه اضافه‌کاری
//   overtimePayable : (S3-5a) اضافه‌کاری قابل‌پرداخت (دقیقه‌ی معادل، عدد صحیح). overtimeEnabled=false (پیش‌فرض) ⇒ ۰ و `overtime` خام دست‌نخورده.
//                 مراحل: overtime خام ⇒ زیر حداقل آستانه ۰ (روی آستانه و بالاتر: کامل) ⇒ برش با سقف روزانه ⇒ گرد‌کردن به گام (down/nearest/up؛
//                 nearest نیم‌گام را به بالا) ⇒ ضرب در ضریب (رکورد با status = holiday: overtimeHolidayFactor، وگرنه overtimeFactor) و گرد به عدد صحیح.
//                 رکورد با خروج پیش از ورود یا زمان خراب ⇒ ۰. در روز غیرکاری (calendar، S3-7c) `overtime` خام = کل مدت کار و ضریب همیشه overtimeHolidayFactor است
//   isOpen      : ورود دارد ولی خروج ندارد
//   flags       : (S3-4b) آرایه‌ی کدهای هشدار، به این ترتیب ثابت و بدون تکرار؛ هرگز exception نمی‌دهند و اعداد را عوض نمی‌کنند (جز invalid_time):
//                 invalid_time            زمان رکورد/استراحت قابل‌خواندن نیست. زمان خراب رکورد ⇒ هیچ عددی محاسبه نمی‌شود (workedGross/effective = null،
//                                         late/earlyLeave/overtime = ۰، isOpen = false)؛ استراحتِ خراب نادیده گرفته می‌شود
//                 checkout_before_checkin خروج پیش از ورود (ساعت مفید ۰ می‌ماند، مثل قبل)
//                 missing_checkout        ورود بدون خروج وقتی روز تمام شده: status = incomplete (autoCloseIncomplete) یا روز ورود (به وقت شرکت) قبل از «امروز» است
//                 long_open_break         استراحتِ بسته‌نشده بیش از longOpenBreakMinutes (تا خروج، یا now برای رکورد باز) طول کشیده
//                 break_outside_range     استراحت پیش از ورود، پس از خروج، یا پایانش پیش از شروعش است (عدد استراحت مثل قبل حساب می‌شود)
//                 outside_shift           ورود یا خروج بیش از outsideShiftMarginMinutes بیرون از [شروع، پایان] کار، یا خروج در روزی غیر از روز ورود
//   status      : status ذخیره‌شده‌ی رکورد (normal|late|incomplete|leave|holiday) بدون تغییر؛ بدون رکورد null
// ورودی نامعتبر (زمان خراب، settings ناقص/نامعتبر، timezone ناشناخته) ⇒ RangeError/TypeError.
//
// ⚠️ رفتار موروثی عمداً حفظ شده (روز/شیفت عادی): late/earlyLeave/overtime فقط بر پایه‌ی «دقیقه‌ی ساعت دیواری» است و تاریخ را نمی‌بیند
// (خروج بعد از نیمه‌شب «زودتر رفتن» حساب می‌شود).
//
// شیفت شب (S3-6c؛ فقط وقتی shift.overnight=true و پایان < شروع): record.record_date = روزِ شروع شیفت (به وقت شرکت) و همه‌ی زمان‌ها به
// «دقیقه از نیمه‌شبِ record_date» تبدیل می‌شوند (روز بعد = ۱۴۴۰ + دقیقه)؛ پس پایان = پایان + ۱۴۴۰ و expected = ۱۴۴۰ − شروع + پایان.
// ورود پیش از شروع (مثلاً ۲۱:۳۰ برای شیفت ۲۲:۰۰) تأخیر نیست؛ ورود ۰۰:۳۰ روز بعد ۱۵۰ دقیقه تأخیر است؛ خروج ۰۶:۱۰ روز بعد برای پایان ۰۶:۰۰
// ۱۰ دقیقه اضافه‌کاری است. بدون record_date معتبر، تاریخ ورود مبنا می‌شود. پرچم‌ها هم روی همین مبنا سنجیده می‌شوند: outside_shift با دقیقه‌ی
// نسبت‌به‌روزِ شروع (بدون شرط «خروج در روز دیگر» که برای شیفت شب عادی است)، و missing_checkout وقتی «پایان + حاشیه» گذشته (نه عوض‌شدن تاریخ تقویمی).

const { DEFAULT_TIMEZONE, normalizeTimezone, minutesSinceMidnight, formatDate } = require('../utils/time');
const { dayNumber, dayDiff } = require('../utils/shiftDay');

const LATE_COUNTS_FROM = ['shift_start', 'after_grace'];
const OVERTIME_ROUNDING = ['down', 'nearest', 'up'];
const FLAG_ORDER = ['invalid_time', 'checkout_before_checkin', 'missing_checkout', 'long_open_break', 'break_outside_range', 'outside_shift'];
const DEFAULT_LONG_OPEN_BREAK = 120;
const DEFAULT_OUTSIDE_SHIFT_MARGIN = 120;

// مهلت (دقیقه): نبودن ⇒ ۰؛ باید عدد متناهی ≥ ۰ باشد
function graceMinutes(value, name, prefix = 'settings.') {
  const v = value === undefined ? 0 : value;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new RangeError(`${prefix}${name} باید عدد ≥ ۰ باشد.`);
  return v;
}

function hhmmToMinutes(value, name, prefix = 'settings.') {
  const m = typeof value === 'string' ? /^\s*(\d{1,2}):(\d{2})\s*$/.exec(value) : null;
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new RangeError(`${prefix}${name} باید HH:MM معتبر باشد.`);
  return Number(m[1]) * 60 + Number(m[2]);
}

// پارامترهای مؤثرِ روز (S3-6b): shift خالی ⇒ تنظیمات سراسری (رفتار قبلی)؛ وگرنه شش مقدار از شیفت (در کامنت سرفایل).
// خروجی: { workStart, workEnd, lateGrace, earlyGrace, maxLunch, fixedLunch, overnight } — برای شیفت شب workEnd = پایان + ۱۴۴۰.
function resolveShiftParams(settings, shift) {
  if (shift === null || shift === undefined) {
    return {
      workStart: hhmmToMinutes(settings.workDayStart, 'workDayStart'),
      workEnd: hhmmToMinutes(settings.workDayEnd, 'workDayEnd'),
      lateGrace: graceMinutes(settings.lateGraceMinutes, 'lateGraceMinutes'),
      earlyGrace: graceMinutes(settings.earlyGraceMinutes, 'earlyGraceMinutes'),
      maxLunch: graceMinutes(settings.maxLunchMinutes, 'maxLunchMinutes'),
      fixedLunch: graceMinutes(settings.fixedLunchDeductMinutes, 'fixedLunchDeductMinutes'),
      overnight: false,
    };
  }
  if (typeof shift !== 'object') throw new TypeError('shift باید شیء یا null باشد.');
  const start = hhmmToMinutes(shift.startTime, 'startTime', 'shift.');
  const end = hhmmToMinutes(shift.endTime, 'endTime', 'shift.');
  if (shift.overnight !== undefined && typeof shift.overnight !== 'boolean') throw new RangeError('shift.overnight باید boolean باشد.');
  const overnight = shift.overnight === true;
  if (overnight && end >= start) throw new RangeError('shift.overnight فقط با پایان پیش از شروع معنا دارد.');
  if (!overnight && end < start) throw new RangeError('shift: پایان پیش از شروع بدون overnight نامعتبر است.');
  return {
    workStart: start,
    workEnd: overnight ? end + 1440 : end,
    lateGrace: graceMinutes(shift.graceLateMinutes, 'graceLateMinutes', 'shift.'),
    earlyGrace: graceMinutes(shift.graceEarlyMinutes, 'graceEarlyMinutes', 'shift.'),
    maxLunch: graceMinutes(shift.maxLunchMinutes, 'maxLunchMinutes', 'shift.'),
    fixedLunch: graceMinutes(shift.fixedLunchDeductMinutes, 'fixedLunchDeductMinutes', 'shift.'),
    overnight,
  };
}

function toDate(value, name) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) throw new RangeError(`${name} زمان معتبر نیست.`);
  return d;
}

// آستانه: نبودن ⇒ پیش‌فرض؛ باید عدد متناهی ≥ min باشد
function thresholdMinutes(value, name, dflt, min) {
  const v = value === undefined ? dflt : value;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min) throw new RangeError(`settings.${name} باید عدد ≥ ${min} باشد.`);
  return v;
}

// ضریب: نبودن ⇒ ۱؛ باید عدد متناهی ≥ ۰ باشد (اعشار مجاز)
function factorValue(value, name) {
  const v = value === undefined ? 1 : value;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new RangeError(`settings.${name} باید عدد ≥ ۰ باشد.`);
  return v;
}

// اضافه‌کاری قابل‌پرداخت از روی اضافه‌کاری خام (دقیقه). ترتیب مراحل در کامنت سرفایل
function payableOvertime(raw, ot, factor) {
  if (!ot.enabled || raw <= 0 || raw < ot.minMinutes) return 0;
  const capped = ot.dailyCap > 0 ? Math.min(raw, ot.dailyCap) : raw;
  const q = capped / ot.step;
  const steps = ot.rounding === 'up' ? Math.ceil(q) : ot.rounding === 'nearest' ? Math.floor(q + 0.5) : Math.floor(q);
  return Math.round(steps * ot.step * factor);
}

// نوع استراحت: ردیف بدون break_type مثل پیش‌فرض ستون/repository ناهار حساب می‌شود (فقط 'short_break' کوتاه است)
const isLunch = (b) => !(b && b.break_type === 'short_break');

// خواندن تحمل‌پذیر استراحت‌ها (S3-4b): استراحت با زمان نامعتبر نادیده گرفته و invalid=true می‌شود (exception نه).
// هر آیتم: { lunch, startMs, endMs } (endMs = null برای استراحت باز)
function readBreaks(breaks) {
  const items = [];
  let invalid = false;
  for (const b of breaks || []) {
    if (!b) continue;
    const startMs = new Date(b.start_time).getTime();
    const endMs = b.end_time ? new Date(b.end_time).getTime() : null;
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) { invalid = true; continue; }
    items.push({ lunch: isLunch(b), startMs, endMs });
  }
  return { items, invalid };
}

// مجموع استراحت‌های بسته‌شده: مثل breakRepository.totalBreakMinutes (جمع ms سپس گرد؛ بدون clamp).
// onlyLunch ⇒ فقط ناهارها (برای سقف ناهار S3-4a)
function sumItems(items, { onlyLunch = false } = {}) {
  let totalMs = 0;
  for (const b of items) {
    if (b.endMs === null || (onlyLunch && !b.lunch)) continue;
    totalMs += b.endMs - b.startMs;
  }
  return Math.round(totalMs / 60000);
}

// نسخه‌ی سازگار با قبل (خروجی صادرشده)؛ اکنون استراحت خراب را نادیده می‌گیرد
function sumBreakMinutes(breaks, opts) {
  return sumItems(readBreaks(breaks).items, opts);
}

// پنجره‌های مرخصی (S4-8b-1): اعتبارسنجی، برش به [workStart, workEnd]، مرتب‌سازی و ادغام هم‌پوشان/چسبیده. ورودی تغییر نمی‌کند.
// پنجره‌ی کاملاً بیرون از بازه حذف می‌شود (نه خطا). خروجی: آرایه‌ی [{ start, end }] مرتب و بدون هم‌پوشانی.
function normalizeLeaveWindows(approvedLeaves, workStart, workEnd) {
  if (approvedLeaves === undefined || approvedLeaves === null) return [];
  if (!Array.isArray(approvedLeaves)) throw new TypeError('approvedLeaves باید آرایه یا null باشد.');
  const clipped = [];
  for (const w of approvedLeaves) {
    if (!w || typeof w !== 'object') throw new RangeError('approvedLeaves: هر پنجره باید شیء { start, end } باشد.');
    if (typeof w.start !== 'number' || typeof w.end !== 'number' || !Number.isFinite(w.start) || !Number.isFinite(w.end) || w.start < 0 || w.end <= w.start) {
      throw new RangeError('approvedLeaves: start و end باید عدد متناهی با 0 ≤ start < end باشند.');
    }
    const start = Math.max(w.start, workStart);
    const end = Math.min(w.end, workEnd);
    if (end > start) clipped.push({ start, end });
  }
  clipped.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged = [];
  for (const w of clipped) {
    const last = merged[merged.length - 1];
    if (last && w.start <= last.end) last.end = Math.max(last.end, w.end);
    else merged.push({ ...w });
  }
  return merged;
}

function computeDay({ record, breaks, settings, now, timezone, shift, calendar, approvedLeaves } = {}) {
  if (!settings || typeof settings !== 'object') throw new TypeError('settings الزامی است.');
  const params = resolveShiftParams(settings, shift);
  const { workStart, lateGrace, earlyGrace, maxLunch, fixedLunch, overnight } = params;
  let { workEnd } = params;
  // تقویم روز (S3-7c): روز غیرکاری یا پایانِ نیم‌روز. بدون calendar همه‌چیز مثل قبل
  let dayOff = false;
  if (calendar !== undefined && calendar !== null) {
    if (typeof calendar !== 'object') throw new TypeError('calendar باید شیء یا null باشد.');
    if (typeof calendar.isWorkingDay !== 'boolean') throw new RangeError('calendar.isWorkingDay باید boolean باشد.');
    dayOff = !calendar.isWorkingDay;
    if (!dayOff && calendar.kind === 'half' && !overnight) {
      const halfEnd = typeof calendar.expectedEnd === 'string' ? /^\s*(\d{1,2}):(\d{2})\s*$/.exec(calendar.expectedEnd) : null;
      const halfEndMin = halfEnd && Number(halfEnd[1]) <= 23 && Number(halfEnd[2]) <= 59 ? Number(halfEnd[1]) * 60 + Number(halfEnd[2]) : null;
      if (halfEndMin !== null && halfEndMin > workStart && halfEndMin < workEnd) workEnd = halfEndMin; // نامعتبر/بیرون از بازه ⇒ روز کامل (مثل calendarService)
    }
  }
  // مرخصی تأییدشده (S4-8b-1): پنجره‌ها پس از اعمال پایانِ نیم‌روز بریده می‌شوند؛ روز غیرکاری ⇒ بی‌اثر. بدون پنجره ⇒ effStart/effEnd = شروع/پایان کار (رفتار قبلی)
  const leaves = normalizeLeaveWindows(approvedLeaves, workStart, workEnd);
  const leaveTotal = dayOff ? 0 : leaves.reduce((t, w) => t + (w.end - w.start), 0);
  const fullyOnLeave = leaveTotal > 0 && leaveTotal >= workEnd - workStart;
  let effStart = workStart;
  let effEnd = workEnd;
  if (!dayOff) {
    for (const w of leaves) if (w.start <= effStart) effStart = Math.max(effStart, w.end);
    for (let i = leaves.length - 1; i >= 0; i -= 1) if (leaves[i].end >= effEnd) effEnd = Math.min(effEnd, leaves[i].start);
  }
  const leaveOverlap = (a, b) => (dayOff ? 0 : leaves.reduce((t, w) => t + Math.max(0, Math.min(w.end, b) - Math.max(w.start, a)), 0));
  if (settings.overtimeEnabled !== undefined && typeof settings.overtimeEnabled !== 'boolean') throw new RangeError('settings.overtimeEnabled باید boolean باشد.');
  const overtimeRounding = settings.overtimeRounding === undefined ? 'down' : settings.overtimeRounding;
  if (!OVERTIME_ROUNDING.includes(overtimeRounding)) throw new RangeError(`settings.overtimeRounding باید یکی از ${OVERTIME_ROUNDING.join('، ')} باشد.`);
  const ot = {
    enabled: settings.overtimeEnabled === true,
    minMinutes: graceMinutes(settings.overtimeMinMinutes, 'overtimeMinMinutes'),
    dailyCap: graceMinutes(settings.overtimeDailyCapMinutes, 'overtimeDailyCapMinutes'),
    step: thresholdMinutes(settings.overtimeRoundStep, 'overtimeRoundStep', 1, 1),
    rounding: overtimeRounding,
  };
  const overtimeFactor = factorValue(settings.overtimeFactor, 'overtimeFactor');
  const overtimeHolidayFactor = factorValue(settings.overtimeHolidayFactor, 'overtimeHolidayFactor');
  const longOpenBreak = thresholdMinutes(settings.longOpenBreakMinutes, 'longOpenBreakMinutes', DEFAULT_LONG_OPEN_BREAK, 1);
  const shiftMargin = thresholdMinutes(settings.outsideShiftMarginMinutes, 'outsideShiftMarginMinutes', DEFAULT_OUTSIDE_SHIFT_MARGIN, 0);
  const lateCountsFrom = settings.lateCountsFrom === undefined ? 'shift_start' : settings.lateCountsFrom;
  if (!LATE_COUNTS_FROM.includes(lateCountsFrom)) throw new RangeError(`settings.lateCountsFrom باید یکی از ${LATE_COUNTS_FROM.join('، ')} باشد.`);
  const tz = timezone === undefined ? DEFAULT_TIMEZONE : normalizeTimezone(timezone);
  if (!tz) throw new RangeError('timezone نامعتبر است.');

  const result = {
    expected: dayOff ? 0 : Math.max(0, workEnd - workStart - leaveTotal),
    workedGross: null,
    break: 0,
    breakAuto: 0,
    breakExcess: 0,
    effective: null,
    late: 0,
    earlyLeave: 0,
    overtime: 0,
    overtimePayable: 0,
    isOpen: false,
    flags: [],
    status: record && record.status !== undefined ? record.status : null,
  };

  const read = readBreaks(breaks);
  const flagSet = new Set();
  if (read.invalid) flagSet.add('invalid_time');
  const emit = () => { result.flags = FLAG_ORDER.filter((f) => flagSet.has(f)); return result; };

  result.break = sumItems(read.items);
  if (maxLunch > 0) result.breakExcess = Math.max(0, sumItems(read.items, { onlyLunch: true }) - maxLunch);
  if (!record || !record.check_in_time) return emit();

  // زمان خراب رکورد = داده‌ی خراب: پرچم، نه exception؛ هیچ عددی از رکورد حساب نمی‌شود
  const checkIn = new Date(record.check_in_time);
  const checkOut = record.check_out_time ? new Date(record.check_out_time) : null;
  if (Number.isNaN(checkIn.getTime()) || (checkOut && Number.isNaN(checkOut.getTime()))) {
    flagSet.add('invalid_time');
    return emit();
  }

  // مبنای زمان (S3-6c): شیفت شب ⇒ دقیقه از نیمه‌شبِ record_date (روز بعد = ۱۴۴۰+)؛ وگرنه دقیقه‌ی ساعت دیواری مثل قبل
  const refDate = overnight ? (dayNumber(record.record_date) !== null ? record.record_date : formatDate(checkIn, tz)) : null;
  const posOf = overnight ? (d) => dayDiff(formatDate(d, tz), refDate) * 1440 + minutesSinceMidnight(d, tz) : (d) => minutesSinceMidnight(d, tz);
  const checkInMinutes = posOf(checkIn);
  const lateLine = effStart + lateGrace; // تا خودِ این لحظه تأخیر نیست (بدون مرخصی effStart = workStart)
  if (!dayOff && !fullyOnLeave && checkInMinutes > lateLine) {
    const lateFrom = lateCountsFrom === 'after_grace' ? lateLine : effStart;
    result.late = Math.max(0, checkInMinutes - lateFrom - leaveOverlap(lateFrom, checkInMinutes)); // دقیقه‌های داخل پنجره‌ی مرخصی تأخیر نیست (S4-8b-1)
  }

  const end = checkOut || (now === undefined ? new Date() : toDate(now, 'now'));
  result.isOpen = !checkOut;
  // ---- پرچم‌ها (S3-4b): فقط گزارش؛ هیچ‌کدام عددی را عوض نمی‌کنند ----
  const reversed = Boolean(checkOut) && checkOut.getTime() < checkIn.getTime();
  if (reversed) flagSet.add('checkout_before_checkin');
  const dayOver = overnight ? posOf(end) > workEnd + shiftMargin : formatDate(checkIn, tz) < formatDate(end, tz); // شیفت شب: «پایان + حاشیه» گذشته
  if (!checkOut && (record.status === 'incomplete' || dayOver)) flagSet.add('missing_checkout');
  for (const b of read.items) {
    if (b.endMs === null && (end.getTime() - b.startMs) / 60000 > longOpenBreak) flagSet.add('long_open_break');
    if (reversed) continue; // بازه‌ی روز معتبر نیست؛ مقایسه‌ی استراحت بی‌معنی است
    const bEnd = b.endMs === null ? b.startMs : b.endMs;
    if (b.startMs < checkIn.getTime() || bEnd < b.startMs || (checkOut && bEnd > checkOut.getTime())) flagSet.add('break_outside_range');
  }
  const outsideMinutes = (d) => { const m = posOf(d); return m < workStart - shiftMargin || m > workEnd + shiftMargin; };
  const otherDay = !overnight && Boolean(checkOut) && formatDate(checkOut, tz) !== formatDate(checkIn, tz); // شیفت شب عمداً از نیمه‌شب رد می‌شود
  if (!dayOff && (outsideMinutes(checkIn) || (checkOut && (outsideMinutes(checkOut) || otherDay)))) flagSet.add('outside_shift');

  const gross = Math.max(0, (end.getTime() - checkIn.getTime()) / 60000);
  result.workedGross = Math.round(gross);
  // کسر ثابت ناهار: فقط روز بسته‌شده‌ای که هیچ ردیف ناهاری ندارد (استراحت کوتاه جای ناهار را نمی‌گیرد)
  if (fixedLunch > 0 && checkOut && !(breaks || []).some((b) => b && isLunch(b))) {
    result.breakAuto = Math.min(fixedLunch, result.workedGross);
    result.break += result.breakAuto;
  }
  result.effective = Math.max(0, Math.round(gross - result.break));

  if (checkOut) {
    const checkOutMinutes = posOf(checkOut);
    if (dayOff) {
      result.overtime = result.workedGross; // روز غیرکاری: کل کار اضافه‌کاری است (S3-7c)
    } else if (checkOutMinutes < workEnd) {
      if (!fullyOnLeave && checkOutMinutes < effEnd - earlyGrace) result.earlyLeave = Math.max(0, effEnd - checkOutMinutes - leaveOverlap(checkOutMinutes, effEnd)); // S4-8b-1: نسبت به پایانِ مؤثر و بدون دقیقه‌های مرخصی // تا خودِ «پایان − مهلت» زودتر رفتن نیست
    } else {
      result.overtime = checkOutMinutes - workEnd;
    }
    if (!reversed) result.overtimePayable = payableOvertime(result.overtime, ot, record.status === 'holiday' || dayOff ? overtimeHolidayFactor : overtimeFactor);
  }
  return emit();
}

module.exports = { computeDay, hhmmToMinutes, sumBreakMinutes, resolveShiftParams };

// S3-7a: تقویم کاری یک روز — «آیا این روز برای این کاربر/شیفت کاری است؟ ساعت مورد انتظار چیست؟»
// resolveCalendarDay خالص است (بدون DB)؛ getCalendarDay ورودی‌هایش را از repositoryها می‌خواند (مثل computeDay ⇄ dayService).
// هنوز هیچ مصرف‌کننده‌ای وصل نیست (اتصال به computeDay/Jobها در S3-7c)، پس رفتار فعلی سیستم تغییری نمی‌کند.
//
// قرارداد خروجی: { isWorkingDay, isHoliday, holidayTitle, expectedStart, expectedEnd, kind }
//   kind: 'working' (روز کامل) | 'half' (نیم‌روز) | 'weekend' (آخر هفته / روز غیرکاری شیفت) | 'holiday' (ردیف جدول holidays)
//   - تعطیلی ثبت‌شده در جدول holidays همیشه بر آخر هفته غالب است (isHoliday=true، holidayTitle پر)؛ عنوان تعطیلات رسمی را خودمان حدس نمی‌زنیم،
//     فقط همان‌هایی که ادمین ثبت کرده. روز تعطیل/آخر هفته ⇒ expectedStart/expectedEnd = null.
//   - روزهای کاری پایه: کاربر دارای شیفت ⇒ workDays شیفت (weekend_days نادیده)؛ بدون شیفت ⇒ همه‌ی روزها جز weekend_days.
//   - نیم‌روز: روزِ کاریِ پایه‌ای که در half_day_weekdays باشد؛ پایان = halfDayEndTime به شرطی که بین شروع و پایان عادی باشد
//     (وگرنه نادیده و روز کامل می‌ماند). شیفت شب نیم‌روز ندارد. برای شیفت، پنجشنبه فقط وقتی نیم‌روز می‌شود که در workDays شیفت باشد.
//   - dateStr = record_date میلادی (برای شیفت شب روز «شروع شیفت»). روز هفته از خود تاریخ می‌آید، نه از timezone/ساعت سیستم.
//   روزهای هفته: ۰=یکشنبه … ۶=شنبه (مثل Date#getDay و shiftsRepository).

const { dayNumber, isOvernightShift } = require('../utils/shiftDay');

// 1970-01-01 پنجشنبه (۴) بود
function weekdayOf(dateStr) {
  const dn = dayNumber(dateStr);
  if (dn === null) throw new RangeError('تاریخ نامعتبر است (YYYY-MM-DD).');
  return (((dn + 4) % 7) + 7) % 7;
}

function minutesOf(hhmm) {
  const m = typeof hhmm === 'string' ? /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim()) : null;
  return m && Number(m[1]) <= 23 && Number(m[2]) <= 59 ? Number(m[1]) * 60 + Number(m[2]) : null;
}

const pad = (n) => String(n).padStart(2, '0');
const toHhmm = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;

/**
 * @param {object} p
 * @param {string} p.dateStr 'YYYY-MM-DD'
 * @param {object|null} [p.shift] شیفت (camelCase خروجی shiftsRepository) یا null = بدون شیفت
 * @param {object} p.settings تنظیمات (workDayStart, workDayEnd, weekendDays, halfDayWeekdays, halfDayEndTime)
 * @param {{title:string}|null} [p.holiday] ردیف جدول holidays همان تاریخ
 */
function resolveCalendarDay({ dateStr, shift = null, settings, holiday = null }) {
  const weekday = weekdayOf(dateStr);
  const start = shift ? shift.startTime : settings.workDayStart;
  const end = shift ? shift.endTime : settings.workDayEnd;

  if (holiday) {
    return { isWorkingDay: false, isHoliday: true, holidayTitle: holiday.title || '', expectedStart: null, expectedEnd: null, kind: 'holiday' };
  }
  const workingWeekday = shift ? (shift.workDays || []).includes(weekday) : !(settings.weekendDays || []).includes(weekday);
  if (!workingWeekday) {
    return { isWorkingDay: false, isHoliday: false, holidayTitle: null, expectedStart: null, expectedEnd: null, kind: 'weekend' };
  }

  let kind = 'working';
  let expectedEnd = end;
  if ((settings.halfDayWeekdays || []).includes(weekday) && !isOvernightShift(shift)) {
    const s = minutesOf(start);
    const e = minutesOf(end);
    const h = minutesOf(settings.halfDayEndTime);
    if (s !== null && e !== null && h !== null && h > s && h < e) {
      kind = 'half';
      expectedEnd = toHhmm(h);
    }
  }
  return { isWorkingDay: true, isHoliday: false, holidayTitle: null, expectedStart: start, expectedEnd, kind };
}

// userOrShift: شیفت (دارای startTime)، کاربر (ردیف users؛ شیفتش با findByUserId خوانده می‌شود) یا null/undefined = تنظیمات سراسری.
// opts (برای تست/حلقه‌ها): { settings, holiday (ردیف یا null)، shift }؛ ندادن ⇒ خواندن از DB.
function getCalendarDay(userOrShift, dateStr, opts = {}) {
  const settingsRepository = require('../repositories/settingsRepository');
  const holidaysRepository = require('../repositories/holidaysRepository');
  const shiftsRepository = require('../repositories/shiftsRepository');

  let shift = null;
  if (opts.shift !== undefined) shift = opts.shift;
  else if (userOrShift && userOrShift.startTime !== undefined) shift = userOrShift;
  else if (userOrShift && userOrShift.id !== undefined) shift = shiftsRepository.findByUserId(userOrShift.id);

  const settings = opts.settings || settingsRepository.getAll();
  const holiday = opts.holiday !== undefined ? opts.holiday : holidaysRepository.findByDate(dateStr);
  return resolveCalendarDay({ dateStr, shift, settings, holiday });
}

module.exports = { getCalendarDay, resolveCalendarDay, weekdayOf };

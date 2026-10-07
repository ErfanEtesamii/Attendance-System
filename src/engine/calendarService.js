// S3-7a: تقویم کاری یک روز — «آیا این روز برای این کاربر/شیفت کاری است؟ ساعت مورد انتظار چیست؟»
// resolveCalendarDay خالص است (بدون DB)؛ getCalendarDay ورودی‌هایش را از repositoryها می‌خواند (مثل computeDay ⇄ dayService).
// هنوز هیچ مصرف‌کننده‌ای وصل نیست (اتصال به computeDay/Jobها در S3-7c)، پس رفتار فعلی سیستم تغییری نمی‌کند.
//
// قرارداد خروجی: { isWorkingDay, isHoliday, holidayTitle, expectedStart, expectedEnd, kind }
//   kind: 'working' (روز کامل) | 'half' (نیم‌روز) | 'weekend' (آخر هفته / روز غیرکاری شیفت) | 'holiday' (ردیف جدول holidays)
//   - تعطیلی کامل ثبت‌شده در جدول holidays همیشه بر آخر هفته غالب است (isHoliday=true، holidayTitle پر)؛ عنوان تعطیلات رسمی را خودمان حدس نمی‌زنیم،
//     فقط همان‌هایی که ادمین ثبت کرده. روز تعطیل/آخر هفته ⇒ expectedStart/expectedEnd = null.
//   - S3-7b — دامنه‌ی تعطیلی: ردیف scope='all' برای همه است؛ scope='department' فقط برای کاربری که department او «دقیقاً» (بعد از trim، حساس به حروف)
//     برابر است. ورودی شیفت (بدون کاربر) یا کاربر بدون department فقط ردیف‌های scope='all' را می‌بیند. اگر چند ردیف همان روز اعمال شود:
//     تعطیلی کامل بر نیم‌روز غالب است (scope='all' جلوتر)، و بین چند نیم‌روز، زودترین پایان.
//   - تعطیلی نیم‌روز (kind='half'): روزِ کاری می‌ماند (isHoliday=true، holidayTitle پر، kind='half') و پایان = half_end_time (نامعتبر/بیرون از بازه ⇒ نادیده)
//     یا زودتر از آن و پایان نیم‌روزِ هفتگی. روی آخر هفته/روز غیرکاری شیفت: isWorkingDay=false، kind='weekend' ولی isHoliday/holidayTitle پر می‌ماند.
//   - روزهای کاری پایه: کاربر دارای شیفت ⇒ workDays شیفت (weekend_days نادیده)؛ بدون شیفت ⇒ همه‌ی روزها جز weekend_days.
//   - نیم‌روز هفتگی: روزِ کاریِ پایه‌ای که در half_day_weekdays باشد؛ پایان = halfDayEndTime به شرطی که بین شروع و پایان عادی باشد
//     (وگرنه نادیده و روز کامل می‌ماند). شیفت شب نیم‌روز (هفتگی یا تعطیلی) ندارد. برای شیفت، پنجشنبه فقط وقتی نیم‌روز می‌شود که در workDays شیفت باشد.
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

// پایان نیم‌روز معتبر (دقیقه) یا null: باید بعد از شروع و قبل از پایان باشد
function halfEnd(hhmm, s, e) {
  const h = minutesOf(hhmm);
  return s !== null && e !== null && h !== null && h > s && h < e ? h : null;
}

// ردیف‌های تعطیلی یک تاریخ ⇒ ردیفِ مؤثر برای این دپارتمان (یا null). خالص.
function pickHoliday(rows, department) {
  const dep = typeof department === 'string' ? department.trim() : '';
  const applicable = (rows || []).filter((r) => r && (r.scope === undefined || r.scope === 'all' || (r.scope === 'department' && dep !== '' && String(r.department).trim() === dep)));
  const isFull = (r) => (r.kind || 'full') === 'full';
  const byScope = (a, b) => (a.scope === 'department' ? 1 : 0) - (b.scope === 'department' ? 1 : 0);
  const full = applicable.filter(isFull).sort(byScope)[0];
  if (full) return full;
  const halves = applicable.filter((r) => !isFull(r)).sort((a, b) => String(a.half_end_time).localeCompare(String(b.half_end_time)) || byScope(a, b));
  return halves[0] || null;
}

/**
 * @param {object} p
 * @param {string} p.dateStr 'YYYY-MM-DD'
 * @param {object|null} [p.shift] شیفت (camelCase خروجی shiftsRepository) یا null = بدون شیفت
 * @param {object} p.settings تنظیمات (workDayStart, workDayEnd, weekendDays, halfDayWeekdays, halfDayEndTime)
 * @param {{title:string, kind?:string, half_end_time?:string}|null} [p.holiday] ردیفِ مؤثر (خروجی pickHoliday)؛ kind نبودن = full
 */
function resolveCalendarDay({ dateStr, shift = null, settings, holiday = null }) {
  const weekday = weekdayOf(dateStr);
  const start = shift ? shift.startTime : settings.workDayStart;
  const end = shift ? shift.endTime : settings.workDayEnd;
  const isFullHoliday = !!holiday && (holiday.kind || 'full') === 'full';
  const info = holiday ? { isHoliday: true, holidayTitle: holiday.title || '' } : { isHoliday: false, holidayTitle: null };

  if (isFullHoliday) {
    return { isWorkingDay: false, ...info, expectedStart: null, expectedEnd: null, kind: 'holiday' };
  }
  const workingWeekday = shift ? (shift.workDays || []).includes(weekday) : !(settings.weekendDays || []).includes(weekday);
  if (!workingWeekday) {
    return { isWorkingDay: false, ...info, expectedStart: null, expectedEnd: null, kind: 'weekend' };
  }

  let kind = 'working';
  let expectedEnd = end;
  if (!isOvernightShift(shift)) {
    const s = minutesOf(start);
    const e = minutesOf(end);
    const ends = [];
    if ((settings.halfDayWeekdays || []).includes(weekday)) ends.push(halfEnd(settings.halfDayEndTime, s, e));
    if (holiday) ends.push(halfEnd(holiday.half_end_time, s, e));
    const valid = ends.filter((x) => x !== null);
    if (valid.length) {
      kind = 'half';
      expectedEnd = toHhmm(Math.min(...valid));
    }
  }
  return { isWorkingDay: true, ...info, expectedStart: start, expectedEnd, kind };
}

// userOrShift: شیفت (دارای startTime)، کاربر (ردیف users؛ شیفتش با findByUserId خوانده می‌شود) یا null/undefined = تنظیمات سراسری.
// دپارتمان فقط از «ردیف کاربر» می‌آید (شیفتِ تنها دپارتمان ندارد ⇒ فقط تعطیلی‌های scope='all').
// opts (برای تست/حلقه‌ها): { settings، shift، holidays (آرایه‌ی ردیف‌های همان تاریخ)، holiday (ردیفِ مؤثر یا null؛ pickHoliday را دور می‌زند) }؛ ندادن ⇒ خواندن از DB.
function getCalendarDay(userOrShift, dateStr, opts = {}) {
  const settingsRepository = require('../repositories/settingsRepository');
  const holidaysRepository = require('../repositories/holidaysRepository');
  const shiftsRepository = require('../repositories/shiftsRepository');

  let shift = null;
  if (opts.shift !== undefined) shift = opts.shift;
  else if (userOrShift && userOrShift.startTime !== undefined) shift = userOrShift;
  else if (userOrShift && userOrShift.id !== undefined) shift = shiftsRepository.findByUserId(userOrShift.id);

  const settings = opts.settings || settingsRepository.getAll();
  let holiday;
  if (opts.holiday !== undefined) holiday = opts.holiday;
  else {
    const isUserRow = userOrShift && userOrShift.startTime === undefined;
    holiday = pickHoliday(opts.holidays || holidaysRepository.listByDate(dateStr), isUserRow ? userOrShift.department : null);
  }
  return resolveCalendarDay({ dateStr, shift, settings, holiday });
}

module.exports = { getCalendarDay, resolveCalendarDay, pickHoliday, weekdayOf };

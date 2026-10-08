// S4-8a: منطق خالص «واحد» درخواست مرخصی (روز | نیم‌روز | ساعتی) — اعتبارسنجی ورودی، محاسبه‌ی مدت با تقویم، و تداخل.
// بدون DB و بدون ساعت سیستم: تقویم هر روز از بیرون با getDay(dateStr) می‌آید (خروجی getCalendarDay یا مشابه: { isWorkingDay, kind,
// expectedStart, expectedEnd }). اتصال به DB در src/services/leaveDurationService.js است.
//
// قواعد محاسبه (همه به «دقیقه»؛ طول روز = expectedEnd − expectedStart همان تعریف computeDay، بدون کسر ناهار):
//   day       هر روز کاریِ بازه یک روز کامل (روز نیم‌روزِ تقویم کوتاه‌تر است). تعطیلی/آخر هفته/روز غیرکاری شیفتِ «وسط بازه» شمرده نمی‌شود.
//   half_day  یک روز؛ morning = floor(طول/۲) از شروع، afternoon = بقیه (مجموعشان دقیقاً یک روز). روز باید کاری باشد.
//   hour      یک روز؛ [start_time, end_time) باید داخل ساعت کاریِ همان روز (شیفت کاربر) باشد؛ مدت = پایان − شروع.
//             شیفت شب (عبور از نیمه‌شب) برای ساعتی پشتیبانی نمی‌شود ⇒ خطای صریح.
// تداخل: فقط روی «روزهای کاری» و بازه‌ی ساعتیِ همان روز سنجیده می‌شود (صبح و عصر یک روز با هم تداخل ندارند؛ ساعتی داخل نیم‌روز دارد).

const { dayNumber, addDays } = require('./shiftDay');

const UNITS = ['day', 'half_day', 'hour'];
const HALF_DAY_PARTS = ['morning', 'afternoon'];
const MAX_RANGE_DAYS = 366;
const STRICT_HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

const fail = (code, error) => ({ ok: false, code, error });
const isBlank = (v) => v === undefined || v === null || v === '';

function strictMinutes(v) {
  const m = typeof v === 'string' ? STRICT_HHMM.exec(v) : null;
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
function lenientMinutes(v) {
  const m = typeof v === 'string' ? /^\s*(\d{1,2}):(\d{2})\s*$/.exec(v) : null;
  return m && Number(m[1]) <= 23 && Number(m[2]) <= 59 ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function eachDate(startDate, endDate) {
  const out = [];
  const n = dayNumber(endDate) - dayNumber(startDate);
  for (let i = 0; i <= n; i += 1) out.push(addDays(startDate, i));
  return out;
}

// ورودی کاربر/کانال ⇒ { ok:true, value:{ unit, startDate, endDate, halfDayPart, startTime, endTime } } یا { ok:false, errors:[{code,error}] }
function validateUnitInput(input = {}) {
  const errors = [];
  const add = (code, error) => errors.push({ code, error });
  const unit = isBlank(input.unit) ? 'day' : input.unit;
  const { startDate, endDate } = input;
  const halfDayPart = isBlank(input.halfDayPart) ? null : input.halfDayPart;
  const startTime = isBlank(input.startTime) ? null : input.startTime;
  const endTime = isBlank(input.endTime) ? null : input.endTime;

  if (!UNITS.includes(unit)) add('INVALID_UNIT', 'واحد باید day، half_day یا hour باشد.');
  const sd = dayNumber(startDate);
  const ed = dayNumber(endDate);
  if (sd === null || ed === null) add('INVALID_DATE', 'تاریخ شروع/پایان نامعتبر است (YYYY-MM-DD).');
  else if (ed < sd) add('INVALID_RANGE', 'تاریخ پایان نباید قبل از شروع باشد.');
  else if (ed - sd + 1 > MAX_RANGE_DAYS) add('RANGE_TOO_LONG', `بازه نباید بیش از ${MAX_RANGE_DAYS} روز باشد.`);
  if (errors.length) return { ok: false, errors };

  if (unit === 'day') {
    if (halfDayPart !== null || startTime !== null || endTime !== null) add('UNIT_FIELDS_MISMATCH', 'برای واحد «روز» بخش نیم‌روز و ساعت نباید پر باشد.');
  } else {
    if (sd !== ed) add('SINGLE_DAY_REQUIRED', 'نیم‌روز و ساعتی فقط برای یک روز است (تاریخ شروع و پایان یکی باشد).');
    if (unit === 'half_day') {
      if (!HALF_DAY_PARTS.includes(halfDayPart)) add('INVALID_HALF_DAY_PART', 'بخش نیم‌روز باید morning یا afternoon باشد.');
      if (startTime !== null || endTime !== null) add('UNIT_FIELDS_MISMATCH', 'برای نیم‌روز ساعت شروع/پایان نباید پر باشد.');
    } else {
      const s = strictMinutes(startTime);
      const e = strictMinutes(endTime);
      if (s === null || e === null) add('INVALID_TIME', 'ساعت شروع و پایان باید به‌صورت HH:MM دو رقمی باشد.');
      else if (s >= e) add('INVALID_TIME_RANGE', 'ساعت پایان باید بعد از شروع باشد.');
      if (halfDayPart !== null) add('UNIT_FIELDS_MISMATCH', 'برای واحد ساعتی بخش نیم‌روز نباید پر باشد.');
    }
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { unit, startDate, endDate, halfDayPart, startTime, endTime } };
}

// پنجره‌ی کاریِ یک روز (دقیقه از نیمه‌شبِ همان تاریخ) یا null اگر روز کاری نیست/ساعت‌ها نامعتبر.
function dayWindow(cal) {
  if (!cal || !cal.isWorkingDay) return null;
  const s = lenientMinutes(cal.expectedStart);
  let e = lenientMinutes(cal.expectedEnd);
  if (s === null || e === null) return null;
  const overnight = e <= s;
  if (overnight) e += 1440;
  return { start: s, end: e, overnight, span: e - s };
}

// بازه‌ی واقعیِ درخواست در یک روز کاری (دقیقه) — یا null
function intervalOnDay(req, win) {
  if (!win) return null;
  if (req.unit === 'half_day') {
    const mid = win.start + Math.floor(win.span / 2);
    return req.halfDayPart === 'morning' ? [win.start, mid] : [mid, win.end];
  }
  if (req.unit === 'hour') return [strictMinutes(req.startTime), strictMinutes(req.endTime)];
  return [win.start, win.end];
}

// value: خروجی validateUnitInput. ⇒ { ok:true, minutes, days:[{ date, minutes, counted, reason? }] } یا { ok:false, code, error }
function computeDuration(value, getDay) {
  const days = [];
  if (value.unit === 'day') {
    let total = 0;
    for (const date of eachDate(value.startDate, value.endDate)) {
      const cal = getDay(date);
      const win = dayWindow(cal);
      if (!win) days.push({ date, minutes: 0, counted: false, reason: (cal && cal.kind) || 'non_working' });
      else {
        total += win.span;
        days.push({ date, minutes: win.span, counted: true });
      }
    }
    if (total === 0) return fail('NO_WORKING_TIME', 'در این بازه هیچ روز کاری وجود ندارد (تعطیلی/آخر هفته).');
    return { ok: true, minutes: total, days };
  }

  const date = value.startDate;
  const win = dayWindow(getDay(date));
  if (!win) return fail('NOT_WORKING_DAY', 'این روز برای کارمند روز کاری نیست.');
  if (value.unit === 'half_day') {
    const [s, e] = intervalOnDay(value, win);
    return { ok: true, minutes: e - s, days: [{ date, minutes: e - s, counted: true }] };
  }
  if (win.overnight) return fail('OVERNIGHT_HOURLY_UNSUPPORTED', 'مرخصی ساعتی برای شیفت شب (عبور از نیمه‌شب) پشتیبانی نمی‌شود.');
  const [s, e] = intervalOnDay(value, win);
  if (s < win.start || e > win.end) return fail('OUTSIDE_WORK_HOURS', 'بازه‌ی ساعتی باید داخل ساعت کاری آن روز باشد.');
  return { ok: true, minutes: e - s, days: [{ date, minutes: e - s, counted: true }] };
}

// آیا دو درخواست (هر دو شکل value) در یک روز کاری هم‌پوشانی دارند؟ ⇒ تاریخ‌های متداخل (آرایه، شاید خالی)
function overlapDates(a, b, getDay) {
  const from = dayNumber(a.startDate) > dayNumber(b.startDate) ? a.startDate : b.startDate;
  const to = dayNumber(a.endDate) < dayNumber(b.endDate) ? a.endDate : b.endDate;
  if (dayNumber(from) > dayNumber(to)) return [];
  const out = [];
  for (const date of eachDate(from, to)) {
    const win = dayWindow(getDay(date));
    if (!win) continue;
    const ia = intervalOnDay(a, win);
    const ib = intervalOnDay(b, win);
    if (ia && ib && ia[0] < ib[1] && ib[0] < ia[1]) out.push(date);
  }
  return out;
}

// S4-8b-1: پنجره‌های مرخصی یک «تاریخ» برای موتور (computeDay({ approvedLeaves })).
// values: آرایه‌ی خروجی validateUnitInput (شکل value؛ هر کدام یک درخواست تأییدشده). getDay: تقویم همان کاربر (مثل computeDuration).
// فقط درخواست‌هایی که بازه‌شان شامل date است و date برای کاربر روز کاری است پنجره می‌دهند؛ تعطیلی/آخر هفته‌ی وسط بازه پنجره‌ای ندارد.
// پنجره‌ها بر پایه‌ی «دقیقه از نیمه‌شبِ date» (همان intervalOnDay؛ شیفت شب: پایان + ۱۴۴۰) و هم‌پایه با تقویم همان روز است
// (روز نیم‌روز ⇒ پنجره‌ی کوتاه‌تر؛ day = کل روز، half_day صبح/عصر = نیمه‌ی اول/دوم، hour = ساعت‌های درخواستی).
// خروجی: [{ start, end }] به ترتیب ورودی (مرتب‌سازی/ادغام کار computeDay است). ورودی تغییر نمی‌کند؛ بدون درخواست مرتبط ⇒ [].
function leaveWindowsOnDate(values, date, getDay) {
  const dn = dayNumber(date);
  if (dn === null) throw new RangeError('date نامعتبر است (YYYY-MM-DD).');
  const win = dayWindow(getDay(date));
  if (!win) return [];
  const out = [];
  for (const v of values || []) {
    if (!v || dayNumber(v.startDate) === null || dayNumber(v.endDate) === null) continue;
    if (dn < dayNumber(v.startDate) || dn > dayNumber(v.endDate)) continue;
    const iv = intervalOnDay(v, win);
    if (iv && iv[0] < iv[1]) out.push({ start: iv[0], end: iv[1] });
  }
  return out;
}

module.exports = { UNITS, HALF_DAY_PARTS, MAX_RANGE_DAYS, validateUnitInput, computeDuration, overlapDates, dayWindow, leaveWindowsOnDate };

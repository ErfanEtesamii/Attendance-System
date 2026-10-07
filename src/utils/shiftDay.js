// S3-6b/6c: helperهای خالص «روزِ شیفت» — بدون DB و بدون ساعت سیستم (now و timezone ورودی‌اند).
//
// قرارداد شیفت شب (S3-6c): record_date = «تاریخ روزی که شیفت در آن شروع شده» (به وقت شرکت). ورود ساعت ۲۲:۰۰ دوشنبه و خروج ۰۶:۰۰ سه‌شنبه
// هر دو در رکوردی با record_date = دوشنبه‌اند. محاسبه (computeDay) زمان‌ها را به «دقیقه از نیمه‌شبِ record_date» می‌برد:
// سه‌شنبه ۰۶:۰۰ = ۱۴۴۰ + ۳۶۰.
//
// شیفت «شب» = overnight=true و پایان < شروع (شیفتی که از نیمه‌شب رد می‌شود). شیفت‌های عادی دست‌نخورده‌اند.

const { formatDate, minutesSinceMidnight } = require('./time');

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const HHMM_RE = /^\s*(\d{1,2}):(\d{2})\s*$/;
const DEFAULT_MARGIN_MINUTES = 120;

// 'YYYY-MM-DD' ⇒ شماره‌ی روز (از 1970، UTC)؛ نامعتبر (قالب یا تاریخ ناموجود مثل 2026-02-31) ⇒ null
function dayNumber(dateStr) {
  const m = typeof dateStr === 'string' ? DATE_RE.exec(dateStr) : null;
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return Math.round(t / 86400000);
}

// اختلاف روز: a − b (هر دو 'YYYY-MM-DD'). نامعتبر ⇒ RangeError
function dayDiff(a, b) {
  const da = dayNumber(a);
  const db = dayNumber(b);
  if (da === null || db === null) throw new RangeError('تاریخ نامعتبر است (YYYY-MM-DD).');
  return da - db;
}

// تاریخ ± n روز (میلادی)
function addDays(dateStr, n) {
  const dn = dayNumber(dateStr);
  if (dn === null) throw new RangeError('تاریخ نامعتبر است (YYYY-MM-DD).');
  return new Date((dn + n) * 86400000).toISOString().slice(0, 10);
}

function hhmm(value) {
  const m = typeof value === 'string' ? HHMM_RE.exec(value) : null;
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

// شیفتِ شب؟ (شکل camelCase خروجی shiftsRepository). شیفت ناقص/خراب ⇒ false (هرگز exception)
function isOvernightShift(shift) {
  if (!shift || shift.overnight !== true) return false;
  const s = hhmm(shift.startTime);
  const e = hhmm(shift.endTime);
  return s !== null && e !== null && e < s;
}

// record_date یک «لحظه» برای کاربر با شیفت شب = روزِ شروع شیفتی که این لحظه به آن می‌خورد.
// بعد از نیمه‌شب تا «پایان + حاشیه» (و نه دیرتر از وسط فاصله‌ی پایان تا شروع بعدی) هنوز شیفتِ دیروز است؛ بعد از آن روز جدید.
// شیفت غیرشب ⇒ همان تاریخ روز (به وقت شرکت).
// opts: { timezone (الزامی)، marginMinutes (پیش‌فرض ۱۲۰؛ معمولاً outsideShiftMarginMinutes) }
function shiftRecordDate(instant, shift, opts = {}) {
  const tz = opts.timezone;
  const date = formatDate(instant, tz);
  if (!isOvernightShift(shift)) return date;
  const margin = opts.marginMinutes === undefined ? DEFAULT_MARGIN_MINUTES : opts.marginMinutes;
  const s = hhmm(shift.startTime);
  const e = hhmm(shift.endTime);
  const cutoff = Math.min(e + margin, Math.floor((e + s) / 2));
  return minutesSinceMidnight(instant, tz) <= cutoff ? addDays(date, -1) : date;
}

module.exports = { dayNumber, dayDiff, addDays, isOvernightShift, shiftRecordDate, DEFAULT_MARGIN_MINUTES };

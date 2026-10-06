// S3-2a: helperهای زمان بر پایه‌ی TIMEZONE تنظیم‌شده (پیش‌فرض Asia/Tehran).
// همه‌ی تبدیل‌ها با Intl.DateTimeFormat و timeZone «صریح» انجام می‌شود؛ هیچ‌کدام به ساعت/منطقه‌ی زمانی
// سیستم‌عامل سرور (getHours/getDate/toLocale*) وابسته نیستند.
//
// قرارداد ذخیره‌سازی بدون تغییر می‌ماند (serverTime.js): timestamp = ISO در UTC (`Date#toISOString`).
// این فایل فقط «نمایش/تفکیک به اجزای زمانِ شرکت» را فراهم می‌کند؛ مصرف‌کننده‌های فعلی در S3-2c مهاجرت می‌کنند.
//
// ورودی تاریخ-زمان: Date یا رشته‌ی ISO (مثل مقدار ذخیره‌شده در DB). نامعتبر ⇒ RangeError.

const DEFAULT_TIMEZONE = 'Asia/Tehran';

// منطقه‌ی زمانی فعلی شرکت از تنظیمات. require تنبل است تا بین time.js ⇄ settingsRegistry دور (cycle) ایجاد نشود.
function getTimezone() {
  return require('../repositories/settingsRepository').getTimezone();
}

// نام IANA معتبر؟ (مثل Asia/Tehran یا UTC). آفست‌هایی مثل +03:30 و رشته‌ی خالی/عدد پذیرفته نمی‌شود.
function normalizeTimezone(tz) {
  if (typeof tz !== 'string') return null;
  const name = tz.trim();
  if (!/^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/.test(name)) return null;
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: name }).resolvedOptions().timeZone; // نام استاندارد (Asia/Tehran)
  } catch (_) {
    return null;
  }
}

function isValidTimezone(tz) {
  return normalizeTimezone(tz) !== null;
}

const formatters = new Map();
function formatterFor(tz) {
  let f = formatters.get(tz);
  if (!f) {
    // hourCycle: 'h23' تا نیمه‌شب «00» باشد نه «24»
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', weekday: 'short',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    formatters.set(tz, f);
  }
  return f;
}

function toDate(input) {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) throw new RangeError('زمان نامعتبر است.');
  return d;
}

function resolveTz(tz) {
  const name = tz === undefined ? getTimezone() : normalizeTimezone(tz);
  if (!name) throw new RangeError('منطقه‌ی زمانی نامعتبر است.');
  return name;
}

const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// اجزای زمان در منطقه‌ی داده‌شده. weekday: ۰=یکشنبه … ۶=شنبه (مثل Date#getDay)
function getZonedParts(input, tz) {
  const zone = resolveTz(tz);
  const p = {};
  formatterFor(zone).formatToParts(toDate(input)).forEach((x) => { p[x.type] = x.value; });
  return {
    year: Number(p.year), month: Number(p.month), day: Number(p.day),
    hour: Number(p.hour), minute: Number(p.minute), second: Number(p.second),
    weekday: WEEKDAYS[p.weekday],
  };
}

const pad2 = (n) => String(n).padStart(2, '0');

// 'YYYY-MM-DD' به وقت شرکت (میلادی؛ همان قالب ستون‌های تاریخ DB)
function formatDate(input, tz) {
  const p = getZonedParts(input, tz);
  return `${String(p.year).padStart(4, '0')}-${pad2(p.month)}-${pad2(p.day)}`;
}

// 'HH:MM' به وقت شرکت
function formatTime(input, tz) {
  const p = getZonedParts(input, tz);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}

// 'YYYY-MM-DD HH:MM' به وقت شرکت
function formatDateTime(input, tz) {
  return `${formatDate(input, tz)} ${formatTime(input, tz)}`;
}

// دقیقه‌ی گذشته از نیمه‌شب به وقت شرکت (جایگزین date.getHours()*60+date.getMinutes())
function minutesSinceMidnight(input, tz) {
  const p = getZonedParts(input, tz);
  return p.hour * 60 + p.minute;
}

function dayOfWeek(input, tz) {
  return getZonedParts(input, tz).weekday;
}

// تاریخ امروز به وقت شرکت (نه UTC)؛ now قابل تزریق برای تست
function todayInZone(tz, now = new Date()) {
  return formatDate(now, tz);
}

// اختلاف (میلی‌ثانیه) «ساعت دیواریِ منطقه» با UTC در یک لحظه
function offsetMs(ms, zone) {
  const p = getZonedParts(new Date(Math.floor(ms / 1000) * 1000), zone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

// معکوس: «تاریخ و ساعت دیواری در منطقه» ⇒ لحظه‌ی UTC (Date). dateStr=YYYY-MM-DD، hhmm=HH:MM (پیش‌فرض 00:00)
// ساعتِ ناموجود در جهش DST به لحظه‌ی بعد از جهش می‌رود.
function zonedTimeToUtc(dateStr, hhmm = '00:00', tz) {
  const zone = resolveTz(tz);
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr));
  const tm = /^(\d{2}):(\d{2})$/.exec(String(hhmm));
  if (!dm || !tm) throw new RangeError('قالب تاریخ/ساعت نامعتبر است.');
  const [y, mo, d, h, mi] = [dm[1], dm[2], dm[3], tm[1], tm[2]].map(Number);
  const check = new Date(Date.UTC(y, mo - 1, d, h, mi));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d || h > 23 || mi > 59) {
    throw new RangeError('تاریخ/ساعت نامعتبر است.');
  }
  const guess = check.getTime();
  // آفست‌های ممکن را از یک روز قبل/بعد می‌گیریم تا اطراف جهش DST هم درست شود
  const candidates = [...new Set([guess - offsetMs(guess - 86400000, zone), guess - offsetMs(guess + 86400000, zone)])];
  const valid = candidates.filter((c) => c + offsetMs(c, zone) === guess); // ساعت دیواریِ همان‌طور که خواسته شده
  // دو جواب (ساعت تکراری هنگام برگشت DST) ⇒ اولی؛ هیچ جواب (ساعت ناموجود هنگام جهش) ⇒ لحظه‌ی بعد از جهش
  return new Date(valid.length ? Math.min(...valid) : Math.max(...candidates));
}

module.exports = {
  DEFAULT_TIMEZONE, getTimezone, normalizeTimezone, isValidTimezone,
  getZonedParts, formatDate, formatTime, formatDateTime, minutesSinceMidnight, dayOfWeek, todayInZone, zonedTimeToUtc,
};

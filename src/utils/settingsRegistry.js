// S3-1a: رجیستری تنظیمات پویا. «تنها منبع حقیقت» برای کلیدها، نوع، پیش‌فرض، بازه، توضیح و گروه.
// خالص است (بدون SQL و بدون دسترسی به DB)؛ ذخیره/خواندن در settingsRepository انجام می‌شود.
//
// افزودن تنظیم جدید = یک خط در REGISTRY (پایین همین فایل)؛ اعتبارسنجی، پیش‌فرض و خواندن/ذخیره خودکار است.
//
// انواع: number (عدد صحیح، مگر integer:false) | boolean | time (HH:MM) | cron (با node-cron validate)
//        | enum (values) | string (minLength/maxLength اختیاری) | timezone (نام IANA، مثل Asia/Tehran)

const cron = require('node-cron');
const config = require('../config');
const time = require('./time');

const TYPES = ['number', 'boolean', 'time', 'cron', 'enum', 'string', 'timezone'];

// برچسب فارسی گروه‌ها (برای صفحه‌ی تنظیمات گروه‌بندی‌شده در S3-9a)
const GROUP_LABELS = {
  workHours: 'ساعت کاری',
  reminders: 'تأخیر و یادآوری',
  security: 'امنیت',
  retention: 'نگهداری و آرشیو داده',
};

// ---------- اعتبارسنجی بر اساس نوع ----------
// خروجی: { ok: true, value } با مقدار نرمال‌شده | { ok: false, error } با پیام فارسی

function parseBool(value) {
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return null;
}

function validateValue(def, raw) {
  const bad = (error) => ({ ok: false, error });
  switch (def.type) {
    case 'number': {
      let n;
      if (typeof raw === 'number') n = raw;
      else if (typeof raw === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(raw)) n = Number(raw);
      else return bad('باید عدد باشد.');
      if (!Number.isFinite(n)) return bad('باید عدد باشد.');
      if (def.integer !== false && !Number.isInteger(n)) return bad('باید عدد صحیح باشد.');
      if (def.min !== undefined && n < def.min) return bad(`نباید کمتر از ${def.min} باشد.`);
      if (def.max !== undefined && n > def.max) return bad(`نباید بیشتر از ${def.max} باشد.`);
      return { ok: true, value: n };
    }
    case 'boolean': {
      const b = parseBool(raw);
      return b === null ? bad('باید true یا false باشد.') : { ok: true, value: b };
    }
    case 'time': {
      const m = typeof raw === 'string' ? /^\s*(\d{1,2}):(\d{2})\s*$/.exec(raw) : null;
      if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return bad('باید ساعت معتبر با قالب HH:MM باشد.');
      return { ok: true, value: `${m[1].padStart(2, '0')}:${m[2]}` };
    }
    case 'cron': {
      const s = typeof raw === 'string' ? raw.trim() : '';
      return s && cron.validate(s) ? { ok: true, value: s } : bad('عبارت cron نامعتبر است.');
    }
    case 'enum': {
      return def.values.includes(raw) ? { ok: true, value: raw } : bad(`باید یکی از ${def.values.join('، ')} باشد.`);
    }
    case 'string': {
      if (typeof raw !== 'string') return bad('باید متن باشد.');
      const s = raw.trim();
      if (s.length < (def.minLength || 0)) return bad(`حداقل ${def.minLength} نویسه لازم است.`);
      if (s.length > (def.maxLength || 200)) return bad(`حداکثر ${def.maxLength || 200} نویسه مجاز است.`);
      return { ok: true, value: s };
    }
    case 'timezone': {
      const zone = time.normalizeTimezone(raw);
      return zone ? { ok: true, value: zone } : bad('باید نام معتبر منطقه‌ی زمانی IANA باشد (مثل Asia/Tehran).');
    }
    default:
      return bad('نوع تنظیم ناشناخته است.');
  }
}

// ---------- تعریف رجیستری ----------
// def(key، کلید DB، نوع، { default، fallback، min، max، values، group، description })
//  - default می‌تواند تابع باشد (مثلاً خواندن از config در لحظه‌ی استفاده).
//  - fallback: مقدار ثابت امن برای وقتی که default (مثلاً از .env) نامعتبر باشد؛ سرور به‌خاطر غلط تایپی در .env بالا نیامدن ندارد.
const REGISTRY = [];
function def(key, dbKey, type, opts) {
  REGISTRY.push({ key, dbKey, type, ...opts });
}

// ساعت کاری
def('timezone', 'timezone', 'timezone', { group: 'workHours', default: () => config.timezone, fallback: 'Asia/Tehran', description: 'منطقه‌ی زمانی شرکت (نام IANA) برای تعیین روز و ساعت کاری' });
def('workDayStart', 'work_day_start', 'time', { group: 'workHours', default: () => config.workDayStart, fallback: '08:00', description: 'ساعت شروع کار' });
def('workDayEnd', 'work_day_end', 'time', { group: 'workHours', default: () => config.workDayEnd, fallback: '16:30', description: 'ساعت پایان کار' });
// S3-3a: مهلت تأخیر در محاسبه‌ی روز (نه یادآور؛ یادآور ورود با lateCheckinGraceMinutes جداست)
def('lateGraceMinutes', 'late_grace_minutes', 'number', { group: 'workHours', min: 0, max: 240, default: 0, description: 'مهلت تأخیر (دقیقه) پس از ساعت شروع کار؛ ورود تا پایان مهلت «تأخیر» حساب نمی‌شود (۰ = بدون مهلت)' });
def('lateCountsFrom', 'late_counts_from', 'enum', { group: 'workHours', values: ['shift_start', 'after_grace'], default: 'shift_start', description: 'مبنای دقیقه‌ی تأخیر پس از گذشتن از مهلت: shift_start = از ساعت شروع کار (کل تأخیر)، after_grace = فقط از پایان مهلت' });
def('earlyGraceMinutes', 'early_grace_minutes', 'number', { group: 'workHours', min: 0, max: 240, default: 0, description: 'مهلت زودتر رفتن (دقیقه) پیش از ساعت پایان کار؛ خروج تا این مقدار زودتر «زودتر رفتن» حساب نمی‌شود (۰ = بدون مهلت). در صورت عبور از مهلت، کل دقیقه‌های مانده تا پایان کار حساب می‌شود' });
// S3-4a: استراحت‌ها (هر دو پیش‌فرض ۰ = خاموش ⇒ رفتار قبلی)
def('maxLunchMinutes', 'max_lunch_minutes', 'number', { group: 'workHours', min: 0, max: 480, default: 0, description: 'حداکثر ناهار مجاز در روز (دقیقه)؛ مازاد ناهار ثبت‌شده به‌صورت «مازاد استراحت» گزارش می‌شود و همچنان از ساعت مفید کم می‌شود (۰ = بدون سقف)' });
def('fixedLunchDeductMinutes', 'fixed_lunch_deduct_minutes', 'number', { group: 'workHours', min: 0, max: 480, default: 0, description: 'کسر ثابت ناهار (دقیقه) از ساعت مفید روزهای بسته‌شده‌ای که هیچ ناهاری ثبت نشده (۰ = خاموش)؛ استراحت کوتاه جای ناهار حساب نمی‌شود' });
// تأخیر و یادآوری
def('lateCheckinGraceMinutes', 'late_checkin_grace_minutes', 'number', { group: 'reminders', min: 0, max: 720, default: () => config.lateCheckinGraceMinutes, fallback: 15, description: 'مهلت تأخیر ورود (دقیقه) پس از ساعت شروع، پیش از یادآوری ورود' });
def('checkoutReminderMinutesBefore', 'checkout_reminder_minutes_before', 'number', { group: 'reminders', min: 0, max: 720, default: () => config.checkoutReminderMinutesBefore, fallback: 15, description: 'یادآوری ثبت خروج، این‌قدر دقیقه پیش از پایان کار' });
def('repeatedLatenessThreshold', 'repeated_lateness_threshold', 'number', { group: 'reminders', min: 1, max: 100, default: () => config.repeatedLatenessThreshold, fallback: 3, description: 'حداقل تعداد تأخیر در ماه برای اعلان «تأخیر تکراری» به مدیر' });
// امنیت
def('blockOnSharedDevice', 'block_on_shared_device', 'boolean', { group: 'security', default: false, description: 'مسدودکردن ثبت تردد وقتی دستگاه همان روز برای کاربر دیگری استفاده شده' });
// نگهداری و آرشیو
def('auditRetentionMonths', 'audit_retention_months', 'number', { group: 'retention', min: 1, max: 240, default: 24, description: 'مدت نگهداری رویدادهای audit در جدول اصلی (ماه)' });
def('auditArchiveEnabled', 'audit_archive_enabled', 'boolean', { group: 'retention', default: false, description: 'انتقال ماهانه‌ی audit قدیمی به آرشیو (خاموش = فقط شمارش)' });
def('jobRunsRetentionDays', 'job_runs_retention_days', 'number', { group: 'retention', min: 7, max: 3650, default: 180, description: 'نگهداری تاریخچه‌ی اجرای Jobها (روز)' });
def('monitorAlertsRetentionDays', 'monitor_alerts_retention_days', 'number', { group: 'retention', min: 7, max: 3650, default: 180, description: 'نگهداری هشدارهای حل‌شده‌ی مانیتورینگ (روز)' });
def('rateLimitRetentionDays', 'rate_limit_retention_days', 'number', { group: 'retention', min: 1, max: 365, default: 7, description: 'نگهداری ردیف‌های منقضی‌شده‌ی rate limit (روز)' });

// ---------- توابع عمومی ----------
const BY_KEY = new Map(REGISTRY.map((d) => [d.key, d]));

function getDef(key) {
  return BY_KEY.get(key) || null;
}

function keys() {
  return REGISTRY.map((d) => d.key);
}

// پیش‌فرض معتبر: default (در صورت تابع بودن، در لحظه) و اگر نامعتبر بود fallback
function defaultOf(key) {
  const d = BY_KEY.get(key);
  if (!d) return undefined;
  const raw = typeof d.default === 'function' ? d.default() : d.default;
  const r = validateValue(d, raw);
  if (r.ok) return r.value;
  if (d.fallback !== undefined) return d.fallback;
  throw new Error(`پیش‌فرض نامعتبر برای تنظیم ${key}`);
}

// اعتبارسنجی مقدار ورودی یک کلید (برای API در S3-1b)
function validate(key, raw) {
  const d = BY_KEY.get(key);
  if (!d) return { ok: false, error: 'کلید تنظیمات ناشناخته است.' };
  if (raw === undefined || raw === null || raw === '') return { ok: false, error: 'مقدار الزامی است.' };
  return validateValue(d, raw);
}

// مقدار ذخیره‌شده در DB (متن) → مقدار نوع‌دار؛ نبودن یا خرابی/خارج از بازه ⇒ پیش‌فرض (هرگز NaN و هرگز پرتاب خطا)
function deserialize(key, raw) {
  const d = BY_KEY.get(key);
  if (!d) return undefined;
  if (raw === undefined || raw === null) return defaultOf(key);
  const r = validateValue(d, raw);
  return r.ok ? r.value : defaultOf(key);
}

// مقدار معتبر → متن برای DB (بولی به '1'/'0' مثل قبل)
function serialize(key, value) {
  const d = BY_KEY.get(key);
  return d.type === 'boolean' ? (value ? '1' : '0') : String(value);
}

// بررسی سلامت خود رجیستری (کلید تکراری، نوع ناشناخته، پیش‌فرض نامعتبر، enum بدون values، cron/min>max)
function selfCheck() {
  const problems = [];
  const seenKeys = new Set();
  const seenDb = new Set();
  REGISTRY.forEach((d) => {
    if (seenKeys.has(d.key)) problems.push(`کلید تکراری: ${d.key}`);
    if (seenDb.has(d.dbKey)) problems.push(`کلید DB تکراری: ${d.dbKey}`);
    seenKeys.add(d.key); seenDb.add(d.dbKey);
    if (!TYPES.includes(d.type)) problems.push(`نوع نامعتبر: ${d.key}`);
    if (!d.description) problems.push(`توضیح خالی: ${d.key}`);
    if (!GROUP_LABELS[d.group]) problems.push(`گروه نامعتبر: ${d.key}`);
    if (d.type === 'enum' && !(Array.isArray(d.values) && d.values.length)) problems.push(`values خالی: ${d.key}`);
    if (d.min !== undefined && d.max !== undefined && d.min > d.max) problems.push(`min>max: ${d.key}`);
    const raw = typeof d.default === 'function' ? d.default() : d.default;
    if (!validateValue(d, raw).ok && d.fallback === undefined) problems.push(`پیش‌فرض نامعتبر: ${d.key}`);
    if (d.fallback !== undefined && !validateValue(d, d.fallback).ok) problems.push(`fallback نامعتبر: ${d.key}`);
  });
  return problems;
}

module.exports = { REGISTRY, GROUP_LABELS, TYPES, getDef, keys, defaultOf, validate, validateValue, deserialize, serialize, selfCheck };

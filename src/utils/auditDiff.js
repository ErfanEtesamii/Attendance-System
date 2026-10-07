// منطق خالص (بدون DB) برای ساخت details استانداردِ تغییرات در audit_log (S4-1a).
// استفاده‌ی اصلی: auditRepository.logChange. جدا نگه داشته شده تا بدون دیتابیس تست شود.
//
// خروجی buildChangeDetails:
//   { entityType, entityId, changes: { <field>: { before, after } }, reason?, redacted?: [<fieldName>] }
// قالب `changes[field] = { before, after }` همان قالب audit تنظیمات (S3-1b) است.
//   • فقط فیلدهای «تغییرکرده» می‌آیند (مقایسه‌ی عمیق، مستقل از ترتیب کلیدها)؛ ایجاد (before=null) همه‌ی فیلدهای after و حذف (after=null) همه‌ی فیلدهای before را می‌آورد.
//   • فیلدهای حساس (نام شامل token/secret/hash/password/api_key) در هر عمقی «حذف» می‌شوند و مقدارشان هرگز ثبت نمی‌شود؛
//     اگر یکی از آن‌ها تغییر کرده باشد فقط «نام» فیلد در redacted می‌آید (بدون مقدار) تا ردپای وقوع تغییر باقی بماند.
//   • همه‌ی رشته‌ها با sanitizeText پاک/کوتاه می‌شوند (الگوی توکن بات ⇒ [REDACTED]).

const { sanitizeText } = require('./sanitize');

const SENSITIVE_KEY_RE = /token|secret|hash|password|passwd|api[_-]?key/i;
const MAX_DEPTH = 6;
const MAX_STRING = 500;

function isSensitiveKey(key) {
  return SENSITIVE_KEY_RE.test(String(key));
}

function isPlainObject(v) {
  return Object.prototype.toString.call(v) === '[object Object]';
}

// نمایش پایدار برای مقایسه‌ی تغییر (کلیدها مرتب، Date به ISO، undefined مثل null)؛ روی مقدار خام (قبل از کوتاه‌سازی) کار می‌کند.
function canonical(value, depth = 0) {
  if (value === undefined || value === null) return 'null';
  if (value instanceof Date) return JSON.stringify(Number.isNaN(value.getTime()) ? null : value.toISOString());
  if (typeof value === 'bigint') return JSON.stringify(String(value));
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (depth >= MAX_DEPTH) return '"[depth-limit]"';
  if (Array.isArray(value)) return `[${value.map((v) => canonical(v, depth + 1)).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().filter((k) => value[k] !== undefined && typeof value[k] !== 'function')
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k], depth + 1)}`).join(',')}}`;
  }
  return 'null'; // تابع/symbol
}

// نسخه‌ی قابل‌ذخیره: حساس‌ها حذف، رشته‌ها پاک‌سازی‌شده، Date ⇒ ISO، عمق محدود
function clean(value, depth = 0) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return sanitizeText(value, MAX_STRING);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') return String(value);
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (depth >= MAX_DEPTH) return '[depth-limit]';
  if (Array.isArray(value)) return value.map((v) => clean(v, depth + 1));
  if (isPlainObject(value)) {
    const out = {};
    Object.keys(value).forEach((k) => {
      if (isSensitiveKey(k) || value[k] === undefined || typeof value[k] === 'function') return;
      out[k] = clean(value[k], depth + 1);
    });
    return out;
  }
  return null;
}

function asRecord(v, label) {
  if (v === undefined || v === null) return {};
  if (!isPlainObject(v)) throw new TypeError(`${label} باید آبجکت (یا null) باشد.`);
  return v;
}

// { changes, redacted } برای دو آبجکت؛ before/after = null یعنی ایجاد/حذف
function buildChanges(before, after) {
  const b = asRecord(before, 'before');
  const a = asRecord(after, 'after');
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])];
  const changes = {};
  const redacted = [];
  keys.forEach((key) => {
    if (typeof b[key] === 'function' || typeof a[key] === 'function') return;
    if (canonical(b[key]) === canonical(a[key])) return;
    if (isSensitiveKey(key)) { redacted.push(key); return; }
    changes[key] = { before: clean(b[key]), after: clean(a[key]) };
  });
  return { changes, redacted };
}

// S4-1b: فیلدهای کمکیِ «غیر diff» که جستجوهای قدیمی به آن‌ها تکیه دارند (source، targetUserId، recordId، fields، ...).
// مثل diff پاک‌سازی می‌شوند (حساس‌ها حذف، رشته‌ها sanitize)؛ کلیدهای رزروشده هرگز با meta بازنویسی نمی‌شوند.
const RESERVED_META_KEYS = ['entityType', 'entityId', 'changes', 'reason', 'redacted'];

function cleanMeta(meta) {
  if (meta === undefined || meta === null) return {};
  if (!isPlainObject(meta)) throw new TypeError('meta باید آبجکت (یا null) باشد.');
  const out = clean(meta);
  RESERVED_META_KEYS.forEach((k) => { delete out[k]; });
  return out;
}

function buildChangeDetails({ entityType, entityId = null, before = null, after = null, reason = null, meta = null }) {
  const { changes, redacted } = buildChanges(before, after);
  const details = {
    ...cleanMeta(meta),
    entityType: sanitizeText(entityType, 100),
    entityId: entityId === null || entityId === undefined ? null : (typeof entityId === 'number' ? entityId : sanitizeText(entityId, 100)),
    changes,
  };
  const why = reason === null || reason === undefined ? '' : sanitizeText(reason, MAX_STRING).trim();
  if (why) details.reason = why;
  if (redacted.length) details.redacted = redacted;
  return details;
}

module.exports = { buildChangeDetails, buildChanges, isSensitiveKey };

// تنظیمات پویای سیستم (فاز ۸ - صفحه «تنظیمات» پنل مدیریتی وب).
// این ۵ مقدار زمانی از پنل تغییر کنند، همان لحظه روی موتور محاسبه (workHours.js) و
// اسکجولرهای یادآوری اثر می‌گذارند - بدون نیاز به ویرایش .env یا ری‌استارت سرور،
// چون هر بار مستقیم از دیتابیس خوانده می‌شوند، نه یک بار در زمان بالا آمدن پروسه.

const { getDb } = require('../db/connection');
const config = require('../config');

const KEY_MAP = {
  workDayStart: 'work_day_start',
  workDayEnd: 'work_day_end',
  lateCheckinGraceMinutes: 'late_checkin_grace_minutes',
  checkoutReminderMinutesBefore: 'checkout_reminder_minutes_before',
  repeatedLatenessThreshold: 'repeated_lateness_threshold',
  // S2-4e-3: مسدودکردن ثبت وقتی device_id همان روز برای کاربر دیگری استفاده شده (فقط قاعده‌ی الف). پیش‌فرض: خاموش
  blockOnSharedDevice: 'block_on_shared_device',
  // S2-6a: سیاست آرشیو audit (فقط تنظیم؛ Job آرشیو در S2-6b/6c). نگهداری به ماه؛ آرشیو پیش‌فرض خاموش
  auditRetentionMonths: 'audit_retention_months',
  auditArchiveEnabled: 'audit_archive_enabled',
};

// کلیدهای بولی: در DB به‌صورت '1'/'0' ذخیره می‌شوند و در API به‌صورت true/false برمی‌گردند
const BOOLEAN_KEYS = new Set(['blockOnSharedDevice', 'auditArchiveEnabled']);

// کلیدهای عددی با بازه‌ی مجاز (عدد صحیح). مقدار خارج از بازه/نامعتبر هنگام ذخیره نادیده گرفته می‌شود و هنگام خواندن پیش‌فرض برمی‌گردد.
const INT_RANGES = { auditRetentionMonths: [1, 240] };

function parseIntInRange(value, [min, max]) {
  if (typeof value === 'string' && !/^\s*\d+\s*$/.test(value)) return null;
  const n = typeof value === 'number' ? value : parseInt(value, 10);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

function parseBool(value) {
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return null; // نامعتبر ⇒ نادیده گرفته می‌شود
}

const DEFAULTS = () => ({
  workDayStart: config.workDayStart,
  workDayEnd: config.workDayEnd,
  lateCheckinGraceMinutes: config.lateCheckinGraceMinutes,
  checkoutReminderMinutesBefore: config.checkoutReminderMinutesBefore,
  repeatedLatenessThreshold: config.repeatedLatenessThreshold,
  blockOnSharedDevice: false,
  auditRetentionMonths: 24,
  auditArchiveEnabled: false,
});

function getAll() {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const stored = {};
  rows.forEach((r) => { stored[r.key] = r.value; });

  const defaults = DEFAULTS();
  const result = {};
  Object.keys(KEY_MAP).forEach((camelKey) => {
    const dbKey = KEY_MAP[camelKey];
    const raw = stored[dbKey];
    if (raw === undefined) {
      result[camelKey] = defaults[camelKey];
    } else if (BOOLEAN_KEYS.has(camelKey)) {
      result[camelKey] = parseBool(raw) === true;
    } else if (INT_RANGES[camelKey]) {
      const n = parseIntInRange(raw, INT_RANGES[camelKey]);
      result[camelKey] = n === null ? defaults[camelKey] : n;
    } else if (camelKey === 'workDayStart' || camelKey === 'workDayEnd') {
      result[camelKey] = raw;
    } else {
      result[camelKey] = parseInt(raw, 10);
    }
  });
  return result;
}

function update(fields) {
  const db = getDb();
  const upsert = db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  );
  Object.keys(fields).forEach((camelKey) => {
    const dbKey = KEY_MAP[camelKey];
    const value = fields[camelKey];
    if (!dbKey || value === undefined || value === null || value === '') return;
    if (BOOLEAN_KEYS.has(camelKey)) {
      const flag = parseBool(value);
      if (flag === null) return;
      upsert.run(dbKey, flag ? '1' : '0');
      return;
    }
    if (INT_RANGES[camelKey]) {
      const n = parseIntInRange(value, INT_RANGES[camelKey]);
      if (n !== null) upsert.run(dbKey, String(n));
      return;
    }
    upsert.run(dbKey, String(value));
  });
  return getAll();
}

// خواندن سبکِ فقط یک کلید (برای مسیر ثبت تردد). نبودن/خرابی مقدار ⇒ false (خاموش)
function isBlockOnSharedDeviceEnabled() {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(KEY_MAP.blockOnSharedDevice);
  return row ? parseBool(row.value) === true : false;
}

// خواندن سبکِ تنظیمات آرشیو audit برای Jobهای S2-6b/6c. نبودن/خرابی مقدار ⇒ آرشیو خاموش و ۲۴ ماه (محافظه‌کارانه)
function isAuditArchiveEnabled() {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(KEY_MAP.auditArchiveEnabled);
  return row ? parseBool(row.value) === true : false;
}

function getAuditRetentionMonths() {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(KEY_MAP.auditRetentionMonths);
  const n = row ? parseIntInRange(row.value, INT_RANGES.auditRetentionMonths) : null;
  return n === null ? DEFAULTS().auditRetentionMonths : n;
}

// ---------- epoch سراسری نشست‌ها (بخش ۲-الف) ----------
// عددی که داخل توکن نشست هم ذخیره می‌شود؛ با افزایش آن «همه‌ی نشست‌های همه‌ی کاربران» باطل می‌شود.
// عمداً در KEY_MAP نیست تا از صفحه‌ی تنظیمات پنل قابل ویرایش/نمایش نباشد؛ فقط با bumpGlobalSessionEpoch.
const GLOBAL_EPOCH_KEY = 'global_session_epoch';

function getGlobalSessionEpoch() {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(GLOBAL_EPOCH_KEY);
  const n = row ? parseInt(row.value, 10) : 0;
  return Number.isFinite(n) ? n : 0;
}

function bumpGlobalSessionEpoch() {
  const db = getDb();
  const tx = db.transaction(() => {
    const next = getGlobalSessionEpoch() + 1;
    db.prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
    ).run(GLOBAL_EPOCH_KEY, String(next));
    return next;
  });
  return tx();
}

module.exports = {
  getAll, update, isBlockOnSharedDeviceEnabled, isAuditArchiveEnabled, getAuditRetentionMonths, getGlobalSessionEpoch, bumpGlobalSessionEpoch,
};

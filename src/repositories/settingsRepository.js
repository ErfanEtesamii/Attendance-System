// تنظیمات پویای سیستم (فاز ۸ - صفحه «تنظیمات» پنل مدیریتی وب).
// این ۵ مقدار زمانی از پنل تغییر کنند، همان لحظه روی موتور محاسبه (workHours.js) و
// اسکجولرهای یادآوری اثر می‌گذارند - بدون نیاز به ویرایش .env یا ری‌استارت سرور،
// چون هر بار مستقیم از دیتابیس خوانده می‌شوند، نه یک بار در زمان بالا آمدن پروسه.

const { getDb } = require('../db/connection');
const registry = require('../utils/settingsRegistry');

// S3-1a: کلیدها، نوع، پیش‌فرض و اعتبارسنجی همه از src/utils/settingsRegistry.js می‌آیند (تنها منبع حقیقت).
// این فایل فقط SQL خواندن/نوشتن را نگه می‌دارد. رفتار قبلی حفظ شده: مقدار نامعتبر هنگام ذخیره نادیده گرفته می‌شود
// و هنگام خواندن پیش‌فرض برمی‌گردد (پاسخ ۴۰۰ برای نامعتبر در S3-1b).

const UPSERT_SQL = `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`;

function dbKeyOf(camelKey) {
  return registry.getDef(camelKey).dbKey;
}

// خواندن خام یک کلید از DB (undefined اگر نباشد)
function readRaw(camelKey) {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(dbKeyOf(camelKey));
  return row ? row.value : undefined;
}

function getAll() {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const stored = {};
  rows.forEach((r) => { stored[r.key] = r.value; });

  const result = {};
  registry.keys().forEach((camelKey) => {
    result[camelKey] = registry.deserialize(camelKey, stored[dbKeyOf(camelKey)]);
  });
  return result;
}

function update(fields) {
  const db = getDb();
  const upsert = db.prepare(UPSERT_SQL);
  Object.keys(fields).forEach((camelKey) => {
    if (!registry.getDef(camelKey)) return; // کلید ناشناخته نادیده گرفته می‌شود
    const result = registry.validate(camelKey, fields[camelKey]);
    if (!result.ok) return; // نامعتبر/خالی نادیده گرفته می‌شود
    upsert.run(dbKeyOf(camelKey), registry.serialize(camelKey, result.value));
  });
  return getAll();
}

// خواندن سبکِ فقط یک کلید (برای مسیر ثبت تردد). نبودن/خرابی مقدار ⇒ false (خاموش)
function isBlockOnSharedDeviceEnabled() {
  return registry.deserialize('blockOnSharedDevice', readRaw('blockOnSharedDevice')) === true;
}

// خواندن سبکِ تنظیمات آرشیو audit برای Jobهای S2-6b/6c. نبودن/خرابی مقدار ⇒ آرشیو خاموش و ۲۴ ماه (محافظه‌کارانه)
function isAuditArchiveEnabled() {
  return registry.deserialize('auditArchiveEnabled', readRaw('auditArchiveEnabled')) === true;
}

function getAuditRetentionMonths() {
  return registry.deserialize('auditRetentionMonths', readRaw('auditRetentionMonths'));
}

// نگهداری جدول‌های فرعی برای cleanup (S2-7a). نبودن/خرابی مقدار ⇒ پیش‌فرض محافظه‌کارانه (هرگز NaN)
function getCleanupRetention() {
  const all = getAll();
  return {
    jobRunsDays: all.jobRunsRetentionDays,
    monitorAlertsDays: all.monitorAlertsRetentionDays,
    rateLimitDays: all.rateLimitRetentionDays,
  };
}

// ---------- epoch سراسری نشست‌ها (بخش ۲-الف) ----------
// عددی که داخل توکن نشست هم ذخیره می‌شود؛ با افزایش آن «همه‌ی نشست‌های همه‌ی کاربران» باطل می‌شود.
// عمداً در رجیستری نیست تا از صفحه‌ی تنظیمات پنل قابل ویرایش/نمایش نباشد؛ فقط با bumpGlobalSessionEpoch.
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
    db.prepare(UPSERT_SQL).run(GLOBAL_EPOCH_KEY, String(next));
    return next;
  });
  return tx();
}

module.exports = {
  getAll, update, isBlockOnSharedDeviceEnabled, isAuditArchiveEnabled, getAuditRetentionMonths, getCleanupRetention, getGlobalSessionEpoch, bumpGlobalSessionEpoch,
};

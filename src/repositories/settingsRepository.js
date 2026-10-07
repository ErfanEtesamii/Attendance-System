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

// ---------- API تنظیمات با متادیتا (S3-1b) ----------
// یک آیتم = متادیتای رجیستری + مقدار مؤثر فعلی. کلید ناشناخته ⇒ null.
function buildItem(def, stored) {
  const value = registry.deserialize(def.key, stored ? stored.value : undefined);
  const dflt = registry.defaultOf(def.key);
  const item = {
    key: def.key,
    type: def.type,
    group: def.group,
    groupLabel: registry.GROUP_LABELS[def.group],
    description: def.description,
    value,
    default: dflt,
    isDefault: registry.sameValue(value, dflt),
    updatedAt: stored ? stored.updated_at : null,
  };
  if (def.min !== undefined) item.min = def.min;
  if (def.max !== undefined) item.max = def.max;
  if (def.values !== undefined) item.values = def.values;
  return item;
}

function getItems() {
  const rows = getDb().prepare('SELECT key, value, updated_at FROM settings').all();
  const byDbKey = new Map(rows.map((r) => [r.key, r]));
  return registry.REGISTRY.map((def) => buildItem(def, byDbKey.get(def.dbKey)));
}

function getItem(camelKey) {
  const def = registry.getDef(camelKey);
  if (!def) return null;
  const row = getDb().prepare('SELECT value, updated_at FROM settings WHERE key = ?').get(def.dbKey);
  return buildItem(def, row);
}

// ذخیره‌ی یک مقدار «از قبل معتبر» (خروجی registry.validate). نامعتبر ⇒ خطا (مسیر API پیش‌تر ۴۰۰ می‌دهد)
function setValue(camelKey, value) {
  const result = registry.validate(camelKey, value);
  if (!result.ok) throw new Error(`مقدار نامعتبر برای ${camelKey}: ${result.error}`);
  getDb().prepare(UPSERT_SQL).run(dbKeyOf(camelKey), registry.serialize(camelKey, result.value));
  return getItem(camelKey);
}

// بازگشت به پیش‌فرض = حذف ردیف ذخیره‌شده (تا اگر پیش‌فرضِ .env عوض شد، همان دنبال شود). خروجی: آیا ردیفی حذف شد
function resetValue(camelKey) {
  const info = getDb().prepare('DELETE FROM settings WHERE key = ?').run(dbKeyOf(camelKey));
  return info.changes > 0;
}

// منطقه‌ی زمانی مؤثر شرکت (S3-2a). نبودن/خرابی مقدار ⇒ پیش‌فرض (config.timezone یا Asia/Tehran)، هرگز پرتاب خطا
function getTimezone() {
  return registry.deserialize('timezone', readRaw('timezone'));
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
    notificationsDays: all.notificationsRetentionDays,
  };
}

// عبارت cron مؤثر هر Job (S3-8c): { lateCheckinCheck: '…', …, watchdog: '…' }. مقدار ذخیره‌شده ⇒ وگرنه .env/پیش‌فرض؛ هرگز نامعتبر نیست
function getCronExpressions() {
  const all = getAll();
  const out = {};
  registry.cronJobs().forEach(({ job, key }) => { out[job] = all[key]; });
  return out;
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
  getAll, update, getTimezone, getCronExpressions, getItems, getItem, setValue, resetValue, isBlockOnSharedDeviceEnabled, isAuditArchiveEnabled, getAuditRetentionMonths, getCleanupRetention, getGlobalSessionEpoch, bumpGlobalSessionEpoch,
};

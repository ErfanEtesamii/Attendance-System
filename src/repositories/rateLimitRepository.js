// ذخیره‌ی شمارنده‌های rate limit در SQLite (بخش ۲-ب۲).
// هیچ SQL خامی بیرون از repositoryها مجاز نیست؛ middleware فقط از همین توابع استفاده می‌کند.

const { getDb } = require('../db/connection');

const MAX_KEY_LENGTH = 200;

function normalizeKey(key) {
  return String(key == null || key === '' ? 'unknown' : key).slice(0, MAX_KEY_LENGTH);
}

/**
 * یک برخورد را اتمیک ثبت می‌کند (fixed-window).
 * اگر پنجره‌ی قبلی منقضی شده باشد، شمارنده از ۱ شروع می‌شود.
 * یک دستور UPSERT تنهاست؛ پس بین دو درخواست همزمان race وجود ندارد.
 * @returns {{count:number, resetAt:number}}
 */
function hit(limiter, key, windowMs, now = Date.now()) {
  const row = getDb()
    .prepare(
      `INSERT INTO rate_limit_hits (limiter, bucket_key, count, reset_at)
       VALUES (@limiter, @key, 1, @newReset)
       ON CONFLICT(limiter, bucket_key) DO UPDATE SET
         count = CASE WHEN rate_limit_hits.reset_at <= @now THEN 1 ELSE rate_limit_hits.count + 1 END,
         reset_at = CASE WHEN rate_limit_hits.reset_at <= @now THEN @newReset ELSE rate_limit_hits.reset_at END
       RETURNING count, reset_at`
    )
    .get({ limiter, key: normalizeKey(key), now, newReset: now + windowMs });
  return { count: row.count, resetAt: row.reset_at };
}

// پاک‌سازی ردیف‌های منقضی؛ تعداد حذف‌شده را برمی‌گرداند
function purgeExpired(now = Date.now()) {
  return getDb().prepare('DELETE FROM rate_limit_hits WHERE reset_at <= ?').run(now).changes;
}

// تعداد ردیف‌های منقضی تا لحظه‌ی beforeMs (برای dry-run پاک‌سازی S2-7a؛ همان شرط purgeExpired)
function countExpired(beforeMs) {
  return getDb().prepare('SELECT COUNT(*) AS n FROM rate_limit_hits WHERE reset_at <= ?').get(beforeMs).n;
}

function countRows() {
  return getDb().prepare('SELECT COUNT(*) AS n FROM rate_limit_hits').get().n;
}

// فقط برای تست/عیب‌یابی
function get(limiter, key) {
  return getDb()
    .prepare('SELECT count, reset_at AS resetAt FROM rate_limit_hits WHERE limiter = ? AND bucket_key = ?')
    .get(limiter, normalizeKey(key));
}

module.exports = { hit, purgeExpired, countExpired, countRows, get, MAX_KEY_LENGTH };

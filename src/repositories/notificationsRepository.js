// اعلان‌های درون‌پنلی. SQL فقط اینجاست.
// S4-5a: ثبت (insert) و وضعیت تلگرام. S4-5b: فهرست/شمارنده/علامت خوانده/پاک‌سازی.
// ⚠️ توابع خواندن/علامت‌زدن عمداً userId «الزامی» می‌گیرند و همیشه با شرط user_id اجرا می‌شوند؛ اسکوپ «فقط خودش» همین‌جا تضمین است.

const { getDb } = require('../db/connection');

const TELEGRAM_STATUSES = ['none', 'sent', 'failed', 'skipped'];

function parseRow(row) {
  if (!row) return null;
  let data = null;
  try { data = row.data == null ? null : JSON.parse(row.data); } catch (_) { data = null; }
  return { ...row, data };
}

function findById(id) {
  return parseRow(getDb().prepare('SELECT * FROM notifications WHERE id = ?').get(id));
}

function findByDedupe(userId, dedupeKey) {
  return parseRow(
    getDb().prepare('SELECT * FROM notifications WHERE user_id = ? AND dedupe_key = ?').get(userId, dedupeKey)
  );
}

/**
 * درج اعلان با dedupe روی (userId, dedupeKey) وقتی dedupeKey داده شده باشد (بدون کلید ⇒ همیشه ساخته می‌شود).
 * @returns {{created: boolean, notification: object}} اگر مشابهش از قبل بود created=false و همان رکورد قبلی (بدون تغییر) برمی‌گردد.
 */
function insert({ userId, type, title, body = null, link = null, data = null, dedupeKey = null }) {
  const db = getDb();
  const res = db
    .prepare(
      `INSERT OR IGNORE INTO notifications (user_id, type, title, body, link, data, dedupe_key)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(userId, type, title, body, link, data == null ? null : JSON.stringify(data), dedupeKey);
  if (res.changes === 1) return { created: true, notification: findById(res.lastInsertRowid) };
  return { created: false, notification: findByDedupe(userId, dedupeKey) };
}

function setTelegramStatus(id, status) {
  if (!TELEGRAM_STATUSES.includes(status)) throw new RangeError('telegram_status نامعتبر است.');
  getDb().prepare('UPDATE notifications SET telegram_status = ? WHERE id = ?').run(status, id);
  return findById(id);
}

function assertUserId(userId) {
  if (!Number.isInteger(userId) || userId <= 0) throw new TypeError('userId باید شناسه‌ی عددی مثبت باشد.');
}

/**
 * فهرست اعلان‌های یک کاربر، جدیدترین اول (id نزولی). صفحه‌بندی با beforeId (فقط اعلان‌های با id کوچک‌تر).
 * @returns {object[]}
 */
function listForUser(userId, { unreadOnly = false, limit = 30, beforeId = null } = {}) {
  assertUserId(userId);
  const lim = Math.min(Math.max(parseInt(limit, 10) || 30, 1), 100);
  const where = ['user_id = ?'];
  const params = [userId];
  if (unreadOnly) where.push('read_at IS NULL');
  if (beforeId != null) {
    where.push('id < ?');
    params.push(beforeId);
  }
  return getDb()
    .prepare(`SELECT * FROM notifications WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ?`)
    .all(...params, lim)
    .map(parseRow);
}

function countUnread(userId) {
  assertUserId(userId);
  return getDb().prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(userId).n;
}

/** علامت خوانده‌شدن یک اعلانِ «خود کاربر». idempotent (زمان خواندن اول حفظ می‌شود). اعلانِ دیگران/ناموجود ⇒ null. */
function markRead(userId, id) {
  assertUserId(userId);
  const db = getDb();
  if (!db.prepare('SELECT 1 AS x FROM notifications WHERE id = ? AND user_id = ?').get(id, userId)) return null;
  db.prepare(
    "UPDATE notifications SET read_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND user_id = ? AND read_at IS NULL"
  ).run(id, userId);
  return findById(id);
}

/** همه‌ی اعلان‌های خوانده‌نشده‌ی «خود کاربر» ⇒ خوانده. تعداد تغییرکرده را برمی‌گرداند. */
function markAllRead(userId) {
  assertUserId(userId);
  return getDb()
    .prepare(
      "UPDATE notifications SET read_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE user_id = ? AND read_at IS NULL"
    )
    .run(userId).changes;
}

// پاک‌سازی (S2-7a/S4-5b): فقط اعلان‌های «خوانده‌شده»‌ی ساخته‌شده قبل از cutoff (ISO). خوانده‌نشده هرگز حذف نمی‌شود.
function countPurgeable(cutoffIso) {
  return getDb()
    .prepare('SELECT COUNT(*) AS n FROM notifications WHERE read_at IS NOT NULL AND created_at < ?')
    .get(cutoffIso).n;
}

function purgeOlderThan(cutoffIso) {
  return getDb().prepare('DELETE FROM notifications WHERE read_at IS NOT NULL AND created_at < ?').run(cutoffIso).changes;
}

module.exports = {
  insert, findById, findByDedupe, setTelegramStatus, TELEGRAM_STATUSES,
  listForUser, countUnread, markRead, markAllRead, countPurgeable, purgeOlderThan,
};

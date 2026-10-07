// اعلان‌های درون‌پنلی (S4-5a). SQL فقط اینجاست. این لایه فقط «ثبت» و وضعیت تلگرام را دارد؛
// فهرست/شمارنده/علامت خوانده/پاک‌سازی در S4-5b اضافه می‌شود.

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

module.exports = { insert, findById, findByDedupe, setTelegramStatus, TELEGRAM_STATUSES };

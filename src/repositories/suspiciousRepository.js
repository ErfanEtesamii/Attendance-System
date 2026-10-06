// موارد مشکوک (S2-4a). SQL فقط اینجاست. این لایه فقط «ثبت‌کننده» است؛ قاعده‌ها در S2-4b..d می‌آیند.
// ⚠️ هر مورد یک «نشانه» است نه اتهام؛ ثبت آن هرگز نباید روی ثبت تردد اثر بگذارد (فراخواننده خطا را می‌بلعد، S2-4e).

const { getDb } = require('../db/connection');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TYPE_RE = /^[a-z][a-z0-9_]{1,63}$/;

function normalizeIds(list, label) {
  if (!Array.isArray(list)) throw new Error(`${label} باید آرایه باشد.`);
  const out = [...new Set(list.map((n) => Number(n)))];
  if (out.some((n) => !Number.isInteger(n) || n <= 0)) throw new Error(`${label} باید فقط شامل شناسه‌های عددی مثبت باشد.`);
  return out.sort((a, b) => a - b);
}

function parseRow(row) {
  if (!row) return null;
  const parse = (s, fallback) => {
    try { return s == null ? fallback : JSON.parse(s); } catch (_) { return fallback; }
  };
  return { ...row, user_ids: parse(row.user_ids, []), record_ids: parse(row.record_ids, []), details: parse(row.details, null) };
}

function getById(id) {
  return parseRow(getDb().prepare('SELECT * FROM suspicious_events WHERE id = ?').get(id));
}

/**
 * ثبت یک مورد مشکوک با dedupe روی (نوع، کاربران، تاریخ).
 * @returns {{created: boolean, event: object}} اگر مشابهش از قبل بود created=false و همان رکورد قبلی برمی‌گردد (بدون تغییر).
 */
function create({ eventType, userIds, recordIds = [], eventDate, details = null }) {
  if (typeof eventType !== 'string' || !TYPE_RE.test(eventType)) throw new Error('eventType نامعتبر است.');
  if (typeof eventDate !== 'string' || !DATE_RE.test(eventDate)) throw new Error('eventDate باید YYYY-MM-DD باشد.');
  const users = normalizeIds(userIds, 'userIds');
  if (users.length === 0) throw new Error('userIds نباید خالی باشد.');
  const records = normalizeIds(recordIds, 'recordIds');
  const userJson = JSON.stringify(users);
  const detailsJson = details == null ? null : JSON.stringify(details);

  const db = getDb();
  const res = db
    .prepare(
      `INSERT OR IGNORE INTO suspicious_events (event_type, user_ids, record_ids, event_date, details)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(eventType, userJson, JSON.stringify(records), eventDate, detailsJson);
  if (res.changes === 1) return { created: true, event: getById(res.lastInsertRowid) };
  const existing = db
    .prepare('SELECT * FROM suspicious_events WHERE event_type = ? AND user_ids = ? AND event_date = ?')
    .get(eventType, userJson, eventDate);
  return { created: false, event: parseRow(existing) };
}

module.exports = { create, getById };

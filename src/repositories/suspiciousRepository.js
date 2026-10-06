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

const STATUSES = ['open', 'reviewed', 'ignored'];

/**
 * فهرست موارد مشکوک با فیلتر وضعیت و بازه‌ی تاریخ رویداد (S2-5a). فقط خواندنی.
 * اسکوپ نقش (سرپرست) در لایه‌ی route اعمال می‌شود چون user_ids داخل JSON است.
 * @param {{status?: string, from?: string, to?: string, limit?: number}} filters
 */
function list({ status, from, to, limit = 200 } = {}) {
  const where = [];
  const params = [];
  if (status) {
    if (!STATUSES.includes(status)) throw new Error('status نامعتبر است.');
    where.push('status = ?');
    params.push(status);
  }
  if (from) {
    if (!DATE_RE.test(from)) throw new Error('from باید YYYY-MM-DD باشد.');
    where.push('event_date >= ?');
    params.push(from);
  }
  if (to) {
    if (!DATE_RE.test(to)) throw new Error('to باید YYYY-MM-DD باشد.');
    where.push('event_date <= ?');
    params.push(to);
  }
  const lim = Math.min(Math.max(parseInt(limit, 10) || 200, 1), 1000);
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return getDb()
    .prepare(`SELECT * FROM suspicious_events ${clause} ORDER BY event_date DESC, id DESC LIMIT ?`)
    .all(...params, lim)
    .map(parseRow);
}

/**
 * ثبت نتیجه‌ی بررسی یک مورد (reviewed | ignored). دلیل در audit_log نگه داشته می‌شود (جدول ستون دلیل ندارد).
 * @returns {object|null} رکورد به‌روز، یا null اگر id وجود نداشت.
 */
function markReviewed(id, { status, reviewedBy }) {
  if (status !== 'reviewed' && status !== 'ignored') throw new Error('status باید reviewed یا ignored باشد.');
  const res = getDb()
    .prepare(
      `UPDATE suspicious_events
          SET status = ?, reviewed_by = ?, reviewed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ?`
    )
    .run(status, reviewedBy == null ? null : Number(reviewedBy), id);
  return res.changes === 1 ? getById(id) : null;
}

module.exports = { create, getById, list, markReviewed, STATUSES };

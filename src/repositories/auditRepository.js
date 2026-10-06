const { getDb } = require('../db/connection');

// این لاگ عمداً هیچ تابع update/delete ندارد؛ طبق سند باید غیرقابل‌ویرایش باقی بماند.
function logEvent({ userId = null, action, ipAddress = null, details = null }) {
  const db = getDb();
  const detailsStr = details && typeof details === 'object' ? JSON.stringify(details) : details;
  const result = db
    .prepare(
      `INSERT INTO audit_log (user_id, action, ip_address, details)
       VALUES (?, ?, ?, ?)`
    )
    .run(userId, action, ipAddress, detailsStr);
  return db.prepare('SELECT * FROM audit_log WHERE id = ?').get(result.lastInsertRowid);
}

function listByUser(userId, limit = 100) {
  const db = getDb();
  return db
    .prepare('SELECT * FROM audit_log WHERE user_id = ? ORDER BY occurred_at DESC LIMIT ?')
    .all(userId, limit);
}

function listRecent(limit = 200) {
  const db = getDb();
  return db.prepare('SELECT * FROM audit_log ORDER BY occurred_at DESC LIMIT ?').all(limit);
}

// جستجوی چندفیلتری برای پنل وب (فقط خواندنی - لاگ همچنان غیرقابل‌ویرایش است)
function search({ userId, action, from, to, q, limit = 200 } = {}) {
  const db = getDb();
  const where = [];
  const params = [];
  if (userId) { where.push('user_id = ?'); params.push(userId); }
  if (action) { where.push('action = ?'); params.push(action); }
  if (from) { where.push('date(occurred_at) >= ?'); params.push(from); }
  if (to) { where.push('date(occurred_at) <= ?'); params.push(to); }
  if (q) {
    where.push('(details LIKE ? OR action LIKE ? OR ip_address LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return db
    .prepare(`SELECT * FROM audit_log ${clause} ORDER BY occurred_at DESC, id DESC LIMIT ?`)
    .all(...params, limit);
}

// خلاصه‌ی رکوردهای «قدیمی‌تر از cutoff» برای dry-run آرشیو (S2-6b). فقط خواندنی.
// cutoff به قالب ذخیره‌ی occurred_at (YYYY-MM-DD HH:MM:SS) است؛ مقایسه‌ی متنی مستقیم تا ایندکس idx_audit_occurred کار کند.
function summarizeOlderThan(cutoff) {
  if (typeof cutoff !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(cutoff)) {
    throw new Error('cutoff باید YYYY-MM-DD HH:MM:SS باشد.');
  }
  const row = getDb()
    .prepare('SELECT COUNT(*) AS count, MIN(occurred_at) AS oldest, MAX(occurred_at) AS newest FROM audit_log WHERE occurred_at < ?')
    .get(cutoff);
  return { count: row.count, oldest: row.oldest || null, newest: row.newest || null };
}

function listActions() {
  return getDb()
    .prepare('SELECT action, COUNT(*) AS count FROM audit_log GROUP BY action ORDER BY count DESC')
    .all();
}

module.exports = { logEvent, listByUser, listRecent, search, listActions, summarizeOlderThan };

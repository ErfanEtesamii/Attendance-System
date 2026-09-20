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

module.exports = { logEvent, listByUser, listRecent };

// D1 (فاز ۱۲): دسترسی به checkin_permissions — فقط SQL؛ قواعد (اسکوپ، سقف تأخیر، TTL) در services/lateLimitService.
const { getDb } = require('../db/connection');

const COLS = 'id, user_id, permission_date, status, reason, requested_at, decided_by, decided_at, decision_note, expires_at, used_at';

function findById(id) {
  return getDb().prepare(`SELECT ${COLS} FROM checkin_permissions WHERE id = ?`).get(id) || null;
}

// ردیفِ «فعال» (pending/approved) یک کاربر در یک تاریخ؛ حداکثر یکی (ایندکس یکتا)
function findActive(userId, date) {
  return getDb().prepare(`SELECT ${COLS} FROM checkin_permissions WHERE user_id = ? AND permission_date = ? AND status IN ('pending', 'approved')`).get(userId, date) || null;
}

// آخرین ردیفِ هر وضعیتی برای (کاربر، تاریخ) — برای نمایش «ردشده» به کارمند
function findLatest(userId, date) {
  return getDb().prepare(`SELECT ${COLS} FROM checkin_permissions WHERE user_id = ? AND permission_date = ? ORDER BY id DESC LIMIT 1`).get(userId, date) || null;
}

// ثبت درخواست ⇒ ردیف. تکراریِ فعال ⇒ استثنای SQLITE_CONSTRAINT (سرویس به ۴۰۹ تبدیل می‌کند)
function insert({ userId, date, reason, requestedAt }) {
  const info = getDb().prepare("INSERT INTO checkin_permissions (user_id, permission_date, status, reason, requested_at) VALUES (?, ?, 'pending', ?, ?)").run(userId, date, reason, requestedAt);
  return findById(Number(info.lastInsertRowid));
}

// تصمیم روی درخواستِ pending (اتمی: اگر دیگر pending نباشد false)
function decide(id, { approve, decidedBy, decidedAt, note, expiresAt }) {
  const info = getDb()
    .prepare("UPDATE checkin_permissions SET status = ?, decided_by = ?, decided_at = ?, decision_note = ?, expires_at = ? WHERE id = ? AND status = 'pending'")
    .run(approve ? 'approved' : 'rejected', decidedBy, decidedAt, note, approve ? expiresAt : null, id);
  return info.changes > 0;
}

// مصرف اجازه‌ی approved با ورود موفق (اتمی: فقط یک‌بار)
function markUsed(id, usedAt) {
  return getDb().prepare("UPDATE checkin_permissions SET status = 'used', used_at = ? WHERE id = ? AND status = 'approved'").run(usedAt, id).changes > 0;
}

// منقضی‌کردن: approvedهای گذشته از expires_at و pendingهای مربوط به روز قبل از today (برای یک کاربر یا همه)
function expireStale({ nowIso, today, userId = null }) {
  const db = getDb();
  const u = userId === null ? '' : ' AND user_id = ?';
  const args = (a) => (userId === null ? a : [...a, userId]);
  const a = db.prepare(`UPDATE checkin_permissions SET status = 'expired' WHERE status = 'approved' AND expires_at IS NOT NULL AND expires_at <= ?${u}`).run(...args([nowIso])).changes;
  const p = db.prepare(`UPDATE checkin_permissions SET status = 'expired' WHERE status = 'pending' AND permission_date < ?${u}`).run(...args([today])).changes;
  return a + p;
}

// فهرست برای صف سرپرست/ادمین: فیلتر وضعیت و مجموعه‌ی کاربران (null = همه)؛ جدیدترین اول
function list({ status = null, userIds = null, limit = 200 } = {}) {
  const where = [];
  const args = [];
  if (status) { where.push('status = ?'); args.push(status); }
  if (userIds) {
    if (!userIds.length) return [];
    where.push(`user_id IN (${userIds.map(() => '?').join(',')})`);
    args.push(...userIds);
  }
  return getDb().prepare(`SELECT ${COLS} FROM checkin_permissions ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`).all(...args, limit);
}

module.exports = { findById, findActive, findLatest, insert, decide, markUsed, expireStale, list };

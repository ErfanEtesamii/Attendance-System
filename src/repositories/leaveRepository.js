const { getDb } = require('../db/connection');

function createLeaveRequest({ userId, startDate, endDate, leaveType, reason }) {
  const db = getDb();
  const result = db
    .prepare(
      `INSERT INTO leave_requests (user_id, start_date, end_date, leave_type, reason)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(userId, startDate, endDate, leaveType || 'leave', reason || null);
  return findById(result.lastInsertRowid);
}

function findById(id) {
  const db = getDb();
  return db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(id);
}

function listPending() {
  const db = getDb();
  return db.prepare("SELECT * FROM leave_requests WHERE status = 'pending' ORDER BY created_at").all();
}

function listByUser(userId) {
  const db = getDb();
  return db.prepare('SELECT * FROM leave_requests WHERE user_id = ? ORDER BY created_at DESC').all(userId);
}

function setStatus(id, status, approverId) {
  const db = getDb();
  db.prepare(
    `UPDATE leave_requests
     SET status = ?, approver_id = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(status, approverId, id);
  return findById(id);
}

// آیا برای این کاربر در این تاریخ یک «مأموریت تأییدشده» وجود دارد؟
// در فاز ۷ این تابع برای معاف کردن کاربر از چک IP فاز ۲ استفاده می‌شود.
function hasApprovedMissionOnDate(userId, dateStr) {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT * FROM leave_requests
       WHERE user_id = ? AND leave_type = 'mission' AND status = 'approved'
         AND ? BETWEEN start_date AND end_date`
    )
    .get(userId, dateStr);
  return Boolean(row);
}

module.exports = {
  createLeaveRequest,
  findById,
  listPending,
  listByUser,
  setStatus,
  hasApprovedMissionOnDate,
};

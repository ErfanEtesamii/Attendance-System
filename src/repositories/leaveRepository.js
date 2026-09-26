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

// برای پنل مدیریتی وب (فاز ۸): تاریخچه کامل یا فیلترشده بر اساس وضعیت
function listAll({ status } = {}) {
  const db = getDb();
  if (status) {
    return db
      .prepare('SELECT * FROM leave_requests WHERE status = ? ORDER BY created_at DESC')
      .all(status);
  }
  return db.prepare('SELECT * FROM leave_requests ORDER BY created_at DESC').all();
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

// آیا برای این کاربر در این تاریخ یک درخواست تأییدشده از نوع مشخص وجود دارد؟
// نسخه عمومی؛ هم برای مأموریت (استثنای فاز ۲) و هم برای مرخصی (رفع گپ «غایب» فاز ۵) استفاده می‌شود.
function hasApprovedLeaveOnDate(userId, dateStr, leaveType) {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT * FROM leave_requests
       WHERE user_id = ? AND leave_type = ? AND status = 'approved'
         AND ? BETWEEN start_date AND end_date`
    )
    .get(userId, leaveType, dateStr);
  return Boolean(row);
}

// آیا برای این کاربر در این تاریخ یک «مأموریت تأییدشده» وجود دارد؟
// در فاز ۷ این تابع برای معاف کردن کاربر از چک IP فاز ۲ استفاده می‌شود.
function hasApprovedMissionOnDate(userId, dateStr) {
  return hasApprovedLeaveOnDate(userId, dateStr, 'mission');
}

module.exports = {
  createLeaveRequest,
  findById,
  listPending,
  listAll,
  listByUser,
  setStatus,
  hasApprovedMissionOnDate,
  hasApprovedLeaveOnDate,
};

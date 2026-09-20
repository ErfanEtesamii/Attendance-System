const { getDb } = require('../db/connection');
const { nowIso, todayDateString } = require('../utils/serverTime');

function findTodayRecord(userId) {
  const db = getDb();
  return db
    .prepare('SELECT * FROM attendance_records WHERE user_id = ? AND record_date = ?')
    .get(userId, todayDateString());
}

function findById(id) {
  const db = getDb();
  return db.prepare('SELECT * FROM attendance_records WHERE id = ?').get(id);
}

function listByUserAndRange(userId, fromDate, toDate) {
  const db = getDb();
  return db
    .prepare(
      `SELECT * FROM attendance_records
       WHERE user_id = ? AND record_date BETWEEN ? AND ?
       ORDER BY record_date DESC`
    )
    .all(userId, fromDate, toDate);
}

// ثبت ورود: در صورت نبود رکورد امروز برای این کاربر، یکی می‌سازد.
// توجه: IP و timestamp همیشه در همین لایه (سمت سرور) تولید می‌شوند.
function recordCheckIn(userId, ip) {
  const db = getDb();
  const existing = findTodayRecord(userId);
  if (existing) return existing; // منطق «فقط یک بار در روز» در فاز API/بات نهایی می‌شود

  const result = db
    .prepare(
      `INSERT INTO attendance_records (user_id, record_date, check_in_time, check_in_ip, status)
       VALUES (?, ?, ?, ?, 'normal')`
    )
    .run(userId, todayDateString(), nowIso(), ip);
  return findById(result.lastInsertRowid);
}

function recordCheckOut(attendanceRecordId, ip) {
  const db = getDb();
  db.prepare(
    `UPDATE attendance_records
     SET check_out_time = ?, check_out_ip = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(nowIso(), ip, attendanceRecordId);
  return findById(attendanceRecordId);
}

function updateStatus(attendanceRecordId, status) {
  const db = getDb();
  db.prepare(
    `UPDATE attendance_records SET status = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(status, attendanceRecordId);
  return findById(attendanceRecordId);
}

module.exports = {
  findTodayRecord,
  findById,
  listByUserAndRange,
  recordCheckIn,
  recordCheckOut,
  updateStatus,
};

const { getDb } = require('../db/connection');

function createDispute({ userId, attendanceRecordId, message }) {
  const db = getDb();
  const result = db
    .prepare(
      `INSERT INTO record_disputes (user_id, attendance_record_id, message)
       VALUES (?, ?, ?)`
    )
    .run(userId, attendanceRecordId || null, message);
  return findById(result.lastInsertRowid);
}

function findById(id) {
  const db = getDb();
  return db.prepare('SELECT * FROM record_disputes WHERE id = ?').get(id);
}

function listByUser(userId) {
  const db = getDb();
  return db
    .prepare('SELECT * FROM record_disputes WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId);
}

// برای فاز ۸ (پنل مدیریتی وب) - لیست اعتراض‌های باز جهت بررسی ادمین
function listOpen() {
  const db = getDb();
  return db.prepare("SELECT * FROM record_disputes WHERE status = 'open' ORDER BY created_at").all();
}

function setStatus(id, status) {
  const db = getDb();
  db.prepare(
    `UPDATE record_disputes SET status = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(status, id);
  return findById(id);
}

function listAll({ status } = {}) {
  const db = getDb();
  if (status) {
    return db
      .prepare('SELECT * FROM record_disputes WHERE status = ? ORDER BY created_at DESC')
      .all(status);
  }
  return db.prepare('SELECT * FROM record_disputes ORDER BY created_at DESC').all();
}

module.exports = { listAll, createDispute, findById, listByUser, listOpen, setStatus };

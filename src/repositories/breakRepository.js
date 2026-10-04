const { getDb } = require('../db/connection');
const { nowIso } = require('../utils/serverTime');

function listByAttendanceRecord(attendanceRecordId) {
  const db = getDb();
  return db
    .prepare('SELECT * FROM break_records WHERE attendance_record_id = ? ORDER BY start_time')
    .all(attendanceRecordId);
}

function findOpenBreak(attendanceRecordId) {
  const db = getDb();
  return db
    .prepare('SELECT * FROM break_records WHERE attendance_record_id = ? AND end_time IS NULL')
    .get(attendanceRecordId);
}

function startBreak(attendanceRecordId, breakType = 'lunch') {
  const db = getDb();
  const result = db
    .prepare(
      `INSERT INTO break_records (attendance_record_id, break_type, start_time)
       VALUES (?, ?, ?)`
    )
    .run(attendanceRecordId, breakType, nowIso());
  return db.prepare('SELECT * FROM break_records WHERE id = ?').get(result.lastInsertRowid);
}

function endBreak(breakRecordId) {
  const db = getDb();
  db.prepare('UPDATE break_records SET end_time = ? WHERE id = ?').run(nowIso(), breakRecordId);
  return db.prepare('SELECT * FROM break_records WHERE id = ?').get(breakRecordId);
}

// مجموع دقیقه‌های استراحت یک رکورد روزانه (برای موتور محاسبه ساعت مفید در فاز ۵)
function totalBreakMinutes(attendanceRecordId) {
  const breaks = listByAttendanceRecord(attendanceRecordId);
  let totalMs = 0;
  for (const b of breaks) {
    if (b.end_time) {
      totalMs += new Date(b.end_time).getTime() - new Date(b.start_time).getTime();
    }
  }
  return Math.round(totalMs / 60000);
}

function findById(id) {
  const db = getDb();
  return db.prepare('SELECT * FROM break_records WHERE id = ?').get(id);
}

function createManual({ attendanceRecordId, breakType, startTime, endTime }) {
  const db = getDb();
  const result = db
    .prepare(
      `INSERT INTO break_records (attendance_record_id, break_type, start_time, end_time)
       VALUES (?, ?, ?, ?)`
    )
    .run(attendanceRecordId, breakType || 'lunch', startTime, endTime || null);
  return findById(result.lastInsertRowid);
}

function updateManual(id, fields) {
  const db = getDb();
  const allowed = ['break_type', 'start_time', 'end_time'];
  const keys = Object.keys(fields).filter((k) => allowed.includes(k) && fields[k] !== undefined);
  if (!keys.length) return findById(id);
  db.prepare(`UPDATE break_records SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(
    ...keys.map((k) => fields[k]),
    id
  );
  return findById(id);
}

function remove(id) {
  getDb().prepare('DELETE FROM break_records WHERE id = ?').run(id);
}

module.exports = {
  findById,
  createManual,
  updateManual,
  remove,
  listByAttendanceRecord,
  findOpenBreak,
  startBreak,
  endBreak,
  totalBreakMinutes,
};

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

// اصلاح دستی یک رکورد توسط ادمین (فاز ۳: دستور /fix_record ، فاز ۸: پنل وب).
// فقط لایه بالاتر (هندلر بات) مسئول محدود کردن این عملیات به نقش ادمین
// و ثبت اجباری «چه‌کسی/چه‌زمانی/چرا» در audit_log است؛ این تابع فقط خود آپدیت را انجام می‌دهد.
function manualUpdate(attendanceRecordId, fields) {
  const db = getDb();
  const allowed = ['check_in_time', 'check_out_time', 'status'];
  const keys = Object.keys(fields).filter((k) => allowed.includes(k) && fields[k] !== undefined);
  if (keys.length === 0) return findById(attendanceRecordId);

  const setClause = keys.map((k) => `${k} = ?`).join(', ');
  const values = keys.map((k) => fields[k]);
  db.prepare(
    `UPDATE attendance_records SET ${setClause}, updated_at = datetime('now') WHERE id = ?`
  ).run(...values, attendanceRecordId);
  return findById(attendanceRecordId);
}

// برای روزهای غیرکاری (تعطیل رسمی/مرخصی تأییدشده): اگر کارمند هنوز هیچ رکوردی برای این تاریخ
// ندارد، یک رکورد placeholder با status مناسب می‌سازد (بدون check_in_time) تا در گزارش‌ها به‌جای
// «غایب» به‌درستی نمایش داده شود. اگر رکوردی از قبل هست (مثلاً با وجود تعطیلی/مرخصی سر کار آمده و
// ورود ثبت کرده)، به لطف UNIQUE(user_id, record_date) دست‌نخورده باقی می‌ماند.
function ensureNonWorkingDayRecord(userId, dateStr, status) {
  const db = getDb();
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO attendance_records (user_id, record_date, status) VALUES (?, ?, ?)`
    )
    .run(userId, dateStr, status);
  return result.changes > 0;
}

// همه رکوردهای امروز (برای گزارش پایان روز و بررسی «ورود دیرهنگام»/«ناقص»)
function listAllToday() {
  const db = getDb();
  return db.prepare('SELECT * FROM attendance_records WHERE record_date = ?').all(todayDateString());
}

// رکوردهای «ناقص» تاریخ مشخص که خروج ثبت نشده (برای Job بستن خودکار پایان روز)
function listOpenRecordsByDate(dateStr) {
  const db = getDb();
  return db
    .prepare(
      `SELECT * FROM attendance_records WHERE record_date = ? AND check_in_time IS NOT NULL AND check_out_time IS NULL`
    )
    .all(dateStr);
}

module.exports = {
  findTodayRecord,
  findById,
  listByUserAndRange,
  recordCheckIn,
  recordCheckOut,
  updateStatus,
  manualUpdate,
  listAllToday,
  listOpenRecordsByDate,
  ensureNonWorkingDayRecord,
};

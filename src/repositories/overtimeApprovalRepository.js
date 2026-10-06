// تصمیم‌های تأیید/رد اضافه‌کاری (S3-5c). «معلق» ردیف ندارد؛ فقط تصمیم‌های approved/rejected ذخیره می‌شوند.
const { getDb } = require('../db/connection');

const STATUSES = ['approved', 'rejected'];

function findByRecordId(attendanceRecordId) {
  return getDb().prepare('SELECT * FROM overtime_approvals WHERE attendance_record_id = ?').get(attendanceRecordId);
}

// نقشه‌ی recordId ⇒ ردیف تصمیم برای چند رکورد (یک query؛ برای محاسبه‌ی ماهانه)
function mapByRecordIds(recordIds) {
  const map = new Map();
  const ids = (recordIds || []).filter((id) => Number.isInteger(id));
  const db = getDb();
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    db.prepare(`SELECT * FROM overtime_approvals WHERE attendance_record_id IN (${chunk.map(() => '?').join(',')})`)
      .all(...chunk).forEach((row) => map.set(row.attendance_record_id, row));
  }
  return map;
}

// ثبت یا تغییر تصمیم (UPSERT روی رکورد). رد بدون دلیل پذیرفته نمی‌شود؛ بررسی دلیل با route است، این‌جا فقط تضمین می‌شود.
function upsertDecision({ attendanceRecordId, userId, status, reason = null, decidedBy }) {
  if (!STATUSES.includes(status)) throw new RangeError('status باید approved یا rejected باشد.');
  if (status === 'rejected' && !(typeof reason === 'string' && reason.trim())) throw new RangeError('دلیل رد الزامی است.');
  const db = getDb();
  db.prepare(
    `INSERT INTO overtime_approvals (attendance_record_id, user_id, status, reason, decided_by)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(attendance_record_id) DO UPDATE SET
       status = excluded.status, reason = excluded.reason, decided_by = excluded.decided_by,
       decided_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`
  ).run(attendanceRecordId, userId, status, reason && reason.trim() ? reason.trim() : null, decidedBy);
  return findByRecordId(attendanceRecordId);
}

module.exports = { STATUSES, findByRecordId, mapByRecordIds, upsertDecision };

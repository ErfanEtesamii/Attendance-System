// B2 (فاز ۱۲): دسترسی به user_day_schedules — فقط SQL؛ اعتبارسنجی/دسترسی/قفل ماه در userScheduleService.
const { getDb } = require('../db/connection');

const COLS = 'id, user_id, schedule_date, kind, start_time, end_time, note, created_by, created_at, updated_at';

// ردیفِ یک روز یا null
function get(userId, date) {
  return getDb().prepare(`SELECT ${COLS} FROM user_day_schedules WHERE user_id = ? AND schedule_date = ?`).get(userId, date) || null;
}

// ردیف‌های یک کاربر در بازه‌ی [from, to] (شامل دو سر)، مرتب بر تاریخ
function listRange(userId, from, to) {
  return getDb().prepare(`SELECT ${COLS} FROM user_day_schedules WHERE user_id = ? AND schedule_date BETWEEN ? AND ? ORDER BY schedule_date`).all(userId, from, to);
}

// برای حلقه‌های دسته‌ای: یک‌بار می‌خواند؛ resolver(userId, date) ⇒ ردیف یا null (بدون کوئری). userIds خالی ⇒ همیشه null.
function makeResolver(userIds, from, to) {
  const map = new Map();
  if (userIds && userIds.length) {
    const rows = getDb()
      .prepare(`SELECT ${COLS} FROM user_day_schedules WHERE user_id IN (${userIds.map(() => '?').join(',')}) AND schedule_date BETWEEN ? AND ?`)
      .all(...userIds, from, to);
    rows.forEach((r) => map.set(`${r.user_id}|${r.schedule_date}`, r));
  }
  return (userId, date) => map.get(`${userId}|${date}`) || null;
}

// ثبت/جایگزینی (کاربر، تاریخ) ⇒ ردیف جدید
function upsert({ userId, date, kind, startTime = null, endTime = null, note = null, createdBy = null }) {
  const db = getDb();
  db.prepare(
    `INSERT INTO user_day_schedules (user_id, schedule_date, kind, start_time, end_time, note, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, schedule_date) DO UPDATE SET kind = excluded.kind, start_time = excluded.start_time, end_time = excluded.end_time,
       note = excluded.note, created_by = excluded.created_by, updated_at = datetime('now')`
  ).run(userId, date, kind, kind === 'work' ? startTime : null, kind === 'work' ? endTime : null, note, createdBy);
  return get(userId, date);
}

// حذف ⇒ true اگر ردیفی بود
function remove(userId, date) {
  return getDb().prepare('DELETE FROM user_day_schedules WHERE user_id = ? AND schedule_date = ?').run(userId, date).changes > 0;
}

module.exports = { get, listRange, makeResolver, upsert, remove };

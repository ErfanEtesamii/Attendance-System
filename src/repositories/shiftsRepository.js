// شیفت‌های کاری (S3-6a: ساختار و CRUD). موتور محاسبه از S3-6b شیفت کاربر را با findByUserId می‌خواند (dayService).
// خروجی همه‌ی توابع «شیء نرمال‌شده‌ی camelCase» است؛ work_days ذخیره‌شده‌ی خراب (JSON نامعتبر) ⇒ آرایه‌ی خالی، نه exception.

const { getDb } = require('../db/connection');

function parseWorkDays(text) {
  try {
    const v = JSON.parse(text);
    return Array.isArray(v) ? v.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort((a, b) => a - b) : [];
  } catch (_) {
    return [];
  }
}

function toShift(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    startTime: row.start_time,
    endTime: row.end_time,
    graceLateMinutes: row.grace_late_minutes,
    graceEarlyMinutes: row.grace_early_minutes,
    workDays: parseWorkDays(row.work_days),
    overnight: !!row.overnight,
    maxLunchMinutes: row.max_lunch_minutes,
    fixedLunchDeductMinutes: row.fixed_lunch_deduct_minutes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.user_count !== undefined ? { userCount: row.user_count } : {}),
  };
}

function listShifts() {
  const rows = getDb()
    .prepare(
      `SELECT s.*, (SELECT COUNT(*) FROM users u WHERE u.shift_id = s.id) AS user_count
         FROM work_shifts s ORDER BY s.name, s.id`
    )
    .all();
  return rows.map(toShift);
}

function findById(id) {
  return toShift(
    getDb()
      .prepare('SELECT s.*, (SELECT COUNT(*) FROM users u WHERE u.shift_id = s.id) AS user_count FROM work_shifts s WHERE s.id = ?')
      .get(id)
  );
}

// شیفت منتسب به یک کاربر (S3-6b)؛ بدون شیفت/کاربر ناموجود ⇒ null
function findByUserId(userId) {
  return toShift(
    getDb()
      .prepare('SELECT s.* FROM work_shifts s JOIN users u ON u.shift_id = s.id WHERE u.id = ?')
      .get(userId)
  );
}

function findByName(name) {
  return toShift(getDb().prepare('SELECT * FROM work_shifts WHERE name = ?').get(name));
}

function createShift(v) {
  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO work_shifts (name, start_time, end_time, grace_late_minutes, grace_early_minutes, work_days, overnight, max_lunch_minutes, fixed_lunch_deduct_minutes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(v.name, v.startTime, v.endTime, v.graceLateMinutes, v.graceEarlyMinutes, JSON.stringify(v.workDays), v.overnight ? 1 : 0, v.maxLunchMinutes, v.fixedLunchDeductMinutes);
  return findById(info.lastInsertRowid);
}

const COLUMN_OF = {
  name: 'name',
  startTime: 'start_time',
  endTime: 'end_time',
  graceLateMinutes: 'grace_late_minutes',
  graceEarlyMinutes: 'grace_early_minutes',
  workDays: 'work_days',
  overnight: 'overnight',
  maxLunchMinutes: 'max_lunch_minutes',
  fixedLunchDeductMinutes: 'fixed_lunch_deduct_minutes',
};

// فقط کلیدهای شناخته‌شده‌ی camelCase؛ مقدار ستون‌ها از placeholder می‌آید (نه الحاق رشته).
function updateShift(id, fields) {
  const keys = Object.keys(fields).filter((k) => COLUMN_OF[k]);
  if (keys.length === 0) return findById(id);
  const setClause = keys.map((k) => `${COLUMN_OF[k]} = ?`).join(', ');
  const values = keys.map((k) => {
    if (k === 'workDays') return JSON.stringify(fields[k]);
    if (k === 'overnight') return fields[k] ? 1 : 0;
    return fields[k];
  });
  getDb().prepare(`UPDATE work_shifts SET ${setClause}, updated_at = datetime('now') WHERE id = ?`).run(...values, id);
  return findById(id);
}

function countUsers(id) {
  return getDb().prepare('SELECT COUNT(*) AS n FROM users WHERE shift_id = ?').get(id).n;
}

function listUsersOfShift(id) {
  return getDb()
    .prepare('SELECT id, full_name, personnel_code, department, role, is_active FROM users WHERE shift_id = ? ORDER BY full_name')
    .all(id);
}

// حذف فقط وقتی کسی به شیفت منتسب نیست (وگرنه false و هیچ تغییری)؛ در یک تراکنش تا بین شمارش و حذف رقابتی نباشد.
function deleteShiftIfUnused(id) {
  const db = getDb();
  return db.transaction((shiftId) => {
    if (countUsers(shiftId) > 0) return false;
    return db.prepare('DELETE FROM work_shifts WHERE id = ?').run(shiftId).changes > 0;
  })(id);
}

module.exports = { listShifts, findById, findByUserId, findByName, createShift, updateShift, countUsers, listUsersOfShift, deleteShiftIfUnused };

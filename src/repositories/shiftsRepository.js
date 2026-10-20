// شیفت‌های کاری (S3-6a: ساختار و CRUD). موتور محاسبه از S3-6b شیفت کاربر را با findByUserId می‌خواند (dayService).
// خروجی همه‌ی توابع «شیء نرمال‌شده‌ی camelCase» است؛ work_days ذخیره‌شده‌ی خراب (JSON نامعتبر) ⇒ آرایه‌ی خالی، نه exception.

const { getDb } = require('../db/connection');
const { todayDateString } = require('../utils/serverTime');

const EARLIEST = '1970-01-01'; // effective_from «از ابتدا» (backfill migration ۰۲۸)
const isDate = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);

// SQL: شیفتِ مؤثر کاربر u در تاریخ ? (یک پارامتر) ⇒ شناسه‌ی شیفت یا NULL
// کاربری که هیچ ردیف انتسابی ندارد (مثلاً users.shift_id مستقیم ست شده) به آینه‌ی users.shift_id برمی‌گردد.
const EFFECTIVE_SHIFT_ID_SQL = `(CASE WHEN EXISTS (SELECT 1 FROM user_shift_assignments x WHERE x.user_id = u.id)
  THEN (SELECT a.shift_id FROM user_shift_assignments a WHERE a.user_id = u.id AND a.effective_from <= ? ORDER BY a.effective_from DESC LIMIT 1)
  ELSE u.shift_id END)`;

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
    paidBreakCount: row.paid_break_count === undefined ? null : row.paid_break_count, // C1: null = از تنظیمات سراسری
    paidBreakMinutes: row.paid_break_minutes === undefined ? null : row.paid_break_minutes,
    isUntimed: !!row.is_untimed,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.user_count !== undefined ? { userCount: row.user_count } : {}),
  };
}

// تعداد کاربرانی که «امروز» این شیفت را دارند (طبق تاریخ اعمال)
const USER_COUNT_SQL = `(SELECT COUNT(*) FROM users u WHERE ${EFFECTIVE_SHIFT_ID_SQL} = s.id)`;

function listShifts() {
  const rows = getDb()
    .prepare(`SELECT s.*, ${USER_COUNT_SQL} AS user_count FROM work_shifts s ORDER BY s.name, s.id`)
    .all(todayDateString());
  return rows.map(toShift);
}

function findById(id) {
  return toShift(getDb().prepare(`SELECT s.*, ${USER_COUNT_SQL} AS user_count FROM work_shifts s WHERE s.id = ?`).get(todayDateString(), id));
}

// شیفتِ مؤثر کاربر در یک روز (فاز ۱۲، B1): آخرین انتساب با effective_from ≤ date. بدون هیچ انتسابی ⇒ null (تنظیمات سراسری).
// date نامعتبر ⇒ امروز. کاربر ناموجود ⇒ null.
function shiftOn(userId, date) {
  const d = isDate(date) ? date : todayDateString();
  const db = getDb();
  if (!db.prepare('SELECT 1 AS x FROM user_shift_assignments WHERE user_id = ? LIMIT 1').get(userId)) {
    return toShift(db.prepare('SELECT s.* FROM work_shifts s JOIN users u ON u.shift_id = s.id WHERE u.id = ?').get(userId)); // بدون تاریخچه ⇒ آینه
  }
  return toShift(
    getDb()
      .prepare(
        `SELECT s.* FROM user_shift_assignments a JOIN work_shifts s ON s.id = a.shift_id
          WHERE a.user_id = ? AND a.effective_from = (SELECT MAX(b.effective_from) FROM user_shift_assignments b WHERE b.user_id = a.user_id AND b.effective_from <= ?)`
      )
      .get(userId, d)
  );
}

// شیفتِ «امروزِ» کاربر (S3-6b؛ سازگار با گذشته)؛ بدون شیفت/کاربر ناموجود ⇒ null
function findByUserId(userId) {
  return shiftOn(userId, todayDateString());
}

// برای حلقه‌های دسته‌ای (گزارش ماهانه/تقویم): یک‌بار همه‌ی انتساب‌ها را می‌خواند؛ resolver(userId, date) ⇒ شیفت یا null بدون کوئری.
function makeShiftResolver(userIds = null) {
  const db = getDb();
  const rows = (userIds && userIds.length
    ? db.prepare(`SELECT user_id, shift_id, effective_from FROM user_shift_assignments WHERE user_id IN (${userIds.map(() => '?').join(',')}) ORDER BY user_id, effective_from`).all(...userIds)
    : userIds ? [] : db.prepare('SELECT user_id, shift_id, effective_from FROM user_shift_assignments ORDER BY user_id, effective_from').all());
  const byUser = new Map();
  rows.forEach((r) => { if (!byUser.has(r.user_id)) byUser.set(r.user_id, []); byUser.get(r.user_id).push(r); });
  const shiftById = new Map(db.prepare('SELECT * FROM work_shifts').all().map((r) => [r.id, toShift(r)]));
  const mirror = new Map(db.prepare('SELECT id, shift_id FROM users WHERE shift_id IS NOT NULL').all().map((r) => [r.id, r.shift_id]));
  return (userId, date) => {
    const list = byUser.get(userId);
    if (!list) return mirror.has(userId) ? shiftById.get(mirror.get(userId)) || null : null; // بدون تاریخچه ⇒ آینه
    let pick = null;
    for (const a of list) { if (a.effective_from <= date) pick = a; else break; }
    return pick && pick.shift_id != null ? shiftById.get(pick.shift_id) || null : null;
  };
}

// انتساب «برای همه‌ی تاریخ‌ها» (رفتار قدیمی setUserShift): تاریخچه‌ی کاربر پاک و یک ردیف از ابتدا ساخته می‌شود (shiftId = null ⇒ بدون شیفت).
function setForAllDates(userId, shiftId) {
  const db = getDb();
  return db.transaction(() => {
    if (!db.prepare('SELECT 1 AS x FROM users WHERE id = ?').get(userId)) return 0; // کاربر ناموجود ⇒ بدون تغییر
    db.prepare('DELETE FROM user_shift_assignments WHERE user_id = ?').run(userId);
    if (shiftId != null) db.prepare('INSERT INTO user_shift_assignments (user_id, shift_id, effective_from) VALUES (?, ?, ?)').run(userId, shiftId, EARLIEST);
    return db.prepare("UPDATE users SET shift_id = ?, updated_at = datetime('now') WHERE id = ?").run(shiftId, userId).changes;
  })();
}

// تاریخچه‌ی انتساب‌های یک کاربر (قدیمی‌ترین اول)
function listAssignments(userId) {
  return getDb()
    .prepare('SELECT id, user_id, shift_id, effective_from, created_by, created_at FROM user_shift_assignments WHERE user_id = ? ORDER BY effective_from')
    .all(userId);
}

// انتساب شیفت (shiftId = عدد یا null) از effectiveFrom به بعد. همان (کاربر، تاریخ) ⇒ جایگزین. آینه‌ی users.shift_id برای «امروز» همگام می‌شود.
// ⇒ { before: شیفتِ مؤثر در effectiveFrom پیش از تغییر, after: بعد از تغییر }
function assignShift({ userId, shiftId, effectiveFrom, createdBy = null }) {
  const db = getDb();
  return db.transaction(() => {
    const before = shiftOn(userId, effectiveFrom);
    db.prepare(
      `INSERT INTO user_shift_assignments (user_id, shift_id, effective_from, created_by) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, effective_from) DO UPDATE SET shift_id = excluded.shift_id, created_by = excluded.created_by, created_at = datetime('now')`
    ).run(userId, shiftId, effectiveFrom, createdBy);
    const now = shiftOn(userId, todayDateString());
    db.prepare("UPDATE users SET shift_id = ?, updated_at = datetime('now') WHERE id = ?").run(now ? now.id : null, userId);
    return { before, after: shiftOn(userId, effectiveFrom) };
  })();
}

function findByName(name) {
  return toShift(getDb().prepare('SELECT * FROM work_shifts WHERE name = ?').get(name));
}

function createShift(v) {
  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO work_shifts (name, start_time, end_time, grace_late_minutes, grace_early_minutes, work_days, overnight, max_lunch_minutes, fixed_lunch_deduct_minutes, paid_break_count, paid_break_minutes, is_untimed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(v.name, v.startTime, v.endTime, v.graceLateMinutes, v.graceEarlyMinutes, JSON.stringify(v.workDays), v.overnight ? 1 : 0, v.maxLunchMinutes, v.fixedLunchDeductMinutes,
      v.paidBreakCount === undefined ? null : v.paidBreakCount, v.paidBreakMinutes === undefined ? null : v.paidBreakMinutes, v.isUntimed ? 1 : 0);
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
  paidBreakCount: 'paid_break_count',
  paidBreakMinutes: 'paid_break_minutes',
  isUntimed: 'is_untimed',
};

// فقط کلیدهای شناخته‌شده‌ی camelCase؛ مقدار ستون‌ها از placeholder می‌آید (نه الحاق رشته).
function updateShift(id, fields) {
  const keys = Object.keys(fields).filter((k) => COLUMN_OF[k]);
  if (keys.length === 0) return findById(id);
  const setClause = keys.map((k) => `${COLUMN_OF[k]} = ?`).join(', ');
  const values = keys.map((k) => {
    if (k === 'workDays') return JSON.stringify(fields[k]);
    if (k === 'overnight') return fields[k] ? 1 : 0;
    if (k === 'isUntimed') return fields[k] ? 1 : 0;
    return fields[k];
  });
  getDb().prepare(`UPDATE work_shifts SET ${setClause}, updated_at = datetime('now') WHERE id = ?`).run(...values, id);
  return findById(id);
}

function countUsers(id) {
  return getDb().prepare(`SELECT COUNT(*) AS n FROM users u WHERE ${EFFECTIVE_SHIFT_ID_SQL} = ?`).get(todayDateString(), id).n;
}

function listUsersOfShift(id) {
  return getDb()
    .prepare(`SELECT u.id, u.full_name, u.personnel_code, u.department, u.role, u.is_active FROM users u WHERE ${EFFECTIVE_SHIFT_ID_SQL} = ? ORDER BY u.full_name`)
    .all(todayDateString(), id);
}

// حذف فقط وقتی هیچ انتسابی (حتی تاریخچه‌ی قدیمی) به شیفت اشاره نمی‌کند (وگرنه false و هیچ تغییری)؛ در یک تراکنش تا بین شمارش و حذف رقابتی نباشد.
function deleteShiftIfUnused(id) {
  const db = getDb();
  return db.transaction((shiftId) => {
    if (countUsers(shiftId) > 0) return false;
    if (db.prepare('SELECT COUNT(*) AS n FROM user_shift_assignments WHERE shift_id = ?').get(shiftId).n > 0) return false;
    return db.prepare('DELETE FROM work_shifts WHERE id = ?').run(shiftId).changes > 0;
  })(id);
}

module.exports = {
  EARLIEST, listShifts, findById, findByUserId, shiftOn, makeShiftResolver, listAssignments, assignShift, setForAllDates, findByName, createShift, updateShift,
  countUsers, listUsersOfShift, deleteShiftIfUnused,
};

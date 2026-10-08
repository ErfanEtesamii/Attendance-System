// ledger مانده‌ی مرخصی (S4-9a). SQL فقط اینجا. همه‌ی مقادیر «دقیقه». مانده ذخیره نمی‌شود؛ از این توابع محاسبه می‌شود (leaveBalanceService).
const { getDb } = require('../db/connection');

const toBalance = (r) => (r ? { id: r.id, userId: r.user_id, leaveTypeId: r.leave_type_id, jalaliYear: r.jalali_year, entitledMinutes: r.entitled_minutes, carriedOverMinutes: r.carried_over_minutes, createdAt: r.created_at, updatedAt: r.updated_at } : null);
const toAdjustment = (r) => ({ id: r.id, userId: r.user_id, leaveTypeId: r.leave_type_id, jalaliYear: r.jalali_year, minutes: r.minutes, reason: r.reason, actorId: r.actor_id, createdAt: r.created_at });

function findBalance(userId, leaveTypeId, jalaliYear) {
  return toBalance(getDb().prepare('SELECT * FROM leave_balances WHERE user_id = ? AND leave_type_id = ? AND jalali_year = ?').get(userId, leaveTypeId, jalaliYear));
}

// ایجاد یا به‌روزرسانیِ استحقاق/انتقالی یک (کاربر، نوع، سال). فقط مقدارهای داده‌شده (undefined) عوض می‌شوند.
function upsertBalance({ userId, leaveTypeId, jalaliYear, entitledMinutes, carriedOverMinutes }) {
  const db = getDb();
  const existing = findBalance(userId, leaveTypeId, jalaliYear);
  if (!existing) {
    db.prepare('INSERT INTO leave_balances (user_id, leave_type_id, jalali_year, entitled_minutes, carried_over_minutes) VALUES (?, ?, ?, ?, ?)')
      .run(userId, leaveTypeId, jalaliYear, entitledMinutes === undefined ? 0 : entitledMinutes, carriedOverMinutes === undefined ? 0 : carriedOverMinutes);
  } else {
    db.prepare("UPDATE leave_balances SET entitled_minutes = ?, carried_over_minutes = ?, updated_at = datetime('now') WHERE id = ?")
      .run(entitledMinutes === undefined ? existing.entitledMinutes : entitledMinutes, carriedOverMinutes === undefined ? existing.carriedOverMinutes : carriedOverMinutes, existing.id);
  }
  return findBalance(userId, leaveTypeId, jalaliYear);
}

function addAdjustment({ userId, leaveTypeId, jalaliYear, minutes, reason, actorId }) {
  const db = getDb();
  const info = db
    .prepare('INSERT INTO leave_balance_adjustments (user_id, leave_type_id, jalali_year, minutes, reason, actor_id) VALUES (?, ?, ?, ?, ?, ?)')
    .run(userId, leaveTypeId, jalaliYear, minutes, reason, actorId === undefined ? null : actorId);
  return toAdjustment(db.prepare('SELECT * FROM leave_balance_adjustments WHERE id = ?').get(info.lastInsertRowid));
}

function listAdjustments(userId, leaveTypeId, jalaliYear) {
  return getDb()
    .prepare('SELECT * FROM leave_balance_adjustments WHERE user_id = ? AND leave_type_id = ? AND jalali_year = ? ORDER BY id')
    .all(userId, leaveTypeId, jalaliYear)
    .map(toAdjustment);
}

function sumAdjustments(userId, leaveTypeId, jalaliYear) {
  return getDb()
    .prepare('SELECT COALESCE(SUM(minutes), 0) AS total FROM leave_balance_adjustments WHERE user_id = ? AND leave_type_id = ? AND jalali_year = ?')
    .get(userId, leaveTypeId, jalaliYear).total;
}

// مصرف: درخواست‌های «approved» (status = 'pending' برای «رزرو» درخواست‌های در انتظار، S4-10a) این کاربر و این نوع که start_date آن‌ها در [from, to] (بازه‌ی میلادیِ سال شمسی) است.
// ⇒ { minutes: مجموع duration_minutes، count، missingDuration: تعداد درخواست‌هایی که duration_minutes ندارند (در مجموع نیامده‌اند) }
function sumApprovedUsage(userId, leaveTypeId, from, to, status = 'approved') {
  const row = getDb()
    .prepare(
      `SELECT COALESCE(SUM(duration_minutes), 0) AS minutes, COUNT(*) AS count,
              COALESCE(SUM(CASE WHEN duration_minutes IS NULL THEN 1 ELSE 0 END), 0) AS missing
       FROM leave_requests
       WHERE user_id = ? AND leave_type_id = ? AND status = ? AND start_date BETWEEN ? AND ?`
    )
    .get(userId, leaveTypeId, status, from, to);
  return { minutes: row.minutes, count: row.count, missingDuration: row.missing };
}

module.exports = { findBalance, upsertBalance, addAdjustment, listAdjustments, sumAdjustments, sumApprovedUsage };

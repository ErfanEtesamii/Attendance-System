// تعدیل دستی حقوق ماهانه (migration 062). minutes امضادار: منفی = کسر، مثبت = اضافه.
const { getDb } = require('../db/connection');

const map = (r) => ({ id: r.id, userId: r.user_id, year: r.jalali_year, month: r.jalali_month, minutes: r.minutes, reason: r.reason, createdBy: r.created_by, createdAt: r.created_at });

function listForUser(userId, year, month) {
  return getDb().prepare('SELECT * FROM payroll_adjustments WHERE user_id = ? AND jalali_year = ? AND jalali_month = ? ORDER BY id').all(userId, year, month).map(map);
}

// Map<userId, مجموع دقیقه> برای یک ماه
function totalsForMonth(year, month) {
  const out = new Map();
  for (const r of getDb().prepare('SELECT user_id, SUM(minutes) AS m FROM payroll_adjustments WHERE jalali_year = ? AND jalali_month = ? GROUP BY user_id').all(year, month)) out.set(r.user_id, r.m);
  return out;
}

function add({ userId, year, month, minutes, reason, createdBy }) {
  const info = getDb().prepare('INSERT INTO payroll_adjustments (user_id, jalali_year, jalali_month, minutes, reason, created_by) VALUES (?, ?, ?, ?, ?, ?)').run(userId, year, month, minutes, reason, createdBy || null);
  return map(getDb().prepare('SELECT * FROM payroll_adjustments WHERE id = ?').get(info.lastInsertRowid));
}

function findById(id) {
  const r = getDb().prepare('SELECT * FROM payroll_adjustments WHERE id = ?').get(id);
  return r ? map(r) : null;
}

function remove(id) {
  return getDb().prepare('DELETE FROM payroll_adjustments WHERE id = ?').run(id).changes > 0;
}

module.exports = { listForUser, totalsForMonth, add, findById, remove };

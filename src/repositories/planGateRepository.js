// معافیت یک‌باره‌ی گیت برنامه‌ی هفتگی (D5). SQL فقط اینجاست.
const { getDb } = require('../db/connection');

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

function find(userId, weekStart) {
  return getDb().prepare('SELECT * FROM plan_gate_exemptions WHERE user_id = ? AND week_start_date = ?').get(userId, weekStart) || null;
}

function findUnused(userId, weekStart) {
  return getDb().prepare('SELECT * FROM plan_gate_exemptions WHERE user_id = ? AND week_start_date = ? AND used_at IS NULL').get(userId, weekStart) || null;
}

function create({ userId, weekStart, grantedBy, reason }) {
  getDb().prepare('INSERT INTO plan_gate_exemptions (user_id, week_start_date, granted_by, reason) VALUES (?, ?, ?, ?)').run(userId, weekStart, grantedBy, reason);
  return find(userId, weekStart);
}

// مصرف یک‌باره: فقط اگر هنوز مصرف نشده؛ true = همین فراخوانی مصرف کرد
function consume(id, recordId) {
  return getDb().prepare(`UPDATE plan_gate_exemptions SET used_at = ${NOW}, used_record_id = ? WHERE id = ? AND used_at IS NULL`).run(recordId, id).changes === 1;
}

module.exports = { find, findUnused, create, consume };

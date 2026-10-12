// پاسخ روزانه به تسک‌ها (D1). یکی برای هر (تسک، روز)؛ پاسخ دوباره = به‌روزرسانی همان ردیف.
const { getDb } = require('../db/connection');

function findByTaskDate(taskId, logDate) {
  return getDb().prepare('SELECT * FROM task_daily_logs WHERE task_id = ? AND log_date = ?').get(taskId, logDate) || null;
}

function upsert({ taskId, userId, logDate, status, reasonCode = null, reasonText = null, rescheduleTo = null, encouragementText = null, answeredLate = false }) {
  getDb().prepare(`INSERT INTO task_daily_logs (task_id, user_id, log_date, status, reason_code, reason_text, reschedule_to, encouragement_text, answered_late)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (task_id, log_date) DO UPDATE SET status = excluded.status, reason_code = excluded.reason_code, reason_text = excluded.reason_text,
      reschedule_to = excluded.reschedule_to, encouragement_text = excluded.encouragement_text, answered_late = excluded.answered_late,
      answered_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`).run(taskId, userId, logDate, status, reasonCode, reasonText, rescheduleTo, encouragementText, answeredLate ? 1 : 0);
  return findByTaskDate(taskId, logDate);
}

function listByUserDate(userId, logDate) {
  return getDb().prepare('SELECT * FROM task_daily_logs WHERE user_id = ? AND log_date = ? ORDER BY id').all(userId, logDate);
}

function listByUserRange(userId, fromDate, toDate) {
  return getDb().prepare('SELECT * FROM task_daily_logs WHERE user_id = ? AND log_date BETWEEN ? AND ? ORDER BY log_date, id').all(userId, fromDate, toDate);
}

// شناسه‌ی کاربرانی (از میان userIds) که در این روز حداقل یک پاسخ/گزارش دارند — «دارای گزارش» در D9
function listUserIdsWithLogsOnDate(userIds, logDate) {
  if (!Array.isArray(userIds) || !userIds.length) return [];
  return getDb().prepare(`SELECT DISTINCT user_id FROM task_daily_logs WHERE log_date = ? AND user_id IN (${userIds.map(() => '?').join(',')})`).all(logDate, ...userIds).map((r) => r.user_id);
}

function listByTask(taskId) {
  return getDb().prepare('SELECT * FROM task_daily_logs WHERE task_id = ? ORDER BY log_date').all(taskId);
}

// انتقال‌هایی که به این روز اشاره دارند (reschedule_to = date) و هنوز تسک در همان روز پاسخ ندارد
function listRescheduledTo(userId, date) {
  return getDb().prepare('SELECT * FROM task_daily_logs WHERE user_id = ? AND reschedule_to = ? ORDER BY id').all(userId, date);
}

// متن پیام‌های ذخیره‌شده‌ی اخیرِ کاربر (جدیدترین اول) برای جلوگیری از تکرار پیام تشویقی (D8)
function listRecentEncouragements(userId, limit = 30) {
  return getDb().prepare(`SELECT encouragement_text FROM task_daily_logs
    WHERE user_id = ? AND encouragement_text IS NOT NULL AND encouragement_text <> ''
    ORDER BY answered_at DESC, id DESC LIMIT ?`).all(userId, limit).map((r) => r.encouragement_text);
}

function remove(taskId, logDate) {
  return getDb().prepare('DELETE FROM task_daily_logs WHERE task_id = ? AND log_date = ?').run(taskId, logDate).changes;
}

module.exports = { findByTaskDate, upsert, listByUserDate, listByUserRange, listUserIdsWithLogsOnDate, listByTask, listRescheduledTo, listRecentEncouragements, remove };

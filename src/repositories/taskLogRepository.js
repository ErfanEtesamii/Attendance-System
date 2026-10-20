// پاسخ روزانه به تسک‌ها (D1). یکی برای هر (تسک، روز)؛ پاسخ دوباره = به‌روزرسانی همان ردیف.
const { getDb } = require('../db/connection');

function findByTaskDate(taskId, logDate) {
  return getDb().prepare('SELECT * FROM task_daily_logs WHERE task_id = ? AND log_date = ?').get(taskId, logDate) || null;
}

// note (A1، فاز ۱۵): توضیحِ انجام؛ فقط برای done معنا دارد و پیش‌فرضش null است (پاسخ دوباره = جایگزینیِ کاملِ ردیف، note هم).
function upsert({ taskId, userId, logDate, status, reasonCode = null, reasonText = null, rescheduleTo = null, encouragementText = null, answeredLate = false, note = null }) {
  getDb().prepare(`INSERT INTO task_daily_logs (task_id, user_id, log_date, status, reason_code, reason_text, reschedule_to, encouragement_text, answered_late, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (task_id, log_date) DO UPDATE SET status = excluded.status, reason_code = excluded.reason_code, reason_text = excluded.reason_text,
      reschedule_to = excluded.reschedule_to, encouragement_text = excluded.encouragement_text, answered_late = excluded.answered_late, note = excluded.note,
      answered_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`).run(taskId, userId, logDate, status, reasonCode, reasonText, rescheduleTo, encouragementText, answeredLate ? 1 : 0, note);
  return findByTaskDate(taskId, logDate);
}

// فقط ویرایش توضیحِ انجام (A1)؛ answered_at/وضعیت/پیام تشویقی دست نمی‌خورد. note = null ⇒ پاک‌کردن.
function setNote(taskId, logDate, note) {
  getDb().prepare('UPDATE task_daily_logs SET note = ? WHERE task_id = ? AND log_date = ?').run(note, taskId, logDate);
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

// پاسخ‌های چند کاربر در یک بازه همراه با مشخصات تسک (برای «معطل‌مانده‌ها» و خروجی‌ها؛ D10/D13)
function listRangeWithTasks(userIds, fromDate, toDate) {
  if (!Array.isArray(userIds) || !userIds.length) return [];
  return getDb().prepare(`SELECT l.*, t.title AS task_title, t.is_system AS task_is_system, t.system_key AS task_system_key, t.deleted_at AS task_deleted_at
    FROM task_daily_logs l JOIN plan_tasks t ON t.id = l.task_id
    WHERE l.user_id IN (${userIds.map(() => '?').join(',')}) AND l.log_date BETWEEN ? AND ? ORDER BY l.user_id, l.task_id, l.log_date`).all(...userIds, fromDate, toDate);
}

// پاسخ‌های ثبت‌شده از لحظه‌ی sinceIso به بعد (UTC ISO) برای چند کاربر، با log_date ≥ fromDate (خلاصه‌ی صبحگاهی؛ D12)
function listAnsweredSince(userIds, sinceIso, fromDate) {
  if (!Array.isArray(userIds) || !userIds.length) return [];
  return getDb().prepare(`SELECT * FROM task_daily_logs WHERE user_id IN (${userIds.map(() => '?').join(',')}) AND answered_at >= ? AND log_date >= ? ORDER BY user_id, log_date, id`).all(...userIds, sinceIso, fromDate);
}

function remove(taskId, logDate) {
  return getDb().prepare('DELETE FROM task_daily_logs WHERE task_id = ? AND log_date = ?').run(taskId, logDate).changes;
}

// ---------- نمای هفتگی کارمند (F1-b): کوئری‌های دسته‌ای برای کل هفته (بدون N+1) ----------
const TASK_COLS = `t.title AS task_title, t.description AS task_description, t.priority AS task_priority, t.is_urgent AS task_is_urgent,
  t.urgent_note AS task_urgent_note, t.scheduled_start_time AS task_scheduled_start_time, t.urgent_deadline_time AS task_urgent_deadline_time, t.is_system AS task_is_system, t.system_key AS task_system_key,
  t.deleted_at AS task_deleted_at, t.planned_date AS task_planned_date, t.sort_order AS task_sort_order, t.carried_from_task_id AS task_carried_from, au.full_name AS task_assigned_by_name,
  t.assigned_by_user_id AS task_assigned_by, t.manager_locked AS task_manager_locked`;
const TASK_JOIN = 'JOIN plan_tasks t ON t.id = l.task_id LEFT JOIN users au ON au.id = t.assigned_by_user_id';

// B1 (فاز ۱۵): شمار «انتقال به تاریخ» (نه drop) برای هر تسک — یک کوئریِ دسته‌ای برای فهرست؛ Map(taskId → count)
function countCarriesByTask(taskIds) {
  const ids = [...new Set((taskIds || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  const out = new Map();
  if (!ids.length) return out;
  const rows = getDb().prepare(`SELECT task_id, COUNT(*) AS n FROM task_daily_logs WHERE task_id IN (${ids.map(() => '?').join(',')})
    AND reschedule_to IS NOT NULL AND reschedule_to != 'drop' GROUP BY task_id`).all(...ids);
  rows.forEach((r) => out.set(r.task_id, r.n));
  return out;
}

// پاسخ‌های یک کاربر در بازه‌ی [from, to] همراه مشخصات تسک (حتی تسک حذف‌شده‌ی بعدی؛ تاریخچه باید بماند)
function listRangeDetailed(userId, fromDate, toDate) {
  return getDb().prepare(`SELECT l.*, ${TASK_COLS} FROM task_daily_logs l ${TASK_JOIN}
    WHERE l.user_id = ? AND l.log_date BETWEEN ? AND ? ORDER BY l.log_date, l.id`).all(userId, fromDate, toDate);
}

// پاسخ‌هایی که تسک را به روزی داخل [from, to] منتقل کرده‌اند (reschedule_to تاریخ است، نه 'drop')
function listRescheduledIntoRange(userId, fromDate, toDate) {
  return getDb().prepare(`SELECT l.*, ${TASK_COLS} FROM task_daily_logs l ${TASK_JOIN}
    WHERE l.user_id = ? AND l.reschedule_to BETWEEN ? AND ? ORDER BY l.reschedule_to, l.id`).all(userId, fromDate, toDate);
}

// آخرین پاسخِ هر تسکِ کاربر پیش از beforeDate (برای تسک‌های «هرروزه»ای که تاریخ مشخص ندارند)
function listLastLogsBefore(userId, beforeDate) {
  return getDb().prepare(`SELECT l.* FROM task_daily_logs l WHERE l.user_id = ? AND l.log_date < ?
    AND l.log_date = (SELECT MAX(x.log_date) FROM task_daily_logs x WHERE x.task_id = l.task_id AND x.log_date < ?)`).all(userId, beforeDate, beforeDate);
}

module.exports = { countCarriesByTask, setNote, listRangeDetailed, listRescheduledIntoRange, listLastLogsBefore, findByTaskDate, upsert, listByUserDate, listByUserRange, listUserIdsWithLogsOnDate, listByTask, listRescheduledTo, listRecentEncouragements, remove, listRangeWithTasks, listAnsweredSince };

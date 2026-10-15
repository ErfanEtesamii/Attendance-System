// برنامه‌ی هفتگی و تسک‌های آن (D1). SQL فقط اینجاست؛ قواعد (ویرایش/اعتبارسنجی) در سرویس D3.
const { getDb } = require('../db/connection');

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

function findById(id) {
  return getDb().prepare('SELECT * FROM weekly_plans WHERE id = ?').get(id) || null;
}

function findByUserWeek(userId, weekStart) {
  return getDb().prepare('SELECT * FROM weekly_plans WHERE user_id = ? AND week_start_date = ?').get(userId, weekStart) || null;
}

// idempotent: وجود داشت همان را برمی‌گرداند
function getOrCreate(userId, weekStart) {
  const existing = findByUserWeek(userId, weekStart);
  if (existing) return existing;
  getDb().prepare('INSERT INTO weekly_plans (user_id, week_start_date) VALUES (?, ?)').run(userId, weekStart); // تاریخ نامعتبر ⇒ CHECK خطا می‌دهد (OR IGNORE آن را می‌بلعید)
  return findByUserWeek(userId, weekStart);
}

function listByUserRange(userId, fromWeek, toWeek) {
  return getDb().prepare('SELECT * FROM weekly_plans WHERE user_id = ? AND week_start_date BETWEEN ? AND ? ORDER BY week_start_date').all(userId, fromWeek, toWeek);
}

function listByWeek(weekStart, userIds = null) {
  if (Array.isArray(userIds)) {
    if (!userIds.length) return [];
    return getDb().prepare(`SELECT * FROM weekly_plans WHERE week_start_date = ? AND user_id IN (${userIds.map(() => '?').join(',')}) ORDER BY user_id`).all(weekStart, ...userIds);
  }
  return getDb().prepare('SELECT * FROM weekly_plans WHERE week_start_date = ? ORDER BY user_id').all(weekStart);
}

function markSubmitted(id) {
  getDb().prepare(`UPDATE weekly_plans SET status = 'submitted', submitted_at = COALESCE(submitted_at, ${NOW}), updated_at = ${NOW} WHERE id = ?`).run(id);
  return findById(id);
}

function touch(id) {
  getDb().prepare(`UPDATE weekly_plans SET updated_at = ${NOW} WHERE id = ?`).run(id);
}

// A3-۲: ثبت «دیده شد» توسط کارمند. نه updated_at را عوض می‌کند و نه (با تریگر migration ۰۳۵) version را.
function markEmployeeSeen(id) {
  getDb().prepare(`UPDATE weekly_plans SET employee_seen_at = ${NOW} WHERE id = ?`).run(id);
  return findById(id);
}

// A3-۲: شمار و آخرین زمان تغییرهای مدیر (افزودن/ویرایش/حذف؛ حذف هم edited_at را می‌زند) بعد از seenAt (null ⇒ همه).
function managerChangesSince(planId, seenAt) {
  const row = getDb().prepare(`SELECT COUNT(*) AS n, MAX(edited_at) AS last FROM plan_tasks
    WHERE plan_id = ? AND edited_at IS NOT NULL AND (? IS NULL OR edited_at > ?)`).get(planId, seenAt || null, seenAt || null);
  return { count: row.n, lastEditedAt: row.last || null };
}

function setSupervisorFeedback(id, { seen = true, comment = undefined } = {}) {
  const sets = [];
  const params = [];
  if (seen) sets.push(`supervisor_seen_at = COALESCE(supervisor_seen_at, ${NOW})`);
  if (comment !== undefined) { sets.push('supervisor_comment = ?'); params.push(comment); }
  if (!sets.length) return findById(id);
  getDb().prepare(`UPDATE weekly_plans SET ${sets.join(', ')}, updated_at = ${NOW} WHERE id = ?`).run(...params, id);
  return findById(id);
}

// ---------- تسک‌ها ----------
// assigned_by_name (E2): نام تعیین‌کننده‌ی تسک فوری برای نمایش به کارمند؛ برای تسک‌های عادی NULL
const TASK_SELECT = 'SELECT t.*, u.full_name AS assigned_by_name FROM plan_tasks t LEFT JOIN users u ON u.id = t.assigned_by_user_id';

function findTask(id) {
  return getDb().prepare(`${TASK_SELECT} WHERE t.id = ?`).get(id) || null;
}

function listTasks(planId, { includeDeleted = false } = {}) {
  return getDb().prepare(`${TASK_SELECT} WHERE t.plan_id = ?${includeDeleted ? '' : ' AND t.deleted_at IS NULL'} ORDER BY t.sort_order, t.id`).all(planId);
}

// managerLocked/editedByUserId (A1-۲، migration ۰۳۳): فقط برای تسکی که ادمین/سرپرست از weeklyPlanAdminService
// اضافه می‌کند پر می‌شود؛ مستقل از isUrgent (هرگز هم‌زمان هر دو). editedAt پیش‌فرض «الان» است وقتی managerLocked=true.
function addTask(planId, { title, description = null, plannedDate = null, priority = 'normal', sortOrder = null, isSystem = false, systemKey = null, carriedFromTaskId = null,
  isUrgent = false, assignedByUserId = null, urgentNote = null, urgentDeadlineTime = null, managerLocked = false, editedByUserId = null }) {
  const db = getDb();
  const order = sortOrder === null ? (db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM plan_tasks WHERE plan_id = ?').get(planId).n) : sortOrder;
  const res = db.prepare(`INSERT INTO plan_tasks (plan_id, title, description, planned_date, priority, sort_order, is_system, system_key, carried_from_task_id,
      is_urgent, assigned_by_user_id, urgent_note, urgent_deadline_time, manager_locked, edited_by_user_id, edited_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${managerLocked ? NOW : 'NULL'})`).run(planId, title, description, plannedDate, priority, order, isSystem ? 1 : 0, systemKey, carriedFromTaskId,
    isUrgent ? 1 : 0, isUrgent ? assignedByUserId : null, isUrgent ? urgentNote : null, isUrgent ? urgentDeadlineTime : null,
    managerLocked ? 1 : 0, managerLocked ? editedByUserId : null);
  return findTask(res.lastInsertRowid);
}

const TASK_FIELDS = { title: 'title', description: 'description', plannedDate: 'planned_date', priority: 'priority', sortOrder: 'sort_order' };
function updateTask(id, fields) {
  const sets = [];
  const params = [];
  for (const [k, col] of Object.entries(TASK_FIELDS)) {
    if (fields[k] !== undefined) { sets.push(`${col} = ?`); params.push(fields[k]); }
  }
  if (!sets.length) return findTask(id);
  getDb().prepare(`UPDATE plan_tasks SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
  return findTask(id);
}

// علامت‌گذاری «ویرایش‌شده توسط مدیر» (A1-۲): manager_locked=۱ + edited_by_user_id + edited_at = الان.
// از updateTask جدا است چون موضوعاً فرق دارد (علامت‌گذاری، نه محتوای تسک) و addTask/updateTask هر دو مدیر
// باید بعد از نوشتن فیلدهای خودشان این را هم صدا بزنند (A1-۳). روی تسک سیستمی/فوری عمداً اینجا گیت نمی‌شود؛
// جلوگیری از آن وظیفه‌ی weeklyPlanAdminService (سرویس) است، نه repository.
function markManagerEdited(id, managerUserId) {
  getDb().prepare(`UPDATE plan_tasks SET manager_locked = 1, edited_by_user_id = ?, edited_at = ${NOW} WHERE id = ?`).run(managerUserId, id);
  return findTask(id);
}

function softDeleteTask(id) {
  getDb().prepare(`UPDATE plan_tasks SET deleted_at = ${NOW} WHERE id = ? AND deleted_at IS NULL`).run(id);
  return findTask(id);
}

// جابه‌جایی گروهیِ ترتیب (برای reorderTasks در A1-۳): items = [{id, sortOrder}]؛ همه در یک تراکنش.
function reorderTasks(items) {
  const db = getDb();
  const stmt = db.prepare('UPDATE plan_tasks SET sort_order = ? WHERE id = ?');
  db.transaction(() => { for (const { id, sortOrder } of items) stmt.run(sortOrder, id); })();
}

// شمار تسک‌های «معمولی» (غیرسیستمی/غیرفوری) فعالِ یک برنامه — برای سقف ۳۰ تسک در A1-۳ بدون لود کل فهرست.
function countOrdinaryTasks(planId) {
  return getDb().prepare('SELECT COUNT(*) AS n FROM plan_tasks WHERE plan_id = ? AND deleted_at IS NULL AND is_system = 0 AND is_urgent = 0').get(planId).n;
}

function findSystemTask(planId, systemKey) {
  return getDb().prepare('SELECT * FROM plan_tasks WHERE plan_id = ? AND system_key = ? AND deleted_at IS NULL').get(planId, systemKey) || null;
}

// تسک سیستمیِ «روزانه» (مثل review_team_reports): یکی برای هر (برنامه، کلید، روز) — D9
function findSystemTaskOnDate(planId, systemKey, plannedDate) {
  return getDb().prepare('SELECT * FROM plan_tasks WHERE plan_id = ? AND system_key = ? AND planned_date = ? AND deleted_at IS NULL ORDER BY id LIMIT 1').get(planId, systemKey, plannedDate) || null;
}

// پرتکرارترین عنوان‌های تسک‌های غیرسیستمیِ کاربر (برای پیشنهاد در ویزارد)
function topTitles(userId, limit = 5) {
  return getDb().prepare(`SELECT t.title AS title, COUNT(*) AS n FROM plan_tasks t JOIN weekly_plans p ON p.id = t.plan_id
    WHERE p.user_id = ? AND t.is_system = 0 AND t.is_urgent = 0 AND t.deleted_at IS NULL GROUP BY t.title ORDER BY n DESC, MAX(t.id) DESC LIMIT ?`).all(userId, limit).map((r) => r.title);
}

// ---------- تسک فوری (E1) ----------
// تسک فوریِ حذف‌نشده‌ی کاربران (userIds = null ⇒ همه) با planned_date داخل [from, to]؛ هر ردیف user_id برنامه را هم دارد.
function listUrgent({ userIds = null, from, to }) {
  if (Array.isArray(userIds) && !userIds.length) return [];
  const where = ['t.is_urgent = 1', 't.deleted_at IS NULL', 't.planned_date BETWEEN ? AND ?'];
  const params = [from, to];
  if (Array.isArray(userIds)) { where.push(`p.user_id IN (${userIds.map(() => '?').join(',')})`); params.push(...userIds); }
  return getDb().prepare(`SELECT t.*, p.user_id AS user_id, p.week_start_date AS week_start_date FROM plan_tasks t JOIN weekly_plans p ON p.id = t.plan_id
    WHERE ${where.join(' AND ')} ORDER BY t.planned_date, t.id`).all(...params);
}

// تسک فوری + کاربرِ مالک (برای حذف/اسکوپ)
function findUrgentWithOwner(taskId) {
  return getDb().prepare(`SELECT t.*, p.user_id AS user_id, p.week_start_date AS week_start_date FROM plan_tasks t JOIN weekly_plans p ON p.id = t.plan_id
    WHERE t.id = ? AND t.is_urgent = 1`).get(taskId) || null;
}

module.exports = {
  listUrgent, findUrgentWithOwner, topTitles, findById, markEmployeeSeen, managerChangesSince, findByUserWeek, getOrCreate, listByUserRange, listByWeek, markSubmitted, touch, setSupervisorFeedback,
  findTask, listTasks, addTask, updateTask, markManagerEdited, softDeleteTask, reorderTasks, countOrdinaryTasks, findSystemTask, findSystemTaskOnDate,
};

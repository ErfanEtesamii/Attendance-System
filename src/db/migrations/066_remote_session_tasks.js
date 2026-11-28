// migration شماره ۰۶۶ — تسک‌هایی که کارمند هنگام «پایان دورکاری» با مدت هرکدام گزارش می‌دهد.
//   remote_session_tasks — هر ردیف یک کار انجام‌شده در یک نشست دورکاری (عنوان + دقیقه).
//   plan_task_id : تسکِ هم‌ارز در «برنامه امروز» (plan_tasks) که هنگام پایان ساخته می‌شود؛ NULL اگر ساخت آن ممکن نبود (مثلاً ماه بسته).
// فقط جدول جدید؛ داده و رفتار موجود تغییر نمی‌کند. idempotent: IF NOT EXISTS.
module.exports = {
  name: '066_remote_session_tasks',
  up(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS remote_session_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES remote_work_sessions(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
      minutes INTEGER NOT NULL CHECK (minutes BETWEEN 1 AND 1440),
      sort_order INTEGER NOT NULL DEFAULT 0,
      plan_task_id INTEGER REFERENCES plan_tasks(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_remote_session_tasks_session ON remote_session_tasks(session_id, sort_order);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_remote_session_tasks_user ON remote_session_tasks(user_id, created_at);');
  },
};

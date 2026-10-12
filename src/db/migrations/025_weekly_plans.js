// migration شماره ۰۲۵ — برنامه‌ی هفتگی و گزارش روزانه‌ی تسک‌ها (D1). فقط جدول‌های جدید؛ داده‌ی موجود تغییر نمی‌کند.
//   weekly_plans     — برنامه‌ی هفتگی هر کاربر (week_start_date = اولین روز هفته به تاریخ میلادی؛ حداکثر یکی برای هر کاربر/هفته).
//   plan_tasks       — تسک‌های برنامه (title ≤ ۱۲۰، description ≤ ۵۰۰). is_system/system_key برای تسک‌های خودکار (مثل review_team_reports)،
//                      carried_from_task_id = تسکِ مبدأ در انتقال از هفته‌ی قبل (بدون FK عمداً: حذف هفته‌ی قدیمی مانعی نباشد)، deleted_at = حذف نرم.
//   task_daily_logs  — پاسخ روزانه به هر تسک (یکی برای هر (تسک، روز)). answered_late = پاسخِ دیرهنگام (backfill/«بعداً پر می‌کنم»).
//   report_reviews   — «مشاهده شد»ِ سرپرست روی گزارش یک کارمند در یک روز (یکتا روی سه‌تایی).
module.exports = {
  name: '025_weekly_plans',
  up(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS weekly_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      week_start_date TEXT NOT NULL CHECK (week_start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted')),
      submitted_at TEXT,
      supervisor_seen_at TEXT,
      supervisor_comment TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      UNIQUE (user_id, week_start_date)
    );`);
    db.exec(`CREATE TABLE IF NOT EXISTS plan_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_id INTEGER NOT NULL REFERENCES weekly_plans(id) ON DELETE CASCADE,
      title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
      description TEXT CHECK (description IS NULL OR length(description) <= 500),
      planned_date TEXT,
      priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
      system_key TEXT,
      carried_from_task_id INTEGER,
      deleted_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );`);
    db.exec(`CREATE TABLE IF NOT EXISTS task_daily_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL REFERENCES plan_tasks(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      log_date TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('done', 'not_done', 'partial')),
      reason_code TEXT,
      reason_text TEXT,
      reschedule_to TEXT,
      encouragement_text TEXT,
      answered_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      answered_late INTEGER NOT NULL DEFAULT 0 CHECK (answered_late IN (0, 1)),
      UNIQUE (task_id, log_date)
    );`);
    db.exec(`CREATE TABLE IF NOT EXISTS report_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reviewer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subject_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      report_date TEXT NOT NULL,
      reviewed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      comment TEXT,
      reaction TEXT,
      UNIQUE (reviewer_id, subject_user_id, report_date)
    );`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_plan_tasks_plan ON plan_tasks(plan_id, sort_order);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_plan_tasks_date ON plan_tasks(planned_date);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_task_logs_user_date ON task_daily_logs(user_id, log_date);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_report_reviews_subject ON report_reviews(subject_user_id, report_date);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_weekly_plans_week ON weekly_plans(week_start_date);');
  },
};

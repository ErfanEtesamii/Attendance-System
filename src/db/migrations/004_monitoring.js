// migration شماره ۰۰۴ — مانیتورینگ و هشدار (بخش ۲-ج۱).
//
// سه جدول جدید (هیچ جدول موجودی تغییر نمی‌کند؛ داده‌ی تردد/مرخصی/audit دست‌نخورده می‌ماند):
//   job_runs       — تاریخچه‌ی اجرای هر Job زمان‌بندی‌شده (شروع، پایان، موفق/خطا، مدت).
//   monitor_alerts — وضعیت هشدارهای watchdog (برای throttle و پیام «رفع شد»؛ با ری‌استارت از دست نمی‌رود).
//   monitor_state  — جدول کلید/مقدار کوچک؛ فعلاً فقط برای «نوشتن آزمایشی» در بررسی سلامت دیتابیس.

module.exports = {
  name: '004_monitoring',
  up(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS job_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_name TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL CHECK (status IN ('running', 'success', 'error', 'interrupted')),
      error TEXT,
      duration_ms INTEGER
    );`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_job_runs_job ON job_runs(job_name, id DESC);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_job_runs_started ON job_runs(started_at);');

    db.exec(`CREATE TABLE IF NOT EXISTS monitor_alerts (
      alert_key TEXT PRIMARY KEY,
      state TEXT NOT NULL CHECK (state IN ('firing', 'ok')),
      first_seen_at TEXT NOT NULL,
      last_sent_at TEXT,
      updated_at TEXT NOT NULL,
      detail TEXT
    );`);

    db.exec(`CREATE TABLE IF NOT EXISTS monitor_state (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT NOT NULL
    );`);
  },
};

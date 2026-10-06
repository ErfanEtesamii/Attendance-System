// migration شماره ۰۰۶ — جدول «موارد مشکوک» (S2-4a). فقط ساختار؛ هنوز هیچ قاعده‌ای آن را پر نمی‌کند.
//
//   event_type  — نوع قاعده (مثلاً shared_device، same_ip_close، device_change)
//   user_ids    — JSON آرایه‌ی مرتب و بدون تکرار از id کاربران درگیر
//   record_ids  — JSON آرایه‌ی id رکوردهای تردد مرتبط
//   event_date  — روز رویداد (میلادی YYYY-MM-DD)
//   details     — JSON توضیح قاعده (برای نمایش به ادمین؛ «نشانه» است نه «مدرک»)
//   status      — open | reviewed | ignored ؛ reviewed_by/reviewed_at هنگام بررسی پر می‌شوند
//
// جلوگیری از تکرار: ایندکس یکتا روی (event_type, user_ids, event_date)؛ repository مقدار user_ids را
// قبل از درج «نرمال» (مرتب، یکتا) می‌کند تا ترتیب ورودی روی تکراری‌بودن اثر نگذارد.

module.exports = {
  name: '006_suspicious_events',
  up(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS suspicious_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      user_ids TEXT NOT NULL DEFAULT '[]',
      record_ids TEXT NOT NULL DEFAULT '[]',
      event_date TEXT NOT NULL,
      details TEXT,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewed', 'ignored')),
      reviewed_by INTEGER REFERENCES users(id),
      reviewed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );`);
    db.exec(
      'CREATE UNIQUE INDEX IF NOT EXISTS uq_suspicious_dedupe ON suspicious_events(event_type, user_ids, event_date);'
    );
    db.exec('CREATE INDEX IF NOT EXISTS idx_suspicious_status_date ON suspicious_events(status, event_date);');
  },
};

// migration شماره ۰۰۹ — ساختار شیفت کاری (S3-6a؛ قبلاً به‌اشتباه ۰۰۸ و هم‌شماره با 008_overtime_approvals بود). فقط ساختار؛ مصرف توسط computeDay از S3-6b.
//
//   work_shifts — تعریف شیفت‌ها:
//     name UNIQUE                         نام شیفت (مثلاً «صبح»، «شب»)
//     start_time / end_time               HH:MM به وقت شرکت
//     grace_late_minutes / grace_early_minutes   مهلت تأخیر ورود / زودتر رفتن (دقیقه، ≥ ۰)
//     work_days                           آرایه‌ی JSON از شماره‌ی روز هفته: ۰=یکشنبه … ۶=شنبه (مثل Date#getDay و src/utils/time.js)
//     overnight                           ۱ = شیفت از نیمه‌شب رد می‌شود (end_time < start_time)؛ منطق شیفت شب در S3-6c (record_date = روز شروع)
//     max_lunch_minutes / fixed_lunch_deduct_minutes   قاعده‌های ناهار همان معنای تنظیمات سراسری (۰ = خاموش/بدون سقف)
//   users.shift_id — nullable؛ NULL = «بدون شیفت» (بعداً شیفت پیش‌فرض تنظیمات). ستون جدید روی داده‌ی موجود هیچ اثری ندارد.
// داده‌ی هیچ جدول موجودی تغییر نمی‌کند؛ پیش از اعمال، migrator طبق معمول بک‌آپ pre-migration می‌گیرد.

module.exports = {
  name: '009_work_shifts',
  up(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS work_shifts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      grace_late_minutes INTEGER NOT NULL DEFAULT 0 CHECK (grace_late_minutes >= 0),
      grace_early_minutes INTEGER NOT NULL DEFAULT 0 CHECK (grace_early_minutes >= 0),
      work_days TEXT NOT NULL DEFAULT '[0,1,2,3,6]',
      overnight INTEGER NOT NULL DEFAULT 0 CHECK (overnight IN (0, 1)),
      max_lunch_minutes INTEGER NOT NULL DEFAULT 0 CHECK (max_lunch_minutes >= 0),
      fixed_lunch_deduct_minutes INTEGER NOT NULL DEFAULT 0 CHECK (fixed_lunch_deduct_minutes >= 0),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );`);

    // idempotent: اگر ستون از قبل هست (اجرای نیمه‌کاره‌ی دستی) دوباره اضافه نمی‌شود
    const cols = db.prepare("PRAGMA table_info('users')").all().map((c) => c.name);
    if (!cols.includes('shift_id')) {
      db.exec('ALTER TABLE users ADD COLUMN shift_id INTEGER REFERENCES work_shifts(id)');
    }
    db.exec('CREATE INDEX IF NOT EXISTS idx_users_shift ON users(shift_id);');
  },
};

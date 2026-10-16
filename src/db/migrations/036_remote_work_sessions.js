// migration شماره ۰۳۶ — نشست‌های دورکاری (فاز ۱۴، R1-الف). فقط جدول جدید؛ داده‌ی موجود و رفتار فعلی تغییر نمی‌کند.
//   remote_work_sessions — هر ردیف یک «ورود تا خروجِ» دورکاریِ کارمندی که خارج از شبکه‌ی مجاز است.
//   ثبت‌های دورکاری تا تأییدِ سرپرست/ادمین «رسمی» نیستند: این جدول هرگز مستقیم وارد attendance_records نمی‌شود
//   (تبدیل در تأیید، داخل یک تراکنش و در مرحله‌ی R5 انجام می‌شود) و تا آن زمان هیچ گزارش/محاسبه‌ای آن را نمی‌خواند.
//   work_date            : تاریخ روز کاری (YYYY-MM-DD) طبق زمان سرور، نه ساعت دستگاه کاربر
//   start_at / end_at    : ISO/UTC مثل بقیه‌ی جدول‌ها؛ end_at = NULL یعنی نشست باز است
//   status               : pending (پیش‌فرض) | approved | rejected
//   auto_closed          : ۱ = نشستِ فراموش‌شده را job سیستم بسته؛ برای بررسی دقیق‌تر سرپرست علامت می‌خورد
//   approved_start_at/_end_at : ساعت اصلاح‌شده‌ی سرپرست (NULL = همان start_at/end_at)
//   attendance_record_id : رکورد رسمیِ ساخته‌شده در تأیید؛ مبنای idempotent بودن تأیید (R5)
// قاعده‌ی کلیدی: برای هر کاربر در هر لحظه حداکثر یک نشست باز (ایندکس یکتای جزئی). idempotent: همه IF NOT EXISTS.

module.exports = {
  name: '036_remote_work_sessions',
  up(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS remote_work_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      work_date TEXT NOT NULL CHECK (work_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
      start_at TEXT NOT NULL,
      end_at TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
      ip_address TEXT,
      auto_closed INTEGER NOT NULL DEFAULT 0 CHECK (auto_closed IN (0, 1)),
      reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      reviewed_at TEXT,
      review_note TEXT CHECK (review_note IS NULL OR length(review_note) <= 500),
      approved_start_at TEXT,
      approved_end_at TEXT,
      attendance_record_id INTEGER REFERENCES attendance_records(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      CHECK (end_at IS NULL OR end_at >= start_at),
      CHECK (approved_end_at IS NULL OR approved_start_at IS NULL OR approved_end_at >= approved_start_at)
    );`);
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_remote_sessions_one_open ON remote_work_sessions(user_id) WHERE end_at IS NULL;');
    db.exec('CREATE INDEX IF NOT EXISTS idx_remote_sessions_user_date ON remote_work_sessions(user_id, work_date);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_remote_sessions_status_date ON remote_work_sessions(status, work_date);');
  },
};

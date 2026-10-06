// migration شماره ۰۰۲ — ستون users.session_version برای باطل‌کردن نشست‌های پنل (بخش ۲-الف).
//
// نشست پنل stateless است (کوکی امضاشده). با درج session_version کاربر داخل توکن و مقایسه‌اش با
// مقدار دیتابیس در هر درخواست، می‌شود همه‌ی نشست‌های یک کاربر را با «افزایش عدد» باطل کرد.
// مقدار پیش‌فرض ۰ است و توکن‌های قبلی (که این فیلد را ندارند) به‌عنوان ۰ حساب می‌شوند؛
// پس نشست‌های فعلی با اجرای این migration قطع نمی‌شوند. (بازه‌ی «همه کاربران» در جدول settings است، نه اینجا.)

module.exports = {
  name: '002_session_version',
  up(db) {
    const cols = db.prepare("PRAGMA table_info('users')").all().map((c) => c.name);
    if (!cols.includes('session_version')) {
      db.exec('ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0');
    }
  },
};

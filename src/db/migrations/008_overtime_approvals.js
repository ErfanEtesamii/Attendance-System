// migration شماره ۰۰۸ — تأیید اضافه‌کاری (S3-5c). فقط ساختار؛ داده‌ی هیچ جدول موجودی تغییر نمی‌کند.
//
//   overtime_approvals — «تصمیم» مدیر برای اضافه‌کاری یک رکورد تردد (حداکثر یک ردیف برای هر رکورد).
//     • «معلق» ردیف ندارد: نبودن ردیف (وقتی تنظیم overtime_requires_approval روشن است) یعنی هنوز تصمیمی گرفته نشده.
//     • status فقط approved | rejected؛ دلیل برای رد اجباری است (در route اعمال می‌شود)، برای تأیید اختیاری.
//     • user_id کارمندِ صاحب رکورد است (برای اسکوپ سرپرست و گزارش بدون join اجباری).
//     • حذف رکورد تردد (removeWithBreaks) یا حذف دائمی کاربر (deleteUserPermanently) ردیف را هم پاک می‌کند
//       (ON DELETE CASCADE) و حذف تصمیم‌گیرنده فقط decided_by را NULL می‌کند؛ پس این دو تابع تغییر نمی‌کنند.
//       سابقه‌ی تصمیم در audit_log می‌ماند.
//   پیش از اعمال، migrator طبق معمول بک‌آپ pre-migration می‌گیرد.

module.exports = {
  name: '008_overtime_approvals',
  up(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS overtime_approvals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      attendance_record_id INTEGER NOT NULL UNIQUE REFERENCES attendance_records(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK (status IN ('approved', 'rejected')),
      reason TEXT,
      decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      decided_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_overtime_approvals_user ON overtime_approvals(user_id);');
  },
};

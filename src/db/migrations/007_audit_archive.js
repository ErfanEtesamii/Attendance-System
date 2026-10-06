// migration شماره ۰۰۷ — ساختار آرشیو audit (S2-6a). فقط ساختار؛ هنوز هیچ Job یا انتقالی وجود ندارد (S2-6b/6c).
//
//   audit_log_archive — همان ستون‌های audit_log (id, user_id, action, occurred_at, ip_address, details).
//     • id «AUTOINCREMENT» نیست: هنگام انتقال (S2-6c) همان id اصلی حفظ می‌شود تا ارجاع‌ها و ترتیب نشکند.
//     • occurred_at پیش‌فرض ندارد: زمان رویداد اصلی کپی می‌شود، نه زمان انتقال.
//     • user_id مثل جدول اصلی به users ارجاع دارد؛ حذف دائمی کاربر (usersRepository.deleteUserPermanently)
//       ارتباط ردیف‌های آرشیو را هم مثل audit_log قطع می‌کند (user_id = NULL).
//   ایندکس‌ها: تاریخ و کاربر روی آرشیو (برای include_archive در S2-6c)، و تاریخ روی خود audit_log
//   (تا شمارش/انتقال «رکوردهای قدیمی‌تر از آستانه» اسکن کامل جدول نباشد).
// داده‌ی هیچ جدول موجودی تغییر نمی‌کند؛ پیش از اعمال، migrator طبق معمول بک‌آپ pre-migration می‌گیرد.

module.exports = {
  name: '007_audit_archive',
  up(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS audit_log_archive (
      id INTEGER PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      action TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      ip_address TEXT,
      details TEXT
    );`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_audit_archive_occurred ON audit_log_archive(occurred_at);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_audit_archive_user ON audit_log_archive(user_id);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_audit_occurred ON audit_log(occurred_at);');
  },
};

// migration شماره ۰۲۸ — انتساب شیفت با «تاریخ اعمال» (فاز ۱۲، B1).
//
//   user_shift_assignments — تاریخچه‌ی انتساب شیفت هر کارمند:
//     user_id, shift_id (NULL = «بدون شیفت» از آن تاریخ به بعد), effective_from (YYYY-MM-DD)
//     UNIQUE(user_id, effective_from): ثبت دوباره برای همان تاریخ، همان ردیف را جایگزین می‌کند.
//   شیفتِ مؤثر کاربر در روز D = آخرین ردیفی که effective_from ≤ D دارد؛ قبل از اولین ردیف ⇒ بدون شیفت.
//   users.shift_id باقی می‌ماند (سازگاری) و به‌عنوان «آینه‌ی شیفتِ امروز» هنگام انتساب همگام می‌شود.
//
// داده‌ی موجود: هر کاربری که الان users.shift_id دارد یک ردیف با effective_from = 1970-01-01 می‌گیرد، پس محاسبه‌ی همه‌ی روزهای
// گذشته و ماه‌های بسته دقیقاً مثل قبل می‌ماند. idempotent: اجرای دوباره چیزی تکرار نمی‌کند.

module.exports = {
  name: '028_user_shift_assignments',
  up(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS user_shift_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      shift_id INTEGER REFERENCES work_shifts(id),
      effective_from TEXT NOT NULL CHECK (effective_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (user_id, effective_from)
    );`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_usa_user_from ON user_shift_assignments(user_id, effective_from);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_usa_shift ON user_shift_assignments(shift_id);');
    db.exec(`INSERT OR IGNORE INTO user_shift_assignments (user_id, shift_id, effective_from)
             SELECT id, shift_id, '1970-01-01' FROM users WHERE shift_id IS NOT NULL;`);
  },
};

// migration شماره ۰۳۱ — «اجازه‌ی ورود» برای کارمندی که سقف تأخیر ماهانه را رد کرده (فاز ۱۲، D1).
//   checkin_permissions: درخواست کارمند ← تصمیم سرپرست مستقیم/ادمین ← مصرف با یک ورود موفق.
//   status: pending (در انتظار) | approved (تأییدشده، تا expires_at معتبر) | rejected | used (با ورود مصرف شد) | expired (مهلتش گذشت)
//   یکتایی: برای هر (کاربر، تاریخ) حداکثر یک ردیفِ «فعال» (pending یا approved)؛ بعد از rejected/used/expired می‌شود دوباره درخواست داد.
// فقط جدول جدید؛ داده‌ی موجود دست نمی‌خورد. idempotent.

module.exports = {
  name: '031_checkin_permissions',
  up(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS checkin_permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      permission_date TEXT NOT NULL CHECK (permission_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'used', 'expired')),
      reason TEXT NOT NULL,
      requested_at TEXT NOT NULL,
      decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      decided_at TEXT,
      decision_note TEXT,
      expires_at TEXT,
      used_at TEXT
    );`);
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_cp_active_per_day ON checkin_permissions(user_id, permission_date) WHERE status IN ('pending', 'approved');");
    db.exec('CREATE INDEX IF NOT EXISTS idx_cp_status_date ON checkin_permissions(status, permission_date);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_cp_user_date ON checkin_permissions(user_id, permission_date);');
  },
};

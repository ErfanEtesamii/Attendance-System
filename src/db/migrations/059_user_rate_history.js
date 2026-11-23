// تاریخچه‌ی تاریخ‌دارِ نرخ ساعتی و کسر ماهانه‌ی بیمه (ستون‌های حساس): تغییر از یک تاریخ به بعد اعمال می‌شود و ماه‌های قبل با مقدار قبلی می‌مانند.
// field: 'rate' (هزار تومان/ساعت) | 'insurance' (تومان/ماه)؛ effective_from میلادی؛ ردیف پایه = '0000-00-00'؛ value می‌تواند NULL (تعریف‌نشده) باشد.
module.exports = {
  name: '059_user_rate_history',
  up(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS user_rate_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      field TEXT NOT NULL CHECK (field IN ('rate','insurance')),
      effective_from TEXT NOT NULL,
      value INTEGER CHECK (value IS NULL OR value >= 0),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (user_id, field, effective_from)
    );`);
  },
};

// تعدیل دستی حقوق ماهانه (کسر/اضافه به ساعت، با دلیل): فقط مالک ثبت می‌کند؛ مبلغ = ساعت × نرخ ساعتی پایان همان ماه.
module.exports = {
  name: '062_payroll_adjustments',
  up(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS payroll_adjustments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      jalali_year INTEGER NOT NULL,
      jalali_month INTEGER NOT NULL CHECK (jalali_month BETWEEN 1 AND 12),
      minutes INTEGER NOT NULL CHECK (minutes <> 0),
      reason TEXT NOT NULL,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_payroll_adjustments_month ON payroll_adjustments (jalali_year, jalali_month, user_id);`);
  },
};

// هدف فروش ماهانه‌ی هر کارمند (تعیین‌شده توسط سرپرست/ادمین) + تشویقی در صورت رسیدن به هدف.
//   • یک ردیف برای هر (کارمند، ماه شمسی)؛ مبلغ هدف و مبلغ تشویقی (تومان) متغیر و قابل ویرایش‌اند.
//   • reward_note: توضیح کوتاه تشویقی (مثلاً «سکه‌ی بهار آزادی»)؛ achieved_notified_at: اعلان رسیدن به هدف فقط یک‌بار.
module.exports = {
  name: '065_sales_targets',
  up(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS sales_targets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      jy INTEGER NOT NULL,
      jm INTEGER NOT NULL,
      target_toman INTEGER NOT NULL CHECK (target_toman > 0),
      reward_toman INTEGER NOT NULL DEFAULT 0 CHECK (reward_toman >= 0),
      reward_note TEXT,
      set_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      achieved_notified_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (user_id, jy, jm)
    );
    CREATE INDEX IF NOT EXISTS idx_sales_targets_month ON sales_targets (jy, jm);`);
  },
};

// migration شماره ۰۲۶ — معافیت یک‌باره از گیت خروجِ «برنامه‌ی هفته‌ی بعد» (D5). فقط جدول جدید؛ داده‌ی موجود تغییر نمی‌کند.
//   plan_gate_exemptions — برای هر (کاربر، هفته‌ی هدف) حداکثر یک معافیت؛ توسط ادمین/سرپرستِ تیم با علت داده می‌شود.
//   used_at پر شدنِ همان خروجی است که معافیت را مصرف کرده (یک‌باره).
module.exports = {
  name: '026_plan_gate_exemptions',
  up(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS plan_gate_exemptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      week_start_date TEXT NOT NULL CHECK (week_start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
      granted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      reason TEXT NOT NULL CHECK (length(reason) BETWEEN 3 AND 300),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      used_at TEXT,
      used_record_id INTEGER,
      UNIQUE (user_id, week_start_date)
    );`);
  },
};

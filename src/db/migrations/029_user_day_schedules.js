// migration شماره ۰۲۹ — برنامه‌ی کاری روزبه‌روز هر کارمند (override روز؛ فاز ۱۲، B2).
//
//   user_day_schedules(user_id, schedule_date, kind ∈ ('work','off'), start_time, end_time, note, created_by, …)
//     UNIQUE(user_id, schedule_date)؛ kind='work' ⇒ start/end الزامی (HH:MM)، kind='off' ⇒ هر دو NULL.
//   اولویت محاسبه‌ی روز: override روز ← شیفت مؤثر کارمند (B1) ← تنظیمات سراسری.
// فقط جدول جدید؛ داده‌ی موجود دست نمی‌خورد. idempotent.

module.exports = {
  name: '029_user_day_schedules',
  up(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS user_day_schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      schedule_date TEXT NOT NULL CHECK (schedule_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
      kind TEXT NOT NULL CHECK (kind IN ('work', 'off')),
      start_time TEXT,
      end_time TEXT,
      note TEXT,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (user_id, schedule_date),
      CHECK ((kind = 'work' AND start_time IS NOT NULL AND end_time IS NOT NULL) OR (kind = 'off' AND start_time IS NULL AND end_time IS NULL))
    );`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_uds_date ON user_day_schedules(schedule_date);');
  },
};

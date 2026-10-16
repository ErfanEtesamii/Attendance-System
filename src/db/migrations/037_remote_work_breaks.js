// migration شماره ۰۳۷ — استراحت‌های نشست دورکاری (فاز ۱۴، R1-ب). فقط جدول جدید؛ رفتار فعلی تغییر نمی‌کند.
//   remote_work_breaks — هر ردیف یک استراحتِ داخل یک نشست دورکاری (remote_work_sessions، migration ۰۳۶).
//   session_id : حذف نشست ⇒ استراحت‌هایش هم پاک می‌شوند (CASCADE)؛ در تأیید، استراحت‌ها همراه نشست به break_records می‌روند (R5).
//   start_at / end_at : ISO/UTC؛ end_at = NULL یعنی استراحت باز است.
// قاعده‌ی کلیدی: در هر نشست حداکثر یک استراحتِ باز (ایندکس یکتای جزئی). اینکه استراحت داخل بازه‌ی نشست باشد و
// نشست باز باشد قاعده‌ی سرویس است (R3)، نه دیتابیس. idempotent: همه IF NOT EXISTS.

module.exports = {
  name: '037_remote_work_breaks',
  up(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS remote_work_breaks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES remote_work_sessions(id) ON DELETE CASCADE,
      start_at TEXT NOT NULL,
      end_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      CHECK (end_at IS NULL OR end_at >= start_at)
    );`);
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_remote_breaks_one_open ON remote_work_breaks(session_id) WHERE end_at IS NULL;');
    db.exec('CREATE INDEX IF NOT EXISTS idx_remote_breaks_session ON remote_work_breaks(session_id, start_at);');
  },
};

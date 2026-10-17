// migration شماره ۰۳۹ — توضیحِ انجام روی پاسخ روزانه‌ی تسک (فاز ۱۵، A1).
//   task_daily_logs.note : متن اختیاریِ کارمند هنگام «انجام شد» (حداکثر ۵۰۰ نویسه). پاسخ‌های قبلی و پاسخ‌های بدون توضیح NULL.
// مدل «پیشرفت تسک» جدیدی ساخته نمی‌شود؛ همان task_daily_logs است. فقط برای status = 'done' معنا دارد (سرویس اعمال می‌کند).
// قید CHECK در خود ستون است (ALTER ... ADD COLUMN در SQLite آن را می‌پذیرد و ردیف‌های موجود NULL می‌مانند).
// idempotent: اگر ستون هست دوباره اضافه نمی‌شود؛ داده‌ی موجود دست‌نخورده است.

module.exports = {
  name: '039_task_log_note',
  up(db) {
    const cols = new Set(db.prepare('PRAGMA table_info(task_daily_logs)').all().map((c) => c.name));
    if (!cols.has('note')) {
      db.exec('ALTER TABLE task_daily_logs ADD COLUMN note TEXT CHECK (note IS NULL OR length(note) <= 500);');
    }
  },
};

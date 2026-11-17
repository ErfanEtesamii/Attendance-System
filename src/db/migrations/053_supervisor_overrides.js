// فاز D (بخش ۱): استثنا برای هر سرپرست. فقط داده‌ی جدید؛ بدون هیچ سطری ⇒ رفتار فعلی عیناً برقرار است.
// اولویت: استثنا (این جدول) > تنظیم سراسری. کلیدهای مجاز در src/utils/supervisorOverrideKeys.js تعریف شده‌اند.
// value به‌صورت JSON ذخیره می‌شود (true/false یا عدد). حذف کاربر ⇒ استثناهایش خودکار پاک می‌شود (CASCADE).
module.exports = {
  name: '053_supervisor_overrides',
  up(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS supervisor_overrides (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, key)
    )`);
  },
};

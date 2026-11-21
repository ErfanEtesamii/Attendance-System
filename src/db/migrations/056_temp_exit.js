// خروج موقت: کارمند می‌تواند برای کار بیرون/وقفه‌ی طولانی «خروج موقت» بزند (بدون گزارش تسک‌ها)، برگردد و «خروج اصلی» را یک بار بزند.
// ستون attendance_records.temp_exit: ۱ = آخرین خروج موقت است و هنوز خروج اصلی ثبت نشده (۰ = رفتار قبلی عیناً).
module.exports = {
  name: '056_temp_exit',
  up(db) {
    const cols = db.prepare('PRAGMA table_info(attendance_records)').all().map((c) => c.name);
    if (!cols.includes('temp_exit')) db.exec('ALTER TABLE attendance_records ADD COLUMN temp_exit INTEGER NOT NULL DEFAULT 0 CHECK (temp_exit IN (0, 1))');
  },
};

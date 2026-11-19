// تایم پرت هنگام خروج: کارمند هنگام ثبت خروج می‌گوید چند دقیقه «تایم پرت» داشته؛ این مقدار از ساعت مفید کم می‌شود.
// ستون attendance_records.idle_minutes (۰ = چیزی کم نمی‌شود ⇒ رفتار قبلی عیناً برقرار است). در خروج‌های چندباره جمع می‌شود.
module.exports = {
  name: '055_idle_minutes',
  up(db) {
    const cols = db.prepare('PRAGMA table_info(attendance_records)').all().map((c) => c.name);
    if (!cols.includes('idle_minutes')) db.exec('ALTER TABLE attendance_records ADD COLUMN idle_minutes INTEGER NOT NULL DEFAULT 0 CHECK (idle_minutes >= 0)');
  },
};

// migration شماره ۰۲۴ — ورود/خروج با ماموریتِ «در انتظار» (C5). ستون via_pending_mission روی attendance_records:
// ۱ = ثبت از بیرون شبکه فقط به‌خاطر ماموریت pending مجاز شد (تا تصمیم سرپرست «نشانه»ی بررسی است). ردیف‌های قبلی ۰.
module.exports = {
  name: '024_via_pending_mission',
  up(db) {
    const cols = db.prepare('PRAGMA table_info(attendance_records)').all().map((c) => c.name);
    if (!cols.includes('via_pending_mission')) db.exec('ALTER TABLE attendance_records ADD COLUMN via_pending_mission INTEGER NOT NULL DEFAULT 0;');
  },
};

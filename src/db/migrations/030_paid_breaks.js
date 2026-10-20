// migration شماره ۰۳۰ — استراحت با حقوق روی شیفت (فاز ۱۲، C1).
//   work_shifts.paid_break_count   : تعداد استراحت کوتاهِ با حقوق در روز (NULL = از تنظیمات سراسری paidBreakCount)
//   work_shifts.paid_break_minutes : استخر مجموع روزانه‌ی استراحت با حقوق به دقیقه (NULL = از تنظیمات سراسری paidBreakMinutes)
// هر دو NULL (پیش‌فرض) ⇒ رفتار فعلی؛ تنظیمات سراسری هم پیش‌فرض ۰ (خاموش) است. idempotent: ستونِ موجود دوباره اضافه نمی‌شود.

module.exports = {
  name: '030_paid_breaks',
  up(db) {
    const cols = new Set(db.prepare('PRAGMA table_info(work_shifts)').all().map((c) => c.name));
    if (!cols.has('paid_break_count')) db.exec('ALTER TABLE work_shifts ADD COLUMN paid_break_count INTEGER CHECK (paid_break_count IS NULL OR (paid_break_count BETWEEN 0 AND 10));');
    if (!cols.has('paid_break_minutes')) db.exec('ALTER TABLE work_shifts ADD COLUMN paid_break_minutes INTEGER CHECK (paid_break_minutes IS NULL OR (paid_break_minutes BETWEEN 0 AND 120));');
  },
};

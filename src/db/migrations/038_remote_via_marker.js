// migration شماره ۰۳۸ — نشانگر منبع «دورکاری» روی رکوردهای رسمی (فاز ۱۴، R5-۲). فقط دو ستونِ جدید با پیش‌فرض ۰؛ رفتار فعلی تغییر نمی‌کند.
//   attendance_records.via_remote : ۱ = رکورد رسمی در تأیید سرپرست/ادمین از یک نشست دورکاری ساخته شده (R5-۴). ردیف‌های قبلی و همه‌ی ثبت‌های حضوری ۰.
//   break_records.via_remote      : ۱ = استراحتِ همین رکوردِ دورکاری (از remote_work_breaks منتقل شده). ردیف‌های قبلی ۰.
// مثل via_pending_mission (migration ۰۲۴): فقط «نشانه» است؛ هیچ کدِ فعلی آن را نمی‌خواند و کسی آن را ۱ نمی‌کند تا R5-۴ (تأیید) بیاید.
// خوانندگان بعدی: برچسب «دورکاری» در جزئیات روز و شمارنده‌ی «ساعت دورکاری تأییدشده» در گزارش ماهانه (R7).
// قید CHECK فقط ۰/۱ را می‌پذیرد. idempotent: ستونِ موجود دوباره اضافه نمی‌شود.

module.exports = {
  name: '038_remote_via_marker',
  up(db) {
    const add = (table) => {
      const cols = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
      if (!cols.has('via_remote')) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN via_remote INTEGER NOT NULL DEFAULT 0 CHECK (via_remote IN (0, 1));`);
      }
    };
    add('attendance_records');
    add('break_records');
  },
};

// migration شماره ۰۱۹ — مرجع پیوست درخواست مرخصی (S4-12a). چهار ستون nullable روی leave_requests؛ داده‌ی موجود دست‌نخورده.
//   attachment_id   شناسه‌ی تصادفی ۳۲ کاراکتری hex = نام فایل در data/attachments (نام اصلیِ کاربر هرگز نام فایل نمی‌شود)
//   attachment_mime نوعِ «تشخیص‌داده‌شده از محتوای فایل» (نه ادعای کلاینت)
//   attachment_size حجم واقعی بایت
//   attachment_name نام اصلی (پاک‌سازی‌شده) فقط برای نمایش
module.exports = {
  name: '019_leave_attachments',
  up(db) {
    const cols = db.prepare('PRAGMA table_info(leave_requests)').all().map((c) => c.name);
    for (const [name, def] of [['attachment_id', 'TEXT'], ['attachment_mime', 'TEXT'], ['attachment_size', 'INTEGER'], ['attachment_name', 'TEXT']]) {
      if (!cols.includes(name)) db.exec(`ALTER TABLE leave_requests ADD COLUMN ${name} ${def};`);
    }
  },
};

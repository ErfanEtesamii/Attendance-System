// migration شماره ۰۲۳ — منبع ثبت و مقصد ماموریت (C1). دو ستون nullable روی leave_requests:
//   source      — مبدأ ثبت (مثلاً 'miniapp_button' برای دکمه‌ی «ماموریت» در Mini App)؛ ردیف‌های قبلی NULL
//   destination — مقصد ماموریت (اختیاری، متن کوتاه پاک‌سازی‌شده)
// روی داده‌ی موجود اثری ندارد (idempotent).
module.exports = {
  name: '023_mission_source',
  up(db) {
    const cols = db.prepare('PRAGMA table_info(leave_requests)').all().map((c) => c.name);
    for (const name of ['source', 'destination']) {
      if (!cols.includes(name)) db.exec(`ALTER TABLE leave_requests ADD COLUMN ${name} TEXT;`);
    }
  },
};

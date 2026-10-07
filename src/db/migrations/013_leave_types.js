// migration شماره ۰۱۳ — جدول انواع مرخصی/مأموریت (S4-7a). فقط ساختار + دو ردیف پیش‌فرض؛ leave_requests هنوز دست‌نخورده است (S4-7b).
//
//   code                    — شناسه‌ی ماشینی یکتا (انگلیسی کوچک، مثل annual)؛ بعد از ساخت تغییر نمی‌کند
//   title                   — عنوان فارسی نمایشی
//   kind                    — 'leave' (مرخصی) | 'mission' (مأموریت)؛ منطق سیستم (مثل معافیت چک IP برای مأموریت) به kind وصل می‌شود نه به code (S4-7c)
//   is_paid                 — ۱ = با حقوق
//   requires_attachment     — ۱ = ثبت درخواست باید پیوست داشته باشد (مصرف: S4-10؛ هنوز پیوستی وجود ندارد)
//   counts_against_balance  — ۱ = از مانده‌ی مرخصی کسر می‌شود (مصرف: ledger مانده در S4-9a)
//   allowed_units           — آرایه‌ی JSON از 'day' | 'half_day' | 'hour' (مصرف: S4-8a)؛ پیش‌فرض فقط روزانه = رفتار فعلی سیستم
//   max_consecutive_days    — NULL = بدون سقف؛ وگرنه عدد صحیح > ۰ (اعمال در S4-10a)
//   is_active               — ۰ = برای درخواست جدید پیشنهاد نمی‌شود، ولی درخواست‌های قدیمی معتبر می‌مانند
//
// داده‌ی پیش‌فرض (INSERT OR IGNORE؛ اجرای دوباره چیزی را بازنویسی نمی‌کند و ویرایش‌های ادمین حفظ می‌شود):
//   annual  = «مرخصی استحقاقی» (leave، با حقوق، از مانده کسر می‌شود)
//   mission = «مأموریت» (mission، با حقوق، از مانده کسر نمی‌شود)
// این دو ردیف نگاشتِ migration بعدی (S4-7b: leave→annual، mission→mission) را ممکن می‌کنند. انواع دیگر (استعلاجی، بدون حقوق، ...) را ادمین از پنل می‌سازد؛
// قوانین/اعداد قانونی عمداً hard-code نشده‌اند. داده‌ی هیچ جدول موجودی تغییر نمی‌کند؛ پیش از اعمال، migrator طبق معمول بک‌آپ pre-migration می‌گیرد.

module.exports = {
  name: '013_leave_types',
  up(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS leave_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'leave' CHECK (kind IN ('leave', 'mission')),
      is_paid INTEGER NOT NULL DEFAULT 1 CHECK (is_paid IN (0, 1)),
      requires_attachment INTEGER NOT NULL DEFAULT 0 CHECK (requires_attachment IN (0, 1)),
      counts_against_balance INTEGER NOT NULL DEFAULT 1 CHECK (counts_against_balance IN (0, 1)),
      allowed_units TEXT NOT NULL DEFAULT '["day"]',
      max_consecutive_days INTEGER CHECK (max_consecutive_days IS NULL OR max_consecutive_days > 0),
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );`);

    const seed = db.prepare(
      `INSERT OR IGNORE INTO leave_types (code, title, kind, is_paid, requires_attachment, counts_against_balance, allowed_units, max_consecutive_days)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`
    );
    seed.run('annual', 'مرخصی استحقاقی', 'leave', 1, 0, 1, '["day"]');
    seed.run('mission', 'مأموریت', 'mission', 1, 0, 0, '["day"]');
  },
};

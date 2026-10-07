// migration شماره ۰۱۲ — جدول اعلان‌های درون‌پنلی (S4-5a). فقط ساختار؛ API خواندن/علامت‌خوردن در S4-5b و UI در S4-6a می‌آید.
//
//   user_id         — گیرنده؛ حذف دائمی کاربر اعلان‌هایش را هم پاک می‌کند (ON DELETE CASCADE؛ مثل overtime_approvals)
//   type            — نوع رویداد (snake_case انگلیسی، مثل leave_requested)
//   title / body    — متن فارسی نمایش؛ link = لینک عمیق داخل پنل (مثل #/leave)؛ data = JSON کمکی (اختیاری)
//   dedupe_key      — اختیاری؛ برای «همان اعلان» دوباره ساخته نشود. یکتایی فقط روی (user_id, dedupe_key) و فقط وقتی کلید پر است
//   read_at         — NULL = خوانده‌نشده
//   telegram_status — none (درخواست نشده) | sent | failed | skipped (درخواست شده ولی امکان‌پذیر نبود: بدون آیدی تلگرام/کاربر غیرفعال)
//
// ایندکس‌ها: یکتای dedupe؛ (user_id, read_at, id) برای فهرست و شمارنده‌ی خوانده‌نشده؛ created_at برای پاک‌سازی قدیمی‌ها (S4-5b).
// داده‌ی هیچ جدول موجودی تغییر نمی‌کند؛ پیش از اعمال، migrator طبق معمول بک‌آپ pre-migration می‌گیرد.

module.exports = {
  name: '012_notifications',
  up(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      link TEXT,
      data TEXT,
      dedupe_key TEXT,
      read_at TEXT,
      telegram_status TEXT NOT NULL DEFAULT 'none' CHECK (telegram_status IN ('none', 'sent', 'failed', 'skipped')),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );`);
    db.exec(
      'CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_dedupe ON notifications(user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;'
    );
    db.exec('CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, read_at, id);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at);');
  },
};

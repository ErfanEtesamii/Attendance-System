// migration شماره ۰۲۰ — بستن ماه (S5-3a). فقط ساختار؛ داده‌ی هیچ جدول موجودی تغییر نمی‌کند.
//
//   month_closures — وضعیت «بسته‌شدن» هر ماه شمسی (حداکثر یک ردیف برای هر (سال، ماه)).
//     • نبودن ردیف = ماه باز (هرگز بسته نشده). status فقط closed | reopened:
//         closed   ⇒ ماه بسته است؛ snapshot_json ارقام گزارش ماهانه در لحظه‌ی بستن است (S5-3b) و گزارش ماه بسته از آن خوانده می‌شود.
//         reopened ⇒ ماه بسته بوده و ادمین با دلیل بازش کرده؛ ردیف (و snapshot قبلی) برای سابقه می‌ماند و با بستن دوباره بازنویسی می‌شود
//                    (close_count یکی بالا می‌رود). سابقه‌ی کامل هر بستن/بازکردن در audit_log هم هست.
//     • period_from / period_to بازه‌ی میلادیِ ماه شمسی‌اند (برای کوئری قفل رکورد بدون تبدیل تاریخ).
//     • checklist_json چک‌لیست پیش از بستن در همان لحظه (برای اثبات اینکه چه چیزی باز بوده)؛ close_note توضیح اختیاری ادمین.
//     • حذف کاربرِ بنده‌کننده/بازکننده فقط ستونش را NULL می‌کند (ON DELETE SET NULL).
//   پیش از اعمال، migrator طبق معمول بک‌آپ pre-migration می‌گیرد.

module.exports = {
  name: '020_month_closures',
  up(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS month_closures (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      jalali_year INTEGER NOT NULL CHECK (jalali_year BETWEEN 1300 AND 1500),
      jalali_month INTEGER NOT NULL CHECK (jalali_month BETWEEN 1 AND 12),
      status TEXT NOT NULL DEFAULT 'closed' CHECK (status IN ('closed', 'reopened')),
      period_from TEXT NOT NULL,
      period_to TEXT NOT NULL,
      snapshot_json TEXT,
      checklist_json TEXT,
      close_note TEXT,
      close_count INTEGER NOT NULL DEFAULT 1,
      closed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      closed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      reopened_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      reopened_at TEXT,
      reopen_reason TEXT,
      UNIQUE (jalali_year, jalali_month)
    );`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_month_closures_period ON month_closures(period_from, period_to);');
  },
};

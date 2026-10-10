// migration شماره ۰۲۱ — اصلاح‌های ماه بسته (S5-3c). فقط ساختار؛ داده‌ی موجود دست‌نخورده.
//
//   month_closure_adjustments — هر تغییرِ مجاز (توسط ادمین، با دلیل) روی داده‌ی ماهی که «بسته» است یک ردیف می‌گیرد.
//     snapshot ماه بسته (S5-3b) عوض نمی‌شود؛ این ردیف‌ها نشان می‌دهند بعد از بستن چه چیزی تغییر کرده تا گزارش شفاف بماند
//     (مقایسه‌ی ?source=live با snapshot). close_count = نسخه‌ی بستنی که این اصلاح روی آن خورده؛ با بستن دوباره (پس از reopen)
//     snapshot جدید اصلاح‌های قبلی را شامل می‌شود و گزارش فقط اصلاح‌های نسخه‌ی جاری را نشان می‌دهد.
//     حذف ماه (CASCADE) فقط با حذف ردیف month_closures رخ می‌دهد (هیچ مسیری برایش نیست)؛ حذف کاربر فقط adjusted_by را NULL می‌کند.
module.exports = {
  name: '021_month_closure_adjustments',
  up(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS month_closure_adjustments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      closure_id INTEGER NOT NULL REFERENCES month_closures(id) ON DELETE CASCADE,
      close_count INTEGER NOT NULL DEFAULT 1,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id INTEGER,
      user_id INTEGER,
      effective_date TEXT,
      reason TEXT NOT NULL,
      details TEXT,
      adjusted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      adjusted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_month_closure_adjustments_closure ON month_closure_adjustments(closure_id, close_count);');
  },
};

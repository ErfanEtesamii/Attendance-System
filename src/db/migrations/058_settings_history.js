// تاریخچه‌ی «تاریخ‌دار» تنظیمات محاسباتی (استراحت با حقوق، ناهار، تأخیر…): هر تغییر از یک تاریخ به بعد اعمال می‌شود و روزهای قبل با مقدار
// قبلی محاسبه می‌مانند. effective_from: YYYY-MM-DD (میلادی)؛ ردیف پایه‌ی «از ابتدا» = '0000-00-00'. value همان رشته‌ی ذخیره‌شده‌ی settings.
module.exports = {
  name: '058_settings_history',
  up(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS settings_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL,
      effective_from TEXT NOT NULL,
      value TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (key, effective_from)
    );`);
  },
};

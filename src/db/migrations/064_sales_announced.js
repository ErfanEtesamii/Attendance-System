// اعلان تلگرامِ معامله‌ی موفق: هر معامله فقط یک‌بار اعلام می‌شود (کش sales_deals در هر همگام‌سازی کامل جایگزین می‌شود، پس جدول جدا لازم است).
// sales_announce_state: وقتی اولین همگام‌سازیِ بعد از نصب انجام شد، همه‌ی معامله‌های موجود بی‌صدا «اعلام‌شده» ثبت می‌شوند (بدون سیل پیام قدیمی).
module.exports = {
  name: '064_sales_announced',
  up(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS sales_announced (
      didar_id TEXT PRIMARY KEY,
      announced_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS sales_announce_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      baselined_at TEXT
    );`);
  },
};

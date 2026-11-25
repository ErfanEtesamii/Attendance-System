// پورسانت فروش: کش معامله‌های موفق کاریز فروش در دیدار + ایمیل دیدارِ هر کارمند (برای نگاشت «مسئول معامله» به کارمند پنل).
module.exports = {
  name: '063_didar_sales',
  up(db) {
    db.exec(`ALTER TABLE users ADD COLUMN didar_email TEXT;
    CREATE TABLE IF NOT EXISTS sales_deals (
      didar_id TEXT PRIMARY KEY,
      code INTEGER,
      title TEXT NOT NULL DEFAULT '',
      customer TEXT NOT NULL DEFAULT '',
      owner_email TEXT NOT NULL DEFAULT '',
      owner_name TEXT NOT NULL DEFAULT '',
      won_at TEXT NOT NULL,
      price_rial REAL NOT NULL DEFAULT 0,
      items_json TEXT NOT NULL DEFAULT '[]',
      synced_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_sales_deals_won ON sales_deals (won_at);
    CREATE INDEX IF NOT EXISTS idx_sales_deals_owner ON sales_deals (owner_email);
    CREATE TABLE IF NOT EXISTS didar_sync_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      last_sync_at TEXT,
      last_error TEXT
    );`);
  },
};

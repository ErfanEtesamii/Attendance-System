// جدول‌های قابلیت‌های جدید ایجنت: یادداشت‌ها، لاگ هشدارهای ارسال‌شده (dedupe)، عملیات منتظر تأیید انسان
module.exports = {
  name: '047_ai_agent_features',
  up(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS ai_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      author_id INTEGER NOT NULL,
      note TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    db.exec(`CREATE TABLE IF NOT EXISTS ai_alert_log (
      alert_key TEXT PRIMARY KEY,
      sent_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    db.exec(`CREATE TABLE IF NOT EXISTS ai_pending_actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_id INTEGER NOT NULL,
      kind TEXT NOT NULL,
      payload TEXT NOT NULL,
      summary TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','executed','cancelled','expired','failed')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL,
      decided_at TEXT
    )`);
  },
};

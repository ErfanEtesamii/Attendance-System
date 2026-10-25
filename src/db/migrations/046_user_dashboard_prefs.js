module.exports = {
  name: '046_user_dashboard_prefs',
  up(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS user_dashboard_prefs (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      dashboard_layout TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  },
};

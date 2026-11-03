// عکس پروفایل کاربر: یک ردیف برای هر کاربر؛ خود فایل در ATTACHMENTS_DIR/avatars با نام تصادفی نگه‌داری می‌شود.
module.exports = {
  name: '048_user_avatars',
  up(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS user_avatars (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      file_id TEXT NOT NULL,
      mime TEXT NOT NULL,
      size INTEGER NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  },
};

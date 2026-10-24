// منبع ایجاد نشست دورکاری؛ ستون به‌صورت idempotent افزوده می‌شود تا نصب‌های قدیمی هم امن ارتقا یابند.
module.exports = {
  name: '045_remote_session_source',
  up(db) {
    const cols = new Set(db.prepare('PRAGMA table_info(remote_work_sessions)').all().map((c) => c.name));
    if (!cols.has('source')) {
      db.exec("ALTER TABLE remote_work_sessions ADD COLUMN source TEXT NOT NULL DEFAULT 'miniapp' CHECK (source IN ('miniapp', 'bot')); ");
    }
  },
};

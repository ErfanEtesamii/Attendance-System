// migration شماره ۰۲۷ — گفت‌وگو روی اعتراض (فاز ۱۱، D1). idempotent؛ داده‌ی موجود تغییر نمی‌کند.
//
// مدل انتخابی: ستون status (open|resolved) و CHECK آن دست‌نخورده می‌ماند (بازسازی جدول لازم نیست و همه‌ی کوئری‌های موجود،
//   از جمله listOpenInRange در چک‌لیست بستن ماه، بدون تغییر درست کار می‌کنند). «چه کسی بست» در closed_by ثبت می‌شود:
//     open                         ⇒ باز (باز یا reopen‌شده)
//     resolved + closed_by=admin   ⇒ حل‌شده توسط ادمین/سرپرست
//     resolved + closed_by=user    ⇒ خاتمه‌یافته توسط کارمند
//   «پاسخ داده شده» از روی sender_role آخرین پیام مشتق می‌شود (ذخیره نمی‌شود).
//
// تغییرها:
//   • جدول dispute_messages (thread) + ایندکس روی dispute_id
//   • ستون‌های record_disputes: closed_by، closed_at، reopen_count (پیش‌فرض ۰)، last_message_at
//   • اعتراض‌های قدیمی: پیام اولیه‌شان (record_disputes.message) به‌عنوان اولین پیام thread کپی می‌شود
//     (ستون message باقی می‌ماند)؛ قدیمی‌های resolved ⇒ closed_by='admin' و closed_at=updated_at.
function columnNames(db, table) {
  return db.pragma(`table_info(${table})`).map((c) => c.name);
}

module.exports = {
  name: '027_dispute_messages',
  up(db) {
    const have = columnNames(db, 'record_disputes');
    if (!have.includes('closed_by')) {
      db.exec("ALTER TABLE record_disputes ADD COLUMN closed_by TEXT CHECK (closed_by IN ('admin','user'))");
    }
    if (!have.includes('closed_at')) db.exec('ALTER TABLE record_disputes ADD COLUMN closed_at TEXT');
    if (!have.includes('reopen_count')) db.exec('ALTER TABLE record_disputes ADD COLUMN reopen_count INTEGER NOT NULL DEFAULT 0');
    if (!have.includes('last_message_at')) db.exec('ALTER TABLE record_disputes ADD COLUMN last_message_at TEXT');

    // زمان‌ها مثل record_disputes با datetime('now') (UTC، «YYYY-MM-DD HH:MM:SS») تا substr(created_at,1,10) در کوئری‌های بازه معنی‌دار بماند.
    // محدودیت طول فقط سمت سرویس است (پیام‌های قدیمی بدون سقف بوده‌اند؛ CHECK طول، migration را روی داده‌ی قدیمی می‌شکست).
    db.exec(`CREATE TABLE IF NOT EXISTS dispute_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dispute_id INTEGER NOT NULL REFERENCES record_disputes(id) ON DELETE CASCADE,
      sender_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      sender_role TEXT NOT NULL CHECK (sender_role IN ('user','admin')),
      message TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_dispute_messages_dispute ON dispute_messages(dispute_id, id)');

    // اعتراض قدیمی ⇒ پیام اولیه‌اش اولین پیام thread (فقط برای اعتراضی که هنوز پیامی ندارد؛ اجرای دوباره چیزی اضافه نمی‌کند)
    db.exec(`INSERT INTO dispute_messages (dispute_id, sender_user_id, sender_role, message, created_at)
             SELECT d.id, d.user_id, 'user', d.message, d.created_at
               FROM record_disputes d
              WHERE NOT EXISTS (SELECT 1 FROM dispute_messages m WHERE m.dispute_id = d.id)
              ORDER BY d.id`);
    db.exec('UPDATE record_disputes SET last_message_at = created_at WHERE last_message_at IS NULL');
    db.exec("UPDATE record_disputes SET closed_by = 'admin', closed_at = updated_at WHERE status = 'resolved' AND closed_by IS NULL AND closed_at IS NULL");
  },
};

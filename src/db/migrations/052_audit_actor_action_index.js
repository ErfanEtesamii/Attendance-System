// مرحله ۲: شمارش سهمیه‌ی اصلاح رکورد سرپرست از روی خودِ audit_log (بدون جدول شمارنده‌ی جدا) ⇒ ایندکس (کاربر، عمل، زمان).
module.exports = {
  name: '052_audit_actor_action_index',
  up(db) {
    db.exec('CREATE INDEX IF NOT EXISTS idx_audit_user_action_time ON audit_log(user_id, action, occurred_at)');
  },
};

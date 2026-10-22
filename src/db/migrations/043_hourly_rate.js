// Phase 20: نرخ ساعتیِ کارمند برای کارتِ «کارکرد تخمینی ماه» در Mini App.
// واحد: هزار تومان در ساعت. NULL = نرخ تعریف نشده ⇒ کارت نمایش داده نمی‌شود.
module.exports = {
  name: '043_hourly_rate',
  up(db) {
    const cols = new Set(db.prepare("PRAGMA table_info('users')").all().map((c) => c.name));
    if (!cols.has('hourly_rate_kt')) db.exec('ALTER TABLE users ADD COLUMN hourly_rate_kt INTEGER NULL CHECK (hourly_rate_kt IS NULL OR hourly_rate_kt >= 0);');
  },
};

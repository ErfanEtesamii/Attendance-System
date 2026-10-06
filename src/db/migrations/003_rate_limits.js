// migration شماره ۰۰۳ — جدول شمارنده‌های rate limit (بخش ۲-ب۲).
//
// تا اینجا شمارنده‌ها فقط در حافظه‌ی پروسه بودند؛ با هر ری‌استارت سرویس (NSSM) صفر می‌شدند و
// مهاجم می‌توانست با ایجاد crash/ری‌استارت، سقف تلاش ورود را دور بزند. حالا شمارنده‌ها در SQLite ذخیره می‌شوند.
//
// ساختار: یک ردیف به‌ازای هر (limiter, key) با پنجره‌ی ثابت. reset_at بر حسب میلی‌ثانیه‌ی epoch است.
// جدول فقط داده‌ی کوتاه‌عمر دارد (پنجره‌ها حداکثر ۱۵ دقیقه)؛ ردیف‌های منقضی دوره‌ای پاک می‌شوند.
// داده‌ی تردد/مرخصی/audit به این جدول ربطی ندارد و هیچ‌چیز از آن‌ها تغییر نمی‌کند.

module.exports = {
  name: '003_rate_limits',
  up(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS rate_limit_hits (
      limiter TEXT NOT NULL,
      bucket_key TEXT NOT NULL,
      count INTEGER NOT NULL,
      reset_at INTEGER NOT NULL,
      PRIMARY KEY (limiter, bucket_key)
    );`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_rate_limit_reset ON rate_limit_hits(reset_at);');
  },
};

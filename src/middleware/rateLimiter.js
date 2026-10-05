// Rate limiting ساده و بدون وابستگی خارجی (فاز ۹).
//
// چرا کتابخانه‌ای مثل express-rate-limit استفاده نشد: این sandbox توسعه دسترسی اینترنت
// برای نصب پکیج جدید ندارد. این پیاده‌سازی fixed-window در حافظه، برای یک پروسه‌ی تک‌سرور
// (دقیقاً معماری این پروژه - یک سرویس NSSM، بدون کلاستر/لود بالانسر) کاملاً کافی است.
// اگر روزی پشت چند پروسه/سرور رفت، باید به یک store مشترک (Redis و ...) مهاجرت کند.
//
// نکته پیکربندی: این middleware از req.ip برای شمارش استفاده می‌کند. طبق تصمیم پروژه
// (بدون ریورس‌پراکسی، TRUST_PROXY=false در production)، req.ip همان IP واقعی مبدأ است.

const buckets = new Map(); // key -> { count, resetAt }
let limiterSeq = 0; // هر limiter شمارنده‌ی مستقل خودش را دارد (قبلاً همه فقط با IP کلید می‌خوردند و شمارنده‌ی مشترک داشتند)

function cleanupExpired(now) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

/**
 * @param {object} opts
 * @param {number} opts.windowMs - طول پنجره زمانی به میلی‌ثانیه
 * @param {number} opts.max - حداکثر تعداد درخواست مجاز در هر پنجره
 * @param {string} opts.message - پیام خطای فارسی برگشتی
 * @param {(req: import('express').Request) => string} [opts.keyFn] - تابع تولید کلید (پیش‌فرض: IP)
 */
function createRateLimiter({ windowMs, max, message, keyFn }) {
  limiterSeq += 1;
  const limiterId = limiterSeq;
  return function rateLimiter(req, res, next) {
    const now = Date.now();
    // هر چند صد درخواست یک‌بار، سطل‌های منقضی‌شده را پاک می‌کنیم تا حافظه نشتی نداشته باشد
    if (buckets.size > 5000) cleanupExpired(now);

    const key = `${limiterId}:${(keyFn ? keyFn(req) : req.ip) || 'unknown'}`;
    let bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;

    if (bucket.count > max) {
      const retryAfterSeconds = Math.ceil((bucket.resetAt - now) / 1000);
      res.set('Retry-After', String(retryAfterSeconds));
      return res.status(429).json({ error: message || 'تعداد درخواست‌ها بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.' });
    }

    next();
  };
}

// محدودیت روی مسیرهای ثبت تردد: هر IP حداکثر ۲۰ درخواست در دقیقه
// (کارمند عادی حداکثر چند بار در روز این دکمه‌ها را می‌زند؛ ۲۰ در دقیقه سقف سخاوتمندانه‌ای
// برای کلیک‌های مکرر تصادفی/دوبار-تپ روی موبایل است، ولی جلوی اسکریپت/اسپم را می‌گیرد).
const attendanceActionLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 20,
  message: 'تعداد تلاش‌ برای ثبت تردد بیش از حد مجاز است. لطفاً یک دقیقه صبر کنید.',
});

// محدودیت روی لاگین پنل ادمین: هر IP حداکثر ۱۰ تلاش در ۱۵ دقیقه (ضد brute-force)
const adminLoginLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'تعداد تلاش‌های ورود بیش از حد مجاز است. لطفاً ۱۵ دقیقه دیگر دوباره تلاش کنید.',
});

// ورود خودکار از دکمه‌ی «پنل» بات (initData امضاشده / لینک یک‌بارمصرف ۱۹۲ بیتی): قابل حدس‌زدن نیست،
// ولی چون همه‌ی کارمندان یک شرکت ممکن است پشت یک IP باشند، سقف باید سخاوتمندانه‌تر از کد/ویجت باشد.
const panelAutoLoginLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 120,
  message: 'تعداد تلاش‌های ورود بیش از حد مجاز است. لطفاً چند دقیقه دیگر دوباره تلاش کنید.',
});

module.exports = { createRateLimiter, attendanceActionLimiter, adminLoginLimiter, panelAutoLoginLimiter };

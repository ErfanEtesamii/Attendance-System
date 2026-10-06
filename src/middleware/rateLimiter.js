// Rate limiting بدون وابستگی خارجی (فاز ۹ + بخش ۲-ب۲).
//
// تصمیم ۲-ب۲: شمارنده‌ها در SQLite (جدول rate_limit_hits، repository: rateLimitRepository) نگهداری می‌شوند
// تا با ری‌استارت سرویس صفر نشوند (وگرنه crash/ری‌استارت = دورزدن سقف تلاش ورود).
//   • هر درخواست یک UPSERT کوچک روی SQLite است (همزمان/sync با better-sqlite3)؛ برای چند ده درخواست در ثانیه
//     (مقیاس این شرکت) ناچیز است.
//   • اگر دیتابیس خطا بدهد (قفل/دیسک پر)، limiter fail-open نمی‌شود؛ موقتاً به شمارنده‌ی حافظه برمی‌گردد
//     تا هم سرویس از کار نیفتد و هم محدودیت کاملاً برداشته نشود (فقط ماندگاری موقتاً از دست می‌رود).
//   • RATE_LIMIT_STORE=memory رفتار قبلی (فقط حافظه) را برمی‌گرداند.
//   • همچنان fixed-window و تک‌پروسه است؛ اگر روزی چند پروسه/سرور شد، SQLite مشترک هنوز درست کار می‌کند
//     ولی برای چند سرور باید store مشترک واقعی (Redis و ...) جایگزین شود.
//
// ثبت در audit: هر برخورد به ۴۲۹ با throttle در audit_log ثبت می‌شود (action = rate_limit_exceeded):
//   فقط اولین درخواست مسدودشده‌ی هر (limiter, key) در هر پنجره (حتی بعد از ری‌استارت) + سقف سراسری در دقیقه.
//
// نکته پیکربندی: کلید پیش‌فرض req.ip است. طبق تصمیم پروژه (بدون ریورس‌پراکسی، TRUST_PROXY=false)،
// req.ip همان IP واقعی مبدأ است.

const config = require('../config');
const rateLimitRepository = require('../repositories/rateLimitRepository');
const auditRepository = require('../repositories/auditRepository');

const AUDIT_ACTION = 'rate_limit_exceeded';
const AUDIT_GLOBAL_MAX_PER_MINUTE = 30; // سقف سراسری رکورد audit ناشی از ۴۲۹ در هر دقیقه
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;

// ---------- شمارنده‌ی حافظه (fallback و حالت memory) ----------
const memBuckets = new Map(); // `${limiter}\u0000${key}` -> { count, resetAt }

function memHit(limiter, key, windowMs, now) {
  if (memBuckets.size > 5000) {
    for (const [k, b] of memBuckets) if (b.resetAt <= now) memBuckets.delete(k);
  }
  const id = `${limiter}\u0000${String(key).slice(0, rateLimitRepository.MAX_KEY_LENGTH)}`;
  let b = memBuckets.get(id);
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + windowMs };
    memBuckets.set(id, b);
  }
  b.count += 1;
  return { count: b.count, resetAt: b.resetAt };
}

// ---------- store پیش‌فرض: SQLite با fallback ----------
let dbErrorLoggedAt = 0;

const defaultStore = {
  hit(limiter, key, windowMs, now) {
    if (config.rateLimitStore === 'memory') return memHit(limiter, key, windowMs, now);
    try {
      return rateLimitRepository.hit(limiter, key, windowMs, now);
    } catch (err) {
      if (now - dbErrorLoggedAt > 60 * 1000) {
        dbErrorLoggedAt = now;
        console.error(`[rate-limit] خطای دیتابیس؛ موقتاً از شمارنده‌ی حافظه استفاده می‌شود: ${err.message}`);
      }
      return memHit(limiter, key, windowMs, now);
    }
  },
};

// ---------- پاک‌سازی دوره‌ای ردیف‌های منقضی ----------
let cleanupTimer = null;

function runCleanup(now = Date.now()) {
  try {
    return rateLimitRepository.purgeExpired(now);
  } catch (err) {
    console.error(`[rate-limit] پاک‌سازی ناموفق: ${err.message}`);
    return 0;
  }
}

function ensureCleanupTimer() {
  if (cleanupTimer || config.rateLimitStore === 'memory') return;
  runCleanup(); // اولین استفاده بعد از ری‌استارت: ردیف‌های منقضی قبلی را پاک کن
  cleanupTimer = setInterval(() => runCleanup(), CLEANUP_INTERVAL_MS);
  if (cleanupTimer.unref) cleanupTimer.unref(); // مانع خاموش‌شدن پروسه (و تست‌ها) نشود
}

// ---------- ثبت throttle‌شده در audit ----------
// قاعده‌ی اصلی: فقط «اولین» درخواست مسدودشده‌ی هر پنجره (count === max + 1) ثبت می‌شود. چون count از خود
// شمارنده‌ی ماندگار می‌آید، ری‌استارت سرویس هم رکورد تکراری برای همان پنجره نمی‌سازد.
// لایه‌ی دوم: سقف سراسری در دقیقه (حمله با IPهای زیاد لاگ را پر نکند).
let auditMinuteStart = 0;
let auditMinuteCount = 0;

function maybeAudit({ limiter, key, req, resetAt, count, now }) {
  if (now - auditMinuteStart >= 60 * 1000) {
    auditMinuteStart = now;
    auditMinuteCount = 0;
  }
  if (auditMinuteCount >= AUDIT_GLOBAL_MAX_PER_MINUTE) return;

  auditMinuteCount += 1;
  try {
    auditRepository.logEvent({
      action: AUDIT_ACTION,
      ipAddress: req.ip || null,
      // فقط مسیر بدون query string (ممکن است توکن/کد داشته باشد) و بدون هیچ مقدار body/header
      details: {
        limiter,
        key: String(key).slice(0, 80),
        method: req.method,
        path: `${req.baseUrl || ''}${req.path || ''}`.slice(0, 200),
        count,
        window_resets_at: new Date(resetAt).toISOString(),
      },
    });
  } catch (err) {
    console.error(`[rate-limit] ثبت audit ناموفق: ${err.message}`);
  }
}

let limiterSeq = 0;

/**
 * @param {object} opts
 * @param {string} [opts.name] - نام پایدار limiter؛ کلید ذخیره‌ی ماندگار است (باید بین ری‌استارت‌ها ثابت بماند).
 *                               اگر داده نشود نام ترتیبی «limiter-N» ساخته می‌شود که با تغییر ترتیب require عوض می‌شود.
 * @param {number} opts.windowMs - طول پنجره زمانی به میلی‌ثانیه
 * @param {number} opts.max - حداکثر تعداد درخواست مجاز در هر پنجره
 * @param {string} opts.message - پیام خطای فارسی برگشتی
 * @param {(req: import('express').Request) => string} [opts.keyFn] - تابع تولید کلید (پیش‌فرض: IP)
 * @param {{hit: Function}} [opts.store] - فقط برای تست
 * @param {boolean} [opts.audit=true] - ثبت ۴۲۹ در audit_log
 */
function createRateLimiter({ name, windowMs, max, message, keyFn, store, audit = true }) {
  limiterSeq += 1;
  const limiterName = name || `limiter-${limiterSeq}`;
  const useStore = store || defaultStore;
  return function rateLimiter(req, res, next) {
    const now = Date.now();
    if (!store) ensureCleanupTimer();

    const key = String((keyFn ? keyFn(req) : req.ip) || 'unknown');
    const { count, resetAt } = useStore.hit(limiterName, key, windowMs, now);

    if (count > max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((resetAt - now) / 1000));
      if (audit && count === max + 1) maybeAudit({ limiter: limiterName, key, req, resetAt, count, now });
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
  name: 'attendance-action',
  windowMs: 60 * 1000,
  max: 20,
  message: 'تعداد تلاش‌ برای ثبت تردد بیش از حد مجاز است. لطفاً یک دقیقه صبر کنید.',
});

// محدودیت روی لاگین پنل ادمین: هر IP حداکثر ۱۰ تلاش در ۱۵ دقیقه (ضد brute-force)
const adminLoginLimiter = createRateLimiter({
  name: 'admin-login',
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'تعداد تلاش‌های ورود بیش از حد مجاز است. لطفاً ۱۵ دقیقه دیگر دوباره تلاش کنید.',
});

// ورود خودکار از دکمه‌ی «پنل» بات (initData امضاشده / لینک یک‌بارمصرف ۱۹۲ بیتی): قابل حدس‌زدن نیست،
// ولی چون همه‌ی کارمندان یک شرکت ممکن است پشت یک IP باشند، سقف باید سخاوتمندانه‌تر از کد/ویجت باشد.
const panelAutoLoginLimiter = createRateLimiter({
  name: 'panel-auto-login',
  windowMs: 15 * 60 * 1000,
  max: 120,
  message: 'تعداد تلاش‌های ورود بیش از حد مجاز است. لطفاً چند دقیقه دیگر دوباره تلاش کنید.',
});

module.exports = {
  createRateLimiter,
  attendanceActionLimiter,
  adminLoginLimiter,
  panelAutoLoginLimiter,
  runCleanup,
  AUDIT_ACTION,
};

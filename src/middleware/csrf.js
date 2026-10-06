// محافظت CSRF برای متدهای نوشتنی پنل (/api/admin/*) — بخش ۲-الف.
//
// دو لایه (هر دو لازم‌اند):
//  ۱) هدر سفارشی X-Requested-With: AttendancePanel — مرورگر برای هدر سفارشی در درخواست cross-origin
//     preflight می‌فرستد و چون سرور CORS ندارد، صفحه‌ی مهاجم نمی‌تواند این هدر را بفرستد.
//  ۲) بررسی Origin (و در نبودش Referer) نسبت به Host درخواست. Origin «null» (iframe sandbox) رد می‌شود.
//     اگر هیچ‌کدام نبود، فقط به‌خاطر وجود هدر سفارشی عبور می‌کند (کلاینت‌های غیرمرورگری مثل curl/تست).
//
// Mini App (/api/miniapp) کوکی ندارد و با هدر X-Telegram-Init-Data احراز می‌شود؛ مشمول CSRF نیست.

const config = require('../config');

const CSRF_HEADER = 'x-requested-with';
const CSRF_HEADER_VALUE = 'AttendancePanel';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

let lastWarnAt = 0;
function warnThrottled(req, reason) {
  const now = Date.now();
  if (now - lastWarnAt < 10000) return; // حداکثر یک لاگ در هر ۱۰ ثانیه تا لاگ پر نشود
  lastWarnAt = now;
  console.warn(`[CSRF] رد شد (${reason}): ${req.method} ${req.originalUrl} ip=${req.ip} origin=${req.headers.origin || '-'}`);
}

function parseOrigin(value) {
  if (!value || value === 'null') return null;
  try {
    const u = new URL(value);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u;
  } catch (_) {
    return null;
  }
}

function isAllowedOrigin(value, req) {
  const u = parseOrigin(value);
  if (!u) return false;
  if (config.csrfExtraOrigins.includes(u.origin)) return true;
  const host = String(req.headers.host || '').toLowerCase();
  if (!host || u.host.toLowerCase() !== host) return false;
  // روی اتصال TLS واقعی، Origin هم باید https باشد
  if (req.secure && u.protocol !== 'https:') return false;
  return true;
}

function csrfProtection(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();

  const reject = (reason) => {
    warnThrottled(req, reason);
    return res.status(403).json({ error: 'درخواست نامعتبر است (محافظت CSRF). صفحه را تازه‌سازی کنید.', code: 'CSRF' });
  };

  if (req.headers[CSRF_HEADER] !== CSRF_HEADER_VALUE) return reject('missing-header');

  const origin = req.headers.origin;
  if (origin !== undefined) {
    if (!isAllowedOrigin(origin, req)) return reject('bad-origin');
  } else if (req.headers.referer) {
    if (!isAllowedOrigin(req.headers.referer, req)) return reject('bad-referer');
  }
  next();
}

module.exports = { csrfProtection, CSRF_HEADER, CSRF_HEADER_VALUE, isAllowedOrigin };

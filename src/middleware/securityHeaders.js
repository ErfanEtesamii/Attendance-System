// هدرهای امنیتی (بخش ۲-الف) — بدون وابستگی خارجی (helmet لازم نشد؛ هدرها کم و مسیرمحورند).
//
// سه نوع مسیر داریم و هرکدام سیاست خودش را دارد:
//   api     → /api/*   : فقط JSON/CSV؛ سیاست بسته (default-src 'none') و Cache-Control: no-store
//   panel   → /admin/* : پنل مدیریتی (ویجت ورود تلگرام + داخل تلگرام باز می‌شود)
//   miniapp → بقیه     : Mini App کارمند در ریشه‌ی دامنه
//
// ⚠️ Mini App و پنل داخل Telegram باز می‌شوند، پس:
//   • script-src علاوه بر 'self' فقط https://telegram.org (telegram-web-app.js و telegram-widget.js)
//   • frame-ancestors برای مسیرهای panel/miniapp اجازه‌ی web.telegram.org و دامنه‌های تلگرام را می‌دهد
//     (کلاینت‌های native iframe نیستند و به این بند اهمیتی نمی‌دهند)
//   • frame-src https://oauth.telegram.org برای iframe ویجت «ورود با تلگرام»
//   • استایل inline فقط به‌صورت صفت style="" (style-src-attr) مجاز است، نه تگ <style>
//
// حالت‌های CSP (CSP_MODE): off | report-only (پیش‌فرض) | enforce
//   در report-only یک سیاست «پایه» (frame-ancestors, base-uri, object-src) اجباری است و سیاست کامل
//   فقط گزارش می‌شود (به POST /api/csp-report). frame-ancestors در report-only توسط مرورگر نادیده گرفته
//   می‌شود، به همین دلیل در بخش پایه‌ی اجباری آمده است.

const config = require('../config');

const CSP_REPORT_PATH = '/api/csp-report';
const TELEGRAM_ANCESTORS = ['https://web.telegram.org', 'https://*.telegram.org'];

function classifyPath(pathname) {
  if (pathname === '/api' || pathname.startsWith('/api/')) return 'api';
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return 'panel';
  return 'miniapp';
}

function frameAncestors(kind) {
  return kind === 'api' ? "'none'" : ["'self'", ...TELEGRAM_ANCESTORS].join(' ');
}

// بخش‌های کم‌ریسک که همیشه اجباری‌اند (حتی در report-only)
function buildBaselineCsp(kind) {
  if (kind === 'api') return "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
  return `frame-ancestors ${frameAncestors(kind)}; base-uri 'self'; object-src 'none'`;
}

function buildFullCsp(kind, { unsafeEval = false, reportUri = CSP_REPORT_PATH } = {}) {
  if (kind === 'api') return buildBaselineCsp('api');
  const panel = kind === 'panel';
  const scriptSrc = ["'self'", 'https://telegram.org'];
  if (panel && unsafeEval) scriptSrc.push("'unsafe-eval'");
  const directives = [
    "default-src 'self'",
    `script-src ${scriptSrc.join(' ')}`,
    "style-src 'self'",
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    panel ? "connect-src 'self' https://telegram.org https://oauth.telegram.org" : "connect-src 'self'",
    panel ? 'frame-src https://oauth.telegram.org https://telegram.org' : "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `frame-ancestors ${frameAncestors(kind)}`,
  ];
  if (reportUri) directives.push(`report-uri ${reportUri}`);
  return directives.join('; ');
}

function securityHeaders(req, res, next) {
  const kind = classifyPath(req.path || req.url.split('?')[0]);

  res.setHeader('X-Content-Type-Options', 'nosniff');
  // فقط origin (بدون مسیر/query) به سایت‌های دیگر؛ چون آدرس ورود ممکن است ?t=<توکن> داشته باشد
  res.setHeader('Referrer-Policy', 'strict-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()');

  if (kind === 'api') {
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cache-Control', 'no-store');
  }

  // HSTS فقط روی اتصال TLS واقعی (با TRUST_PROXY=false، req.secure یعنی خود سوکت رمزنگاری‌شده است)
  if (req.secure && config.hstsMaxAgeSeconds > 0) {
    res.setHeader('Strict-Transport-Security', `max-age=${config.hstsMaxAgeSeconds}`);
  }

  const opts = { unsafeEval: config.cspPanelUnsafeEval };
  if (kind === 'api') {
    res.setHeader('Content-Security-Policy', buildBaselineCsp('api'));
  } else if (config.cspMode === 'enforce') {
    res.setHeader('Content-Security-Policy', buildFullCsp(kind, opts));
  } else if (config.cspMode === 'report-only') {
    res.setHeader('Content-Security-Policy', buildBaselineCsp(kind));
    res.setHeader('Content-Security-Policy-Report-Only', buildFullCsp(kind, opts));
  } else {
    res.setHeader('Content-Security-Policy', buildBaselineCsp(kind));
  }
  next();
}

module.exports = { securityHeaders, buildFullCsp, buildBaselineCsp, classifyPath, CSP_REPORT_PATH };

// ساخت هدر Set-Cookie نشست پنل (یک‌جا، تا ورود/خروج/ابطال دقیقاً یک ویژگی‌ها را استفاده کنند).
//
// تصمیم‌ها:
//  • HttpOnly همیشه. Secure در production، روی HTTPS مستقیم، یا وقتی اتصال واقعاً TLS است.
//  • SameSite=Strict پیش‌فرض (ADMIN_COOKIE_SAMESITE=lax برای بازگشت اضطراری). تمام درخواست‌های پنل
//    از صفحه‌ی خود همین دامنه (fetch هم‌سایت) می‌آیند، پس Strict مشکلی ایجاد نمی‌کند؛ حتی اگر ورود
//    از لینک بات (ناوبری cross-site به /admin/) شروع شود، صفحه‌ی استاتیک بدون کوکی لود می‌شود و fetchهای
//    بعدی هم‌سایت‌اند. ⚠️ Mini App داخل iframe «Telegram Web» (web.telegram.org) کوکی third-party حساب می‌شود
//    و با Lax هم ارسال نمی‌شد؛ این محدودیت از قبل بوده و با Strict بدتر نمی‌شود.
//  • Path=/ حفظ شد (کوکی‌های قدیمی Path=/ دارند؛ تغییر Path باعث دو کوکی هم‌نام می‌شد و خروج کامل را مختل می‌کرد).
//  • نام کوکی عوض نشد (پیشوند __Host- همه‌ی نشست‌های فعلی را قطع می‌کرد).

const config = require('../config');

const SESSION_COOKIE_NAME = 'attendance_admin_session';

function sameSiteAttr() {
  return config.adminCookieSameSite === 'lax' ? 'Lax' : 'Strict';
}

function isSecureContext(req) {
  return config.nodeEnv === 'production' || config.httpsEnabled || !!(req && req.secure);
}

function baseParts(req) {
  const parts = ['HttpOnly', 'Path=/', `SameSite=${sameSiteAttr()}`];
  if (isSecureContext(req)) parts.push('Secure');
  return parts;
}

function buildSessionCookie(token, maxAgeSeconds, req) {
  return [`${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`, ...baseParts(req), `Max-Age=${maxAgeSeconds}`].join('; ');
}

function buildClearCookie(req) {
  return [`${SESSION_COOKIE_NAME}=`, ...baseParts(req), 'Max-Age=0'].join('; ');
}

module.exports = { SESSION_COOKIE_NAME, buildSessionCookie, buildClearCookie };

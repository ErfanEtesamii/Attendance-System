// Session سبک و بدون‌حالت (stateless) برای پنل مدیریتی وب.
// به‌جای نگه‌داشتن session در دیتابیس، خود کوکی حاوی payload + امضای HMAC است؛
// سرور فقط امضا را با کلید مخفی (config.adminSessionSecret) تأیید می‌کند.
// این یعنی هیچ جدول/فایل اضافه‌ای برای نشست‌ها لازم نیست و restart سرور هم session را باطل نمی‌کند.

const crypto = require('crypto');

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function sign(payloadB64, secret) {
  return crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
}

function timingSafeEqualStr(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * @param {object} payload مثلاً { userId: 3 }
 * @param {string} secret
 * @param {number} maxAgeSeconds
 */
function createSessionToken(payload, secret, maxAgeSeconds) {
  const body = { ...payload, exp: Math.floor(Date.now() / 1000) + maxAgeSeconds };
  const payloadB64 = base64url(JSON.stringify(body));
  const signature = sign(payloadB64, secret);
  return `${payloadB64}.${signature}`;
}

/**
 * @returns {object|null} payload در صورت معتبر بودن امضا و منقضی‌نشده بودن، وگرنه null
 */
function verifySessionToken(token, secret) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, signature] = parts;

  const expectedSignature = sign(payloadB64, secret);
  if (!timingSafeEqualStr(signature, expectedSignature)) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
  } catch (_) {
    return null;
  }

  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

module.exports = { createSessionToken, verifySessionToken };

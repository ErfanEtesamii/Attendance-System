// اعتبارسنجی داده‌ی برگشتی از Telegram Login Widget (برای ورود مدیران به پنل وب - فاز ۸).
// طبق مستندات رسمی: https://core.telegram.org/widgets/login#checking-authorization
//
// ⚠️ نکته مهم: این الگوریتم با الگوریتم تأیید initData در Mini App (فاز ۴، telegramInitData.js) فرق دارد!
// اینجا secret_key = SHA256 ساده‌ی توکن بات است (نه HMAC با کلید "WebAppData").
// این دو را نباید با هم اشتباه گرفت یا یکی به‌جای دیگری استفاده کرد.

const crypto = require('crypto');

const DEFAULT_MAX_AGE_SECONDS = 24 * 60 * 60; // یک روز - بعد از این مدت باید دوباره لاگین کند

/**
 * @param {object} authData شیء دریافتی از ویجت (id, first_name, username, photo_url, auth_date, hash, ...)
 * @param {string} botToken
 * @param {number} [maxAgeSeconds]
 * @returns {object|null} همان authData (بدون hash) در صورت معتبر بودن، وگرنه null
 */
function verifyLoginWidgetData(authData, botToken, maxAgeSeconds = DEFAULT_MAX_AGE_SECONDS) {
  if (!authData || typeof authData !== 'object' || !botToken) return null;

  const { hash, ...rest } = authData;
  if (!hash || typeof hash !== 'string') return null;

  const pairs = Object.keys(rest)
    .filter((k) => rest[k] !== undefined && rest[k] !== null)
    .sort()
    .map((k) => `${k}=${rest[k]}`);
  const dataCheckString = pairs.join('\n');

  // secret_key = SHA256(bot_token)  -- توجه: اینجا HMAC نیست، هش ساده‌ی توکن است
  const secretKey = crypto.createHash('sha256').update(botToken).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  const hashBuffer = Buffer.from(hash, 'hex');
  const computedBuffer = Buffer.from(computedHash, 'hex');
  if (
    hashBuffer.length !== computedBuffer.length ||
    !crypto.timingSafeEqual(hashBuffer, computedBuffer)
  ) {
    return null;
  }

  const authDate = parseInt(rest.auth_date, 10);
  if (Number.isNaN(authDate)) return null;
  const ageSeconds = Math.floor(Date.now() / 1000) - authDate;
  if (ageSeconds > maxAgeSeconds || ageSeconds < -60) return null;

  return rest;
}

module.exports = { verifyLoginWidgetData };

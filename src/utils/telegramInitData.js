// اعتبارسنجی رشته‌ی initData ارسال‌شده توسط Telegram Mini App، طبق الگوریتم رسمی تلگرام:
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
//
// این تنها راه مطمئن برای فهمیدن «این درخواست واقعاً از طرف همین کاربر تلگرام آمده» است؛
// بدون این چک، هرکسی می‌توانست هر userId دلخواهی را در بدنه درخواست بفرستد و جای یک
// کارمند دیگر ثبت تردد کند. این ماژول پایه‌ی احراز هویت فاز ۴ (Mini App) است.

const crypto = require('crypto');

// initData حداکثر تا این مدت (بر حسب ثانیه) از لحظه صدور معتبر شمرده می‌شود
// تا جلوی حملات replay (استفاده مجدد از یک initData قدیمی/افشاشده) گرفته شود.
const DEFAULT_MAX_AGE_SECONDS = 24 * 60 * 60; // ۲۴ ساعت

/**
 * @param {string} initData رشته خام initData (فرمت query-string) که Telegram.WebApp.initData برمی‌گرداند
 * @param {string} botToken توکن بات (از BotFather)
 * @param {number} [maxAgeSeconds]
 * @returns {{ telegramUser: object, authDate: number } | null} در صورت نامعتبر بودن، null
 */
function verifyInitData(initData, botToken, maxAgeSeconds = DEFAULT_MAX_AGE_SECONDS) {
  if (!initData || !botToken) return null;

  let params;
  try {
    params = new URLSearchParams(initData);
  } catch (_) {
    return null;
  }

  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  // ساخت data_check_string: هر key=value در یک خط، به ترتیب الفبایی کلید
  const pairs = [];
  for (const [key, value] of params.entries()) {
    pairs.push(`${key}=${value}`);
  }
  pairs.sort();
  const dataCheckString = pairs.join('\n');

  // secret_key = HMAC_SHA256(key="WebAppData", message=botToken)
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  // computedHash = HMAC_SHA256(key=secretKey, message=dataCheckString)
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  // مقایسه امن (timing-safe) به‌جای === ساده
  const hashBuffer = Buffer.from(hash, 'hex');
  const computedBuffer = Buffer.from(computedHash, 'hex');
  if (
    hashBuffer.length !== computedBuffer.length ||
    !crypto.timingSafeEqual(hashBuffer, computedBuffer)
  ) {
    return null;
  }

  const authDate = parseInt(params.get('auth_date'), 10);
  if (Number.isNaN(authDate)) return null;

  const ageSeconds = Math.floor(Date.now() / 1000) - authDate;
  // اجازه کمی چرخش ساعت به جلو (clock skew) هم داده می‌شود
  if (ageSeconds > maxAgeSeconds || ageSeconds < -60) return null;

  let telegramUser = null;
  const userJson = params.get('user');
  if (userJson) {
    try {
      telegramUser = JSON.parse(userJson);
    } catch (_) {
      return null;
    }
  }
  if (!telegramUser || !telegramUser.id) return null;

  return { telegramUser, authDate };
}

module.exports = { verifyInitData };

// اعتبارسنجی رسمی initData مینی‌اپ بله طبق https://docs.bale.ai/miniapp
const crypto = require('crypto');
const DEFAULT_MAX_AGE_SECONDS = 24 * 60 * 60;

function verifyBaleInitData(initData, botToken, maxAgeSeconds = DEFAULT_MAX_AGE_SECONDS) {
  if (!initData || !botToken) return null;
  let params;
  try { params = new URLSearchParams(initData); } catch (_) { return null; }
  const hash = params.get('hash');
  if (!/^[a-f0-9]{64}$/i.test(hash || '')) return null;
  params.delete('hash');
  const dataCheckString = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  // مستند بله: secret = HMAC_SHA256(key=bot_token, message="WebAppData")
  const secret = crypto.createHmac('sha256', botToken).update('WebAppData').digest();
  const expected = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
  if (!crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(expected, 'hex'))) return null;
  const authDate = Number.parseInt(params.get('auth_date'), 10);
  const age = Math.floor(Date.now() / 1000) - authDate;
  if (!Number.isInteger(authDate) || age > maxAgeSeconds || age < -60) return null;
  try {
    const baleUser = JSON.parse(params.get('user') || 'null');
    return baleUser && baleUser.id ? { baleUser, authDate } : null;
  } catch (_) { return null; }
}

module.exports = { verifyBaleInitData };

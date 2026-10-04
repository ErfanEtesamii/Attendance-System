// کد ورود یک‌بارمصرف برای پنل مدیریتی (جایگزین Telegram Login Widget).
// مدیر در بات دستور /panel را می‌زند، یک کد ۸ رقمی می‌گیرد و در صفحه‌ی پنل وارد می‌کند.
// کدها فقط در حافظه نگه‌داشته می‌شوند (به‌صورت هش‌شده)، ۳ دقیقه اعتبار دارند و یک‌بار مصرف‌اند.

const crypto = require('crypto');

const TTL_MS = 3 * 60 * 1000;
const codes = new Map(); // sha256(code) -> { userId, expiresAt }

function hash(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

function cleanup(now) {
  for (const [k, v] of codes) if (v.expiresAt <= now) codes.delete(k);
}

function issueCode(userId) {
  const now = Date.now();
  cleanup(now);
  // هر کاربر فقط یک کد فعال دارد؛ کد قبلی او باطل می‌شود
  for (const [k, v] of codes) if (v.userId === userId) codes.delete(k);

  const code = String(crypto.randomInt(0, 100000000)).padStart(8, '0');
  codes.set(hash(code), { userId, expiresAt: now + TTL_MS });
  return { code, expiresInSeconds: TTL_MS / 1000 };
}

/** @returns {number|null} userId در صورت معتبر بودن (و مصرف‌شدن کد)، وگرنه null */
function consumeCode(code) {
  if (!/^\d{8}$/.test(String(code || '').trim())) return null;
  const key = hash(String(code).trim());
  const entry = codes.get(key);
  if (!entry) return null;
  codes.delete(key);
  if (entry.expiresAt <= Date.now()) return null;
  return entry.userId;
}

module.exports = { issueCode, consumeCode };

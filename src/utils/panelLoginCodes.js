// ورود یک‌بارمصرف به پنل از داخل بات (بدون Telegram Login Widget که روی شبکه‌های فیلتر بالا نمی‌آید):
//   - کد ۸ رقمی (برای تایپ دستی در صفحه‌ی ورود)       → issueCode / consumeCode
//   - توکن بلند داخل لینک «باز کردن در مرورگر»          → issueLinkToken / consumeLinkToken
// همه فقط در حافظه و به‌صورت هش‌شده نگه‌داری می‌شوند و یک‌بار مصرف‌اند.

const crypto = require('crypto');

const CODE_TTL_MS = 3 * 60 * 1000;
const LINK_TTL_MS = 5 * 60 * 1000;
const codes = new Map(); // sha256(code)  -> { userId, expiresAt }
const links = new Map(); // sha256(token) -> { userId, expiresAt }

const hash = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');

function cleanup(map, now) {
  for (const [k, v] of map) if (v.expiresAt <= now) map.delete(k);
}

function consume(map, raw) {
  const entry = map.get(hash(raw));
  if (!entry) return null;
  map.delete(hash(raw));
  return entry.expiresAt > Date.now() ? entry.userId : null;
}

function issueCode(userId) {
  const now = Date.now();
  cleanup(codes, now);
  for (const [k, v] of codes) if (v.userId === userId) codes.delete(k); // هر کاربر یک کد فعال
  const code = String(crypto.randomInt(0, 100000000)).padStart(8, '0');
  codes.set(hash(code), { userId, expiresAt: now + CODE_TTL_MS });
  return { code, expiresInSeconds: CODE_TTL_MS / 1000 };
}

/** @returns {number|null} */
function consumeCode(code) {
  const c = String(code || '').trim();
  return /^\d{8}$/.test(c) ? consume(codes, c) : null;
}

function issueLinkToken(userId) {
  const now = Date.now();
  cleanup(links, now);
  const token = crypto.randomBytes(24).toString('base64url');
  links.set(hash(token), { userId, expiresAt: now + LINK_TTL_MS });
  return { token, expiresInSeconds: LINK_TTL_MS / 1000 };
}

/** @returns {number|null} */
function consumeLinkToken(token) {
  const t = String(token || '').trim();
  return /^[A-Za-z0-9_-]{20,64}$/.test(t) ? consume(links, t) : null;
}

module.exports = { issueCode, consumeCode, issueLinkToken, consumeLinkToken };

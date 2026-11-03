// عکس پروفایل کاربران.
//   • مرورگر/Mini App عکس را قبل از ارسال به ۲۵۶×۲۵۶ JPEG کوچک می‌کند؛ سرور با این حال مستقل اعتبارسنجی می‌کند:
//     حجم حداکثر MAX_BYTES (هنگام دریافت شمرده می‌شود)، و «محتوا» با امضای فایل (JPEG/PNG/WebP) سنجیده می‌شود، نه mime ادعاشده.
//   • فایل با نام تصادفی ۳۲ hex در ATTACHMENTS_DIR/avatars؛ مسیر فقط از ستون DB و با pathOf ساخته می‌شود (path traversal ممکن نیست).
//   • خروجی همیشه { ok, ... } یا { ok:false, code, error }.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');
const config = require('../config');
const { getDb } = require('../db/connection');

const MAX_BYTES = 300 * 1024;
const ID_RE = /^[0-9a-f]{32}$/;
const SIGNATURES = [
  { mime: 'image/jpeg', ext: 'jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', ext: 'png', test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { mime: 'image/webp', ext: 'webp', test: (b) => b.slice(0, 4).toString('latin1') === 'RIFF' && b.slice(8, 12).toString('latin1') === 'WEBP' },
];
const ALLOWED = SIGNATURES.map((s) => s.mime);
const fail = (code, error) => ({ ok: false, code, error });
const dir = () => path.join(config.attachmentsDir, 'avatars');

function pathOf(id) {
  return typeof id === 'string' && ID_RE.test(id) ? path.join(dir(), id) : null;
}

function get(userId) {
  return getDb().prepare('SELECT user_id, file_id, mime, size, updated_at FROM user_avatars WHERE user_id = ?').get(Number(userId)) || null;
}

async function removeFile(id) {
  const p = pathOf(id);
  if (p) await fs.promises.rm(p, { force: true }).catch(() => {});
}

async function remove(userId) {
  const row = get(userId);
  if (!row) return { ok: true, removed: false };
  getDb().prepare('DELETE FROM user_avatars WHERE user_id = ?').run(Number(userId));
  await removeFile(row.file_id);
  return { ok: true, removed: true };
}

async function save(userId, stream, { mime, size } = {}) {
  const m = typeof mime === 'string' ? mime.toLowerCase() : '';
  if (!ALLOWED.includes(m)) { if (stream && stream.destroy) stream.destroy(); return fail('TYPE_NOT_ALLOWED', 'فقط تصویر JPEG، PNG یا WebP پذیرفته می‌شود.'); }
  if (Number.isFinite(size) && size > MAX_BYTES) { if (stream && stream.destroy) stream.destroy(); return fail('TOO_LARGE', `حجم عکس باید کمتر از ${Math.floor(MAX_BYTES / 1024)} کیلوبایت باشد.`); }
  const id = crypto.randomBytes(16).toString('hex');
  const finalPath = path.join(dir(), id);
  const tmpPath = `${finalPath}.part`;
  let total = 0; let head = Buffer.alloc(0); let tooLarge = false;
  try {
    await fs.promises.mkdir(dir(), { recursive: true });
    const counter = new Transform({
      transform(chunk, _e, cb) {
        total += chunk.length;
        if (total > MAX_BYTES) { tooLarge = true; return cb(new Error('too_large')); }
        if (head.length < 16) head = Buffer.concat([head, chunk]).slice(0, 16);
        return cb(null, chunk);
      },
    });
    await pipeline(stream, counter, fs.createWriteStream(tmpPath, { flags: 'wx', mode: 0o600 }));
  } catch (_) {
    await fs.promises.rm(tmpPath, { force: true }).catch(() => {});
    return tooLarge ? fail('TOO_LARGE', `حجم عکس باید کمتر از ${Math.floor(MAX_BYTES / 1024)} کیلوبایت باشد.`) : fail('UPLOAD_FAILED', 'دریافت عکس ناموفق بود. دوباره تلاش کنید.');
  }
  const detected = total > 0 ? SIGNATURES.find((s) => s.test(head)) : null;
  if (!detected) { await fs.promises.rm(tmpPath, { force: true }).catch(() => {}); return fail('INVALID_CONTENT', 'محتوای فایل یک تصویر معتبر نیست.'); }
  await fs.promises.rename(tmpPath, finalPath);
  const old = get(userId);
  getDb().prepare(`INSERT INTO user_avatars (user_id, file_id, mime, size, updated_at) VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET file_id = excluded.file_id, mime = excluded.mime, size = excluded.size, updated_at = excluded.updated_at`).run(Number(userId), id, detected.mime, total);
  if (old) await removeFile(old.file_id);
  return { ok: true, avatar: get(userId) };
}

/** برای Mini App (CSP: img-src فقط 'self' data:) ⇒ data URL. */
function dataUrl(userId) {
  const row = get(userId);
  const p = row && pathOf(row.file_id);
  if (!p) return null;
  try { return `data:${row.mime};base64,${fs.readFileSync(p).toString('base64')}`; } catch (_) { return null; }
}

/** ارسال امن بایت‌های عکس (پنل: <img src> با کوکی نشست). مجوز را فراخواننده بررسی کرده. */
function send(res, userId) {
  const row = get(userId);
  const p = row && pathOf(row.file_id);
  if (!p) return res.status(404).json({ error: 'عکسی ثبت نشده است.' });
  let stat;
  try { stat = fs.statSync(p); } catch (_) { return res.status(404).json({ error: 'عکسی ثبت نشده است.' }); }
  res.status(200);
  res.set({
    'Content-Type': row.mime,
    'Content-Length': String(stat.size),
    ETag: `"${row.file_id}"`,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cache-Control': 'private, max-age=0, must-revalidate',
  });
  if (res.req && res.req.headers['if-none-match'] === `"${row.file_id}"`) return res.status(304).end();
  const stream = fs.createReadStream(p);
  stream.on('error', () => { if (!res.headersSent) res.status(500).end(); else res.destroy(); });
  return stream.pipe(res);
}

module.exports = { MAX_BYTES, ALLOWED, pathOf, get, save, remove, dataUrl, send };

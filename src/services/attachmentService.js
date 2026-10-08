// ذخیره‌ی پیوست مرخصی (S4-12a). فایل با نام «تصادفی» در config.attachmentsDir نگه‌داری می‌شود (نام اصلی هرگز روی دیسک نمی‌آید).
//   • نوع مجاز: تنظیم leaveAttachmentTypes (پیش‌فرض jpeg/png/pdf) و حجم حداکثر leaveAttachmentMaxKb؛ اما «اعتماد» به mime ادعاشده نیست:
//     محتوا با امضای فایل (JPEG/PNG/PDF) سنجیده می‌شود و نوعِ تشخیص‌داده‌شده ذخیره می‌شود.
//   • حجم هنگام دانلود شمرده می‌شود (ادعای file_size تلگرام کافی نیست)؛ عبور از سقف ⇒ قطع و پاک شدن فایل نیمه‌کاره.
//   • خروجی همیشه { ok, ... } یا { ok:false, code, error }؛ هرگز استثنا به فراخواننده نمی‌دهد.
// serve با S4-12b (pathOf/ID_RE).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');
const config = require('../config');
const settingsRepository = require('../repositories/settingsRepository');
const { sanitizeText } = require('../utils/sanitize');

const ID_RE = /^[0-9a-f]{32}$/;
const SIGNATURES = [
  { mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { mime: 'application/pdf', test: (b) => b.slice(0, 5).toString('latin1') === '%PDF-' },
];

const fail = (code, error) => ({ ok: false, code, error });
const allowedTypes = () => settingsRepository.getAll().leaveAttachmentTypes.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const maxBytes = () => settingsRepository.getAll().leaveAttachmentMaxKb * 1024;
const dir = () => config.attachmentsDir;

// نام فایل روی دیسک؛ فقط شناسه‌ی معتبر (۳۲ hex) ⇒ مسیر داخل پوشه، وگرنه null (جلوی path traversal)
function pathOf(id) {
  if (typeof id !== 'string' || !ID_RE.test(id)) return null;
  return path.join(dir(), id);
}

// بررسی اولیه‌ی ادعای کلاینت (قبل از دانلود). size ممکن است undefined باشد.
function precheck({ mime, size }) {
  const m = typeof mime === 'string' ? mime.toLowerCase() : '';
  if (!allowedTypes().includes(m)) return fail('TYPE_NOT_ALLOWED', 'نوع فایل مجاز نیست. فقط ' + allowedTypes().join('، ') + ' پذیرفته می‌شود.');
  if (Number.isFinite(size) && size > maxBytes()) return fail('TOO_LARGE', `حجم فایل بیشتر از ${Math.floor(maxBytes() / 1024)} کیلوبایت است.`);
  return { ok: true };
}

// stream خوانا ⇒ فایل. originalName فقط برای نمایش (پاک‌سازی می‌شود).
async function saveStream(stream, { mime, size, originalName } = {}) {
  const pre = precheck({ mime, size });
  if (!pre.ok) { if (stream && typeof stream.destroy === 'function') stream.destroy(); return pre; }
  const id = crypto.randomBytes(16).toString('hex');
  const finalPath = path.join(dir(), id);
  const tmpPath = `${finalPath}.part`;
  const limit = maxBytes();
  let total = 0;
  let head = Buffer.alloc(0);
  let tooLarge = false;
  try {
    await fs.promises.mkdir(dir(), { recursive: true });
    const counter = new Transform({
      transform(chunk, _enc, cb) {
        total += chunk.length;
        if (total > limit) { tooLarge = true; return cb(new Error('too_large')); }
        if (head.length < 16) head = Buffer.concat([head, chunk]).slice(0, 16);
        return cb(null, chunk);
      },
    });
    await pipeline(stream, counter, fs.createWriteStream(tmpPath, { flags: 'wx', mode: 0o600 }));
  } catch (err) {
    await fs.promises.rm(tmpPath, { force: true }).catch(() => {});
    return tooLarge ? fail('TOO_LARGE', `حجم فایل بیشتر از ${Math.floor(limit / 1024)} کیلوبایت است.`) : fail('DOWNLOAD_FAILED', 'دریافت فایل ناموفق بود. دوباره تلاش کنید.');
  }
  const detected = total > 0 ? SIGNATURES.find((s) => s.test(head)) : null;
  if (!detected || !allowedTypes().includes(detected.mime)) {
    await fs.promises.rm(tmpPath, { force: true }).catch(() => {});
    return fail('INVALID_CONTENT', 'محتوای فایل با نوع مجاز (تصویر JPEG/PNG یا PDF) سازگار نیست.');
  }
  await fs.promises.rename(tmpPath, finalPath);
  // نام نمایشی: جداکننده‌ی مسیر، علامت‌های HTML/نقل‌قول و کاراکترهای کنترلی حذف و نقطه‌ی ابتدایی برداشته می‌شود (فقط برای نمایش؛ روی دیسک استفاده نمی‌شود)
  const name = sanitizeText(String(originalName || '').replace(/[\\/<>"'`\u0000-\u001f]/g, '_').replace(/^\.+/, ''), 100) || null;
  return { ok: true, attachment: { id, mime: detected.mime, size: total, name } };
}

// حذف فایل (مثلاً ثبت درخواست ناموفق بعد از دریافت)؛ شناسه‌ی نامعتبر یا فایل ناموجود ⇒ بی‌اثر
async function remove(id) {
  const p = pathOf(id);
  if (p) await fs.promises.rm(p, { force: true }).catch(() => {});
}

module.exports = { ID_RE, pathOf, precheck, saveStream, remove };

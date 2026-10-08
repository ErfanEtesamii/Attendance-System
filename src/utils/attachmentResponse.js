// پاسخ‌دادن فایل پیوست مرخصی (S4-12b). مجوز را فراخواننده قبلاً بررسی کرده؛ این‌جا فقط «ارسال امن»:
//   • مسیر فقط از ستون attachment_id ردیف DB و با attachmentService.pathOf (فقط ۳۲ hex) ساخته می‌شود ⇒ path traversal ممکن نیست.
//   • Content-Type از mime «تشخیص‌داده‌شده» ذخیره‌شده (نه ورودی کاربر)، فقط از فهرست سفید؛ nosniff؛ CSP بسته + sandbox؛ بدون کش مشترک.
//   • نام فایل در Content-Disposition فقط از نوعِ فایل ساخته می‌شود (نه نام اصلی کاربر) ⇒ تزریق هدر ممکن نیست.
const fs = require('fs');
const attachmentService = require('../services/attachmentService');

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'application/pdf': 'pdf' };

function sendAttachment(res, request) {
  const p = attachmentService.pathOf(request.attachment_id);
  const ext = EXT[request.attachment_mime];
  if (!p || !ext) return res.status(404).json({ error: 'پیوستی برای این درخواست ثبت نشده است.' });
  let stat;
  try { stat = fs.statSync(p); } catch (_) { return res.status(404).json({ error: 'فایل پیوست پیدا نشد.' }); }
  if (!stat.isFile()) return res.status(404).json({ error: 'فایل پیوست پیدا نشد.' });
  res.status(200);
  res.set({
    'Content-Type': request.attachment_mime,
    'Content-Length': String(stat.size),
    'Content-Disposition': `inline; filename="leave-${request.id}.${ext}"`,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cache-Control': 'private, no-store',
  });
  const stream = fs.createReadStream(p);
  stream.on('error', () => { if (!res.headersSent) res.status(500).end(); else res.destroy(); });
  return stream.pipe(res);
}

module.exports = { sendAttachment };

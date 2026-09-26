// پارسر بسیار ساده‌ی هدر Cookie، فقط برای خواندن. برای جلوگیری از اضافه‌کردن یک وابستگی جدید
// (مثل cookie-parser) صرفاً برای همین یک مصرف، این تابع کوچک را خودمان نوشتیم.

function parseCookies(req) {
  const header = req.headers.cookie;
  const result = {};
  if (!header) return result;
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) result[key] = decodeURIComponent(value);
  });
  return result;
}

module.exports = { parseCookies };

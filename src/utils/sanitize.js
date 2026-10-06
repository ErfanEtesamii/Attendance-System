// پاک‌سازی متن خطا قبل از ذخیره/ارسال: توکن بات تلگرام (که گاهی داخل URL خطای شبکه می‌آید) حذف می‌شود.
// مانیتورینگ نباید خودش مسیر نشت راز شود (job_runs و پیام‌های هشدار).

const TOKEN_RE = /\d{6,}:[A-Za-z0-9_-]{30,}/g;

function sanitizeText(value, max = 500) {
  if (value == null) return '';
  const text = String(value).replace(TOKEN_RE, '[REDACTED]');
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

module.exports = { sanitizeText };

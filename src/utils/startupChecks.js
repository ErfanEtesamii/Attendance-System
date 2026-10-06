// بررسی رازها و پیکربندی حساس هنگام بالا آمدن (بخش ۲-ب۱).
// ماژول خالص است: config را به‌عنوان ورودی می‌گیرد تا بدون دست‌زدن به env قابل تست باشد.
//   errors   → در production سرور نباید بالا بیاید (throw)
//   warnings → فقط هشدار واضح در لاگ
// مقدار راز هرگز در پیام‌ها نمی‌آید (فقط طول/وضعیت).

const MIN_SECRET_LENGTH = 32;
const MIN_UNIQUE_CHARS = 8;

// مقدارهای نمونه/پیش‌فرض شناخته‌شده و الگوهای «placeholder»
const SAMPLE_SECRET_RE = /change[-_ ]?me|changeme|your[-_ ]|example|placeholder|sample|dummy|insecure|dev-only|replace[-_ ]?me|secret[-_ ]?here|xxxx|<[^>]+>|^test/i;

function assessSessionSecret(secret) {
  const s = String(secret || '');
  if (!s) return { ok: false, reason: 'خالی است' };
  if (s.length < MIN_SECRET_LENGTH) return { ok: false, reason: `کوتاه‌تر از ${MIN_SECRET_LENGTH} نویسه است (${s.length})` };
  if (SAMPLE_SECRET_RE.test(s)) return { ok: false, reason: 'شبیه مقدار نمونه/پیش‌فرض است' };
  if (new Set(s).size < MIN_UNIQUE_CHARS) return { ok: false, reason: 'تنوع نویسه‌ها خیلی کم است (تصادفی به‌نظر نمی‌رسد)' };
  return { ok: true };
}

function checkConfig(cfg) {
  const errors = [];
  const warnings = [];
  const isProd = cfg.nodeEnv === 'production';
  const secretResult = assessSessionSecret(cfg.adminSessionSecret);

  if (!secretResult.ok) {
    const msg = `ADMIN_SESSION_SECRET نامعتبر است: ${secretResult.reason}. یک مقدار تصادفی بسازید: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`;
    if (isProd) errors.push(msg);
    else warnings.push(`${msg} (در production سرور با این وضعیت بالا نمی‌آید.)`);
  }

  if (!cfg.telegramBotUsername) {
    warnings.push(
      'TELEGRAM_BOT_USERNAME خالی است؛ دکمه‌ی «ورود با تلگرام» (Login Widget) در صفحه‌ی ورود پنل کار نخواهد کرد. یوزرنیم بات را بدون @ در .env بگذارید.'
    );
  }

  if (isProd && !cfg.telegramBotToken) {
    warnings.push('TELEGRAM_BOT_TOKEN تنظیم نشده؛ بات اجرا نمی‌شود و احراز Mini App/ورود پنل هم کار نمی‌کند.');
  }

  return { errors, warnings };
}

// در server.js صدا زده می‌شود: خطاها throw، هشدارها در لاگ
function runStartupChecks(cfg, log = console) {
  const { errors, warnings } = checkConfig(cfg);
  // در تست‌ها (NODE_ENV=test) هشدارها چاپ نمی‌شوند تا خروجی تست شلوغ نشود؛ مقدار برگشتی همچنان کامل است
  if (cfg.nodeEnv !== 'test') warnings.forEach((w) => log.warn(`⚠️ [config] ${w}`));
  if (errors.length) {
    throw new Error(`پیکربندی ناامن؛ سرور بالا نمی‌آید:\n - ${errors.join('\n - ')}`);
  }
  return { errors, warnings };
}

module.exports = { assessSessionSecret, checkConfig, runStartupChecks, MIN_SECRET_LENGTH };

const path = require('path');
const express = require('express');
const config = require('./config');
const { getDb } = require('./db/connection');
const apiRoutes = require('./api/routes');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

function createApp() {
  // اطمینان از ساخته‌شدن دیتابیس و جداول قبل از بالا آمدن سرور
  getDb();

  // فاز ۸: بدون یک کلید امضای واقعی، هر کسی می‌تواند یک کوکی session جعلی بسازد و به پنل
  // مدیریتی وارد شود. در production این حالت را کاملاً مسدود می‌کنیم تا این اشتباه پیکربندی
  // خاموش/نامرئی نماند (مشابه فلسفه‌ی هشدار TRUST_PROXY بالا).
  if (config.nodeEnv === 'production' && !config.adminSessionSecret) {
    throw new Error(
      'ADMIN_SESSION_SECRET در .env تنظیم نشده است. برای production یک مقدار تصادفی و طولانی بگذارید (مثلاً: openssl rand -hex 32).'
    );
  }

  const app = express();

  // فقط وقتی TRUST_PROXY=true باشد به X-Forwarded-For اعتماد می‌شود.
  // این تنظیم مستقیماً روی صحت middleware محدودیت شبکه (فاز ۲) اثر دارد؛ توضیح در README.
  if (config.trustProxy) {
    app.set('trust proxy', 'loopback'); // فقط پراکسی روی همان سرور (127.0.0.1) قابل‌اعتماد است
  }

  app.use(express.json());

  // فاز ۴: فایل‌های استاتیک Telegram Mini App (public/index.html و ...).
  // این پوشه از ریشه‌ی همین دامنه/ساب‌دامنه سرو می‌شود، مثلاً https://attendance.farazhonar.com/
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // فاز ۸: پنل مدیریتی وب، زیر مسیر /admin/ از همان سرور سرو می‌شود
  // (مثلاً https://attendance.farazhonar.com/admin/)
  app.use('/admin', express.static(path.join(__dirname, '..', 'public-admin')));

  // مسیرهای API زیر /api قرار می‌گیرند تا از Mini App و بات صدا زده شوند
  app.use('/api', apiRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

function start() {
  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`سرور بک‌اند حضور و غیاب روی پورت ${config.port} در حال اجراست (env: ${config.nodeEnv})`);
  });

  // خاموشی مرتب (graceful shutdown) - مهم برای اجرا زیر NSSM در فاز ۹
  const shutdown = () => {
    console.log('در حال خاموش کردن سرور...');
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) {
  start();
}

module.exports = { createApp, start };

const path = require('path');
const express = require('express');
const config = require('./config');
const { getDb } = require('./db/connection');
const apiRoutes = require('./api/routes');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

function createApp() {
  // اطمینان از ساخته‌شدن دیتابیس و جداول قبل از بالا آمدن سرور
  getDb();

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

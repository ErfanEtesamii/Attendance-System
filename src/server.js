const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const express = require('express');
const config = require('./config');
const { getDb } = require('./db/connection');
const apiRoutes = require('./api/routes');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const { securityHeaders } = require('./middleware/securityHeaders');
const { runStartupChecks } = require('./utils/startupChecks');

function createApp() {
  // بخش ۲-ب۱: بررسی رازها هنگام بالا آمدن. در production اگر ADMIN_SESSION_SECRET خالی، کوتاه‌تر از ۳۲ نویسه،
  // نمونه/پیش‌فرض یا غیرتصادفی باشد سرور بالا نمی‌آید (وگرنه هر کسی می‌تواند کوکی نشست جعلی بسازد)؛
  // خالی‌بودن TELEGRAM_BOT_USERNAME فقط هشدار می‌دهد. منطق در src/utils/startupChecks.js (قابل تست).
  // عمداً قبل از getDb(): پیکربندی ناامن نباید حتی migration یا بک‌آپ روی دیتابیس را اجرا کند.
  runStartupChecks(config);

  // اطمینان از ساخته‌شدن دیتابیس و جداول قبل از بالا آمدن سرور
  getDb();

  const app = express();

  // فقط وقتی TRUST_PROXY=true باشد به X-Forwarded-For اعتماد می‌شود.
  // این تنظیم مستقیماً روی صحت middleware محدودیت شبکه (فاز ۲) اثر دارد؛ توضیح در README.
  if (config.trustProxy) {
    app.set('trust proxy', 'loopback'); // فقط پراکسی روی همان سرور (127.0.0.1) قابل‌اعتماد است
  }

  // بخش ۲-الف: هدرهای امنیتی روی همه‌ی پاسخ‌ها (استاتیک و API)؛ x-powered-by حذف می‌شود
  app.disable('x-powered-by');
  app.use(securityHeaders);

  app.use(express.json());
  app.use((req, res, next) => {
  console.log(new Date().toISOString(), req.ip, req.method, req.originalUrl);
  next();
  });
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

  // اگر مسیر گواهی SSL تنظیم شده باشد، مستقیماً HTTPS بالا می‌آید (بدون IIS/nginx جلوی آن)؛
  // این همان تصمیم معماری نهایی پروژه است (سرور محلی، بدون ریورس‌پراکسی).
  // اگر خالی باشد (مثلاً توسعه‌ی محلی روی سیستم شخصی)، به HTTP ساده برمی‌گردیم.
  let server;
  if (config.sslCertPath && config.sslKeyPath) {
    if (!fs.existsSync(config.sslCertPath) || !fs.existsSync(config.sslKeyPath)) {
      throw new Error(
        `فایل گواهی SSL پیدا نشد. مسیرهای تنظیم‌شده را بررسی کنید:\n  SSL_CERT_PATH=${config.sslCertPath}\n  SSL_KEY_PATH=${config.sslKeyPath}`
      );
    }
    const credentials = {
      cert: fs.readFileSync(config.sslCertPath, 'utf8'),
      key: fs.readFileSync(config.sslKeyPath, 'utf8'),
    };
    server = https.createServer(credentials, app).listen(config.port, () => {
      console.log(`سرور بک‌اند حضور و غیاب با HTTPS روی پورت ${config.port} در حال اجراست (env: ${config.nodeEnv})`);
    });
  } else {
    if (config.nodeEnv === 'production') {
      console.warn(
        '⚠️ SSL_CERT_PATH/SSL_KEY_PATH تنظیم نشده‌اند - سرور با HTTP ساده بالا می‌آید. ' +
          'Telegram Mini App و Login Widget بدون HTTPS معتبر کار نخواهند کرد.'
      );
    }
    server = http.createServer(app).listen(config.port, () => {
      console.log(`سرور بک‌اند حضور و غیاب روی پورت ${config.port} در حال اجراست (env: ${config.nodeEnv})`);
    });
  }

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

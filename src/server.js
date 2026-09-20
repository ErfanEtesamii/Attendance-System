const express = require('express');
const config = require('./config');
const { getDb } = require('./db/connection');
const apiRoutes = require('./api/routes');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

function createApp() {
  // اطمینان از ساخته‌شدن دیتابیس و جداول قبل از بالا آمدن سرور
  getDb();

  const app = express();
  app.use(express.json());

  // مسیرهای API زیر /api قرار می‌گیرند تا در فاز ۴ به‌سادگی از Mini App صدا زده شوند
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

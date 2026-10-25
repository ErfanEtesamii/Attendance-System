// نقطه ورود اصلی فرآیند (از فاز ۳ به بعد): هم API بک‌اند (فاز ۱/۲) و هم بات تلگرام (فاز ۳)
// را در یک پروسه واحد بالا می‌آورد تا با NSSM به‌عنوان یک Windows Service ساده اجرا شود.
// اگر فقط API لازم است (بدون بات)، می‌توانید مستقیماً src/server.js را اجرا کنید.

const { start: startApiServer } = require('./server');
const { startBot, stopBot } = require('./bot');
const config = require('./config');
const logger = require('./utils/logger');
const { shutdown: shutdownLifecycle } = require('./utils/lifecycle');

function main() {
  const server = startApiServer({ manageSignals: false });
  let bot = null;

  if (!config.baleBotToken) {
    logger.warn('[main] BALE_BOT_TOKEN تنظیم نشده؛ بازوی بله راه‌اندازی نشد (فقط API در حال اجراست).');
  } else {
    bot = startBot();
  }
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    logger.info('application_shutdown_started');
    await shutdownLifecycle({ server, stopBot: () => stopBot(bot) });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  return { server, bot };
}

main();

// نقطه ورود اصلی فرآیند (از فاز ۳ به بعد): هم API بک‌اند (فاز ۱/۲) و هم بات تلگرام (فاز ۳)
// را در یک پروسه واحد بالا می‌آورد تا با NSSM به‌عنوان یک Windows Service ساده اجرا شود.
// اگر فقط API لازم است (بدون بات)، می‌توانید مستقیماً src/server.js را اجرا کنید.

const { start: startApiServer } = require('./server');
const { startBot } = require('./bot');
const config = require('./config');

function main() {
  startApiServer();

  if (!config.telegramBotToken) {
    console.warn(
      '[main] TELEGRAM_BOT_TOKEN تنظیم نشده؛ بات تلگرام راه‌اندازی نشد (فقط API در حال اجراست).'
    );
    return;
  }

  startBot();
}

main();

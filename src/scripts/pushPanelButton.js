// ارسال یک‌باره‌ی کیبورد «🖥 پنل / 🕒 ثبت تردد» به همه‌ی کاربران فعال که آیدی تلگرام دارند.
// (کیبورد فقط وقتی زیر چت ظاهر می‌شود که بات یک پیام همراه آن بفرستد؛ این اسکریپت برای راه‌اندازی اولیه است.
//  کاربر جدید آن را از /start می‌گیرد.)
//
// استفاده:
//   node src/scripts/pushPanelButton.js            # فقط فهرست گیرنده‌ها (چیزی ارسال نمی‌شود)
//   node src/scripts/pushPanelButton.js --apply    # ارسال واقعی

const TelegramBot = require('node-telegram-bot-api');
const config = require('../config');
const usersRepository = require('../repositories/usersRepository');
const { persistentKeyboard } = require('../bot/panelLinks');

const apply = process.argv.includes('--apply');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const keyboard = persistentKeyboard();
  if (!keyboard) {
    console.error('❌ MINI_APP_URL در .env تنظیم نشده یا https نیست؛ دکمه‌ی Web App ساخته نمی‌شود.');
    process.exit(1);
  }
  const users = usersRepository.listUsers({ onlyActive: true }).filter((u) => u.telegram_user_id);
  const skipped = usersRepository.listUsers({ onlyActive: true }).length - users.length;

  console.log(`گیرنده‌ها (${users.length} نفر):`);
  users.forEach((u) => console.log(`  - ${u.full_name} (${u.role})`));
  if (skipped) console.log(`(${skipped} کاربر فعال بدون آیدی تلگرام نادیده گرفته شدند)`);

  if (!apply) {
    console.log('\n(پیش‌نمایش) چیزی ارسال نشد. برای ارسال: node src/scripts/pushPanelButton.js --apply');
    return;
  }
  if (!config.telegramBotToken) {
    console.error('❌ TELEGRAM_BOT_TOKEN تنظیم نشده است.');
    process.exit(1);
  }

  const bot = new TelegramBot(config.telegramBotToken, { polling: false });
  let sent = 0;
  let failed = 0;
  for (const u of users) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await bot.sendMessage(
        u.telegram_user_id,
        '🖥 دکمه‌ی «پنل» به ربات اضافه شد.\nاز پایین صفحه‌ی چت می‌توانید وارد پنل خودتان شوید (و با «🕒 ثبت تردد» ورود/خروج بزنید).',
        { reply_markup: keyboard }
      );
      sent += 1;
    } catch (err) {
      failed += 1;
      console.error(`  ✗ ${u.full_name}: ${err.message}`);
    }
    // eslint-disable-next-line no-await-in-loop
    await sleep(80); // زیر سقف نرخ ارسال تلگرام
  }
  console.log(`\n✅ ${sent} ارسال شد، ${failed} ناموفق.`);
}

main().catch((err) => { console.error(err); process.exit(1); });

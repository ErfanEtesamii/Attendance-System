// ارسال یک‌باره‌ی کیبورد «📂 منو» (جایگزین کیبورد قدیمی ۱۵ دکمه‌ای) به همه‌ی کاربران فعال که آیدی تلگرام دارند.
// (کیبورد فقط وقتی زیر چت ظاهر می‌شود که بات یک پیام همراه آن بفرستد؛ این اسکریپت برای راه‌اندازی اولیه است.
//  کاربر جدید آن را از /start می‌گیرد.)
//
// استفاده:
//   node src/scripts/pushPanelButton.js            # فقط فهرست گیرنده‌ها (چیزی ارسال نمی‌شود)
//   node src/scripts/pushPanelButton.js --apply    # ارسال واقعی

const BaleBot = require('../bot/baleBot');
const config = require('../config');
const usersRepository = require('../repositories/usersRepository');
const { persistentKeyboard } = require('../bot/panelLinks');

const apply = process.argv.includes('--apply');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const users = usersRepository.listUsers({ onlyActive: true }).filter((u) => u.telegram_user_id);
  const skipped = usersRepository.listUsers({ onlyActive: true }).length - users.length;

  console.log(`گیرنده‌ها (${users.length} نفر):`);
  users.forEach((u) => console.log(`  - ${u.full_name} (${u.role})`));
  if (skipped) console.log(`(${skipped} کاربر فعال بدون آیدی تلگرام نادیده گرفته شدند)`);

  if (!apply) {
    console.log('\n(پیش‌نمایش) چیزی ارسال نشد. برای ارسال: node src/scripts/pushPanelButton.js --apply');
    return;
  }
  if (!config.baleBotToken) {
    console.error('❌ BALE_BOT_TOKEN تنظیم نشده است.');
    process.exit(1);
  }

  const bot = new BaleBot(config.baleBotToken, { polling: false });
  let sent = 0;
  let failed = 0;
  for (const u of users) {
    try {
      const keyboard = persistentKeyboard(u, { chatType: 'private' }); // کیبورد هر کاربر (نقش‌محور؛ فقط «📂 منو»)
      if (!keyboard) continue;
      // eslint-disable-next-line no-await-in-loop
      await bot.sendMessage(
        u.telegram_user_id,
        'منوی ربات ساده‌تر شد 👇\nهمه‌ی گزینه‌ها (ثبت تردد، پنل، برنامه هفتگی و ...) حالا پشت دکمه‌ی «📂 منو» پایین صفحه هستند.',
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

// وقتی فقط src/server.js (API) اجرا می‌شود (نه کل src/index.js)، به یک bot instance polling-دار
// دسترسی نداریم. اما ارسال پیام (sendMessage) نیازی به polling ندارد؛ همین‌جا یک bot instance
// سبک و جدا فقط برای ارسال می‌سازیم. استفاده در: تأیید/رد مرخصی و اصلاح دستی رکورد از پنل وب.

const config = require('../config');

let botInstance;
let BaleBot;

function getNotifierBot() {
  if (!config.baleBotToken) return null;
  if (!botInstance) {
    BaleBot = BaleBot || require('./baleBot');
    botInstance = new BaleBot(config.baleBotToken, { polling: false });
  }
  return botInstance;
}

async function notifyUser(telegramUserId, text) {
  const bot = getNotifierBot();
  if (!bot || !telegramUserId) return;
  try {
    await bot.sendMessage(telegramUserId, text);
  } catch (err) {
    console.error('[notifier] خطا در ارسال پیام به کاربر:', err.message);
  }
}

// مثل notifyUser ولی نتیجه (موفق/ناموفق) را برمی‌گرداند - برای پیام مستقیم/گروهی پنل ادمین
// options (اختیاری): همان گزینه‌های Bot API، مثلاً reply_markup با دکمه‌ی inline
async function sendMessage(telegramUserId, text, options) {
  const bot = getNotifierBot();
  if (!bot || !telegramUserId) return false;
  try {
    await bot.sendMessage(telegramUserId, text, options);
    return true;
  } catch (err) {
    console.error('[notifier] خطا در ارسال پیام:', err.message);
    return false;
  }
}

module.exports = { notifyUser, sendMessage };

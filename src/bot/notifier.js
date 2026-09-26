// وقتی فقط src/server.js (API) اجرا می‌شود (نه کل src/index.js)، به یک bot instance polling-دار
// دسترسی نداریم. اما ارسال پیام (sendMessage) نیازی به polling ندارد؛ همین‌جا یک bot instance
// سبک و جدا فقط برای ارسال می‌سازیم. استفاده در: تأیید/رد مرخصی و اصلاح دستی رکورد از پنل وب.

const config = require('../config');

let botInstance;
let TelegramBot;

function getNotifierBot() {
  if (!config.telegramBotToken) return null;
  if (!botInstance) {
    TelegramBot = TelegramBot || require('node-telegram-bot-api');
    botInstance = new TelegramBot(config.telegramBotToken, { polling: false });
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

module.exports = { notifyUser };

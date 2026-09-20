const TelegramBot = require('node-telegram-bot-api');
const config = require('../config');
const session = require('./session');
const { startSchedulers } = require('./scheduler');

const { handleStart } = require('./commands/start');
const { handleHelp } = require('./commands/help');
const { handleStatus } = require('./commands/status');
const { handleReport } = require('./commands/report');
const { handleLeaveCommand, handleLeaveText, handleLeaveCallback } = require('./commands/leave');
const {
  handleAddEmployeeCommand,
  handleAddEmployeeText,
  handleAddEmployeeCallback,
} = require('./commands/addEmployee');
const { handleListEmployees } = require('./commands/listEmployees');
const { handleTeamReport } = require('./commands/teamReport');
const { handlePendingLeaves, handlePendingLeavesCallback } = require('./commands/pendingLeaves');
const {
  handleFixRecordCommand,
  handleFixRecordText,
  handleFixRecordCallback,
  handleFixStatusCallback,
} = require('./commands/fixRecord');

function createBot() {
  if (!config.telegramBotToken) {
    throw new Error(
      'TELEGRAM_BOT_TOKEN تنظیم نشده است. مقدار آن را در .env قرار دهید (از BotFather بگیرید).'
    );
  }

  const bot = new TelegramBot(config.telegramBotToken, { polling: true });

  bot.onText(/^\/start/, (msg) => handleStart(bot, msg));
  bot.onText(/^\/help/, (msg) => handleHelp(bot, msg));
  bot.onText(/^\/status/, (msg) => handleStatus(bot, msg));
  bot.onText(/^\/report/, (msg) => handleReport(bot, msg));
  bot.onText(/^\/leave/, (msg) => handleLeaveCommand(bot, msg));

  bot.onText(/^\/add_employee/, (msg) => handleAddEmployeeCommand(bot, msg));
  bot.onText(/^\/list_employees/, (msg) => handleListEmployees(bot, msg));
  bot.onText(/^\/team_report/, (msg) => handleTeamReport(bot, msg));
  bot.onText(/^\/pending_leaves/, (msg) => handlePendingLeaves(bot, msg));
  bot.onText(/^\/fix_record/, (msg) => handleFixRecordCommand(bot, msg));

  // پیام‌های متنی معمولی: فقط وقتی مکالمه چندمرحله‌ای فعالی وجود دارد پردازش می‌شوند.
  bot.on('message', (msg) => {
    if (!msg.text || msg.text.startsWith('/')) return;
    const chatId = msg.chat.id;
    const sess = session.get(chatId);
    if (!sess) return;

    if (sess.flow === 'leave') return handleLeaveText(bot, msg, sess);
    if (sess.flow === 'add_employee') return handleAddEmployeeText(bot, msg, sess);
    if (sess.flow === 'fix_record') return handleFixRecordText(bot, msg, sess);
  });

  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const sess = session.get(chatId);

    try {
      if (query.data.startsWith('leave_approve:') || query.data.startsWith('leave_reject:')) {
        return await handlePendingLeavesCallback(bot, query);
      }
      if (query.data.startsWith('leave_type:') || query.data.startsWith('leave_confirm:') || query.data === 'leave_cancel') {
        if (!sess || sess.flow !== 'leave') return bot.answerCallbackQuery(query.id);
        return await handleLeaveCallback(bot, query, sess);
      }
      if (query.data.startsWith('add_emp_role:')) {
        if (!sess || sess.flow !== 'add_employee') return bot.answerCallbackQuery(query.id);
        return await handleAddEmployeeCallback(bot, query, sess);
      }
      if (query.data.startsWith('fix_field:') || query.data === 'fix_cancel') {
        if (!sess || sess.flow !== 'fix_record') return bot.answerCallbackQuery(query.id);
        return await handleFixRecordCallback(bot, query, sess);
      }
      if (query.data.startsWith('fix_status:')) {
        if (!sess || sess.flow !== 'fix_record') return bot.answerCallbackQuery(query.id);
        return await handleFixStatusCallback(bot, query, sess);
      }
      await bot.answerCallbackQuery(query.id);
    } catch (err) {
      console.error('[bot] خطا در پردازش callback_query:', err);
      try {
        await bot.answerCallbackQuery(query.id, { text: 'خطایی رخ داد.', show_alert: true });
      } catch (_) {
        /* نادیده گرفتن خطای ثانویه */
      }
    }
  });

  bot.on('polling_error', (err) => console.error('[bot] polling error:', err.message));

  return bot;
}

async function configureBotUi(bot) {
  await bot.setMyCommands([
    { command: 'start', description: 'شروع' },
    { command: 'status', description: 'وضعیت لحظه‌ای من' },
    { command: 'report', description: 'گزارش شخصی' },
    { command: 'leave', description: 'ثبت درخواست مرخصی/مأموریت' },
    { command: 'help', description: 'راهنما' },
  ]);

  // دکمه منو برای باز کردن Mini App - فقط اگر آدرس واقعی در .env تنظیم شده باشد.
  // Mini App واقعی در فاز ۴ ساخته می‌شود؛ تا آن زمان این دکمه عمداً تنظیم نمی‌شود.
  if (config.miniAppUrl) {
    try {
      await bot.setChatMenuButton({
        menu_button: { type: 'web_app', text: 'حضور و غیاب', web_app: { url: config.miniAppUrl } },
      });
    } catch (err) {
      console.error('[bot] خطا در تنظیم دکمه منو:', err.message);
    }
  }
}

function startBot() {
  const bot = createBot();
  configureBotUi(bot).catch((err) => console.error('[bot] خطا در تنظیم اولیه بات:', err.message));
  startSchedulers(bot);
  console.log('[bot] بات تلگرام در حالت polling راه‌اندازی شد.');
  return bot;
}

module.exports = { startBot };

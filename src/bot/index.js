const TelegramBot = require('node-telegram-bot-api');
const config = require('../config');
const session = require('./session');
const { routeMenuText, handleMenuCallback } = require('./menu/menuRouter');
const { isPickerCallback, handlePickerCallback } = require('./ui/pickerRouter');
const ui = require('./ui/pickers');
const { startSchedulers, stopSchedulers } = require('./scheduler');
const panelLinks = require('./panelLinks');
const { instrumentBot } = require('../utils/botHealth');

const { handleStart } = require('./commands/start');
const { handlePanelLogin } = require('./commands/panelLogin');
const { handleHelp } = require('./commands/help');
const { handleStatus } = require('./commands/status');
const { handleReport } = require('./commands/report');
const { handleLeaveCommand, handleLeaveText, handleLeaveCallback, handleLeaveAttachment } = require('./commands/leave');
const {
  handleAddEmployeeCommand,
  handleAddEmployeeText,
  handleAddEmployeeCallback,
} = require('./commands/addEmployee');
const { handleListEmployees } = require('./commands/listEmployees');
const { handleTeamReport } = require('./commands/teamReport');
const { handleUrgentTaskCommand, handleUrgentTaskText, handleUrgentTaskCallback } = require('./commands/urgentTask');
const { handlePendingLeaves, handlePendingLeavesCallback } = require('./commands/pendingLeaves');
const { startMissionReject, startMissionEdit, handleMissionRejectText, handleMissionEditText } = require('./commands/missionApproval');
const { handleReportReviewCallback, handleReportCommentText } = require('./commands/reportReview');
const { handleCheckinPermissionCallback } = require('./commands/checkinPermission');
const { handleRemoteWorkCallback } = require('./commands/remoteWork');
const { handlePendingDisputes, handleDisputeCallback, handleDisputeReplyText } = require('./commands/pendingDisputes');
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
  // بخش ۲-ج۱: نبض واقعی polling برای /api/health و watchdog (متد getUpdates پیچیده می‌شود)
  instrumentBot(bot);

  bot.onText(/^\/start/, (msg) => handleStart(bot, msg));
  bot.onText(/^\/help/, (msg) => handleHelp(bot, msg));
  bot.onText(/^\/panel/, (msg) => handlePanelLogin(bot, msg));
  bot.onText(/^\/status/, (msg) => handleStatus(bot, msg));
  bot.onText(/^\/report/, (msg) => handleReport(bot, msg));
  bot.onText(/^\/leave/, (msg) => handleLeaveCommand(bot, msg));

  bot.onText(/^\/add_employee/, (msg) => handleAddEmployeeCommand(bot, msg));
  bot.onText(/^\/list_employees/, (msg) => handleListEmployees(bot, msg));
  bot.onText(/^\/team_report/, (msg) => handleTeamReport(bot, msg));
  bot.onText(/^\/pending_leaves/, (msg) => handlePendingLeaves(bot, msg));
  bot.onText(/^\/pending_disputes/, (msg) => handlePendingDisputes(bot, msg));
  bot.onText(/^\/fix_record/, (msg) => handleFixRecordCommand(bot, msg));
  bot.onText(/^\/urgent_task/, (msg) => handleUrgentTaskCommand(bot, msg));

  // پیام‌های متنی معمولی: فقط وقتی مکالمه چندمرحله‌ای فعالی وجود دارد پردازش می‌شوند.
  bot.on('message', async (msg) => {
    // پیوست مرخصی (S4-12a): عکس/سند فقط در مرحله‌ی مربوط جریان /leave پردازش می‌شود
    if (!msg.text && (msg.photo || msg.document)) {
      const attSess = session.get(msg.chat.id);
      if (attSess && attSess.flow === 'leave') handleLeaveAttachment(bot, msg, attSess).catch((err) => console.error('[bot] خطا در دریافت پیوست:', err.message));
      return;
    }
    if (!msg.text || msg.text.startsWith('/')) return;
    const chatId = msg.chat.id;

    // E1/E2: دکمه‌های منوی اصلی — پیش از مسیر session؛ تطبیق دقیق متن و چک نقش سمت سرور در menuRouter
    try {
      if (await routeMenuText(bot, msg)) return;
    } catch (err) {
      console.error('[bot] خطا در پردازش دکمه‌ی منو:', err.message);
      return;
    }

    const sess = session.get(chatId);
    if (!sess) return;

    if (sess.flow === 'leave') return handleLeaveText(bot, msg, sess);
    if (sess.flow === 'add_employee') return handleAddEmployeeText(bot, msg, sess);
    if (sess.flow === 'fix_record') return handleFixRecordText(bot, msg, sess);
    if (sess.flow === 'dispute_reply') return handleDisputeReplyText(bot, msg, sess);
    if (sess.flow === 'urgent_task') return handleUrgentTaskText(bot, msg, sess);
    if (sess.flow === 'mission_reject') return handleMissionRejectText(bot, msg, sess);
    if (sess.flow === 'mission_edit') return handleMissionEditText(bot, msg, sess);
    if (sess.flow === 'report_comment') return handleReportCommentText(bot, msg, sess);
  });

  bot.on('callback_query', async (query) => {
    try {
      const data = String(query.data || '');
      if (!query.message || !query.message.chat) return await ui.expire(bot, query);
      const chatId = query.message.chat.id;
      const sess = session.get(chatId);

      // E3: انتخابگرهای مشترک (تقویم/ساعت/کارمند) و ناوبری (انصراف، منوی اصلی، رد شدن) — پیش از callbackهای مخصوص هر جریان
      if (isPickerCallback(data)) return await handlePickerCallback(bot, query);
      // E4: دکمه‌های inline که به handlerِ دکمه‌ی منو می‌روند (mn:<id>)؛ نقش سمت سرور چک می‌شود
      if (data.startsWith('mn:')) return await handleMenuCallback(bot, query);

      if (data.startsWith('rw:')) return await handleRemoteWorkCallback(bot, query);

      if (data.startsWith('rvs:') || data.startsWith('rvc:')) return await handleReportReviewCallback(bot, query);
      if (data.startsWith('cp_ok:') || data.startsWith('cp_no:')) return await handleCheckinPermissionCallback(bot, query); // D3: تأیید/رد اجازه‌ی ورود
      if (data.startsWith('mission_edit:')) return await startMissionEdit(bot, query);
      if (data.startsWith('leave_reject:') && missionRequestOf(data)) return await startMissionReject(bot, query);
      if (data.startsWith('leave_approve:') || data.startsWith('leave_reject:')) {
        return await handlePendingLeavesCallback(bot, query);
      }
      if (data.startsWith('dispute_close:') || data.startsWith('dispute_reply:')) {
        return await handleDisputeCallback(bot, query);
      }
      // callbackهای جریان‌ها: session نیست یا جریان دیگری است ⇒ «این دکمه منقضی شده»؛ چک مرحله داخل خود handler است
      if (data.startsWith('leave_type:') || data.startsWith('leave_unit:') || data.startsWith('leave_part:') || data.startsWith('leave_confirm:') || data === 'leave_cancel') {
        if (!sess || sess.flow !== 'leave') return await ui.expire(bot, query);
        return await handleLeaveCallback(bot, query, sess);
      }
      if (data.startsWith('add_emp_role:')) {
        if (!sess || sess.flow !== 'add_employee') return await ui.expire(bot, query);
        return await handleAddEmployeeCallback(bot, query, sess);
      }
      if (data.startsWith('fix_field:') || data === 'fix_cancel') {
        if (!sess || sess.flow !== 'fix_record') return await ui.expire(bot, query);
        return await handleFixRecordCallback(bot, query, sess);
      }
      if (data === 'ut_ok') {
        if (!sess || sess.flow !== 'urgent_task') return await ui.expire(bot, query);
        return await handleUrgentTaskCallback(bot, query, sess);
      }
      if (data.startsWith('fix_status:')) {
        if (!sess || sess.flow !== 'fix_record') return await ui.expire(bot, query);
        return await handleFixStatusCallback(bot, query, sess);
      }
      await ui.expire(bot, query); // callback ناشناخته (دکمه‌ی پیام خیلی قدیمی)
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

// callback رد از نوع ماموریت است؟ (رد ماموریت علت اجباری می‌خواهد)
function missionRequestOf(data) {
  const r = require('../repositories/leaveRepository').findById(parseInt(String(data).split(':')[1], 10));
  return r && r.kind === 'mission' && r.status === 'pending' ? r : null;
}

async function configureBotUi(bot) {
  // E5/H2: همه‌ی کارها از «📂 منو» (تنها دکمه‌ی کیبورد پایین) انجام می‌شود؛ منوی «/» تلگرام خالی می‌شود (/start همچنان کار می‌کند)
  await bot.setMyCommands([]);
  panelLinks.warnInsecureMiniAppUrl('راه‌اندازی بات'); // H3: MINI_APP_URL بدون https ⇒ هشدار در لاگ

  // دکمه منو برای باز کردن Mini App - فقط اگر آدرس واقعی در .env تنظیم شده باشد.
  // Mini App واقعی در فاز ۴ ساخته می‌شود؛ تا آن زمان این دکمه عمداً تنظیم نمی‌شود.
  if (config.miniAppUrl) {
    try {
      // توجه: node-telegram-bot-api فقط reply_markup را خودکار JSON.stringify می‌کند،
      // نه menu_button را - باید دستی تبدیلش کنیم وگرنه تلگرام این فیلد را نادیده می‌گیرد.
      await bot.setChatMenuButton({
        menu_button: JSON.stringify({
          type: 'web_app',
          text: 'حضور و غیاب',
          web_app: { url: config.miniAppUrl },
        }),
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

async function stopBot(bot) {
  stopSchedulers();
  if (bot && typeof bot.stopPolling === 'function') await bot.stopPolling();
}

module.exports = { startBot, stopBot };

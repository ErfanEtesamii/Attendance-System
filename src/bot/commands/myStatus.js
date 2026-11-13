// «📊 وضعیت و گزارش من»: وضعیت لحظه‌ای امروز + گزارش ۷ روز اخیر/ماه جاری در «یک» پیام، با دکمه‌ی به‌روزرسانی.
// فقط لایه‌ی نمایش است؛ متن‌ها از همان builderهای «وضعیت من» و «گزارش من» می‌آیند (منبع واحد).
const { getRegisteredUser, notRegisteredMessage } = require('../auth');
const { buildStatusText } = require('./status');
const { buildReportText } = require('./report');

const LINE = '━━━━━━━━━━━━━━';
const REFRESH = 'st:r';

function buildMyStatusText(user) {
  return ['📊 وضعیت و گزارش من', LINE, buildStatusText(user), '', LINE, buildReportText(user)].join('\n');
}

const keyboard = () => ({ inline_keyboard: [[{ text: '🔄 به‌روزرسانی', callback_data: REFRESH }, { text: '🏠 منوی اصلی', callback_data: 'fl:h' }]] });

async function handleMyStatus(bot, msg) {
  const chatId = msg.chat.id;
  const user = getRegisteredUser(msg.from.id);
  if (!user) {
    await bot.sendMessage(chatId, notRegisteredMessage(msg.from.id), { parse_mode: 'Markdown' });
    return;
  }
  await bot.sendMessage(chatId, buildMyStatusText(user), { reply_markup: keyboard() });
}

// «🔄 به‌روزرسانی»: همان پیام را ویرایش می‌کند (بدون پیام تازه)
async function handleMyStatusCallback(bot, query) {
  const chat = query.message && query.message.chat;
  const user = query.from ? getRegisteredUser(query.from.id) : null;
  if (!chat || !user) {
    await bot.answerCallbackQuery(query.id, { text: 'شما در سیستم ثبت نیستید.', show_alert: true });
    return;
  }
  await bot.answerCallbackQuery(query.id, { text: 'به‌روز شد ✅' });
  try {
    await bot.editMessageText(buildMyStatusText(user), { chat_id: chat.id, message_id: query.message.message_id, reply_markup: keyboard() });
  } catch (_) { /* «message is not modified»: چیزی عوض نشده */ }
}

module.exports = { handleMyStatus, handleMyStatusCallback, buildMyStatusText };

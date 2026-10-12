// C4: رد ماموریت با علتِ اجباری و اصلاح ساعت از دکمه‌های مرور شبانه (callbackهای leave_approve:/leave_reject: موجود دست‌نخورده‌اند؛
// فقط «رد» ماموریت به این جریان دو مرحله‌ای می‌رود). نتیجه همیشه از leaveApprovalService.decide می‌گذرد.
const { getRegisteredUser, hasRole } = require('../auth');
const session = require('../session');
const usersRepository = require('../../repositories/usersRepository');
const leaveRepository = require('../../repositories/leaveRepository');
const leaveApprovalService = require('../../services/leaveApprovalService');
const missionDecisionService = require('../../services/missionDecisionService');

const CANCEL_WORD = 'انصراف';

function canAct(actor, request) {
  if (!actor || !hasRole(actor, ['admin', 'manager'])) return false;
  if (actor.id === request.user_id && actor.role !== 'admin') return false;
  return leaveApprovalService.canDecide(actor, request, leaveApprovalService.awaitingRole(request));
}

async function startFlow(bot, query, flow, prompt) {
  const chatId = query.message.chat.id;
  const actor = getRegisteredUser(query.from.id);
  const requestId = parseInt(query.data.split(':')[1], 10);
  const request = leaveRepository.findById(requestId);
  if (!request || request.kind !== 'mission' || request.status !== 'pending') {
    await bot.answerCallbackQuery(query.id, { text: 'این درخواست قبلاً بررسی شده است.', show_alert: true });
    return;
  }
  if (!canAct(actor, request)) {
    await bot.answerCallbackQuery(query.id, { text: 'اجازه‌ی این عملیات را ندارید.', show_alert: true });
    return;
  }
  session.start(chatId, flow, { requestId, messageId: query.message.message_id });
  await bot.answerCallbackQuery(query.id);
  await bot.sendMessage(chatId, prompt(request));
}

const startMissionReject = (bot, query) => startFlow(bot, query, 'mission_reject',
  (r) => `علت رد ماموریت #${r.id} را بنویسید (الزامی، حداقل ${missionDecisionService.REJECT_REASON_MIN} نویسه). برای انصراف «${CANCEL_WORD}» بفرستید.`);

const startMissionEdit = (bot, query) => startFlow(bot, query, 'mission_edit',
  (r) => `ساعت جدید ماموریت #${r.id} را به‌صورت «شروع-پایان» بفرستید (فعلی: ${r.start_time}-${r.end_time})؛ مثال: 09:30-12:00. برای انصراف «${CANCEL_WORD}».`);

async function handleMissionRejectText(bot, msg, sess) {
  const chatId = msg.chat.id;
  const actor = getRegisteredUser(msg.from.id);
  const text = (msg.text || '').trim();
  if (text === CANCEL_WORD) { session.clear(chatId); await bot.sendMessage(chatId, 'انصراف داده شد. ماموریت همچنان منتظر تصمیم است.'); return; }
  const request = leaveRepository.findById(sess.data.requestId);
  if (!request || request.status !== 'pending' || !canAct(actor, request)) {
    session.clear(chatId);
    await bot.sendMessage(chatId, 'این درخواست دیگر قابل تصمیم‌گیری نیست.');
    return;
  }
  const res = missionDecisionService.rejectMission({ requestId: request.id, actor, reason: text });
  if (!res.ok) { // علت کوتاه: جریان باز می‌ماند تا دوباره بفرستد
    if (res.code !== 'REASON_REQUIRED') session.clear(chatId);
    await bot.sendMessage(chatId, res.error);
    return;
  }
  session.clear(chatId);
  await bot.sendMessage(chatId, `ماموریت #${request.id} ❌ رد شد و علت برای کارمند ارسال شد.`);
  try {
    if (sess.data.messageId) await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: sess.data.messageId });
  } catch (_) { /* پیام قدیمی/تغییرکرده */ }
  const employee = usersRepository.findById(request.user_id);
  if (employee && employee.telegram_user_id) {
    try {
      await bot.sendMessage(employee.telegram_user_id, `ماموریت شما (${request.start_date} تا ${request.end_date}) رد شد ❌\nعلت: ${res.reason}`);
    } catch (err) {
      console.error('[bot] خطا در اطلاع‌رسانی رد ماموریت به کارمند:', err.message);
    }
  }
}

async function handleMissionEditText(bot, msg, sess) {
  const chatId = msg.chat.id;
  const actor = getRegisteredUser(msg.from.id);
  const text = (msg.text || '').trim();
  if (text === CANCEL_WORD) { session.clear(chatId); await bot.sendMessage(chatId, 'انصراف داده شد.'); return; }
  const res = missionDecisionService.adjustTimes({ requestId: sess.data.requestId, actor, text });
  if (!res.ok) {
    if (res.code !== 'BAD_FORMAT') session.clear(chatId);
    await bot.sendMessage(chatId, res.error);
    return;
  }
  session.clear(chatId);
  await bot.sendMessage(chatId, `ساعت ماموریت #${res.request.id} به ${res.startTime}-${res.endTime} اصلاح شد. حالا می‌توانید تأیید یا رد کنید.`, {
    reply_markup: { inline_keyboard: [missionDecisionService.missionKeyboardRow(res.request)] },
  });
}

module.exports = { startMissionReject, startMissionEdit, handleMissionRejectText, handleMissionEditText };

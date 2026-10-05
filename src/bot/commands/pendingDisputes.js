// /pending_disputes — اعتراض‌های باز کارمندان تیم (ادمین: همه) با امکان پاسخ و بستن از داخل بات.
const { getRegisteredUser, notRegisteredMessage, hasRole } = require('../auth');
const session = require('../session');
const usersRepository = require('../../repositories/usersRepository');
const disputeRepository = require('../../repositories/disputeRepository');
const attendanceRepository = require('../../repositories/attendanceRepository');
const auditRepository = require('../../repositories/auditRepository');

function canHandle(actor, dispute) {
  if (actor.role === 'admin') return true;
  const employee = usersRepository.findById(dispute.user_id);
  return !!employee && employee.manager_id === actor.id;
}

async function closeDispute(bot, actor, dispute, note) {
  disputeRepository.setStatus(dispute.id, 'resolved');
  auditRepository.logEvent({
    userId: actor.id,
    action: 'dispute_resolved',
    details: { source: 'telegram_bot', disputeId: dispute.id, targetUserId: dispute.user_id, note: note || undefined },
  });
  const employee = usersRepository.findById(dispute.user_id);
  if (employee && employee.telegram_user_id) {
    try {
      await bot.sendMessage(
        employee.telegram_user_id,
        `اعتراض شما بررسی و بسته شد ✅${note ? `\nپاسخ ${actor.role === 'admin' ? 'ادمین' : 'سرپرست'}: ${note}` : ''}`
      );
    } catch (err) {
      console.error('[bot] خطا در اطلاع‌رسانی بسته‌شدن اعتراض به کارمند:', err.message);
    }
  }
}

async function handlePendingDisputes(bot, msg) {
  const chatId = msg.chat.id;
  const user = getRegisteredUser(msg.from.id);
  if (!user) {
    await bot.sendMessage(chatId, notRegisteredMessage(msg.from.id), { parse_mode: 'Markdown' });
    return;
  }
  if (!hasRole(user, ['admin', 'manager'])) {
    await bot.sendMessage(chatId, '⛔️ این دستور فقط برای سرپرستان و ادمین قابل استفاده است.');
    return;
  }

  const open = disputeRepository.listOpen().filter((d) => canHandle(user, d));
  if (open.length === 0) {
    await bot.sendMessage(chatId, 'هیچ اعتراض بازی وجود ندارد.');
    return;
  }

  for (const d of open) {
    const employee = usersRepository.findById(d.user_id);
    const rec = d.attendance_record_id ? attendanceRepository.findById(d.attendance_record_id) : null;
    const text = [
      `اعتراض #${d.id}`,
      `کارمند: ${employee ? employee.full_name : `#${d.user_id}`}`,
      rec ? `رکورد مرتبط: ${rec.record_date}` : null,
      `متن: ${d.message}`,
    ].filter(Boolean).join('\n');

    // eslint-disable-next-line no-await-in-loop
    await bot.sendMessage(chatId, text, {
      reply_markup: {
        inline_keyboard: [[
          { text: '💬 پاسخ و بستن', callback_data: `dispute_reply:${d.id}` },
          { text: '✅ بستن بدون پاسخ', callback_data: `dispute_close:${d.id}` },
        ]],
      },
    });
  }
}

async function handleDisputeCallback(bot, query) {
  const chatId = query.message.chat.id;
  const actor = getRegisteredUser(query.from.id);
  if (!actor || !hasRole(actor, ['admin', 'manager'])) {
    await bot.answerCallbackQuery(query.id, { text: 'اجازه این عملیات را ندارید.', show_alert: true });
    return;
  }

  const [action, idStr] = query.data.split(':');
  const dispute = disputeRepository.findById(parseInt(idStr, 10));
  if (!dispute || dispute.status !== 'open') {
    await bot.answerCallbackQuery(query.id, { text: 'این اعتراض قبلاً بسته شده است.', show_alert: true });
    return;
  }
  if (!canHandle(actor, dispute)) {
    await bot.answerCallbackQuery(query.id, { text: 'این کارمند زیرمجموعه شما نیست.', show_alert: true });
    return;
  }

  if (action === 'dispute_close') {
    await closeDispute(bot, actor, dispute, null);
    await bot.answerCallbackQuery(query.id, { text: 'اعتراض بسته شد.' });
    await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: query.message.message_id });
    await bot.sendMessage(chatId, `اعتراض #${dispute.id} بسته شد ✅`);
    return;
  }

  // dispute_reply: منتظر متن پاسخ می‌مانیم
  session.start(chatId, 'dispute_reply', { disputeId: dispute.id });
  await bot.answerCallbackQuery(query.id);
  await bot.sendMessage(
    chatId,
    `پاسخ خود را برای اعتراض #${dispute.id} بنویسید و بفرستید.\nبرای بستن بدون پاسخ «-» و برای انصراف «انصراف» را بفرستید.`
  );
}

async function handleDisputeReplyText(bot, msg, sess) {
  const chatId = msg.chat.id;
  const actor = getRegisteredUser(msg.from.id);
  const text = (msg.text || '').trim();

  if (text === 'انصراف') {
    session.clear(chatId);
    await bot.sendMessage(chatId, 'انصراف داده شد. اعتراض همچنان باز است.');
    return;
  }

  const dispute = disputeRepository.findById(sess.data.disputeId);
  if (!actor || !hasRole(actor, ['admin', 'manager']) || !dispute || dispute.status !== 'open' || !canHandle(actor, dispute)) {
    session.clear(chatId);
    await bot.sendMessage(chatId, 'این اعتراض دیگر قابل پاسخ نیست.');
    return;
  }

  const note = text === '-' ? null : text.slice(0, 500);
  await closeDispute(bot, actor, dispute, note);
  session.clear(chatId);
  await bot.sendMessage(chatId, `اعتراض #${dispute.id} بسته شد ✅${note ? ' و پاسخ شما برای کارمند ارسال شد.' : ''}`);
}

module.exports = { handlePendingDisputes, handleDisputeCallback, handleDisputeReplyText };

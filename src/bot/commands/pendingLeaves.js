const { getRegisteredUser, notRegisteredMessage, hasRole } = require('../auth');
const usersRepository = require('../../repositories/usersRepository');
const leaveRepository = require('../../repositories/leaveRepository');
const auditRepository = require('../../repositories/auditRepository');
const notificationEvents = require('../../services/notificationEvents');
const leaveApprovalService = require('../../services/leaveApprovalService');

async function handlePendingLeaves(bot, msg) {
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

  const pending = leaveRepository.listPending();
  // S4-11a: سرپرست فقط درخواست‌هایی را می‌بیند که «نوبت مرحله‌ی سرپرست» است؛ ادمین همه‌ی pendingها (هر مرحله) را
  const scoped =
    user.role === 'admin'
      ? pending
      : pending.filter((r) => usersRepository.findById(r.user_id)?.manager_id === user.id && leaveApprovalService.awaitingRole(r) === 'manager');

  if (scoped.length === 0) {
    await bot.sendMessage(chatId, 'هیچ درخواست در انتظاری وجود ندارد.');
    return;
  }

  for (const request of scoped) {
    const employee = usersRepository.findById(request.user_id);
    const typeLabel = request.kind === 'mission' ? 'مأموریت' : 'مرخصی';
    const text = [
      `درخواست #${request.id} — ${typeLabel}`,
      `کارمند: ${employee ? employee.full_name : `#${request.user_id}`}`,
      `بازه: ${request.start_date} تا ${request.end_date}`,
      request.reason ? `توضیح: ${request.reason}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    await bot.sendMessage(chatId, text, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ تأیید', callback_data: `leave_approve:${request.id}` },
            { text: '❌ رد', callback_data: `leave_reject:${request.id}` },
          ],
        ],
      },
    });
  }
}

async function handlePendingLeavesCallback(bot, query) {
  const chatId = query.message.chat.id;
  const approver = getRegisteredUser(query.from.id);
  if (!approver || !hasRole(approver, ['admin', 'manager'])) {
    await bot.answerCallbackQuery(query.id, { text: 'اجازه این عملیات را ندارید.', show_alert: true });
    return;
  }

  const [action, idStr] = query.data.split(':');
  const requestId = parseInt(idStr, 10);
  const request = leaveRepository.findById(requestId);

  if (!request || request.status !== 'pending') {
    await bot.answerCallbackQuery(query.id, { text: 'این درخواست قبلاً بررسی شده است.', show_alert: true });
    return;
  }

  const employee = usersRepository.findById(request.user_id);
  const decision = action === 'leave_approve' ? 'approve' : 'reject';
  const result = leaveApprovalService.decide({ requestId, actor: approver, decision });
  if (!result.ok) {
    await bot.answerCallbackQuery(query.id, { text: result.error, show_alert: true });
    return;
  }
  const newStatus = result.finalStatus;
  const updated = result.request;
  if (result.completed) notificationEvents.leaveDecided(updated); // اعلان پنل برای کارمند فقط روی تصمیم نهایی (S4-6b/S4-11a)

  auditRepository.logEvent({
    userId: approver.id,
    action: !result.completed ? 'leave_request_step_approved' : newStatus === 'approved' ? 'leave_request_approved' : 'leave_request_rejected',
    details: { requestId, employeeId: request.user_id, step: result.step, nextRole: result.nextRole },
  });

  if (!result.completed) {
    notificationEvents.leaveStepAdvanced(updated); // اعلان به تأییدکننده‌ی مرحله‌ی بعد (S4-11b)
    await bot.answerCallbackQuery(query.id, { text: 'مرحله‌ی شما تأیید شد؛ منتظر تأیید مرحله‌ی بعد.' });
    await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: query.message.message_id });
    await bot.sendMessage(chatId, `درخواست #${requestId} ✅ در مرحله‌ی شما تأیید شد و برای مرحله‌ی بعد (${{ admin: 'ادمین', hr: 'منابع انسانی' }[result.nextRole] || result.nextRole}) ارسال شد.`);
    return;
  }

  await bot.answerCallbackQuery(query.id, { text: newStatus === 'approved' ? 'تأیید شد.' : 'رد شد.' });
  await bot.editMessageReplyMarkup(
    { inline_keyboard: [] },
    { chat_id: chatId, message_id: query.message.message_id }
  );
  await bot.sendMessage(
    chatId,
    `درخواست #${requestId} ${newStatus === 'approved' ? '✅ تأیید' : '❌ رد'} شد.`
  );

  if (employee?.telegram_user_id) {
    try {
      const statusLabel = newStatus === 'approved' ? 'تأیید شد ✅' : 'رد شد ❌';
      await bot.sendMessage(
        employee.telegram_user_id,
        `درخواست ${request.kind === 'mission' ? 'مأموریت' : 'مرخصی'} شما (${request.start_date} تا ${request.end_date}) ${statusLabel}`
      );
    } catch (err) {
      console.error('[bot] خطا در اطلاع‌رسانی وضعیت مرخصی به کارمند:', err.message);
    }
  }
}

module.exports = { handlePendingLeaves, handlePendingLeavesCallback };

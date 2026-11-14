const { getRegisteredUser, notRegisteredMessage, hasRole } = require('../auth');
const usersRepository = require('../../repositories/usersRepository');
const leaveRepository = require('../../repositories/leaveRepository');
const auditRepository = require('../../repositories/auditRepository');
const notificationEvents = require('../../services/notificationEvents');
const leaveApprovalService = require('../../services/leaveApprovalService');

const { isoDateToJalaliString } = require('../../utils/jalali');
const pendingRemote = require('./pendingRemote');

const LINE = '━━━━━━━━━━━━━━';
const fa = (n) => Number(n).toLocaleString('fa-IR');

/** مرخصی/ماموریت‌های pending که همین کاربر می‌تواند تصمیم بگیرد (leaveApprovalService.canDecide): سرپرست = زیردستان مستقیم؛ ادمین = همه. */
function leavesFor(user) {
  const pending = leaveRepository.listPending();
  return pending.filter((r) => leaveApprovalService.canDecide(user, r));
}

/** تعداد کل درخواست‌های منتظر (مرخصی/ماموریت + دورکاری) برای نشانگر دکمه‌ی منو؛ ⇒ { ok, total } */
function pendingTotal(user) {
  try {
    return { ok: true, total: leavesFor(user).length + pendingRemote.pendingCount(user) };
  } catch (err) {
    return { ok: false, error: err && err.message };
  }
}

function leaveCardText(request, employee) {
  const isMission = request.kind === 'mission';
  const range = request.start_date === request.end_date ? isoDateToJalaliString(request.start_date) || request.start_date : `${isoDateToJalaliString(request.start_date) || request.start_date} تا ${isoDateToJalaliString(request.end_date) || request.end_date}`;
  return [
    `${isMission ? '🚗 ماموریت' : '🏖 مرخصی'} #${request.id}`,
    LINE,
    `👤 ${employee ? employee.full_name : `#${request.user_id}`}`,
    `📅 ${range}`,
    request.reason ? `📝 ${request.reason}` : null,
  ].filter(Boolean).join('\n');
}

async function handlePendingLeaves(bot, msg) {
  const chatId = msg.chat.id;
  const user = getRegisteredUser(msg.from.id);
  if (!user) {
    await bot.sendMessage(chatId, notRegisteredMessage(msg.from.id), { parse_mode: 'Markdown' });
    return;
  }
  if (!hasRole(user, ['admin', 'manager'])) {
    await bot.sendMessage(chatId, '⛔️ این گزینه فقط برای سرپرستان و ادمین در دسترس است.');
    return;
  }

  const scoped = leavesFor(user);
  const remoteCount = pendingRemote.pendingCount(user);

  if (scoped.length === 0 && remoteCount === 0) {
    await bot.sendMessage(chatId, `📥 درخواست‌های منتظر\n${LINE}\n✅ هیچ درخواست در انتظاری وجود ندارد.`);
    return;
  }

  await bot.sendMessage(chatId, [`📥 درخواست‌های منتظر تأیید — ${fa(scoped.length + remoteCount)} مورد`, LINE, `🏖 مرخصی / 🚗 ماموریت: ${fa(scoped.length)}`, `🏠 دورکاری: ${fa(remoteCount)}`, '', 'هر درخواست را همین‌جا تأیید یا رد کنید 👇'].join('\n'));

  for (const request of scoped) {
    const employee = usersRepository.findById(request.user_id);
    await bot.sendMessage(chatId, leaveCardText(request, employee), {
      reply_markup: {
        inline_keyboard: [
          request.kind === 'mission'
            ? require('../../services/missionDecisionService').missionKeyboardRow(request) // C4: ماموریت ⇒ + «اصلاح ساعت»
            : [
              { text: '✅ تأیید', callback_data: `leave_approve:${request.id}`, style: 'success' },
              { text: '❌ رد', callback_data: `leave_reject:${request.id}`, style: 'danger' },
            ],
        ],
      },
    });
  }

  if (remoteCount > 0) await pendingRemote.sendRemoteCards(bot, chatId, user);
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
  notificationEvents.leaveDecided(updated); // اعلان پنل برای کارمند (با نام تصمیم‌گیرنده) + اعلان به ادمین‌ها اگر سرپرست تصمیم گرفت

  auditRepository.logEvent({
    userId: approver.id,
    action: newStatus === 'approved' ? 'leave_request_approved' : 'leave_request_rejected',
    details: { requestId, employeeId: request.user_id, step: result.step, decidedByRole: approver.role },
  });

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
      const who = leaveApprovalService.decisionInfo(updated);
      await bot.sendMessage(
        employee.telegram_user_id,
        `درخواست ${request.kind === 'mission' ? 'مأموریت' : 'مرخصی'} شما (${request.start_date} تا ${request.end_date}) ${statusLabel}` +
          (who ? `\n${newStatus === 'approved' ? 'تأییدکننده' : 'ردکننده'} — ${who.roleLabel}: ${who.fullName}` : '')
      );
    } catch (err) {
      console.error('[bot] خطا در اطلاع‌رسانی وضعیت مرخصی به کارمند:', err.message);
    }
  }
}

module.exports = { handlePendingLeaves, handlePendingLeavesCallback, pendingTotal, leavesFor };

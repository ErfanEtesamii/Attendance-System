// D3 (فاز ۱۲): دکمه‌های «✅ اجازه می‌دهم / ❌ رد» روی پیام تلگرامِ درخواست اجازه‌ی ورود (callback: cp_ok:<id> | cp_no:<id>).
// فقط لایه‌ی تعامل است؛ قواعد (سرپرست مستقیم/ادمین، فقط pending، TTL) و اثرهای جانبی در checkinPermissionDecisionService
// (همان مسیرِ پنل) است. hr/کارمند ⇒ ردِ صریح. دکمه‌ی پیام قدیمی/تصمیم‌گرفته‌شده ⇒ هشدار و حذف دکمه‌ها.
const { getRegisteredUser, hasRole } = require('../auth');
const usersRepository = require('../../repositories/usersRepository');
const { decideAndNotify } = require('../../services/checkinPermissionDecisionService');

async function removeButtons(bot, query) {
  try {
    await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: query.message.chat.id, message_id: query.message.message_id });
  } catch (_) { /* پیام قدیمی/ویرایش‌شده؛ مهم نیست */ }
}

async function handleCheckinPermissionCallback(bot, query) {
  const actor = getRegisteredUser(query.from.id);
  if (!actor || !hasRole(actor, ['admin', 'manager'])) {
    await bot.answerCallbackQuery(query.id, { text: 'اجازه این عملیات را ندارید.', show_alert: true });
    return;
  }
  const [action, idStr] = String(query.data || '').split(':');
  const id = parseInt(idStr, 10);
  if (!['cp_ok', 'cp_no'].includes(action) || !Number.isInteger(id) || id <= 0) {
    await bot.answerCallbackQuery(query.id, { text: 'درخواست نامعتبر است.', show_alert: true });
    return;
  }
  const approve = action === 'cp_ok';

  const r = decideAndNotify(actor, id, approve, null, { source: 'telegram_bot' });
  if (!r.ok) {
    await bot.answerCallbackQuery(query.id, { text: r.error, show_alert: true });
    if (r.status === 409 || r.status === 404) await removeButtons(bot, query); // قبلاً تصمیم گرفته شده/منقضی شده
    return;
  }
  const employee = usersRepository.findById(r.permission.userId);
  const name = employee ? employee.full_name : `#${r.permission.userId}`;
  await bot.answerCallbackQuery(query.id, { text: approve ? 'اجازه داده شد.' : 'رد شد.' });
  await removeButtons(bot, query);
  await bot.sendMessage(query.message.chat.id, approve ? `✅ اجازه‌ی ورود ${name} تأیید شد.` : `❌ درخواست اجازه‌ی ورود ${name} رد شد.`);
}

module.exports = { handleCheckinPermissionCallback };

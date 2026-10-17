// R6 (فاز ۱۴): «🏠 دورکاری‌های منتظر» — خلاصه‌ی صف بررسی دورکاری برای سرپرست/ادمین و دکمه‌ی باز کردن همان صف در پنل.
// تأیید/رد در پنل انجام می‌شود (اصلاح ساعت و تصمیم هم‌پوشانی با حضوری از بات ممکن نیست)؛ اسکوپ را remoteWorkAdminService.pendingSummary اعمال می‌کند.
const { getRegisteredUser, notRegisteredMessage, hasRole } = require('../auth');
const remoteAdmin = require('../../services/remoteWorkAdminService');
const { panelWebAppButton } = require('../panelLinks');
const { isoDateToJalaliString } = require('../../utils/jalali');

const MAX_LINES = 15;

/** متن خلاصه (خالص؛ برای تست). summary = خروجی pendingSummary. */
function buildSummaryText(summary) {
  const lines = [`🏠 دورکاری‌های منتظر بررسی: ${summary.total} ثبت`];
  for (const e of summary.employees.slice(0, MAX_LINES)) {
    lines.push(`• ${e.fullName} — ${e.count} ثبت (قدیمی‌ترین: ${isoDateToJalaliString(e.oldestWorkDate) || e.oldestWorkDate})`);
  }
  if (summary.employees.length > MAX_LINES) lines.push(`و ${summary.employees.length - MAX_LINES} نفر دیگر`);
  lines.push('', 'تأیید، رد و اصلاح ساعت در صف دورکاری پنل انجام می‌شود.');
  return lines.join('\n');
}

async function handlePendingRemote(bot, msg) {
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
  const summary = remoteAdmin.pendingSummary(user);
  if (!summary.ok) {
    await bot.sendMessage(chatId, summary.error);
    return;
  }
  if (summary.total === 0) {
    await bot.sendMessage(chatId, 'هیچ دورکاریِ منتظر بررسی ندارید. ✅');
    return;
  }
  const btn = panelWebAppButton({ view: 'remote', text: '🖥 صف دورکاری' });
  await bot.sendMessage(chatId, buildSummaryText(summary), btn ? { reply_markup: { inline_keyboard: [[btn]] } } : undefined);
}

module.exports = { handlePendingRemote, buildSummaryText };

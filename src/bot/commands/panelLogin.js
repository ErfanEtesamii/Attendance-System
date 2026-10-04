// /panel — صدور کد ورود یک‌بارمصرف برای پنل مدیریتی وب (فقط مدیر/ادمین، فقط چت خصوصی).
const { getRegisteredUser, hasRole, notRegisteredMessage } = require('../auth');
const { issueCode } = require('../../utils/panelLoginCodes');
const auditRepository = require('../../repositories/auditRepository');

async function handlePanelLogin(bot, msg) {
  const chatId = msg.chat.id;
  if (msg.chat.type !== 'private') {
    await bot.sendMessage(chatId, 'این دستور را فقط در چت خصوصی با بات بزنید.');
    return;
  }
  const user = getRegisteredUser(msg.from.id);
  if (!user) {
    await bot.sendMessage(chatId, notRegisteredMessage(msg.from.id), { parse_mode: 'Markdown' });
    return;
  }
  if (!hasRole(user, ['manager', 'admin'])) {
    await bot.sendMessage(chatId, 'شما به پنل مدیریتی دسترسی ندارید.');
    return;
  }

  const { code, expiresInSeconds } = issueCode(user.id);
  auditRepository.logEvent({ userId: user.id, action: 'admin_panel_code_issued' });
  await bot.sendMessage(
    chatId,
    `🔐 کد ورود به پنل مدیریتی:\n\n\`${code}\`\n\nاین کد ${expiresInSeconds / 60} دقیقه اعتبار دارد و فقط یک‌بار قابل استفاده است. آن را به کسی ندهید.`,
    { parse_mode: 'Markdown' }
  );
}

module.exports = { handlePanelLogin };

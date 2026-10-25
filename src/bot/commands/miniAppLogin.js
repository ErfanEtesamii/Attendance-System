const config = require('../../config');
const { getRegisteredUser, notRegisteredMessage } = require('../auth');
const { issueMiniAppToken } = require('../../utils/panelLoginCodes');

async function handleMiniAppLogin(bot, msg) {
  const user = getRegisteredUser(msg.from.id);
  if (!user) return bot.sendMessage(msg.chat.id, notRegisteredMessage(msg.from.id), { parse_mode: 'Markdown' });
  if (!config.miniAppUrl || !config.miniAppUrl.startsWith('https://')) {
    return bot.sendMessage(msg.chat.id, 'آدرس امن مینی‌اپ روی سرور تنظیم نشده است (MINI_APP_URL).');
  }
  const { token, expiresInSeconds } = issueMiniAppToken(user.id);
  const url = new URL(config.miniAppUrl);
  url.searchParams.set('bale_token', token);
  await bot.sendMessage(msg.chat.id, `لینک مینی‌اپ ${expiresInSeconds / 60} دقیقه اعتبار دارد و فقط یک‌بار قابل استفاده است.`, {
    reply_markup: { inline_keyboard: [[{ text: '🕒 باز کردن مینی‌اپ حضور و غیاب', url: url.toString() }]] },
  });
}

module.exports = { handleMiniAppLogin };

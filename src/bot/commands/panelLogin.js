// /panel — ورود به پنل وب برای هر سه نقش (ادمین / سرپرست / کارمند)، فقط در چت خصوصی.
// سه راه ورود در یک پیام:
//   ۱) دکمه‌ی «ورود به پنل» (Web App داخل تلگرام — بدون کد)
//   ۲) دکمه‌ی «باز کردن در مرورگر» (لینک یک‌بارمصرف ۵ دقیقه‌ای)
//   ۳) کد ۸ رقمی یک‌بارمصرف (برای تایپ دستی در صفحه‌ی ورود)
const { getRegisteredUser, notRegisteredMessage } = require('../auth');
const { issueCode, issueLinkToken } = require('../../utils/panelLoginCodes');
const auditRepository = require('../../repositories/auditRepository');
const { ROLE_LABELS, ROLE_ACCESS, panelUrl, panelWebAppButton, persistentKeyboard } = require('../panelLinks');

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
  if (!panelUrl()) {
    await bot.sendMessage(chatId, 'آدرس پنل روی سرور تنظیم نشده است (MINI_APP_URL). به ادمین اطلاع دهید.');
    return;
  }

  const { code, expiresInSeconds: codeTtl } = issueCode(user.id);
  const { token, expiresInSeconds: linkTtl } = issueLinkToken(user.id);
  auditRepository.logEvent({ userId: user.id, action: 'admin_panel_code_issued', details: { role: user.role } });

  const buttons = [];
  const webApp = panelWebAppButton();
  if (webApp) buttons.push([webApp]);
  buttons.push([{ text: '🌐 باز کردن در مرورگر', url: panelUrl({ token }) }]);

  const text = [
    `🖥 پنل حضور و غیاب — دسترسی شما: ${ROLE_LABELS[user.role] || user.role}`,
    ROLE_ACCESS[user.role] || '',
    '',
    'برای ورود یکی از دکمه‌های زیر را بزنید.',
    `لینک مرورگر ${linkTtl / 60} دقیقه اعتبار دارد و فقط یک‌بار کار می‌کند؛ آن را برای کسی نفرستید.`,
    '',
    `کد ورود دستی (برای صفحه‌ی ورود): \`${code}\` — ${codeTtl / 60} دقیقه اعتبار.`,
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');

  await bot.sendMessage(chatId, text, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: buttons },
  });

  // کیبورد ثابتِ «پنل / ثبت تردد» را هم زیر چت فعال می‌کنیم تا دفعه‌ی بعد نیازی به تایپ دستور نباشد
  const kb = persistentKeyboard();
  if (kb) await bot.sendMessage(chatId, 'دکمه‌ی «🖥 پنل» حالا پایین صفحه‌ی چت همیشه در دسترس است.', { reply_markup: kb });
}

module.exports = { handlePanelLogin };

const { getRegisteredUser, notRegisteredMessage } = require('../auth');
const { persistentKeyboard } = require('../panelLinks');

async function handleStart(bot, msg) {
  const chatId = msg.chat.id;
  const user = getRegisteredUser(msg.from.id);

  if (!user) {
    await bot.sendMessage(chatId, `به ربات حضور و غیاب فرازهنر خوش آمدید.\n\n${notRegisteredMessage(msg.from.id)}`, {
      parse_mode: 'Markdown',
    });
    return;
  }

  const lines = [
    `سلام ${user.full_name} 👋`,
    'به ربات حضور و غیاب فرازهنر خوش آمدید.',
    '',
    'دستورات قابل استفاده را با /help ببینید.',
  ];
  const kb = persistentKeyboard();
  if (kb) lines.push('', 'برای ورود به پنل، دکمه‌ی «🖥 پنل» را در پایین صفحه بزنید (یا /panel).');
  await bot.sendMessage(chatId, lines.join('\n'), kb && msg.chat.type === 'private' ? { reply_markup: kb } : {});
}

module.exports = { handleStart };

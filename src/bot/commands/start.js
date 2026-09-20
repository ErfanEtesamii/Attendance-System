const { getRegisteredUser, notRegisteredMessage } = require('../auth');

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
  await bot.sendMessage(chatId, lines.join('\n'));
}

module.exports = { handleStart };

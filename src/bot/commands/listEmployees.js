const { getRegisteredUser, notRegisteredMessage, hasRole } = require('../auth');
const usersRepository = require('../../repositories/usersRepository');

async function handleListEmployees(bot, msg) {
  const chatId = msg.chat.id;
  const user = getRegisteredUser(msg.from.id);
  if (!user) {
    await bot.sendMessage(chatId, notRegisteredMessage(msg.from.id), { parse_mode: 'Markdown' });
    return;
  }
  if (!hasRole(user, ['admin', 'manager'])) {
    await bot.sendMessage(chatId, '⛔️ این دستور فقط برای مدیران و ادمین قابل استفاده است.');
    return;
  }

  const all = usersRepository.listUsers({});
  const scoped = user.role === 'admin' ? all : all.filter((u) => u.manager_id === user.id);

  if (scoped.length === 0) {
    await bot.sendMessage(chatId, 'هیچ کارمندی یافت نشد.');
    return;
  }

  const lines = scoped.map((u) => {
    const status = u.is_active ? '🟢 فعال' : '🔴 غیرفعال';
    const roleLabel = { employee: 'کارمند', manager: 'مدیر', admin: 'ادمین' }[u.role] || u.role;
    return `${u.full_name} — ${roleLabel} — ${u.department || 'بدون دپارتمان'} — ${status}`;
  });

  await bot.sendMessage(chatId, [`👥 لیست کارمندان (${scoped.length} نفر):`, ...lines].join('\n'));
}

module.exports = { handleListEmployees };

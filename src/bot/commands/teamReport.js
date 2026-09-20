const { getRegisteredUser, notRegisteredMessage, hasRole } = require('../auth');
const usersRepository = require('../../repositories/usersRepository');
const attendanceRepository = require('../../repositories/attendanceRepository');
const { summarizeRange, formatMinutes } = require('../../utils/workHours');
const { todayDateString } = require('../../utils/serverTime');

function daysAgoDateString(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

async function handleTeamReport(bot, msg) {
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

  const all = usersRepository.listUsers({ onlyActive: true });
  const team = user.role === 'admin' ? all : all.filter((u) => u.manager_id === user.id);

  if (team.length === 0) {
    await bot.sendMessage(chatId, 'هیچ کارمند فعالی برای گزارش‌گیری یافت نشد.');
    return;
  }

  const today = todayDateString();
  const from = daysAgoDateString(6);

  const lines = [`📊 گزارش تیم (۷ روز اخیر) — ${team.length} نفر:`, ''];
  for (const member of team) {
    const records = attendanceRepository.listByUserAndRange(member.id, from, today);
    const summary = summarizeRange(records);
    lines.push(
      `• ${member.full_name}: ${formatMinutes(summary.totalEffective)} | تأخیر: ${summary.lateCount} | ناقص: ${summary.incompleteCount}`
    );
  }

  await bot.sendMessage(chatId, lines.join('\n'));
}

module.exports = { handleTeamReport };

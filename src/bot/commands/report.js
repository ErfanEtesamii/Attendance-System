const { getRegisteredUser, notRegisteredMessage } = require('../auth');
const attendanceRepository = require('../../repositories/attendanceRepository');
const { summarizeRange, formatMinutes } = require('../../utils/workHours');
const { todayDateString } = require('../../utils/serverTime');
const { jalaliMonthToDateRange } = require('../../utils/jalali');

function daysAgoDateString(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

async function handleReport(bot, msg) {
  const chatId = msg.chat.id;
  const user = getRegisteredUser(msg.from.id);
  if (!user) {
    await bot.sendMessage(chatId, notRegisteredMessage(msg.from.id), { parse_mode: 'Markdown' });
    return;
  }

  const today = todayDateString();
  const jalaliMonth = jalaliMonthToDateRange();
  const weekRecords = attendanceRepository.listByUserAndRange(user.id, daysAgoDateString(6), today);
  const monthRecords = attendanceRepository.listByUserAndRange(user.id, jalaliMonth.from, jalaliMonth.to);

  const weekSummary = summarizeRange(weekRecords);
  const monthSummary = summarizeRange(monthRecords);

  const lines = [
    `📊 گزارش شخصی — ${user.full_name}`,
    '',
    '🗓 هفت روز اخیر:',
    `  ساعت مفید کاری: ${formatMinutes(weekSummary.totalEffective)}`,
    `  تعداد تأخیر: ${weekSummary.lateCount}`,
    `  تعداد خروج زودهنگام: ${weekSummary.earlyLeaveCount}`,
    `  رکورد ناقص: ${weekSummary.incompleteCount}`,
    '',
    `📆 از ابتدای ${jalaliMonth.label} تا امروز:`,
    `  ساعت مفید کاری: ${formatMinutes(monthSummary.totalEffective)}`,
    `  تعداد تأخیر: ${monthSummary.lateCount}`,
    `  تعداد خروج زودهنگام: ${monthSummary.earlyLeaveCount}`,
    `  رکورد ناقص: ${monthSummary.incompleteCount}`,
  ];

  await bot.sendMessage(chatId, lines.join('\n'));
}

module.exports = { handleReport };

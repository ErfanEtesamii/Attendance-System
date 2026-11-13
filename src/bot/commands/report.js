const { getRegisteredUser, notRegisteredMessage } = require('../auth');
const attendanceRepository = require('../../repositories/attendanceRepository');
const { summarizeRange } = require('../../engine/dayService');
const { formatMinutes } = require('../../utils/workHours');
const { todayDateString } = require('../../utils/serverTime');
const { jalaliMonthToDateRange } = require('../../utils/jalali');

function daysAgoDateString(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

/** متن گزارش شخصی (۷ روز اخیر + از ابتدای ماه شمسی)؛ خالص و بدون ارسال. */
function buildReportText(user) {
  const today = todayDateString();
  const jalaliMonth = jalaliMonthToDateRange();
  const weekRecords = attendanceRepository.listByUserAndRange(user.id, daysAgoDateString(6), today);
  const monthRecords = attendanceRepository.listByUserAndRange(user.id, jalaliMonth.from, jalaliMonth.to);

  const weekSummary = summarizeRange(weekRecords);
  const monthSummary = summarizeRange(monthRecords);

  return [
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
  ].join('\n');
}

async function handleReport(bot, msg) {
  const chatId = msg.chat.id;
  const user = getRegisteredUser(msg.from.id);
  if (!user) {
    await bot.sendMessage(chatId, notRegisteredMessage(msg.from.id), { parse_mode: 'Markdown' });
    return;
  }
  await bot.sendMessage(chatId, buildReportText(user));
}

module.exports = { handleReport, buildReportText };

const usersRepository = require('../../repositories/usersRepository');
const attendanceRepository = require('../../repositories/attendanceRepository');
const { summarizeRange, summarizeRecord, formatMinutes } = require('../../utils/workHours');
const { todayDateString } = require('../../utils/serverTime');

function daysAgoDateString(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function firstOfMonthDateString() {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}

function recipientsFor(manager) {
  // مدیر دپارتمان فقط تیم خودش، ادمین همه را می‌بیند
  const all = usersRepository.listUsers({ onlyActive: true });
  return manager.role === 'admin' ? all : all.filter((u) => u.manager_id === manager.id);
}

async function sendToManagersAndAdmins(bot, buildMessage) {
  const recipients = usersRepository.listUsers({ onlyActive: true }).filter((u) => ['manager', 'admin'].includes(u.role));

  for (const recipient of recipients) {
    if (!recipient.telegram_user_id) continue;
    const team = recipientsFor(recipient);
    const text = buildMessage(recipient, team);
    if (!text) continue;
    try {
      await bot.sendMessage(recipient.telegram_user_id, text);
    } catch (err) {
      console.error('[bot][scheduler] خطا در ارسال گزارش:', err.message);
    }
  }
}

async function sendDailyReport(bot) {
  const today = todayDateString();
  await sendToManagersAndAdmins(bot, (recipient, team) => {
    if (team.length === 0) return null;
    const lines = [`📅 گزارش پایان روز — ${today}`, ''];
    for (const member of team) {
      const record = attendanceRepository.findTodayRecord(member.id);
      if (!record || !record.check_in_time) {
        lines.push(`• ${member.full_name}: غایب / بدون ثبت ورود`);
        continue;
      }
      const summary = summarizeRecord(record);
      const statusLabel = record.check_out_time ? 'خروج ثبت شده' : 'هنوز حاضر / خروج ثبت نشده';
      lines.push(`• ${member.full_name}: ${statusLabel} — ${formatMinutes(summary.effectiveMinutes)}`);
    }
    return lines.join('\n');
  });
}

async function sendWeeklyReport(bot) {
  const today = todayDateString();
  const from = daysAgoDateString(6);
  await sendToManagersAndAdmins(bot, (recipient, team) => {
    if (team.length === 0) return null;
    const lines = ['📈 گزارش هفتگی', ''];
    for (const member of team) {
      const records = attendanceRepository.listByUserAndRange(member.id, from, today);
      const summary = summarizeRange(records);
      lines.push(`• ${member.full_name}: ${formatMinutes(summary.totalEffective)} | تأخیر: ${summary.lateCount}`);
    }
    return lines.join('\n');
  });
}

async function sendMonthlyReport(bot) {
  const today = todayDateString();
  const from = firstOfMonthDateString();
  await sendToManagersAndAdmins(bot, (recipient, team) => {
    if (team.length === 0) return null;
    const lines = ['🗓 گزارش ماهانه (ماه میلادی جاری)', ''];
    for (const member of team) {
      const records = attendanceRepository.listByUserAndRange(member.id, from, today);
      const summary = summarizeRange(records);
      lines.push(`• ${member.full_name}: ${formatMinutes(summary.totalEffective)} | تأخیر: ${summary.lateCount}`);
    }
    return lines.join('\n');
  });
}

module.exports = { sendDailyReport, sendWeeklyReport, sendMonthlyReport };

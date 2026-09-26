const usersRepository = require('../../repositories/usersRepository');
const attendanceRepository = require('../../repositories/attendanceRepository');
const holidaysRepository = require('../../repositories/holidaysRepository');
const leaveRepository = require('../../repositories/leaveRepository');
const { summarizeRange, summarizeRecord, formatMinutes } = require('../../utils/workHours');
const { todayDateString } = require('../../utils/serverTime');
const { jalaliMonthRange } = require('../../utils/jalali');

// برچسب درست برای روزی که کارمند ورود ثبت نکرده: تعطیل رسمی / مرخصی تأییدشده / واقعاً غایب.
// اول status رکورد placeholder (اگر Job صبحگاهی markNonWorkingDays آن را ساخته باشد) چک می‌شود؛
// در غیر این صورت به‌صورت مستقل از holidaysRepository/leaveRepository هم چک می‌کنیم تا حتی اگر آن
// Job اجرا نشده باشد (یا مرخصی همان روز تأیید شده باشد)، گزارش باز هم اشتباه «غایب» نگوید.
function absenceLabel(userId, dateStr, record) {
  const status = record ? record.status : null;
  if (status === 'holiday' || holidaysRepository.isHoliday(dateStr)) return 'تعطیل رسمی';
  if (status === 'leave' || leaveRepository.hasApprovedLeaveOnDate(userId, dateStr, 'leave')) {
    return 'مرخصی تأییدشده';
  }
  return 'غایب / بدون ثبت ورود';
}

function daysAgoDateString(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
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
        lines.push(`• ${member.full_name}: ${absenceLabel(member.id, today, record)}`);
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
  const range = jalaliMonthRange({ previous: true });
  await sendToManagersAndAdmins(bot, (recipient, team) => {
    if (team.length === 0) return null;
    const lines = [`🗓 گزارش ماهانه — ${range.label}`, ''];
    for (const member of team) {
      const records = attendanceRepository.listByUserAndRange(member.id, range.from, range.to);
      const summary = summarizeRange(records);
      lines.push(`• ${member.full_name}: ${formatMinutes(summary.totalEffective)} | تأخیر: ${summary.lateCount}`);
    }
    return lines.join('\n');
  });
}

module.exports = { sendDailyReport, sendWeeklyReport, sendMonthlyReport };

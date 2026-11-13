const { getRegisteredUser, notRegisteredMessage } = require('../auth');
const attendanceRepository = require('../../repositories/attendanceRepository');
const breakRepository = require('../../repositories/breakRepository');
const { getCalendarDay } = require('../../engine/calendarService');
const leaveRepository = require('../../repositories/leaveRepository');
const { summarizeRecord } = require('../../engine/dayService');
const { formatMinutes } = require('../../utils/workHours');
const { todayDateString } = require('../../utils/serverTime');
const remoteWorkService = require('../../services/remoteWorkService');

function formatTime(isoString) {
  return new Date(isoString).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
}

/** متن وضعیت لحظه‌ای امروزِ یک کاربر (خالص؛ بدون ارسال) — منبع واحد «📊 وضعیت من» و «وضعیت و گزارش من». */
function buildStatusText(user) {
  const remote = remoteWorkService.getToday(user.id);
  if (remote.openSession) {
    const mode = remote.openBreak ? 'در استراحت' : 'در حال کار';
    return `🏠 دورکاری باز: از ساعت ${formatTime(remote.openSession.start_at)} (${mode})`;
  }

  const record = attendanceRepository.findTodayRecord(user.id);
  if (!record || !record.check_in_time) {
    const today = todayDateString();
    const status = record ? record.status : null;
    if (status === 'holiday' || getCalendarDay(user, today).kind === 'holiday') { // S3-7c: شامل تعطیلی دپارتمانِ همین کاربر
      return '📍 وضعیت شما: امروز تعطیل رسمی است.';
    }
    if (status === 'leave' || leaveRepository.hasApprovedLeaveOnDate(user.id, today, 'leave')) {
      return '📍 وضعیت شما: امروز مرخصی تأییدشده دارید.';
    }
    return '📍 وضعیت شما: خارج از شرکت (امروز هنوز ورود ثبت نشده است).';
  }

  const openBreak = breakRepository.findOpenBreak(record.id);
  const summary = summarizeRecord(record);

  if (record.check_out_time) {
    return [
      '📍 وضعیت شما: خارج از شرکت (خروج امروز ثبت شده است)',
      `ورود: ${formatTime(record.check_in_time)}  |  خروج: ${formatTime(record.check_out_time)}`,
      `ساعت مفید کاری امروز: ${formatMinutes(summary.effectiveMinutes)}`,
    ].join('\n');
  }

  if (openBreak) {
    const label = openBreak.break_type === 'lunch' ? 'ناهار' : 'نماز / استراحت کوتاه';
    return `☕ وضعیت شما: در حال استراحت (${label}) از ساعت ${formatTime(openBreak.start_time)}`;
  }

  return [
    '✅ وضعیت شما: حاضر در شرکت',
    `ورود: ${formatTime(record.check_in_time)}`,
    `ساعت مفید تخمینی تا الان: ${formatMinutes(summary.effectiveMinutes)}`,
  ].join('\n');
}

async function handleStatus(bot, msg) {
  const chatId = msg.chat.id;
  const user = getRegisteredUser(msg.from.id);
  if (!user) {
    await bot.sendMessage(chatId, notRegisteredMessage(msg.from.id), { parse_mode: 'Markdown' });
    return;
  }
  await bot.sendMessage(chatId, buildStatusText(user));
}

module.exports = { handleStatus, buildStatusText };

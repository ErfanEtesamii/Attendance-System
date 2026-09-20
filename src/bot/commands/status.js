const { getRegisteredUser, notRegisteredMessage } = require('../auth');
const attendanceRepository = require('../../repositories/attendanceRepository');
const breakRepository = require('../../repositories/breakRepository');
const { summarizeRecord, formatMinutes } = require('../../utils/workHours');

function formatTime(isoString) {
  return new Date(isoString).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
}

async function handleStatus(bot, msg) {
  const chatId = msg.chat.id;
  const user = getRegisteredUser(msg.from.id);
  if (!user) {
    await bot.sendMessage(chatId, notRegisteredMessage(msg.from.id), { parse_mode: 'Markdown' });
    return;
  }

  const record = attendanceRepository.findTodayRecord(user.id);
  if (!record || !record.check_in_time) {
    await bot.sendMessage(chatId, '📍 وضعیت شما: خارج از شرکت (امروز هنوز ورود ثبت نشده است).');
    return;
  }

  const openBreak = breakRepository.findOpenBreak(record.id);
  const summary = summarizeRecord(record);

  if (record.check_out_time) {
    await bot.sendMessage(
      chatId,
      [
        '📍 وضعیت شما: خارج از شرکت (خروج امروز ثبت شده است)',
        `ورود: ${formatTime(record.check_in_time)}  |  خروج: ${formatTime(record.check_out_time)}`,
        `ساعت مفید کاری امروز: ${formatMinutes(summary.effectiveMinutes)}`,
      ].join('\n')
    );
    return;
  }

  if (openBreak) {
    const label = openBreak.break_type === 'lunch' ? 'ناهار' : 'استراحت کوتاه';
    await bot.sendMessage(
      chatId,
      `☕ وضعیت شما: در حال استراحت (${label}) از ساعت ${formatTime(openBreak.start_time)}`
    );
    return;
  }

  await bot.sendMessage(
    chatId,
    [
      '✅ وضعیت شما: حاضر در شرکت',
      `ورود: ${formatTime(record.check_in_time)}`,
      `ساعت مفید تخمینی تا الان: ${formatMinutes(summary.effectiveMinutes)}`,
    ].join('\n')
  );
}

module.exports = { handleStatus };

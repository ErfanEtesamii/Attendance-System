const usersRepository = require('../../repositories/usersRepository');
const attendanceRepository = require('../../repositories/attendanceRepository');
const settingsRepository = require('../../repositories/settingsRepository');
const { todayDateString } = require('../../utils/serverTime');
const { timeStringToMinutes, minutesSinceMidnight } = require('../../utils/workHours');

const remindedToday = new Set(); // key: `${date}:${userId}`

async function checkCheckoutReminders(bot) {
  const now = new Date();
  const settings = settingsRepository.getAll();
  const workEndMinutes = timeStringToMinutes(settings.workDayEnd);
  const reminderLine = workEndMinutes - settings.checkoutReminderMinutesBefore;
  const nowMinutes = minutesSinceMidnight(now);
  if (nowMinutes < reminderLine || nowMinutes > workEndMinutes) return;

  const today = todayDateString();
  const activeUsers = usersRepository.listUsers({ onlyActive: true });

  for (const user of activeUsers) {
    if (!user.telegram_user_id) continue;
    const key = `${today}:${user.id}`;
    if (remindedToday.has(key)) continue;

    const record = attendanceRepository.findTodayRecord(user.id);
    if (!record || !record.check_in_time || record.check_out_time) continue; // حاضر نبوده یا قبلاً خروج زده

    remindedToday.add(key);
    try {
      await bot.sendMessage(
        user.telegram_user_id,
        `⏰ یادآوری: پایان ساعت کاری نزدیک است. فراموش نکنید خروج خود را ثبت کنید.`
      );
    } catch (err) {
      console.error('[bot][scheduler] خطا در ارسال یادآوری خروج:', err.message);
    }
  }
}

module.exports = { checkCheckoutReminders };

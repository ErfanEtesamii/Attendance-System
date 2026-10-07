// S3-8a: Job هر روز اجرا می‌شود و برای «هر کاربر» از getCalendarDay تصمیم می‌گیرد: روز غیرکاری ⇒ هیچ پیامی؛ پایان کار از تقویم همان کاربر
// (نیم‌روز ⇒ پایانِ نیم‌روز، شیفت ⇒ پایان شیفت). گزینه‌ی { now } فقط برای تست است.
const usersRepository = require('../../repositories/usersRepository');
const attendanceRepository = require('../../repositories/attendanceRepository');
const settingsRepository = require('../../repositories/settingsRepository');
const holidaysRepository = require('../../repositories/holidaysRepository');
const { getCalendarDay } = require('../../engine/calendarService');
const { hhmmToMinutes } = require('../../engine/computeDay');
const { minutesSinceMidnight } = require('../../utils/time');

const remindedToday = new Set(); // key: `${date}:${userId}`

async function checkCheckoutReminders(bot, { now = new Date() } = {}) {
  const settings = settingsRepository.getAll();
  const nowMinutes = minutesSinceMidnight(now, settings.timezone); // ساعت دیواری شرکت، نه ساعت سیستم
  const today = now.toISOString().slice(0, 10); // همان todayDateString (UTC)، با now قابل‌تزریق
  const holidays = holidaysRepository.listByDate(today);
  const activeUsers = usersRepository.listUsers({ onlyActive: true });

  for (const user of activeUsers) {
    if (!user.telegram_user_id) continue;
    const key = `${today}:${user.id}`;
    if (remindedToday.has(key)) continue;

    const calendar = getCalendarDay(user, today, { settings, holidays });
    if (!calendar.isWorkingDay) continue; // آخر هفته/تعطیل برای همین کاربر
    const workEndMinutes = hhmmToMinutes(calendar.expectedEnd, 'expectedEnd');
    const reminderLine = workEndMinutes - settings.checkoutReminderMinutesBefore;
    if (nowMinutes < reminderLine || nowMinutes > workEndMinutes) continue;

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

// یادآوری ورود دیرهنگام + هشدار «تأخیر مکرر» به مدیر مستقیم.
// محاسبه‌ی روز از src/engine/dayService.js می‌آید (S3-2c)؛ اینجا فقط تصمیم یادآوری/هشدار گرفته می‌شود.
// S3-8a: Job هر روز اجرا می‌شود و برای «هر کاربر» از getCalendarDay تصمیم می‌گیرد: روز غیرکاری (آخر هفته، تعطیلی کامل برای همه/دپارتمان او،
// روز غیرکاریِ شیفتش) ⇒ هیچ پیامی؛ ساعت شروع از تقویم همان کاربر (شیفت او یا تنظیمات سراسری). گزینه‌ی { now } فقط برای تست است.

const usersRepository = require('../../repositories/usersRepository');
const attendanceRepository = require('../../repositories/attendanceRepository');
const leaveRepository = require('../../repositories/leaveRepository');
const holidaysRepository = require('../../repositories/holidaysRepository');
const { getCalendarDay } = require('../../engine/calendarService');
const settingsRepository = require('../../repositories/settingsRepository');
const auditRepository = require('../../repositories/auditRepository');
const { hhmmToMinutes } = require('../../engine/computeDay');
const { summarizeRange } = require('../../engine/dayService');
const { minutesSinceMidnight } = require('../../utils/time');

// جلوگیری از ارسال چندباره یادآوری برای یک کارمند در همان روز (فقط در حافظه)
const remindedToday = new Set(); // key: `${date}:${userId}`
const alertedManagerThisMonth = new Set(); // key: `${yyyy-mm}:${userId}` - جایگزین می‌شود با چک audit_log هم

function daysAgoDateString(days, from = new Date()) {
  const d = new Date(from);
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

async function checkLateCheckins(bot, { now = new Date() } = {}) {
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
    const graceLine = hhmmToMinutes(calendar.expectedStart, 'expectedStart') + settings.lateCheckinGraceMinutes;
    if (nowMinutes < graceLine) continue;

    const record = attendanceRepository.findTodayRecord(user.id);
    if (record && record.check_in_time) continue; // ورود ثبت شده
    if (leaveRepository.hasApprovedMissionOnDate(user.id, today)) continue;

    remindedToday.add(key);
    try {
      await bot.sendMessage(
        user.telegram_user_id,
        `⏰ یادآوری: هنوز ورود امروز خود را ثبت نکرده‌اید. لطفاً در اولین فرصت ثبت کنید.`
      );
    } catch (err) {
      console.error('[bot][scheduler] خطا در ارسال یادآوری ورود:', err.message);
    }
  }
}

// هشدار به مدیر مستقیم در صورت تأخیر مکرر (بر اساس تعداد روزهای دارای تأخیر در ۳۰ روز اخیر)
async function checkRepeatedLateness(bot, { now = new Date() } = {}) {
  const today = now.toISOString().slice(0, 10);
  const monthKey = today.slice(0, 7);
  const activeUsers = usersRepository.listUsers({ onlyActive: true });
  // S3-8a: Job اکنون هر روز اجرا می‌شود؛ مثل قبل (cron فقط روزهای کاری) فقط در «روز کاریِ همین کارمند» هشدار می‌دهیم
  const settings = settingsRepository.getAll();
  const holidays = holidaysRepository.listByDate(today);

  for (const user of activeUsers) {
    if (!user.manager_id) continue;
    if (!getCalendarDay(user, today, { settings, holidays }).isWorkingDay) continue;
    const manager = usersRepository.findById(user.manager_id);
    if (!manager || !manager.telegram_user_id) continue;

    const alertKey = `${monthKey}:${user.id}`;
    if (alertedManagerThisMonth.has(alertKey)) continue;

    const records = attendanceRepository.listByUserAndRange(user.id, daysAgoDateString(29, now), today);
    const summary = summarizeRange(records);

    if (summary.lateCount >= settings.repeatedLatenessThreshold) {
      alertedManagerThisMonth.add(alertKey);
      auditRepository.logEvent({
        userId: manager.id,
        action: 'manager_alerted_repeated_lateness',
        details: { employeeId: user.id, lateCount: summary.lateCount },
      });
      try {
        await bot.sendMessage(
          manager.telegram_user_id,
          `⚠️ کارمند ${user.full_name} در ۳۰ روز اخیر ${summary.lateCount} بار تأخیر داشته است.`
        );
      } catch (err) {
        console.error('[bot][scheduler] خطا در ارسال هشدار تأخیر مکرر:', err.message);
      }
    }
  }
}

module.exports = { checkLateCheckins, checkRepeatedLateness };

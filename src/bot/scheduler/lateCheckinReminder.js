// یادآوری ورود دیرهنگام + هشدار «تأخیر مکرر» به مدیر مستقیم.
// ⚠️ چون موتور محاسبه رسمی (فاز ۵) هنوز ساخته نشده، اینجا خودمان با workHours.js
// به‌صورت سبک تشخیص می‌دهیم که آیا کارمند دیر آمده یا اصلاً نیامده.

const usersRepository = require('../../repositories/usersRepository');
const attendanceRepository = require('../../repositories/attendanceRepository');
const leaveRepository = require('../../repositories/leaveRepository');
const holidaysRepository = require('../../repositories/holidaysRepository');
const settingsRepository = require('../../repositories/settingsRepository');
const auditRepository = require('../../repositories/auditRepository');
const { todayDateString } = require('../../utils/serverTime');
const { timeStringToMinutes, minutesSinceMidnight, summarizeRange } = require('../../utils/workHours');

// جلوگیری از ارسال چندباره یادآوری برای یک کارمند در همان روز (فقط در حافظه)
const remindedToday = new Set(); // key: `${date}:${userId}`
const alertedManagerThisMonth = new Set(); // key: `${yyyy-mm}:${userId}` - جایگزین می‌شود با چک audit_log هم

function daysAgoDateString(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

async function checkLateCheckins(bot) {
  const now = new Date();
  const settings = settingsRepository.getAll();
  const graceLine = timeStringToMinutes(settings.workDayStart) + settings.lateCheckinGraceMinutes;
  if (minutesSinceMidnight(now) < graceLine) return;

  const today = todayDateString();
  if (holidaysRepository.isHoliday(today)) return;

  const activeUsers = usersRepository.listUsers({ onlyActive: true });

  for (const user of activeUsers) {
    if (!user.telegram_user_id) continue;
    const key = `${today}:${user.id}`;
    if (remindedToday.has(key)) continue;

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
async function checkRepeatedLateness(bot) {
  const today = todayDateString();
  const monthKey = today.slice(0, 7);
  const activeUsers = usersRepository.listUsers({ onlyActive: true });

  for (const user of activeUsers) {
    if (!user.manager_id) continue;
    const manager = usersRepository.findById(user.manager_id);
    if (!manager || !manager.telegram_user_id) continue;

    const alertKey = `${monthKey}:${user.id}`;
    if (alertedManagerThisMonth.has(alertKey)) continue;

    const records = attendanceRepository.listByUserAndRange(user.id, daysAgoDateString(29), today);
    const summary = summarizeRange(records);

    if (summary.lateCount >= settingsRepository.getAll().repeatedLatenessThreshold) {
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

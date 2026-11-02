// یادآوری «استراحتِ فراموش‌شده»: کارمند استراحت زده و بعد از breakOverrunReminderMinutes دقیقه (پیش‌فرض ۱۵) هنوز پایانش را نزده
// ⇒ یک پیام تلگرام با دکمه‌ی باز کردن Mini App («اگر نمی‌خواهید بیشتر استراحت کنید، پایان استراحت را بزنید»).
//
// • فقط استراحتِ «باز» (end_time خالی) روی رکوردی که خروج ندارد؛ فقط استراحت کوتاه (ناهار فقط با breakOverrunReminderLunch).
// • هر استراحت «یک‌بار» پیام می‌گیرد: dedupeKey اعلان = شناسه‌ی استراحت (در DB؛ با ری‌استارت پروسه دوباره نمی‌فرستد).
// • فقط استراحت‌هایی که شروعشان در پنجره‌ی [آستانه، آستانه + ۳ ساعت] پیش است؛ استراحتِ بازِ قدیمی (مثلاً روز قبل) پیام نمی‌گیرد.
// • خطای یک کاربر بقیه را نمی‌شکند. now تزریق‌پذیر برای تست. خروجی: { checked, reminded, errors, skipped }
const settingsRepository = require('../../repositories/settingsRepository');
const usersRepository = require('../../repositories/usersRepository');
const breakRepository = require('../../repositories/breakRepository');
const notificationEvents = require('../../services/notificationEvents');
const logger = require('../../utils/logger');

const WINDOW_AFTER_THRESHOLD_MINUTES = 180;

async function runBreakOverrunReminder({ now = new Date() } = {}) {
  const out = { checked: 0, reminded: 0, errors: 0, skipped: false };
  const settings = settingsRepository.getAll();
  const minutes = Number(settings.breakOverrunReminderMinutes);
  if (!Number.isFinite(minutes) || minutes <= 0) return { ...out, skipped: true };
  const includeLunch = settings.breakOverrunReminderLunch === true;

  const nowMs = now.getTime();
  const startedBefore = new Date(nowMs - minutes * 60000).toISOString();
  const startedAfter = new Date(nowMs - (minutes + WINDOW_AFTER_THRESHOLD_MINUTES) * 60000).toISOString();

  for (const row of breakRepository.listOpenStartedBetween(startedAfter, startedBefore)) {
    if (row.break_type === 'lunch' && !includeLunch) continue;
    out.checked += 1;
    try {
      const user = usersRepository.findById(row.user_id);
      if (!user || !user.is_active || !user.telegram_user_id) continue;
      // بین خواندن فهرست و ارسال ممکن است کاربر استراحت را بسته باشد
      const open = breakRepository.findOpenBreak(row.attendance_record_id);
      if (!open || open.id !== row.id) continue;
      const created = await notificationEvents.breakOverrun({ employeeId: user.id, breakId: row.id, breakType: row.break_type, minutes });
      if (created.some((r) => r && r.created)) out.reminded += 1;
    } catch (err) {
      out.errors += 1;
      logger.error('break_overrun_reminder_failed', { breakId: row.id, error: err && err.message });
    }
  }
  return out;
}

module.exports = { runBreakOverrunReminder, WINDOW_AFTER_THRESHOLD_MINUTES };

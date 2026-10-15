// یادآوری مهلت ساعتیِ «تسک فوری» (E1). هر اجرا، تسک‌های فوریِ «امروز» (به وقت شرکت) را که مهلت ساعتی دارند مرور می‌کند:
// اگر هنوز پاسخی ندارند (task_daily_logs) و تا مهلت حداکثر URGENT_REMINDER_LEAD_MINUTES دقیقه مانده (و مهلت نگذشته) ⇒ یک یادآوری به کارمند.
// «یک‌بار» با dedupeKey اعلان (تسک + روز) تضمین می‌شود؛ جدول/ستون تازه لازم نیست. بدون تسک فوریِ امروز ⇒ بی‌اثر.
// خطای یک تسک بقیه را نمی‌شکند. now تزریق‌پذیر برای تست. خروجی: { checked, reminded, errors }
const settingsRepository = require('../../repositories/settingsRepository');
const usersRepository = require('../../repositories/usersRepository');
const plansRepo = require('../../repositories/weeklyPlanRepository');
const logsRepo = require('../../repositories/taskLogRepository');
const notificationEvents = require('../../services/notificationEvents');
const { todayInZone, minutesSinceMidnight } = require('../../utils/time');

const URGENT_REMINDER_LEAD_MINUTES = 30;

async function runUrgentTaskReminder({ now = new Date() } = {}) {
  const out = { checked: 0, reminded: 0, errors: 0 };
  const settings = settingsRepository.getAll();
  const today = todayInZone(settings.timezone, now);
  const nowMin = minutesSinceMidnight(now, settings.timezone);
  for (const row of plansRepo.listUrgent({ from: today, to: today })) {
    if (!row.urgent_deadline_time) continue;
    out.checked += 1;
    try {
      const deadline = Number(row.urgent_deadline_time.slice(0, 2)) * 60 + Number(row.urgent_deadline_time.slice(3));
      const left = deadline - nowMin;
      if (left <= 0 || left > URGENT_REMINDER_LEAD_MINUTES) continue;
      if (logsRepo.listByTask(row.id).length > 0) continue; // پاسخ داده/منتقل شده
      const user = usersRepository.findById(row.user_id);
      if (!user || !user.is_active) continue;
      const created = await notificationEvents.urgentTaskReminder({ task: row, employeeId: user.id, minutesLeft: left });
      if (created.some((r) => r && r.created)) out.reminded += 1;
    } catch (err) {
      out.errors += 1;
      console.error('[urgentTaskReminder] خطا (نادیده گرفته شد):', err && err.message ? err.message : err);
    }
  }
  return out;
}

module.exports = { runUrgentTaskReminder, URGENT_REMINDER_LEAD_MINUTES };

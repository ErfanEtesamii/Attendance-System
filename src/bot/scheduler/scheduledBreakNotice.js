// پیام خودکار استراحت و ناهار سر ساعت (جایگزین دکمه‌ی دستی «ثبت استراحت»).
//
// • تنظیمات: scheduledBreakEnabled/Start/Minutes (استراحت)، scheduledLunchEnabled/Start/Minutes (ناهار). هر دو خاموش ⇒ بی‌اثر.
// • شش پیام: شروع، هشدارِ «چند دقیقه مانده» (scheduledWarnMinutes؛ ۰ = خاموش) و پایانِ استراحت و ناهار. هر پیام برای هر کاربر در هر روز «یک‌بار» می‌رود (dedupeKey در DB؛ با ری‌استارت پروسه تکرار نمی‌شود).
// • گیرنده: هر کارمند فعالِ دارای تلگرام که همین لحظه در شرکت است (ورودِ امروز ثبت و هنوز خروج نزده) و ماموریت تأییدشده‌ی امروز ندارد؛ شیفت و روز کاری بودن مهم نیست.
// • Job هر دقیقه اجرا می‌شود؛ اگر یک تیک از دست برود، تا WINDOW_MINUTES دقیقه بعد هنوز پیام می‌رود (dedupe جلوی تکرار را می‌گیرد).
// • خطای یک کاربر بقیه را نمی‌شکند. now تزریق‌پذیر برای تست. خروجی: { checked, sent, errors, skipped }
const settingsRepository = require('../../repositories/settingsRepository');
const usersRepository = require('../../repositories/usersRepository');
const attendanceRepository = require('../../repositories/attendanceRepository');
const leaveRepository = require('../../repositories/leaveRepository');
const { hhmmToMinutes } = require('../../engine/computeDay');
const notificationEvents = require('../../services/notificationEvents');
const { minutesSinceMidnight, formatDate } = require('../../utils/time');
const logger = require('../../utils/logger');

const WINDOW_MINUTES = 3;

const toHhmm = (minutes) => `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

// رویدادهای فعالِ تنظیمات: [{ kind, at (دقیقه از نیمه‌شب), minutes, endHHMM }]
function eventsFrom(settings) {
  const events = [];
  const warn = Number(settings.scheduledWarnMinutes);
  const add = (enabled, startKey, minutesKey, startKind, warnKind, endKind) => {
    if (enabled !== true) return;
    const minutes = Number(settings[minutesKey]);
    let start;
    try { start = hhmmToMinutes(settings[startKey], startKey); } catch (_) { return; } // ساعت نامعتبر ⇒ این گروه خاموش
    if (!Number.isFinite(minutes) || minutes <= 0) return;
    const endHHMM = toHhmm(start + minutes);
    events.push({ kind: startKind, at: start, minutes, endHHMM });
    if (Number.isFinite(warn) && warn > 0 && warn < minutes) events.push({ kind: warnKind, at: start + minutes - warn, minutes, endHHMM, warn }); // هشدار «چند دقیقه مانده»
    events.push({ kind: endKind, at: start + minutes, minutes, endHHMM });
  };
  add(settings.scheduledBreakEnabled, 'scheduledBreakStart', 'scheduledBreakMinutes', 'break_start', 'break_warn', 'break_end');
  add(settings.scheduledLunchEnabled, 'scheduledLunchStart', 'scheduledLunchMinutes', 'lunch_start', 'lunch_warn', 'lunch_end');
  return events;
}

async function runScheduledBreakNotice({ now = new Date() } = {}) {
  const out = { checked: 0, sent: 0, errors: 0, skipped: false };
  const settings = settingsRepository.getAll();
  const events = eventsFrom(settings);
  if (!events.length) return { ...out, skipped: true };

  const nowMinutes = minutesSinceMidnight(now, settings.timezone);
  const due = events.filter((e) => nowMinutes >= e.at && nowMinutes < e.at + WINDOW_MINUTES);
  if (!due.length) return { ...out, skipped: true };

  const date = formatDate(now, settings.timezone);

  for (const user of usersRepository.listUsers({ onlyActive: true })) {
    if (!user.telegram_user_id) continue;
    out.checked += 1;
    try {
      const mine = due; // شیفت و تقویم مهم نیست: هر کارمندِ حاضر در شرکت در این لحظه پیام می‌گیرد

      const record = attendanceRepository.listByUserAndRange(user.id, date, date)[0]; // با تاریخِ تزریقی (findTodayRecord ساعت واقعی را می‌خواند)
      if (!record || !record.check_in_time || record.check_out_time) continue; // حاضرِ فعلی نیست
      if (leaveRepository.hasApprovedMissionOnDate(user.id, date)) continue;

      for (const e of mine) {
        const created = await notificationEvents.scheduledBreak({ employeeId: user.id, kind: e.kind, date, minutes: e.minutes, endHHMM: e.endHHMM, warn: e.warn });
        if (created.some((r) => r && r.created)) out.sent += 1;
      }
    } catch (err) {
      out.errors += 1;
      logger.error('scheduled_break_notice_failed', { userId: user.id, error: err && err.message });
    }
  }
  return out;
}

module.exports = { runScheduledBreakNotice, eventsFrom, WINDOW_MINUTES };

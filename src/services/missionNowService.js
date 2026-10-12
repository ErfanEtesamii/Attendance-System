// C6: «ماموریت همین حالا» — شروع = اکنون، پایانِ باز؛ پایان دستی با «پایان ماموریت»؛ اگر تا پایان شیفت پایان نخورد ⇒ پایانِ خودکار.
// نمایش: ماموریت ساعتی (unit=hour) با ساعت پایانِ «موقت» = پایان شیفتِ امروز؛ برچسب مبدأ (source) وضعیت را نگه می‌دارد:
//   miniapp_now_open  — باز (پایان موقت = پایان شیفت)    miniapp_now — با «پایان ماموریت» بسته شد
//   miniapp_now_auto  — پایان خودکار = پایان شیفت؛ سرپرست باید ساعت را اصلاح کند (در مرور شبانه برچسب می‌خورد)
const settingsRepository = require('../repositories/settingsRepository');
const leaveRepository = require('../repositories/leaveRepository');
const usersRepository = require('../repositories/usersRepository');
const auditRepository = require('../repositories/auditRepository');
const missionService = require('./missionService');
const leaveDurationService = require('./leaveDurationService');
const { getCalendarDay } = require('../engine/calendarService');
const { todayInZone, minutesSinceMidnight } = require('../utils/time');
const holidaysRepository = require('../repositories/holidaysRepository');
const shiftsRepository = require('../repositories/shiftsRepository');

const OPEN = 'miniapp_now_open';
const CLOSED = 'miniapp_now';
const AUTO = 'miniapp_now_auto';
const DEFAULT_REASON = 'ماموریت فوری';
const pad = (n) => String(n).padStart(2, '0');
const hhmm = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const toMin = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
const err = (code, error) => ({ ok: false, code, error });

function openMissionOf(userId) {
  return leaveRepository.listBySource(OPEN).find((r) => r.user_id === userId) || null;
}

function startNow({ userId, reason, destination, now = new Date() }) {
  const user = usersRepository.findById(userId);
  if (!user) return err('NOT_FOUND', 'کاربر یافت نشد.');
  if (openMissionOf(userId)) return err('ALREADY_OPEN', 'یک ماموریتِ باز دارید؛ ابتدا آن را پایان دهید.');
  const settings = settingsRepository.getAll();
  const today = todayInZone(settings.timezone, now);
  const day = getCalendarDay(user, today, { settings, shift: shiftsRepository.findByUserId(userId), holidays: holidaysRepository.listByDate(today) });
  if (!day.isWorkingDay || !day.expectedEnd) return err('NOT_WORKING_DAY', 'امروز برای شما روز کاری نیست؛ از فرم ثبت ماموریت استفاده کنید.');
  const nowMin = minutesSinceMidnight(now, settings.timezone);
  const endMin = toMin(day.expectedEnd);
  if (nowMin >= endMin - 1) return err('NO_TIME_LEFT', 'ساعت کاری امروز تمام شده است؛ از فرم ثبت ماموریت استفاده کنید.');
  const startMin = Math.max(nowMin, day.expectedStart ? toMin(day.expectedStart) : nowMin);
  if (startMin >= endMin - 1) return err('NO_TIME_LEFT', 'ساعت کاری امروز تمام شده است؛ از فرم ثبت ماموریت استفاده کنید.');
  const res = missionService.create({
    userId, unit: 'hour', startDate: today, startTime: hhmm(startMin), endTime: day.expectedEnd,
    reason: reason || DEFAULT_REASON, destination, source: OPEN,
  }, { now });
  if (!res.ok) return { ok: false, code: res.errors[0].code, error: res.errors.map((e) => e.error).join(' '), errors: res.errors };
  auditRepository.logEvent({ userId, action: 'mission_started_now', details: { requestId: res.request.id, startTime: hhmm(startMin) } });
  return { ok: true, request: res.request };
}

function endNow({ userId, now = new Date() }) {
  const open = openMissionOf(userId);
  if (!open) return err('NOT_OPEN', 'ماموریتِ بازی ندارید.');
  const settings = settingsRepository.getAll();
  const nowMin = minutesSinceMidnight(now, settings.timezone);
  const startMin = toMin(open.start_time);
  const endMin = Math.max(startMin + 1, Math.min(nowMin, toMin(open.end_time)));
  const end = hhmm(endMin);
  const prep = leaveDurationService.prepare({
    userId, startDate: open.start_date, endDate: open.end_date, unit: 'hour', startTime: open.start_time, endTime: end,
    leaveTypeId: open.leave_type_id, excludeRequestId: open.id,
  }, { skipUnit: true });
  if (!prep.ok) return err(prep.errors[0].code, prep.errors[0].error);
  leaveRepository.updateTimes(open.id, open.start_time, end, prep.durationMinutes, { anyStatus: true });
  const updated = leaveRepository.setSource(open.id, CLOSED);
  auditRepository.logEvent({ userId, action: 'mission_ended_now', details: { requestId: open.id, endTime: end } });
  return { ok: true, request: updated };
}

// Job: ماموریت‌های بازی که تاریخشان گذشته یا ساعت پایانِ موقت (= پایان شیفت) رسیده ⇒ پایان خودکار + برچسب. ⇒ تعداد
function autoCloseOpen({ now = new Date() } = {}) {
  const settings = settingsRepository.getAll();
  const today = todayInZone(settings.timezone, now);
  const nowMin = minutesSinceMidnight(now, settings.timezone);
  let n = 0;
  for (const r of leaveRepository.listBySource(OPEN)) {
    if (r.start_date > today || (r.start_date === today && nowMin < toMin(r.end_time))) continue;
    leaveRepository.setSource(r.id, AUTO);
    auditRepository.logEvent({ userId: r.user_id, action: 'mission_auto_ended', details: { requestId: r.id, endTime: r.end_time } });
    n += 1;
  }
  return n;
}

module.exports = { startNow, endNow, autoCloseOpen, openMissionOf, OPEN, CLOSED, AUTO };

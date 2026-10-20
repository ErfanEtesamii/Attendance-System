// F1 (فاز ۱۲): نمای هفتگی کامل یک کارمند برای ادمین/سرپرست — فقط‌خواندنی.
// تقسیم کار F1 به سه بخش:
//   F1-a (این فایل): اسکلت، اسکوپ، تعیین هفته و ناوبری، و برای هر روز: نوع روز، ساعت برنامه‌ریزی‌شده‌ی مؤثر، حضور واقعی، قفل ماه.
//   F1-b (employeeWeekTasks.js، انجام‌شده): افزودن برنامه‌ی هفته (plan) و تسک‌های هر روز (اولویت/فوری/وضعیت/علت/انتقال/پاسخ دیرهنگام/«مشاهده شد»).
//   F1-c (employeeWeekSummary.js، انجام‌شده): خلاصه‌ی عملکرد هفته (summary) و پوشش ماه بسته.
// بدون N+1: رکوردهای حضور، مرخصی‌ها، برنامه‌های ویژه و بسته‌شدن ماه هرکدام با «یک» کوئری برای کل هفته خوانده می‌شوند.
// اسکوپ نقش (admin/hr همه، manager فقط کارمندان مستقیم) در همین‌جا سمت سرور بررسی می‌شود.
const settingsRepository = require('../repositories/settingsRepository');
const usersRepository = require('../repositories/usersRepository');
const attendanceRepository = require('../repositories/attendanceRepository');
const leaveRepository = require('../repositories/leaveRepository');
const holidaysRepository = require('../repositories/holidaysRepository');
const shiftsRepository = require('../repositories/shiftsRepository');
const userDayScheduleRepository = require('../repositories/userDayScheduleRepository');
const monthClosuresRepository = require('../repositories/monthClosuresRepository');
const calendarService = require('../engine/calendarService');
const dayService = require('../engine/dayService');
const weekTasks = require('./employeeWeekTasks');
const teamReview = require('./teamReviewService');
const teamReviewProgress = require('./teamReviewProgress');
const { summarizeWeek } = require('./employeeWeekSummary');
const { addDays, dayNumber } = require('../utils/shiftDay');
const { isoDateToJalaliString } = require('../utils/jalali');

const fail = (status, code, error) => ({ ok: false, status, code, error });
const minutesOf = (hhmm) => (typeof hhmm === 'string' && /^\d{2}:\d{2}$/.test(hhmm) ? Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)) : null);

function canView(actor, user) {
  if (!actor) return false;
  if (actor.role === 'admin' || actor.role === 'hr') return true;
  if (actor.role === 'manager') return user.manager_id === actor.id;
  return false; // کارمند و نقش ناشناخته: ممنوع (default-deny)
}

// دقیقه‌ی برنامه‌ریزی‌شده‌ی روز از ساعت مورد انتظار (شیفت شب: پایان < شروع ⇒ +۱۴۴۰). روز غیرکاری ⇒ ۰.
function plannedMinutes(cal) {
  if (!cal || !cal.isWorkingDay) return 0;
  const s = minutesOf(cal.expectedStart);
  let e = minutesOf(cal.expectedEnd);
  if (s === null || e === null) return 0;
  if (e < s) e += 1440;
  return e - s;
}

// نوع روز برای نمایش: leave/mission فقط وقتی کل روز کاری پوشش داده شده باشد؛ وگرنه نوع تقویمی.
function dayKindOf(cal, fullLeave) {
  if (fullLeave) return fullLeave.kind === 'mission' ? 'mission' : 'leave';
  if (cal.override === 'off') return 'off';
  if (cal.kind === 'holiday') return 'holiday';
  if (!cal.isWorkingDay) return 'off';
  return cal.kind === 'half' ? 'half' : 'working';
}

const DAY_KIND_LABEL = { working: 'روز کاری', half: 'نیم‌روز', off: 'غیرکاری', holiday: 'تعطیل', leave: 'مرخصی', mission: 'مأموریت' };

/**
 * B1-a (فاز ۱۳): تقویمِ مؤثر «یک روز» (override ← شیفت ← سراسری، تعطیلی، مرخصی/مأموریتِ کامل) — منبع واحد برای F1 و نمای برنامه‌ی هفته‌ی بعد.
 * overrides = userDayScheduleRepository.makeResolver(...)، leaves = leaveRepository.listApprovedInRange(...) (هر دو «دسته‌ای» و یک‌بار برای کل هفته).
 */
function resolveDay(user, date, { settings, overrides, leaves }) {
  const override = overrides(user.id, date);
  const shift = shiftsRepository.shiftOn(user.id, date);
  const cal = calendarService.getCalendarDay(user, date, { settings, shift, holidays: holidaysRepository.listByDate(date), override });
  const dayLeaves = leaves.filter((l) => l.start_date <= date && l.end_date >= date);
  const covered = cal.isWorkingDay && dayLeaves.length && calendarService.fullyOnApprovedLeave(user, date, cal);
  const fullLeave = covered ? { kind: dayLeaves.some((l) => l.kind !== 'mission') ? 'leave' : 'mission' } : null;
  return { override, shift, cal, dayLeaves, fullLeave, kind: dayKindOf(cal, fullLeave) };
}

function attendanceView(record, ctx, now) {
  if (!record) return null;
  const base = { recordId: record.id, status: record.status || null, checkIn: record.check_in_time || null, checkOut: record.check_out_time || null };
  if (!record.check_in_time) return { ...base, hasCheckIn: false };
  let d;
  try { d = dayService.computeRecordDay(record, { context: ctx, now }); } catch (_) { return { ...base, hasCheckIn: true, computeError: true }; }
  return {
    ...base, hasCheckIn: true, isOpen: d.isOpen,
    lateMinutes: d.late, earlyLeaveMinutes: d.earlyLeave, overtimeMinutes: d.overtime,
    workedGrossMinutes: d.workedGross, effectiveMinutes: d.effective, breakMinutes: d.break, breakPaidMinutes: d.breakPaid, breakUnpaidMinutes: d.breakUnpaid,
    missionMinutes: d.missionMinutes, flags: d.flags,
  };
}

/**
 * actor: کاربر پنل. userId: کارمند هدف. input: { start? } هر تاریخ داخل هفته (YYYY-MM-DD)؛ پیش‌فرض هفته‌ی جاری.
 * ⇒ { ok:true, user, week, days[7] } یا { ok:false, status, code, error }.
 */
function getWeek(actor, userId, input = {}, { now = new Date(), self = false } = {}) {
  const id = Number(userId);
  const user = Number.isInteger(id) && id > 0 ? usersRepository.findById(id) : null;
  if (!user) return fail(404, 'USER_NOT_FOUND', 'کارمند یافت نشد.');
  // self=true فقط از getMyWeek می‌آید (هدف همیشه خودِ actor)؛ هیچ route ای نباید آن را از ورودی کلاینت بگیرد.
  const selfView = self === true && actor && actor.id === user.id;
  if (!selfView && !canView(actor, user)) return fail(403, 'FORBIDDEN', 'این کارمند خارج از دامنه‌ی دسترسی شماست.');

  const ctx = dayService.loadContext();
  const settings = ctx.settings;
  const today = attendanceRepository.currentRecordDate(user.id, now);

  let anchor = input.start;
  if (anchor === undefined || anchor === null || anchor === '') anchor = today;
  else if (typeof anchor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(anchor) || dayNumber(anchor) === null) return fail(400, 'INVALID_DATE', 'تاریخ نامعتبر است (قالب YYYY-MM-DD).');
  const weekStart = calendarService.weekStartOf(anchor, settings.weekStartDay);
  const dates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const weekEnd = dates[6];

  // کوئری‌های دسته‌ای (هرکدام یک‌بار برای کل هفته)
  const records = attendanceRepository.listByUserAndRange(user.id, weekStart, weekEnd);
  const recordByDate = new Map(records.map((r) => [r.record_date, r]));
  const overrides = userDayScheduleRepository.makeResolver([user.id], weekStart, weekEnd);
  const leaves = leaveRepository.listApprovedInRange([user.id], weekStart, weekEnd);
  const closures = monthClosuresRepository.findClosedOverlapping(weekStart, weekEnd);

  const calCache = new Map(); // تقویم هر روز یک‌بار ساخته می‌شود و برای بخش تسک‌ها هم استفاده می‌شود
  const days = dates.map((date) => {
    const { override, shift, cal, dayLeaves, fullLeave, kind } = resolveDay(user, date, { settings, overrides, leaves });
    calCache.set(date, { working: kind === 'working' || kind === 'half' });
    const attendance = attendanceView(recordByDate.get(date), ctx, now);
    const isFuture = date > today;
    const absent = kind === 'working' || kind === 'half' ? (!isFuture && date !== today && !(attendance && attendance.hasCheckIn)) : false;
    return {
      date,
      jalali: isoDateToJalaliString(date),
      weekday: calendarService.weekdayOf(date),
      isToday: date === today,
      isFuture,
      kind,
      kindLabel: DAY_KIND_LABEL[kind],
      holidayTitle: cal.holidayTitle || null,
      override: override ? { kind: override.kind, startTime: override.start_time, endTime: override.end_time, note: override.note } : null,
      leaves: dayLeaves.map((l) => ({ id: l.id, kind: l.kind === 'mission' ? 'mission' : 'leave', startDate: l.start_date, endDate: l.end_date })),
      schedule: {
        isWorkingDay: cal.isWorkingDay,
        start: cal.expectedStart || null,
        end: cal.expectedEnd || null,
        plannedMinutes: fullLeave ? 0 : plannedMinutes(cal),
        shift: shift ? { id: shift.id, name: shift.name } : null,
      },
      attendance,
      absent,
      monthClosed: closures.some((c) => c.period_from <= date && c.period_to >= date),
    };
  });

  // H5-ب: برای سرپرست (manager/admin دارای زیردست)، تسک واجبِ «بررسی گزارش روز قبل» با باز شدن نمای هفتگی برای روزهای امروز و بعد از آن ساخته می‌شود
  // (idempotent؛ ماه بسته/روز غیرکاری/بدون زیردست ⇒ ساخته نمی‌شود؛ خطا فقط لاگ می‌شود). روزهای گذشته‌ی هفته را برگشتی نمی‌سازیم.
  if (teamReview.isReviewer(user)) {
    const cfg = settingsRepository.getAll();
    for (const date of dates) {
      if (date < today) continue;
      try { teamReview.ensureTask(user, date, cfg); } catch (err) { console.error('[employeeWeek] ساخت تسک واجب ناموفق (نادیده گرفته شد):', err && err.message ? err.message : err); }
    }
  }
  const wk = weekTasks.collect(user, weekStart, dates, { dayInfo: (d) => calCache.get(d) || { working: false }, today });
  days.forEach((d) => {
    d.tasks = wk.tasksByDate.get(d.date) || [];
    // H5-ب: وضعیت پیشرفتِ تسک واجب (x از y مشاهده شد) کنار وضعیت تسک (done/بدون پاسخ)
    teamReviewProgress.decorate(user, d.tasks, today, { settings, dateOf: () => d.date });
    const reviews = wk.reviewsByDate.get(d.date) || [];
    d.review = { reviewed: reviews.length > 0, reviews };
  });

  return {
    ok: true,
    plan: wk.plan,
    summary: summarizeWeek(days, today, settings),
    user: { id: user.id, fullName: user.full_name, department: user.department || null, role: user.role, managerId: user.manager_id || null, isActive: !!user.is_active, shift: (() => { const s = shiftsRepository.shiftOn(user.id, today); return s ? { id: s.id, name: s.name, startTime: s.startTime, endTime: s.endTime } : null; })() },
    week: {
      start: weekStart, end: weekEnd, jalaliStart: isoDateToJalaliString(weekStart), jalaliEnd: isoDateToJalaliString(weekEnd),
      prevWeekStart: addDays(weekStart, -7), nextWeekStart: addDays(weekStart, 7), isCurrentWeek: today >= weekStart && today <= weekEnd, today,
    },
    days,
    readOnly: true,
  };
}

/**
 * M1 («وضعیت من»): هفته‌ی «خودِ» کاربر برای هر نقش (کارمند/سرپرست/hr/ادمین). هویت فقط از actor می‌آید؛ هیچ userId ای از ورودی پذیرفته نمی‌شود.
 * همان خروجی getWeek است (فقط‌خواندنی) با این تفاوت: شناسه‌ی داخلی بازبین در کامنت‌های «مشاهده شد» حذف می‌شود.
 * input: { start? } هر تاریخ داخل هفته (YYYY-MM-DD)؛ پیش‌فرض هفته‌ی جاری.
 */
function getMyWeek(actor, input = {}, opts = {}) {
  if (!actor || !Number.isInteger(actor.id)) return fail(401, 'UNAUTHENTICATED', 'نشست معتبر نیست.');
  const r = getWeek(actor, actor.id, { start: input && input.start }, { ...opts, self: true });
  if (!r.ok) return r;
  r.days.forEach((d) => {
    if (d.review && Array.isArray(d.review.reviews)) d.review.reviews = d.review.reviews.map(({ reviewerId, ...rest }) => rest); // eslint-disable-line no-unused-vars
  });
  r.self = true;
  return r;
}

module.exports = { getWeek, getMyWeek, canView, resolveDay, plannedMinutes, DAY_KIND_LABEL };

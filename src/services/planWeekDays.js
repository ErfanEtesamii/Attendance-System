// B1-a (فاز ۱۳): مدل روزبه‌روزِ «برنامه‌ی هفته» برای نمای برنامه‌ریزی ادمین/سرپرست (دفترچه‌ی هفته‌ی بعد).
// خروجی buildDays برای هر یک از ۷ روز: تاریخ شمسی، نام روز، نوع روز (کاری/نیم‌روز/آف/تعطیل/مرخصی/مأموریت)،
// ساعتِ مؤثرِ برنامه‌ریزی‌شده (override ← شیفت ← سراسری؛ B2) و تسک‌های همان روز؛ تسک‌های بدون تاریخ جدا در anyDay می‌آیند.
// هیچ نوشتنی ندارد. بدون N+1: override و مرخصی‌ها و بسته‌شدن ماه هرکدام با «یک» کوئری برای کل هفته؛ تقویم هر روز یک‌بار (مثل F1).
// summarizePlanWeek (B1-b): خلاصه‌ی هفته از همین خروجی. planWarnings (B1-c): هشدارهای برنامه‌ریزی (فقط اطلاع‌رسانی؛ هیچ عملی را مسدود نمی‌کند).
const leaveRepository = require('../repositories/leaveRepository');
const userDayScheduleRepository = require('../repositories/userDayScheduleRepository');
const monthClosuresRepository = require('../repositories/monthClosuresRepository');
const calendarService = require('../engine/calendarService');
const employeeWeek = require('./employeeWeekService');
const { addDays } = require('../utils/shiftDay');
const { isoDateToJalaliString } = require('../utils/jalali');
const { WEEKDAY_NAMES } = require('../utils/patternRules'); // ۰ = یکشنبه (همان خروجی calendarService.weekdayOf)

// منبع ساعت مؤثر: override روز ← شیفتِ مؤثر ← تنظیمات سراسری (همان اولویت calendarService/B2)
function scheduleSource(override, shift) {
  if (override) return 'override';
  return shift ? 'shift' : 'global';
}

/**
 * @param {object} target ردیف کارمند
 * @param {string} weekStart شروع هفته (YYYY-MM-DD؛ از weekStartDay)
 * @param {Array} tasks تسک‌های نمایش‌داده‌شده (خروجی presentTask + canEdit؛ ترتیب همان ترتیب برنامه)
 * @param {object} settings تنظیمات سراسری (settingsRepository.getAll)
 * @returns {{days: Array, anyDay: Array}}
 *   days[i] = { date, jalali, weekday, kind, kindLabel, holidayTitle, monthClosed, override, leaves, schedule:{isWorkingDay,start,end,plannedMinutes,source,shift}, tasks }
 *   anyDay = تسک‌های بدون تاریخ («هر روز») + هر تسکی که تاریخش بیرون از ۷ روز باشد (داده‌ی ناسازگار؛ گم نمی‌شود).
 */
function buildDays(target, weekStart, tasks, settings) {
  const dates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const weekEnd = dates[6];
  const overrides = userDayScheduleRepository.makeResolver([target.id], weekStart, weekEnd);
  const leaves = leaveRepository.listApprovedInRange([target.id], weekStart, weekEnd);
  const closures = monthClosuresRepository.findClosedOverlapping(weekStart, weekEnd);

  const byDate = new Map(dates.map((d) => [d, []]));
  const anyDay = [];
  for (const t of tasks) {
    if (t.plannedDate && byDate.has(t.plannedDate)) byDate.get(t.plannedDate).push(t);
    else anyDay.push(t);
  }

  const days = dates.map((date) => {
    const { override, shift, cal, dayLeaves, fullLeave, kind } = employeeWeek.resolveDay(target, date, { settings, overrides, leaves });
    return {
      date,
      jalali: isoDateToJalaliString(date),
      weekday: calendarService.weekdayOf(date),
      kind,
      kindLabel: employeeWeek.DAY_KIND_LABEL[kind],
      holidayTitle: cal.holidayTitle || null,
      monthClosed: closures.some((c) => c.period_from <= date && c.period_to >= date),
      override: override ? { kind: override.kind, startTime: override.start_time, endTime: override.end_time, note: override.note } : null,
      leaves: dayLeaves.map((l) => ({ id: l.id, kind: l.kind === 'mission' ? 'mission' : 'leave', startDate: l.start_date, endDate: l.end_date })),
      schedule: {
        isWorkingDay: cal.isWorkingDay,
        start: cal.expectedStart || null,
        end: cal.expectedEnd || null,
        plannedMinutes: fullLeave ? 0 : employeeWeek.plannedMinutes(cal),
        source: scheduleSource(override, shift),
        shift: shift ? { id: shift.id, name: shift.name } : null,
      },
      tasks: byDate.get(date),
    };
  });
  return { days, anyDay };
}

const WORK_KINDS = new Set(['working', 'half']);

/**
 * B1-b (فاز ۱۳): خلاصه‌ی هفته‌ی برنامه‌ریزی‌شده. ورودی = خروجی buildDays (خالص؛ بدون DB).
 *   workingDays: روزهای کاریِ واقعی (کاری + نیم‌روز)؛ روز مرخصی/مأموریتِ کامل جدا شمرده می‌شود و در workingDays نیست.
 *   plannedMinutes/plannedHours: مجموع ساعت مؤثر برنامه‌ریزی‌شده (روز مرخصی/آف/تعطیل صفر است).
 *   tasks: total و تفکیک urgent (اولویت اول) / system / ordinary؛ undated = تسک‌های بدون تاریخ («هر روز»).
 *   days: شمار روزها به‌تفکیک نوع (working, half, off, holiday, leave, mission).
 */
function summarizePlanWeek(days, anyDay) {
  const kinds = { working: 0, half: 0, off: 0, holiday: 0, leave: 0, mission: 0 };
  let plannedMinutes = 0;
  const all = [...anyDay];
  for (const d of days) {
    if (kinds[d.kind] !== undefined) kinds[d.kind] += 1;
    plannedMinutes += d.schedule.plannedMinutes;
    all.push(...d.tasks);
  }
  const tasks = { total: all.length, ordinary: 0, urgent: 0, system: 0, undated: anyDay.filter((t) => !t.plannedDate).length };
  for (const t of all) {
    if (t.isUrgent) tasks.urgent += 1;
    else if (t.isSystem) tasks.system += 1;
    else tasks.ordinary += 1;
  }
  return {
    workingDays: days.filter((d) => WORK_KINDS.has(d.kind)).length,
    plannedMinutes,
    plannedHours: Math.round((plannedMinutes / 60) * 10) / 10,
    tasks,
    days: kinds,
  };
}

// B1-c: بیش از این تعداد تسک (غیرسیستمی) در «یک روز» ⇒ هشدار TOO_MANY_TASKS_IN_DAY (آستانه‌ی ساده و ثابت؛ مسدودسازی نیست)
const MAX_TASKS_PER_DAY = 10;

const OFF_KIND_WARNING = {
  off: { code: 'TASK_ON_OFF_DAY', label: 'روز آف' },
  holiday: { code: 'TASK_ON_HOLIDAY', label: 'روز تعطیل' },
  leave: { code: 'TASK_ON_LEAVE_DAY', label: 'روز مرخصی' },
};

/**
 * B1-c (فاز ۱۳): هشدارهای برنامه‌ریزی (خالص؛ بدون DB؛ ورودی = خروجی buildDays). هیچ‌کدام مسدودکننده نیستند؛ فقط فهرست پیام فارسی با کد پایدار.
 * هر هشدار: { code, severity:'warning', message, date?, jalali?, ... }. ترتیب: هشدارهای سطح برنامه، سپس روزها به ترتیب تاریخ.
 *   PLAN_NOT_SUBMITTED   برنامه ثبت‌نشده (reason: 'missing' = اصلاً برنامه‌ای نیست، 'draft' = پیش‌نویس)
 *   BELOW_MIN_TASKS      تسک‌های معمولی (غیرسیستمی/غیرفوری؛ همان شمارش submit) کمتر از planMinTasks (فقط وقتی min > 0)
 *   TASK_ON_OFF_DAY / TASK_ON_HOLIDAY / TASK_ON_LEAVE_DAY   تسک (غیرسیستمی) روی روز آف / تعطیل / مرخصیِ کامل؛ مأموریت هشدار نمی‌دهد
 *   WORKDAY_WITHOUT_TASK روز کاری/نیم‌روز بدون هیچ تسکِ (غیرسیستمی)؛ تسکِ «هر روز» (بدون تاریخ) همه‌ی روزهای کاری را پوشش می‌دهد
 *   TOO_MANY_TASKS_IN_DAY بیش از MAX_TASKS_PER_DAY تسک (غیرسیستمی) در یک روز
 * تسک سیستمی (مثل مرور گزارش تیم) خودکار ساخته می‌شود و مدیر نمی‌تواند آن را جابه‌جا کند؛ پس در هشدارهای روز شمرده نمی‌شود.
 * @param {{status: string|null, hasPlan: boolean, minTasks: number}} planInfo hasPlan=false ⇒ برنامه‌ای برای هفته نیست
 */
function planWarnings(days, anyDay, { hasPlan, status, minTasks }) {
  const out = [];
  const real = (list) => list.filter((t) => !t.isSystem);
  const where = (d) => ({ date: d.date, jalali: d.jalali, weekday: d.weekday });
  const label = (d) => `${WEEKDAY_NAMES[d.weekday]} ${d.jalali}`;

  if (!hasPlan || status !== 'submitted') {
    out.push({
      code: 'PLAN_NOT_SUBMITTED', severity: 'warning', reason: hasPlan ? 'draft' : 'missing',
      message: hasPlan ? 'برنامه‌ی این هفته هنوز توسط کارمند ثبت نهایی نشده است (پیش‌نویس).' : 'برای این هفته هنوز برنامه‌ای ثبت نشده است.',
    });
  }

  const ordinary = [...anyDay, ...days.flatMap((d) => d.tasks)].filter((t) => !t.isSystem && !t.isUrgent).length;
  const min = Math.max(0, Number(minTasks) || 0);
  if (min > 0 && ordinary < min) {
    out.push({
      code: 'BELOW_MIN_TASKS', severity: 'warning', count: ordinary, min,
      message: `تعداد تسک‌های برنامه (${ordinary}) کمتر از حداقل تعیین‌شده (${min}) است.`,
    });
  }

  const anyDayCovers = real(anyDay).length > 0;
  for (const d of days) {
    const tasks = real(d.tasks);
    const offWarn = OFF_KIND_WARNING[d.kind];
    if (offWarn && tasks.length) {
      out.push({
        code: offWarn.code, severity: 'warning', ...where(d), count: tasks.length, taskIds: tasks.map((t) => t.id),
        message: `${tasks.length} تسک روی ${offWarn.label} (${label(d)}) برنامه‌ریزی شده است.`,
      });
    }
    if (WORK_KINDS.has(d.kind) && !tasks.length && !anyDayCovers) {
      out.push({ code: 'WORKDAY_WITHOUT_TASK', severity: 'warning', ...where(d), message: `برای روز کاری ${label(d)} هیچ تسکی ثبت نشده است.` });
    }
    if (tasks.length > MAX_TASKS_PER_DAY) {
      out.push({
        code: 'TOO_MANY_TASKS_IN_DAY', severity: 'warning', ...where(d), count: tasks.length, max: MAX_TASKS_PER_DAY,
        message: `${tasks.length} تسک در ${label(d)} ثبت شده است (بیش از ${MAX_TASKS_PER_DAY} تسک در یک روز).`,
      });
    }
  }
  return out;
}

module.exports = { buildDays, summarizePlanWeek, planWarnings, MAX_TASKS_PER_DAY };

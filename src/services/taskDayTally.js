// H1 (فاز ۱۵): تنها منبعِ شمارشِ «وضعیت تسک‌های یک عضو در یک روز» — مشترک بین پیام تلگرام (nightlyTaskReportService)،
// خلاصه‌ی صبحگاهی و صفحه‌ی «گزارش‌های تیم» (teamReportsService.dailyRow) تا عددِ پنل و تلگرام همیشه برابر باشد.
// قاعده‌ی total (هم‌راستا با employeeWeekSummary.summarizeWeek و progressOf در B1):
//   total = تسک‌های برنامه‌ایِ «پاسخ‌داده‌شده» + تسک‌های «پاسخ‌نداده‌ی الزامی» (buildList بدون اختیاری/low).
//   تسک سیستمی، «خارج از برنامه» و حذف‌شده (drop) در total نمی‌آید.
// خالص و فقط‌خواندنی؛ null فقط وقتی که آن روز برای عضو غیرکاری/مرخصیِ تمام‌روز است.
const plansRepo = require('../repositories/weeklyPlanRepository');
const logsRepo = require('../repositories/taskLogRepository');
const calendarService = require('../engine/calendarService');
const taskReportService = require('./taskReportService');
const { REASON_LABELS } = require('../content/reportLabels');
const { isoDateToJalaliString } = require('../utils/jalali');

const OUT_OF_PLAN_KEY = 'out_of_plan';
const DROP = 'drop';

const jd = (iso) => { try { return isoDateToJalaliString(iso) || iso; } catch (_) { return iso; } };

/**
 * @returns {null | {
 *   total:number, done:number, partial:number, notDoneCount:number, pendingCount:number, percent:number|null,
 *   notDone:Array<{title,status,reason,reasonCode,reasonText,carry}>, dropped:Array<{title,reason,carry}>,
 *   pending:Array<{title,priority,isUrgent}>, extra:number, extras:string[], noteCount:number,
 *   hasReport:boolean, relevant:boolean }}
 */
function taskDayTally(member, date, settings) {
  const cal = calendarService.getCalendarDay(member, date, { settings });
  if (!cal.isWorkingDay || calendarService.fullyOnApprovedLeave(member, date, cal)) return null;

  const logs = logsRepo.listByUserDate(member.id, date);
  const items = [];
  for (const l of logs) {
    const t = plansRepo.findTask(l.task_id);
    if (t) items.push({ log: l, task: t });
  }
  const isPlanned = (i) => i.task.system_key !== OUT_OF_PLAN_KEY && !i.task.is_system;
  const planned = items.filter(isPlanned);
  const dropped = planned.filter((i) => i.log.reschedule_to === DROP);
  const counted = planned.filter((i) => i.log.reschedule_to !== DROP);
  const done = counted.filter((i) => i.log.status === 'done').length;
  const partial = counted.filter((i) => i.log.status === 'partial').length;
  const carryOf = (l) => (l.reschedule_to === DROP ? 'حذف شد' : (l.reschedule_to ? `منتقل به ${jd(l.reschedule_to)}` : 'بدون انتقال'));
  const reasonOf = (l) => (l.reason_code ? (REASON_LABELS[l.reason_code] || l.reason_code) : null);
  const notDone = counted.filter((i) => i.log.status !== 'done').map((i) => ({
    title: i.task.title, status: i.log.status, reason: reasonOf(i.log), reasonCode: i.log.reason_code || null, reasonText: i.log.reason_text || null, carry: carryOf(i.log),
  }));

  const pending = taskReportService.buildList(member, date, settings)
    .filter((t) => !t.optional && !t.isSystem && !t.outOfPlan)
    .map((t) => ({ title: t.title, priority: t.priority, isUrgent: !!t.isUrgent }));

  const total = counted.length + pending.length;
  return {
    total, done, partial, notDoneCount: counted.length - done, // نیمه‌کاره + انجام‌نشده (پاسخ‌داده‌شده و done نشده)
    pendingCount: pending.length,
    percent: total ? Math.round((done / total) * 100) : null,
    notDone,
    dropped: dropped.map((i) => ({ title: i.task.title, reason: reasonOf(i.log), carry: 'حذف شد' })),
    pending,
    extra: items.filter((i) => i.task.system_key === OUT_OF_PLAN_KEY).length,
    extras: items.filter((i) => i.task.system_key === OUT_OF_PLAN_KEY).map((i) => i.task.title),
    noteCount: logs.filter((l) => l.note && String(l.note).trim()).length,
    hasReport: logs.length > 0,
    relevant: logs.length > 0 || pending.length > 0,
  };
}

module.exports = { taskDayTally };

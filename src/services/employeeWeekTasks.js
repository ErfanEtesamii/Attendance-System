// F1-b (فاز ۱۲): بخش «برنامه و تسک‌ها»ی نمای هفتگی کارمند (فقط‌خواندنی؛ بدون تغییر هیچ داده).
// قاعده‌ی حضور تسک در یک روز، همان buildList (taskReportService) ولی برای «روزِ دلخواه و تاریخچه»:
//   ۱) تسک با planned_date = همان روز  ۲) تسک بدون تاریخ («هرروزه») تا وقتی done/drop/منتقل‌به‌آینده نشده (فقط روز کاری و تا امروز)
//   ۳) تسکی که پاسخ قبلی آن را به همین روز منتقل کرده (از هر هفته)  ۴) هر تسکی که در همان روز پاسخ دارد (حتی «خارج از برنامه» یا حذف‌شده‌ی بعدی).
// کوئری‌ها دسته‌ای‌اند: برنامه، تسک‌ها، پاسخ‌های هفته، انتقال‌های ورودی، آخرین پاسخ‌های پیش از هفته، «مشاهده شد»ها — مستقل از تعداد روز/تسک.
const plansRepo = require('../repositories/weeklyPlanRepository');
const logsRepo = require('../repositories/taskLogRepository');
const reviewsRepo = require('../repositories/reportReviewRepository');

const DROP = 'drop';
const PRIORITY_RANK = { high: 0, normal: 1, low: 2 };

// ردیف تسک (از plan_tasks یا ستون‌های task_* کوئری‌های پاسخ) را به شکل یکسان درمی‌آورد
function fromTaskRow(t) {
  return {
    id: t.id, title: t.title, description: t.description || null, priority: t.priority, isUrgent: !!t.is_urgent, urgentNote: t.urgent_note || null,
    scheduledStartTime: t.scheduled_start_time || null, urgentDeadlineTime: t.urgent_deadline_time || null, assignedBy: t.assigned_by_name || null, isSystem: !!t.is_system, systemKey: t.system_key || null,
    plannedDate: t.planned_date || null, sortOrder: t.sort_order || 0, deleted: !!t.deleted_at, carriedFrom: t.carried_from_task_id || null,
    assignedByUserId: t.assigned_by_user_id || null, managerLocked: !!t.manager_locked, // B1 (فاز ۱۵)
  };
}
function fromLogRow(l) {
  return {
    id: l.task_id, title: l.task_title, description: l.task_description || null, priority: l.task_priority, isUrgent: !!l.task_is_urgent, urgentNote: l.task_urgent_note || null,
    scheduledStartTime: l.task_scheduled_start_time || null, urgentDeadlineTime: l.task_urgent_deadline_time || null, assignedBy: l.task_assigned_by_name || null, isSystem: !!l.task_is_system, systemKey: l.task_system_key || null,
    plannedDate: l.task_planned_date || null, sortOrder: l.task_sort_order || 0, deleted: !!l.task_deleted_at, carriedFrom: l.task_carried_from || null,
    assignedByUserId: l.task_assigned_by || null, managerLocked: !!l.task_manager_locked, // B1 (فاز ۱۵)
  };
}

function view(task, source, log, ownerId) {
  const answered = !!log;
  return {
    taskId: task.id, title: task.title, description: task.description, priority: task.priority,
    isUrgent: task.isUrgent, urgentNote: task.urgentNote, scheduledStartTime: task.scheduledStartTime, urgentDeadlineTime: task.urgentDeadlineTime, assignedBy: task.assignedBy,
    isSystem: task.isSystem, systemKey: task.systemKey, outOfPlan: task.systemKey === 'out_of_plan', carriedFrom: task.carriedFrom,
    assignedByUserId: task.assignedByUserId, managerLocked: task.managerLocked, plannedDate: task.plannedDate, // B1 (فاز ۱۵)
    selfAssigned: !!task.isUrgent && task.assignedByUserId != null && task.assignedByUserId === ownerId, // F1: «⚡ فوری (خودش)» در برابر «توسط X»
    source, // planned | everyday | rescheduled | answered_only
    status: answered ? log.status : 'no_answer', // done | partial | not_done | no_answer
    reasonCode: answered ? log.reason_code || null : null,
    reasonText: answered ? log.reason_text || null : null,
    rescheduleTo: answered && log.reschedule_to && log.reschedule_to !== DROP ? log.reschedule_to : null,
    dropped: answered && log.reschedule_to === DROP,
    answeredLate: answered ? !!log.answered_late : false,
    answeredAt: answered ? log.answered_at : null,
    note: answered ? log.note || null : null, // B1 (فاز ۱۵): توضیحِ انجام (A1)
  };
}

const sortTasks = (a, b) => (Number(b.isUrgent) - Number(a.isUrgent)) || (PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]) || (a.taskId - b.taskId);

/**
 * user: کارمند؛ weekStart/dates: هفته (۷ تاریخ)؛ dayInfo(date) ⇒ { working: bool } ؛ today: روز جاری کارمند.
 * ⇒ { plan, tasksByDate: Map(date → task[]), reviewsByDate: Map(date → review[]) }
 */
function collect(user, weekStart, dates, { dayInfo, today }) {
  const weekEnd = dates[dates.length - 1];
  const plan = plansRepo.findByUserWeek(user.id, weekStart);
  const planTasks = plan ? plansRepo.listTasks(plan.id, { includeDeleted: true }).map(fromTaskRow) : [];
  const weekLogs = logsRepo.listRangeDetailed(user.id, weekStart, weekEnd);
  const incoming = logsRepo.listRescheduledIntoRange(user.id, weekStart, weekEnd);
  const lastBefore = logsRepo.listLastLogsBefore(user.id, weekStart);

  const info = new Map(planTasks.map((t) => [t.id, t]));
  for (const l of [...weekLogs, ...incoming]) if (!info.has(l.task_id)) info.set(l.task_id, fromLogRow(l));

  const logsByTask = new Map(); // taskId → [log] (صعودی)
  const pushLog = (l) => { if (!logsByTask.has(l.task_id)) logsByTask.set(l.task_id, []); logsByTask.get(l.task_id).push(l); };
  lastBefore.forEach(pushLog);
  weekLogs.forEach(pushLog);
  const logOn = (taskId, date) => (logsByTask.get(taskId) || []).find((l) => l.log_date === date) || null;
  const lastLogBefore = (taskId, date) => { const arr = (logsByTask.get(taskId) || []).filter((l) => l.log_date < date); return arr.length ? arr[arr.length - 1] : null; };

  const tasksByDate = new Map();
  for (const date of dates) {
    const picked = new Map();
    const add = (task, source) => { if (task && !picked.has(task.id)) picked.set(task.id, { task, source }); };
    for (const t of planTasks) {
      if (t.deleted) continue;
      if (t.plannedDate) { if (t.plannedDate === date) add(t, 'planned'); continue; }
      if (date > today || !dayInfo(date).working) continue; // «هرروزه»: فقط روز کاریِ گذشته/امروز
      const last = lastLogBefore(t.id, date);
      if (!last || !(last.status === 'done' || last.reschedule_to === DROP || (last.reschedule_to && last.reschedule_to > date))) add(t, 'everyday');
    }
    for (const l of incoming) {
      if (l.reschedule_to !== date) continue;
      const t = info.get(l.task_id);
      if (!t || t.deleted) continue;
      const prior = lastLogBefore(t.id, date);
      if (prior && prior.status === 'done') continue;
      add(t, 'rescheduled');
    }
    for (const l of weekLogs) if (l.log_date === date) add(info.get(l.task_id), 'answered_only'); // پاسخ‌دار ولی در سه قاعده‌ی بالا نبود (مثل «خارج از برنامه»)
    tasksByDate.set(date, [...picked.values()].map(({ task, source }) => view(task, source, logOn(task.id, date), user.id)).sort(sortTasks));
  }

  const reviewsByDate = new Map();
  for (const r of reviewsRepo.listBySubjectRange(user.id, weekStart, weekEnd)) {
    if (!reviewsByDate.has(r.report_date)) reviewsByDate.set(r.report_date, []);
    reviewsByDate.get(r.report_date).push({ reviewerId: r.reviewer_id, reviewerName: r.reviewer_name || null, reviewedAt: r.reviewed_at, comment: r.comment || null, reaction: r.reaction || null });
  }

  return {
    plan: plan ? {
      id: plan.id, status: plan.status, submittedAt: plan.submitted_at || null, supervisorSeenAt: plan.supervisor_seen_at || null,
      supervisorComment: plan.supervisor_comment || null,
    } : null,
    tasksByDate, reviewsByDate,
  };
}

module.exports = { collect };

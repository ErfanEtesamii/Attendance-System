// A2 (فاز ۱۳): API برنامه‌ی هفتگی کارمند برای ادمین/سرپرست. منطق و اسکوپ در services/weeklyPlanAdminService.
// بخش A2-۱ (این فایل فعلاً):
//   GET /admin/users/:id/plan?start=YYYY-MM-DD   team.week_view (admin/hr همه، سرپرست فقط کارمندان مستقیمش؛ کارمند ممنوع)
//     start = هر تاریخ داخل هفته (پیش‌فرض: هفته‌ی بعد). فقط‌خواندنی؛ برنامه‌ی ناموجود ساخته نمی‌شود.
//     ⇒ { ok, employee, weekStart, weekEnd, isNextWeek, plan: { id, status, version, updatedAt, submittedAt, supervisorComment, editable, lockReason, minTasks, maxTasks }, tasks: [...] }
//     B1-a: + plan.unnotifiedChanges / plan.unnotified{added,edited,removed}، days[7] (date, jalali, weekday, kind, kindLabel, holidayTitle, monthClosed, override, leaves,
//     schedule{isWorkingDay,start,end,plannedMinutes,source:override|shift|global,shift}, tasks[] با canEdit) و anyDay[] (تسک‌های «هر روز»). tasks (فهرست تخت) برای سازگاری می‌ماند.
//     B1-b: summary { workingDays, plannedMinutes, plannedHours, tasks:{total,ordinary,urgent,system,undated}, days:{working,half,off,holiday,leave,mission} }.
//     B1-c: warnings[] { code, severity:'warning', message (فارسی), date?, jalali?, weekday?, count?, ... } — فقط اطلاع‌رسانی، هیچ عملی مسدود نمی‌شود.
//     کدها: PLAN_NOT_SUBMITTED, BELOW_MIN_TASKS, TASK_ON_OFF_DAY, TASK_ON_HOLIDAY, TASK_ON_LEAVE_DAY, WORKDAY_WITHOUT_TASK, TOO_MANY_TASKS_IN_DAY (plan.maxTasksPerDay = ۱۰).
// بخش A2-۲ (نوشتن؛ همه با plan.edit_team؛ اسکوپ/قفل/اعتبارسنجی در سرویس):
//   POST   /admin/users/:id/plan/tasks     { weekStart?, title, description?, plannedDate?, priority? } ⇒ ۲۰۱ وضعیت تازه + task
//   PATCH  /admin/plan-tasks/:taskId       { title?, description?, plannedDate? (null = «هر روز»), priority? } ⇒ وضعیت تازه + task
//   DELETE /admin/plan-tasks/:taskId       ⇒ وضعیت تازه + task (تسکِ حذف‌شده؛ soft delete)
//   POST   /admin/users/:id/plan/reorder   { weekStart?, order: [taskId, ...] } ⇒ وضعیت تازه
//   پاسخ همه = خروجی GET بالا + changed (false وقتی چیزی عوض نشده). خطاها: { error, code } با status سرویس (۴۰۳/۴۰۴/۴۰۹/۴۰۰).
// بخش A2-۳ (همزمانی): همه‌ی endpointهای نوشتن expectedVersion می‌گیرند (در body؛ برای DELETE در body یا query).
//   مقدار = plan.version که UI آخرین‌بار دیده (null = برنامه‌ای وجود نداشت). نبودنِ آن ⇒ بدون بررسی.
//   نسخه‌ی کهنه ⇒ ۴۰۹ { code: 'PLAN_CONFLICT', error: 'برنامه در این فاصله تغییر کرده؛ صفحه را تازه کنید.' }؛ نسخه‌ی نامعتبر ⇒ ۴۰۰ INVALID_VERSION.
// بخش A2-۴ (audit): هر تغییرِ واقعی (changed=true) یک رکورد weekly_plan_edited_by_manager با قالب استاندارد logChange می‌نویسد
//   (changes = { فیلد: { before, after } } فقط برای فیلدهای تغییرکرده). شکست در ثبت audit تغییر را برنمی‌گرداند (فقط لاگ می‌شود).
//   entityType=weekly_plan_task / entityId=taskId برای add|update|remove؛ entityType=weekly_plan / entityId=planId برای reorder
//   (before/after = { order: [taskId, ...] }). meta برای A2-۵ و جستجو: { op: add|update|remove|reorder, targetUserId, planId, weekStart, taskId? }.
//   no-op (changed=false) و خطاها audit نمی‌نویسند.
// بخش A2-۵ (اعلان تجمیعی دستی): POST /admin/users/:id/plan/notify  { weekStart? }  (plan.edit_team؛ همان اسکوپ ویرایش)
//   تغییر درجا هیچ اعلانی نمی‌فرستد. این endpoint یک اعلان (پنل + تلگرام) با شمارِ «خالصِ» تغییرهای بعد از آخرین اعلان می‌فرستد
//   (service.pendingNotify از audit A2-۴؛ reorder شمرده نمی‌شود) و سپس رکورد weekly_plan_manager_notified
//   (meta.upToAuditId) را می‌نویسد؛ همین رکورد شمارنده را صفر می‌کند (بدون migration).
//   ⇒ ۲۰۰ { ok, notified, summary: {added, edited, removed}, ...getPlanState }؛ notified=false یعنی درخواستِ هم‌زمان/تکراری از قبل اعلان را ساخته بود.
//   بدون تغییرِ اطلاع‌داده‌نشده ⇒ ۴۰۹ NOTHING_TO_NOTIFY؛ شکستِ اعلان ⇒ ۵۰۲ NOTIFY_FAILED (شمارنده صفر نمی‌شود تا دوباره قابل‌تلاش باشد).
//   شکست اعلان هیچ‌وقت تغییرهای ثبت‌شده را برنمی‌گرداند (تغییرها قبل‌تر ذخیره شده‌اند).
const express = require('express');
const { requirePermission } = require('../../../middleware/permissions');
const service = require('../../../services/weeklyPlanAdminService');
const { auditChange } = require('./common');
const { planTaskView } = require('../../../utils/auditViews');
const notificationEvents = require('../../../services/notificationEvents');

const router = express.Router();

router.get('/admin/users/:id/plan', requirePermission('team.week_view'), (req, res) => {
  const r = service.getPlanState(req.adminUser, req.params.id, req.query.start);
  if (!r.ok) return res.status(r.status).json({ error: r.error, code: r.code });
  return res.json(r);
});

// D1: فهرست کارمندان قابل‌مشاهده با وضعیت برنامه‌ی هفته (ستون انتخاب کارمند). ثبت قبل از مسیرهای /admin/users/:id/... لازم نیست (URL جدا).
//   GET /admin/plan-overview?start=YYYY-MM-DD  team.week_view ⇒ { ok, weekStart, weekEnd, jalaliStart, jalaliEnd, isNextWeek, minTasks, employees:[{id, fullName, department, role, planStatus: submitted|draft|none, taskCount, needsAttention}] }
router.get('/admin/plan-overview', requirePermission('team.week_view'), (req, res) => {
  const r = service.listPlanOverview(req.adminUser, req.query.start);
  if (!r.ok) return res.status(r.status).json({ error: r.error, code: r.code });
  return res.json(r);
});

const isId = (v) => /^\d+$/.test(String(v));
const bodyOf = (req) => (req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {});
const send = (res, r, okStatus = 200) => (r.ok ? res.status(okStatus).json(r) : res.status(r.status || 400).json({ error: r.error, code: r.code }));
// expectedVersion از body (و برای DELETE از query)؛ undefined یعنی «نفرستاده» ⇒ بدون بررسی همزمانی.
const versionOf = (req) => {
  const b = bodyOf(req);
  if (b.expectedVersion !== undefined) return b.expectedVersion;
  return req.query && req.query.expectedVersion !== undefined ? req.query.expectedVersion : undefined;
};

const AUDIT_ACTION = 'weekly_plan_edited_by_manager';
/**
 * ثبت audit یک عملیات موفق سرویس (r = خروجی خامِ add/update/remove/reorder، پیش از withState).
 * op: add | update | remove | reorder. فقط وقتی r.ok و r.changed. هیچ‌وقت استثنا پرتاب نمی‌کند.
 */
function auditPlanEdit(req, op, employeeId, r) {
  if (!r || !r.ok || !r.changed) return;
  try {
    const meta = { op, targetUserId: Number(employeeId), planId: r.plan.id, weekStart: r.plan.weekStart };
    if (r.plan.weekStart <= new Date().toISOString().slice(0, 10)) meta.retroactive = true; // ویرایش هفته‌ی شروع‌شده (فقط ادمین)
    if (op === 'reorder') {
      auditChange(req, {
        action: AUDIT_ACTION, entityType: 'weekly_plan', entityId: r.plan.id,
        before: { order: r.before }, after: { order: r.order }, meta,
      });
      return;
    }
    auditChange(req, {
      action: AUDIT_ACTION, entityType: 'weekly_plan_task', entityId: r.task.id,
      before: op === 'add' ? null : planTaskView(r.before),
      after: op === 'remove' ? null : planTaskView(r.after),
      meta: { ...meta, taskId: r.task.id },
    });
  } catch (err) {
    console.error('[employeePlan] audit ناموفق (نادیده گرفته شد):', err.message);
  }
}

const badId = (res) => res.status(400).json({ error: 'شناسه نامعتبر است.', code: 'INVALID_ID' });

router.post('/admin/users/:id/plan/tasks', requirePermission('plan.edit_team'), (req, res) => {
  if (!isId(req.params.id)) return badId(res);
  const b = bodyOf(req);
  const r = service.addTask(req.adminUser, req.params.id, b.weekStart, b, { expectedVersion: versionOf(req) });
  auditPlanEdit(req, 'add', req.params.id, r);
  return send(res, service.withState(req.adminUser, req.params.id, r), 201);
});

router.patch('/admin/plan-tasks/:taskId', requirePermission('plan.edit_team'), (req, res) => {
  if (!isId(req.params.taskId)) return badId(res);
  const ownerId = service.taskOwnerId(req.params.taskId);
  if (!ownerId) return res.status(404).json({ error: 'تسک یافت نشد.', code: 'TASK_NOT_FOUND' });
  const r = service.updateTask(req.adminUser, ownerId, req.params.taskId, bodyOf(req), { expectedVersion: versionOf(req) });
  auditPlanEdit(req, 'update', ownerId, r);
  return send(res, service.withState(req.adminUser, ownerId, r));
});

router.delete('/admin/plan-tasks/:taskId', requirePermission('plan.edit_team'), (req, res) => {
  if (!isId(req.params.taskId)) return badId(res);
  const ownerId = service.taskOwnerId(req.params.taskId);
  if (!ownerId) return res.status(404).json({ error: 'تسک یافت نشد.', code: 'TASK_NOT_FOUND' });
  const r = service.removeTask(req.adminUser, ownerId, req.params.taskId, { expectedVersion: versionOf(req) });
  auditPlanEdit(req, 'remove', ownerId, r);
  return send(res, service.withState(req.adminUser, ownerId, r));
});

router.post('/admin/users/:id/plan/reorder', requirePermission('plan.edit_team'), (req, res) => {
  if (!isId(req.params.id)) return badId(res);
  const b = bodyOf(req);
  const r = service.reorderTasks(req.adminUser, req.params.id, b.weekStart, b.order, { expectedVersion: versionOf(req) });
  auditPlanEdit(req, 'reorder', req.params.id, r);
  return send(res, service.withState(req.adminUser, req.params.id, r));
});

/** رکوردِ «اعلان شد» (شمارنده را صفر می‌کند). استثنا پرتاب نمی‌کند؛ شکستش فقط لاگ می‌شود (اعلان قبلاً رفته است). */
function auditNotified(req, employeeId, plan, summary) {
  try {
    auditChange(req, {
      action: service.AUDIT_NOTIFY_ACTION, entityType: 'weekly_plan', entityId: plan.id,
      before: null, after: { added: summary.added, edited: summary.edited, removed: summary.removed },
      meta: {
        op: 'notify', targetUserId: Number(employeeId), planId: plan.id, weekStart: plan.week_start_date,
        upToAuditId: summary.upToAuditId, added: summary.added, edited: summary.edited, removed: summary.removed,
      },
    });
  } catch (err) {
    console.error('[employeePlan] audit اعلان ناموفق (نادیده گرفته شد):', err.message);
  }
}

router.post('/admin/users/:id/plan/notify', requirePermission('plan.edit_team'), async (req, res) => {
  if (!isId(req.params.id)) return badId(res);
  const p = service.pendingNotify(req.adminUser, req.params.id, bodyOf(req).weekStart);
  if (!p.ok) return send(res, p);

  let results = [];
  try {
    results = await notificationEvents.weeklyPlanEditedByManager(p.target, req.adminUser, p.plan, p.summary);
  } catch (err) {
    console.error('[employeePlan] اعلان ناموفق:', err.message);
  }
  if (!results.length) return res.status(502).json({ error: 'ارسال اعلان به کارمند ناموفق بود؛ دوباره تلاش کنید.', code: 'NOTIFY_FAILED' });

  auditNotified(req, req.params.id, p.plan, p.summary); // حتی اگر اعلان تکراری بود: upToAuditId یکسان است و بی‌ضرر
  const { added, edited, removed } = p.summary;
  const state = service.getPlanState(req.adminUser, req.params.id, p.plan.week_start_date);
  if (!state.ok) return send(res, state);
  return res.json({ ...state, notified: results.some((r) => r && r.created), summary: { added, edited, removed } });
});

// E3: یادداشت سرپرست روی برنامه‌ی هفته (reviews.write؛ اسکوپ مثل ویرایش: سرپرست فقط کارمند مستقیمش و نه خودش، admin همه).
//   PUT /admin/users/:id/plan/supervisor-comment  { weekStart?, comment }  (comment خالی ⇒ پاک شدن؛ ≤ ۵۰۰ نویسه)
//   ⇒ ۲۰۰ وضعیت تازه‌ی برنامه (+ changed). قفل هفته/ماه ندارد (در هفته‌ی شروع‌شده هم مجاز است). audit: weekly_plan_supervisor_comment با قبل/بعد.
function auditSupervisorComment(req, employeeId, r) {
  if (!r || !r.ok || !r.changed || !r.plan.id) return;
  try {
    auditChange(req, {
      action: 'weekly_plan_supervisor_comment', entityType: 'weekly_plan', entityId: r.plan.id,
      before: { comment: r.before }, after: { comment: r.after },
      meta: { op: 'supervisor_comment', targetUserId: Number(employeeId), planId: r.plan.id, weekStart: r.plan.weekStart },
    });
  } catch (err) {
    console.error('[employeePlan] audit یادداشت ناموفق (نادیده گرفته شد):', err.message);
  }
}

router.put('/admin/users/:id/plan/supervisor-comment', requirePermission('reviews.write'), (req, res) => {
  if (!isId(req.params.id)) return badId(res);
  const b = bodyOf(req);
  const r = service.setSupervisorComment(req.adminUser, req.params.id, b.weekStart, b.comment);
  auditSupervisorComment(req, req.params.id, r);
  return send(res, service.withState(req.adminUser, req.params.id, r));
});

module.exports = router;

// M3 («وضعیت من»): تیک‌زدن تسک‌های «خودِ» کاربر از داخل پنل — برای همه‌ی نقش‌ها (me.read). همان منطق و قوانین Mini App (taskReportService)،
// از طریق panelTasksService. ⚠️ اسکوپ: همه‌چیز فقط با req.adminUser؛ هیچ پارامتر/فیلد userId پذیرفته نمی‌شود (مالکیت پاسخ‌ها در سرویس چک می‌شود).
//   GET   /admin/me/tasks/today?date=      فهرست امروز (date اختیاری: گزارش دیرهنگام؛ اعتبارسنجی کامل در resolveReportDate)
//   GET   /admin/me/tasks/backfill         روزهای قابل تکمیل دیرهنگام
//   GET   /admin/me/tasks/pending-count    M4: تعداد تسک‌های بی‌پاسخ امروز (برای نشان منو)
//   POST  /admin/me/tasks/answer           { taskId, status: done|partial|not_done, reasonCode?, reasonText?, note?, date? }
//   POST  /admin/me/tasks/undo             { taskId, date? }
//   PATCH /admin/me/tasks/note             { taskId, date?, note }
// audit: همان رویدادهای Mini App با source: 'panel'. تسک سیستمی/واجب فقط‌خواندنی است (SYSTEM_TASK_READONLY ⇒ ۴۰۳).
const express = require('express');
const { requirePermission } = require('../../../middleware/permissions');
const { createRateLimiter } = require('../../../middleware/rateLimiter');
const service = require('../../../services/panelTasksService');
const auditRepository = require('../../../repositories/auditRepository');
const { statusOfReportError } = require('../../../utils/reportErrors');

const router = express.Router();

// مثل miniAppTasksLimiter؛ کلید = شناسه‌ی کاربرِ نشست (نه IP)
router.use('/admin/me/tasks', createRateLimiter({
  name: 'panel-tasks',
  windowMs: 60 * 1000,
  max: 60,
  message: 'تعداد درخواست‌های تسک بیش از حد مجاز است. لطفاً کمی صبر کنید.',
  keyFn: (req) => `panel-tasks:${req.adminUser ? req.adminUser.id : req.ip}`,
}));

const send = (res, r) => (r.ok ? res.json(r) : res.status(statusOfReportError(r.code)).json({ error: r.error, code: r.code }));
const queryDate = (req) => req.query.date; // نوع/قالب را resolveReportDate بررسی می‌کند (آرایه/آبجکت ⇒ INVALID_DATE)

router.get('/admin/me/tasks/today', requirePermission('me.read'), (req, res) => send(res, service.getToday(req.adminUser, { date: queryDate(req) })));

router.get('/admin/me/tasks/backfill', requirePermission('me.read'), (req, res) => res.json(service.getBackfill(req.adminUser)));

router.get('/admin/me/tasks/pending-count', requirePermission('me.read'), (req, res) => res.json(service.pendingCount(req.adminUser)));

router.post('/admin/me/tasks/answer', requirePermission('me.read'), (req, res) => {
  const r = service.answer(req.adminUser, req.body);
  if (!r.ok) return send(res, r);
  // مثل Mini App: فقط پاسخ دیرهنگام یا همراه با انتقال در audit می‌آید (متن علت/توضیح ثبت نمی‌شود)
  if (r.late || r.rescheduled.length) {
    auditRepository.logEvent({ userId: req.adminUser.id, action: 'daily_report_submitted', ipAddress: req.ip, details: { source: 'panel', mode: r.source, date: r.date, late: !!r.late, answers: r.saved.answers, extra: r.saved.extra, reschedules: r.rescheduled } });
  }
  return res.json(r);
});

router.post('/admin/me/tasks/undo', requirePermission('me.read'), (req, res) => {
  const r = service.undo(req.adminUser, req.body);
  if (!r.ok) return send(res, r);
  auditRepository.logEvent({ userId: req.adminUser.id, action: 'task_answer_undone', ipAddress: req.ip, details: { source: 'panel', taskId: r.undone.taskId, date: r.undone.date, previousStatus: r.undone.previousStatus, outOfPlan: r.undone.outOfPlan } });
  return res.json(r);
});

router.patch('/admin/me/tasks/note', requirePermission('me.read'), (req, res) => {
  const r = service.note(req.adminUser, req.body);
  if (!r.ok) return send(res, r);
  auditRepository.logEvent({ userId: req.adminUser.id, action: 'task_done_note_edited', ipAddress: req.ip, details: { source: 'panel', taskId: r.taskId, date: r.date, cleared: r.cleared } });
  return res.json(r);
});

module.exports = router;

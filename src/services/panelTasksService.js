// M3 («وضعیت من»): تیک‌زدن تسک‌های امروز از داخل پنل. لایه‌ی نازک روی taskReportService (همان منطق Mini App، بدون کپی):
//   • مالکیت فقط از `user` (= req.adminUser)؛ هیچ شناسه‌ی کاربری از کلاینت پذیرفته نمی‌شود.
//   • تاریخ فقط با resolveReportDate (درون taskReportService) تعیین می‌شود: امروز، گزارش دیرهنگام/backfill، ماه بسته، روز آینده، ...
//   • تسک سیستمی/واجب (is_system؛ مثل «بررسی گزارش تیم») از پنل فقط‌خواندنی است: پاسخ/واگرد/توضیح ⇒ SYSTEM_TASK_READONLY.
//   • پاسخ تکی؛ «انتقال» (reschedule) و «کار خارج از برنامه» (extra) در پنل نیست (فقط Mini App) — فیلدهای اضافه در بدنه نادیده گرفته می‌شوند.
const taskReportService = require('./taskReportService');
const plansRepo = require('../repositories/weeklyPlanRepository');
const logsRepo = require('../repositories/taskLogRepository');

const fail = (code, error) => ({ ok: false, code, error });
const READONLY_MSG = 'تسک سیستمی/واجب از پنل قابل تغییر نیست؛ وضعیت آن به‌صورت خودکار یا در Mini App ثبت می‌شود.';

const toId = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };

/** GET /admin/me/tasks/today?date= — فهرست تسک‌های «امروز» (یا روزِ گزارش دیرهنگام) برای خودِ کاربر. */
function getToday(user, { date } = {}) {
  return taskReportService.getDailyTasks(user, { requestedDate: date });
}

/** GET /admin/me/tasks/backfill — روزهایی که هنوز گزارش دیرهنگام می‌پذیرند. */
function getBackfill(user) {
  return taskReportService.getBackfillStatus(user);
}

/** پاسخ تکی { taskId, status, reasonCode?, reasonText?, note?, date? } ⇒ همان submitDailyReport با یک پاسخ. */
function answer(user, body) {
  const b = body && typeof body === 'object' ? body : {};
  const taskId = toId(b.taskId);
  if (taskId === null) return fail('INVALID_TASK', 'شناسه‌ی تسک نامعتبر است.');
  const day = taskReportService.getDailyTasks(user, { requestedDate: b.date });
  if (!day.ok) return day;
  const open = day.tasks.find((t) => t.id === taskId);
  if (open && open.isSystem) return fail('SYSTEM_TASK_READONLY', READONLY_MSG);
  const a = { taskId, status: b.status, reasonCode: b.reasonCode, reasonText: b.reasonText, note: b.note };
  return taskReportService.submitDailyReport(user, { answers: [a] }, { requestedDate: b.date });
}

// تسکِ سیستمیِ «پاسخ‌داده‌شده‌ی خودِ کاربر» (برای واگرد/توضیح). پاسخ دیگران را لو نمی‌دهیم: فقط وقتی ردیف مالِ همین کاربر باشد.
function ownSystemAnswer(user, taskId, date) {
  const log = logsRepo.findByTaskDate(taskId, date);
  if (!log || log.user_id !== user.id) return false;
  const t = plansRepo.findTask(taskId);
  return !!(t && t.is_system);
}

function guarded(user, b, run) {
  const taskId = toId(b.taskId);
  if (taskId === null) return fail('INVALID_TASK', 'شناسه‌ی تسک نامعتبر است.');
  const resolved = taskReportService.resolveReportDate(user, { requestedDate: b.date });
  if (!resolved.ok) return resolved;
  if (ownSystemAnswer(user, taskId, resolved.date)) return fail('SYSTEM_TASK_READONLY', READONLY_MSG);
  return run(taskId);
}

/** POST /admin/me/tasks/undo { taskId, date? } — برداشتن تیک. */
function undo(user, body) {
  const b = body && typeof body === 'object' ? body : {};
  return guarded(user, b, (taskId) => taskReportService.undoAnswer(user, { taskId, date: b.date }));
}

/** PATCH /admin/me/tasks/note { taskId, date?, note } — ویرایش/پاک‌کردن توضیحِ انجام. */
function note(user, body) {
  const b = body && typeof body === 'object' ? body : {};
  return guarded(user, b, (taskId) => taskReportService.updateNote(user, { taskId, date: b.date, note: b.note }));
}

/**
 * GET /admin/me/tasks/pending-count — M4: نشان کنار «وضعیت من» در منو. فقط عدد (بدون عنوان تسک).
 * مبنا همان قاعده‌ی گیت/بنر: تسک پاسخ‌نداده‌ی «امروز» که کاربر می‌تواند از پنل تیکش بزند؛ سیستمی/واجب (فقط‌خواندنی در پنل) و اختیاری (low) نمی‌آید.
 * روز تعطیل/مرخصی تمام‌روز/ماه بسته/خطای تاریخ ⇒ pending: 0 (نشانی لازم نیست؛ خطا به UI نمی‌رسد).
 */
function pendingCount(user) {
  const day = taskReportService.getDailyTasks(user, {});
  if (!day || !day.ok) return { ok: true, pending: 0 };
  return { ok: true, date: day.date, pending: day.tasks.filter((t) => !t.isSystem && !t.optional).length };
}

module.exports = { getToday, getBackfill, pendingCount, answer, undo, note };

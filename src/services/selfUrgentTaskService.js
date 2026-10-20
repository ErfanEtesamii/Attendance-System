// تسک فوریِ خودِ کارمند (فاز ۱۵، A3): کارمند وسط روز/هفته یک کار فوری برای خودش به برنامه‌اش اضافه می‌کند.
//
// مدل داده: بدون ستون و migration جدید. تسک فوریِ خودش = plan_tasks با is_urgent=1، priority='high' و assigned_by_user_id = شناسه‌ی صاحب برنامه.
//   تشخیص «فوریِ خودش» در همه‌جا = isSelfAssigned(task, ownerUserId). manager_locked/edited_by_user_id صفر/NULL می‌ماند (بنر «سرپرست تغییر داده» روشن نمی‌شود).
// قواعد (همه سمت سرور):
//   • تنظیم selfUrgentEnabled (پیش‌فرض روشن) ⇒ SELF_URGENT_DISABLED؛ سقف selfUrgentMaxPerDay برای هر «روزِ برنامه‌ریزی‌شده» ⇒ SELF_URGENT_LIMIT.
//   • اعتبارسنجی/ساخت دقیقاً همان urgentTaskService.createUrgent است (عنوان ≤ ۱۲۰، توضیح ≤ ۵۰۰، امروز تا ۶۰ روز آینده، روز کاریِ خودِ او،
//     ماهِ بسته، استثنای قفل هفته‌ی شروع‌شده، ساخت برنامه‌ی submittedِ خالی). مهلت ساعتی و یادداشت برای فوریِ خودش پشتیبانی نمی‌شود (نادیده گرفته می‌شود).
//   • ویرایش/حذف (soft): فقط فوریِ خودش و فقط تا وقتی هیچ پاسخی (task_daily_logs) ندارد؛ فوریِ سرپرست هرگز (NOT_SELF_URGENT). تاریخ فقط داخل همان هفته.
//   • اعلان به سرپرست/ادمین‌ها (notificationEvents.selfUrgentTaskAdded)؛ «تعیین‌شده توسط مدیر» برای آن ارسال نمی‌شود. خطای اعلان/audit ثبت را نمی‌شکند.
//   • مالکیت فقط از شناسه‌ی کاربرِ احراز‌شده (req.miniAppUser) می‌آید؛ تسک کارمند دیگر ⇒ TASK_NOT_FOUND.
//   • saveDraft در weeklyPlanService تسک فوری را نادیده می‌گیرد (ویرایش معمولیِ برنامه آن را بازنویسی/حذف نمی‌کند).
const settingsRepository = require('../repositories/settingsRepository');
const plansRepo = require('../repositories/weeklyPlanRepository');
const logsRepo = require('../repositories/taskLogRepository');
const monthClosuresRepository = require('../repositories/monthClosuresRepository');
const auditRepository = require('../repositories/auditRepository');
const calendarService = require('../engine/calendarService');
const notificationEvents = require('./notificationEvents');
const urgent = require('./urgentTaskService');

const { fail, clean, TITLE_MAX, DESC_MAX } = urgent;
const EXTRA_STATUS = { SELF_URGENT_DISABLED: 403, SELF_URGENT_LIMIT: 409, NOT_SELF_URGENT: 403, DATE_OUT_OF_WEEK: 400, NOTHING_TO_UPDATE: 400 };
const statusOf = (code) => EXTRA_STATUS[code] || urgent.statusOf(code);
const failS = (code, error) => ({ ok: false, code, error, status: statusOf(code) });
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const timeRange = (input) => {
  const start = String(input.startTime || '').trim(); const end = String(input.endTime || '').trim();
  if (!start && !end) return { start: null, end: null };
  if (!TIME_RE.test(start) || !TIME_RE.test(end) || start >= end) return { error: failS('INVALID_TIME_RANGE', 'ساعت شروع و پایان باید معتبر باشند و پایان بعد از شروع باشد.') };
  return { start, end };
};

/** آیا این تسکِ فوری را خودِ صاحب برنامه گذاشته؟ (task = ردیف plan_tasks) */
const isSelfAssigned = (task, ownerUserId) => !!task && !!task.is_urgent && task.assigned_by_user_id != null && Number(task.assigned_by_user_id) === Number(ownerUserId);

const safeAudit = (entry) => {
  try { auditRepository.logEvent(entry); } catch (err) { console.error('[selfUrgent] audit ناموفق (نادیده گرفته شد):', err.message); }
};

const present = (t, weekStart) => ({
  id: t.id, title: t.title, description: t.description || '', date: t.planned_date, weekStart: weekStart || t.week_start_date || null,
  priority: 'high', isUrgent: true, selfAssigned: true, startTime: t.scheduled_start_time || null, endTime: t.urgent_deadline_time || null, createdAt: t.created_at,
});

/** افزودن تسک فوریِ خودش. input = {title, description?, date}. */
function add(user, input, { now = new Date(), ip = null, source = 'miniapp' } = {}) {
  if (!user || !user.is_active) return failS('USER_NOT_FOUND', 'کاربر یافت نشد.');
  const settings = settingsRepository.getAll();
  if (!settings.selfUrgentEnabled) return failS('SELF_URGENT_DISABLED', 'افزودن تسک فوری برای خودتان فعال نیست.');
  const b = input && typeof input === 'object' ? input : {};
  const range = timeRange(b); if (range.error) return range.error;
  const max = Number(settings.selfUrgentMaxPerDay) || 5;

  const made = urgent.createUrgent(user, user.id, { title: b.title, description: b.description, date: b.date, deadlineTime: range.end }, {
    now,
    guard: ({ date }) => (plansRepo.countSelfUrgentOnDate(user.id, date) >= max
      ? failS('SELF_URGENT_LIMIT', `برای یک روز حداکثر ${max} تسک فوریِ شخصی می‌توانید اضافه کنید.`) : null),
  });
  if (!made.ok) return made;
  const { task, createdPlan, date, title, weekStart } = made;
  if (range.start) plansRepo.updateTask(task.id, { scheduledStartTime: range.start });

  safeAudit({ userId: user.id, action: 'self_urgent_task_added', ipAddress: ip, details: { source, taskId: task.id, date, title, createdPlan } });
  notificationEvents.selfUrgentTaskAdded(user, task);
  return { ok: true, createdPlan, task: present(plansRepo.findTask(task.id), weekStart) };
}

/** تسکِ فوریِ خودش + مالکیت و گیت‌های مشترکِ ویرایش/حذف. → { row } یا fail */
function ownedSelfUrgent(user, taskId) {
  if (!user || !user.is_active) return failS('USER_NOT_FOUND', 'کاربر یافت نشد.');
  const row = plansRepo.findUrgentWithOwner(Number(taskId));
  if (!row || row.deleted_at || row.user_id !== user.id) return failS('TASK_NOT_FOUND', 'تسک فوری یافت نشد.');
  if (!isSelfAssigned(row, user.id)) return failS('NOT_SELF_URGENT', 'تسک فوریِ تعیین‌شده توسط سرپرست قابل ویرایش یا حذف نیست.');
  if (row.planned_date && monthClosuresRepository.findClosedOverlapping(row.planned_date, row.planned_date).length > 0) {
    return failS('MONTH_CLOSED', 'این روز در ماهِ بسته‌شده است.');
  }
  if (logsRepo.listByTask(row.id).length > 0) return failS('HAS_ANSWERS', 'به این تسک پاسخ داده‌اید و دیگر قابل ویرایش یا حذف نیست.');
  return { row };
}

/** ویرایش: title / description / date (هرکدام اختیاری؛ تاریخ فقط داخل همان هفته). */
function update(user, taskId, input, { now = new Date(), ip = null, source = 'miniapp' } = {}) {
  const found = ownedSelfUrgent(user, taskId);
  if (!found.row) return found;
  const { row } = found;
  const b = input && typeof input === 'object' ? input : {};
  const fields = {};
  const changed = [];

  if (b.title !== undefined) {
    const title = clean(b.title, TITLE_MAX);
    if (!title) return failS('TITLE_REQUIRED', 'عنوان تسک فوری الزامی است.');
    if (title.length > TITLE_MAX) return failS('TITLE_TOO_LONG', `عنوان حداکثر ${TITLE_MAX} نویسه است.`);
    if (title !== row.title) { fields.title = title; changed.push('title'); }
  }
  if (b.description !== undefined) {
    const description = clean(b.description, DESC_MAX);
    if (description.length > DESC_MAX) return failS('DESCRIPTION_TOO_LONG', `توضیح حداکثر ${DESC_MAX} نویسه است.`);
    if ((description || null) !== (row.description || null)) { fields.description = description || null; changed.push('description'); }
  }
  if (b.startTime !== undefined || b.endTime !== undefined) {
    const range = timeRange({ startTime: b.startTime === undefined ? row.scheduled_start_time : b.startTime, endTime: b.endTime === undefined ? row.urgent_deadline_time : b.endTime });
    if (range.error) return range.error;
    const dateFail = urgent.checkDate(user, row.planned_date, { settings: settingsRepository.getAll(), now, deadline: range.end });
    if (dateFail) return dateFail;
    if (range.start !== (row.scheduled_start_time || null)) { fields.scheduledStartTime = range.start; changed.push('startTime'); }
    if (range.end !== (row.urgent_deadline_time || null)) { fields.urgentDeadlineTime = range.end; changed.push('endTime'); }
  }
  if (b.date !== undefined && b.date !== row.planned_date) {
    const settings = settingsRepository.getAll();
    const dateFail = urgent.checkDate(user, b.date, { settings, now });
    if (dateFail) return dateFail;
    if (calendarService.weekStartOf(b.date, settings.weekStartDay) !== row.week_start_date) {
      return failS('DATE_OUT_OF_WEEK', 'تاریخ جدید باید داخل همان هفته‌ی برنامه باشد؛ برای هفته‌ی دیگر تسک تازه اضافه کنید.');
    }
    fields.plannedDate = b.date; changed.push('date');
  }
  if (b.title === undefined && b.description === undefined && b.date === undefined && b.startTime === undefined && b.endTime === undefined) return failS('NOTHING_TO_UPDATE', 'چیزی برای ویرایش ارسال نشده است.');

  const task = changed.length ? plansRepo.updateTask(row.id, fields) : plansRepo.findTask(row.id);
  if (changed.length) {
    plansRepo.touch(row.plan_id);
    safeAudit({ userId: user.id, action: 'self_urgent_task_edited', ipAddress: ip, details: { source, taskId: row.id, changed, date: task.planned_date, title: task.title } });
  }
  return { ok: true, changed, task: present(task, row.week_start_date) };
}

/** حذف (soft) فوریِ خودش؛ فقط بدون پاسخ. */
function remove(user, taskId, { ip = null, source = 'miniapp' } = {}) {
  const found = ownedSelfUrgent(user, taskId);
  if (!found.row) return found;
  const { row } = found;
  plansRepo.softDeleteTask(row.id);
  safeAudit({ userId: user.id, action: 'self_urgent_task_removed', ipAddress: ip, details: { source, taskId: row.id, date: row.planned_date, title: row.title } });
  return { ok: true };
}

module.exports = { add, update, remove, isSelfAssigned, statusOf };

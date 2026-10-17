// تسک فوری (فاز ۱۲، E1): مدیر/سرپرست یک کار فوری به کارمند می‌دهد و در برنامه‌ی همان روزِ او با علامت «تسک فوری» می‌آید.
//
// قواعد (همه سمت سرور):
//   • مجوز: فقط admin (هر کارمند فعالِ دیگر) و manager (فقط زیردست مستقیمِ فعال). برای خود، hr و کارمند ممنوع.
//   • تاریخ: امروز (به وقت شرکت) تا ۶۰ روز آینده؛ باید روز کاریِ همان کارمند باشد و کارمند آن روز مرخصی/مأموریتِ تمام‌روز نداشته باشد.
//     ماهِ بسته ⇒ MONTH_CLOSED (۴۰۹).
//   • «استثنای قفل»: برنامه‌ی هفته‌ی شروع‌شده (PLAN_LOCKED در weeklyPlanService) جلوی تسک فوری را نمی‌گیرد؛ این تنها استثناست و فقط از این سرویس.
//     اگر آن هفته هنوز برنامه‌ای برای کارمند نیست، یک برنامه‌ی «submitted»ِ خالی ساخته می‌شود (بدون الزام planMinTasks).
//     برنامه‌ی موجود (حتی پیش‌نویس) دست‌نخورده می‌ماند و فقط تسک به آن اضافه می‌شود.
//   • تسک فوری همیشه priority = high است (مثل high مانع خروج می‌شود تا done، یا not_done/partial همراه با علت، طبق dailyReportGateMode).
//     انتقال به روز بعد مجاز است و نشان فوری حفظ می‌شود (همان ردیف است)؛ حذف (drop) توسط کارمند مجاز نیست (taskReportService).
//   • کارمند نمی‌تواند تسک فوری را حذف/ویرایش کند (weeklyPlanService آن را نادیده می‌گیرد)؛ حذف فقط با remove() و فقط اگر هنوز پاسخی ندارد.
//   • تسک فوری در شمارش planMinTasks/سقف ۳۰ تسک و در «انتقال/کپی از هفته‌ی قبل» نمی‌آید.
//   • هر ثبت/حذف ⇒ audit؛ ثبت ⇒ اعلان به کارمند (پنل + تلگرام). خطای اعلان ثبت را نمی‌شکند.
const settingsRepository = require('../repositories/settingsRepository');
const usersRepository = require('../repositories/usersRepository');
const plansRepo = require('../repositories/weeklyPlanRepository');
const logsRepo = require('../repositories/taskLogRepository');
const monthClosuresRepository = require('../repositories/monthClosuresRepository');
const auditRepository = require('../repositories/auditRepository');
const calendarService = require('../engine/calendarService');
const notificationEvents = require('./notificationEvents');
const { sanitizeText } = require('../utils/sanitize');
const { todayInZone, minutesSinceMidnight } = require('../utils/time');
const { addDays, dayNumber } = require('../utils/shiftDay');
const { getDb } = require('../db/connection');

const TITLE_MAX = 120;
const DESC_MAX = 500;
const NOTE_MAX = 500;
const MAX_AHEAD_DAYS = 60;
const HHMM_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

const ERROR_STATUS = { FORBIDDEN: 403, SELF_NOT_ALLOWED: 403, NOT_IN_SCOPE: 403, USER_NOT_FOUND: 404, TASK_NOT_FOUND: 404, MONTH_CLOSED: 409, HAS_ANSWERS: 409 };
const statusOf = (code) => ERROR_STATUS[code] || 400;

const fail = (code, error, extra = {}) => ({ ok: false, code, error, status: statusOf(code), ...extra });
const clean = (v, max) => sanitizeText(v == null ? '' : String(v), max + 1).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();

const isAssigner = (actor) => !!actor && (actor.role === 'admin' || actor.role === 'manager');

/** آیا actor مجاز است برای target تسک فوری بگذارد/حذف کند؟ → null (مجاز) یا fail(...) */
function scopeFailure(actor, target) {
  if (!isAssigner(actor)) return fail('FORBIDDEN', 'برای تعیین تسک فوری مجوز لازم را ندارید.');
  if (!target) return fail('USER_NOT_FOUND', 'کارمند یافت نشد.');
  if (target.id === actor.id) return fail('SELF_NOT_ALLOWED', 'برای خودتان نمی‌توانید تسک فوری تعیین کنید.');
  if (actor.role === 'manager' && target.manager_id !== actor.id) return fail('NOT_IN_SCOPE', 'این کارمند در تیم شما نیست.');
  return null;
}

function normalizeHHMM(v) {
  if (v === undefined || v === null || v === '') return { value: null };
  const m = HHMM_RE.exec(String(v).trim());
  if (!m) return { error: fail('INVALID_DEADLINE_TIME', 'ساعت مهلت نامعتبر است (قالب HH:MM).') };
  return { value: `${m[1].padStart(2, '0')}:${m[2]}` };
}

const presentTask = (t, extra = {}) => ({
  id: t.id, userId: t.user_id, weekStart: t.week_start_date || null, title: t.title, description: t.description || '', date: t.planned_date,
  deadlineTime: t.urgent_deadline_time || null, note: t.urgent_note || null, assignedBy: t.assigned_by_user_id || null, createdAt: t.created_at, ...extra,
});

/**
 * اعتبارسنجیِ محتوا (عنوان/توضیح/یادداشت/مهلت‌ساعتی) — بخش مشترکِ تسک فوریِ مدیر و تسک فوریِ خودِ کارمند (A3، فاز ۱۵).
 * @returns {{error: object}|{title: string, description: string, note: string, deadline: string|null}}
 */
function validateContent(b) {
  const title = clean(b.title, TITLE_MAX);
  if (!title) return { error: fail('TITLE_REQUIRED', 'عنوان تسک فوری الزامی است.') };
  if (title.length > TITLE_MAX) return { error: fail('TITLE_TOO_LONG', `عنوان حداکثر ${TITLE_MAX} نویسه است.`) };
  const description = clean(b.description, DESC_MAX);
  if (description.length > DESC_MAX) return { error: fail('DESCRIPTION_TOO_LONG', `توضیح حداکثر ${DESC_MAX} نویسه است.`) };
  const note = clean(b.note, NOTE_MAX);
  if (note.length > NOTE_MAX) return { error: fail('NOTE_TOO_LONG', `یادداشت حداکثر ${NOTE_MAX} نویسه است.`) };
  const dt = normalizeHHMM(b.deadlineTime);
  if (dt.error) return { error: dt.error };
  return { title, description, note, deadline: dt.value };
}

/**
 * اعتبارسنجیِ تاریخ برای کارمندِ target: قالب، نه گذشته، حداکثر ۶۰ روز، مهلتِ ساعتیِ امروز، ماهِ بسته، روز کاری/مرخصی/مأموریتِ تمام‌روز.
 * @returns {object|null} fail(...) یا null (مجاز)
 */
function checkDate(target, date, { settings, now = new Date(), deadline = null } = {}) {
  const today = todayInZone(settings.timezone, now);
  if (typeof date !== 'string' || dayNumber(date) === null) return fail('INVALID_DATE', 'تاریخ تسک فوری نامعتبر است (YYYY-MM-DD).');
  if (date < today) return fail('DATE_IN_PAST', 'تاریخ تسک فوری نمی‌تواند گذشته باشد.');
  if (date > addDays(today, MAX_AHEAD_DAYS)) return fail('DATE_TOO_FAR', `تاریخ تسک فوری حداکثر ${MAX_AHEAD_DAYS} روز آینده می‌تواند باشد.`);
  if (deadline && date === today && minutesSinceMidnight(now, settings.timezone) >= Number(deadline.slice(0, 2)) * 60 + Number(deadline.slice(3))) {
    return fail('DEADLINE_PASSED', 'ساعت مهلت امروز گذشته است.');
  }
  if (monthClosuresRepository.findClosedOverlapping(date, date).length > 0) return fail('MONTH_CLOSED', 'این روز در ماهِ بسته‌شده است.');
  const cal = calendarService.getCalendarDay(target, date, { settings });
  if (!cal.isWorkingDay || calendarService.fullyOnApprovedLeave(target, date, cal)) {
    return fail('NOT_WORKING_DAY', 'آن روز برای این کارمند روز کاری نیست (تعطیل/مرخصی/مأموریت)؛ تاریخ دیگری انتخاب کنید.');
  }
  return null;
}

/**
 * اعتبارسنجی + درجِ تسک فوری (مشترک بین assign و selfUrgentTaskService). مجوز/اسکوپ، audit و اعلان بیرون از اینجا است.
 * @param {object} target ردیف کاربرِ صاحب برنامه
 * @param {number} assignedByUserId تعیین‌کننده (برای فوریِ خودش = target.id)
 * @param {object} input {title, description?, date, deadlineTime?, note?}
 * @param {{now?: Date, guard?: function}} [opts] guard({date, title}) بعد از اعتبارسنجی و پیش از درج صدا زده می‌شود (fail یا null)
 * @returns {{ok: true, task: object, createdPlan: boolean, date: string, title: string, deadline: string|null, weekStart: string}|object}
 */
function createUrgent(target, assignedByUserId, input, { now = new Date(), guard = null } = {}) {
  const b = input && typeof input === 'object' ? input : {};
  const content = validateContent(b);
  if (content.error) return content.error;
  const { title, description, note, deadline } = content;

  const settings = settingsRepository.getAll();
  const date = b.date;
  const dateFail = checkDate(target, date, { settings, now, deadline });
  if (dateFail) return dateFail;
  if (guard) {
    const g = guard({ date, title, settings });
    if (g) return g;
  }

  const weekStart = calendarService.weekStartOf(date, settings.weekStartDay);
  let createdPlan = false;
  const task = getDb().transaction(() => {
    let plan = plansRepo.findByUserWeek(target.id, weekStart);
    if (!plan) {
      plan = plansRepo.getOrCreate(target.id, weekStart);
      plan = plansRepo.markSubmitted(plan.id); // برنامه‌ی خالیِ «ثبت‌شده»: تسک فوری جا بگیرد؛ planMinTasks لازم نیست
      createdPlan = true;
    }
    const t = plansRepo.addTask(plan.id, {
      title, description: description || null, plannedDate: date, priority: 'high',
      isUrgent: true, assignedByUserId, urgentNote: note || null, urgentDeadlineTime: deadline,
    });
    plansRepo.touch(plan.id);
    return t;
  })();
  return { ok: true, task, createdPlan, date, title, deadline, weekStart };
}

/**
 * ثبت تسک فوری.
 * @param {object} actor ردیف کاربرِ تعیین‌کننده (admin|manager)
 * @param {object|null} target ردیف کاربرِ کارمند
 * @param {{title: string, description?: string, date: string, deadlineTime?: string, note?: string}} input
 * @param {{now?: Date, ip?: string, source?: string}} [opts]
 * @returns {{ok: true, task: object, createdPlan: boolean}|{ok: false, code: string, error: string, status: number}}
 */
function assign(actor, target, input, { now = new Date(), ip = null, source = 'admin_panel' } = {}) {
  const denied = scopeFailure(actor, target);
  if (denied) return denied;
  if (!target.is_active) return fail('USER_NOT_FOUND', 'کارمند یافت نشد.');

  const made = createUrgent(target, actor.id, input, { now });
  if (!made.ok) return made;
  const { task, createdPlan, date, title, deadline, weekStart } = made;

  try {
    auditRepository.logEvent({
      userId: actor.id, action: 'urgent_task_assigned', ipAddress: ip,
      details: { source, taskId: task.id, targetUserId: target.id, date, deadlineTime: deadline, title, createdPlan },
    });
  } catch (err) {
    console.error('[urgentTask] audit ناموفق (نادیده گرفته شد):', err.message);
  }
  notificationEvents.urgentTaskAssigned({ task, employee: target, actor });
  return { ok: true, createdPlan, task: presentTask({ ...task, user_id: target.id, week_start_date: weekStart }) };
}

/** حذف تسک فوری (soft-delete)؛ فقط اگر هنوز هیچ پاسخی (task_daily_logs) ندارد و ماه بسته نیست. اسکوپ مثل assign. */
function remove(actor, taskId, { ip = null, source = 'admin_panel' } = {}) {
  const row = plansRepo.findUrgentWithOwner(taskId);
  if (!row || row.deleted_at) return fail('TASK_NOT_FOUND', 'تسک فوری یافت نشد.');
  const target = usersRepository.findById(row.user_id);
  const denied = scopeFailure(actor, target);
  if (denied) return denied;
  if (row.planned_date && monthClosuresRepository.findClosedOverlapping(row.planned_date, row.planned_date).length > 0) {
    return fail('MONTH_CLOSED', 'این روز در ماهِ بسته‌شده است.');
  }
  if (logsRepo.listByTask(row.id).length > 0) return fail('HAS_ANSWERS', 'کارمند به این تسک پاسخ داده است و دیگر قابل حذف نیست.');
  plansRepo.softDeleteTask(row.id);
  try {
    auditRepository.logEvent({
      userId: actor.id, action: 'urgent_task_removed', ipAddress: ip,
      details: { source, taskId: row.id, targetUserId: row.user_id, date: row.planned_date, title: row.title },
    });
  } catch (err) {
    console.error('[urgentTask] audit ناموفق (نادیده گرفته شد):', err.message);
  }
  return { ok: true };
}

/**
 * فهرست تسک‌های فوریِ داخل بازه (پیش‌فرض: امروز تا ۱۴ روز بعد) با وضعیت پاسخ.
 * userIds = اسکوپ نقش (null ⇒ همه)؛ userId اختیاری برای فیلتر یک کارمند (باید داخل اسکوپ باشد، وگرنه فهرست خالی).
 */
function list({ userIds = null, userId = null, from = null, to = null, now = new Date() } = {}) {
  const settings = settingsRepository.getAll();
  const today = todayInZone(settings.timezone, now);
  const f = from || today;
  const t = to || addDays(f, 14);
  let ids = userIds;
  if (userId !== null) ids = Array.isArray(userIds) && !userIds.includes(userId) ? [] : [userId];
  const names = new Map(usersRepository.listUsers({}).map((u) => [u.id, u.full_name]));
  return plansRepo.listUrgent({ userIds: ids, from: f, to: t }).map((row) => {
    const logs = logsRepo.listByTask(row.id);
    const last = logs.length ? logs[logs.length - 1] : null;
    return presentTask(row, {
      userName: names.get(row.user_id) || null,
      assignedByName: row.assigned_by_user_id ? names.get(row.assigned_by_user_id) || null : null,
      status: last ? last.status : null, // done | partial | not_done | null (بدون پاسخ)
      rescheduleTo: last && last.reschedule_to ? last.reschedule_to : null,
      answered: logs.length > 0,
    });
  });
}

module.exports = { assign, remove, list, statusOf, scopeFailure, createUrgent, checkDate, validateContent, presentTask, fail, clean, ERROR_STATUS, TITLE_MAX, DESC_MAX, NOTE_MAX, MAX_AHEAD_DAYS };

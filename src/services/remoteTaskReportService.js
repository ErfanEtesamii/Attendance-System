// گزارش تسک‌های دورکاری هنگام «پایان دورکاری».
//
// چرا: کارمندِ بیرون از شرکت دورکاری را بی‌دلیل ثبت/طولانی می‌کرد. حالا برای بستن نشست باید «چه کاری، چقدر طول کشید» را
// یکی‌یکی بنویسد. مبنای اعتبارسنجی (همه سمت سرور، مستقل از بات/Mini App):
//   • حداقل یک تسک؛ حداکثر MAX_TASKS؛ عنوان ۱ تا ۱۲۰ نویسه؛ مدت هر تسک عدد صحیحِ دقیقه (۱ تا ۱۴۴۰).
//   • جمعِ مدت‌ها نمی‌تواند از «ساعت خالصِ دورکاری» (کل − استراحت) بیشتر باشد (تلورانس TOLERANCE دقیقه).
//   • جمعِ مدت‌ها باید دست‌کم remoteTaskCoveragePercent درصدِ ساعت خالص را پوشش دهد (۰ = بدون الزام).
// بعد از بسته‌شدنِ نشست، هر تسک به «برنامه امروز» همان کارمند (روز کاریِ نشست) با ساعت شروع/پایان و وضعیت «انجام شد» اضافه می‌شود
// (همان مدل تسک فوریِ شخصی: plan_tasks با is_urgent=1 و assigned_by = خودش؛ بعد از پاسخ دیگر قابل ویرایش/حذف نیست).
// ساعت‌ها از روی مدت‌ها چیده می‌شوند: تسک اول از ساعت شروع دورکاری، هر تسک بعد از پایان قبلی. اگر ساخت برنامه ممکن نبود
// (ماه بسته)، گزارش در remote_session_tasks می‌ماند و planSynced=false برمی‌گردد؛ پایان دورکاری هرگز به‌خاطر آن شکست نمی‌خورد.
const { getDb } = require('../db/connection');
const repo = require('../repositories/remoteWorkRepository');
const plansRepo = require('../repositories/weeklyPlanRepository');
const logsRepo = require('../repositories/taskLogRepository');
const monthClosuresRepository = require('../repositories/monthClosuresRepository');
const settingsRepository = require('../repositories/settingsRepository');
const auditRepository = require('../repositories/auditRepository');
const calendarService = require('../engine/calendarService');
const remoteWork = require('./remoteWorkService');

const REMOTE_TASK_KEY = 'remote_work'; // system_key تسک‌های ثبت‌شده از گزارش پایان دورکاری
const MAX_TASKS = 20;
const TOLERANCE = 5; // دقیقه
const TITLE_MAX = 120;
const fail = (status, code, error, extra = {}) => ({ ok: false, status, code, error, ...extra });

const fa = (n) => Number(n).toLocaleString('fa-IR');
function faDuration(mins) {
  const h = Math.floor(mins / 60); const m = mins % 60;
  if (h && m) return `${fa(h)} ساعت و ${fa(m)} دقیقه`;
  return h ? `${fa(h)} ساعت` : `${fa(m)} دقیقه`;
}
const minutesBetween = (a, b) => Math.max(0, Math.round((new Date(b) - new Date(a)) / 60000));
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** مدتِ ورودی را به دقیقه برمی‌گرداند: عدد، «90»، «1:30»، «۱:۳۰» یا «۲ ساعت/۴۵ دقیقه»؛ نامعتبر ⇒ null. */
function parseMinutes(input) {
  if (typeof input === 'number') return Number.isInteger(input) && input >= 1 && input <= 1440 ? input : null;
  let s = String(input == null ? '' : input).trim();
  s = s.replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[٫,]/g, '.');
  if (!s) return null;
  let m = /^(\d{1,2}):([0-5]\d)$/.exec(s);
  if (m) { const v = Number(m[1]) * 60 + Number(m[2]); return v >= 1 && v <= 1440 ? v : null; }
  m = /^(\d+(?:\.\d+)?)\s*(?:ساعت|h|hr|hrs)(?:\s*(?:و)?\s*(\d+)\s*(?:دقیقه|m|min)?)?$/i.exec(s);
  if (m) { const v = Math.round(Number(m[1]) * 60 + (m[2] ? Number(m[2]) : 0)); return v >= 1 && v <= 1440 ? v : null; }
  m = /^(\d+)\s*(?:دقیقه|m|min)?$/i.exec(s);
  if (m) { const v = Number(m[1]); return v >= 1 && v <= 1440 ? v : null; }
  return null;
}

const cleanTitle = (v) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();

/** ساعت خالصِ نشستِ باز تا لحظه‌ی now (کل − استراحت‌ها؛ استراحتِ باز تا now). */
function netMinutes(open, now = new Date()) {
  const gross = minutesBetween(open.start_at, now);
  const brk = repo.listBreaks(open.id).reduce((n, b) => n + minutesBetween(b.start_at, b.end_at || now), 0);
  return { gross, brk, net: Math.max(0, gross - Math.min(brk, gross)) };
}

function requirements(settings = settingsRepository.getAll()) {
  return { required: settings.remoteEndTasksRequired !== false, coveragePercent: Number(settings.remoteTaskCoveragePercent) || 0, maxTasks: MAX_TASKS };
}

/** ⇒ { ok, tasks:[{title,minutes}], total } | fail. net = ساعت خالص (دقیقه). */
function validate(rawTasks, net, settings = settingsRepository.getAll()) {
  const list = Array.isArray(rawTasks) ? rawTasks : [];
  if (!list.length) return fail(400, 'REMOTE_TASKS_REQUIRED', 'برای پایان دورکاری باید دست‌کم یک تسکِ انجام‌شده را با مدتش ثبت کنید.');
  if (list.length > MAX_TASKS) return fail(400, 'REMOTE_TASKS_TOO_MANY', `حداکثر ${fa(MAX_TASKS)} تسک در هر دورکاری قابل ثبت است.`);
  const tasks = [];
  for (const t of list) {
    const title = cleanTitle(t && t.title);
    if (!title) return fail(400, 'REMOTE_TASK_TITLE', 'عنوان هر تسک الزامی است.');
    if (title.length > TITLE_MAX) return fail(400, 'REMOTE_TASK_TITLE', `عنوان تسک حداکثر ${fa(TITLE_MAX)} نویسه است.`);
    const minutes = parseMinutes(t && t.minutes);
    if (!minutes) return fail(400, 'REMOTE_TASK_MINUTES', `مدت تسک «${title}» نامعتبر است (مثلاً ۴۵ یا ۱:۳۰).`);
    tasks.push({ title, minutes });
  }
  const total = tasks.reduce((n, t) => n + t.minutes, 0);
  if (total > net + TOLERANCE) {
    return fail(409, 'REMOTE_TASKS_OVER', `جمع زمان تسک‌ها (${faDuration(total)}) از ساعت خالص دورکاری (${faDuration(net)}) بیشتر است؛ مدت‌ها را اصلاح کنید.`, { total, net });
  }
  const need = Math.ceil((net * (Number(settings.remoteTaskCoveragePercent) || 0)) / 100);
  if (total < need) {
    return fail(409, 'REMOTE_TASKS_UNDER', `جمع زمان تسک‌ها (${faDuration(total)}) کمتر از حد لازم است؛ دست‌کم ${faDuration(need)} از ${faDuration(net)} دورکاری باید با تسک توضیح داده شود.`, { total, net, need });
  }
  return { ok: true, tasks, total };
}

function localMinutes(iso, tz) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso));
  const get = (t) => Number((parts.find((p) => p.type === t) || {}).value || 0);
  return get('hour') * 60 + get('minute');
}

/** ثبت تسک‌ها در «برنامه امروز»؛ هرگز استثنا نمی‌دهد ⇒ { synced, count } */
function mirrorToPlan(user, session, taskRows, { settings = settingsRepository.getAll() } = {}) {
  try {
    const date = session.work_date;
    if (monthClosuresRepository.findClosedOverlapping(date, date).length > 0) return { synced: false, reason: 'MONTH_CLOSED' };
    const weekStart = calendarService.weekStartOf(date, settings.weekStartDay);
    let cursor = localMinutes(session.start_at, settings.timezone);
    getDb().transaction(() => {
      let plan = plansRepo.findByUserWeek(user.id, weekStart);
      if (!plan) { plan = plansRepo.getOrCreate(user.id, weekStart); plan = plansRepo.markSubmitted(plan.id); }
      for (const t of taskRows) {
        const start = Math.min(cursor, 1438); const end = Math.min(start + t.minutes, 1439);
        cursor = end;
        const timed = end > start;
        const dur = faDuration(t.minutes);
        const task = plansRepo.addTask(plan.id, {
          title: t.title, description: `⏱ ${dur} — ثبت‌شده هنگام پایان دورکاری`, plannedDate: date, priority: 'high',
          isUrgent: true, assignedByUserId: user.id, urgentDeadlineTime: timed ? hhmm(end) : null, scheduledStartTime: timed ? hhmm(start) : null,
          systemKey: REMOTE_TASK_KEY, // نشانِ «دورکاری» به‌جای «فوری» در UI (is_system صفر می‌ماند؛ قابل‌ویرایش/حذف نیست چون پاسخ دارد)
        });
        logsRepo.upsert({ taskId: task.id, userId: user.id, logDate: date, status: 'done', note: `⏱ ${dur} — دورکاری` });
        repo.setSessionTaskPlanTask(t.id, task.id);
      }
      plansRepo.touch(plan.id);
    })();
    return { synced: true, count: taskRows.length };
  } catch (err) {
    console.error('[remoteTasks] ثبت در برنامه امروز ناموفق (گزارش ذخیره شده است):', err && err.message);
    return { synced: false, reason: 'ERROR' };
  }
}

/** پس از تأییدِ ادمین: تسک‌های گزارش (هنوز ثبت‌نشده) را در برنامه‌ی هفتگی کارمند می‌نشاند؛ idempotent. */
function mirrorApproved(sessionId) {
  try {
    const s = getDb().prepare('SELECT * FROM remote_work_sessions WHERE id = ?').get(sessionId);
    if (!s || s.status !== 'approved') return { synced: false, reason: 'NOT_APPROVED' };
    const rows = repo.listSessionTasks(sessionId).filter((t) => !t.plan_task_id);
    if (!rows.length) return { synced: false, reason: 'NONE' };
    const r = mirrorToPlan({ id: s.user_id }, { ...s, start_at: s.approved_start_at || s.start_at }, rows);
    try { auditRepository.logEvent({ userId: s.user_id, action: 'remote_tasks_synced', details: { sessionId, count: rows.length, planSynced: r.synced } }); } catch (_) { /* نادیده */ }
    return r;
  } catch (err) { console.error('[remoteTasks] mirrorApproved:', err && err.message); return { synced: false, reason: 'ERROR' }; }
}

/**
 * اصلاح و ارسال مجدد نشستِ ردشده. rawTasks = null ⇒ همان تسک‌های قبلی (کارمند رد شدن را پذیرفته و دوباره می‌فرستد).
 * ⇒ { ok, session, tasks, totalMinutes } | fail
 */
function reviseAfterReject(user, sessionId, rawTasks, { ip = null, now = new Date(), source = 'bot' } = {}) {
  const row = repo.findSessionFull(Number(sessionId));
  if (!row || row.user_id !== user.id) return fail(404, 'SESSION_NOT_FOUND', 'این دورکاری یافت نشد.');
  if (row.status !== 'rejected' || !row.end_at) return fail(409, 'NOT_REJECTED', 'این دورکاری در وضعیت ردشده نیست (شاید قبلاً دوباره ارسال شده است).');
  if (monthClosuresRepository.findClosedOverlapping(row.work_date, row.work_date).length > 0) return fail(409, 'MONTH_CLOSED', 'ماهِ این دورکاری بسته شده است و دیگر قابل اصلاح نیست.');
  const settings = settingsRepository.getAll();
  const previous = repo.listSessionTasks(row.id).map((t) => ({ title: t.title, minutes: t.minutes }));
  const list = Array.isArray(rawTasks) ? rawTasks : previous;
  const { net } = netMinutes(row, row.end_at);
  const v = validate(list, net, settings);
  if (!v.ok) return v;
  const db = getDb();
  const changed = db.transaction(() => {
    if (!repo.markResubmitted(row.id)) return 0;
    repo.deleteSessionTasks(row.id);
    repo.insertSessionTasks(row.id, user.id, v.tasks);
    return 1;
  })();
  if (!changed) return fail(409, 'NOT_REJECTED', 'این دورکاری در وضعیت ردشده نیست.');
  try { auditRepository.logChange({ actor: user.id, action: 'remote_work_resubmit', entityType: 'remote_work_session', entityId: row.id, before: { status: 'rejected', tasks: previous }, after: { status: 'pending', tasks: v.tasks }, reason: row.review_note || null, ip, meta: { source, targetUserId: user.id, sessionId: row.id, workDate: row.work_date, edited: Array.isArray(rawTasks), previousNote: row.review_note || null } }); } catch (_) { /* audit نباید ارسال مجدد را بشکند */ }
  try { require('./notificationEvents').remoteWorkSubmitted(row.id, { resubmit: true, previousNote: row.review_note }).catch(() => {}); } catch (_) { /* اعلان best-effort */ }
  return { ok: true, session: repo.findSessionFull(row.id), tasks: v.tasks, totalMinutes: v.total };
}

/** پایان دورکاری همراه گزارش تسک‌ها. ⇒ remoteWork.end + { tasks, totalMinutes, planSynced } | fail */
function endWithTasks(user, rawTasks, { ip = null, now = new Date(), source = 'miniapp' } = {}) {
  const open = repo.findOpenSession(user.id);
  if (!open) return remoteWork.end(user, { ip, now, source }); // همان خطای «ورود دورکاری باز ندارید»
  const settings = settingsRepository.getAll();
  const { net } = netMinutes(open, now);
  const v = validate(rawTasks, net, settings);
  if (!v.ok) return v;
  const r = remoteWork.end(user, { ip, now, source, tasks: v.tasks });
  if (!r.ok) return r;
  const rows = repo.listSessionTasks(r.session.id);
  // ثبت در برنامه‌ی هفتگی فقط پس از تأییدِ ادمین انجام می‌شود (mirrorApproved از remoteWorkAdminService.approve)
  try { auditRepository.logEvent({ userId: user.id, action: 'remote_tasks_logged', ipAddress: ip, details: { source, sessionId: r.session.id, count: rows.length, totalMinutes: v.total, netMinutes: net, planSynced: false } }); } catch (_) { /* audit نباید پایان را بشکند */ }
  return { ...r, tasks: rows.map((t) => ({ title: t.title, minutes: t.minutes })), totalMinutes: v.total, planSynced: false };
}

module.exports = { reviseAfterReject, REMOTE_TASK_KEY, mirrorApproved, endWithTasks, validate, parseMinutes, netMinutes, requirements, faDuration, mirrorToPlan, MAX_TASKS, TOLERANCE };

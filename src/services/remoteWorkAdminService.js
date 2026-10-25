// R5 (فاز ۱۴): سرویس بررسی و تأیید دورکاری توسط سرپرست/ادمین.
//
// R5 به هفت بخش تقسیم شده است؛ وضعیت هر بخش:
//   R5-۱ (انجام‌شده): مجوزها (remote_work.read / remote_work.review) و اسکوپ نقش‌ها. هیچ route، SQL یا تغییر داده‌ای نیست.
//   R5-۲ (انجام‌شده): migration ۰۳۸ — ستون via_remote (پیش‌فرض ۰) روی attendance_records و break_records؛ هنوز هیچ کد آن را نمی‌خواند یا ۱ نمی‌کند.
//   R5-۳ (انجام‌شده): صف بررسی (GET /admin/remote-work) با فیلتر هفته/وضعیت/کارمند و علامت «هم‌پوشانی با حضور حضوری» — listQueue (فقط‌خواندنی، بدون audit).
//   R5-۴ (انجام‌شده): تأیید تکی داخل یک تراکنش — approve (رکورد رسمی via_remote=1 + انتقال استراحت‌ها + reviewed_* + audit؛ idempotent، اصلاح ساعت، MONTH_CLOSED).
//   R5-۵ (انجام‌شده): reject — رد با review_note اجباری + اعلان به کارمند (remote_work_rejected، پنل + تلگرام).
//   R5-۶ (انجام‌شده): تصمیم صریح در هم‌پوشانی با حضور حضوری — overlapDecision = merge | keep_onsite در approve، با یادداشت اجباری و audit (remote_work_overlap_decision).
//   R5-۷ (انجام‌شده): approveBatch — تأیید دسته‌ای (یک کارمند/یک هفته) + تست یکپارچه و مستندات.
//
// قواعد اسکوپ (همه سمت سرور؛ همان الگوی weeklyPlanAdminService / checkin_permissions):
//   • خواندن (remote_work.read): admin و hr همه‌ی کاربران؛ سرپرست فقط کارمندان مستقیمش (manager_id = خودش)؛ کارمند ندارد.
//   • تصمیم (remote_work.review): admin همه‌ی کاربران (از جمله سرپرست‌ها)؛ سرپرست فقط کارمندان مستقیمش؛ hr و کارمند ندارند.
//   • هیچ‌کس دورکاریِ «خودش» را تأیید/رد نمی‌کند (SELF_NOT_ALLOWED)، حتی admin؛ ثبت ادمین را ادمین دیگری بررسی می‌کند.
//   • دورکاریِ یک سرپرست را سرپرست دیگر نمی‌تواند بررسی کند، مگر مدیر مستقیمش باشد؛ در عمل فقط admin.
//   • کاربر غیرفعال: برای خواندن و تصمیم مجاز است (ثبت‌های معلق کسی که رفته باید قابل تعیین‌تکلیف بماند)؛ کاربر ناموجود ⇒ USER_NOT_FOUND.
//   • ترتیب بررسی: مجوز ⇒ وجود کاربر ⇒ خود (فقط تصمیم) ⇒ اسکوپ تیم. نقش/مجوز ناشناخته ⇒ همیشه رد (default-deny).
const usersRepository = require('../repositories/usersRepository');
const remoteRepo = require('../repositories/remoteWorkRepository');
const weeklyPlan = require('./weeklyPlanService'); // context(now): امروز/شروع هفته‌ی جاری/تنظیمات (منبع واحد با برنامه‌ی هفتگی)
const calendarService = require('../engine/calendarService');
const { dayNumber, addDays, isOvernightShift, shiftRecordDate } = require('../utils/shiftDay');
const { isoDateToJalaliString } = require('../utils/jalali');
const { hasPermission } = require('../middleware/permissions');
const { getDb } = require('../db/connection');
const auditRepository = require('../repositories/auditRepository');
const monthClosuresRepository = require('../repositories/monthClosuresRepository');
const shiftsRepository = require('../repositories/shiftsRepository');
const settingsRepository = require('../repositories/settingsRepository');
const { formatDate } = require('../utils/time');

const PERM_READ = 'remote_work.read';
const PERM_REVIEW = 'remote_work.review';
const PERM_CREATE = 'remote_work.create';

const ERROR_STATUS = {
  FORBIDDEN: 403, SELF_NOT_ALLOWED: 403, NOT_IN_SCOPE: 403,
  USER_NOT_FOUND: 404, SESSION_NOT_FOUND: 404,
  SESSION_OPEN: 409, NOT_PENDING: 409, MONTH_CLOSED: 409, ONSITE_OVERLAP: 409, TIME_CONFLICT: 409, NO_OVERLAP: 409, ONSITE_NOT_CLOSED: 409,
};
const statusOf = (code) => ERROR_STATUS[code] || 400;
const fail = (code, error) => ({ ok: false, code, error, status: statusOf(code) });

// سرپرستِ مستقیمِ target بودن؛ manager_id ناموجود (null) هرگز با شناسه‌ی actor برابر نیست.
function isDirectManager(actor, target) {
  return actor.role === 'manager' && target.manager_id !== null && target.manager_id !== undefined && target.manager_id === actor.id;
}

/**
 * آیا actor مجاز است دورکاریِ target را «ببیند»؟
 * @param {{id:number, role:string}} actor
 * @param {{id:number, manager_id:number|null}|null|undefined} target
 * @returns {null|{ok:false, code:string, error:string, status:number}} null = مجاز
 */
function readScopeFailure(actor, target) {
  if (!actor || !hasPermission(actor.role, PERM_READ)) return fail('FORBIDDEN', 'برای مشاهده‌ی دورکاری کارمندان مجوز لازم را ندارید.');
  if (!target) return fail('USER_NOT_FOUND', 'کارمند یافت نشد.');
  if (actor.role === 'admin' || actor.role === 'hr') return null;
  if (isDirectManager(actor, target)) return null;
  return fail('NOT_IN_SCOPE', 'این کارمند در تیم شما نیست.');
}

/**
 * آیا actor مجاز است دورکاریِ target را «تأیید/رد/اصلاح» کند؟ (مجوز review = فقط admin و سرپرست؛ خود ⇒ ممنوع)
 * @returns {null|{ok:false, code:string, error:string, status:number}} null = مجاز
 */
function reviewScopeFailure(actor, target) {
  if (!actor || !hasPermission(actor.role, PERM_REVIEW)) return fail('FORBIDDEN', 'برای تأیید یا رد دورکاری مجوز لازم را ندارید.');
  if (!target) return fail('USER_NOT_FOUND', 'کارمند یافت نشد.');
  if (target.id === actor.id) return fail('SELF_NOT_ALLOWED', 'دورکاریِ خودتان را نمی‌توانید تأیید یا رد کنید؛ سرپرست یا ادمین دیگری باید آن را بررسی کند.');
  if (actor.role === 'admin') return null;
  if (isDirectManager(actor, target)) return null;
  return fail('NOT_IN_SCOPE', 'این کارمند در تیم شما نیست.');
}

/**
 * اسکوپ صف: کدام کاربران را actor در فهرست می‌بیند؟
 * @returns {{ok:true, userIds:null|number[]}|{ok:false, code:string, error:string, status:number}}
 *   userIds = null یعنی همه (admin/hr)؛ آرایه برای سرپرست (ممکن است خالی باشد: تیم بدون عضو ⇒ صف خالی، نه خطا).
 */
function queueScope(actor) {
  if (!actor || !hasPermission(actor.role, PERM_READ)) return fail('FORBIDDEN', 'برای مشاهده‌ی دورکاری کارمندان مجوز لازم را ندارید.');
  if (actor.role === 'admin' || actor.role === 'hr') return { ok: true, userIds: null };
  return { ok: true, userIds: usersRepository.listUsers({ managerId: actor.id }).map((u) => u.id) };
}

// ---------- R5-۳: صف بررسی ----------
const QUEUE_STATUSES = ['pending', 'approved', 'rejected', 'all'];
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const isId = (v) => /^\d+$/.test(String(v));

/**
 * پارامترهای صف ⇒ { ok, value } یا fail. بدون دسترسی به DB (به‌جز ctx که از بیرون می‌آید).
 *   status: pending (پیش‌فرض) | approved | rejected | all
 *   week: خالی ⇒ هفته‌ی جاری و هفته‌ی قبل (window=recent) | 'all' ⇒ بدون محدودیت تاریخ | هر تاریخ YYYY-MM-DD ⇒ همان هفته (به شروع هفته‌ی weekStartDay نرمال می‌شود)
 */
function parseQueueQuery(q, ctx) {
  const status = q.status === undefined || q.status === '' ? 'pending' : String(q.status);
  if (!QUEUE_STATUSES.includes(status)) return fail('INVALID_STATUS', 'وضعیت نامعتبر است (pending|approved|rejected|all).');

  let window = 'recent';
  let weekStart = addDays(ctx.thisWeek, -7);
  let weekEnd = addDays(ctx.thisWeek, 6);
  if (q.week !== undefined && q.week !== '') {
    if (q.week === 'all') {
      window = 'all'; weekStart = null; weekEnd = null;
    } else {
      if (typeof q.week !== 'string' || dayNumber(q.week) === null) return fail('INVALID_WEEK', 'هفته نامعتبر است (تاریخ YYYY-MM-DD یا all).');
      window = 'week';
      weekStart = calendarService.weekStartOf(q.week, ctx.settings.weekStartDay);
      weekEnd = addDays(weekStart, 6);
    }
  }

  let userId = null;
  if (q.userId !== undefined && q.userId !== '') {
    if (!isId(q.userId) || Number(q.userId) < 1) return fail('INVALID_USER', 'شناسه‌ی کارمند نامعتبر است.');
    userId = Number(q.userId);
  }

  const limit = q.limit === undefined ? DEFAULT_LIMIT : (isId(q.limit) ? parseInt(q.limit, 10) : NaN);
  const offset = q.offset === undefined ? 0 : (isId(q.offset) ? parseInt(q.offset, 10) : NaN);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) return fail('INVALID_PAGING', `limit باید بین ۱ و ${MAX_LIMIT} باشد.`);
  if (!Number.isInteger(offset)) return fail('INVALID_PAGING', 'offset نامعتبر است.');
  return { ok: true, value: { status, window, weekStart, weekEnd, userId, limit, offset } };
}

const minutesBetween = (a, b) => (Date.parse(b) - Date.parse(a)) / 60000;

// مدت استراحت‌های بسته‌شده و ساعت کار خالص (بر پایه‌ی ساعت‌های ثبت‌شده‌ی کارمند، نه ساعت اصلاح‌شده). نشست باز ⇒ workedMinutes = null.
function sessionMinutes(row, breaks) {
  const breakMinutes = Math.round(breaks.filter((b) => b.end_at).reduce((sum, b) => sum + minutesBetween(b.start_at, b.end_at), 0));
  const workedMinutes = row.end_at ? Math.max(0, Math.round(minutesBetween(row.start_at, row.end_at)) - breakMinutes) : null;
  return { breakMinutes, workedMinutes };
}

function toQueueItem(row, breaks, employee, actor) {
  const { breakMinutes, workedMinutes } = sessionMinutes(row, breaks);
  return {
    id: row.id,
    employee: employee
      ? { id: employee.id, fullName: employee.full_name, personnelCode: employee.personnel_code, department: employee.department || null, managerId: employee.manager_id || null, isActive: !!employee.is_active }
      : null,
    workDate: row.work_date,
    jalaliDate: isoDateToJalaliString(row.work_date),
    startAt: row.start_at,
    endAt: row.end_at,
    isOpen: !row.end_at,
    status: row.status,
    autoClosed: !!row.auto_closed, // «بسته‌شده توسط سیستم» — برای دقت بیشتر سرپرست
    breaks: breaks.map((b) => ({ id: b.id, startAt: b.start_at, endAt: b.end_at })),
    breakMinutes,
    workedMinutes,
    approvedStartAt: row.approved_start_at,
    approvedEndAt: row.approved_end_at,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    reviewNote: row.review_note,
    attendanceRecordId: row.attendance_record_id,
    // «هم‌پوشانی با حضور حضوری»: همان روز کارمند رکورد رسمیِ حضوری (با ورود) هم دارد؛ تأیید فقط با تصمیم صریح (R5-۶)
    overlapsOnsite: row.onsite_record_id !== null && row.onsite_record_id !== undefined,
    onsiteRecord: row.onsite_record_id ? { id: row.onsite_record_id, checkInTime: row.onsite_check_in, checkOutTime: row.onsite_check_out } : null,
    // آیا «همین کاربر» می‌تواند این ثبت را تأیید/رد کند (فقط pending و در اسکوپ تصمیم؛ hr و خود ⇒ false)؛ برای فعال/غیرفعال کردن دکمه‌ها در UI
    canReview: row.status === 'pending' && !!employee && reviewScopeFailure(actor, employee) === null,
  };
}

/**
 * صف بررسی دورکاری (فقط‌خواندنی؛ audit ندارد). اسکوپ: admin/hr همه، سرپرست فقط تیم مستقیمش؛ کارمند ⇒ FORBIDDEN.
 * @param {object} actor ردیف کاربرِ پنل
 * @param {object} [query] { status, week, userId, limit, offset } — معنی هر کدام در parseQueueQuery
 * @param {{now?: Date}} [opts]
 * @returns {{ok:true, items:object[], total:number, limit:number, offset:number, status:string, window:'recent'|'week'|'all', weekStart:string|null, weekEnd:string|null}|{ok:false, code:string, error:string, status:number}}
 */
function listQueue(actor, query = {}, { now } = {}) {
  const scope = queueScope(actor);
  if (!scope.ok) return scope;
  const ctx = weeklyPlan.context(now);
  const parsed = parseQueueQuery(query || {}, ctx);
  if (!parsed.ok) return parsed;
  const f = parsed.value;
  if (f.userId !== null) {
    const allowed = checkRead(actor, f.userId); // وجود کاربر + اسکوپ تیم (USER_NOT_FOUND / NOT_IN_SCOPE)
    if (!allowed.ok) return allowed;
  }
  const { rows, total } = remoteRepo.listQueue({
    userIds: scope.userIds,
    status: f.status === 'all' ? null : f.status,
    from: f.weekStart,
    to: f.weekEnd,
    userId: f.userId,
    limit: f.limit,
    offset: f.offset,
  });
  const breaks = remoteRepo.listBreaksForSessions(rows.map((r) => r.id));
  const users = new Map();
  const employeeOf = (id) => {
    if (!users.has(id)) users.set(id, usersRepository.findById(id) || null);
    return users.get(id);
  };
  const items = rows.map((r) => toQueueItem(r, breaks.get(r.id) || [], employeeOf(r.user_id), actor));
  return { ok: true, items, total, limit: f.limit, offset: f.offset, status: f.status, window: f.window, weekStart: f.weekStart, weekEnd: f.weekEnd };
}

/** مثل readScopeFailure ولی کاربر را از دیتابیس می‌خواند (برای routeهایی که فقط userId دارند). */
function checkRead(actor, userId) {
  const target = usersRepository.findById(Number(userId)) || null;
  const f = readScopeFailure(actor, target);
  return f || { ok: true, target };
}

/** مثل reviewScopeFailure ولی کاربر را از دیتابیس می‌خواند. */
function checkReview(actor, userId) {
  const target = usersRepository.findById(Number(userId)) || null;
  const f = reviewScopeFailure(actor, target);
  return f || { ok: true, target };
}

// ---------- R5-۴: تأیید تکی ----------
// تصمیم‌های طراحی (مستند در PHASE14_DECISIONS در R5-۷):
//  • تأیید = داخل «یک» تراکنش: ساخت/به‌روزرسانی رکورد رسمی (via_remote = 1) + انتقال استراحت‌ها (break_records.via_remote = 1) + پر شدن reviewed_* + audit.
//  • attendance_records به ازای هر کاربر/روز فقط یک ردیف دارد (UNIQUE). پس رکورد رسمی هر روز «از روی همه‌ی نشست‌های تأییدشده‌ی همان روز» ساخته می‌شود:
//    ورود = زودترین شروع، خروج = دیرترین پایان، استراحت‌ها = استراحت‌های خود نشست‌ها + «فاصله‌ی بین دو نشست» (تا فاصله کار حساب نشود).
//  • idempotent: نشستِ approved دوباره تأیید شود ⇒ ok با alreadyApproved = true و هیچ رکورد/audit تازه‌ای نمی‌سازد.
//  • اصلاح ساعت: approvedStartAt / approvedEndAt (ISO). فقط یکی بیاید، دیگری همان ساعت ثبت‌شده است. نتیجه‌ی نهایی باید پایان > شروع، حداکثر ۲۴ ساعت و پایان نه در آینده باشد.
//    استراحت‌ها به بازه‌ی اصلاح‌شده بریده می‌شوند (بیرونِ بازه حذف).
//  • ماه بسته (روزِ کاری نشست) ⇒ MONTH_CLOSED (۴۰۹) بدون هیچ تغییری.
//  • هم‌پوشانی با حضور حضوری (رکورد رسمیِ دارای ورود و via_remote = 0 در همان روز) ⇒ ONSITE_OVERLAP (۴۰۹) مگر با تصمیم صریح (R5-۶: merge | keep_onsite).
//  • نشستِ باز (بدون پایان) ⇒ SESSION_OPEN؛ نشستِ رد‌شده ⇒ NOT_PENDING؛ همپوشانی ساعتِ دو نشستِ تأییدشده‌ی یک روز ⇒ TIME_CONFLICT.
const MAX_NOTE = 500;
const MAX_SPAN_MS = 24 * 3600 * 1000;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

// ورودی زمان اصلاحی ⇒ ISO/UTC نرمال (همان قالب toISOString ذخیره‌شده) | null (نیامده) | undefined (نامعتبر)
function normalizeIso(v) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || !ISO_RE.test(v)) return undefined;
  const t = Date.parse(v);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
}

function normalizeNote(v) {
  if (v === undefined || v === null) return { ok: true, note: null };
  if (typeof v !== 'string') return { ok: false };
  const t = v.trim();
  if (t.length > MAX_NOTE) return { ok: false };
  return { ok: true, note: t || null };
}

const effStart = (s) => s.approved_start_at || s.start_at;
const effEnd = (s) => s.approved_end_at || s.end_at;

// استراحت‌های یک نشست بریده‌شده به بازه‌ی مؤثر؛ استراحتِ باز (نباید باشد) تا پایان نشست حساب می‌شود
function clippedBreaks(session, start, end) {
  const out = [];
  for (const b of remoteRepo.listBreaks(session.id)) {
    const bs = b.start_at > start ? b.start_at : start;
    const be0 = b.end_at || end;
    const be = be0 < end ? be0 : end;
    if (be > bs) out.push({ start: bs, end: be });
  }
  return out;
}

/**
 * رکورد رسمیِ یک روز را از روی «همه‌ی نشست‌های approvedِ آن روز» می‌سازد/به‌روز می‌کند. داخل تراکنشِ فراخواننده اجرا شود.
 * ⇒ { ok:true, recordId } | fail(ONSITE_OVERLAP)
 */
function syncOfficialRecord(userId, workDate, ip) {
  const sessions = remoteRepo.listApprovedForDay(userId, workDate);
  const spans = sessions.map((s) => ({ s, start: effStart(s), end: effEnd(s) })).sort((a, b) => (a.start < b.start ? -1 : 1));
  const breaks = [];
  for (let i = 0; i < spans.length; i += 1) {
    breaks.push(...clippedBreaks(spans[i].s, spans[i].start, spans[i].end));
    if (i > 0 && spans[i].start > spans[i - 1].end) breaks.push({ start: spans[i - 1].end, end: spans[i].start });
  }
  const checkIn = spans[0].start;
  const checkOut = spans.reduce((m, x) => (x.end > m ? x.end : m), spans[0].end);

  const existing = remoteRepo.findOfficialRecord(userId, workDate);
  let recordId;
  if (!existing) {
    recordId = remoteRepo.insertRemoteRecord({ userId, date: workDate, checkIn, checkOut, ip: spans[0].s.ip_address || ip });
  } else if (existing.via_remote === 1) {
    recordId = existing.id;
    remoteRepo.updateRemoteRecord(recordId, { checkIn, checkOut });
  } else if (!existing.check_in_time) {
    recordId = existing.id; // جانگهدار مرخصی/تعطیل
    remoteRepo.adoptPlaceholder(recordId, { checkIn, checkOut, ip: spans[0].s.ip_address || ip });
  } else {
    return fail('ONSITE_OVERLAP', 'این کارمند در همان روز حضور حضوری هم دارد؛ تأیید دورکاری برای این روز نیاز به تصمیم صریح دارد.');
  }
  remoteRepo.replaceRemoteBreaks(recordId, breaks);
  return { ok: true, recordId };
}

const DECISIONS = ['merge', 'keep_onsite'];
const KEEP_ONSITE_PREFIX = 'حضور حضوری معتبر ماند: ';

function rollbackWith(failure) { const e = new Error('rollback'); e.fail = failure; throw e; }

// ورودیِ «تصمیم هم‌پوشانی» ⇒ { ok, decision|null }
function normalizeDecision(v) {
  if (v === undefined || v === null || v === '') return { ok: true, decision: null };
  return typeof v === 'string' && DECISIONS.includes(v) ? { ok: true, decision: v } : { ok: false };
}

function auditSession(row) { return { status: row.status, startAt: row.start_at, endAt: row.end_at, attendanceRecordId: row.attendance_record_id || null }; }

/** رد داخل تراکنشِ فراخواننده (R5-۵؛ مسیر «keep_onsite» در R5-۶ هم از همین استفاده می‌کند). */
function applyReject(actor, row, note, { ip, nowIso, meta = {} }) {
  const changed = remoteRepo.markRejected(row.id, { reviewedBy: actor.id, reviewedAt: nowIso, reviewNote: note });
  if (changed !== 1) return fail('NOT_PENDING', 'وضعیت این ثبت هم‌زمان تغییر کرد؛ صفحه را تازه کنید.');
  const after = remoteRepo.findSessionFull(row.id);
  auditRepository.logChange({
    actor: actor.id, action: 'remote_work_reject', entityType: 'remote_work_session', entityId: row.id,
    before: auditSession(row), after: auditSession(after), reason: note, ip,
    meta: { source: 'admin_panel', targetUserId: row.user_id, sessionId: row.id, workDate: row.work_date, ...meta },
  });
  return { ok: true, rejected: after };
}

/**
 * تأیید «یک» نشست دورکاری (داخل تراکنش).
 * ورودی: { approvedStartAt?, approvedEndAt?, reviewNote?, overlapDecision? }
 *   overlapDecision فقط وقتی همان روز رکورد رسمیِ حضوری (با ورود) هست و «اجباری» است (R5-۶؛ بدون آن ⇒ ONSITE_OVERLAP):
 *     'merge'       ⇒ ساعت دورکاری به رکورد حضوری اضافه می‌شود (اجتماع بازه‌ها؛ ورود = زودترین، خروج = دیرترین؛ فاصله‌ی بین دو بازه استراحت؛
 *                      استراحت‌های دورکاری که با بازه‌ی حضوری برخورد دارند حذف می‌شوند). رکورد همچنان via_remote = 0 می‌ماند. نیازمند خروجِ ثبت‌شده‌ی حضوری.
 *     'keep_onsite' ⇒ حضوری معتبر می‌ماند و این نشست رد می‌شود (هیچ تغییری در رکورد رسمی).
 *   هر دو تصمیم review_note اجباری دارند و علاوه بر audit عادی، رکورد remote_work_overlap_decision می‌نویسند.
 */
function approveInner(actor, sessionId, input = {}, { ip = null, now = new Date() } = {}) {
  if (!actor || !hasPermission(actor.role, PERM_REVIEW)) return fail('FORBIDDEN', 'برای تأیید یا رد دورکاری مجوز لازم را ندارید.');
  if (!isId(sessionId) || Number(sessionId) < 1) return fail('SESSION_NOT_FOUND', 'ثبت دورکاری یافت نشد.');
  const body = input && typeof input === 'object' ? input : {};
  const startIn = normalizeIso(body.approvedStartAt);
  const endIn = normalizeIso(body.approvedEndAt);
  if (startIn === undefined || endIn === undefined) return fail('INVALID_TIME', 'ساعت اصلاح‌شده نامعتبر است (قالب ISO مثل 2026-10-14T08:30:00Z).');
  const noteR = normalizeNote(body.reviewNote);
  if (!noteR.ok) return fail('INVALID_NOTE', `یادداشت باید رشته و حداکثر ${MAX_NOTE} نویسه باشد.`);
  const decR = normalizeDecision(body.overlapDecision);
  if (!decR.ok) return fail('INVALID_DECISION', 'تصمیم هم‌پوشانی نامعتبر است (merge|keep_onsite).');

  const nowIso = now.toISOString();
  return getDb().transaction(() => {
    const row = remoteRepo.findSessionFull(Number(sessionId));
    if (!row) return fail('SESSION_NOT_FOUND', 'ثبت دورکاری یافت نشد.');
    const target = usersRepository.findById(row.user_id) || null;
    const denied = reviewScopeFailure(actor, target);
    if (denied) return denied;

    if (row.status === 'approved') {
      return { ok: true, alreadyApproved: true, session: presentSession(row), attendanceRecordId: row.attendance_record_id };
    }
    if (row.status !== 'pending') return fail('NOT_PENDING', 'این ثبت قبلاً رد شده است و قابل تأیید نیست.');
    if (!row.end_at) return fail('SESSION_OPEN', 'این نشست هنوز بسته نشده است (خروج ثبت نشده)؛ پس از پایان نشست قابل تأیید است.');
    if (monthClosuresRepository.findClosedOverlapping(row.work_date, row.work_date).length > 0) {
      return fail('MONTH_CLOSED', 'روز این دورکاری در ماهِ بسته‌شده است و تأیید آن ممکن نیست.');
    }

    const start = startIn || row.start_at;
    const end = endIn || row.end_at;
    if (end <= start) return fail('INVALID_TIME', 'پایان باید بعد از شروع باشد.');
    if (Date.parse(end) - Date.parse(start) > MAX_SPAN_MS) return fail('INVALID_TIME', 'بازه‌ی تأییدشده نباید بیش از ۲۴ ساعت باشد.');
    if (end > nowIso) return fail('INVALID_TIME', 'پایان تأییدشده نمی‌تواند در آینده باشد.');

    // هم‌پوشانی ساعتِ دو نشستِ تأییدشده‌ی همان روز (نشست‌های دیگر؛ همین نشست هنوز pending است)
    const clash = remoteRepo.listApprovedForDay(row.user_id, row.work_date).some((o) => start < effEnd(o) && effStart(o) < end);
    if (clash) return fail('TIME_CONFLICT', 'ساعت این نشست با نشست تأییدشده‌ی دیگری در همان روز هم‌پوشانی دارد.');

    // ---- R5-۶: هم‌پوشانی با حضور حضوری ----
    const existing = remoteRepo.findOfficialRecord(row.user_id, row.work_date);
    const overlap = Boolean(existing && existing.via_remote === 0 && existing.check_in_time);
    const decision = decR.decision;
    if (decision && !overlap) return fail('NO_OVERLAP', 'این روز هم‌پوشانی با حضور حضوری ندارد؛ تصمیم هم‌پوشانی معنی ندارد.');
    if (overlap && !decision) {
      return fail('ONSITE_OVERLAP', 'این کارمند در همان روز حضور حضوری هم دارد؛ تأیید نیاز به تصمیم صریح دارد (overlap_decision = merge | keep_onsite) همراه با یادداشت.');
    }
    if (overlap && !noteR.note) return fail('REVIEW_NOTE_REQUIRED', 'برای تصمیم در هم‌پوشانی با حضور حضوری، یادداشت (review_note) الزامی است.');

    const decisionAudit = (outcome, extra = {}) => auditRepository.logChange({
      actor: actor.id, action: 'remote_work_overlap_decision', entityType: 'remote_work_session', entityId: row.id,
      before: null, after: { decision, outcome }, reason: noteR.note, ip,
      meta: { source: 'admin_panel', targetUserId: row.user_id, sessionId: row.id, workDate: row.work_date, onsiteRecordId: existing && existing.id, ...extra },
    });

    if (overlap && decision === 'keep_onsite') {
      const rej = applyReject(actor, row, `${KEEP_ONSITE_PREFIX}${noteR.note}`.slice(0, MAX_NOTE), { ip, nowIso, meta: { overlapDecision: 'keep_onsite' } });
      if (!rej.ok) return rej;
      decisionAudit('rejected');
      return { ok: true, alreadyApproved: false, decision, outcome: 'rejected', session: presentSession(rej.rejected), attendanceRecordId: null, _rejected: rej.rejected };
    }

    const approvedStartAt = startIn && startIn !== row.start_at ? startIn : null;
    const approvedEndAt = endIn && endIn !== row.end_at ? endIn : null;
    let recordId;
    if (overlap) { // merge
      if (!existing.check_out_time) return fail('ONSITE_NOT_CLOSED', 'خروج حضوریِ همان روز هنوز ثبت نشده؛ ادغام ممکن نیست.');
      const changedM = remoteRepo.markApproved(row.id, { reviewedBy: actor.id, reviewedAt: nowIso, reviewNote: noteR.note, approvedStartAt, approvedEndAt, attendanceRecordId: existing.id });
      if (changedM !== 1) return fail('NOT_PENDING', 'وضعیت این ثبت هم‌زمان تغییر کرد؛ صفحه را تازه کنید.');
      const inT = existing.check_in_time; const outT = existing.check_out_time;
      const breaks = [];
      if (start > outT) breaks.push({ start: outT, end: start });
      if (end < inT) breaks.push({ start: end, end: inT });
      for (const b of clippedBreaks(row, start, end)) if (b.end <= inT || b.start >= outT) breaks.push(b);
      remoteRepo.updateRecordTimes(existing.id, { checkIn: start < inT ? start : inT, checkOut: end > outT ? end : outT });
      remoteRepo.insertRemoteBreaks(existing.id, breaks);
      recordId = existing.id;
    } else {
      const changed = remoteRepo.markApproved(row.id, { reviewedBy: actor.id, reviewedAt: nowIso, reviewNote: noteR.note, approvedStartAt, approvedEndAt, attendanceRecordId: null });
      if (changed !== 1) return fail('NOT_PENDING', 'وضعیت این ثبت هم‌زمان تغییر کرد؛ صفحه را تازه کنید.');
      const synced = syncOfficialRecord(row.user_id, row.work_date, ip);
      if (!synced.ok) rollbackWith(synced); // تراکنش کامل برمی‌گردد
      recordId = synced.recordId;
      // نشست‌های تأییدشده‌ی دیگرِ همان روز هم به همین رکورد اشاره می‌کنند
      getDb().prepare("UPDATE remote_work_sessions SET attendance_record_id = ? WHERE user_id = ? AND work_date = ? AND status = 'approved'").run(recordId, row.user_id, row.work_date);
    }

    const after = remoteRepo.findSessionFull(row.id);
    auditRepository.logChange({
      actor: actor.id, action: 'remote_work_approve', entityType: 'remote_work_session', entityId: row.id,
      before: { status: 'pending', startAt: row.start_at, endAt: row.end_at, attendanceRecordId: null },
      after: { status: 'approved', startAt: effStart(after), endAt: effEnd(after), attendanceRecordId: recordId },
      reason: noteR.note, ip,
      meta: { source: 'admin_panel', targetUserId: row.user_id, sessionId: row.id, workDate: row.work_date, recordId, timeAdjusted: Boolean(approvedStartAt || approvedEndAt), overlapDecision: decision },
    });
    if (overlap) decisionAudit('approved_merged', { recordId });
    return { ok: true, alreadyApproved: false, decision, outcome: overlap ? 'merged' : 'approved', session: presentSession(after), attendanceRecordId: recordId };
  })();
}

// تابع عمومی تأیید: خطای rollback داخلی (مثلاً ONSITE_OVERLAP بعد از نوشتن) ⇒ نتیجه‌ی fail اصلی؛ تراکنش قبلاً کامل برگشته است.
// ردِ ناشی از keep_onsite بعد از commit اعلان می‌گیرد.
// options.notify = false ⇒ پیام تأیید فرستاده نمی‌شود (تأیید دسته‌ای خودش «یک» پیام تجمیعی برای هر کارمند می‌فرستد).
function approve(...args) {
  let r;
  try { r = approveInner(...args); } catch (err) { if (err && err.fail) return err.fail; throw err; }
  if (r && r._rejected) { notifyRejected(r._rejected, args[2] && args[2].reviewNote, args[0]); delete r._rejected; }
  if (r && r.ok && !r.alreadyApproved && r.outcome !== 'rejected' && !(args[3] && args[3].notify === false)) notifyApproved(r.session.id, args[2] && args[2].reviewNote, args[0]);
  return r;
}

function notifyApproved(sessionId, note, actor) {
  try {
    require('./notificationEvents').remoteWorkApproved(sessionId, { note, actor }).catch(() => {}); // هرگز جریان اصلی را نمی‌شکند
  } catch (err) { console.error('[remoteWorkAdmin] اعلان تأیید ناموفق (نادیده گرفته شد):', err && err.message); }
}

function notifyRejected(session, note, actor) {
  try {
    require('./notificationEvents').remoteWorkRejected(session, { note, actor }).catch(() => {}); // هرگز جریان اصلی را نمی‌شکند
  } catch (err) { console.error('[remoteWorkAdmin] اعلان رد ناموفق (نادیده گرفته شد):', err && err.message); }
}

/**
 * R5-۵: رد یک نشست دورکاری. review_note اجباری؛ رکورد رسمی ساخته نمی‌شود؛ کارمند اعلان می‌گیرد (بعد از commit).
 * idempotent: نشستِ rejected دوباره رد شود ⇒ ok با alreadyRejected = true (بدون audit/اعلان تازه). approved ⇒ NOT_PENDING؛ باز ⇒ SESSION_OPEN.
 */
function reject(actor, sessionId, input = {}, { ip = null, now = new Date() } = {}) {
  if (!actor || !hasPermission(actor.role, PERM_REVIEW)) return fail('FORBIDDEN', 'برای تأیید یا رد دورکاری مجوز لازم را ندارید.');
  if (!isId(sessionId) || Number(sessionId) < 1) return fail('SESSION_NOT_FOUND', 'ثبت دورکاری یافت نشد.');
  const body = input && typeof input === 'object' ? input : {};
  const noteR = normalizeNote(body.reviewNote);
  if (!noteR.ok) return fail('INVALID_NOTE', `یادداشت باید رشته و حداکثر ${MAX_NOTE} نویسه باشد.`);
  if (!noteR.note) return fail('REVIEW_NOTE_REQUIRED', 'برای رد دورکاری نوشتن دلیل (review_note) الزامی است.');
  const nowIso = now.toISOString();
  const r = getDb().transaction(() => {
    const row = remoteRepo.findSessionFull(Number(sessionId));
    if (!row) return fail('SESSION_NOT_FOUND', 'ثبت دورکاری یافت نشد.');
    const denied = reviewScopeFailure(actor, usersRepository.findById(row.user_id) || null);
    if (denied) return denied;
    if (row.status === 'rejected') return { ok: true, alreadyRejected: true, session: presentSession(row) };
    if (row.status !== 'pending') return fail('NOT_PENDING', 'این ثبت قبلاً تأیید شده است و قابل رد نیست.');
    if (!row.end_at) return fail('SESSION_OPEN', 'این نشست هنوز بسته نشده است (خروج ثبت نشده)؛ پس از پایان نشست قابل رد است.');
    const rej = applyReject(actor, row, noteR.note, { ip, nowIso });
    if (!rej.ok) return rej;
    return { ok: true, alreadyRejected: false, session: presentSession(rej.rejected), _rejected: rej.rejected };
  })();
  if (r && r._rejected) { notifyRejected(r._rejected, noteR.note, actor); delete r._rejected; }
  return r;
}

// ---------- R5-۷: تأیید دسته‌ای ----------
const BATCH_MAX = 500;

/**
 * تأیید دسته‌ایِ نشست‌های «pending» یک کارمند و/یا یک هفته. حداقل یکی از userId / week الزامی است (بدون هیچ‌کدام ⇒ BATCH_SCOPE_REQUIRED).
 * هر نشست در تراکنش جدا و با همان قواعد approve تأیید می‌شود (بدون اصلاح ساعت و بدون تصمیم هم‌پوشانی)؛ نشست‌هایی که نمی‌شوند
 * (باز، هم‌پوشانی با حضوری، ماه بسته، خارج از اسکوپ، …) با کدشان در skipped می‌آیند و بقیه ادامه می‌یابند. idempotent: اجرای دوباره چیزی نمی‌یابد.
 * @param {{userId?:number|string, week?:string, reviewNote?:string}} input
 * @returns {{ok:true, approved:number, skipped:{id:number, code:string, error:string}[], total:number, truncated:boolean, weekStart:string|null, weekEnd:string|null}|{ok:false,...}}
 */
function approveBatch(actor, input = {}, { ip = null, now = new Date() } = {}) {
  if (!actor || !hasPermission(actor.role, PERM_REVIEW)) return fail('FORBIDDEN', 'برای تأیید یا رد دورکاری مجوز لازم را ندارید.');
  const q = input && typeof input === 'object' ? input : {};
  const hasUser = q.userId !== undefined && q.userId !== null && q.userId !== '';
  const hasWeek = q.week !== undefined && q.week !== null && q.week !== '';
  if (!hasUser && !hasWeek) return fail('BATCH_SCOPE_REQUIRED', 'برای تأیید دسته‌ای کارمند (userId) یا هفته (week) را مشخص کنید.');
  const noteR = normalizeNote(q.reviewNote);
  if (!noteR.ok) return fail('INVALID_NOTE', `یادداشت باید رشته و حداکثر ${MAX_NOTE} نویسه باشد.`);

  const ctx = weeklyPlan.context(now);
  let weekStart = null; let weekEnd = null;
  if (hasWeek) {
    if (typeof q.week !== 'string' || dayNumber(q.week) === null) return fail('INVALID_WEEK', 'هفته نامعتبر است (تاریخ YYYY-MM-DD).');
    weekStart = calendarService.weekStartOf(q.week, ctx.settings.weekStartDay);
    weekEnd = addDays(weekStart, 6);
  }
  let userId = null;
  if (hasUser) {
    if (!isId(q.userId) || Number(q.userId) < 1) return fail('INVALID_USER', 'شناسه‌ی کارمند نامعتبر است.');
    const chk = checkReview(actor, q.userId); // وجود + اسکوپ + خود ممنوع
    if (!chk.ok) return chk;
    userId = Number(q.userId);
  }
  const scope = queueScope(actor);
  if (!scope.ok) return scope;

  const { rows, total } = remoteRepo.listQueue({ userIds: scope.userIds, status: 'pending', from: weekStart, to: weekEnd, userId, limit: BATCH_MAX, offset: 0 });
  let approved = 0;
  const skipped = [];
  const approvedByUser = new Map(); // userId → [sessionId]؛ برای «یک» پیام تجمیعی به هر کارمند
  for (const r of rows) {
    const res = approve(actor, r.id, { reviewNote: noteR.note }, { ip, now, notify: false });
    if (res.ok) {
      if (!res.alreadyApproved) {
        approved += 1;
        if (res.outcome !== 'rejected') {
          if (!approvedByUser.has(r.user_id)) approvedByUser.set(r.user_id, []);
          approvedByUser.get(r.user_id).push(r.id);
        }
      }
    } else skipped.push({ id: r.id, code: res.code, error: res.error });
  }
  for (const [uid, ids] of approvedByUser) {
    try {
      require('./notificationEvents').remoteWorkBatchApproved(uid, ids, { actor, note: noteR.note }).catch(() => {});
    } catch (err) { console.error('[remoteWorkAdmin] اعلان تأیید دسته‌ای ناموفق (نادیده گرفته شد):', err && err.message); }
  }
  auditRepository.logEvent({
    userId: actor.id, action: 'remote_work_batch_approve', ipAddress: ip,
    details: { source: 'admin_panel', userId, weekStart, weekEnd, approved, skipped: skipped.length, total },
  });
  return { ok: true, approved, skipped, total, truncated: total > rows.length, weekStart, weekEnd };
}

function presentSession(r) {
  return {
    id: r.id, userId: r.user_id, workDate: r.work_date, status: r.status, startAt: r.start_at, endAt: r.end_at,
    approvedStartAt: r.approved_start_at, approvedEndAt: r.approved_end_at, reviewedBy: r.reviewed_by, reviewedAt: r.reviewed_at,
    reviewNote: r.review_note, attendanceRecordId: r.attendance_record_id,
  };
}

// ---------- ثبت دستی دورکاری توسط ادمین ----------
// فقط remote_work.create (فقط admin). ساخت نشست «بسته» + تأیید در «یک» تراکنش با همان approveInner (همان قواعد: ماه بسته، آینده/۲۴ ساعت،
// TIME_CONFLICT، هم‌پوشانی با حضوری که فقط با overlap_decision = merge ممکن است). هر شکستی ⇒ rollback کامل (نه نشستی می‌ماند نه رکوردی).
// دلیل ثبت (note) الزامی و در audit می‌ماند؛ ثبت برای خودِ ادمین ممنوع (SELF_NOT_ALLOWED؛ همان اصل «هیچ‌کس دورکاری خودش را تأیید نمی‌کند»).
// نشست ساخته‌شده source='miniapp' (ستون source فقط miniapp|bot را می‌پذیرد)؛ تشخیص «دستی» از audit (remote_work_manual_create) است.
function workDateOf(userId, startIso) {
  const shift = shiftsRepository.findByUserId(userId);
  if (!isOvernightShift(shift)) return formatDate(startIso);
  const s = settingsRepository.getAll();
  return shiftRecordDate(new Date(startIso), shift, { timezone: s.timezone, marginMinutes: s.outsideShiftMarginMinutes });
}

function createManual(actor, input = {}, { ip = null, now = new Date() } = {}) {
  if (!actor || !hasPermission(actor.role, PERM_CREATE)) return fail('FORBIDDEN', 'فقط ادمین می‌تواند دورکاری را دستی ثبت کند.');
  const body = input && typeof input === 'object' ? input : {};
  if (!isId(body.userId) || Number(body.userId) < 1) return fail('USER_NOT_FOUND', 'کارمند یافت نشد.');
  const target = usersRepository.findById(Number(body.userId));
  if (!target) return fail('USER_NOT_FOUND', 'کارمند یافت نشد.');
  if (target.id === actor.id) return fail('SELF_NOT_ALLOWED', 'ثبت دستی دورکاری برای خودتان ممکن نیست؛ ادمین دیگری باید آن را ثبت کند.');

  const start = normalizeIso(body.startAt);
  const end = normalizeIso(body.endAt);
  if (!start || !end) return fail('INVALID_TIME', 'ساعت شروع و پایان الزامی و باید معتبر باشد (قالب ISO مثل 2026-10-14T08:30:00Z).');
  if (end <= start) return fail('INVALID_TIME', 'پایان باید بعد از شروع باشد.');
  if (Date.parse(end) - Date.parse(start) > MAX_SPAN_MS) return fail('INVALID_TIME', 'بازه‌ی دورکاری نباید بیش از ۲۴ ساعت باشد.');
  if (end > now.toISOString()) return fail('INVALID_TIME', 'پایان دورکاری نمی‌تواند در آینده باشد.');
  const noteR = normalizeNote(body.note);
  if (!noteR.ok) return fail('INVALID_NOTE', `دلیل ثبت باید رشته و حداکثر ${MAX_NOTE} نویسه باشد.`);
  if (!noteR.note) return fail('REVIEW_NOTE_REQUIRED', 'دلیل ثبت دستی الزامی است.');
  const decR = normalizeDecision(body.overlapDecision);
  if (!decR.ok || decR.decision === 'keep_onsite') return fail('INVALID_DECISION', 'تصمیم هم‌پوشانی نامعتبر است (فقط merge یا خالی).');

  let result;
  try {
    result = getDb().transaction(() => {
      const workDate = workDateOf(target.id, start);
      const session = remoteRepo.insertClosedSession({ userId: target.id, workDate, startAt: start, endAt: end, ip });
      const ap = approveInner(actor, session.id, { reviewNote: noteR.note, overlapDecision: decR.decision }, { ip, now });
      if (!ap.ok) rollbackWith(ap);
      auditRepository.logChange({
        actor: actor.id, action: 'remote_work_manual_create', entityType: 'remote_work_session', entityId: session.id,
        before: null, after: { status: 'approved', startAt: start, endAt: end, attendanceRecordId: ap.attendanceRecordId },
        reason: noteR.note, ip,
        meta: { source: 'admin_panel', targetUserId: target.id, sessionId: session.id, workDate, recordId: ap.attendanceRecordId, overlapDecision: decR.decision },
      });
      return ap;
    })();
  } catch (err) { if (err && err.fail) return err.fail; throw err; }
  notifyApproved(result.session.id, noteR.note, actor);
  return result;
}

// ---------- R6: خلاصه‌ی «منتظر بررسی» (شمارنده‌ی پنل، آیتم منوی بات، یادآوری هفتگی) ----------
/**
 * نشست‌های بسته‌شده‌ی pending در اسکوپ actor (admin/hr همه، سرپرست تیم مستقیم)، بدون دورکاریِ خودِ actor. فقط‌خواندنی، بدون audit.
 * @returns {{ok:true, total:number, employees:{userId:number, fullName:string, count:number, oldestWorkDate:string}[]}|{ok:false,...}}
 */
function pendingSummary(actor) {
  const scope = queueScope(actor);
  if (!scope.ok) return scope;
  return summaryFor(scope.userIds, actor.id);
}

function summaryFor(userIds, excludeUserId) {
  const rows = remoteRepo.pendingClosedByUser({ userIds, excludeUserId });
  const employees = rows.map((r) => {
    const u = usersRepository.findById(r.user_id);
    return { userId: r.user_id, fullName: u ? u.full_name : `#${r.user_id}`, count: r.n, oldestWorkDate: r.oldest };
  });
  return { ok: true, total: employees.reduce((a, e) => a + e.count, 0), employees };
}

/**
 * گیرنده‌های یادآوری هفتگی (job): هر سرپرستِ فعال برای تیم مستقیمش؛ ادمین‌های فعال فقط برای کارمندانی که سرپرستِ فعال ندارند
 * (تا ادمین‌ها با صف همه‌ی تیم‌ها پر نشوند). فقط گیرنده‌هایی که چیزی منتظر دارند. ⇒ [{ user, summary }]
 */
function reminderTargets() {
  const active = usersRepository.listUsers({ onlyActive: true });
  const activeManagerIds = new Set(active.filter((u) => u.role === 'manager').map((u) => u.id));
  const out = [];
  for (const m of active.filter((u) => u.role === 'manager')) {
    const sum = summaryFor(active.filter((u) => u.manager_id === m.id).map((u) => u.id), m.id);
    if (sum.total > 0) out.push({ user: m, summary: sum });
  }
  const orphanIds = active.filter((u) => !u.manager_id || !activeManagerIds.has(u.manager_id)).map((u) => u.id);
  for (const a of active.filter((u) => u.role === 'admin')) {
    const sum = summaryFor(orphanIds, a.id);
    if (sum.total > 0) out.push({ user: a, summary: sum });
  }
  return out;
}

module.exports = { PERM_READ, PERM_REVIEW, PERM_CREATE, createManual, statusOf, readScopeFailure, reviewScopeFailure, queueScope, checkRead, checkReview, listQueue, approve, reject, approveBatch, pendingSummary, reminderTargets };

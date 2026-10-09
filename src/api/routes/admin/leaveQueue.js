// صف تأیید مرخصی/مأموریت (S4-13a): فهرست فیلترشده با مانده‌ی کارمند و لینک پیوست + تأیید/رد دسته‌جمعی.
// مجوز: leave.approve (سرپرست/ادمین) یا leave.approve.hr (hr). کارمند ⇒ ۴۰۳ (گارد مجوز + لیست سفید کارمند).
// اسکوپ سمت سرور (مثل بقیه‌ی routeها با scopedUserIds):
//   سرپرست = فقط تیم مستقیم خودش | admin و hr = همه (hr فقط‌خواندنی؛ تصمیم او فقط روی مرحله‌ی hr و با leaveApprovalService.canDecide).
// این route جایگزین GET /admin/leave-requests نیست؛ آن بدون تغییر برای فهرست ساده و کارمند می‌ماند.
// تصمیم دسته‌جمعی «بخشی‌موفق» است: هر درخواست مستقل (تراکنش خودش، audit و اعلان خودش) و نتیجه‌ی هر یک جدا برمی‌گردد؛
// یک درخواست ممنوع/تمام‌شده بقیه را نمی‌اندازد. تصمیم هر درخواست دقیقاً مثل route تکی است (leaveDecision.applyDecision).

const express = require('express');
const router = express.Router();

const { requireAnyPermission } = require('../../../middleware/permissions');
const usersRepository = require('../../../repositories/usersRepository');
const leaveRepository = require('../../../repositories/leaveRepository');
const leaveTypesRepository = require('../../../repositories/leaveTypesRepository');
const leaveApprovalService = require('../../../services/leaveApprovalService');
const leaveBalanceService = require('../../../services/leaveBalanceService');
const { formatMinutes } = require('../../../utils/leaveBalanceFormat');
const { jalaliYearOfDateString } = require('../../../utils/jalali');
const { DATE_RE, scopedUserIds, audit } = require('./common');
const { applyDecision, normalizeNote } = require('./leaveDecision');

const QUEUE_PERMS = ['leave.approve', 'leave.approve.hr'];
const STATUSES = ['pending', 'approved', 'rejected', 'all'];
const KINDS = ['leave', 'mission'];
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MAX_BULK = 50; // سقف تعداد درخواست در یک تصمیم دسته‌جمعی

const bad = (res, code, error) => res.status(400).json({ error, code });
const isId = (v) => /^\d+$/.test(String(v));

// پارامترهای فهرست ⇒ { ok, value } یا { ok:false, code, error }
function parseQuery(q) {
  const status = q.status === undefined ? 'pending' : String(q.status);
  if (!STATUSES.includes(status)) return { ok: false, code: 'INVALID_STATUS', error: 'وضعیت نامعتبر است (pending|approved|rejected|all).' };
  const out = { status };
  if (q.kind !== undefined) {
    if (!KINDS.includes(String(q.kind))) return { ok: false, code: 'INVALID_KIND', error: 'نوع نامعتبر است (leave|mission).' };
    out.kind = String(q.kind);
  }
  if (q.leaveTypeId !== undefined) {
    if (!isId(q.leaveTypeId)) return { ok: false, code: 'INVALID_TYPE', error: 'شناسه‌ی نوع مرخصی نامعتبر است.' };
    out.leaveTypeId = parseInt(q.leaveTypeId, 10);
  }
  for (const key of ['from', 'to']) {
    if (q[key] === undefined || q[key] === '') continue;
    if (!DATE_RE.test(String(q[key]))) return { ok: false, code: 'INVALID_DATE', error: `تاریخ ${key} باید به شکل YYYY-MM-DD باشد.` };
    out[key] = String(q[key]);
  }
  if (out.from && out.to && out.from > out.to) return { ok: false, code: 'INVALID_DATE', error: 'تاریخ شروع فیلتر بعد از تاریخ پایان است.' };
  if (q.team !== undefined && q.team !== '') {
    if (q.team !== 'mine' && !isId(q.team)) return { ok: false, code: 'INVALID_TEAM', error: 'تیم نامعتبر است (شناسه‌ی سرپرست یا mine).' };
    out.team = q.team === 'mine' ? 'mine' : parseInt(q.team, 10);
  }
  if (q.decidable !== undefined && !['0', '1', 'true', 'false'].includes(String(q.decidable))) return { ok: false, code: 'INVALID_DECIDABLE', error: 'مقدار decidable نامعتبر است.' };
  out.decidable = ['1', 'true'].includes(String(q.decidable));
  const limit = q.limit === undefined ? DEFAULT_LIMIT : (isId(q.limit) ? parseInt(q.limit, 10) : NaN);
  const offset = q.offset === undefined ? 0 : (isId(q.offset) ? parseInt(q.offset, 10) : NaN);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) return { ok: false, code: 'INVALID_PAGING', error: `limit باید بین ۱ و ${MAX_LIMIT} باشد.` };
  if (!Number.isInteger(offset)) return { ok: false, code: 'INVALID_PAGING', error: 'offset نامعتبر است.' };
  out.limit = limit;
  out.offset = offset;
  return { ok: true, value: out };
}

// مانده‌ی کارمند برای نوع و سالِ درخواست (سالِ شمسیِ شروع؛ همان قاعده‌ی ledger). نوعِ بدون کسر ⇒ { tracked:false }.
// remainingAfterApproval: pending ⇒ remaining − مدت (مدتِ نامشخص ⇒ null)؛ approved/rejected ⇒ remaining (اثر درخواست از قبل در مانده است/نیست).
function balanceFor(request, cache) {
  const year = jalaliYearOfDateString(request.start_date);
  if (year === null) return { tracked: false };
  const key = `${request.user_id}:${request.leave_type_id}:${year}`;
  if (!cache.has(key)) {
    const d = leaveBalanceService.describeBalance({ userId: request.user_id, leaveTypeId: request.leave_type_id, jalaliYear: year });
    cache.set(key, d.ok && d.tracked ? d : null);
  }
  const d = cache.get(key);
  if (!d) return { tracked: false };
  let after = d.remaining;
  if (request.status === 'pending') after = Number.isInteger(request.duration_minutes) ? d.remaining - request.duration_minutes : null;
  return {
    tracked: true,
    jalaliYear: year,
    entitled: d.entitled,
    carriedOver: d.carriedOver,
    adjustments: d.adjustments,
    used: d.used,
    pending: d.pending,
    remaining: d.remaining,
    remainingAfterApproval: after,
    insufficient: after === null ? null : after < 0,
    dayMinutes: d.dayMinutes,
    display: { remaining: d.display.remaining, remainingAfterApproval: after === null ? null : formatMinutes(after, d.dayMinutes) },
    policy: d.policy,
  };
}

function toItem(r, ctx) {
  if (!ctx.users.has(r.user_id)) ctx.users.set(r.user_id, usersRepository.findById(r.user_id));
  const employee = ctx.users.get(r.user_id);
  const type = ctx.types.get(r.leave_type_id);
  const awaitingRole = leaveApprovalService.awaitingRole(r);
  return {
    id: r.id,
    kind: r.kind,
    leaveType: type ? { id: type.id, code: type.code, title: type.title } : { id: r.leave_type_id, code: null, title: null },
    status: r.status,
    startDate: r.start_date,
    endDate: r.end_date,
    unit: r.unit,
    halfDayPart: r.half_day_part || null,
    startTime: r.start_time || null,
    endTime: r.end_time || null,
    durationMinutes: r.duration_minutes === undefined ? null : r.duration_minutes,
    reason: r.reason,
    createdAt: r.created_at,
    employee: employee
      ? { id: employee.id, fullName: employee.full_name, personnelCode: employee.personnel_code, department: employee.department || null, managerId: employee.manager_id || null }
      : null,
    currentStep: r.current_step || null,
    awaitingRole, // manager|admin|hr (فقط pending؛ غیر pending ⇒ null)
    canDecide: r.status === 'pending' && leaveApprovalService.canDecide(ctx.actor, r, awaitingRole), // آیا «همین کاربر» همین الان می‌تواند تصمیم بگیرد
    chain: leaveApprovalService.getChain(r.id),
    attachment: r.attachment_id
      ? { url: `/api/admin/leave-requests/${r.id}/attachment`, mime: r.attachment_mime || null, name: r.attachment_name || null, size: r.attachment_size || null }
      : null, // دانلود با route سرو پیوست (S4-12b؛ اسکوپ و مجوز همان‌جا)
    balance: balanceFor(r, ctx.balances),
  };
}

// GET /admin/leave-queue?status=&kind=&leaveTypeId=&team=&from=&to=&decidable=&limit=&offset=
//   status: pending (پیش‌فرض)|approved|rejected|all | kind: leave|mission | team: شناسه‌ی سرپرست یا mine (تیم مستقیم او)
//   from/to: بازه‌ی تاریخ میلادی؛ درخواست‌های هم‌پوشان با آن | decidable=1: فقط pendingهایی که همین کاربر همین الان می‌تواند تصمیم بگیرد
// ⇒ { items, total, limit, offset }
router.get('/admin/leave-queue', requireAnyPermission(...QUEUE_PERMS), (req, res) => {
  const parsed = parseQuery(req.query);
  if (!parsed.ok) return bad(res, parsed.code, parsed.error);
  const f = parsed.value;
  const me = req.adminUser;

  // اسکوپ نقش + فیلتر تیم (اشتراک دو مجموعه)
  let userIds = scopedUserIds(me); // null = همه (admin/hr)
  if (f.team !== undefined) {
    const managerId = f.team === 'mine' ? me.id : f.team;
    if (me.role === 'manager' && managerId !== me.id) return res.status(403).json({ error: 'فقط تیم خودتان را می‌توانید ببینید.' });
    const team = usersRepository.listUsers({ managerId }).map((u) => u.id);
    userIds = userIds === null ? team : team.filter((id) => userIds.includes(id));
  }
  if (f.decidable) f.status = 'pending'; // قابل‌تصمیم فقط معنی‌اش در صف pending است

  const base = { status: f.status, kind: f.kind, leaveTypeId: f.leaveTypeId, userIds, from: f.from, to: f.to };
  const ctx = { actor: me, users: new Map(), balances: new Map(), types: new Map(leaveTypesRepository.listLeaveTypes().map((t) => [t.id, t])) };

  let rows;
  let total;
  if (f.decidable) {
    // canDecide به نقش مرحله و سرپرستِ کارمند بستگی دارد (نه ستون SQL)؛ پس پیش از صفحه‌بندی در JS فیلتر می‌شود (صف pending محدود است)
    const all = leaveRepository.listQueue({ ...base, limit: null }).rows.filter((r) => leaveApprovalService.canDecide(me, r, leaveApprovalService.awaitingRole(r)));
    total = all.length;
    rows = all.slice(f.offset, f.offset + f.limit);
  } else {
    ({ rows, total } = leaveRepository.listQueue({ ...base, limit: f.limit, offset: f.offset }));
  }
  res.json({ items: rows.map((r) => toItem(r, ctx)), total, limit: f.limit, offset: f.offset });
});

// POST /admin/leave-queue/bulk  { action: 'approve'|'reject', ids: [..≤50], note }
//   reject ⇒ note (دلیل) اجباری؛ approve ⇒ اختیاری. ⇒ { action, results: [{ id, ok, status?, completed?, nextRole?, code?, error? }], summary: { requested, succeeded, failed } }
//   پاسخ همیشه ۲۰۰ است مگر ورودی کلی نامعتبر باشد (۴۰۰)؛ شکست هر درخواست در results (NOT_FOUND|ALREADY_DECIDED|FORBIDDEN).
router.post('/admin/leave-queue/bulk', requireAnyPermission(...QUEUE_PERMS), (req, res) => {
  const b = req.body || {};
  if (!['approve', 'reject'].includes(b.action)) return bad(res, 'INVALID_ACTION', 'action باید approve یا reject باشد.');
  if (!Array.isArray(b.ids) || b.ids.length === 0) return bad(res, 'INVALID_IDS', 'فهرست ids الزامی است.');
  if (!b.ids.every((x) => Number.isSafeInteger(x) && x > 0)) return bad(res, 'INVALID_IDS', 'ids باید فهرستی از شناسه‌های عددی مثبت باشد.');
  const ids = [...new Set(b.ids)];
  if (ids.length > MAX_BULK) return bad(res, 'TOO_MANY', `حداکثر ${MAX_BULK} درخواست در هر بار.`);
  if (b.note !== undefined && b.note !== null && typeof b.note !== 'string') return bad(res, 'INVALID_NOTE', 'note باید متن باشد.');
  const note = normalizeNote(b.note);
  if (b.action === 'reject' && !note) return bad(res, 'REASON_REQUIRED', 'ذکر دلیل برای رد کردن الزامی است.');

  const results = ids.map((id) => {
    let done;
    try {
      done = applyDecision(req, { requestId: id, decision: b.action, note, bulk: true });
    } catch (err) {
      console.error('[leave-queue] خطا در تصمیم دسته‌جمعی:', err.message);
      return { id, ok: false, code: 'INTERNAL', error: 'خطای داخلی هنگام ثبت تصمیم.' };
    }
    if (!done.ok) return { id, ok: false, code: done.code, error: done.error };
    return { id, ok: true, status: done.request.status, completed: done.result.completed, nextRole: done.result.nextRole || null };
  });
  const succeeded = results.filter((r) => r.ok).length;
  audit(req, 'leave_queue_bulk_decision', { decision: b.action, requested: ids.length, succeeded, failed: ids.length - succeeded, ids, reason: note || null });
  res.json({ action: b.action, results, summary: { requested: ids.length, succeeded, failed: ids.length - succeeded } });
});

module.exports = router;

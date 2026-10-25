// R5 (فاز ۱۴): API بررسی دورکاری برای ادمین/سرپرست. منطق و اسکوپ در services/remoteWorkAdminService.
// بخش R5-۳ (فقط‌خواندنی، بدون audit):
//   GET /admin/remote-work?status=&week=&userId=&limit=&offset=   remote_work.read (admin/hr همه، سرپرست فقط کارمندان مستقیمش؛ کارمند ممنوع)
//     status: pending (پیش‌فرض)|approved|rejected|all
//     week:   خالی ⇒ هفته‌ی جاری و هفته‌ی قبل | هر تاریخ YYYY-MM-DD ⇒ همان هفته | all ⇒ بدون محدودیت تاریخ
//     userId: فقط یک کارمند (باید در اسکوپ باشد؛ خارج از تیم ⇒ ۴۰۳ NOT_IN_SCOPE، ناموجود ⇒ ۴۰۴)
//     ⇒ { ok, items, total, limit, offset, status, window: recent|week|all, weekStart, weekEnd }
//     هر item: { id, employee, workDate, jalaliDate, startAt, endAt, isOpen, status, autoClosed, breaks[], breakMinutes, workedMinutes,
//                approvedStartAt/EndAt, reviewedBy/At, reviewNote, attendanceRecordId, overlapsOnsite, onsiteRecord, canReview }
//     خطاها: { error, code } با status سرویس (۴۰۳/۴۰۴ یا ۴۰۰ برای INVALID_STATUS|INVALID_WEEK|INVALID_USER|INVALID_PAGING).
// بخش R5-۴ (تأیید تکی؛ audit دارد):
//   POST /admin/remote-work/:id/approve   remote_work.review (admin همه، سرپرست فقط کارمندان مستقیمش؛ hr و خود‌تأییدی ممنوع)
//     body (همه اختیاری): { approved_start_at?, approved_end_at? (ISO)، review_note? (≤۵۰۰) } — camelCase هم پذیرفته می‌شود.
//     ⇒ ۲۰۰ { ok, alreadyApproved, session, attendanceRecordId } — تأیید دوباره‌ی نشستِ approved: alreadyApproved=true و بدون رکورد/audit تازه.
//     خطاها: { error, code }: ۴۰۴ SESSION_NOT_FOUND|USER_NOT_FOUND؛ ۴۰۳ FORBIDDEN|NOT_IN_SCOPE|SELF_NOT_ALLOWED؛
//            ۴۰۹ SESSION_OPEN|NOT_PENDING|MONTH_CLOSED|ONSITE_OVERLAP|TIME_CONFLICT؛ ۴۰۰ INVALID_TIME|INVALID_NOTE.
//     R5-۶: body.overlap_decision = merge | keep_onsite — وقتی همان روز حضور حضوری هست اجباری است (همراه review_note)؛ بدون آن ۴۰۹ ONSITE_OVERLAP.
//       merge ⇒ ساعت دورکاری به رکورد حضوری اضافه می‌شود (outcome=merged)؛ keep_onsite ⇒ حضوری می‌ماند و نشست رد می‌شود (outcome=rejected).
//       کدهای تازه: ۴۰۰ INVALID_DECISION|REVIEW_NOTE_REQUIRED؛ ۴۰۹ NO_OVERLAP|ONSITE_NOT_CLOSED.
// بخش R5-۵ (رد؛ audit + اعلان):
//   POST /admin/remote-work/:id/reject    remote_work.review؛ body: { review_note (الزامی) }
//     ⇒ ۲۰۰ { ok, alreadyRejected, session }؛ رکورد رسمی ساخته نمی‌شود؛ کارمند اعلان می‌گیرد. خطا: ۴۰۰ REVIEW_NOTE_REQUIRED|INVALID_NOTE؛ ۴۰۹ SESSION_OPEN|NOT_PENDING.
// بخش R6 (شمارنده): GET /admin/remote-work/count  remote_work.read ⇒ { ok, pending (مجموع نشست‌های بسته‌شده‌ی منتظر)، employees: [{userId, fullName, count, oldestWorkDate}] } — بدون دورکاریِ خودِ کاربر.
// بخش R5-۷ (تأیید دسته‌ای):
//   POST /admin/remote-work/approve-batch remote_work.review؛ body: { user_id? , week? (هر تاریخ داخل هفته)، review_note? } — حداقل یکی از user_id/week الزامی (۴۰۰ BATCH_SCOPE_REQUIRED).
//     ⇒ ۲۰۰ { ok, approved, skipped: [{id, code, error}], total, truncated, weekStart, weekEnd } (سقف ۵۰۰ نشست در هر فراخوانی). هر نشست تراکنش جدا؛ idempotent.
// ثبت دستی (فقط ادمین):
//   POST /admin/remote-work   remote_work.create؛ body: { user_id, start_at, end_at (ISO)، review_note (الزامی، ≤۵۰۰)، overlap_decision? = merge } — camelCase هم پذیرفته می‌شود.
//     نشست بسته‌شده + تأیید در یک تراکنش (همان قواعد approve: ماه بسته، آینده، ۲۴ ساعت، TIME_CONFLICT، ONSITE_OVERLAP)؛ برای خودِ ادمین ممنوع (SELF_NOT_ALLOWED).
//     ⇒ ۲۰۰ { ok, outcome, session, attendanceRecordId }؛ خطاها مثل approve + ۴۰۰ REVIEW_NOTE_REQUIRED|INVALID_TIME|INVALID_NOTE|INVALID_DECISION، ۴۰۴ USER_NOT_FOUND.
const express = require('express');
const { requirePermission } = require('../../../middleware/permissions');
const service = require('../../../services/remoteWorkAdminService');

const router = express.Router();

router.get('/admin/remote-work/count', requirePermission('remote_work.read'), (req, res) => {
  const r = service.pendingSummary(req.adminUser);
  if (!r.ok) return res.status(r.status).json({ error: r.error, code: r.code });
  return res.json({ ok: true, pending: r.total, employees: r.employees });
});

router.get('/admin/remote-work', requirePermission('remote_work.read'), (req, res) => {
  const r = service.listQueue(req.adminUser, req.query);
  if (!r.ok) return res.status(r.status).json({ error: r.error, code: r.code });
  return res.json(r);
});

const bodyOf = (req) => (req.body && typeof req.body === 'object' ? req.body : {});
const pickFrom = (b, snake, camel) => (b[snake] !== undefined ? b[snake] : b[camel]);
const send = (res, r) => (r.ok ? res.json(r) : res.status(r.status).json({ error: r.error, code: r.code }));

router.post('/admin/remote-work', requirePermission('remote_work.create'), (req, res) => {
  const b = bodyOf(req);
  return send(res, service.createManual(req.adminUser, {
    userId: pickFrom(b, 'user_id', 'userId'),
    startAt: pickFrom(b, 'start_at', 'startAt'),
    endAt: pickFrom(b, 'end_at', 'endAt'),
    note: pickFrom(b, 'review_note', 'reviewNote'),
    overlapDecision: pickFrom(b, 'overlap_decision', 'overlapDecision'),
  }, { ip: req.ip }));
});

// ثبت approve-batch قبل از مسیرهای :id (جلوگیری از هر ابهام مسیر)
router.post('/admin/remote-work/approve-batch', requirePermission('remote_work.review'), (req, res) => {
  const b = bodyOf(req);
  return send(res, service.approveBatch(req.adminUser, {
    userId: pickFrom(b, 'user_id', 'userId'),
    week: b.week,
    reviewNote: pickFrom(b, 'review_note', 'reviewNote'),
  }, { ip: req.ip }));
});

router.post('/admin/remote-work/:id/approve', requirePermission('remote_work.review'), (req, res) => {
  const b = bodyOf(req);
  return send(res, service.approve(req.adminUser, req.params.id, {
    approvedStartAt: pickFrom(b, 'approved_start_at', 'approvedStartAt'),
    approvedEndAt: pickFrom(b, 'approved_end_at', 'approvedEndAt'),
    reviewNote: pickFrom(b, 'review_note', 'reviewNote'),
    overlapDecision: pickFrom(b, 'overlap_decision', 'overlapDecision'),
  }, { ip: req.ip }));
});

router.post('/admin/remote-work/:id/reject', requirePermission('remote_work.review'), (req, res) => {
  const b = bodyOf(req);
  return send(res, service.reject(req.adminUser, req.params.id, { reviewNote: pickFrom(b, 'review_note', 'reviewNote') }, { ip: req.ip }));
});

module.exports = router;

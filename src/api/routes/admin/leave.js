// مرخصی/مأموریت: صف تأیید، تصمیم، و کنترل کامل ادمین (ایجاد/ویرایش/حذف).
// (تقسیم‌شده از admin.js/adminPanel.js؛ URLها و رفتار بدون تغییر. احراز هویت در index.js یک‌بار اعمال می‌شود.)

const express = require('express');
const router = express.Router();

const { requirePermission, requireAnyPermission } = require('../../../middleware/permissions');
const usersRepository = require('../../../repositories/usersRepository');
const leaveRepository = require('../../../repositories/leaveRepository');
const { sendMessage } = require('../../../bot/notifier');
const { DATE_RE, scopedUserIds, canAccessUser, auditChange } = require('./common');
const { leaveRequestView } = require('../../../utils/auditViews');
const notificationEvents = require('../../../services/notificationEvents');
const leaveService = require('../../../services/leaveService');
const leaveDurationService = require('../../../services/leaveDurationService');
const leaveApprovalService = require('../../../services/leaveApprovalService');
const attachmentService = require('../../../services/attachmentService');
const { sendAttachment } = require('../../../utils/attachmentResponse');
const { applyDecision, normalizeNote } = require('./leaveDecision');

// ---------- صف تأیید مرخصی/مأموریت ----------

router.get('/admin/leave-requests', requirePermission('leave.read'), (req, res) => {
  const status = req.query.status || 'pending';
  const allowedIds = scopedUserIds(req.adminUser);
  let items = status === 'all' ? leaveRepository.listAll({}) : leaveRepository.listAll({ status });
  if (allowedIds !== null) items = items.filter((r) => allowedIds.includes(r.user_id));

  const enriched = items.map((r) => {
    const employee = usersRepository.findById(r.user_id);
    return {
      id: r.id,
      leaveType: r.kind,
      startDate: r.start_date,
      endDate: r.end_date,
      reason: r.reason,
      status: r.status,
      hasAttachment: !!r.attachment_id, // S4-12b: دانلود با GET /admin/leave-requests/:id/attachment
      attachmentMime: r.attachment_mime || null,
      attachmentName: r.attachment_name || null,
      currentStep: r.current_step || null, // S4-11a: مرحله‌ی فعال زنجیره (null = بدون زنجیره)
      awaitingRole: leaveApprovalService.awaitingRole(r), // manager|admin|hr (فقط pending)
      createdAt: r.created_at,
      employee: employee ? { id: employee.id, fullName: employee.full_name } : null,
    };
  });
  res.json(enriched);
});

// سرو پیوست (S4-12b): صاحب درخواست، سرپرست مستقیم (تیم) و admin/hr. شناسه‌ی فایل هرگز از کلاینت نمی‌آید؛ از ردیف DB خوانده و با ID_RE اعتبارسنجی می‌شود.
router.get('/admin/leave-requests/:id/attachment', requirePermission('leave.read'), (req, res) => {
  const request = /^\d+$/.test(req.params.id) ? leaveRepository.findById(parseInt(req.params.id, 10)) : null;
  if (!request) return res.status(404).json({ error: 'درخواست یافت نشد.' });
  const me = req.adminUser;
  if (request.user_id !== me.id && !canAccessUser(me, request.user_id)) return res.status(403).json({ error: 'به پیوست این درخواست دسترسی ندارید.' });
  return sendAttachment(res, request);
});

// تصمیم روی درخواست (S4-11a: زنجیره‌ی چندمرحله‌ای). مجوز: leave.approve (سرپرست/ادمین) یا leave.approve.hr (فقط مرحله‌ی hr)؛
// اینکه «این کاربر این مرحله را» می‌تواند تصمیم بگیرد با leaveApprovalService.canDecide (۴۰۳ با متن فارسی).
// تأیید مرحله‌ی میانی هنوز «تصمیم نهایی» نیست: پاسخ { completed:false, nextRole } و بدون اعلان به کارمند.
router.post('/admin/leave-requests/:id/:decision(approve|reject)', requireAnyPermission('leave.approve', 'leave.approve.hr'), (req, res) => {
  const requestId = parseInt(req.params.id, 10);
  const decision = req.params.decision;
  const request = leaveRepository.findById(requestId);
  if (!request) return res.status(404).json({ error: 'درخواست یافت نشد.' });

  // اجرا + audit + اعلان‌ها در leaveDecision.js مشترک با تصمیم دسته‌جمعی (S4-13a)
  const note = normalizeNote(req.body && req.body.note);
  const done = applyDecision(req, { requestId, decision, note });
  if (!done.ok) return res.status(done.status).json({ error: done.error, code: done.code });
  if (!done.result.completed) return res.json({ ...done.request, completed: false, nextRole: done.result.nextRole });
  res.json({ ...done.request, completed: true });
});

router.post('/admin/leave-requests', requirePermission('leave.edit'), (req, res) => {
  const b = req.body || {};
  const user = usersRepository.findById(parseInt(b.userId, 10));
  if (!user) return res.status(404).json({ error: 'کارمند یافت نشد.' });
  if (!canAccessUser(req.adminUser, user.id)) return res.status(403).json({ error: 'به این کارمند دسترسی ندارید.' });
  const reason = typeof b.reason === 'string' ? b.reason.trim() : '';
  if (!reason) return res.status(400).json({ error: 'ذکر دلیل ثبت الزامی است.' });
  const unit = b.unit || 'day';
  const endDate = b.endDate || (unit === 'day' ? undefined : b.startDate);
  if (!DATE_RE.test(b.startDate || '') || !DATE_RE.test(endDate || '') || endDate < b.startDate) {
    return res.status(400).json({ error: 'بازه‌ی تاریخ نامعتبر است.' });
  }
  const force = b.force === true;
  if (force && req.adminUser.role !== 'admin') return res.status(403).json({ error: 'فقط ادمین می‌تواند محدودیت مانده را نادیده بگیرد.' });

  const result = leaveService.create({
    userId: user.id,
    leaveTypeId: Number.isInteger(b.leaveTypeId) ? b.leaveTypeId : undefined,
    leaveType: Number.isInteger(b.leaveTypeId) ? undefined : (b.leaveType === 'mission' ? 'mission' : 'leave'),
    unit,
    startDate: b.startDate,
    endDate,
    halfDayPart: b.halfDayPart,
    startTime: b.startTime,
    endTime: b.endTime,
    reason,
    substituteUserId: Number.isInteger(b.substituteUserId) ? b.substituteUserId : undefined,
  }, { skip: force ? ['past', 'future', 'notice', 'balance', 'maxConsecutive', 'attachment'] : ['past', 'future', 'notice', 'attachment'] });
  if (!result.ok) {
    return res.status(400).json({ error: result.errors.map((x) => x.error).join(' '), code: result.errors[0].code, errors: result.errors });
  }

  const created = result.request;
  const finalStatus = ['approved', 'rejected', 'pending'].includes(b.status) ? b.status : 'approved';
  const saved = finalStatus === 'pending' ? created : leaveRepository.setStatus(created.id, finalStatus, req.adminUser.id);
  if (finalStatus !== 'pending') leaveApprovalService.clearChain(created.id); // ثبت مستقیم توسط مدیر ⇒ بدون زنجیره (S4-11a)
  auditChange(req, {
    action: 'leave_request_created_by_admin',
    entityType: 'leave_request',
    entityId: saved.id,
    before: null,
    after: leaveRequestView(saved),
    reason,
    meta: { requestId: saved.id, targetUserId: user.id, force },
  });
  res.status(201).json({ ...saved, warnings: result.warnings });
});

router.patch('/admin/leave-requests/:id', requirePermission('leave.edit'), (req, res) => {
  const reqRow = leaveRepository.findById(parseInt(req.params.id, 10));
  if (!reqRow) return res.status(404).json({ error: 'درخواست یافت نشد.' });
  if (!canAccessUser(req.adminUser, reqRow.user_id)) return res.status(403).json({ error: 'به این کارمند دسترسی ندارید.' });
  const { status, startDate, endDate, leaveType, reason } = req.body || {};
  const fields = {};
  if (status !== undefined) {
    if (!['pending', 'approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'وضعیت نامعتبر است.' });
    fields.status = status;
  }
  if (startDate !== undefined) fields.start_date = startDate;
  if (endDate !== undefined) fields.end_date = endDate;
  if ((fields.start_date || reqRow.start_date) > (fields.end_date || reqRow.end_date)) {
    return res.status(400).json({ error: 'بازه‌ی تاریخ نامعتبر است.' });
  }
  if (leaveType !== undefined) fields.leave_type = leaveType === 'mission' ? 'mission' : 'leave';
  if (reason !== undefined) fields.reason = reason;
  // S4-10d: تغییر تاریخ ⇒ مدت دوباره با تقویم/شیفت محاسبه و تداخل با بقیه‌ی درخواست‌های همین کارمند سنجیده می‌شود (خودِ درخواست مستثناست)؛
  // نیم‌روز/ساعتی تاریخ‌اش یک روز می‌ماند (خطای updateManual). مدت قبلاً با تغییر تاریخ NULL می‌شد و منتظر backfill می‌ماند.
  let nextDuration = null;
  if (fields.start_date !== undefined || fields.end_date !== undefined) {
    const prep = leaveDurationService.prepare({
      userId: reqRow.user_id,
      leaveTypeId: reqRow.leave_type_id,
      unit: reqRow.unit || 'day',
      startDate: fields.start_date || reqRow.start_date,
      endDate: fields.end_date || reqRow.end_date,
      halfDayPart: reqRow.half_day_part,
      startTime: reqRow.start_time,
      endTime: reqRow.end_time,
      excludeRequestId: reqRow.id,
    });
    if (!prep.ok) return res.status(400).json({ error: prep.errors.map((x) => x.error).join(' '), code: prep.errors[0].code, errors: prep.errors });
    nextDuration = prep.durationMinutes;
  }
  let updated;
  try {
    updated = leaveRepository.updateManual(reqRow.id, fields, req.adminUser.id);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  if (nextDuration !== null) {
    leaveRepository.setDuration(reqRow.id, nextDuration);
    updated = leaveRepository.findById(reqRow.id);
  }
  // تغییر دستی وضعیت توسط مدیر زنجیره را بازتنظیم می‌کند (S4-11a): نهایی ⇒ بدون زنجیره؛ بازگشت به pending ⇒ زنجیره‌ی تازه از مرحله ۱
  if (fields.status !== undefined && fields.status !== reqRow.status) {
    if (fields.status === 'pending') leaveApprovalService.initChain(reqRow.id);
    else leaveApprovalService.clearChain(reqRow.id);
    updated = leaveRepository.findById(reqRow.id);
  }
  auditChange(req, {
    action: 'leave_request_edited_by_admin',
    entityType: 'leave_request',
    entityId: reqRow.id,
    before: leaveRequestView(reqRow),
    after: leaveRequestView(updated),
    meta: { requestId: reqRow.id, targetUserId: reqRow.user_id, fields: Object.keys(fields) },
  });
  const employee = usersRepository.findById(reqRow.user_id);
  // فقط تغییر به approved/rejected «تصمیم» است؛ بازگشت به pending اعلان پنل نمی‌سازد (S4-6b)
  if (fields.status && fields.status !== reqRow.status) notificationEvents.leaveDecided(updated);
  if (fields.status && fields.status !== reqRow.status && employee?.telegram_user_id) {
    const label = { approved: 'تأیید شد ✅', rejected: 'رد شد ❌', pending: 'به حالت «در انتظار» بازگشت' }[fields.status];
    sendMessage(
      employee.telegram_user_id,
      `وضعیت درخواست ${updated.kind === 'mission' ? 'مأموریت' : 'مرخصی'} شما (${updated.start_date} تا ${updated.end_date}) ${label}`
    );
  }
  res.json(updated);
});

router.delete('/admin/leave-requests/:id', requirePermission('leave.edit'), (req, res) => {
  const reqRow = leaveRepository.findById(parseInt(req.params.id, 10));
  if (!reqRow) return res.status(404).json({ error: 'درخواست یافت نشد.' });
  if (!canAccessUser(req.adminUser, reqRow.user_id)) return res.status(403).json({ error: 'به این کارمند دسترسی ندارید.' });
  leaveApprovalService.clearChain(reqRow.id);
  leaveRepository.remove(reqRow.id);
  auditChange(req, {
    action: 'leave_request_deleted_by_admin',
    entityType: 'leave_request',
    entityId: reqRow.id,
    before: leaveRequestView(reqRow),
    after: null,
    meta: { requestId: reqRow.id, targetUserId: reqRow.user_id },
  });
  res.json({ ok: true });
});

module.exports = router;

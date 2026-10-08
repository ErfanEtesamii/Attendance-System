// مرخصی/مأموریت: صف تأیید، تصمیم، و کنترل کامل ادمین (ایجاد/ویرایش/حذف).
// (تقسیم‌شده از admin.js/adminPanel.js؛ URLها و رفتار بدون تغییر. احراز هویت در index.js یک‌بار اعمال می‌شود.)

const express = require('express');
const router = express.Router();

const { requirePermission } = require('../../../middleware/permissions');
const usersRepository = require('../../../repositories/usersRepository');
const leaveRepository = require('../../../repositories/leaveRepository');
const { notifyUser, sendMessage } = require('../../../bot/notifier');
const { DATE_RE, scopedUserIds, canAccessUser, auditChange } = require('./common');
const { leaveRequestView } = require('../../../utils/auditViews');
const notificationEvents = require('../../../services/notificationEvents');
const leaveService = require('../../../services/leaveService');
const leaveDurationService = require('../../../services/leaveDurationService');

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
      createdAt: r.created_at,
      employee: employee ? { id: employee.id, fullName: employee.full_name } : null,
    };
  });
  res.json(enriched);
});

router.post('/admin/leave-requests/:id/:decision(approve|reject)', requirePermission('leave.approve'), (req, res) => {
  const requestId = parseInt(req.params.id, 10);
  const decision = req.params.decision;
  const request = leaveRepository.findById(requestId);
  if (!request) return res.status(404).json({ error: 'درخواست یافت نشد.' });
  if (request.status !== 'pending') {
    return res.status(400).json({ error: 'این درخواست قبلاً بررسی شده است.' });
  }

  const employee = usersRepository.findById(request.user_id);
  const isManagerOfEmployee = employee && employee.manager_id === req.adminUser.id;
  if (req.adminUser.role !== 'admin' && !isManagerOfEmployee) {
    return res.status(403).json({ error: 'این کارمند زیرمجموعه شما نیست.' });
  }

  const note = ((req.body && req.body.note) || '').toString().trim().slice(0, 500);
  const newStatus = decision === 'approve' ? 'approved' : 'rejected';
  const updated = leaveRepository.setStatus(requestId, newStatus, req.adminUser.id);

  auditChange(req, {
    action: newStatus === 'approved' ? 'leave_request_approved' : 'leave_request_rejected',
    entityType: 'leave_request',
    entityId: requestId,
    before: leaveRequestView(request),
    after: leaveRequestView(updated),
    reason: note || null, // یادداشت تصمیم‌گیرنده = دلیل تصمیم
    meta: { requestId, employeeId: request.user_id, targetUserId: request.user_id },
  });

  notificationEvents.leaveDecided(updated, { note }); // اعلان پنل برای کارمند (S4-6b)

  if (employee?.telegram_user_id) {
    const typeLabel = request.kind === 'mission' ? 'مأموریت' : 'مرخصی';
    const statusLabel = newStatus === 'approved' ? 'تأیید شد ✅' : 'رد شد ❌';
    notifyUser(
      employee.telegram_user_id,
      `درخواست ${typeLabel} شما (${request.start_date} تا ${request.end_date}) ${statusLabel}` +
        (note ? `\nپاسخ ${req.adminUser.role === 'admin' ? 'ادمین' : 'سرپرست'}: ${note}` : '')
    );
  }

  res.json(updated);
});

// ---------- مرخصی/مأموریت: کنترل کامل ادمین ----------

// ثبت مرخصی/مأموریت توسط سرپرست/ادمین برای کارمند (S4-10d). فقط از leaveService.create؛ همه‌ی قواعد (واحد مجاز، مدت کاری، تداخل) اعمال می‌شود.
//   reason = دلیل ثبت (الزامی؛ همان توضیح درخواست هم هست و در audit می‌آید).
//   مدیر از قواعد «گذشته/آینده/پیش‌اطلاع» معاف است (ثبت برای روزهای گذشته کار طبیعی مدیر است)؛ مانده و سقف روز متوالی برقرار می‌ماند.
//   فقط admin می‌تواند force:true بدهد تا مانده/سقف روز متوالی هم نادیده شود؛ force در audit (meta.force) ثبت می‌شود.
//   status پیش‌فرض approved (مثل قبل)؛ بدنه: { userId, leaveTypeId | leaveType, unit?, startDate, endDate?, halfDayPart?, startTime?, endTime?, reason, status?, force? }
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
  }, { skip: force ? ['past', 'future', 'notice', 'balance', 'maxConsecutive'] : ['past', 'future', 'notice'] });
  if (!result.ok) {
    return res.status(400).json({ error: result.errors.map((x) => x.error).join(' '), code: result.errors[0].code, errors: result.errors });
  }

  const created = result.request;
  const finalStatus = ['approved', 'rejected', 'pending'].includes(b.status) ? b.status : 'approved';
  const saved = finalStatus === 'pending' ? created : leaveRepository.setStatus(created.id, finalStatus, req.adminUser.id);
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

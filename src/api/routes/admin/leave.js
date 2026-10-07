// مرخصی/مأموریت: صف تأیید، تصمیم، و کنترل کامل ادمین (ایجاد/ویرایش/حذف).
// (تقسیم‌شده از admin.js/adminPanel.js؛ URLها و رفتار بدون تغییر. احراز هویت در index.js یک‌بار اعمال می‌شود.)

const express = require('express');
const router = express.Router();

const { requireStaff } = require('../../../middleware/adminAuth');
const usersRepository = require('../../../repositories/usersRepository');
const leaveRepository = require('../../../repositories/leaveRepository');
const { notifyUser, sendMessage } = require('../../../bot/notifier');
const { DATE_RE, scopedUserIds, canAccessUser, auditChange } = require('./common');
const { leaveRequestView } = require('../../../utils/auditViews');

// ---------- صف تأیید مرخصی/مأموریت ----------

router.get('/admin/leave-requests', (req, res) => {
  const status = req.query.status || 'pending';
  const allowedIds = scopedUserIds(req.adminUser);
  let items = status === 'all' ? leaveRepository.listAll({}) : leaveRepository.listAll({ status });
  if (allowedIds !== null) items = items.filter((r) => allowedIds.includes(r.user_id));

  const enriched = items.map((r) => {
    const employee = usersRepository.findById(r.user_id);
    return {
      id: r.id,
      leaveType: r.leave_type,
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

router.post('/admin/leave-requests/:id/:decision(approve|reject)', (req, res) => {
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

  if (employee?.telegram_user_id) {
    const typeLabel = request.leave_type === 'mission' ? 'مأموریت' : 'مرخصی';
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

router.post('/admin/leave-requests', requireStaff, (req, res) => {
  const { userId, startDate, endDate, leaveType, reason, status } = req.body || {};
  const user = usersRepository.findById(parseInt(userId, 10));
  if (!user) return res.status(404).json({ error: 'کارمند یافت نشد.' });
  if (!canAccessUser(req.adminUser, user.id)) return res.status(403).json({ error: 'به این کارمند دسترسی ندارید.' });
  if (!DATE_RE.test(startDate || '') || !DATE_RE.test(endDate || '') || endDate < startDate) {
    return res.status(400).json({ error: 'بازه‌ی تاریخ نامعتبر است.' });
  }
  const created = leaveRepository.createLeaveRequest({
    userId: user.id, startDate, endDate, leaveType: leaveType === 'mission' ? 'mission' : 'leave', reason,
  });
  const finalStatus = ['approved', 'rejected', 'pending'].includes(status) ? status : 'approved';
  const saved = finalStatus === 'pending' ? created : leaveRepository.setStatus(created.id, finalStatus, req.adminUser.id);
  auditChange(req, {
    action: 'leave_request_created_by_admin',
    entityType: 'leave_request',
    entityId: saved.id,
    before: null,
    after: leaveRequestView(saved),
    meta: { requestId: saved.id, targetUserId: user.id },
  });
  res.status(201).json(saved);
});

router.patch('/admin/leave-requests/:id', requireStaff, (req, res) => {
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
  const updated = leaveRepository.updateManual(reqRow.id, fields, req.adminUser.id);
  auditChange(req, {
    action: 'leave_request_edited_by_admin',
    entityType: 'leave_request',
    entityId: reqRow.id,
    before: leaveRequestView(reqRow),
    after: leaveRequestView(updated),
    meta: { requestId: reqRow.id, targetUserId: reqRow.user_id, fields: Object.keys(fields) },
  });
  const employee = usersRepository.findById(reqRow.user_id);
  if (fields.status && fields.status !== reqRow.status && employee?.telegram_user_id) {
    const label = { approved: 'تأیید شد ✅', rejected: 'رد شد ❌', pending: 'به حالت «در انتظار» بازگشت' }[fields.status];
    sendMessage(
      employee.telegram_user_id,
      `وضعیت درخواست ${updated.leave_type === 'mission' ? 'مأموریت' : 'مرخصی'} شما (${updated.start_date} تا ${updated.end_date}) ${label}`
    );
  }
  res.json(updated);
});

router.delete('/admin/leave-requests/:id', requireStaff, (req, res) => {
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

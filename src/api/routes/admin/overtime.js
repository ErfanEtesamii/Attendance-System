// تأیید اضافه‌کاری (S3-5c): فهرست روزهای دارای اضافه‌کاری قابل‌پرداخت + تأیید/رد.
// فقط وقتی تنظیم overtimeRequiresApproval روشن باشد معنا دارد؛ تا تصمیم ثبت نشود روز «معلق» است و در payable ماهانه نمی‌آید
// (منطق در dayService.computeMonthOvertime).
//
// اسکوپ و دسترسی:
//   admin    — همه‌ی کارمندان
//   manager  — فقط تیم خودش (scopedUserIds)
//   employee — ممنوع (لیست سفید requireAdminAuth + requireStaff؛ دو لایه)
//   هیچ‌کس اضافه‌کاری خودش را تأیید/رد نمی‌کند (۴۰۳).

const express = require('express');
const router = express.Router();

const { requireStaff } = require('../../../middleware/adminAuth');
const attendanceRepository = require('../../../repositories/attendanceRepository');
const overtimeApprovalRepository = require('../../../repositories/overtimeApprovalRepository');
const dayService = require('../../../engine/dayService');
const { scopedUserIds, canAccessUser, DATE_RE, parseRange, userBrief, makeUserMap, requireReason, audit } = require('./common');

const LIST_STATUSES = ['pending', 'approved', 'rejected'];

function present(row, userMap) {
  if (!row) return null;
  return {
    recordId: row.attendance_record_id,
    status: row.status,
    reason: row.reason,
    decidedBy: row.decided_by ? userBrief(userMap.get(row.decided_by)) || { id: row.decided_by } : null,
    decidedAt: row.decided_at,
  };
}

// GET /admin/overtime-approvals?from=YYYY-MM-DD&to=YYYY-MM-DD&status=pending|approved|rejected
// فقط روزهایی که اضافه‌کاری قابل‌پرداخت دارند یا تصمیمی برایشان ثبت شده.
router.get('/admin/overtime-approvals', requireStaff, (req, res) => {
  const { status, from, to } = req.query;
  if (status !== undefined && status !== '' && !LIST_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'وضعیت نامعتبر است (pending | approved | rejected).' });
  }
  for (const [name, value] of [['from', from], ['to', to]]) {
    if (value !== undefined && value !== '' && !DATE_RE.test(String(value))) {
      return res.status(400).json({ error: `پارامتر ${name} باید به‌صورت YYYY-MM-DD باشد.` });
    }
  }
  const range = parseRange(req.query);
  const context = dayService.loadContext();
  const requiresApproval = context.settings.overtimeRequiresApproval === true;
  const records = attendanceRepository.search({ ...range, userIds: scopedUserIds(req.adminUser), limit: 500 });
  const decisions = overtimeApprovalRepository.mapByRecordIds(records.map((r) => r.id));
  const userMap = makeUserMap();
  const items = [];
  for (const record of records) {
    const day = dayService.computeRecordDay(record, { context });
    const decision = decisions.get(record.id);
    if (day.overtimePayable <= 0 && !decision) continue;
    const itemStatus = dayService.approvalStatusOf(requiresApproval, day.overtimePayable, decision);
    if (status && itemStatus !== status) continue;
    items.push({
      recordId: record.id,
      date: record.record_date,
      employee: userBrief(userMap.get(record.user_id)),
      overtime: day.overtime,
      overtimePayable: day.overtimePayable,
      status: itemStatus,
      decision: present(decision, userMap),
    });
  }
  res.json({ requiresApproval, from: range.from, to: range.to, items });
});

// POST /admin/overtime-approvals/:recordId/approve|reject  { reason } — دلیل برای رد اجباری، برای تأیید اختیاری
router.post('/admin/overtime-approvals/:recordId/:action(approve|reject)', requireStaff, (req, res) => {
  const recordId = Number(req.params.recordId);
  if (!Number.isInteger(recordId) || recordId <= 0) return res.status(400).json({ error: 'شناسه‌ی نامعتبر است.' });
  const record = attendanceRepository.findById(recordId);
  if (!record) return res.status(404).json({ error: 'رکورد یافت نشد.' });
  if (!canAccessUser(req.adminUser, record.user_id)) return res.status(403).json({ error: 'به این کارمند دسترسی ندارید.' });
  if (record.user_id === req.adminUser.id) return res.status(403).json({ error: 'تأیید یا رد اضافه‌کاریِ خودتان مجاز نیست.' });

  const approving = req.params.action === 'approve';
  let reason = null;
  if (approving) {
    reason = ((req.body && (req.body.reason || req.body.note)) || '').toString().trim() || null;
  } else {
    reason = requireReason(req, res);
    if (reason === null) return undefined;
  }

  const context = dayService.loadContext();
  if (context.settings.overtimeRequiresApproval !== true) {
    return res.status(409).json({ error: 'تأیید اضافه‌کاری فعال نیست (تنظیم overtimeRequiresApproval خاموش است).' });
  }
  const day = dayService.computeRecordDay(record, { context });
  if (day.overtimePayable <= 0) return res.status(409).json({ error: 'این رکورد اضافه‌کاریِ قابل‌پرداختی ندارد.' });

  const newStatus = approving ? 'approved' : 'rejected';
  const existing = overtimeApprovalRepository.findByRecordId(recordId);
  if (existing && existing.status === newStatus) {
    return res.status(409).json({ error: 'این رکورد از قبل با همین وضعیت ثبت شده است.' });
  }
  const row = overtimeApprovalRepository.upsertDecision({
    attendanceRecordId: recordId, userId: record.user_id, status: newStatus, reason, decidedBy: req.adminUser.id,
  });
  audit(req, approving ? 'overtime_approved' : 'overtime_rejected', {
    recordId,
    targetUserId: record.user_id,
    recordDate: record.record_date,
    overtime: day.overtime,
    payableMinutes: day.overtimePayable,
    previousStatus: existing ? existing.status : 'pending',
    reason: reason || undefined,
  });
  res.json(present(row, makeUserMap()));
});

module.exports = router;

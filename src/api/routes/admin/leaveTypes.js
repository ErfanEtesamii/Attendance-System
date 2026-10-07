// انواع مرخصی/مأموریت (S4-7a): CRUD پنل. leave_requests هنوز به این جدول وصل نیست (S4-7b) و منطق kind در S4-7c منتقل می‌شود.
//   خواندن (leave.read): ادمین، سرپرست و hr (کارمند را لیست سفید requireAdminAuth می‌بندد).
//   نوشتن (settings.edit = فقط ادمین کل): دلیل اجباری + audit با قالب استاندارد (auditChange، entityType = leave_type).
//   مجوز تازه‌ای تعریف نشد؛ «انواع مرخصی» جزو پیکربندی سیستم است و ماتریس مجوزها بدون تغییر می‌ماند.

const express = require('express');
const router = express.Router();

const { requirePermission } = require('../../../middleware/permissions');
const leaveTypesRepository = require('../../../repositories/leaveTypesRepository');
const { validateLeaveTypeInput } = require('../../../utils/leaveTypeValidation');
const { leaveTypeView } = require('../../../utils/auditViews');
const { requireReason, auditChange } = require('./common');

const NOT_FOUND = { error: 'نوع مرخصی یافت نشد.' };
const DUPLICATE_CODE = { error: 'نوعی با این کد از قبل وجود دارد.', field: 'code' };

function parseId(raw) {
  return /^\d+$/.test(String(raw)) ? parseInt(raw, 10) : null;
}

// خروجی عمومی: خود نوع + تعداد درخواست‌های وابسته (برای نمایش «قابل حذف؟»)
function present(type) {
  return { ...type, requestCount: leaveTypesRepository.countRequests(type.id) };
}

// GET /admin/leave-types[?active=1] → [{ id, code, title, kind, isPaid, requiresAttachment, countsAgainstBalance, allowedUnits, maxConsecutiveDays, isActive, requestCount, ... }]
router.get('/admin/leave-types', requirePermission('leave.read'), (req, res) => {
  const activeOnly = req.query.active === '1' || req.query.active === 'true';
  res.json(leaveTypesRepository.listLeaveTypes({ activeOnly }).map(present));
});

router.get('/admin/leave-types/:id', requirePermission('leave.read'), (req, res) => {
  const type = leaveTypesRepository.findById(parseId(req.params.id));
  if (!type) return res.status(404).json(NOT_FOUND);
  return res.json(present(type));
});

// POST /admin/leave-types  { code, title, [kind, isPaid, requiresAttachment, countsAgainstBalance, allowedUnits, maxConsecutiveDays, isActive], reason }
router.post('/admin/leave-types', requirePermission('settings.edit'), (req, res) => {
  const reason = requireReason(req, res);
  if (reason === null) return undefined;
  const checked = validateLeaveTypeInput(req.body);
  if (!checked.ok) return res.status(400).json({ error: checked.error, field: checked.field });
  if (leaveTypesRepository.findByCode(checked.value.code)) return res.status(409).json(DUPLICATE_CODE);

  const type = leaveTypesRepository.createLeaveType(checked.value);
  auditChange(req, { action: 'leave_type_created', entityType: 'leave_type', entityId: type.id, before: null, after: leaveTypeView(type), reason });
  return res.status(201).json(present(type));
});

// PATCH /admin/leave-types/:id  { هر زیرمجموعه‌ای از فیلدها (به‌جز code), reason } → { changed, leaveType }
// تغییر kind وقتی درخواستی از این نوع ثبت شده ممنوع است (معنای درخواست‌های قدیمی عوض می‌شد)؛ به‌جایش نوع جدید بسازید.
router.patch('/admin/leave-types/:id', requirePermission('settings.edit'), (req, res) => {
  const id = parseId(req.params.id);
  const before = leaveTypesRepository.findById(id);
  if (!before) return res.status(404).json(NOT_FOUND);
  const reason = requireReason(req, res);
  if (reason === null) return undefined;

  const checked = validateLeaveTypeInput(req.body, { partial: true });
  if (!checked.ok) return res.status(400).json({ error: checked.error, field: checked.field });

  const changes = {};
  Object.keys(checked.value).forEach((k) => {
    if (JSON.stringify(checked.value[k]) !== JSON.stringify(before[k])) changes[k] = checked.value[k];
  });
  if (Object.keys(changes).length === 0) return res.json({ changed: false, leaveType: present(before) });

  if (changes.kind !== undefined && leaveTypesRepository.isReferenced(id)) {
    return res.status(409).json({ code: 'IN_USE', field: 'kind', error: 'برای این نوع درخواست ثبت شده؛ «kind» قابل تغییر نیست. نوع جدید بسازید و این را غیرفعال کنید.' });
  }

  const after = leaveTypesRepository.updateLeaveType(id, changes);
  auditChange(req, { action: 'leave_type_updated', entityType: 'leave_type', entityId: id, before: leaveTypeView(before), after: leaveTypeView(after), reason });
  return res.json({ changed: true, leaveType: present(after) });
});

// DELETE /admin/leave-types/:id  { reason } (یا ?reason=) → ۴۰۹ IN_USE اگر درخواستی دارد (به‌جای حذف، غیرفعالش کنید)
router.delete('/admin/leave-types/:id', requirePermission('settings.edit'), (req, res) => {
  const id = parseId(req.params.id);
  const type = leaveTypesRepository.findById(id);
  if (!type) return res.status(404).json(NOT_FOUND);
  const reason = requireReason(req, res);
  if (reason === null) return undefined;

  if (!leaveTypesRepository.deleteIfUnused(id)) {
    return res.status(409).json({ code: 'IN_USE', requestCount: leaveTypesRepository.countRequests(id), error: 'برای این نوع درخواست ثبت شده و حذف نمی‌شود؛ آن را غیرفعال کنید.' });
  }
  auditChange(req, { action: 'leave_type_deleted', entityType: 'leave_type', entityId: id, before: leaveTypeView(type), after: null, reason });
  return res.json({ ok: true });
});

module.exports = router;

// شیفت‌های کاری (S3-6a): CRUD و انتساب به کاربر. از S3-6b/6c محاسبه‌ی روز (computeDay از طریق dayService) شیفتِ منتسب را می‌خواند.
//   خواندن: سرپرست و ادمین (کارمند طبق لیست سفید requireAdminAuth بسته است). نوشتن: فقط ادمین کل، با دلیل اجباری و audit.

const express = require('express');
const router = express.Router();

const { requirePermission } = require('../../../middleware/permissions');
const shiftsRepository = require('../../../repositories/shiftsRepository');
const usersRepository = require('../../../repositories/usersRepository');
const { validateShiftInput, checkConsistency } = require('../../../utils/shiftValidation');
const { requireReason, audit, scopedUserIds, userBrief } = require('./common');

const NOT_FOUND = { error: 'شیفت یافت نشد.' };

function parseId(raw) {
  return /^\d+$/.test(String(raw)) ? parseInt(raw, 10) : null;
}

// GET /admin/shifts → [{ id, name, startTime, endTime, graceLateMinutes, graceEarlyMinutes, workDays, overnight, maxLunchMinutes, fixedLunchDeductMinutes, userCount, ... }]
router.get('/admin/shifts', requirePermission('shifts.read'), (req, res) => {
  res.json(shiftsRepository.listShifts());
});

// GET /admin/shifts/:id → شیفت + کاربران منتسب (سرپرست فقط تیم خودش را می‌بیند)
router.get('/admin/shifts/:id', requirePermission('shifts.read'), (req, res) => {
  const shift = shiftsRepository.findById(parseId(req.params.id));
  if (!shift) return res.status(404).json(NOT_FOUND);
  const allowed = scopedUserIds(req.adminUser);
  const users = shiftsRepository.listUsersOfShift(shift.id).filter((u) => allowed === null || allowed.includes(u.id));
  return res.json({ ...shift, users: users.map(userBrief) });
});

// POST /admin/shifts  { name, startTime, endTime, [graceLateMinutes, graceEarlyMinutes, workDays, overnight, maxLunchMinutes, fixedLunchDeductMinutes], reason }
router.post('/admin/shifts', requirePermission('shifts.edit'), (req, res) => {
  const reason = requireReason(req, res);
  if (reason === null) return undefined;
  const checked = validateShiftInput(req.body);
  if (!checked.ok) return res.status(400).json({ error: checked.error, field: checked.field });
  if (shiftsRepository.findByName(checked.value.name)) return res.status(409).json({ error: 'شیفتی با این نام از قبل وجود دارد.', field: 'name' });

  const shift = shiftsRepository.createShift(checked.value);
  audit(req, 'shift_created', { shiftId: shift.id, shift: checked.value, reason });
  return res.status(201).json(shift);
});

// PATCH /admin/shifts/:id  { هر زیرمجموعه‌ای از فیلدها, reason } → { changed, shift }
router.patch('/admin/shifts/:id', requirePermission('shifts.edit'), (req, res) => {
  const id = parseId(req.params.id);
  const before = shiftsRepository.findById(id);
  if (!before) return res.status(404).json(NOT_FOUND);
  const reason = requireReason(req, res);
  if (reason === null) return undefined;

  const checked = validateShiftInput(req.body, { partial: true });
  if (!checked.ok) return res.status(400).json({ error: checked.error, field: checked.field });
  const merged = { ...before, ...checked.value };
  const consistent = checkConsistency(merged); // با مقدار ادغام‌شده: مثلاً فقط overnight عوض شده ولی ساعت‌ها نه
  if (!consistent.ok) return res.status(400).json({ error: consistent.error, field: consistent.field });

  const changes = {};
  Object.keys(checked.value).forEach((k) => {
    if (JSON.stringify(checked.value[k]) !== JSON.stringify(before[k])) changes[k] = { before: before[k], after: checked.value[k] };
  });
  if (Object.keys(changes).length === 0) return res.json({ changed: false, shift: before });

  if (changes.name) {
    const other = shiftsRepository.findByName(changes.name.after);
    if (other && other.id !== id) return res.status(409).json({ error: 'شیفتی با این نام از قبل وجود دارد.', field: 'name' });
  }
  const patch = {};
  Object.keys(changes).forEach((k) => { patch[k] = changes[k].after; });
  const shift = shiftsRepository.updateShift(id, patch);
  audit(req, 'shift_updated', { shiftId: id, fields: Object.keys(changes), changes, reason });
  return res.json({ changed: true, shift });
});

// DELETE /admin/shifts/:id  { reason } (یا ?reason=) → ۴۰۹ HAS_USERS اگر کسی منتسب است (ابتدا انتساب‌ها را بردارید)
router.delete('/admin/shifts/:id', requirePermission('shifts.edit'), (req, res) => {
  const id = parseId(req.params.id);
  const shift = shiftsRepository.findById(id);
  if (!shift) return res.status(404).json(NOT_FOUND);
  const reason = requireReason(req, res);
  if (reason === null) return undefined;

  if (!shiftsRepository.deleteShiftIfUnused(id)) {
    return res.status(409).json({ code: 'HAS_USERS', userCount: shiftsRepository.countUsers(id), error: 'این شیفت به کاربر منتسب است؛ ابتدا انتساب‌ها را بردارید یا تغییر دهید.' });
  }
  audit(req, 'shift_deleted', { shiftId: id, shift: { ...shift, userCount: undefined }, reason });
  return res.json({ ok: true });
});

// PUT /admin/users/:id/shift  { shiftId: عدد | null, reason } → { changed, userId, shiftId, shift }
router.put('/admin/users/:id/shift', requirePermission('shifts.edit'), (req, res) => {
  const userId = parseId(req.params.id);
  const user = userId === null ? null : usersRepository.findById(userId);
  if (!user) return res.status(404).json({ error: 'کارمند یافت نشد.' });
  const reason = requireReason(req, res);
  if (reason === null) return undefined;

  const raw = (req.body || {}).shiftId;
  let shift = null;
  if (raw === undefined) return res.status(400).json({ error: '«shiftId» الزامی است (عدد یا null برای برداشتن شیفت).', field: 'shiftId' });
  if (raw !== null) {
    const sid = typeof raw === 'number' && Number.isInteger(raw) ? raw : parseId(raw);
    shift = sid === null ? null : shiftsRepository.findById(sid);
    if (!shift) return res.status(404).json({ error: 'شیفت یافت نشد.', field: 'shiftId' });
  }

  const beforeId = user.shift_id == null ? null : user.shift_id;
  const afterId = shift ? shift.id : null;
  if (beforeId === afterId) return res.json({ changed: false, userId, shiftId: afterId, shift });

  usersRepository.setUserShift(userId, afterId);
  audit(req, 'user_shift_assigned', { targetUserId: userId, changes: { shiftId: { before: beforeId, after: afterId } }, reason });
  return res.json({ changed: true, userId, shiftId: afterId, shift });
});

module.exports = router;

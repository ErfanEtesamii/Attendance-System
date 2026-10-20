// شیفت‌های کاری (S3-6a): CRUD و انتساب به کاربر. از S3-6b/6c محاسبه‌ی روز (computeDay از طریق dayService) شیفتِ منتسب را می‌خواند.
//   خواندن: سرپرست و ادمین (کارمند طبق لیست سفید requireAdminAuth بسته است). نوشتن: فقط ادمین کل، با دلیل اجباری و audit.

const express = require('express');
const router = express.Router();

const { requirePermission } = require('../../../middleware/permissions');
const shiftsRepository = require('../../../repositories/shiftsRepository');
const usersRepository = require('../../../repositories/usersRepository');
const { validateShiftInput, checkConsistency } = require('../../../utils/shiftValidation');
const monthClosuresRepository = require('../../../repositories/monthClosuresRepository');
const { todayDateString } = require('../../../utils/serverTime');
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
  const consistent = merged.isUntimed ? { ok: true } : checkConsistency(merged);
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

// ---------- انتساب شیفت با تاریخ اعمال (فاز ۱۲، B1) ----------
// effectiveFrom (YYYY-MM-DD، پیش‌فرض امروز): شیفت از آن روز به بعد مؤثر است؛ روزهای قبل از آن (و ماه‌های بسته) دست نمی‌خورند.
// تاریخ گذشته فقط وقتی مجاز است که هیچ ماه بسته‌شده‌ای بین آن تاریخ و امروز نباشد (وگرنه ۴۰۹).
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_BULK = 200;

function parseEffectiveFrom(raw) {
  const today = todayDateString();
  if (raw === undefined || raw === null || raw === '') return { value: today };
  if (typeof raw !== 'string' || !DATE_RE.test(raw) || Number.isNaN(Date.parse(`${raw}T00:00:00Z`)) || new Date(`${raw}T00:00:00Z`).toISOString().slice(0, 10) !== raw) {
    return { error: { status: 400, body: { error: '«effectiveFrom» باید تاریخ معتبر YYYY-MM-DD باشد.', field: 'effectiveFrom' } } };
  }
  if (raw < today && monthClosuresRepository.findClosedOverlapping(raw, today).length > 0) {
    return { error: { status: 409, code: 'MONTH_CLOSED', body: { code: 'MONTH_CLOSED', error: 'از این تاریخ به بعد ماهِ بسته‌شده وجود دارد؛ تغییر شیفت روی ماه بسته ممکن نیست. تاریخ اعمال را بعد از آن بگذارید.', field: 'effectiveFrom' } } };
  }
  return { value: raw };
}

// شیفت از بدنه: عدد | null ⇒ { shift } | { error }
function parseShiftRef(raw) {
  if (raw === undefined) return { error: { status: 400, body: { error: '«shiftId» الزامی است (عدد یا null برای برداشتن شیفت).', field: 'shiftId' } } };
  if (raw === null) return { shift: null };
  const sid = typeof raw === 'number' && Number.isInteger(raw) ? raw : parseId(raw);
  const shift = sid === null ? null : shiftsRepository.findById(sid);
  if (!shift) return { error: { status: 404, body: { error: 'شیفت یافت نشد.', field: 'shiftId' } } };
  return { shift };
}

// یک انتساب + audit ⇒ { changed, userId, shiftId, shift, effectiveFrom }
function applyAssignment(req, user, shift, effectiveFrom, reason) {
  const afterId = shift ? shift.id : null;
  const current = shiftsRepository.shiftOn(user.id, effectiveFrom);
  const beforeId = current ? current.id : null;
  if (beforeId === afterId) return { changed: false, userId: user.id, shiftId: afterId, shift, effectiveFrom };
  shiftsRepository.assignShift({ userId: user.id, shiftId: afterId, effectiveFrom, createdBy: req.adminUser.id });
  audit(req, 'user_shift_assigned', { targetUserId: user.id, effectiveFrom, changes: { shiftId: { before: beforeId, after: afterId } }, reason });
  return { changed: true, userId: user.id, shiftId: afterId, shift, effectiveFrom };
}

// PUT /admin/users/:id/shift  { shiftId: عدد | null, [effectiveFrom], reason } → { changed, userId, shiftId, shift, effectiveFrom }
router.put('/admin/users/:id/shift', requirePermission('shifts.edit'), (req, res) => {
  const userId = parseId(req.params.id);
  const user = userId === null ? null : usersRepository.findById(userId);
  if (!user) return res.status(404).json({ error: 'کارمند یافت نشد.' });
  const reason = requireReason(req, res);
  if (reason === null) return undefined;

  const ref = parseShiftRef((req.body || {}).shiftId);
  if (ref.error) return res.status(ref.error.status).json(ref.error.body);
  const eff = parseEffectiveFrom((req.body || {}).effectiveFrom);
  if (eff.error) return res.status(eff.error.status).json(eff.error.body);
  return res.json(applyAssignment(req, user, ref.shift, eff.value, reason));
});

// POST /admin/shifts/assign  { shiftId: عدد | null, userIds: [..حداکثر ۲۰۰], [effectiveFrom], reason }
//   انتساب گروهیِ چند کارمند به یک شیفت (یا برداشتن شیفت). هر کاربر جدا اعمال و audit می‌شود؛ کاربر ناموجود فقط در results خطا می‌گیرد.
//   → { effectiveFrom, shiftId, changedCount, results: [{ userId, changed, error? }] }
router.post('/admin/shifts/assign', requirePermission('shifts.edit'), (req, res) => {
  const reason = requireReason(req, res);
  if (reason === null) return undefined;
  const body = req.body || {};
  const ref = parseShiftRef(body.shiftId);
  if (ref.error) return res.status(ref.error.status).json(ref.error.body);
  const eff = parseEffectiveFrom(body.effectiveFrom);
  if (eff.error) return res.status(eff.error.status).json(eff.error.body);
  const ids = Array.isArray(body.userIds) ? [...new Set(body.userIds.map((x) => (Number.isInteger(x) ? x : parseId(x))))] : null;
  if (!ids || ids.length === 0 || ids.some((x) => x === null || x <= 0)) return res.status(400).json({ error: '«userIds» باید فهرست غیرخالی از شناسه‌ی کارمندان باشد.', field: 'userIds' });
  if (ids.length > MAX_BULK) return res.status(400).json({ error: `حداکثر ${MAX_BULK} کارمند در هر درخواست.`, field: 'userIds' });

  const results = ids.map((id) => {
    const user = usersRepository.findById(id);
    if (!user) return { userId: id, changed: false, error: 'کارمند یافت نشد.' };
    const r = applyAssignment(req, user, ref.shift, eff.value, reason);
    return { userId: id, changed: r.changed };
  });
  return res.json({ effectiveFrom: eff.value, shiftId: ref.shift ? ref.shift.id : null, changedCount: results.filter((r) => r.changed).length, results });
});

module.exports = router;

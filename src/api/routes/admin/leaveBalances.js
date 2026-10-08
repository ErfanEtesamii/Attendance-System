// API مانده‌ی مرخصی (S4-9c). منطق در leaveBalanceService؛ این‌جا فقط مجوز، اسکوپ و قالب پاسخ.
//   خواندن (leave.balance.read — همه‌ی نقش‌ها): اسکوپ سمت سرور:
//     کارمند = فقط خودش | سرپرست = خودش + تیم مستقیمش | admin و hr = همه (hr فقط‌خواندنی).
//   نوشتن (leave.balance.edit — فقط admin): تعدیل دستی و ثبت استحقاق/انتقالی؛ دلیل اجباری + audit (در سرویس).
// همه‌ی مقادیر «دقیقه»اند؛ display (روز/ساعت بر پایه‌ی روز کاری همان کاربر) فقط برای نمایش است.

const express = require('express');
const router = express.Router();

const { requirePermission } = require('../../../middleware/permissions');
const usersRepository = require('../../../repositories/usersRepository');
const leaveTypesRepository = require('../../../repositories/leaveTypesRepository');
const leaveBalanceService = require('../../../services/leaveBalanceService');
const { scopedUserIds } = require('./common');
const { todayDateString } = require('../../../utils/serverTime');
const { jalaliYearOfDateString } = require('../../../utils/jalali');

const ERROR_STATUS = {
  USER_NOT_FOUND: 404,
  TYPE_NOT_FOUND: 404,
  INVALID_YEAR: 400,
  INVALID_MINUTES: 400,
  REASON_REQUIRED: 400,
  NOTHING_TO_SET: 400,
  NOT_TRACKED: 400,
  CARRY_OVER_EXCEEDS_CAP: 400,
};
const sendFailure = (res, r) => res.status(ERROR_STATUS[r.code] || 400).json({ error: r.error, code: r.code });

const parseId = (raw) => (/^\d+$/.test(String(raw)) ? parseInt(raw, 10) : null);

// سال شمسی از query/body؛ بدون مقدار ⇒ سال شمسیِ امروز. نامعتبر ⇒ null
function resolveYear(raw) {
  if (raw === undefined || raw === null || raw === '') return jalaliYearOfDateString(todayDateString());
  return /^\d{4}$/.test(String(raw)) ? Number(raw) : null;
}

// آیا کاربرِ درخواست‌کننده حق دیدنِ مانده‌ی userId را دارد؟ کارمند/سرپرست: خودش؛ سرپرست: تیم مستقیم؛ admin/hr: همه
function canSee(adminUser, userId) {
  if (Number(userId) === adminUser.id) return true;
  const ids = scopedUserIds(adminUser);
  return ids === null || ids.includes(Number(userId));
}

function balancesOf(user, year, types) {
  const balances = [];
  for (const type of types) {
    const d = leaveBalanceService.describeBalance({ userId: user.id, leaveTypeId: type.id, jalaliYear: year });
    if (!d.ok || !d.tracked) continue;
    const { ok, tracked, userId, ...rest } = d;
    balances.push({ leaveType: { id: type.id, code: type.code, title: type.title }, ...rest });
  }
  return { userId: user.id, fullName: user.full_name, department: user.department || null, balances };
}

// GET /admin/leave-balances[?userId=&year=&leaveTypeId=] → { jalaliYear, items: [{ userId, fullName, department, balances: [...] }] }
// بدون userId: کارمند ⇒ خودش؛ سرپرست ⇒ خودش + تیم؛ admin/hr ⇒ همه‌ی کاربران فعال. userId خارج از اسکوپ ⇒ ۴۰۳.
router.get('/admin/leave-balances', requirePermission('leave.balance.read'), (req, res) => {
  const year = resolveYear(req.query.year);
  if (year === null || year < 1300 || year > 1800) return res.status(400).json({ error: 'سال شمسی نامعتبر است.', code: 'INVALID_YEAR' });

  let types = leaveTypesRepository.listLeaveTypes().filter((t) => t.countsAgainstBalance);
  if (req.query.leaveTypeId !== undefined) {
    const typeId = parseId(req.query.leaveTypeId);
    types = types.filter((t) => t.id === typeId);
  }

  const me = req.adminUser;
  let users;
  if (req.query.userId !== undefined) {
    const uid = parseId(req.query.userId);
    if (uid === null) return res.status(400).json({ error: 'شناسه‌ی کاربر نامعتبر است.', code: 'INVALID_USER' });
    if (!canSee(me, uid)) return res.status(403).json({ error: 'دسترسی به مانده‌ی این کاربر را ندارید.' });
    const user = usersRepository.findById(uid);
    if (!user) return res.status(404).json({ error: 'کاربر پیدا نشد.', code: 'USER_NOT_FOUND' });
    users = [user];
  } else {
    const ids = scopedUserIds(me);
    users = usersRepository.listUsers({ onlyActive: true });
    if (ids !== null) {
      const allowed = new Set(me.role === 'manager' ? [...ids, me.id] : ids);
      users = users.filter((u) => allowed.has(u.id));
    }
  }
  return res.json({ jalaliYear: year, items: users.map((u) => balancesOf(u, year, types)) });
});

// GET /admin/leave-balances/:userId/adjustments?year=&leaveTypeId= → { jalaliYear, leaveTypeId, adjustments: [...] } (تاریخچه‌ی تعدیل‌ها؛ همان اسکوپ)
router.get('/admin/leave-balances/:userId/adjustments', requirePermission('leave.balance.read'), (req, res) => {
  const uid = parseId(req.params.userId);
  const typeId = parseId(req.query.leaveTypeId);
  const year = resolveYear(req.query.year);
  if (uid === null || typeId === null) return res.status(400).json({ error: 'userId و leaveTypeId الزامی‌اند.', code: 'INVALID_INPUT' });
  if (!canSee(req.adminUser, uid)) return res.status(403).json({ error: 'دسترسی به مانده‌ی این کاربر را ندارید.' });
  const r = leaveBalanceService.listAdjustments({ userId: uid, leaveTypeId: typeId, jalaliYear: year === null ? NaN : year });
  if (!r.ok) return sendFailure(res, r);
  return res.json({ jalaliYear: year, leaveTypeId: typeId, adjustments: r.adjustments });
});

// POST /admin/leave-balances/adjust  { userId, leaveTypeId, year?, minutes (امضادار)، reason } → 201 { adjustment, balance }
router.post('/admin/leave-balances/adjust', requirePermission('leave.balance.edit'), (req, res) => {
  const b = req.body || {};
  const r = leaveBalanceService.addAdjustment({
    userId: b.userId, leaveTypeId: b.leaveTypeId, jalaliYear: resolveYear(b.year) === null ? NaN : resolveYear(b.year),
    minutes: b.minutes, reason: b.reason, actor: req.adminUser.id, ip: req.ip,
  });
  if (!r.ok) return sendFailure(res, r);
  return res.status(201).json({ adjustment: r.adjustment, balance: r.balance });
});

// PUT /admin/leave-balances/entitlement  { userId, leaveTypeId, year?, entitledMinutes?, carriedOverMinutes?, reason } → { balance }
router.put('/admin/leave-balances/entitlement', requirePermission('leave.balance.edit'), (req, res) => {
  const b = req.body || {};
  const r = leaveBalanceService.setEntitlement({
    userId: b.userId, leaveTypeId: b.leaveTypeId, jalaliYear: resolveYear(b.year) === null ? NaN : resolveYear(b.year),
    entitledMinutes: b.entitledMinutes, carriedOverMinutes: b.carriedOverMinutes, reason: b.reason, actor: req.adminUser.id, ip: req.ip,
  });
  if (!r.ok) return sendFailure(res, r);
  return res.json({ balance: r.balance });
});

module.exports = router;

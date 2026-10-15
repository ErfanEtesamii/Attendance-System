// D3 (فاز ۱۲): صف «درخواست‌های اجازه‌ی ورود» برای سرپرست/ادمین (سقف تأخیر ماهانه).
//   GET  /admin/checkin-permissions?status=pending|approved|rejected|used|expired|all   checkin_permissions.read
//        ⇒ { items: [{ id, userId, date, status, reason, requestedAt, decidedBy, decidedAt, decisionNote, expiresAt, usedAt,
//                      user, lateCount, limit, canDecide }], total }
//   POST /admin/checkin-permissions/:id/decide { decision: 'approve'|'reject', note? }   checkin_permissions.decide
//        ⇒ { permission } | { error, code }
// اسکوپ سمت سرور (مثل بقیه‌ی routeها با scopedUserIds): سرپرست فقط تیم مستقیم خودش؛ admin و hr همه (hr فقط‌خواندنی: مجوز decide ندارد).
// کارمندِ بدون سرپرست فقط توسط ادمین تصمیم می‌گیرد (lateLimitService.canDecide). تصمیمِ دوباره روی درخواستِ تصمیم‌گرفته‌شده ⇒ ۴۰۹.
const express = require('express');
const router = express.Router();

const { requirePermission, hasPermission } = require('../../../middleware/permissions');
const usersRepository = require('../../../repositories/usersRepository');
const lateLimitService = require('../../../services/lateLimitService');
const { decideAndNotify } = require('../../../services/checkinPermissionDecisionService');
const { scopedUserIds } = require('./common');

const STATUSES = ['pending', 'approved', 'rejected', 'used', 'expired', 'all'];
const isId = (v) => /^\d+$/.test(String(v));
const bad = (res, code, error) => res.status(400).json({ error, code });

router.get('/admin/checkin-permissions', requirePermission('checkin_permissions.read'), (req, res) => {
  const status = req.query.status === undefined || req.query.status === '' ? 'pending' : String(req.query.status);
  if (!STATUSES.includes(status)) return bad(res, 'INVALID_STATUS', 'وضعیت نامعتبر است (pending|approved|rejected|used|expired|all).');
  const me = req.adminUser;
  const mayDecide = hasPermission(me.role, 'checkin_permissions.decide');
  const items = lateLimitService.listForQueue({ status: status === 'all' ? null : status, userIds: scopedUserIds(me) }).map((it) => {
    const employee = usersRepository.findById(it.userId);
    return { ...it, canDecide: mayDecide && it.status === 'pending' && !!employee && lateLimitService.canDecide(me, employee) };
  });
  res.json({ items, total: items.length });
});

router.post('/admin/checkin-permissions/:id/decide', requirePermission('checkin_permissions.decide'), (req, res) => {
  if (!isId(req.params.id)) return bad(res, 'INVALID_ID', 'شناسه‌ی درخواست نامعتبر است.');
  const b = req.body || {};
  let approve;
  if (b.decision === 'approve' || b.decision === 'reject') approve = b.decision === 'approve';
  else if (typeof b.approve === 'boolean') approve = b.approve;
  else return bad(res, 'INVALID_DECISION', 'decision باید approve یا reject باشد.');
  if (b.note !== undefined && b.note !== null && typeof b.note !== 'string') return bad(res, 'INVALID_NOTE', 'note باید متن باشد.');

  const r = decideAndNotify(req.adminUser, Number(req.params.id), approve, b.note, { source: 'admin_panel', ip: req.ip });
  if (!r.ok) return res.status(r.status).json({ error: r.error, code: r.code });
  res.json({ permission: r.permission });
});

module.exports = router;

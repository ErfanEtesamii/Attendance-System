// Audit Log: مشاهده، خروجی و فهرست عملیات (فقط ادمین کل).
// (تقسیم‌شده از admin.js/adminPanel.js؛ URLها و رفتار بدون تغییر. احراز هویت در index.js یک‌بار اعمال می‌شود.)

const express = require('express');
const router = express.Router();

const { requireFullAdmin } = require('../../../middleware/adminAuth');
const usersRepository = require('../../../repositories/usersRepository');
const auditRepository = require('../../../repositories/auditRepository');
const { sendCsv } = require('../../../utils/csv');
const { audit } = require('./common');

// ---------- Audit Log (فقط ادمین کل) ----------

router.get('/admin/audit-log', requireFullAdmin, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 1000);
  const { userId, action, from, to, q } = req.query;
  const rows = auditRepository.search({ userId, action, from, to, q, limit });

  const enriched = rows.map((r) => {
    const u = r.user_id ? usersRepository.findById(r.user_id) : null;
    return { ...r, userFullName: u ? u.full_name : null };
  });
  res.json(enriched);
});

router.get('/admin/audit-log/export', requireFullAdmin, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 500, 2000);
  const rows = (req.query.userId
    ? auditRepository.listByUser(req.query.userId, limit)
    : auditRepository.listRecent(limit)
  ).map((r) => {
    const u = r.user_id ? usersRepository.findById(r.user_id) : null;
    return [r.id, r.occurred_at, u ? u.full_name : '', r.action, r.ip_address || '', r.details || ''];
  });

  sendCsv(res, 'audit-log.csv', ['ردیف', 'زمان', 'کارمند', 'عملیات', 'IP', 'جزئیات'], rows);
});

// ---------- فیلترهای Audit ----------

router.get('/admin/audit-actions', requireFullAdmin, (req, res) => {
  res.json(auditRepository.listActions());
});

module.exports = router;

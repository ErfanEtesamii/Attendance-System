// Audit Log: مشاهده، خروجی و فهرست عملیات (فقط ادمین کل).
// (تقسیم‌شده از admin.js/adminPanel.js؛ URLها و رفتار بدون تغییر. احراز هویت در index.js یک‌بار اعمال می‌شود.)

const express = require('express');
const router = express.Router();

const { requireFullAdmin } = require('../../../middleware/adminAuth');
const usersRepository = require('../../../repositories/usersRepository');
const auditRepository = require('../../../repositories/auditRepository');
const { sendCsv } = require('../../../utils/csv');
const { instantToJalaliString } = require('../../../utils/jalali');
const settingsRepository = require('../../../repositories/settingsRepository');
const { audit } = require('./common');

// ---------- Audit Log (فقط ادمین کل) ----------

// include_archive (S2-6c): 1|true ⇒ رکوردهای آرشیوشده هم بیایند؛ نبودن/0|false ⇒ فقط audit_log (رفتار قبلی).
// هر مقدار دیگر (یا تکراری) ⇒ null تا ۴۰۰ بدهیم، نه اینکه غلط‌تایپی بی‌صدا آرشیو را نادیده بگیرد.
function parseIncludeArchive(raw) {
  if (raw === undefined || raw === '') return false;
  if (raw === '1' || raw === 'true') return true;
  if (raw === '0' || raw === 'false') return false;
  return null;
}
const BAD_INCLUDE_ARCHIVE = { error: 'مقدار include_archive باید 1 یا 0 (یا true/false) باشد.' };

router.get('/admin/audit-log', requireFullAdmin, (req, res) => {
  const includeArchive = parseIncludeArchive(req.query.include_archive);
  if (includeArchive === null) return res.status(400).json(BAD_INCLUDE_ARCHIVE);
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 1000);
  const { userId, action, from, to, q } = req.query;
  const rows = auditRepository.search({ userId, action, from, to, q, limit, includeArchive });

  const enriched = rows.map((r) => {
    const u = r.user_id ? usersRepository.findById(r.user_id) : null;
    const out = { ...r, userFullName: u ? u.full_name : null };
    if (includeArchive) out.archived = !!r.archived; // فقط با include_archive: این ردیف از آرشیو آمده؟
    return out;
  });
  res.json(enriched);
});

router.get('/admin/audit-log/export', requireFullAdmin, (req, res) => {
  const includeArchive = parseIncludeArchive(req.query.include_archive);
  if (includeArchive === null) return res.status(400).json(BAD_INCLUDE_ARCHIVE);
  const limit = Math.min(parseInt(req.query.limit, 10) || 500, 2000);
  const tz = settingsRepository.getTimezone();
  const rows = (req.query.userId
    ? auditRepository.listByUser(req.query.userId, limit, { includeArchive })
    : auditRepository.listRecent(limit, { includeArchive })
  ).map((r) => {
    const u = r.user_id ? usersRepository.findById(r.user_id) : null;
    const cells = [r.id, r.occurred_at, instantToJalaliString(r.occurred_at, tz), u ? u.full_name : '', r.action, r.ip_address || '', r.details || ''];
    if (includeArchive) cells.push(r.archived ? 'آرشیو' : 'اصلی'); // ستون «منبع» فقط با include_archive؛ قالب پیش‌فرض بدون تغییر
    return cells;
  });

  const headers = ['ردیف', 'زمان', 'تاریخ شمسی', 'کارمند', 'عملیات', 'IP', 'جزئیات'];
  if (includeArchive) headers.push('منبع');
  sendCsv(res, 'audit-log.csv', headers, rows);
});

// ---------- فیلترهای Audit ----------

router.get('/admin/audit-actions', requireFullAdmin, (req, res) => {
  res.json(auditRepository.listActions());
});

module.exports = router;

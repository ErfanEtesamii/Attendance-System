// Audit Log: مشاهده، خروجی و فهرست عملیات (فقط ادمین کل).
// (تقسیم‌شده از admin.js/adminPanel.js؛ URLها و رفتار بدون تغییر. احراز هویت در index.js یک‌بار اعمال می‌شود.)

const express = require('express');
const router = express.Router();

const { requirePermission } = require('../../../middleware/permissions');
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

// S4-2a: فیلترهای مشترک لیست و CSV: userId، action، entityType، entityId، from، to (YYYY-MM-DD میلادی)، q.
// همه اختیاری و با AND ترکیب می‌شوند؛ ورودی نامعتبر ⇒ ۴۰۰ فارسی (نه نتیجه‌ی خالی بی‌صدا). بدون هیچ فیلتر ⇒ رفتار قبلی.
// نتیجه: { filters } یا { error } برای پاسخ ۴۰۰.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const one = (v) => (typeof v === 'string' ? v.trim() : undefined);

function parseFilters(query) {
  for (const k of ['userId', 'action', 'entityType', 'entityId', 'from', 'to', 'q']) {
    if (query[k] !== undefined && typeof query[k] !== 'string') return { error: `پارامتر ${k} باید یک مقدار باشد.` };
  }
  const f = {};
  const userId = one(query.userId);
  if (userId) {
    if (!/^\d+$/.test(userId)) return { error: 'userId باید عدد صحیح باشد.' };
    f.userId = Number(userId);
  }
  const action = one(query.action);
  if (action) f.action = action;
  const entityType = one(query.entityType);
  if (entityType) {
    if (entityType.length > 100) return { error: 'entityType بیش از حد طولانی است.' };
    f.entityType = entityType;
  }
  const entityId = one(query.entityId);
  if (entityId) {
    if (entityId.length > 100) return { error: 'entityId بیش از حد طولانی است.' };
    f.entityId = entityId;
  }
  for (const k of ['from', 'to']) {
    const v = one(query[k]);
    if (!v) continue;
    if (!ISO_DATE.test(v) || Number.isNaN(new Date(`${v}T00:00:00Z`).getTime())) return { error: `${k} باید تاریخ میلادی به‌صورت YYYY-MM-DD باشد.` };
    f[k] = v;
  }
  if (f.from && f.to && f.from > f.to) return { error: 'from نمی‌تواند بعد از to باشد.' };
  const q = one(query.q);
  if (q) f.q = q;
  return { filters: f };
}

router.get('/admin/audit-log', requirePermission('audit.read'), (req, res) => {
  const includeArchive = parseIncludeArchive(req.query.include_archive);
  if (includeArchive === null) return res.status(400).json(BAD_INCLUDE_ARCHIVE);
  const parsed = parseFilters(req.query);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 1000);
  const rows = auditRepository.search({ ...parsed.filters, limit, includeArchive });

  const enriched = rows.map((r) => {
    const u = r.user_id ? usersRepository.findById(r.user_id) : null;
    const out = { ...r, userFullName: u ? u.full_name : null };
    if (includeArchive) out.archived = !!r.archived; // فقط با include_archive: این ردیف از آرشیو آمده؟
    return out;
  });
  res.json(enriched);
});

router.get('/admin/audit-log/export', requirePermission('audit.read'), (req, res) => {
  const includeArchive = parseIncludeArchive(req.query.include_archive);
  if (includeArchive === null) return res.status(400).json(BAD_INCLUDE_ARCHIVE);
  const parsed = parseFilters(req.query);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const limit = Math.min(parseInt(req.query.limit, 10) || 500, 2000);
  const tz = settingsRepository.getTimezone();
  // S4-2a: همان فیلترهای لیست (قبلاً فقط userId)؛ ترتیب و ستون‌ها مثل قبل (جدیدترین اول)
  const rows = auditRepository.search({ ...parsed.filters, limit, includeArchive }).map((r) => {
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

router.get('/admin/audit-actions', requirePermission('audit.read'), (req, res) => {
  res.json(auditRepository.listActions());
});

module.exports = router;

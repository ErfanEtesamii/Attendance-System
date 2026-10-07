// موارد مشکوک (S2-5a): فهرست و ثبت نتیجه‌ی بررسی.
// ⚠️ هر مورد یک «نشانه» است نه اتهام/مدرک؛ device_id قابل جعل است و تشخیص‌ها فقط برای بررسی انسانی‌اند.
//
// اسکوپ:
//   admin    — همه‌ی موارد
//   manager  — فقط مواردی که «همه‌ی» کاربرانشان در تیم خودش‌اند (مورد مشترک با کاربر تیم دیگر دیده نمی‌شود)
//   employee — ممنوع (هم با لیست سفید requireAdminAuth و هم با requirePermission؛ دو لایه)

const express = require('express');
const router = express.Router();

const { requirePermission } = require('../../../middleware/permissions');
const suspiciousRepository = require('../../../repositories/suspiciousRepository');
const { scopedUserIds, DATE_RE, userBrief, makeUserMap, requireReason, audit } = require('./common');

const REVIEW_STATUSES = ['reviewed', 'ignored'];

// آیا همه‌ی کاربران این مورد داخل اسکوپ‌اند؟ (ids === null یعنی ادمین/بدون محدودیت)
function inScope(ids, event) {
  if (ids === null) return true;
  return event.user_ids.length > 0 && event.user_ids.every((id) => ids.includes(id));
}

function present(event, userMap) {
  return {
    id: event.id,
    eventType: event.event_type,
    eventDate: event.event_date,
    status: event.status,
    details: event.details,
    recordIds: event.record_ids,
    users: event.user_ids.map((id) => userBrief(userMap.get(id)) || { id }),
    reviewedBy: event.reviewed_by ? userBrief(userMap.get(event.reviewed_by)) || { id: event.reviewed_by } : null,
    reviewedAt: event.reviewed_at,
    createdAt: event.created_at,
  };
}

// GET /admin/suspicious?status=open|reviewed|ignored&from=YYYY-MM-DD&to=YYYY-MM-DD&limit=
router.get('/admin/suspicious', requirePermission('suspicious.read'), (req, res) => {
  const { status, from, to } = req.query;
  if (status !== undefined && status !== '' && !suspiciousRepository.STATUSES.includes(status)) {
    return res.status(400).json({ error: 'وضعیت نامعتبر است (open | reviewed | ignored).' });
  }
  for (const [name, value] of [['from', from], ['to', to]]) {
    if (value !== undefined && value !== '' && !DATE_RE.test(String(value))) {
      return res.status(400).json({ error: `پارامتر ${name} باید به‌صورت YYYY-MM-DD باشد.` });
    }
  }
  const ids = scopedUserIds(req.adminUser);
  const userMap = makeUserMap();
  const limit = Math.min(parseInt(req.query.limit, 10) || 200, 500);
  // اسکوپ بعد از خواندن اعمال می‌شود (user_ids داخل JSON است)؛ پس برای سرپرست کمی بیشتر می‌خوانیم تا limit بعد از فیلتر پر بماند.
  const rows = suspiciousRepository.list({
    status: status || undefined,
    from: from || undefined,
    to: to || undefined,
    limit: ids === null ? limit : 1000,
  });
  res.json(rows.filter((e) => inScope(ids, e)).slice(0, limit).map((e) => present(e, userMap)));
});

// POST /admin/suspicious/:id/review  { status: 'reviewed'|'ignored' (پیش‌فرض reviewed), reason (اجباری) }
router.post('/admin/suspicious/:id/review', requirePermission('suspicious.review'), (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'شناسه‌ی نامعتبر است.' });

  const event = suspiciousRepository.getById(id);
  if (!event) return res.status(404).json({ error: 'مورد یافت نشد.' });
  if (!inScope(scopedUserIds(req.adminUser), event)) {
    return res.status(403).json({ error: 'به این مورد دسترسی ندارید.' });
  }

  const newStatus = req.body && req.body.status !== undefined ? req.body.status : 'reviewed';
  if (!REVIEW_STATUSES.includes(newStatus)) {
    return res.status(400).json({ error: 'وضعیت جدید باید reviewed یا ignored باشد.' });
  }
  const reason = requireReason(req, res);
  if (reason === null) return undefined;
  if (event.status === newStatus) {
    return res.status(409).json({ error: 'این مورد از قبل با همین وضعیت ثبت شده است.' });
  }

  const updated = suspiciousRepository.markReviewed(id, { status: newStatus, reviewedBy: req.adminUser.id });
  audit(req, 'suspicious_reviewed', {
    eventId: id,
    eventType: event.event_type,
    eventDate: event.event_date,
    targetUserIds: event.user_ids,
    previousStatus: event.status,
    newStatus,
    reason,
  });
  return res.json(present(updated, makeUserMap()));
});

module.exports = router;

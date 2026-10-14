// اعتراض‌های کارمندان به رکوردها و گفت‌وگو روی آن‌ها.
// (تقسیم‌شده از admin.js/adminPanel.js؛ URLهای قدیمی بدون تغییر. احراز هویت در index.js یک‌بار اعمال می‌شود.)
//
// فاز ۱۱ (D3): thread کامل، پاسخ ادمین/سرپرست، resolve با پیام پایانیِ اختیاری، شمارنده‌ی «منتظر پاسخ ادمین».
//   قواعد دامنه در disputeService؛ اینجا فقط مجوز، اسکوپ نقش، audit و اعلان.
//   مجوزها: خواندن = disputes.read (کارمند فقط فهرستِ خودش از لیست سفید؛ مسیرهای جدید برای کارمند بسته است و او از Mini App استفاده می‌کند)،
//           نوشتن (پاسخ/resolve/reopen) = disputes.resolve (hr فقط‌خواندنی است).
//   ترتیب مهم است: /admin/disputes/counts باید قبل از /admin/disputes/:id ثبت شود.

const express = require('express');
const router = express.Router();

const usersRepository = require('../../../repositories/usersRepository');
const disputeRepository = require('../../../repositories/disputeRepository');
const disputeService = require('../../../services/disputeService');
const { scopedUserIds, canAccessUser, userBrief, makeUserMap, auditChange, audit } = require('./common');
const { disputeView } = require('../../../utils/auditViews');
const { requirePermission } = require('../../../middleware/permissions');
const notificationEvents = require('../../../services/notificationEvents');

const sendFailure = (res, r) => res.status(disputeService.statusOf(r.code)).json({ error: r.error, code: r.code });

// اعتراض موجود و در حوزه‌ی نقش، یا پاسخ ۴۰۴/۴۰۳ (و null)
function loadScoped(req, res) {
  const dispute = disputeRepository.findById(parseInt(req.params.id, 10));
  if (!dispute) {
    res.status(404).json({ error: 'اعتراض یافت نشد.' });
    return null;
  }
  if (!canAccessUser(req.adminUser, dispute.user_id)) {
    res.status(403).json({ error: 'به این کارمند دسترسی ندارید.' });
    return null;
  }
  return dispute;
}

// ---------- اعتراض‌های کارمندان ----------

// ?status= open | resolved (مدل قدیمی) | awaiting_admin | answered | resolved_by_admin | closed_by_user؛ مقدار ناشناخته ⇒ همه.
// فیلدهای قدیمی (id, message, status, createdAt, updatedAt, employee, record) حفظ شده‌اند؛ فیلدهای گفت‌وگو اضافه‌اند.
router.get('/admin/disputes', requirePermission('disputes.read'), (req, res) => {
  const status = disputeService.ADMIN_STATUS_FILTERS.includes(req.query.status) ? req.query.status : null;
  const items = disputeService.listForAdmin({ status, userIds: scopedUserIds(req.adminUser) });
  const userMap = makeUserMap();
  res.json(
    items.map((d) => ({
      ...d,
      employee: userBrief(userMap.get(d.userId)),
      record: d.recordDate ? { id: d.attendanceRecordId, date: d.recordDate } : null,
    }))
  );
});

// شمارنده‌ها در همان اسکوپ نقش: { total, open, awaitingAdmin, answered, resolved, resolvedByAdmin, closedByUser }
router.get('/admin/disputes/counts', requirePermission('disputes.read'), (req, res) => {
  res.json(disputeService.countsForAdmin({ userIds: scopedUserIds(req.adminUser) }));
});

// thread کامل: { dispute, messages, employee, record }
router.get('/admin/disputes/:id', requirePermission('disputes.read'), (req, res) => {
  const dispute = loadScoped(req, res);
  if (!dispute) return;
  const r = disputeService.getForAdmin(dispute.id);
  if (!r.ok) return sendFailure(res, r);
  res.json({
    dispute: r.dispute,
    messages: r.messages,
    employee: userBrief(usersRepository.findById(dispute.user_id)),
    record: r.dispute.recordDate ? { id: r.dispute.attendanceRecordId, date: r.dispute.recordDate } : null,
  });
});

// { message } — پاسخ ادمین/سرپرست روی اعتراضِ باز (حداکثر ۵۰۰ نویسه)
router.post('/admin/disputes/:id/messages', requirePermission('disputes.resolve'), (req, res) => {
  const dispute = loadScoped(req, res);
  if (!dispute) return;
  const r = disputeService.replyAsAdmin(req.adminUser, dispute.id, req.body || {});
  if (!r.ok) return sendFailure(res, r);
  audit(req, 'dispute_message_sent', { disputeId: dispute.id, messageId: r.message.id, targetUserId: dispute.user_id, length: r.message.message.length });
  notificationEvents.disputeAdminMessage(dispute, r.message, { actor: req.adminUser }); // پنل + تلگرام برای کارمند (D4)
  res.status(201).json({ dispute: r.dispute, messages: r.messages });
});

// { note? } — resolve: یادداشت اختیاری = پیام پایانیِ thread؛ reopen: یادداشت اختیاری = پیام ادمین. reopen به سقف کارمند نمی‌شمارد.
router.post('/admin/disputes/:id/:action(resolve|reopen)', requirePermission('disputes.resolve'), (req, res) => {
  const dispute = loadScoped(req, res);
  if (!dispute) return;
  const resolving = req.params.action === 'resolve';
  const r = resolving
    ? disputeService.resolveAsAdmin(req.adminUser, dispute.id, req.body || {})
    : disputeService.reopenAsAdmin(req.adminUser, dispute.id, req.body || {});
  if (!r.ok) return sendFailure(res, r);
  const { updated, note } = r;
  auditChange(req, {
    action: resolving ? 'dispute_resolved' : 'dispute_reopened',
    entityType: 'dispute',
    entityId: dispute.id,
    before: disputeView(dispute),
    after: disputeView(updated),
    reason: note || null, // یادداشت بستن/بازگشایی = دلیل
    meta: { disputeId: dispute.id, targetUserId: dispute.user_id },
  });
  if (resolving) notificationEvents.disputeResolved(updated, { note }); // اعلان پنل برای کارمند (S4-6b)
  else if (r.message) notificationEvents.disputeAdminMessage(updated, r.message, { actor: req.adminUser }); // بازگشایی همراه پیام ⇒ مثل پاسخ (D4)
  if (resolving) notificationEvents.disputeResolvedTelegram(updated, { note, actor: req.adminUser }); // تلگرام + دکمه‌ی گفت‌وگو (مسیر مشترک با بات)
  res.json(updated);
});

module.exports = router;

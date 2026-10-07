// اعتراض‌های کارمندان به رکوردها.
// (تقسیم‌شده از admin.js/adminPanel.js؛ URLها و رفتار بدون تغییر. احراز هویت در index.js یک‌بار اعمال می‌شود.)

const express = require('express');
const router = express.Router();

const usersRepository = require('../../../repositories/usersRepository');
const attendanceRepository = require('../../../repositories/attendanceRepository');
const disputeRepository = require('../../../repositories/disputeRepository');
const { sendMessage } = require('../../../bot/notifier');
const { scopedUserIds, canAccessUser, userBrief, makeUserMap, auditChange } = require('./common');
const { disputeView } = require('../../../utils/auditViews');
const { requirePermission } = require('../../../middleware/permissions');

// ---------- اعتراض‌های کارمندان ----------

router.get('/admin/disputes', requirePermission('disputes.read'), (req, res) => {
  const status = ['open', 'resolved'].includes(req.query.status) ? req.query.status : null;
  const ids = scopedUserIds(req.adminUser);
  let items = disputeRepository.listAll({ status });
  if (ids !== null) items = items.filter((d) => ids.includes(d.user_id));
  const userMap = makeUserMap();
  res.json(
    items.map((d) => {
      const rec = d.attendance_record_id ? attendanceRepository.findById(d.attendance_record_id) : null;
      return {
        id: d.id,
        message: d.message,
        status: d.status,
        createdAt: d.created_at,
        updatedAt: d.updated_at,
        employee: userBrief(userMap.get(d.user_id)),
        record: rec ? { id: rec.id, date: rec.record_date } : null,
      };
    })
  );
});

router.post('/admin/disputes/:id/:action(resolve|reopen)', requirePermission('disputes.resolve'), (req, res) => {
  const dispute = disputeRepository.findById(parseInt(req.params.id, 10));
  if (!dispute) return res.status(404).json({ error: 'اعتراض یافت نشد.' });
  if (!canAccessUser(req.adminUser, dispute.user_id)) {
    return res.status(403).json({ error: 'به این کارمند دسترسی ندارید.' });
  }
  const resolving = req.params.action === 'resolve';
  const updated = disputeRepository.setStatus(dispute.id, resolving ? 'resolved' : 'open');
  const note = ((req.body && req.body.note) || '').trim();
  auditChange(req, {
    action: resolving ? 'dispute_resolved' : 'dispute_reopened',
    entityType: 'dispute',
    entityId: dispute.id,
    before: disputeView(dispute),
    after: disputeView(updated),
    reason: note || null, // یادداشت بستن/بازگشایی = دلیل
    meta: { disputeId: dispute.id, targetUserId: dispute.user_id },
  });
  const employee = usersRepository.findById(dispute.user_id);
  if (resolving && employee?.telegram_user_id) {
    sendMessage(
      employee.telegram_user_id,
      `اعتراض شما بررسی و بسته شد ✅${note ? `\nپاسخ ${req.adminUser.role === 'admin' ? 'ادمین' : 'سرپرست'}: ${note}` : ''}`
    );
  }
  res.json(updated);
});

module.exports = router;

// دورکاری‌های ردشده‌ی خودِ کاربر در «وضعیت من» (پنل) همراه دلیل ردکننده — برای همه‌ی نقش‌ها (me.read).
// ⚠️ اسکوپ: فقط req.adminUser؛ هیچ userId از کلاینت پذیرفته نمی‌شود. فقط‌خواندنی؛ اصلاح/ارسال مجدد از ربات تلگرام انجام می‌شود.
//   GET /admin/me/remote/rejected?days=60 ⇒ { items: [{ id, workDate, startAt, endAt, reviewNote, reviewedAt, reviewerName, tasks, tasksMinutes, accepted, canRevise }] }
const express = require('express');
const { requirePermission } = require('../../../middleware/permissions');
const repo = require('../../../repositories/remoteWorkRepository');
const report = require('../../../services/remoteTaskReportService');

const router = express.Router();

router.get('/admin/me/remote/rejected', requirePermission('me.read'), (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 60, 1), 180);
  const from = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const rows = repo.listRejectedForUser(req.adminUser.id, from, 30);
  const tasksBy = repo.listTasksForSessions(rows.map((r) => r.id));
  res.json({
    items: rows.map((r) => {
      const tasks = (tasksBy.get(r.id) || []).map((t) => ({ title: t.title, minutes: t.minutes }));
      const accepted = report.isRejectAccepted(r.id);
      return {
        id: r.id, workDate: r.work_date, startAt: r.start_at, endAt: r.end_at, reviewNote: r.review_note || null, reviewedAt: r.reviewed_at || null,
        reviewerName: r.reviewer_name || null, tasks, tasksMinutes: tasks.reduce((n, t) => n + t.minutes, 0), accepted, canRevise: !accepted && tasks.length > 0 && !r.auto_closed,
      };
    }),
  });
});

module.exports = router;

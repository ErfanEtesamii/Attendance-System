// مشاهده‌ی گزارش روزانه‌ی تیم در پنل (D9-ب). منطق و اسکوپ در teamReviewService است (مثل Mini App)؛ اینجا فقط مجوز + نگاشت خطا.
//   GET  /admin/team-review?date=YYYY-MM-DD   وضعیت اعضا + خلاصه‌ی گزارش (reviews.read؛ پیش‌فرض: «روز قبل»)
//   POST /admin/report-reviews                 {subjectUserId, reportDate, comment?, reaction?} (reviews.write؛ idempotent)
// سرپرست فقط تیم خودش، ادمین هر کاربرِ دیگر؛ کارمند و hr ممنوع (گارد مجوز / لیست سفید کارمند).
const express = require('express');
const router = express.Router();

const { requirePermission } = require('../../../middleware/permissions');
const teamReviewService = require('../../../services/teamReviewService');
const teamReportsService = require('../../../services/teamReportsService');
const taskExportService = require('../../../services/taskExportService');
const auditRepository = require('../../../repositories/auditRepository');
const { sendSheets, exportAuditFields } = require('../../../utils/xlsx');

const sendError = (res, r) => res.status(teamReviewService.statusOf(r.code)).json({ error: r.error, code: r.code });

router.get('/admin/team-review', requirePermission('reviews.read'), (req, res) => {
  const r = teamReviewService.getTeamReview(req.adminUser, { date: req.query.date, detail: true });
  if (!r.ok) return sendError(res, r);
  return res.json(r);
});

// D10: GET /admin/team-reports?tab=daily|plan|stuck|unreviewed&date=&weekStart=&userId= — اسکوپ نقش در سرویس (کارمند خودش، سرپرست تیم، hr/admin همه؛ hr فقط‌خواندنی)
router.get('/admin/team-reports', requirePermission('taskreports.read'), (req, res) => {
  const r = teamReportsService.getReports(req.adminUser, { tab: req.query.tab, date: req.query.date, weekStart: req.query.weekStart, userId: req.query.userId });
  if (!r.ok) return res.status(teamReportsService.statusOf(r.code)).json({ error: r.error, code: r.code });
  return res.json(r);
});

// D13: خروجی برنامه/گزارش (پیش‌فرض CSV؛ ?format=xlsx چندشیتی) با همان اسکوپ نقش؛ audit report_exported (kind: task_reports)
router.get('/admin/team-reports/export', requirePermission('taskreports.read'), (req, res) => {
  const r = taskExportService.buildTaskSheets(req.adminUser, { from: req.query.from, to: req.query.to, userId: req.query.userId });
  if (!r.ok) return res.status(teamReportsService.statusOf(r.code)).json({ error: r.error, code: r.code });
  return sendSheets(req, res, `task-reports_${r.from}_${r.to}.csv`, r.sheets, {
    csv: { headers: r.sheets[2].headers, rows: r.sheets[2].rows },
    onExport: (info) => auditRepository.logEvent({
      userId: req.adminUser.id, action: 'report_exported', ipAddress: req.ip,
      details: { source: 'admin_panel', kind: 'task_reports', from: r.from, to: r.to, userId: req.query.userId || null, count: r.count, ...exportAuditFields(info) },
    }),
  });
});

// D13: شاخص‌های مدیریتی (نرخ انجام هر تیم، نرخ بررسی به‌موقع هر سرپرست، برنامه‌ی ثبت‌نشده) — analytics.read (کارمند ممنوع؛ سرپرست تیم خودش؛ admin/hr همه)
router.get('/admin/task-kpis', requirePermission('analytics.read'), (req, res) => {
  const r = taskExportService.taskKpis(req.adminUser, { from: req.query.from, to: req.query.to });
  if (!r.ok) return res.status(teamReportsService.statusOf(r.code)).json({ error: r.error, code: r.code });
  return res.json(r);
});

router.post('/admin/report-reviews', requirePermission('reviews.write'), (req, res) => {
  const r = teamReviewService.markReviewed(req.adminUser, req.body, { ip: req.ip });
  if (!r.ok) return sendError(res, r);
  return res.json(r);
});

module.exports = router;

// مشاهده‌ی گزارش روزانه‌ی تیم در پنل (D9-ب). منطق و اسکوپ در teamReviewService است (مثل Mini App)؛ اینجا فقط مجوز + نگاشت خطا.
//   GET  /admin/team-review?date=YYYY-MM-DD   وضعیت اعضا + خلاصه‌ی گزارش (reviews.read؛ پیش‌فرض: «روز قبل»)
//   POST /admin/report-reviews                 {subjectUserId, reportDate, comment?, reaction?} (reviews.write؛ idempotent)
// سرپرست فقط تیم خودش، ادمین هر کاربرِ دیگر؛ کارمند و hr ممنوع (گارد مجوز / لیست سفید کارمند).
const express = require('express');
const router = express.Router();

const { requirePermission } = require('../../../middleware/permissions');
const teamReviewService = require('../../../services/teamReviewService');

const sendError = (res, r) => res.status(teamReviewService.statusOf(r.code)).json({ error: r.error, code: r.code });

router.get('/admin/team-review', requirePermission('reviews.read'), (req, res) => {
  const r = teamReviewService.getTeamReview(req.adminUser, { date: req.query.date, detail: true });
  if (!r.ok) return sendError(res, r);
  return res.json(r);
});

router.post('/admin/report-reviews', requirePermission('reviews.write'), (req, res) => {
  const r = teamReviewService.markReviewed(req.adminUser, req.body, { ip: req.ip });
  if (!r.ok) return sendError(res, r);
  return res.json(r);
});

module.exports = router;

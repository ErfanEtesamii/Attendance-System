// F1 (فاز ۱۲): نمای هفتگی کامل کارمند (فقط‌خواندنی). منطق و اسکوپ نقش در services/employeeWeekService.
//   GET /admin/users/:id/week?start=YYYY-MM-DD   team.week_view (admin/hr همه، سرپرست فقط کارمندان مستقیمش؛ کارمند ممنوع)
// start = هر تاریخ داخل هفته (پیش‌فرض هفته‌ی جاری)؛ هفته با تنظیم weekStartDay. حداکثر یک هفته در هر درخواست.
const express = require('express');
const { requirePermission } = require('../../../middleware/permissions');
const service = require('../../../services/employeeWeekService');
const settingsRepository = require('../../../repositories/settingsRepository');
const { earningsForUser } = require('../../../services/earningsService');
const { todayDateString } = require('../../../utils/serverTime');

const router = express.Router();

router.get('/admin/users/:id/week', requirePermission('team.week_view'), (req, res) => {
  const r = service.getWeek(req.adminUser, req.params.id, { start: req.query.start });
  if (!r.ok) return res.status(r.status).json({ error: r.error, code: r.code });
  return res.json(r);
});

// M1 («وضعیت من»): هفته‌ی خودِ کاربر برای همه‌ی نقش‌ها. پارامتر کاربر ندارد؛ هویت فقط از نشست (req.adminUser).
router.get('/admin/me/week', requirePermission('me.read'), (req, res) => {
  const r = service.getMyWeek(req.adminUser, { start: req.query.start });
  if (!r.ok) return res.status(r.status).json({ error: r.error, code: r.code });
  return res.json(r);
});

// Phase 20: کارت «کارکرد این ماه» در «وضعیت من» پنل. هویت فقط از نشست (req.adminUser)؛ هیچ شناسه‌ای از query/body خوانده نمی‌شود.
// تنظیم خاموش یا نرخ تعریف‌نشده ⇒ { earnings: null } (نرخ خام هرگز برنمی‌گردد). همان سرویس Mini App.
router.get('/admin/me/earnings', requirePermission('me.read'), (req, res) => {
  const earnings = earningsForUser(req.adminUser, settingsRepository.getAll(), { today: todayDateString() });
  return res.json({ earnings });
});

module.exports = router;

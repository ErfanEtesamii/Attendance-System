// معافیت یک‌باره از گیت خروجِ «برنامه‌ی هفته‌ی بعد» (D5).
// اسکوپ: ادمین همه؛ سرپرست فقط تیم خودش؛ کارمند/HR ممنوع. علت اجباری (۳ تا ۳۰۰ نویسه) + audit.
// ادمین/سرپرست برای «خودش» معافیت نمی‌دهد (جلوگیری از خودمعافی‌سازی).
const express = require('express');
const router = express.Router();

const { requirePermission } = require('../../../middleware/permissions');
const usersRepository = require('../../../repositories/usersRepository');
const planGateService = require('../../../services/planGateService');
const { sanitizeText } = require('../../../utils/sanitize');
const { todayDateString } = require('../../../utils/serverTime');
const { canAccessUser } = require('./common');

// POST /admin/plan-gate/exemptions  { userId, reason }
router.post('/admin/plan-gate/exemptions', requirePermission('plans.exempt'), (req, res) => {
  const userId = Number(req.body && req.body.userId);
  if (!Number.isInteger(userId) || userId <= 0) return res.status(400).json({ error: 'شناسه‌ی کارمند نامعتبر است.' });
  const reason = sanitizeText(String((req.body && req.body.reason) || ''), 301).replace(/\s+/g, ' ').trim();
  if (reason.length < 3) return res.status(400).json({ error: 'ذکر علت (حداقل ۳ نویسه) الزامی است.' });
  if (reason.length > 300) return res.status(400).json({ error: 'علت حداکثر ۳۰۰ نویسه است.' });
  if (userId === req.adminUser.id) return res.status(403).json({ error: 'برای خودتان نمی‌توانید معافیت ثبت کنید.' });
  const target = usersRepository.findById(userId);
  if (!target || !target.is_active) return res.status(404).json({ error: 'کارمند یافت نشد.' });
  if (!canAccessUser(req.adminUser, userId)) return res.status(403).json({ error: 'این کارمند در تیم شما نیست.' });

  const r = planGateService.grantExemption({ user: target, grantedBy: req.adminUser, reason, today: todayDateString() });
  if (!r.ok) {
    return res.status(409).json({
      error: r.code === 'EXEMPTION_USED' ? 'معافیت این هفته قبلاً داده و مصرف شده است.' : 'برای این کارمند معافیتِ مصرف‌نشده وجود دارد.',
      code: r.code,
    });
  }
  res.status(201).json({ id: r.exemption.id, userId, weekStart: r.exemption.week_start_date, reason });
});

module.exports = router;

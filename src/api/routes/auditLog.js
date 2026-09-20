// مسیر ساده و فقط-خواندنی برای مشاهده لاگ حسابرسی.
// در فازهای بعد (پنل وب/دستورات بات) پشت احراز هویت ادمین قرار می‌گیرد؛
// فعلاً بدون احراز هویت است چون کل لایه احراز هویت هنوز طراحی نشده (فاز ۳).

const express = require('express');
const router = express.Router();
const auditRepository = require('../../repositories/auditRepository');

router.get('/audit-log', (req, res) => {
  const { userId, limit } = req.query;
  const parsedLimit = Math.min(parseInt(limit, 10) || 200, 500);

  if (userId) {
    return res.json(auditRepository.listByUser(userId, parsedLimit));
  }
  res.json(auditRepository.listRecent(parsedLimit));
});

module.exports = router;

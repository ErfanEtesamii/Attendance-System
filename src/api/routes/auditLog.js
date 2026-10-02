// مسیر ساده و فقط-خواندنی برای مشاهده لاگ حسابرسی.
//
// فاز ۹: این مسیر (بر خلاف نسخه‌ی امن‌تر /api/admin/audit-log که از قبل requireFullAdmin دارد)
// تا امروز کاملاً بدون احراز هویت روی شبکه در دسترس بود - یعنی هر کسی داخل شبکه شرکت می‌توانست
// کل تاریخچه‌ی IP/زمان/جزئیات هر رویداد هر کارمند را بخواند. همان سطح محافظتی نسخه‌ی /admin را
// اینجا هم اعمال می‌کنیم (requireFullAdmin: فقط ادمین کل، نه مدیر دپارتمان).
const express = require('express');
const router = express.Router();
const auditRepository = require('../../repositories/auditRepository');
const { requireFullAdmin } = require('../../middleware/adminAuth');

router.use('/audit-log', requireFullAdmin);

router.get('/audit-log', (req, res) => {
  const { userId, limit } = req.query;
  const parsedLimit = Math.min(parseInt(limit, 10) || 200, 500);

  if (userId) {
    return res.json(auditRepository.listByUser(userId, parsedLimit));
  }
  res.json(auditRepository.listRecent(parsedLimit));
});

module.exports = router;

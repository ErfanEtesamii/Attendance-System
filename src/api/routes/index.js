const express = require('express');
const router = express.Router();

router.use(require('./health'));
router.use(require('./cspReport')); // بخش ۲-الف: دریافت گزارش تخلف CSP
router.use(require('./miniapp')); // فاز ۴: مسیرهای Mini App با احراز هویت واقعی initData
// بخش ۲-الف: محافظت CSRF برای همه‌ی متدهای نوشتنی /api/admin/* (شامل ورود/خروج)
router.use('/admin', require('../../middleware/csrf').csrfProtection);
router.use(require('./adminAuth')); // فاز ۸: ورود/خروج پنل مدیریتی (Telegram Login Widget)
router.use(require('./admin')); // پنل مدیریتی وب (تقسیم‌شده بر اساس دامنه در ./admin/)

// نکته: مسیرهای قدیمی فاز ۱ (/api/users, /api/attendance/*, /api/audit-log) در بخش ۱-ب حذف شدند؛
// دلیل در PROJECT_STATUS.md و CHANGELOG.md.

module.exports = router;

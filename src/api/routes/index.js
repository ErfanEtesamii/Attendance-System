const express = require('express');
const router = express.Router();

router.use(require('./health'));
router.use(require('./miniapp')); // فاز ۴: مسیرهای Mini App با احراز هویت واقعی initData
router.use(require('./adminAuth')); // فاز ۸: ورود/خروج پنل مدیریتی (Telegram Login Widget)
router.use(require('./admin')); // پنل مدیریتی وب (تقسیم‌شده بر اساس دامنه در ./admin/)

// نکته: مسیرهای قدیمی فاز ۱ (/api/users, /api/attendance/*, /api/audit-log) در بخش ۱-ب حذف شدند؛
// دلیل در PROJECT_STATUS.md و CHANGELOG.md.

module.exports = router;

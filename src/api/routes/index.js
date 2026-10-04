const express = require('express');
const router = express.Router();

router.use(require('./health'));
router.use(require('./users'));
router.use(require('./attendance'));
router.use(require('./auditLog'));
router.use(require('./miniapp')); // فاز ۴: مسیرهای Mini App با احراز هویت واقعی initData
router.use(require('./adminAuth')); // فاز ۸: ورود/خروج پنل مدیریتی (Telegram Login Widget)
router.use(require('./admin')); // فاز ۸: مسیرهای اصلی پنل مدیریتی وب
router.use(require('./adminPanel')); // پنل کنترل کامل: نمای کلی، تردد، اعتراض‌ها، گزارش، سیستم

module.exports = router;

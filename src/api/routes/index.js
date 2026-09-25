const express = require('express');
const router = express.Router();

router.use(require('./health'));
router.use(require('./users'));
router.use(require('./attendance'));
router.use(require('./auditLog'));
router.use(require('./miniapp')); // فاز ۴: مسیرهای Mini App با احراز هویت واقعی initData

module.exports = router;

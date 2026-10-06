// پنل مدیریتی وب: همه‌ی مسیرهای /api/admin/* (به‌جز ورود/خروج که در adminAuth.js است).
//
// قبلاً این مسیرها در دو فایل همپوشان (admin.js و adminPanel.js) بودند و requireAdminAuth در هر دو
// جداگانه ثبت می‌شد (دو بار تأیید سشن در هر درخواست). حالا:
//   - requireAdminAuth فقط یک‌بار و قبل از همه‌ی مسیرها ثبت می‌شود.
//   - مسیرها بر اساس دامنه تقسیم شده‌اند؛ URLها و رفتار دقیقاً همان قبلی است.
//   - ترتیب ثبت فقط وقتی اهمیت دارد که دو الگو یک URL را بپوشانند (مثل /admin/users/export قبل از
//     /admin/users/:id)؛ این ترتیب‌ها داخل همان فایل دامنه حفظ شده‌اند و توسط تست
//     test/routeOrder.test.js تضمین می‌شوند.
const express = require('express');
const router = express.Router();
const { requireAdminAuth } = require('../../../middleware/adminAuth');

router.use('/admin', requireAdminAuth);

router.use(require('./dashboard'));
router.use(require('./users'));
router.use(require('./attendance'));
router.use(require('./leave'));
router.use(require('./disputes'));
router.use(require('./overtime'));
router.use(require('./reports'));
router.use(require('./settings'));
router.use(require('./shifts'));
router.use(require('./audit'));
router.use(require('./suspicious'));
router.use(require('./system'));

module.exports = router;

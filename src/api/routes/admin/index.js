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
const { analyticsCache } = require('../../../utils/analyticsCache');

router.use('/admin', requireAdminAuth);

// S5-6c: هر نوشتنِ موفق در پنل (POST/PUT/PATCH/DELETE با پاسخ < ۴۰۰) کش تحلیل‌ها را کامل پاک می‌کند تا ادمین بعد از ویرایش/بستن ماه/تغییر تنظیمات
// عدد کهنه نبیند. (تغییرهای بات/Mini App، مثل ثبت ورود، از این مسیر نمی‌گذرند و فقط با گذشتن TTL کش دیده می‌شوند.)
router.use('/admin', (req, res, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    res.on('finish', () => { if (res.statusCode < 400) analyticsCache.clear(); });
  }
  next();
});

router.use(require('./dashboard'));
router.use(require('./calendar')); // S4-14a: تقویم تیم
router.use(require('./users'));
router.use(require('./attendance'));
router.use(require('./leave'));
router.use(require('./leaveQueue'));
router.use(require('./leaveTypes'));
router.use(require('./leaveBalances'));
router.use(require('./disputes'));
router.use(require('./overtime'));
router.use(require('./reports'));
router.use(require('./monthClosures')); // S5-3: بستن ماه (چک‌لیست؛ بستن/بازکردن در S5-3b/c)
router.use(require('./analytics')); // S5-6a: روند/مقایسه‌ی تأخیر (فقط‌خواندنی؛ کارمند ممنوع)
router.use(require('./settings'));
router.use(require('./shifts'));
router.use(require('./audit'));
router.use(require('./suspicious'));
router.use(require('./notifications'));
router.use(require('./system'));

module.exports = router;

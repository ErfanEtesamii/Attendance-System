const express = require('express');
const router = express.Router();
const systemHealth = require('../../utils/systemHealth');

// بخش ۲-ج۱: خروجی عمومی فقط ok/degraded است (بدون هیچ جزئیات)؛ جزئیات فقط با احراز ادمین در
// GET /api/admin/system/status. پاسخ ۱۰ ثانیه کش می‌شود تا درخواست‌های پیاپی (یا مهاجم) بار اضافی نسازند.
// کد HTTP همیشه ۲۰۰ می‌ماند (سازگاری با مصرف‌کننده‌های قبلی)؛ مصرف‌کننده باید فیلد status را بخواند.
const CACHE_MS = 10 * 1000;
let cached = null;

router.get('/health', (req, res) => {
  const now = Date.now();
  if (!cached || now - cached.at > CACHE_MS) {
    let status = 'degraded';
    try {
      status = systemHealth.collect({ now }).status;
    } catch (_) {
      /* خطای غیرمنتظره در خود بررسی = degraded */
    }
    cached = { at: now, status };
  }
  res.json({ status: cached.status, time: new Date().toISOString() });
});

// فقط برای تست
router._resetCache = () => {
  cached = null;
};

module.exports = router;

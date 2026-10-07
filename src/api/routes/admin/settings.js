// تنظیمات سیستم و تعطیلات رسمی.
// (تقسیم‌شده از admin.js/adminPanel.js؛ URLها و رفتار بدون تغییر. احراز هویت در index.js یک‌بار اعمال می‌شود.)

const express = require('express');
const router = express.Router();

const { requireFullAdmin } = require('../../../middleware/adminAuth');
const holidaysRepository = require('../../../repositories/holidaysRepository');
const settingsRepository = require('../../../repositories/settingsRepository');
const auditRepository = require('../../../repositories/auditRepository');
const registry = require('../../../utils/settingsRegistry');
const { requireReason, audit } = require('./common');

// ---------- تعطیلات رسمی ----------

router.get('/admin/holidays', (req, res) => {
  res.json(holidaysRepository.listHolidays());
});

router.post('/admin/holidays', requireFullAdmin, (req, res) => {
  const { date, title } = req.body || {};
  if (!date || !title) return res.status(400).json({ error: 'date و title الزامی هستند.' });
  const holiday = holidaysRepository.addHoliday(date, title);
  auditRepository.logEvent({
    userId: req.adminUser.id,
    action: 'holiday_added',
    details: { source: 'admin_panel', date, title },
  });
  res.status(201).json(holiday);
});

router.delete('/admin/holidays/:id', requireFullAdmin, (req, res) => {
  holidaysRepository.removeHoliday(parseInt(req.params.id, 10));
  auditRepository.logEvent({
    userId: req.adminUser.id,
    action: 'holiday_removed',
    details: { source: 'admin_panel', holidayId: req.params.id },
  });
  res.json({ ok: true });
});

// S3-8c: بعد از تغییر/reset هر تنظیم cron، زمان‌بندی Jobها همان لحظه و بدون ری‌استارت دوباره ساخته می‌شود.
// ضدخطا: خرابیِ reload هرگز ذخیره‌ی تنظیم را برنمی‌گرداند (مقدار در DB ماندگار است و در ری‌استارت بعدی اعمال می‌شود). تنظیم غیر cron ⇒ undefined.
// اگر پروسه‌ی فعلی زمان‌بندی را بالا نیاورده (مثلاً فقط API) نتیجه‌ی { reloaded: false, reason: 'scheduler_not_started' } است.
function reloadSchedulerIfCron(keys) {
  if (!keys.some((k) => { const d = registry.getDef(k); return d && d.type === 'cron'; })) return undefined;
  try {
    return require('../../../bot/scheduler').reload(); // require تنبل: مسیر API به بارگذاری Jobها وابسته نشود
  } catch (err) {
    console.error('[settings] reload زمان‌بندی ناموفق:', err.message);
    return { reloaded: false, reason: 'error', error: err.message, changed: [], errors: [] };
  }
}

// ---------- تنظیمات سیستم (ساعت کاری، آستانه‌ها) ----------

router.get('/admin/settings', (req, res) => {
  res.json(settingsRepository.getAll());
});

router.patch('/admin/settings', requireFullAdmin, (req, res) => {
  const before = settingsRepository.getAll();
  const updated = settingsRepository.update(req.body || {});
  // S3-1b: مقدار قبل/بعد کلیدهای تغییرکرده هم در details می‌آید (فیلدهای قبلی بدون تغییر)
  const changes = {};
  Object.keys(updated).forEach((k) => {
    if (!registry.sameValue(updated[k], before[k])) changes[k] = { before: before[k], after: updated[k] };
  });
  auditRepository.logEvent({
    userId: req.adminUser.id,
    action: 'settings_updated',
    details: { source: 'admin_panel', fields: Object.keys(req.body || {}), changes },
  });
  reloadSchedulerIfCron(Object.keys(changes)); // پاسخ PATCH قدیمی (آبجکت تخت تنظیمات) عمداً بدون تغییر می‌ماند
  res.json(updated);
});

// ---------- API تنظیمات با متادیتا (S3-1b) ----------
// UI فعلی همچنان از GET/PATCH /admin/settings بالا استفاده می‌کند؛ این سه مسیر برای صفحه‌ی تنظیمات جدید (S3-9a) است.

// GET /admin/settings/items → { items: [{ key, type, group, groupLabel, description, value, default, isDefault, updatedAt, min?, max?, values? }] }
router.get('/admin/settings/items', (req, res) => {
  res.json({ items: settingsRepository.getItems(), groups: registry.GROUP_LABELS });
});

// PUT /admin/settings/:key  { value, reason (اجباری) } → ۴۰۴ کلید ناشناخته، ۴۰۰ بدون دلیل/مقدار نامعتبر
router.put('/admin/settings/:key', requireFullAdmin, (req, res) => {
  const { key } = req.params;
  if (!registry.getDef(key)) return res.status(404).json({ error: 'تنظیم موردنظر پیدا نشد.' });
  const reason = requireReason(req, res);
  if (reason === null) return undefined;

  const checked = registry.validate(key, (req.body || {}).value);
  if (!checked.ok) return res.status(400).json({ error: `مقدار «${key}» نامعتبر است: ${checked.error}`, key });

  const before = settingsRepository.getItem(key).value;
  if (registry.sameValue(before, checked.value)) return res.json({ changed: false, item: settingsRepository.getItem(key) });

  const item = settingsRepository.setValue(key, checked.value);
  audit(req, 'settings_updated', { fields: [key], changes: { [key]: { before, after: item.value } }, reason });
  const scheduler = reloadSchedulerIfCron([key]);
  return res.json({ changed: true, item, ...(scheduler ? { scheduler } : {}) });
});

// POST /admin/settings/:key/reset  { reason (اجباری) } → بازگشت یک کلید به پیش‌فرض
router.post('/admin/settings/:key/reset', requireFullAdmin, (req, res) => {
  const { key } = req.params;
  if (!registry.getDef(key)) return res.status(404).json({ error: 'تنظیم موردنظر پیدا نشد.' });
  const reason = requireReason(req, res);
  if (reason === null) return undefined;

  const before = settingsRepository.getItem(key).value;
  if (!settingsRepository.resetValue(key)) return res.json({ changed: false, item: settingsRepository.getItem(key) }); // ردیفی نبود: همین الان پیش‌فرض است
  const item = settingsRepository.getItem(key);
  audit(req, 'settings_reset', { fields: [key], changes: { [key]: { before, after: item.value } }, reason });
  const scheduler = reloadSchedulerIfCron([key]);
  return res.json({ changed: true, item, ...(scheduler ? { scheduler } : {}) });
});

module.exports = router;

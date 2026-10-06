// تنظیمات سیستم و تعطیلات رسمی.
// (تقسیم‌شده از admin.js/adminPanel.js؛ URLها و رفتار بدون تغییر. احراز هویت در index.js یک‌بار اعمال می‌شود.)

const express = require('express');
const router = express.Router();

const { requireFullAdmin } = require('../../../middleware/adminAuth');
const holidaysRepository = require('../../../repositories/holidaysRepository');
const settingsRepository = require('../../../repositories/settingsRepository');
const auditRepository = require('../../../repositories/auditRepository');

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

// ---------- تنظیمات سیستم (ساعت کاری، آستانه‌ها) ----------

router.get('/admin/settings', (req, res) => {
  res.json(settingsRepository.getAll());
});

router.patch('/admin/settings', requireFullAdmin, (req, res) => {
  const updated = settingsRepository.update(req.body || {});
  auditRepository.logEvent({
    userId: req.adminUser.id,
    action: 'settings_updated',
    details: { source: 'admin_panel', fields: Object.keys(req.body || {}) },
  });
  res.json(updated);
});

module.exports = router;

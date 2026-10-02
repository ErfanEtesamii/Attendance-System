// این مسیرها اسکلت اولیه API کاربران هستند طبق الزام فاز ۱:
// «یک لایه API داخلی بساز حتی اگر فعلاً مصرف‌کننده‌ای نداشته باشد».
//
// فاز ۹: این مسیرها هیچ مصرف‌کننده‌ی واقعی‌ای ندارند (بات مستقیماً از usersRepository استفاده
// می‌کند، نه از این API؛ پنل وب هم از /api/admin/users استفاده می‌کند نه از این‌ها) ولی تا امروز
// بدون هیچ احراز هویتی روی شبکه در دسترس بودند - یعنی هر کسی داخل شبکه شرکت می‌توانست لیست کامل
// کارمندان را بخواند یا حتی کاربر بسازد/حذف کند. همان سطح محافظتی /api/admin/* (requireAdminAuth)
// را اینجا هم اعمال می‌کنیم.
const express = require('express');
const router = express.Router();
const usersRepository = require('../../repositories/usersRepository');
const auditRepository = require('../../repositories/auditRepository');
const { requireAdminAuth, requireFullAdmin } = require('../../middleware/adminAuth');

router.use('/users', requireAdminAuth);

router.get('/users', (req, res) => {
  const onlyActive = req.query.active === 'true';
  res.json(usersRepository.listUsers({ onlyActive }));
});

router.get('/users/:id', (req, res) => {
  const user = usersRepository.findById(req.params.id);
  if (!user) return res.status(404).json({ error: 'کاربر یافت نشد.' });
  res.json(user);
});

router.post('/users', requireFullAdmin, (req, res) => {
  const { telegramUserId, fullName, personnelCode, department, role, managerId } = req.body || {};

  if (!fullName) {
    return res.status(400).json({ error: 'فیلد fullName الزامی است.' });
  }

  const user = usersRepository.createUser({
    telegramUserId,
    fullName,
    personnelCode,
    department,
    role,
    managerId,
  });

  auditRepository.logEvent({
    userId: user.id,
    action: 'user_created',
    ipAddress: req.ip,
    details: { by: 'api' },
  });

  res.status(201).json(user);
});

router.patch('/users/:id', requireFullAdmin, (req, res) => {
  const existing = usersRepository.findById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'کاربر یافت نشد.' });

  const updated = usersRepository.updateUser(req.params.id, req.body || {});

  auditRepository.logEvent({
    userId: updated.id,
    action: 'user_updated',
    ipAddress: req.ip,
    details: req.body,
  });

  res.json(updated);
});

router.delete('/users/:id', requireFullAdmin, (req, res) => {
  const existing = usersRepository.findById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'کاربر یافت نشد.' });

  usersRepository.deactivateUser(req.params.id);

  auditRepository.logEvent({
    userId: existing.id,
    action: 'user_deactivated',
    ipAddress: req.ip,
  });

  res.json({ status: 'deactivated' });
});

module.exports = router;

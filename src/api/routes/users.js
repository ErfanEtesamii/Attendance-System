// این مسیرها اسکلت اولیه API کاربران هستند طبق الزام فاز ۱:
// «یک لایه API داخلی بساز حتی اگر فعلاً مصرف‌کننده‌ای نداشته باشد».
// احراز هویت/سطح دسترسی (ادمین/مدیر) در فازهای بعد (بات و پنل وب) روی همین مسیرها اعمال می‌شود.

const express = require('express');
const router = express.Router();
const usersRepository = require('../../repositories/usersRepository');
const auditRepository = require('../../repositories/auditRepository');

router.get('/users', (req, res) => {
  const onlyActive = req.query.active === 'true';
  res.json(usersRepository.listUsers({ onlyActive }));
});

router.get('/users/:id', (req, res) => {
  const user = usersRepository.findById(req.params.id);
  if (!user) return res.status(404).json({ error: 'کاربر یافت نشد.' });
  res.json(user);
});

router.post('/users', (req, res) => {
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

router.patch('/users/:id', (req, res) => {
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

router.delete('/users/:id', (req, res) => {
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

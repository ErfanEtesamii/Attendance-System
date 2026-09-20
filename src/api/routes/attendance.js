// اسکلت اولیه مسیرهای ثبت تردد.
// توجه مهم: در فاز ۲، networkRestrictionPlaceholder با middleware واقعی جایگزین می‌شود
// و پیش از رسیدن به این هندلرها، IP درخواست بررسی خواهد شد.

const express = require('express');
const router = express.Router();
const attendanceRepository = require('../../repositories/attendanceRepository');
const breakRepository = require('../../repositories/breakRepository');
const usersRepository = require('../../repositories/usersRepository');
const auditRepository = require('../../repositories/auditRepository');
const { networkRestrictionPlaceholder } = require('../../middleware/networkRestriction');

router.use(networkRestrictionPlaceholder);

function requireActiveUser(req, res, next) {
  const userId = req.body?.userId || req.query.userId;
  if (!userId) return res.status(400).json({ error: 'userId الزامی است.' });

  const user = usersRepository.findById(userId);
  if (!user || !user.is_active) {
    return res.status(403).json({ error: 'کاربر در سیستم ثبت نیست یا غیرفعال است.' });
  }
  req.attendanceUser = user;
  next();
}

router.get('/attendance/today', requireActiveUser, (req, res) => {
  const record = attendanceRepository.findTodayRecord(req.attendanceUser.id);
  res.json(record || null);
});

router.post('/attendance/check-in', requireActiveUser, (req, res) => {
  const record = attendanceRepository.recordCheckIn(req.attendanceUser.id, req.ip);
  auditRepository.logEvent({
    userId: req.attendanceUser.id,
    action: 'check_in',
    ipAddress: req.ip,
  });
  res.status(201).json(record);
});

router.post('/attendance/check-out', requireActiveUser, (req, res) => {
  const record = attendanceRepository.findTodayRecord(req.attendanceUser.id);
  if (!record) {
    return res.status(400).json({ error: 'ابتدا باید ورود ثبت شود.' });
  }
  const updated = attendanceRepository.recordCheckOut(record.id, req.ip);
  auditRepository.logEvent({
    userId: req.attendanceUser.id,
    action: 'check_out',
    ipAddress: req.ip,
  });
  res.json(updated);
});

router.post('/attendance/break/start', requireActiveUser, (req, res) => {
  const record = attendanceRepository.findTodayRecord(req.attendanceUser.id);
  if (!record) return res.status(400).json({ error: 'ابتدا باید ورود ثبت شود.' });

  const breakType = req.body.breakType || 'lunch';
  const breakRecord = breakRepository.startBreak(record.id, breakType);
  res.status(201).json(breakRecord);
});

router.post('/attendance/break/end', requireActiveUser, (req, res) => {
  const record = attendanceRepository.findTodayRecord(req.attendanceUser.id);
  if (!record) return res.status(400).json({ error: 'رکورد امروز یافت نشد.' });

  const openBreak = breakRepository.findOpenBreak(record.id);
  if (!openBreak) return res.status(400).json({ error: 'استراحت باز فعالی وجود ندارد.' });

  const ended = breakRepository.endBreak(openBreak.id);
  res.json(ended);
});

module.exports = router;

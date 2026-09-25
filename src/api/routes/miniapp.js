// مسیرهای API مخصوص Telegram Mini App (فاز ۴ سند پروژه).
//
// تفاوت کلیدی با مسیرهای قدیمی /api/attendance/*: در آنجا userId مستقیم از body خوانده می‌شد
// (بدون اثبات هویت واقعی). اینجا تمام مسیرها ابتدا از middleware `telegramAuth` عبور می‌کنند که
// initData امضاشده‌ی تلگرام را تأیید می‌کند و req.miniAppUser را از روی آن (نه از ورودی خام کاربر)
// پیدا می‌کند؛ یعنی کارمند نمی‌تواند جای کارمند دیگری ثبت تردد بزند یا گزارش کسی دیگر را ببیند.

const express = require('express');
const router = express.Router();

const { telegramAuth } = require('../../middleware/telegramAuth');
const { networkRestriction } = require('../../middleware/networkRestriction');

const attendanceRepository = require('../../repositories/attendanceRepository');
const breakRepository = require('../../repositories/breakRepository');
const leaveRepository = require('../../repositories/leaveRepository');
const disputeRepository = require('../../repositories/disputeRepository');
const auditRepository = require('../../repositories/auditRepository');
const workHours = require('../../utils/workHours');
const { todayDateString } = require('../../utils/serverTime');

// همه مسیرهای زیر /miniapp ابتدا باید هویت تلگرام معتبر داشته باشند
router.use('/miniapp', telegramAuth);

// عملیات‌های واقعی ثبت تردد علاوه‌بر آن باید از چک شبکه داخلی فاز ۲ هم عبور کنند
router.use('/miniapp/check-in', networkRestriction);
router.use('/miniapp/check-out', networkRestriction);
router.use('/miniapp/break/start', networkRestriction);
router.use('/miniapp/break/end', networkRestriction);

function dateDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

// ---------- پروفایل ----------

router.get('/miniapp/me', (req, res) => {
  const u = req.miniAppUser;
  res.json({
    id: u.id,
    fullName: u.full_name,
    personnelCode: u.personnel_code,
    department: u.department,
    role: u.role,
    managerId: u.manager_id,
  });
});

// ---------- وضعیت امروز ----------

router.get('/miniapp/today', (req, res) => {
  const record = attendanceRepository.findTodayRecord(req.miniAppUser.id);
  const openBreak = record ? breakRepository.findOpenBreak(record.id) : null;
  const breaks = record ? breakRepository.listByAttendanceRecord(record.id) : [];
  const summary = record ? workHours.summarizeRecord(record) : null;
  res.json({ record: record || null, openBreak: openBreak || null, breaks, summary });
});

router.post('/miniapp/check-in', (req, res) => {
  const existing = attendanceRepository.findTodayRecord(req.miniAppUser.id);
  if (existing) {
    return res.status(400).json({ error: 'ورود امروز قبلاً ثبت شده است.' });
  }
  const record = attendanceRepository.recordCheckIn(req.miniAppUser.id, req.ip);
  auditRepository.logEvent({
    userId: req.miniAppUser.id,
    action: 'check_in',
    ipAddress: req.ip,
    details: { source: 'miniapp' },
  });
  res.status(201).json(record);
});

router.post('/miniapp/check-out', (req, res) => {
  const record = attendanceRepository.findTodayRecord(req.miniAppUser.id);
  if (!record) {
    return res.status(400).json({ error: 'ابتدا باید ورود ثبت شود.' });
  }
  if (record.check_out_time) {
    return res.status(400).json({ error: 'خروج امروز قبلاً ثبت شده است.' });
  }
  const openBreak = breakRepository.findOpenBreak(record.id);
  if (openBreak) {
    return res.status(400).json({ error: 'ابتدا باید استراحت باز فعلی را پایان دهید.' });
  }
  const updated = attendanceRepository.recordCheckOut(record.id, req.ip);
  auditRepository.logEvent({
    userId: req.miniAppUser.id,
    action: 'check_out',
    ipAddress: req.ip,
    details: { source: 'miniapp' },
  });
  res.json(updated);
});

router.post('/miniapp/break/start', (req, res) => {
  const record = attendanceRepository.findTodayRecord(req.miniAppUser.id);
  if (!record) {
    return res.status(400).json({ error: 'ابتدا باید ورود ثبت شود.' });
  }
  if (record.check_out_time) {
    return res.status(400).json({ error: 'خروج امروز قبلاً ثبت شده؛ امکان شروع استراحت نیست.' });
  }
  if (breakRepository.findOpenBreak(record.id)) {
    return res.status(400).json({ error: 'یک استراحت باز از قبل فعال است.' });
  }
  const breakType = req.body?.breakType === 'short_break' ? 'short_break' : 'lunch';
  const breakRecord = breakRepository.startBreak(record.id, breakType);
  res.status(201).json(breakRecord);
});

router.post('/miniapp/break/end', (req, res) => {
  const record = attendanceRepository.findTodayRecord(req.miniAppUser.id);
  if (!record) {
    return res.status(400).json({ error: 'رکورد امروز یافت نشد.' });
  }
  const openBreak = breakRepository.findOpenBreak(record.id);
  if (!openBreak) {
    return res.status(400).json({ error: 'استراحت باز فعالی وجود ندارد.' });
  }
  const ended = breakRepository.endBreak(openBreak.id);
  res.json(ended);
});

// ---------- تاریخچه شخصی ----------

router.get('/miniapp/history', (req, res) => {
  const days = Math.min(parseInt(req.query.days, 10) || 30, 90);
  const from = dateDaysAgo(days);
  const to = todayDateString();
  const records = attendanceRepository.listByUserAndRange(req.miniAppUser.id, from, to);
  const enriched = records.map((r) => ({ ...r, summary: workHours.summarizeRecord(r) }));
  res.json(enriched);
});

// ---------- گزارش شخصی (هفتگی/ماهانه) ----------

router.get('/miniapp/report', (req, res) => {
  const isMonth = req.query.period === 'month';
  const from = dateDaysAgo(isMonth ? 30 : 7);
  const to = todayDateString();
  const records = attendanceRepository.listByUserAndRange(req.miniAppUser.id, from, to);
  const summary = workHours.summarizeRange(records);
  res.json({ period: isMonth ? 'month' : 'week', from, to, ...summary });
});

// ---------- مرخصی / مأموریت ----------

router.post('/miniapp/leave', (req, res) => {
  const { startDate, endDate, leaveType, reason } = req.body || {};
  if (!startDate || !endDate) {
    return res.status(400).json({ error: 'startDate و endDate الزامی هستند.' });
  }
  const request = leaveRepository.createLeaveRequest({
    userId: req.miniAppUser.id,
    startDate,
    endDate,
    leaveType: leaveType === 'mission' ? 'mission' : 'leave',
    reason,
  });
  auditRepository.logEvent({
    userId: req.miniAppUser.id,
    action: 'leave_requested',
    details: { source: 'miniapp', leaveType: request.leave_type },
  });
  res.status(201).json(request);
});

router.get('/miniapp/leave', (req, res) => {
  res.json(leaveRepository.listByUser(req.miniAppUser.id));
});

// ---------- اعتراض به رکورد ----------

router.post('/miniapp/dispute', (req, res) => {
  const { attendanceRecordId, message } = req.body || {};
  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'message الزامی است.' });
  }
  if (attendanceRecordId) {
    const record = attendanceRepository.findById(attendanceRecordId);
    if (!record || record.user_id !== req.miniAppUser.id) {
      return res.status(404).json({ error: 'رکورد یافت نشد.' });
    }
  }
  const dispute = disputeRepository.createDispute({
    userId: req.miniAppUser.id,
    attendanceRecordId: attendanceRecordId || null,
    message: message.trim(),
  });
  auditRepository.logEvent({
    userId: req.miniAppUser.id,
    action: 'record_dispute_submitted',
    details: { attendanceRecordId: attendanceRecordId || null },
  });
  res.status(201).json(dispute);
});

router.get('/miniapp/dispute', (req, res) => {
  res.json(disputeRepository.listByUser(req.miniAppUser.id));
});

module.exports = router;

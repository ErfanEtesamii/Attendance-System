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
const { createRateLimiter } = require('../../middleware/rateLimiter');

const attendanceRepository = require('../../repositories/attendanceRepository');
const breakRepository = require('../../repositories/breakRepository');
const leaveRepository = require('../../repositories/leaveRepository');
const leaveTypesRepository = require('../../repositories/leaveTypesRepository');
const leaveService = require('../../services/leaveService');
const { sendAttachment } = require('../../utils/attachmentResponse');
const leaveBalanceService = require('../../services/leaveBalanceService');
const { jalaliYearOfDateString } = require('../../utils/jalali');
const disputeRepository = require('../../repositories/disputeRepository');
const auditRepository = require('../../repositories/auditRepository');
const dayService = require('../../engine/dayService');
const { extractDeviceInfo } = require('../../utils/deviceInfo');
const fraudRunner = require('../../utils/fraudRunner');
const notificationEvents = require('../../services/notificationEvents');
const { todayDateString } = require('../../utils/serverTime');

// همه مسیرهای زیر /miniapp ابتدا باید هویت تلگرام معتبر داشته باشند
router.use('/miniapp', telegramAuth);

// عملیات‌های واقعی ثبت تردد علاوه‌بر آن باید از چک شبکه داخلی فاز ۲ هم عبور کنند
router.use('/miniapp/check-in', networkRestriction);
router.use('/miniapp/check-out', networkRestriction);
router.use('/miniapp/break/start', networkRestriction);
router.use('/miniapp/break/end', networkRestriction);

// فاز ۹: rate limiting روی همین چهار مسیر حساس (ضد اسپم/کلیک مکرر روی دکمه‌ها).
// کلید محدودسازی، شناسه‌ی کاربر تلگرام (نه IP) است: چون همه‌ی کارمندان از پشت همان یک IP/رنج
// داخلی شرکت وصل می‌شوند، محدودسازی بر اساس IP باعث می‌شد کل شرکت یک سطل مشترک داشته باشد.
// req.miniAppUser تا اینجا قطعاً توسط telegramAuth ست شده (بالاتر از این middlewareها اجرا می‌شود).
function miniAppRateLimitKey(req) {
  return `miniapp:${req.miniAppUser?.id}`;
}
const miniAppActionLimiter = createRateLimiter({
  name: 'miniapp-action',
  windowMs: 60 * 1000,
  max: 20,
  message: 'تعداد تلاش‌ برای ثبت تردد بیش از حد مجاز است. لطفاً یک دقیقه صبر کنید.',
  keyFn: miniAppRateLimitKey,
});
router.use('/miniapp/check-in', miniAppActionLimiter);
router.use('/miniapp/check-out', miniAppActionLimiter);
router.use('/miniapp/break/start', miniAppActionLimiter);
router.use('/miniapp/break/end', miniAppActionLimiter);

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
  const summary = record ? dayService.summarizeRecord(record) : null;
  res.json({ record: record || null, openBreak: openBreak || null, breaks, summary });
});

// بلوک اختیاری device مشترک (S2-4e-3؛ پیش‌فرض خاموش، فقط قاعده‌ی الف). اگر ثبت رد شود پاسخ 403 همین‌جا
// فرستاده و true برمی‌گردد. هر خطای داخلی ⇒ false (fail-open): تشخیص هرگز ثبت تردد را نمی‌شکند.
function rejectIfSharedDeviceBlocked(req, res, action) {
  try {
    const { deviceId } = extractDeviceInfo(req);
    const block = fraudRunner.evaluateSharedDeviceBlock({ userId: req.miniAppUser.id, deviceId, date: todayDateString() });
    if (!block.blocked) return false;
    fraudRunner.recordBlockedAttempt(block, action);
    auditRepository.logEvent({
      userId: req.miniAppUser.id,
      action: `${action}_blocked`,
      ipAddress: req.ip,
      details: { source: 'miniapp', reason: 'shared_device', rule: 'A', deviceId: block.deviceId, otherUserIds: block.otherUserIds },
    });
    res.status(403).json({
      error: 'ثبت با این دستگاه ممکن نیست، چون امروز با همین دستگاه برای کاربر دیگری ثبت انجام شده است. موضوع را به سرپرست خود اطلاع دهید.',
      code: 'shared_device_blocked',
    });
    return true;
  } catch (err) {
    console.error('[fraud] خطا در بلوک device مشترک (نادیده گرفته شد):', err && err.message ? err.message : err);
    return false;
  }
}

router.post('/miniapp/check-in', (req, res) => {
  const existing = attendanceRepository.findTodayRecord(req.miniAppUser.id);
  if (existing) {
    return res.status(400).json({ error: 'ورود امروز قبلاً ثبت شده است.' });
  }
  if (rejectIfSharedDeviceBlocked(req, res, 'check_in')) return;
  const record = attendanceRepository.recordCheckIn(req.miniAppUser.id, req.ip, extractDeviceInfo(req));
  auditRepository.logEvent({
    userId: req.miniAppUser.id,
    action: 'check_in',
    ipAddress: req.ip,
    details: { source: 'miniapp' },
  });
  res.status(201).json(record);
  // تشخیص مورد مشکوک (S2-4e): بعد از ارسال پاسخ و کاملاً ضدخطا؛ هرگز روی نتیجه‌ی ثبت اثر نمی‌گذارد
  fraudRunner.runFraudChecksSafe({ date: record.record_date });
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
  if (rejectIfSharedDeviceBlocked(req, res, 'check_out')) return;
  const updated = attendanceRepository.recordCheckOut(record.id, req.ip, extractDeviceInfo(req));
  auditRepository.logEvent({
    userId: req.miniAppUser.id,
    action: 'check_out',
    ipAddress: req.ip,
    details: { source: 'miniapp' },
  });
  res.json(updated);
  fraudRunner.runFraudChecksSafe({ date: updated.record_date });
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
  const enriched = records.map((r) => ({ ...r, summary: dayService.summarizeRecord(r) }));
  res.json(enriched);
});

// ---------- گزارش شخصی (هفتگی/ماهانه) ----------

router.get('/miniapp/report', (req, res) => {
  const isMonth = req.query.period === 'month';
  const from = dateDaysAgo(isMonth ? 30 : 7);
  const to = todayDateString();
  const records = attendanceRepository.listByUserAndRange(req.miniAppUser.id, from, to);
  const summary = dayService.summarizeRange(records);
  res.json({ period: isMonth ? 'month' : 'week', from, to, ...summary });
});

// ---------- مرخصی / مأموریت ----------

// انواع فعالِ قابل ثبت برای فرم (S4-10c): واحدهای مجاز هر نوع + برای نوع‌های دارای مانده، مانده‌ی سال شمسی جاری همین کاربر (دقیقه + متن روز/ساعت).
router.get('/miniapp/leave-types', (req, res) => {
  const year = jalaliYearOfDateString(todayDateString());
  const items = leaveTypesRepository.listLeaveTypes({ activeOnly: true }).map((t) => {
    const item = { id: t.id, code: t.code, title: t.title, kind: t.kind, allowedUnits: t.allowedUnits, requiresAttachment: t.requiresAttachment, maxConsecutiveDays: t.maxConsecutiveDays, balance: null };
    if (t.countsAgainstBalance) {
      const d = leaveBalanceService.describeBalance({ userId: req.miniAppUser.id, leaveTypeId: t.id, jalaliYear: year });
      if (d.ok && d.tracked) item.balance = { jalaliYear: year, remaining: d.remaining, remainingText: d.display.remaining.text, policy: d.policy };
    }
    return item;
  });
  res.json(items);
});

// ثبت درخواست از Mini App: فقط از leaveService (همه‌ی قواعد آنجاست). قرارداد قدیمی (leaveType + startDate + endDate) سازگار است؛
// فیلدهای تازه: leaveTypeId، unit (day|half_day|hour)، halfDayPart، startTime، endTime. endDate برای نیم‌روز/ساعتی اختیاری است.
router.post('/miniapp/leave', (req, res) => {
  const b = req.body || {};
  if (!b.startDate) {
    return res.status(400).json({ error: 'startDate الزامی است.' });
  }
  const unit = b.unit || 'day';
  if (unit === 'day' && !b.endDate) {
    return res.status(400).json({ error: 'startDate و endDate الزامی هستند.' });
  }
  const result = leaveService.create({
    userId: req.miniAppUser.id,
    leaveTypeId: Number.isInteger(b.leaveTypeId) ? b.leaveTypeId : undefined,
    leaveType: Number.isInteger(b.leaveTypeId) ? undefined : (b.leaveType === 'mission' ? 'mission' : 'leave'),
    unit,
    startDate: b.startDate,
    endDate: b.endDate || b.startDate,
    halfDayPart: b.halfDayPart,
    startTime: b.startTime,
    endTime: b.endTime,
    reason: b.reason,
    substituteUserId: Number.isInteger(b.substituteUserId) ? b.substituteUserId : undefined,
  });
  if (!result.ok) {
    return res.status(400).json({ error: result.errors.map((e) => e.error).join(' '), code: result.errors[0].code, errors: result.errors });
  }
  const { request } = result;
  auditRepository.logEvent({
    userId: req.miniAppUser.id,
    action: 'leave_requested',
    details: { source: 'miniapp', leaveType: request.kind, unit: request.unit, durationMinutes: request.duration_minutes },
  });
  notificationEvents.leaveRequested(request); // اعلان پنل برای تأییدکننده‌ها؛ هرگز ثبت را نمی‌شکند (S4-6b)
  res.status(201).json({ ...request, warnings: result.warnings });
});

// پیوست درخواست «خود کاربر» (S4-12b)
router.get('/miniapp/leave/:id/attachment', (req, res) => {
  const request = /^\d+$/.test(req.params.id) ? leaveRepository.findById(parseInt(req.params.id, 10)) : null;
  if (!request || request.user_id !== req.miniAppUser.id) return res.status(404).json({ error: 'پیوست یافت نشد.' });
  return sendAttachment(res, request);
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
  notificationEvents.disputeOpened(dispute); // S4-6b
  res.status(201).json(dispute);
});

router.get('/miniapp/dispute', (req, res) => {
  res.json(disputeRepository.listByUser(req.miniAppUser.id));
});

module.exports = router;

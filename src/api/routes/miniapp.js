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
const missionNowService = require('../../services/missionNowService');
const pendingMissionService = require('../../services/pendingMissionService');
const planGateService = require('../../services/planGateService');
const taskReportService = require('../../services/taskReportService');
const teamReviewService = require('../../services/teamReviewService');
const { maintenanceGate } = require('../../middleware/maintenanceGate');
const { createRateLimiter } = require('../../middleware/rateLimiter');

const attendanceRepository = require('../../repositories/attendanceRepository');
const breakRepository = require('../../repositories/breakRepository');
const leaveRepository = require('../../repositories/leaveRepository');
const leaveTypesRepository = require('../../repositories/leaveTypesRepository');
const leaveService = require('../../services/leaveService');
const missionService = require('../../services/missionService');
const { getCalendarDay } = require('../../engine/calendarService');
const attachmentService = require('../../services/attachmentService');
const { sendAttachment } = require('../../utils/attachmentResponse');
const leaveBalanceService = require('../../services/leaveBalanceService');
const { jalaliYearOfDateString } = require('../../utils/jalali');
const disputeRepository = require('../../repositories/disputeRepository');
const auditRepository = require('../../repositories/auditRepository');
const settingsRepository = require('../../repositories/settingsRepository');
const dayService = require('../../engine/dayService');
const { extractDeviceInfo } = require('../../utils/deviceInfo');
const fraudRunner = require('../../utils/fraudRunner');
const notificationEvents = require('../../services/notificationEvents');
const { todayDateString } = require('../../utils/serverTime');

// همه مسیرهای زیر /miniapp ابتدا باید هویت تلگرام معتبر داشته باشند
router.use('/miniapp', telegramAuth);

// ریست برنامه (B2): هنگام نگهداری، ثبت تردد 503 می‌گیرد (قبل از چک شبکه/rate limit)
router.use('/miniapp/check-in', maintenanceGate);
router.use('/miniapp/check-out', maintenanceGate);
router.use('/miniapp/break/start', maintenanceGate);
router.use('/miniapp/break/end', maintenanceGate);

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
    // B3: با هر ریست برنامه زیاد می‌شود؛ کلاینت با تغییرش state محلی را پاک می‌کند
    reset_epoch: settingsRepository.getResetEpoch(),
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
  const record = attendanceRepository.recordCheckIn(req.miniAppUser.id, req.ip, extractDeviceInfo(req), { viaPendingMission: Boolean(req.viaPendingMission) });
  if (req.viaPendingMission) pendingMissionService.flagPendingMissionOutside({ userId: req.miniAppUser.id, record, requestId: req.viaPendingMission, action: 'check_in' });
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
  // گیت D7: گزارش روزانه‌ی تسک‌ها. ترتیب گیت‌ها: گزارش امروز ← برنامه‌ی هفته‌ی بعد ← ثبت خروج.
  // (بعد از بررسی «خروج قبلاً ثبت شده»، تا دبل‌کلیکِ موفق 409 نگیرد؛ تا همه‌ی گیت‌ها رد نشوند چیزی نوشته نمی‌شود.)
  const reportGate = taskReportService.checkoutGate(req.miniAppUser, record.record_date, req.body);
  if (reportGate.action === 'invalid') {
    return res.status(['MONTH_CLOSED', 'FULL_DAY_OFF', 'ALREADY_ANSWERED'].includes(reportGate.code) ? 409 : 400).json({ error: reportGate.error, code: reportGate.code });
  }
  if (reportGate.action === 'block') {
    auditRepository.logEvent({ userId: req.miniAppUser.id, action: 'check_out_blocked', ipAddress: req.ip, details: { source: 'miniapp', reason: 'daily_report_required', date: reportGate.date, pending: reportGate.pendingTasks.length } });
    return res.status(409).json({
      error: taskReportService.blockMessage(reportGate.pendingTasks), // A1: فقط تسک‌های الزامی (high/normal) مانع‌اند؛ پیام نام‌ها و کار لازم را می‌گوید
      code: 'daily_report_required',
      date: reportGate.date,
      pendingTasks: reportGate.pendingTasks,
      optionalTasks: reportGate.optionalTasks || [], // A1: تسک‌های اختیاریِ (low) پاسخ‌نداده؛ مانع نیستند ولی ویزارد می‌تواند نشانشان دهد
      teamReview: reportGate.teamReview || null, // D9-ب: مشاهده‌نشده‌ها و گزارش‌نداده‌ها جدا از هم (فقط برای سرپرست/ادمینِ دارای تسک سیستمی)
      reasonCodes: taskReportService.REASON_CODES,
    });
  }
  // گیت D5: برنامه‌ی هفته‌ی بعد
  const planGate = planGateService.check(req.miniAppUser, record.record_date);
  if (planGate.action === 'block') {
    auditRepository.logEvent({ userId: req.miniAppUser.id, action: 'check_out_blocked', ipAddress: req.ip, details: { source: 'miniapp', reason: 'weekly_plan_required', weekStart: planGate.info.weekStart } });
    return res.status(409).json({
      error: 'برای ثبت خروج، ابتدا برنامه‌ی هفته‌ی بعد را ثبت کنید.',
      code: 'weekly_plan_required',
      weekStart: planGate.info.weekStart,
      planDay: planGate.info.planDay,
    });
  }
  if (rejectIfSharedDeviceBlocked(req, res, 'check_out')) return;
  // ذخیره‌ی گزارش (اگر در همین درخواست آمده) و ثبت خروج: اتمیک، در یک تراکنش
  const updated = taskReportService.commitAtomic(req.miniAppUser, reportGate, () => attendanceRepository.recordCheckOut(record.id, req.ip, extractDeviceInfo(req), { viaPendingMission: Boolean(req.viaPendingMission) }));
  if (req.viaPendingMission) pendingMissionService.flagPendingMissionOutside({ userId: req.miniAppUser.id, record: updated, requestId: req.viaPendingMission, action: 'check_out' });
  auditRepository.logEvent({
    userId: req.miniAppUser.id,
    action: 'check_out',
    ipAddress: req.ip,
    details: { source: 'miniapp' },
  });
  if (reportGate.report) {
    auditRepository.logEvent({ userId: req.miniAppUser.id, action: 'daily_report_submitted', ipAddress: req.ip, details: { source: 'miniapp_check_out', date: reportGate.date, answers: reportGate.report.answers.length, extra: reportGate.report.extras.length } });
  }
  planGateService.consumeExemption(req.miniAppUser, planGate, updated, req.ip);
  const payload = { ...updated };
  if (planGate.action === 'remind') payload.planReminder = { weekStart: planGate.info.weekStart };
  if (reportGate.report) payload.reportSaved = { date: reportGate.date, answers: reportGate.report.answers.length, extra: reportGate.report.extras.length };
  if (reportGate.report && reportGate.report.encouragements && reportGate.report.encouragements.length) payload.encouragements = reportGate.report.encouragements;
  if (reportGate.action === 'remind') payload.reportReminder = { date: reportGate.date, pendingTasks: reportGate.pendingTasks };
  res.json(payload);
  fraudRunner.runFraudChecksSafe({ date: updated.record_date });
});

// وضعیت گیت برنامه‌ی هفتگی برای UI (بنر/هشدار)؛ تصمیم نهایی همیشه با خود /check-out است.
router.get('/miniapp/plan-gate', (req, res) => {
  res.json(planGateService.status(req.miniAppUser, todayDateString()));
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

// ---------- ماموریت (C1) ----------
// ثبت: علت اجباری ۵–۳۰۰ نویسه، مقصد اختیاری؛ همه‌ی قواعد مدت/تداخل/زنجیره‌ی تأیید در missionService/leaveService.
router.post('/miniapp/mission', (req, res) => {
  const b = req.body || {};
  const result = missionService.create({
    userId: req.miniAppUser.id,
    unit: b.unit,
    startDate: b.startDate,
    endDate: b.endDate,
    halfDayPart: b.halfDayPart,
    startTime: b.startTime,
    endTime: b.endTime,
    reason: b.reason,
    destination: b.destination,
  });
  if (!result.ok) {
    return res.status(400).json({ error: result.errors.map((e) => e.error).join(' '), code: result.errors[0].code, errors: result.errors });
  }
  const { request } = result;
  auditRepository.logEvent({
    userId: req.miniAppUser.id,
    action: 'mission_requested',
    ipAddress: req.ip,
    details: { source: 'miniapp', requestId: request.id, unit: request.unit, durationMinutes: request.duration_minutes },
  });
  notificationEvents.leaveRequested(request); // تأییدکننده‌ی مرحله‌ی اول؛ هرگز ثبت را نمی‌شکند
  res.status(201).json({ ...missionService.presentMission(request), warnings: result.warnings });
});

// ساعت کاری مورد انتظار یک روز برای کاربر (برای هشدار «بیرون از ساعت کاری» در فرم ماموریت)
router.get('/miniapp/mission/day', (req, res) => {
  const date = String(req.query.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'date باید YYYY-MM-DD باشد.' });
  const day = getCalendarDay(req.miniAppUser, date);
  res.json({ date, isWorkingDay: !!day.isWorkingDay, expectedStart: day.expectedStart || null, expectedEnd: day.expectedEnd || null });
});

// C6: «ماموریت همین حالا»
router.post('/miniapp/mission/now', (req, res) => {
  const b = req.body || {};
  const r = missionNowService.startNow({ userId: req.miniAppUser.id, reason: b.reason, destination: b.destination });
  if (!r.ok) return res.status(r.code === 'ALREADY_OPEN' ? 409 : 400).json({ error: r.error, code: r.code });
  return res.status(201).json(missionService.presentMission(r.request));
});
router.post('/miniapp/mission/now/end', (req, res) => {
  const r = missionNowService.endNow({ userId: req.miniAppUser.id });
  if (!r.ok) return res.status(r.code === 'NOT_OPEN' ? 404 : 400).json({ error: r.error, code: r.code });
  return res.json(missionService.presentMission(r.request));
});

router.get('/miniapp/missions', (req, res) => {
  res.json(missionService.listForUser(req.miniAppUser.id));
});

async function cancelMission(req, res) {
  const id = /^\d+$/.test(req.params.id) ? parseInt(req.params.id, 10) : NaN;
  const r = await missionService.cancel({ userId: req.miniAppUser.id, requestId: id });
  if (!r.ok) return res.status(r.code === 'NOT_FOUND' ? 404 : 409).json({ error: r.error, code: r.code });
  auditRepository.logEvent({
    userId: req.miniAppUser.id,
    action: 'mission_cancelled',
    ipAddress: req.ip,
    details: { source: 'miniapp', requestId: r.request.id, startDate: r.request.start_date, endDate: r.request.end_date },
  });
  return res.json({ ok: true });
}
router.delete('/miniapp/missions/:id', cancelMission);
router.post('/miniapp/missions/:id/cancel', cancelMission);

// پیوست اختیاری (تصویر/PDF) برای ماموریتِ «در انتظار» خود کاربر؛ بدنه = خودِ فایل (Content-Type = نوع فایل)
router.post('/miniapp/missions/:id/attachment', async (req, res) => {
  const request = /^\d+$/.test(req.params.id) ? leaveRepository.findById(parseInt(req.params.id, 10)) : null;
  if (!request || request.user_id !== req.miniAppUser.id || request.kind !== 'mission') return res.status(404).json({ error: 'ماموریت یافت نشد.' });
  if (request.status !== 'pending') return res.status(409).json({ error: 'پیوست فقط برای ماموریت در انتظار ممکن است.', code: 'ALREADY_DECIDED' });
  const mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  const size = parseInt(req.headers['content-length'], 10);
  let name = '';
  try { name = decodeURIComponent(String(req.headers['x-file-name'] || '')).slice(0, 100); } catch (_) { name = ''; }
  const saved = await attachmentService.saveStream(req, { mime, size: Number.isFinite(size) ? size : undefined, originalName: name });
  if (!saved.ok) return res.status(400).json({ error: saved.error, code: saved.code });
  const old = request.attachment_id;
  const updated = leaveRepository.setAttachment(request.id, saved.attachment);
  if (old) await attachmentService.remove(old);
  return res.status(201).json(missionService.presentMission(updated));
});

// ---------- برنامه‌ی هفتگی (D3) ----------
const weeklyPlanService = require('../../services/weeklyPlanService');
const planError = (res, r) => res.status(r.code === 'MONTH_CLOSED' ? 409 : 400).json({ error: r.error, code: r.code });

router.get('/miniapp/plan', (req, res) => {
  const r = weeklyPlanService.getPlan(req.miniAppUser, req.query.week || 'next');
  if (!r.ok) return planError(res, r);
  return res.json(r);
});
router.put('/miniapp/plan', (req, res) => {
  const b = req.body || {};
  const r = weeklyPlanService.saveDraft(req.miniAppUser, b.week || 'next', b.tasks);
  if (!r.ok) return planError(res, r);
  return res.json(r);
});
router.post('/miniapp/plan/submit', (req, res) => {
  const b = req.body || {};
  const r = weeklyPlanService.submit(req.miniAppUser, b.week || 'next');
  if (!r.ok) return planError(res, r);
  return res.json(r);
});

// ---------- گزارش روزانه‌ی تسک‌ها (D6) ----------

const REPORT_ERROR_STATUS = {
  MONTH_CLOSED: 409, ALREADY_ANSWERED: 409, FULL_DAY_OFF: 409,
  BACKFILL_EXPIRED: 409, LATE_WINDOW_EXPIRED: 409, LATE_NOT_ALLOWED: 409, NO_RECORD: 404,
};
const sendReportError = (res, r) => res.status(REPORT_ERROR_STATUS[r.code] || 400).json({ error: r.error, code: r.code });

// date (اختیاری، YYYY-MM-DD): گزارش دیرهنگام/backfill؛ اعتبارسنجی کامل سمت سرور (taskReportService.resolveReportDate)
router.get('/miniapp/daily-tasks', (req, res) => {
  const r = taskReportService.getDailyTasks(req.miniAppUser, { requestedDate: req.query.date });
  if (!r.ok) return sendReportError(res, r);
  return res.json(r);
});
router.post('/miniapp/daily-report', (req, res) => {
  const body = req.body || {};
  const r = taskReportService.submitDailyReport(req.miniAppUser, body, { requestedDate: body.date });
  if (!r.ok) return sendReportError(res, r);
  if (r.late) {
    auditRepository.logEvent({ userId: req.miniAppUser.id, action: 'daily_report_submitted', ipAddress: req.ip, details: { source: 'miniapp_late', mode: r.source, date: r.date, late: true, answers: r.saved.answers, extra: r.saved.extra } });
  }
  return res.json(r);
});
// روزهایی که هنوز گزارشِ دیرهنگام می‌پذیرند (بنر Mini App)
router.get('/miniapp/report-backfill', (req, res) => {
  res.json(taskReportService.getBackfillStatus(req.miniAppUser));
});

// ---------- مشاهده‌ی گزارش تیم (D9؛ فقط سرپرست/ادمین — نقش و اسکوپ سمت سرور در teamReviewService) ----------

const sendReviewError = (res, r) => res.status(teamReviewService.statusOf(r.code)).json({ error: r.error, code: r.code });

// وضعیت مشاهده‌ی گزارش اعضا برای «روز قبل» (یا ?date=YYYY-MM-DD)
router.get('/miniapp/team-review', (req, res) => {
  const r = teamReviewService.getTeamReview(req.miniAppUser, { date: req.query.date, detail: req.query.detail === '1' });
  if (!r.ok) return sendReviewError(res, r);
  return res.json(r);
});
// { subjectUserId, reportDate, comment?, reaction? } — «مشاهده شد» (idempotent)
router.post('/miniapp/report-reviews', (req, res) => {
  const r = teamReviewService.markReviewed(req.miniAppUser, req.body, { ip: req.ip });
  if (!r.ok) return sendReviewError(res, r);
  return res.json(r);
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

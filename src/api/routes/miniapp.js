// مسیرهای API مخصوص Telegram Mini App (فاز ۴ سند پروژه).
//
// تفاوت کلیدی با مسیرهای قدیمی /api/attendance/*: در آنجا userId مستقیم از body خوانده می‌شد
// (بدون اثبات هویت واقعی). اینجا تمام مسیرها ابتدا از middleware `telegramAuth` عبور می‌کنند که
// initData امضاشده‌ی تلگرام را تأیید می‌کند و req.miniAppUser را از روی آن (نه از ورودی خام کاربر)
// پیدا می‌کند؛ یعنی کارمند نمی‌تواند جای کارمند دیگری ثبت تردد بزند یا گزارش کسی دیگر را ببیند.

const express = require('express');
const router = express.Router();

const { telegramAuth } = require('../../middleware/telegramAuth');
const { miniAppAuth } = require('../../middleware/miniAppAuth');
const { baleMiniAppAuth } = require('../../middleware/baleMiniAppAuth');
const { consumeMiniAppToken } = require('../../utils/panelLoginCodes');
const { createSessionToken } = require('../../utils/session');
const usersRepository = require('../../repositories/usersRepository');
const config = require('../../config');
const { networkRestriction, getRemoteAccess } = require('../../middleware/networkRestriction');
const missionNowService = require('../../services/missionNowService');
const pendingMissionService = require('../../services/pendingMissionService');
const planGateService = require('../../services/planGateService');
const disputeService = require('../../services/disputeService');
const taskReportService = require('../../services/taskReportService');
const selfUrgentTaskService = require('../../services/selfUrgentTaskService');
const teamReviewService = require('../../services/teamReviewService');
const { maintenanceGate } = require('../../middleware/maintenanceGate');
const { createRateLimiter } = require('../../middleware/rateLimiter');

const attendanceRepository = require('../../repositories/attendanceRepository');
const remoteWorkService = require('../../services/remoteWorkService');
const remoteWorkRepository = require('../../repositories/remoteWorkRepository');
const breakRepository = require('../../repositories/breakRepository');
const breakPolicyService = require('../../services/breakPolicyService');
const lateLimitService = require('../../services/lateLimitService');
const leaveRepository = require('../../repositories/leaveRepository');
const leaveTypesRepository = require('../../repositories/leaveTypesRepository');
const leaveService = require('../../services/leaveService');
const missionService = require('../../services/missionService');
const { getCalendarDay, weekStartOf } = require('../../engine/calendarService');
const attachmentService = require('../../services/attachmentService');
const { sendAttachment } = require('../../utils/attachmentResponse');
const leaveBalanceService = require('../../services/leaveBalanceService');
const { jalaliYearOfDateString, jalaliPartsOfDateString, jalaliMonthRangeOf } = require('../../utils/jalali');
const auditRepository = require('../../repositories/auditRepository');
const settingsRepository = require('../../repositories/settingsRepository');
const monthClosuresRepository = require('../../repositories/monthClosuresRepository');
const dayService = require('../../engine/dayService');
const { extractDeviceInfo } = require('../../utils/deviceInfo');
const fraudRunner = require('../../utils/fraudRunner');
const notificationEvents = require('../../services/notificationEvents');
const { todayDateString } = require('../../utils/serverTime');
const { addDays } = require('../../utils/shiftDay');
const { earningsForUser } = require('../../services/earningsService');
const employeeWeekService = require('../../services/employeeWeekService');
const disputeRepository = require('../../repositories/disputeRepository');

const IDEMPOTENT_WINDOW_MS = 2 * 60 * 1000;
const justHappened = (value) => {
  const at = new Date(value || 0).getTime();
  return Number.isFinite(at) && Date.now() - at >= 0 && Date.now() - at <= IDEMPOTENT_WINDOW_MS;
};

// همه مسیرهای زیر /miniapp ابتدا باید هویت تلگرام معتبر داشته باشند
const baleMiniAppLoginLimiter = createRateLimiter({
  name: 'bale-miniapp-login', windowMs: 60 * 1000, max: 10,
  message: 'تعداد تلاش‌های ورود زیاد است. کمی بعد دوباره تلاش کنید.',
});

router.post('/miniapp/auth/bale', baleMiniAppLoginLimiter, (req, res) => {
  const userId = consumeMiniAppToken(req.body?.token);
  const user = userId ? usersRepository.findById(userId) : null;
  if (!user || !user.is_active) return res.status(401).json({ error: 'لینک مینی‌اپ نامعتبر یا منقضی شده است. از بات بله دوباره وارد شوید.' });
  const session = createSessionToken({ userId: user.id, kind: 'bale_miniapp' }, config.adminSessionSecret, 8 * 60 * 60);
  res.json({ session, user: { id: user.id, fullName: user.full_name } });
});

router.use('/miniapp', (req, res, next) => {
  if (req.get('x-bale-init-data')) return baleMiniAppAuth(req, res, next);
  if (req.get('x-miniapp-session')) return miniAppAuth(req, res, next);
  return telegramAuth(req, res, next);
});

// ریست برنامه (B2): هنگام نگهداری، ثبت تردد 503 می‌گیرد (قبل از چک شبکه/rate limit)
router.use('/miniapp/check-in', maintenanceGate);
router.use('/miniapp/check-out', maintenanceGate);
router.use('/miniapp/re-check-in', maintenanceGate);
router.use('/miniapp/break/start', maintenanceGate);
router.use('/miniapp/break/end', maintenanceGate);

// عملیات‌های واقعی ثبت تردد علاوه‌بر آن باید از چک شبکه داخلی فاز ۲ هم عبور کنند
router.use('/miniapp/check-in', networkRestriction);
router.use('/miniapp/check-out', networkRestriction);
router.use('/miniapp/re-check-in', networkRestriction);
router.use('/miniapp/break/start', networkRestriction);
router.use('/miniapp/break/end', networkRestriction);

// نشست باز دورکاری و حضور حضوری هم‌زمان نباید ایجاد شود. هویت فقط از initData امضاشده است.
function blockOpenRemoteSession(req, res, next) {
  if (!remoteWorkRepository.findOpenSession(req.miniAppUser.id)) return next();
  return res.status(409).json({
    error: 'یک دورکاری باز دارید؛ ابتدا از «📂 منو ← 🏠 ثبت دورکاری» در بات پایان دورکاری را ثبت کنید.',
    code: 'REMOTE_SESSION_OPEN',
  });
}
router.use('/miniapp/check-in', blockOpenRemoteSession);
router.use('/miniapp/re-check-in', blockOpenRemoteSession);

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
router.use('/miniapp/checkin-permission', miniAppActionLimiter);
router.use('/miniapp/check-out', miniAppActionLimiter);
router.use('/miniapp/re-check-in', miniAppActionLimiter);
router.use('/miniapp/break/start', miniAppActionLimiter);
router.use('/miniapp/break/end', miniAppActionLimiter);

// A4 (فاز ۱۵): limiter جداگانه برای تسک‌ها (تیک/واگرد/توضیح/خواندن فهرست) و سخت‌گیرانه‌تر برای افزودن/ویرایش/حذف تسک فوریِ شخصی.
// کلید = شناسه‌ی کاربر (نه IP)؛ از miniAppActionLimiter (مخصوص ثبت تردد و پیامش) استفاده نمی‌شود.
const miniAppTasksLimiter = createRateLimiter({
  name: 'miniapp-tasks',
  windowMs: 60 * 1000,
  max: 60,
  message: 'تعداد درخواست‌های تسک بیش از حد مجاز است. لطفاً کمی صبر کنید.',
  keyFn: miniAppRateLimitKey,
});
const miniAppMyUrgentLimiter = createRateLimiter({
  name: 'miniapp-my-urgent',
  windowMs: 60 * 1000,
  max: 10,
  message: 'تعداد درخواست‌های تسک فوری بیش از حد مجاز است. لطفاً کمی صبر کنید.',
  keyFn: miniAppRateLimitKey,
});
router.use('/miniapp/daily-tasks', miniAppTasksLimiter);
router.use('/miniapp/week-board', miniAppTasksLimiter);
router.use('/miniapp/daily-report', miniAppTasksLimiter);
router.use('/miniapp/my-urgent', miniAppMyUrgentLimiter);

// ---------- دورکاری (R3، فاز ۱۴) ----------
// گیت مشترک همه‌ی مسیرهای /miniapp/remote/*: نگهداری ← remoteAllowed (بیرون از شبکه، بدون ماموریت، کاربر فعال، تنظیم روشن) ← rate limit.
// کاربر داخل شبکه (یا دارای ماموریت) هرگز دورکاری نمی‌بیند؛ تصمیم فقط از req.ip سمت سرور است.
router.use('/miniapp/remote', maintenanceGate);
router.use('/miniapp/remote', (req, res, next) => {
  if (getRemoteAccess(req).remoteAllowed) return next();
  auditRepository.logEvent({ userId: req.miniAppUser?.id || null, action: 'remote_work_rejected', ipAddress: req.ip, details: { path: req.originalUrl } });
  return res.status(403).json({
    error: 'ثبت دورکاری برای شما فعال نیست؛ فقط کاربری که بیرون از شبکه‌ی شرکت است، ماموریت ندارد و دورکاری برایش روشن است می‌تواند ساعت دورکاری ثبت کند.',
    code: 'REMOTE_NOT_ALLOWED',
  });
});
router.use('/miniapp/remote', (req, res, next) => (req.method === 'POST' ? miniAppActionLimiter(req, res, next) : next()));

function sendRemote(res, result, status, pick) {
  if (!result.ok) return res.status(result.status).json({ error: result.error, code: result.code });
  return res.status(status).json(pick(result));
}

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

// ---------- وضعیت شبکه (R2، فاز ۱۴) ----------
// فقط نتیجه‌ی تصمیم سرور از روی req.ip؛ کلاینت هیچ ورودی‌ای برای تشخیص نمی‌فرستد (query/body/header خوانده نمی‌شود).
// فقط سه فیلد برمی‌گردد و چیزی از رنج شبکه یا ماموریت لو نمی‌رود. بدون audit (مثل /me در هر بار باز شدن برنامه صدا می‌خورد).
router.get('/miniapp/network-state', (req, res) => {
  const { inNetwork, viaMission, remoteAllowed } = getRemoteAccess(req);
  res.json({ inNetwork, viaMission, remoteAllowed });
});

// ---------- وضعیت امروز ----------

router.get('/miniapp/today', (req, res) => {
  const record = attendanceRepository.findTodayRecord(req.miniAppUser.id);
  const openBreak = record ? breakRepository.findOpenBreak(record.id) : null;
  const breaks = record ? breakRepository.listByAttendanceRecord(record.id) : [];
  const summary = record ? dayService.summarizeRecord(record) : null;
  // C1: سیاست استراحت با حقوق (خاموش ⇒ enabled=false) + شماره‌ی استراحتِ بازِ جاری؛ فیلدهای قبلی بدون تغییر
  const breakPolicy = breakPolicyService.policyFor(req.miniAppUser.id, record ? record.record_date : null);
  const openBreakPaid = record && openBreak ? breakPolicyService.paidInfo(req.miniAppUser.id, record.record_date, breaks, openBreak) : null;
  const settings = settingsRepository.getAll();
  const earnings = earningsForUser(req.miniAppUser, settings, { today: todayDateString() });
  const segments = record ? attendanceRepository.listSegments(record.id) : [];
  const reEntriesUsed = Math.max(0, segments.length - 1);
  const canReEnter = Boolean(record && record.check_out_time && settings.maxReEntriesPerDay > reEntriesUsed);
  res.json({ record: record || null, openBreak: openBreak || null, breaks, summary, breakPolicy, openBreakPaid, earnings, segments, reEntriesUsed, reEntriesMax: settings.maxReEntriesPerDay, canReEnter });
});

router.get('/miniapp/week-strip', (req, res) => {
  const result = employeeWeekService.getMyWeek(req.miniAppUser, {});
  if (!result.ok) return res.status(result.status || 400).json({ error: result.error, code: result.code });
  return res.json({ days: result.days.map((d) => ({ date: d.date, jalali: d.jalali, weekday: d.weekday, isToday: d.isToday, isFuture: d.isFuture, kind: d.kind, absent: d.absent, attendance: d.attendance ? { lateMinutes: d.attendance.lateMinutes, effectiveMinutes: d.attendance.effectiveMinutes, flags: d.attendance.flags } : null })) });
});

router.post('/miniapp/re-check-in', (req, res) => {
  const record = attendanceRepository.findTodayRecord(req.miniAppUser.id);
  const settings = settingsRepository.getAll();
  const currentSegments = record ? attendanceRepository.listSegments(record.id) : [];
  const used = Math.max(0, currentSegments.length - 1);
  const lastSegment = currentSegments[currentSegments.length - 1];
  if (lastSegment && !lastSegment.check_out_time && justHappened(lastSegment.check_in_time)) return res.json({ ok: true, alreadyDone: true, ...record, segments: currentSegments });
  if (record && monthClosuresRepository.findClosedOverlapping(record.record_date, record.record_date).length) return res.status(409).json({ code: 'MONTH_CLOSED', error: 'این روز در ماه بسته‌شده است و قابل تغییر نیست.' });
  if (!record || !record.check_out_time) return res.status(409).json({ code: 'REENTRY_NOT_AVAILABLE', error: 'ورود مجدد فقط پس از ثبت خروج ممکن است.' });
  if (!settings.maxReEntriesPerDay || used >= settings.maxReEntriesPerDay) return res.status(409).json({ code: 'REENTRY_LIMIT', error: 'سقف ورود مجدد امروز تکمیل شده است.' });
  if (rejectIfSharedDeviceBlocked(req, res, 're_check_in')) return;
  const updated = attendanceRepository.startReEntry(record.id, req.ip, settings.maxReEntriesPerDay);
  if (!updated) return res.status(409).json({ code: 'REENTRY_LIMIT', error: 'سقف ورود مجدد امروز تکمیل شده است.' });
  auditRepository.logEvent({ userId: req.miniAppUser.id, action: 're_check_in', ipAddress: req.ip, details: { source: 'miniapp' } });
  res.status(201).json({ ...updated, segments: attendanceRepository.listSegments(record.id) });
  fraudRunner.runFraudChecksSafe({ date: record.record_date });
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
    if (existing.check_in_time && !existing.check_out_time && justHappened(existing.check_in_time)) return res.json({ ok: true, alreadyDone: true, ...existing });
    return res.status(400).json({ error: 'ورود امروز قبلاً ثبت شده است.' });
  }
  if (rejectIfSharedDeviceBlocked(req, res, 'check_in')) return;
  // D2: گیت سقف تأخیر ماهانه — فقط برای ورودِ «دیر»؛ ورود با ماموریتِ در انتظار مستثنی است. هر خطای داخلی ⇒ fail-open (ثبت ورود نمی‌شکند).
  let gate = null;
  if (!req.viaPendingMission) {
    try { gate = lateLimitService.evaluateCheckIn(req.miniAppUser); } catch (err) { console.error('[late-limit] خطا در گیت (نادیده گرفته شد):', err && err.message ? err.message : err); }
  }
  if (gate && gate.action === 'block') {
    auditRepository.logEvent({ userId: req.miniAppUser.id, action: 'check_in_blocked', ipAddress: req.ip, details: { source: 'miniapp', reason: 'late_limit_reached', lateCount: gate.state.lateCount, limit: gate.state.limit, lateMinutes: gate.lateMinutes } });
    return res.status(409).json({
      code: 'LATE_LIMIT_REACHED',
      error: `این ماه ${gate.state.limit} بار تأخیر داشته‌اید؛ برای ثبت ورود باید از سرپرست خود اجازه بگیرید.`,
      lateCount: gate.state.lateCount,
      limit: gate.state.limit,
      permission: gate.state.permission,
    });
  }
  const record = attendanceRepository.recordCheckIn(req.miniAppUser.id, req.ip, extractDeviceInfo(req), { viaPendingMission: Boolean(req.viaPendingMission) });
  if (req.viaPendingMission) pendingMissionService.flagPendingMissionOutside({ userId: req.miniAppUser.id, record, requestId: req.viaPendingMission, action: 'check_in' });
  auditRepository.logEvent({
    userId: req.miniAppUser.id,
    action: 'check_in',
    ipAddress: req.ip,
    details: { source: 'miniapp' },
  });
  // D2: ورود با اجازه ⇒ اجازه «used» و در audit «با اجازه‌ی سرپرست» (ساعت ورود همان لحظه‌ی واقعی ثبت است)؛ soft ⇒ هشدار در audit و پاسخ
  let lateLimitWarning = null;
  if (gate && gate.viaPermission) {
    const used = lateLimitService.consumeOnCheckIn(req.miniAppUser);
    auditRepository.logEvent({ userId: req.miniAppUser.id, action: 'check_in_with_permission', ipAddress: req.ip, details: { source: 'miniapp', permissionId: used ? used.id : gate.state.permission.id, approvedBy: gate.state.permission.decidedBy, lateCount: gate.state.lateCount, limit: gate.state.limit, lateMinutes: gate.lateMinutes } });
  } else if (gate && gate.action === 'warn') {
    auditRepository.logEvent({ userId: req.miniAppUser.id, action: 'check_in_late_limit_warning', ipAddress: req.ip, details: { source: 'miniapp', mode: 'soft', lateCount: gate.state.lateCount, limit: gate.state.limit, lateMinutes: gate.lateMinutes } });
    lateLimitWarning = { code: 'LATE_LIMIT_SOFT', lateCount: gate.state.lateCount, limit: gate.state.limit, message: `این ماه ${gate.state.lateCount} بار تأخیر داشته‌اید (سقف ${gate.state.limit}).` };
  }
  res.status(201).json(lateLimitWarning ? { ...record, lateLimitWarning } : record);
  // تشخیص مورد مشکوک (S2-4e): بعد از ارسال پاسخ و کاملاً ضدخطا؛ هرگز روی نتیجه‌ی ثبت اثر نمی‌گذارد
  fraudRunner.runFraudChecksSafe({ date: record.record_date });
});

router.get('/miniapp/checkout-readiness', (req, res) => {
  const record = attendanceRepository.findTodayRecord(req.miniAppUser.id);
  if (!record || record.check_out_time) return res.json([]);
  const items = [];
  const openBreak = breakRepository.findOpenBreak(record.id);
  items.push(openBreak
    ? { key: 'open_break', status: 'blocked', title: 'استراحت باز است', hint: 'برای ثبت خروج، ابتدا استراحت جاری را پایان دهید.', actionView: 'today' }
    : { key: 'open_break', status: 'ok', title: 'استراحت', hint: '', actionView: 'today' });
  const reportGate = taskReportService.checkoutGate(req.miniAppUser, record.record_date, {});
  items.push(reportGate.action === 'block'
    ? { key: 'daily_report', status: 'blocked', title: 'گزارش روزانه', hint: 'چند تسک امروز هنوز بدون وضعیت است؛ در مرحلهٔ بعد مشخص می‌کنید.', actionView: 'dreport' }
    : { key: 'daily_report', status: 'ok', title: 'گزارش روزانه', hint: '', actionView: 'dreport' });
  const planGate = planGateService.evaluate(req.miniAppUser, record.record_date);
  const planBlocked = planGate.applies && !planGate.satisfied && !planGate.exemption && planGate.mode === 'enforce';
  items.push(planBlocked
    ? { key: 'weekly_plan', status: 'blocked', title: 'برنامهٔ هفتهٔ بعد', hint: 'پیش از خروج، برنامهٔ هفتهٔ بعد را ثبت کنید.', actionView: 'plan' }
    : { key: 'weekly_plan', status: planGate.warn ? 'confirm' : 'ok', title: 'برنامهٔ هفتهٔ بعد', hint: planGate.warn ? 'امروز آخرین فرصت ثبت برنامه است.' : '', actionView: 'plan' });
  res.json(items);
});

router.post('/miniapp/check-out', (req, res) => {
  const record = attendanceRepository.findTodayRecord(req.miniAppUser.id);
  if (!record) {
    return res.status(400).json({ error: 'ابتدا باید ورود ثبت شود.' });
  }
  if (record.check_out_time) {
    if (justHappened(record.check_out_time)) return res.json({ ok: true, alreadyDone: true, ...record });
    return res.status(400).json({ error: 'خروج امروز قبلاً ثبت شده است.' });
  }
  const openBreak = breakRepository.findOpenBreak(record.id);
  if (openBreak) {
    return res.status(400).json({ error: 'ابتدا باید استراحت باز فعلی را پایان دهید.' });
  }
  // گیت D7: گزارش روزانه‌ی تسک‌ها. ترتیب گیت‌ها: گزارش امروز ← برنامه‌ی هفته‌ی بعد ← ثبت خروج.
  // (بعد از بررسی «خروج قبلاً ثبت شده»، تا دبل‌کلیکِ موفق 409 نگیرد؛ تا همه‌ی گیت‌ها رد نشوند چیزی نوشته نمی‌شود.)
  // خروج نوبت دوم همان تعهد روز را دوباره مطالبه نمی‌کند؛ گزارش و برنامه در خروج اول بررسی شده‌اند.
  const isReEntryCheckout = attendanceRepository.listSegments(record.id).length > 1;
  const reportGate = isReEntryCheckout ? { action: 'allow', report: null } : taskReportService.checkoutGate(req.miniAppUser, record.record_date, req.body);
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
  const planGate = isReEntryCheckout ? { action: 'allow', info: {} } : planGateService.check(req.miniAppUser, record.record_date);
  if (planGate.action === 'block') {
    auditRepository.logEvent({ userId: req.miniAppUser.id, action: 'check_out_blocked', ipAddress: req.ip, details: { source: 'miniapp', reason: 'weekly_plan_required', weekStart: planGate.info.weekStart } });
    return res.status(409).json({
      error: 'متأسفم، هنوز برنامه‌ی هفته‌ی بعد را ثبت نکرده‌اید؛ تا ثبت برنامه نمی‌توانید خروج بزنید.',
      code: 'weekly_plan_required',
      weekStart: planGate.info.weekStart,
      planDay: planGate.info.planDay,
    });
  }
  // آخرین فرصت (چهارشنبه): بدون تأیید صریح کاربر چیزی ثبت نمی‌شود؛ UI با confirmPlanDeadline: true دوباره می‌فرستد
  if (planGate.action === 'confirm' && !(req.body && req.body.confirmPlanDeadline === true)) {
    return res.status(409).json({
      error: 'برنامه‌ی هفته‌ی بعد را هنوز ثبت نکرده‌اید. اگر فردا نمی‌آیید، امروز آخرین مهلت شماست. مطمئنید می‌خواهید خروج بزنید؟',
      code: 'weekly_plan_deadline_confirm',
      weekStart: planGate.info.weekStart,
      planDay: planGate.info.planDay,
    });
  }
  if (rejectIfSharedDeviceBlocked(req, res, 'check_out')) return;
  // ذخیره‌ی گزارش (اگر در همین درخواست آمده) و ثبت خروج: اتمیک، در یک تراکنش
  const updated = taskReportService.commitAtomic(req.miniAppUser, reportGate, () => attendanceRepository.closeLastSegment(record.id, req.ip, extractDeviceInfo(req), { viaPendingMission: Boolean(req.viaPendingMission) }));
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
  if (!isReEntryCheckout) planGateService.consumeExemption(req.miniAppUser, planGate, updated, req.ip);
  const payload = { ...updated };
  if (planGate.action === 'remind' || planGate.action === 'confirm') payload.planReminder = { weekStart: planGate.info.weekStart };
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
  const activeBreak = breakRepository.findOpenBreak(record.id);
  if (activeBreak) {
    if (justHappened(activeBreak.start_time)) return res.json({ ok: true, alreadyDone: true, ...activeBreak });
    return res.status(400).json({ error: 'یک استراحت باز از قبل فعال است.' });
  }
  const breakType = req.body?.breakType === 'short_break' ? 'short_break' : 'lunch';
  const breakRecord = breakRepository.startBreak(record.id, breakType);
  // C1: «استراحت با حقوق ۲ از ۳» (فقط وقتی سیاست روشن و استراحت کوتاه است؛ وگرنه paid=null)
  const paid = breakPolicyService.paidInfo(req.miniAppUser.id, record.record_date, breakRepository.listByAttendanceRecord(record.id), breakRecord);
  res.status(201).json({ ...breakRecord, paid });
});

router.post('/miniapp/break/end', (req, res) => {
  const record = attendanceRepository.findTodayRecord(req.miniAppUser.id);
  if (!record) {
    return res.status(400).json({ error: 'رکورد امروز یافت نشد.' });
  }
  const openBreak = breakRepository.findOpenBreak(record.id);
  if (!openBreak) {
    const breaks = breakRepository.listByAttendanceRecord(record.id);
    const latest = breaks[breaks.length - 1];
    if (latest && latest.end_time && justHappened(latest.end_time)) return res.json({ ok: true, alreadyDone: true, ...latest });
    return res.status(400).json({ error: 'استراحت باز فعالی وجود ندارد.' });
  }
  const ended = breakRepository.endBreak(openBreak.id);
  res.json(ended);
});

// ---------- دورکاری: مسیرها (R3) ----------
// هیچ زمان/تاریخی از بدنه‌ی درخواست خوانده نمی‌شود؛ ساعت و روز کاری فقط سمت سرور.
router.get('/miniapp/remote/today', (req, res) => {
  res.json(remoteWorkService.getToday(req.miniAppUser.id));
});
router.get('/miniapp/remote/history', (req, res) => {
  res.json(remoteWorkService.getHistory(req.miniAppUser.id, { days: req.query.days }));
});
router.post('/miniapp/remote/start', (req, res) => {
  sendRemote(res, remoteWorkService.start(req.miniAppUser, { ip: req.ip }), 201, (r) => r.session);
});
router.post('/miniapp/remote/end', (req, res) => {
  sendRemote(res, remoteWorkService.end(req.miniAppUser, { ip: req.ip }), 200, (r) => ({ ...r.session, autoClosedBreak: r.autoClosedBreak }));
});
router.post('/miniapp/remote/break/start', (req, res) => {
  sendRemote(res, remoteWorkService.breakStart(req.miniAppUser, { ip: req.ip }), 201, (r) => r.break);
});
router.post('/miniapp/remote/break/end', (req, res) => {
  sendRemote(res, remoteWorkService.breakEnd(req.miniAppUser, { ip: req.ip }), 200, (r) => r.break);
});

// ---------- تاریخچه شخصی ----------

router.get('/miniapp/history', (req, res) => {
  const days = Math.min(parseInt(req.query.days, 10) || 30, 90);
  // from/to (اختیاری، YYYY-MM-DD): برای «هفته/ماه جاری» در گزارش؛ بازه حداکثر ۹۳ روز و to بعد از امروز نمی‌رود. وگرنه رفتار قبلی (days روز اخیر)
  const isoRe = /^\d{4}-\d{2}-\d{2}$/;
  const today = todayDateString();
  const hasRange = isoRe.test(String(req.query.from || '')) && isoRe.test(String(req.query.to || ''));
  const toQ = hasRange ? (req.query.to > today ? today : req.query.to) : null;
  const rangeOk = hasRange && req.query.from <= toQ && (Date.parse(toQ) - Date.parse(req.query.from)) / 86400000 <= 93;
  const from = rangeOk ? req.query.from : dateDaysAgo(days);
  const to = rangeOk ? toQ : today;
  const records = attendanceRepository.listByUserAndRange(req.miniAppUser.id, from, to);
  const enriched = records.map((r) => ({ ...r, summary: dayService.summarizeRecord(r) }));
  res.json(enriched);
});

// ---------- گزارش شخصی (هفتگی/ماهانه) ----------

router.get('/miniapp/report', (req, res) => {
  const isMonth = req.query.period === 'month';
  const to = todayDateString();
  // ماه جاری: از اول ماه شمسی تا امروز؛ هفته جاری: از روز شروع هفته (weekStartDay، پیش‌فرض شنبه) تا امروز
  let from;
  if (isMonth) {
    const parts = jalaliPartsOfDateString(to);
    from = parts ? jalaliMonthRangeOf(parts.jy, parts.jm).from : dateDaysAgo(30);
  } else {
    from = weekStartOf(to, settingsRepository.getAll().weekStartDay);
  }
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

// D2: وضعیت سقف تأخیر و اجازه‌ی ورودِ امروزِ خود کارمند (برای کارت Mini App؛ polling سبک). خاموش ⇒ enabled=false
router.get('/miniapp/checkin-permission', (req, res) => {
  res.json({ gate: lateLimitService.getGateState(req.miniAppUser) });
});

// D2: درخواست اجازه‌ی ورود { reason } ⇒ 201 { permission } | 400/409 { error, code }
router.post('/miniapp/checkin-permission', (req, res) => {
  const r = lateLimitService.requestPermission(req.miniAppUser, (req.body || {}).reason);
  if (!r.ok) return res.status(r.status).json({ error: r.error, code: r.code, permission: r.permission || null });
  auditRepository.logEvent({ userId: req.miniAppUser.id, action: 'checkin_permission_requested', ipAddress: req.ip, details: { source: 'miniapp', permissionId: r.permission.id, date: r.permission.date } });
  notificationEvents.checkinPermissionRequested(r.permission); // D3: اعلان پنل + تلگرام (با دکمه‌های تأیید/رد) به سرپرست مستقیم؛ هرگز ثبت را نمی‌شکند
  return res.status(201).json({ permission: r.permission });
});

// B2: ساعت کاری «مؤثر» امروز و فردای خود کارمند (override روز ← شیفت ← سراسری)؛ special = برنامه‌ی ویژه‌ی همان روز ('work'|'off'|null)
router.get('/miniapp/schedule/upcoming', (req, res) => {
  const today = todayDateString();
  const days = [today, addDays(today, 1)].map((date) => {
    const d = getCalendarDay(req.miniAppUser, date);
    return { date, isWorkingDay: !!d.isWorkingDay, kind: d.kind, expectedStart: d.expectedStart || null, expectedEnd: d.expectedEnd || null, holidayTitle: d.holidayTitle || null, special: d.override || null };
  });
  res.json({ days });
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
const planError = (res, r) => res.status(r.code === 'MONTH_CLOSED' || r.code === 'PLAN_LOCKED' ? 409 : 400).json({ error: r.error, code: r.code });

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
// A3-۲: «دیده شد» — خاموش‌کردن بنر «سرپرست برنامه را تغییر داده»
router.post('/miniapp/plan/seen', (req, res) => {
  const b = req.body || {};
  const r = weeklyPlanService.markSeen(req.miniAppUser, b.week || 'next');
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

// نگاشت خطا در src/utils/reportErrors.js (مشترک با پنل: /admin/me/tasks/*)
const { REPORT_ERROR_STATUS } = require('../../utils/reportErrors');
const sendReportError = (res, r) => res.status(REPORT_ERROR_STATUS[r.code] || 400).json({ error: r.error, code: r.code });

// date (اختیاری، YYYY-MM-DD): گزارش دیرهنگام/backfill؛ اعتبارسنجی کامل سمت سرور (taskReportService.resolveReportDate)
router.get('/miniapp/daily-tasks', (req, res) => {
  const r = taskReportService.getDailyTasks(req.miniAppUser, { requestedDate: req.query.date });
  if (!r.ok) return sendReportError(res, r);
  return res.json(r);
});
// B1 (فاز ۱۵): هفته‌ی کارمند با تسک‌ها و وضعیت هر روز (فقط‌خواندنی؛ week=current|next)
router.get('/miniapp/week-board', (req, res) => {
  const r = taskReportService.getWeekBoard(req.miniAppUser, { week: req.query.week || 'current' });
  if (!r.ok) return sendReportError(res, r);
  return res.json(r);
});
router.post('/miniapp/daily-report', (req, res) => {
  const body = req.body || {};
  const r = taskReportService.submitDailyReport(req.miniAppUser, body, { requestedDate: body.date });
  if (!r.ok) return sendReportError(res, r);
  // A2: انتقال/حذفِ تسک هم در همین رویداد ثبت می‌شود (reschedules: [{taskId, to}]؛ to تاریخ یا 'drop')
  if (r.late || r.rescheduled.length) {
    auditRepository.logEvent({ userId: req.miniAppUser.id, action: 'daily_report_submitted', ipAddress: req.ip, details: { source: r.late ? 'miniapp_late' : 'miniapp', mode: r.source, date: r.date, late: !!r.late, answers: r.saved.answers, extra: r.saved.extra, reschedules: r.rescheduled } });
  }
  return res.json(r);
});
// A1 (فاز ۱۵): برداشتن پاسخ (تیک) — { taskId, date? }؛ تاریخ فقط با resolveReportDate اعتبارسنجی می‌شود و مالکیت فقط از req.miniAppUser
router.post('/miniapp/daily-report/undo', (req, res) => {
  const body = req.body || {};
  const r = taskReportService.undoAnswer(req.miniAppUser, { taskId: body.taskId, date: body.date });
  if (!r.ok) return sendReportError(res, r);
  auditRepository.logEvent({ userId: req.miniAppUser.id, action: 'task_answer_undone', ipAddress: req.ip, details: { source: 'miniapp', taskId: r.undone.taskId, date: r.undone.date, previousStatus: r.undone.previousStatus, outOfPlan: r.undone.outOfPlan } });
  return res.json(r);
});
// A1 (فاز ۱۵): ویرایش/پاک‌کردن توضیحِ انجام — { taskId, date?, note }؛ فقط برای تسک done (متنِ توضیح در audit ثبت نمی‌شود)
router.patch('/miniapp/daily-report/note', (req, res) => {
  const body = req.body || {};
  const r = taskReportService.updateNote(req.miniAppUser, { taskId: body.taskId, date: body.date, note: body.note });
  if (!r.ok) return sendReportError(res, r);
  auditRepository.logEvent({ userId: req.miniAppUser.id, action: 'task_done_note_edited', ipAddress: req.ip, details: { source: 'miniapp', taskId: r.taskId, date: r.date, cleared: r.cleared } });
  return res.json(r);
});
// روزهایی که هنوز گزارشِ دیرهنگام می‌پذیرند (بنر Mini App)
router.get('/miniapp/report-backfill', (req, res) => {
  res.json(taskReportService.getBackfillStatus(req.miniAppUser));
});

// ---------- تسک فوریِ خودِ کارمند (A4، فاز ۱۵؛ منطق در selfUrgentTaskService) ----------
// مالکیت فقط از req.miniAppUser؛ بدنه فقط title/description/date. هر پاسخ موفق، فهرست تازه‌ی «امروز» را هم برمی‌گرداند (daily) تا UI حدس نزند.
const sendSelfUrgentError = (res, r) => res.status(REPORT_ERROR_STATUS[r.code] || selfUrgentTaskService.statusOf(r.code)).json({ error: r.error, code: r.code });
const freshToday = (user) => { const d = taskReportService.getDailyTasks(user); return d.ok ? d : null; };
const taskIdParam = (req) => { const n = Number(req.params.id); return Number.isInteger(n) && n > 0 ? n : null; };
const badTaskId = (res) => res.status(404).json({ error: 'تسک فوری یافت نشد.', code: 'TASK_NOT_FOUND' });

router.post('/miniapp/my-urgent', (req, res) => {
  const r = selfUrgentTaskService.add(req.miniAppUser, req.body || {}, { ip: req.ip });
  if (!r.ok) return sendSelfUrgentError(res, r);
  return res.status(201).json({ ...r, daily: freshToday(req.miniAppUser) });
});
router.patch('/miniapp/my-urgent/:id', (req, res) => {
  const id = taskIdParam(req);
  if (id === null) return badTaskId(res);
  const r = selfUrgentTaskService.update(req.miniAppUser, id, req.body || {}, { ip: req.ip });
  if (!r.ok) return sendSelfUrgentError(res, r);
  return res.json({ ...r, daily: freshToday(req.miniAppUser) });
});
router.delete('/miniapp/my-urgent/:id', (req, res) => {
  const id = taskIdParam(req);
  if (id === null) return badTaskId(res);
  const r = selfUrgentTaskService.remove(req.miniAppUser, id, { ip: req.ip });
  if (!r.ok) return sendSelfUrgentError(res, r);
  return res.json({ ...r, daily: freshToday(req.miniAppUser) });
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

// ---------- اعتراض به رکورد و گفت‌وگو روی آن (D2؛ قواعد در disputeService) ----------

// ارسال پیام و «ادامه‌ی اعتراض» (هر دو پیام می‌نویسند) یک سطل مشترک دارند: ۱۰ مورد در دقیقه برای هر کارمند
const disputeMessageLimiter = createRateLimiter({
  name: 'miniapp-dispute-message',
  windowMs: 60 * 1000,
  max: 10,
  message: 'تعداد پیام‌های اعتراض بیش از حد مجاز است. لطفاً یک دقیقه صبر کنید.',
  keyFn: miniAppRateLimitKey,
});

const lastDisputeMessage = (r) => r.messages[r.messages.length - 1]; // پیامی که همین الان ثبت شد (آخرین پیام thread)

const sendDisputeError = (res, r) => res.status(disputeService.statusOf(r.code)).json({ error: r.error, code: r.code, ...(r.maxReopens !== undefined ? { maxReopens: r.maxReopens } : {}) });

// اصلاح خروجِ ثبت‌نشده: فقط هفت روز اخیر، فقط رکورد خودِ کارمند و فقط وقتی ماه باز است.
// پیامِ ساخت‌یافته عمداً در همان مسیر اعتراض نگه داشته می‌شود تا چرخهٔ اعلان/بازگشایی موجود حفظ شود.
function missingCheckoutCandidate(userId) {
  const today = todayDateString();
  const records = attendanceRepository.listByUserAndRange(userId, addDays(today, -7), addDays(today, -1));
  return records.sort((a, b) => String(b.record_date).localeCompare(String(a.record_date))).find((record) =>
    record.check_in_time && !record.check_out_time &&
    (record.status === 'incomplete' || record.record_date < today) &&
    !monthClosuresRepository.findClosedOverlapping(record.record_date, record.record_date).length
  ) || null;
}

router.get('/miniapp/missing-checkout', (req, res) => {
  const record = missingCheckoutCandidate(req.miniAppUser.id);
  if (!record) return res.json({ record: null, canRequest: false });
  const open = disputeRepository.listByUser(req.miniAppUser.id)
    .find((d) => d.status === 'open' && d.attendance_record_id === record.id);
  return res.json({ record: { id: record.id, record_date: record.record_date, check_in_time: record.check_in_time }, canRequest: !open, disputeId: open ? open.id : null });
});

router.post('/miniapp/missing-checkout/:recordId', (req, res) => {
  const candidate = missingCheckoutCandidate(req.miniAppUser.id);
  const recordId = Number(req.params.recordId);
  const checkoutTime = String(req.body?.checkoutTime || '');
  const note = String(req.body?.note || '').trim();
  if (!candidate || candidate.id !== recordId) return res.status(404).json({ code: 'NOT_FOUND', error: 'رکورد قابل اصلاح یافت نشد.' });
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(checkoutTime)) return res.status(400).json({ code: 'VALIDATION', error: 'ساعت خروج را به‌درستی وارد کنید.' });
  const exists = disputeRepository.listByUser(req.miniAppUser.id).find((d) => d.status === 'open' && d.attendance_record_id === candidate.id);
  if (exists) return res.status(409).json({ code: 'OPEN_REQUEST_EXISTS', error: 'برای این روز یک درخواست باز دارید.' });
  const message = `اصلاح خروج [${checkoutTime}]${note ? ` — ${note.slice(0, 430)}` : ''}`;
  const r = disputeService.create(req.miniAppUser, { attendanceRecordId: candidate.id, message }, { ip: req.ip });
  if (!r.ok) return sendDisputeError(res, r);
  notificationEvents.disputeOpened(r.dispute);
  return res.status(201).json(r.dispute);
});

router.post('/miniapp/dispute', (req, res) => {
  const r = disputeService.create(req.miniAppUser, req.body || {}, { ip: req.ip });
  if (!r.ok) return sendDisputeError(res, r);
  notificationEvents.disputeOpened(r.dispute); // S4-6b
  return res.status(201).json(r.dispute);
});

// فهرست اعتراض‌های خودِ کارمند: وضعیت (phase)، تعداد پیام و امکان ادامه/خاتمه
router.get('/miniapp/dispute', (req, res) => {
  res.json(disputeService.listMine(req.miniAppUser));
});

// thread کامل (فقط مالک؛ اعتراض دیگران ⇒ ۴۰۴)
router.get('/miniapp/dispute/:id', (req, res) => {
  const r = disputeService.getMine(req.miniAppUser, req.params.id);
  if (!r.ok) return sendDisputeError(res, r);
  return res.json(r);
});

// { message } — پیام کارمند روی اعتراضِ باز (۱ تا ۵۰۰ نویسه)
router.post('/miniapp/dispute/:id/messages', disputeMessageLimiter, (req, res) => {
  const r = disputeService.postMessage(req.miniAppUser, req.params.id, req.body || {}, { ip: req.ip });
  if (!r.ok) return sendDisputeError(res, r);
  notificationEvents.disputeUserMessage(r.dispute, lastDisputeMessage(r)); // D4: اعلان به ادمین‌های مجاز
  return res.status(201).json(r);
});

// { message } — «ادامه‌ی اعتراض» بعد از بسته‌شدن، همراه پیام جدید (سقف: تنظیم disputeMaxReopens)
router.post('/miniapp/dispute/:id/reopen', disputeMessageLimiter, (req, res) => {
  const r = disputeService.reopen(req.miniAppUser, req.params.id, req.body || {}, { ip: req.ip });
  if (!r.ok) return sendDisputeError(res, r);
  notificationEvents.disputeUserMessage(r.dispute, lastDisputeMessage(r), { reopened: true }); // D4
  return res.json(r);
});

// «خاتمه توسط کارمند» (فقط وقتی اعتراض باز است)
router.post('/miniapp/dispute/:id/close', (req, res) => {
  const r = disputeService.close(req.miniAppUser, req.params.id, { ip: req.ip });
  if (!r.ok) return sendDisputeError(res, r);
  return res.json(r);
});

module.exports = router;

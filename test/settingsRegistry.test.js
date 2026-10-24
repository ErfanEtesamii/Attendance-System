// S3-1a: رجیستری تنظیمات (انواع، مقدار نامعتبر، سازگاری با مقادیر موجود DB، رفتار repository)
const { resetDb } = require('./helpers/testEnv');
const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');

const registry = require('../src/utils/settingsRegistry');
const settings = require('../src/repositories/settingsRepository');

describe('رجیستری تنظیمات (S3-1a)', () => {
  let db;
  before(() => { db = resetDb(); });

  test('سلامت رجیستری و پوشش کلیدها (۱۱ کلید قبلی + timezone + مهلت تأخیر S3-3a + مهلت زودتر رفتن S3-3b + استراحت‌ها S3-4a + پرچم‌ها S3-4b + اضافه‌کاری S3-5a + سقف ماهانه S3-5b + تأیید S3-5c + تقویم S3-7a)', () => {
    assert.deepEqual(registry.selfCheck(), []);
    const registryKeys = registry.keys();
    assert.equal(registryKeys.includes('maxReEntriesPerDay'), true);
    assert.deepEqual(registryKeys.filter((key) => !['maxReEntriesPerDay', 'paidBreakCountUnlimited', 'remoteWorkBotEnabled', 'remoteWorkBotBlockOnsiteToday'].includes(key)), [
      'timezone', 'workDayStart', 'workDayEnd', 'lateGraceMinutes', 'lateCountsFrom', 'earlyGraceMinutes', 'weekendDays', 'halfDayWeekdays', 'halfDayEndTime', 'teamCalendarMaxConcurrent', 'maxLunchMinutes', 'fixedLunchDeductMinutes', 'fixedLunchMinPresenceMinutes', 'paidBreakCount', 'paidBreakMinutes', 'lateMonthlyLimit', 'lateLimitGateMode', 'lateLimitPermissionTtlMinutes', 'longOpenBreakMinutes', 'outsideShiftMarginMinutes', 'overtimeEnabled', 'overtimeMinMinutes', 'overtimeDailyCapMinutes', 'overtimeFactor', 'overtimeHolidayFactor', 'overtimeRoundStep', 'overtimeRounding', 'overtimeMonthlyCapMinutes', 'overtimeRequiresApproval', 'monthCloseRequireMonthEnded', 'monthCloseBlockIncomplete', 'monthCloseBlockOpenDisputes', 'monthCloseBlockPendingLeave', 'monthCloseBlockPendingOvertime', 'monthCloseBlockSuspicious', 'reportXlsxEnabled', 'reportXlsxRecipientRoles', 'reportXlsxRequireClosed', 'leaveDefaultEntitlementMinutes', 'leaveCarryOverCapMinutes', 'leaveBalancePolicy', 'leaveAllowPastRequests', 'leaveMaxPastDays', 'leaveMaxFutureDays', 'leaveMinNoticeHours', 'backupIncludeAttachments', 'leaveAttachmentMaxKb', 'leaveAttachmentTypes', 'leaveApprovalReminderHours', 'leaveApprovalEscalateHours', 'leaveEscalateWhenApproverOnLeave', 'leaveApprovalExtraStepDays', 'leaveApprovalExtraStepTypes', 'leaveApprovalExtraStepRole', 'lateCheckinGraceMinutes', 'checkoutReminderMinutesBefore', 'repeatedLatenessThreshold',
      'missionBackdateDays', 'missionAdvanceDays', 'allowCheckinWithPendingMission', 'weekStartDay', 'planSubmissionWeekday', 'planGateWarnWeekday', 'planMinTasks', 'planGateMode', 'planGateStartDate', 'dailyReportGateMode', 'reportBackfillDays', 'taskCarryMaxTimes', 'selfUrgentEnabled', 'selfUrgentMaxPerDay', 'taskReportAdminMaxParts', 'encouragementsEnabled', 'latePerformancePenaltyEnabled', 'latePerformanceThresholdMinutes', 'latePerformancePenaltyFactor', 'performanceRewardEnabled', 'performanceRewardFactor', 'showEarningsCard', 'disputeMaxReopens', 'systemGoLive',
      'blockOnSharedDevice', 'remoteWorkEnabled', 'remoteWorkMaxOpenHours', 'auditRetentionMonths', 'auditArchiveEnabled',
      'jobRunsRetentionDays', 'monitorAlertsRetentionDays', 'rateLimitRetentionDays', 'notificationsRetentionDays',
      'patternConsecutiveLateDays', 'patternWeekdayLateMinCount', 'patternWeekdayLateMinSharePercent', 'patternWeekdayLateMarginPercent', 'patternWeekendAbsenceMinCount', 'patternWeekendAbsenceMinSharePercent', 'patternSuddenIncreaseFactor', 'patternSuddenIncreaseMinExtraLate', 'patternBaselineMonths', 'patternBaselineMinMonths', 'patternMinPresentDays', 'patternIdenticalTimeMinDays', 'patternIdenticalTimeMinSharePercent',
      'cronLateCheckinCheck', 'cronCheckoutReminderCheck', 'cronDailyReport', 'cronWeeklyReport', 'cronMonthlyReport', 'cronNightlyReview', 'cronMorningDigest', 'cronAutoCloseIncomplete', 'cronMarkNonWorkingDays', 'cronDailyBackup', 'cronAuditArchive', 'cronDbMaintenance', 'cronLeaveApprovalReminder', 'cronUrgentTaskReminder', 'cronTeamReviewEnsure', 'cronWatchdog',
    ]);
    assert.deepEqual(
      ['paidBreakCountUnlimited', 'remoteWorkBotEnabled', 'remoteWorkBotBlockOnsiteToday'].map((key) => registryKeys.includes(key)),
      [true, true, true],
    );
    assert.equal(registry.getDef('workDayStart').dbKey, 'work_day_start');
    assert.equal(registry.getDef('rateLimitRetentionDays').dbKey, 'rate_limit_retention_days');
    registry.REGISTRY.forEach((d) => assert.ok(d.description && registry.GROUP_LABELS[d.group], d.key));
    const actualSettings = settings.getAll();
    assert.deepEqual({ maxReEntriesPerDay: actualSettings.maxReEntriesPerDay, paidBreakCount: actualSettings.paidBreakCount, paidBreakMinutes: actualSettings.paidBreakMinutes, paidBreakCountUnlimited: actualSettings.paidBreakCountUnlimited, remoteWorkBotEnabled: actualSettings.remoteWorkBotEnabled, remoteWorkBotBlockOnsiteToday: actualSettings.remoteWorkBotBlockOnsiteToday }, { maxReEntriesPerDay: 1, paidBreakCount: 3, paidBreakMinutes: 45, paidBreakCountUnlimited: false, remoteWorkBotEnabled: true, remoteWorkBotBlockOnsiteToday: true });
    delete actualSettings.maxReEntriesPerDay;
    delete actualSettings.paidBreakCountUnlimited;
    delete actualSettings.remoteWorkBotEnabled;
    delete actualSettings.remoteWorkBotBlockOnsiteToday;
    actualSettings.paidBreakCount = 0;
    actualSettings.paidBreakMinutes = 0;
    assert.deepEqual(actualSettings, {
      timezone: 'Asia/Tehran', workDayStart: '08:00', workDayEnd: '16:30', lateGraceMinutes: 0, lateCountsFrom: 'shift_start', earlyGraceMinutes: 0, weekendDays: [5], halfDayWeekdays: [4], halfDayEndTime: '12:30', teamCalendarMaxConcurrent: 0, maxLunchMinutes: 0, fixedLunchDeductMinutes: 45, fixedLunchMinPresenceMinutes: 240, paidBreakCount: 0, paidBreakMinutes: 0, lateMonthlyLimit: 0, lateLimitGateMode: 'off', lateLimitPermissionTtlMinutes: 60, longOpenBreakMinutes: 120, outsideShiftMarginMinutes: 120, overtimeEnabled: false, overtimeMinMinutes: 0, overtimeDailyCapMinutes: 0, overtimeFactor: 1, overtimeHolidayFactor: 1, overtimeRoundStep: 1, overtimeRounding: 'down', overtimeMonthlyCapMinutes: 0, overtimeRequiresApproval: false, monthCloseRequireMonthEnded: true, monthCloseBlockIncomplete: true, monthCloseBlockOpenDisputes: true, monthCloseBlockPendingLeave: true, monthCloseBlockPendingOvertime: true, monthCloseBlockSuspicious: false, reportXlsxEnabled: false, reportXlsxRecipientRoles: 'admin', reportXlsxRequireClosed: false, leaveDefaultEntitlementMinutes: 0, leaveCarryOverCapMinutes: 0, leaveBalancePolicy: 'warn', leaveAllowPastRequests: true, leaveMaxPastDays: 0, leaveMaxFutureDays: 0, leaveMinNoticeHours: 0, backupIncludeAttachments: true, leaveAttachmentMaxKb: 5120, leaveAttachmentTypes: 'image/jpeg,image/png,application/pdf', leaveApprovalExtraStepDays: 0, leaveApprovalExtraStepTypes: '', leaveApprovalExtraStepRole: 'admin', leaveApprovalReminderHours: 0, leaveApprovalEscalateHours: 0, leaveEscalateWhenApproverOnLeave: false, lateCheckinGraceMinutes: 15, checkoutReminderMinutesBefore: 15,
      repeatedLatenessThreshold: 3, missionBackdateDays: 3, missionAdvanceDays: 30, allowCheckinWithPendingMission: true, weekStartDay: 6, planSubmissionWeekday: 'auto', planGateWarnWeekday: '3', planMinTasks: 1, planGateMode: 'off', planGateStartDate: '', dailyReportGateMode: 'enforce', reportBackfillDays: 2, taskCarryMaxTimes: 0, selfUrgentEnabled: true, selfUrgentMaxPerDay: 5, taskReportAdminMaxParts: 6, encouragementsEnabled: true, latePerformancePenaltyEnabled: false, latePerformanceThresholdMinutes: 15, latePerformancePenaltyFactor: 1, performanceRewardEnabled: false, performanceRewardFactor: 1, showEarningsCard: false, disputeMaxReopens: 3, systemGoLive: false, blockOnSharedDevice: false, remoteWorkEnabled: true, remoteWorkMaxOpenHours: 16, auditRetentionMonths: 24, auditArchiveEnabled: false,
      jobRunsRetentionDays: 180, monitorAlertsRetentionDays: 180, rateLimitRetentionDays: 7, notificationsRetentionDays: 90,
      patternConsecutiveLateDays: 3, patternWeekdayLateMinCount: 3, patternWeekdayLateMinSharePercent: 75, patternWeekdayLateMarginPercent: 25, patternWeekendAbsenceMinCount: 3, patternWeekendAbsenceMinSharePercent: 60, patternSuddenIncreaseFactor: 2, patternSuddenIncreaseMinExtraLate: 3, patternBaselineMonths: 3, patternBaselineMinMonths: 2, patternMinPresentDays: 5, patternIdenticalTimeMinDays: 5, patternIdenticalTimeMinSharePercent: 80,
      cronLateCheckinCheck: '*/5 8-12 * * *', cronLeaveApprovalReminder: '15 * * * *', cronUrgentTaskReminder: '*/10 * * * *', cronTeamReviewEnsure: '10 0 * * *', cronCheckoutReminderCheck: '*/5 9-18 * * *', cronDailyReport: '0 17 * * *', cronWeeklyReport: '0 8 * * 6', cronMonthlyReport: '0 8 * * *', cronNightlyReview: '0 20 * * *', cronMorningDigest: '0 8 * * *',
      cronAutoCloseIncomplete: '59 23 * * *', cronMarkNonWorkingDays: '5 0 * * *', cronDailyBackup: '30 2 * * *', cronAuditArchive: '0 3 1 * *', cronDbMaintenance: '0 4 2 * *', cronWatchdog: '*/5 * * * *',
    });
  });

  test('اعتبارسنجی هر نوع: مقدار معتبر نرمال می‌شود و نامعتبر پیام فارسی می‌دهد', () => {
    const ok = (key, raw, expected) => assert.deepEqual(registry.validate(key, raw), { ok: true, value: expected }, `${key}: ${JSON.stringify(raw)}`);
    const bad = (key, raw) => {
      const r = registry.validate(key, raw);
      assert.equal(r.ok, false, `${key}: ${JSON.stringify(raw)}`);
      assert.match(r.error, /[\u0600-\u06FF]/);
    };
    // number (عدد صحیح با بازه؛ رشته‌ی عددی مثل ورودی فرم پذیرفته می‌شود)
    ok('lateCheckinGraceMinutes', '20', 20);
    ok('lateCheckinGraceMinutes', 0, 0);
    ['abc', '', 1.5, '1.5', -1, 721, NaN, Infinity, null, undefined, {}, []].forEach((v) => bad('lateCheckinGraceMinutes', v));
    // boolean
    [[true, true], ['1', true], ['true', true], [false, false], [0, false], ['false', false]].forEach(([raw, v]) => ok('blockOnSharedDevice', raw, v));
    ['yes', 2, 'abc', {}].forEach((v) => bad('blockOnSharedDevice', v));
    // time (HH:MM؛ ساعت تک‌رقمی به قالب دو رقمی نرمال می‌شود)
    ok('workDayStart', '09:15', '09:15');
    ok('workDayStart', '8:00', '08:00');
    ['24:00', '12:60', '1200', 'ab:cd', '12:5', 800, null].forEach((v) => bad('workDayStart', v));
    bad('nope', 1); // کلید ناشناخته

    // cron / enum / string: فعلاً کلید واقعی از این نوع‌ها نیست؛ مستقیم روی همان validateValue تست می‌شوند
    const v = registry.validateValue;
    assert.deepEqual(v({ type: 'cron' }, ' */5 * * * * '), { ok: true, value: '*/5 * * * *' });
    ['61 * * * *', 'abc', '', 5].forEach((raw) => assert.equal(v({ type: 'cron' }, raw).ok, false, `cron: ${raw}`));
    assert.equal(v({ type: 'enum', values: ['a', 'b'] }, 'a').ok, true);
    assert.equal(v({ type: 'enum', values: ['a', 'b'] }, 'c').ok, false);
    assert.equal(v({ type: 'string', maxLength: 5 }, ' abc ').value, 'abc');
    assert.equal(v({ type: 'string', maxLength: 5 }, 'abcdef').ok, false);
    assert.equal(v({ type: 'string', minLength: 2 }, 'a').ok, false);
    assert.equal(v({ type: 'string' }, 12).ok, false);
  });

  test('سازگاری با مقادیر موجود DB: مقدار قدیمی معتبر همان می‌ماند، خراب ⇒ پیش‌فرض (نه NaN)', () => {
    db.exec('DELETE FROM settings');
    const put = db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))");
    // مقدارهایی که پنل/نسخه‌های قبلی ذخیره می‌کردند
    put.run('work_day_start', '09:30');
    put.run('work_day_end', '8:00'); // ساعت تک‌رقمی ⇒ نرمال می‌شود
    put.run('late_checkin_grace_minutes', '25');
    put.run('checkout_reminder_minutes_before', 'x'); // خراب ⇒ پیش‌فرض
    put.run('repeated_lateness_threshold', '5');
    put.run('block_on_shared_device', '1');
    put.run('audit_retention_months', '12');
    put.run('audit_archive_enabled', 'zzz'); // خراب ⇒ خاموش
    put.run('job_runs_retention_days', '999999'); // خارج از بازه ⇒ پیش‌فرض
    put.run('global_session_epoch', '7'); // کلید غیر رجیستری دست‌نخورده
    const all = settings.getAll();
    assert.equal(all.workDayStart, '09:30');
    assert.equal(all.workDayEnd, '08:00');
    assert.equal(all.lateCheckinGraceMinutes, 25);
    assert.equal(all.checkoutReminderMinutesBefore, 15);
    assert.equal(all.repeatedLatenessThreshold, 5);
    assert.equal(all.blockOnSharedDevice, true);
    assert.equal(all.auditRetentionMonths, 12);
    assert.equal(all.auditArchiveEnabled, false);
    assert.equal(all.jobRunsRetentionDays, 180);
    assert.equal(all.monitorAlertsRetentionDays, 180);
    Object.values(all).forEach((v) => assert.ok(typeof v !== 'number' || Number.isFinite(v)));
    assert.equal(settings.isBlockOnSharedDeviceEnabled(), true);
    assert.equal(settings.isAuditArchiveEnabled(), false);
    assert.equal(settings.getAuditRetentionMonths(), 12);
    assert.equal(settings.getGlobalSessionEpoch(), 7);
    assert.equal(settings.getCleanupRetention().jobRunsDays, 180);
  });

  test('رفتار update: معتبر ذخیره، نامعتبر/ناشناخته/خالی نادیده، بولی به 1/0، epoch دست‌نخورده', () => {
    db.exec('DELETE FROM settings');
    const stored = (k) => (db.prepare('SELECT value FROM settings WHERE key = ?').get(k) || {}).value;
    const r = settings.update({
      workDayStart: '7:45', workDayEnd: '17:00', lateCheckinGraceMinutes: '10', repeatedLatenessThreshold: 4,
      blockOnSharedDevice: true, hacker: 'x', checkoutReminderMinutesBefore: '',
    });
    assert.equal(r.workDayStart, '07:45');
    assert.equal(stored('work_day_start'), '07:45');
    assert.equal(r.workDayEnd, '17:00');
    assert.equal(r.lateCheckinGraceMinutes, 10);
    assert.equal(stored('late_checkin_grace_minutes'), '10');
    assert.equal(r.repeatedLatenessThreshold, 4);
    assert.equal(stored('block_on_shared_device'), '1');
    assert.equal(r.checkoutReminderMinutesBefore, 15);
    assert.equal(stored('checkout_reminder_minutes_before'), undefined);
    assert.equal(stored('hacker'), undefined);

    // نامعتبرها مقدار قبلی را عوض نمی‌کنند
    const after = settings.update({ workDayStart: '99:99', lateCheckinGraceMinutes: 'abc', auditRetentionMonths: 999, blockOnSharedDevice: 'maybe' });
    assert.equal(after.workDayStart, '07:45');
    assert.equal(after.lateCheckinGraceMinutes, 10);
    assert.equal(after.auditRetentionMonths, 24);
    assert.equal(after.blockOnSharedDevice, true);
    assert.equal(settings.update({ blockOnSharedDevice: 'false' }).blockOnSharedDevice, false);
    assert.equal(stored('block_on_shared_device'), '0');

    // epoch سراسری هنوز از رجیستری بیرون است و از update قابل تغییر نیست
    const e = settings.getGlobalSessionEpoch();
    settings.update({ global_session_epoch: 50, globalSessionEpoch: 50 });
    assert.equal(settings.getGlobalSessionEpoch(), e);
    assert.equal(settings.bumpGlobalSessionEpoch(), e + 1);
    assert.equal(Object.prototype.hasOwnProperty.call(settings.getAll(), 'globalSessionEpoch'), false);
  });

  test('showEarningsCard (Phase 20): بولیِ پیش‌فرض خاموش در گروه performance، با برچسب فارسی؛ ذخیره به 1/0', () => {
    db.exec('DELETE FROM settings');
    const def = registry.getDef('showEarningsCard');
    assert.equal(def.type, 'boolean');
    assert.equal(def.dbKey, 'show_earnings_card');
    assert.equal(def.group, 'performance');
    assert.equal(def.default, false);
    assert.match(def.description, /کارکرد تخمینی ماه/);
    assert.equal(settings.getAll().showEarningsCard, false);
    assert.equal(settings.update({ showEarningsCard: true }).showEarningsCard, true);
    assert.equal(db.prepare('SELECT value FROM settings WHERE key = ?').get('show_earnings_card').value, '1');
    assert.equal(settings.update({ showEarningsCard: false }).showEarningsCard, false);
    assert.equal(db.prepare('SELECT value FROM settings WHERE key = ?').get('show_earnings_card').value, '0');
  });
});

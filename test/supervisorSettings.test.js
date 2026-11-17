// مرحله ۱ (فاز A): گروه «سرپرست‌ها» در تنظیمات — پیش‌فرض‌ها، اعتبارسنجی، انتقال cronها، related و اثر هر کلید روی منطق.
// هیچ‌چیز با پیش‌فرض‌ها تغییر نمی‌کند؛ تست‌های API فقط با express نصب‌شده اجرا می‌شوند.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const registry = require('../src/utils/settingsRegistry');
const settingsRepository = require('../src/repositories/settingsRepository');

// کلید ← [پیش‌فرض، کمینه‌ی مجاز، بیشینه‌ی مجاز] (برای کلیدهای عددی)
const NUMERIC = {
  teamReviewLookbackDays: [60, 7, 365],
  teamReviewCommentMax: [300, 50, 1000],
  supervisorPlanCommentMax: [500, 100, 2000],
  urgentTaskMaxAheadDays: [60, 1, 365],
  missionRejectReasonMin: [3, 0, 50],
  nightlyReviewMaxParts: [3, 1, 10],
  nightlyReviewMaxItemsPerMember: [5, 1, 20],
  nightlyReviewMaxAttentionLines: [25, 5, 100],
  nightlyReviewMaxMissions: [8, 1, 20],
};
const BOOLEANS = ['teamReviewTaskEnabled', 'nightlyReviewSendEnabled', 'morningDigestEnabled', 'supervisorTeamReportEnabled', 'repeatedLatenessAlertSupervisor', 'supervisorDecisionNotifyAdmins'];
const RELATED = ['lateMonthlyLimit', 'lateLimitGateMode', 'lateLimitPermissionTtlMinutes', 'overtimeRequiresApproval', 'leaveApprovalReminderHours', 'allowCheckinWithPendingMission', 'selfUrgentEnabled', 'taskReportAdminMaxParts', 'repeatedLatenessThreshold', 'remoteWorkEnabled', 'remoteWorkMaxOpenHours', 'reportXlsxRecipientRoles'];
const SUPERVISOR_CRONS = ['cronNightlyReview', 'cronMorningDigest', 'cronTeamReviewEnsure'];

describe('تنظیمات سرپرست‌ها — فاز A', () => {
  before(() => { resetDb(); });
  after(() => cleanup());

  test('رجیستری سالم است و گروه «سرپرست‌ها» ثبت شده', () => {
    assert.deepEqual(registry.selfCheck(), []);
    assert.equal(registry.GROUP_LABELS.supervisors, 'سرپرست‌ها');
  });

  test('هر کلید عددی: پیش‌فرض = ثابت قبلی، در بازه معتبر، بیرون بازه نامعتبر', () => {
    const all = settingsRepository.getAll();
    for (const [key, [dflt, min, max]] of Object.entries(NUMERIC)) {
      assert.equal(registry.getDef(key).group, 'supervisors', key);
      assert.equal(all[key], dflt, `پیش‌فرض ${key}`);
      assert.equal(registry.validate(key, min).ok, true, `${key} کمینه`);
      assert.equal(registry.validate(key, max).ok, true, `${key} بیشینه`);
      assert.equal(registry.validate(key, min - 1).ok, false, `${key} زیر کمینه`);
      assert.equal(registry.validate(key, max + 1).ok, false, `${key} بالای بیشینه`);
      assert.equal(registry.validate(key, 'abc').ok, false, `${key} متن`);
      assert.equal(registry.validate(key, 1.5).ok, false, `${key} اعشار`);
    }
  });

  test('هر کلید بولی: پیش‌فرض روشن و فقط بولی پذیرفته می‌شود', () => {
    const all = settingsRepository.getAll();
    for (const key of BOOLEANS) {
      assert.equal(registry.getDef(key).group, 'supervisors', key);
      assert.equal(all[key], true, `پیش‌فرض ${key}`);
      assert.equal(registry.validate(key, false).ok, true);
      assert.equal(registry.validate(key, 'maybe').ok, false);
    }
  });

  test('ذخیره و بازنشانی یک کلید جدید از طریق repository', () => {
    settingsRepository.setValue('nightlyReviewMaxMissions', 12);
    assert.equal(settingsRepository.getAll().nightlyReviewMaxMissions, 12);
    assert.equal(settingsRepository.getItem('nightlyReviewMaxMissions').isDefault, false);
    assert.equal(settingsRepository.resetValue('nightlyReviewMaxMissions'), true);
    assert.equal(settingsRepository.getAll().nightlyReviewMaxMissions, 8);
  });

  test('سه cron سرپرستی به گروه supervisors رفتند و نام Job و پیش‌فرضشان عوض نشده', () => {
    SUPERVISOR_CRONS.forEach((k) => assert.equal(registry.getDef(k).group, 'supervisors', k));
    assert.equal(registry.getDef('cronNightlyReview').job, 'nightlyReview');
    assert.equal(registry.getDef('cronMorningDigest').job, 'morningDigest');
    assert.equal(registry.getDef('cronTeamReviewEnsure').job, 'teamReviewEnsure');
    const all = settingsRepository.getAll();
    assert.equal(all.cronNightlyReview, '0 20 * * *');
    assert.equal(all.cronMorningDigest, '0 8 * * *');
    assert.equal(all.cronTeamReviewEnsure, '10 0 * * *');
    // بقیه‌ی cronها در گروه schedule مانده‌اند
    assert.equal(registry.getDef('cronDailyReport').group, 'schedule');
    assert.equal(registry.cronJobs().length, 18, 'تعداد jobها بدون تغییر');
  });

  test('کلیدهای «زمینه» گروه اصلی‌شان را نگه داشته‌اند و related دارند؛ getItems آن را برمی‌گرداند', () => {
    const items = new Map(settingsRepository.getItems().map((i) => [i.key, i]));
    const groupBefore = { lateMonthlyLimit: 'workHours', overtimeRequiresApproval: 'overtime', leaveApprovalReminderHours: 'leave', selfUrgentEnabled: 'planning', repeatedLatenessThreshold: 'reminders', remoteWorkEnabled: 'security', reportXlsxRecipientRoles: 'reportDelivery' };
    for (const k of RELATED) {
      assert.deepEqual(items.get(k).related, ['supervisors'], `related ${k}`);
      assert.notEqual(items.get(k).group, 'supervisors', `${k} جابه‌جا نشده`);
    }
    for (const [k, g] of Object.entries(groupBefore)) assert.equal(items.get(k).group, g, k);
    // کلیدهای دیگر related ندارند
    assert.equal('related' in items.get('workDayStart'), false);
    assert.equal('related' in items.get('teamReviewLookbackDays'), false);
  });
});

describe('تنظیمات سرپرست‌ها — اثر روی منطق', () => {
  before(() => { resetDb(); });
  after(() => cleanup());

  test('urgentTaskService.maxAheadDays: پیش‌فرض ۶۰ و مقدار تنظیم را می‌خواند', () => {
    const svc = require('../src/services/urgentTaskService');
    assert.equal(svc.maxAheadDays(settingsRepository.getAll()), 60);
    assert.equal(svc.maxAheadDays({ urgentTaskMaxAheadDays: 10 }), 10);
    assert.equal(svc.maxAheadDays({}), 60);
  });

  test('missionDecisionService.rejectMission: حداقل نویسه‌ی علت از تنظیم می‌آید', () => {
    const svc = require('../src/services/missionDecisionService');
    const { makeUser } = require('./helpers/factories');
    const manager = makeUser({ role: 'manager' });
    assert.equal(svc.rejectReasonMin(), 3);
    settingsRepository.setValue('missionRejectReasonMin', 10);
    assert.equal(svc.rejectReasonMin(), 10);
    const r = svc.rejectMission({ requestId: 999999, actor: manager, reason: 'کوتاه' });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'REASON_REQUIRED');
    assert.match(r.error, /10/);
    settingsRepository.resetValue('missionRejectReasonMin');
    assert.equal(svc.rejectReasonMin(), 3);
  });

  test('teamReviewService: getterها از تنظیم می‌خوانند و ثابت‌های پیش‌فرض صادر می‌مانند', () => {
    const svc = require('../src/services/teamReviewService');
    assert.equal(svc.COMMENT_MAX, 300);
    assert.equal(svc.MAX_LOOKBACK_DAYS, 60);
    assert.equal(svc.commentMax(), 300);
    assert.equal(svc.lookbackDays(), 60);
    settingsRepository.setValue('teamReviewCommentMax', 120);
    settingsRepository.setValue('teamReviewLookbackDays', 14);
    assert.equal(svc.commentMax(), 120);
    assert.equal(svc.lookbackDays(), 14);
    settingsRepository.resetValue('teamReviewCommentMax');
    settingsRepository.resetValue('teamReviewLookbackDays');
  });

  test('teamReviewService.markReviewed: سقف کامنت و بازه‌ی مشاهده طبق تنظیم اعمال می‌شود', () => {
    const svc = require('../src/services/teamReviewService');
    const attendanceRepository = require('../src/repositories/attendanceRepository');
    const { addDays } = require('../src/utils/shiftDay');
    const { makeUser } = require('./helpers/factories');
    const manager = makeUser({ role: 'manager' });
    const member = makeUser({ role: 'employee', managerId: manager.id });
    const now = new Date();
    const cur = attendanceRepository.currentRecordDate(manager.id, now);

    settingsRepository.setValue('teamReviewCommentMax', 50);
    const tooLong = svc.markReviewed(manager, { subjectUserId: member.id, reportDate: cur, comment: 'ا'.repeat(51) }, { now });
    assert.equal(tooLong.ok, false);
    assert.equal(tooLong.code, 'COMMENT_TOO_LONG');
    assert.match(tooLong.error, /50/);
    settingsRepository.resetValue('teamReviewCommentMax');

    settingsRepository.setValue('teamReviewLookbackDays', 7);
    const old = svc.markReviewed(manager, { subjectUserId: member.id, reportDate: addDays(cur, -8) }, { now });
    assert.equal(old.ok, false);
    assert.equal(old.code, 'DATE_TOO_OLD');
    settingsRepository.resetValue('teamReviewLookbackDays');
  });

  test('teamReviewService.ensureTask: با تنظیم خاموش تسک تازه ساخته نمی‌شود', () => {
    const svc = require('../src/services/teamReviewService');
    const { makeUser } = require('./helpers/factories');
    const { workdayDate } = require('./helpers/factories');
    const manager = makeUser({ role: 'manager' });
    makeUser({ role: 'employee', managerId: manager.id });
    const settings = { ...settingsRepository.getAll(), teamReviewTaskEnabled: false };
    assert.equal(svc.ensureTask(manager, workdayDate(3), settings), null);
  });

  test('nightlyTaskReportService.memberBlock: سقف تسک هر عضو قابل تنظیم است', () => {
    const svc = require('../src/services/nightlyTaskReportService');
    const pending = Array.from({ length: 8 }, (_, i) => ({ title: `تسک ${i + 1}`, priority: 'normal', isUrgent: false }));
    const report = { member: { id: 1, full_name: 'علی' }, total: 8, done: 0, percent: 0, noStatus: true, pendingCount: 8, notDone: [], dropped: [], pending, extra: 0, noteCount: 0, stillOpen: false, planMissing: false, tally: {} };
    const dflt = svc.memberBlock(report, []);
    assert.match(dflt, /… و 3 مورد دیگر/, 'پیش‌فرض ۵');
    const two = svc.memberBlock(report, [], { maxItems: 2 });
    assert.match(two, /… و 6 مورد دیگر/);
    assert.equal(two.includes('تسک 3'), false);
  });

  test('nightlyTaskReportService.pack: سقف پیام سرپرست از ثابت پیش‌فرض ۳ می‌آید', () => {
    const svc = require('../src/services/nightlyTaskReportService');
    assert.equal(svc.MAX_PARTS, 3);
    const big = Array.from({ length: 200 }, (_, i) => `• عضو ${i} ${'ت'.repeat(150)}`);
    assert.ok(svc.pack('عنوان', big, []).parts.length <= 3);
    assert.ok(svc.pack('عنوان', big, [], { maxParts: 1 }).parts.length === 1);
  });
});

// ---------- API (نیازمند express) ----------
let hasDeps = true;
try { require.resolve('express'); } catch (_) { hasDeps = false; }

describe('API تنظیمات سرپرست‌ها — فاز A', { skip: hasDeps ? false : 'express نصب نیست (npm install)' }, () => {
  let server; let base; let db; let cookies;
  before(async () => {
    db = resetDb();
    const { makeUser, sessionCookie } = require('./helpers/factories');
    const { createApp } = require('../src/server');
    const admin = makeUser({ role: 'admin' });
    const manager = makeUser({ role: 'manager' });
    cookies = { admin: sessionCookie(admin.id), manager: sessionCookie(manager.id) };
    server = createApp().listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => { if (server) server.close(); cleanup(); });

  async function hit(role, method, url, body) {
    const headers = { 'content-type': 'application/json', 'x-requested-with': 'AttendancePanel', cookie: cookies[role] };
    const res = await fetch(base + url, { method, headers, body: body && method !== 'GET' ? JSON.stringify(body) : undefined });
    let json = null;
    try { json = await res.json(); } catch (_) { /* بدنه خالی */ }
    return { status: res.status, json };
  }

  test('GET items: گروه supervisors، related و جابه‌جایی cronها', async () => {
    const r = await hit('admin', 'GET', '/api/admin/settings/items');
    assert.equal(r.status, 200);
    assert.equal(r.json.groups.supervisors, 'سرپرست‌ها');
    const byKey = Object.fromEntries(r.json.items.map((i) => [i.key, i]));
    assert.equal(byKey.cronNightlyReview.group, 'supervisors');
    assert.deepEqual(byKey.lateMonthlyLimit.related, ['supervisors']);
    assert.equal(byKey.lateMonthlyLimit.group, 'workHours');
    assert.equal(byKey.nightlyReviewMaxParts.value, 3);
  });

  test('PUT: دلیل اجباری، بیرون بازه ۴۰۰، معتبر ⇒ ذخیره + audit؛ manager ⇒ ۴۰۳', async () => {
    const url = '/api/admin/settings/teamReviewCommentMax';
    assert.equal((await hit('admin', 'PUT', url, { value: 200 })).status, 400, 'بدون دلیل');
    assert.equal((await hit('admin', 'PUT', url, { value: 10, reason: 'تست' })).status, 400, 'زیر بازه');
    assert.equal((await hit('admin', 'PUT', url, { value: 5000, reason: 'تست' })).status, 400, 'بالای بازه');
    const ok = await hit('admin', 'PUT', url, { value: 200, reason: 'تست فاز A' });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.item.value, 200);
    const row = db.prepare("SELECT * FROM audit_log WHERE action = 'settings_updated' ORDER BY id DESC LIMIT 1").get();
    assert.ok(row, 'audit ثبت شد');
    assert.equal((await hit('manager', 'PUT', url, { value: 250, reason: 'تست' })).status, 403);
    assert.equal(settingsRepository.getAll().teamReviewCommentMax, 200, 'تلاش manager اثری نداشت');
  });
});

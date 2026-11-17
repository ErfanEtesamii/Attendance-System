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


// ---------- فاز C: مدیریت سرپرست‌ها و تیم‌ها (مرحله ۴) ----------
describe('API مدیریت سرپرست‌ها و تیم‌ها — فاز C', { skip: hasDeps ? false : 'express نصب نیست (npm install)' }, () => {
  let server; let base; let db; let cookies; let u; let teamReview;
  const mk = (...a) => require('./helpers/factories').makeUser(...a);
  before(async () => {
    db = resetDb();
    const { sessionCookie } = require('./helpers/factories');
    const { createApp } = require('../src/server');
    teamReview = require('../src/services/teamReviewService');
    u = {
      admin: mk({ role: 'admin' }), owner: mk({ role: 'owner' }), hr: mk({ role: 'hr' }), employee: mk({ role: 'employee' }),
      sup1: mk({ role: 'manager', name: 'سرپرست یک' }), sup2: mk({ role: 'manager', name: 'سرپرست دو' }), supOff: mk({ role: 'manager', active: false }),
    };
    u.e1 = mk({ managerId: u.sup1.id }); u.e2 = mk({ managerId: u.sup1.id }); u.e3 = mk({ managerId: null });
    cookies = { admin: sessionCookie(u.admin.id), owner: sessionCookie(u.owner.id), manager: sessionCookie(u.sup1.id), hr: sessionCookie(u.hr.id), employee: sessionCookie(u.employee.id) };
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
  const mgr = (id) => db.prepare('SELECT manager_id FROM users WHERE id = ?').get(id).manager_id;
  const auditRows = (action) => db.prepare('SELECT * FROM audit_log WHERE action = ?').all(action);

  test('دسترسی: فقط admin/owner؛ manager/hr/employee ⇒ ۴۰۳ روی هر چهار route', async () => {
    for (const role of ['manager', 'hr', 'employee']) {
      for (const [m, url] of [['GET', '/api/admin/supervisors'], ['GET', `/api/admin/supervisors/${u.sup1.id}`], ['POST', `/api/admin/supervisors/${u.sup1.id}/members`], ['POST', `/api/admin/supervisors/${u.sup1.id}/transfer`]]) {
        assert.equal((await hit(role, m, url, { userIds: [u.e3.id], reason: 'x' })).status, 403, `${role} ${m} ${url}`);
      }
    }
    assert.equal((await hit('owner', 'GET', '/api/admin/supervisors')).status, 200);
    const perms = require('../src/middleware/permissions');
    assert.ok(perms.hasPermission('admin', 'supervisors.manage') && perms.hasPermission('owner', 'supervisors.manage'));
    for (const r of ['manager', 'hr', 'employee']) assert.ok(!perms.hasPermission(r, 'supervisors.manage'), r);
  });

  test('فهرست: سرپرست‌ها با شمارش اعضا و بدون owner؛ کارمندان بدون سرپرست جدا (نه سرپرست/ادمین)', async () => {
    const r = await hit('admin', 'GET', '/api/admin/supervisors');
    assert.equal(r.status, 200);
    const by = Object.fromEntries(r.json.supervisors.map((s) => [s.id, s]));
    assert.equal(by[u.sup1.id].totalMembers, 2);
    assert.equal(by[u.sup1.id].activeMembers, 2);
    assert.equal(by[u.sup2.id].totalMembers, 0);
    assert.equal(by[u.supOff.id].isActive, false);
    assert.ok(!(u.owner.id in by), 'owner در فهرست نیست');
    assert.ok(!('hourlyRateKt' in by[u.sup1.id]) && !JSON.stringify(r.json).includes('hourly'), 'نرخ ساعتی درز نمی‌کند');
    const unIds = r.json.unassigned.users.map((x) => x.id);
    assert.ok(unIds.includes(u.e3.id) && !unIds.includes(u.sup1.id) && !unIds.includes(u.owner.id));
    assert.equal(r.json.unassigned.count, r.json.unassigned.users.length);
  });

  test('ادمین دارای زیردست هم در فهرست می‌آید (با برچسب)', async () => {
    const e = mk({ managerId: u.admin.id });
    const r = await hit('admin', 'GET', '/api/admin/supervisors');
    const a = r.json.supervisors.find((s) => s.id === u.admin.id);
    assert.ok(a && a.totalMembers >= 1 && a.label === 'ادمین دارای تیم');
    assert.equal(e.manager_id, u.admin.id);
  });

  test('GET :id اعضای تیم؛ ناموجود ⇒ ۴۰۴', async () => {
    const r = await hit('admin', 'GET', `/api/admin/supervisors/${u.sup1.id}`);
    assert.deepEqual(r.json.members.map((m) => m.id).sort(), [u.e1.id, u.e2.id].sort());
    assert.equal((await hit('admin', 'GET', '/api/admin/supervisors/999999')).status, 404);
  });

  test('افزودن عضو: دلیل اجباری؛ dryRun چیزی نمی‌نویسد؛ موفق ⇒ manager_id + audit + refresh تسک واجب', async () => {
    const url = `/api/admin/supervisors/${u.sup2.id}/members`;
    assert.equal((await hit('admin', 'POST', url, { userIds: [u.e3.id] })).status, 400, 'بدون دلیل');
    assert.equal(mgr(u.e3.id), null);
    const dry = await hit('admin', 'POST', url, { userIds: [u.e3.id, u.e1.id], dryRun: true });
    assert.equal(dry.status, 200);
    assert.equal(dry.json.dryRun, true);
    assert.equal(dry.json.count, 2);
    assert.equal(typeof dry.json.pendingRequests, 'number');
    assert.equal(mgr(u.e3.id), null, 'dryRun ننوشت');

    const calls = [];
    const orig = teamReview.refreshReviewersOf;
    teamReview.refreshReviewersOf = (ids) => { calls.push(ids); return orig(ids); };
    try {
      const before = auditRows('supervisor_members_added').length;
      const ok = await hit('admin', 'POST', url, { userIds: [u.e3.id, u.e1.id], reason: 'جابه‌جایی تست' });
      assert.equal(ok.status, 200);
      assert.equal(ok.json.moved, 2);
      assert.equal(mgr(u.e3.id), u.sup2.id);
      assert.equal(mgr(u.e1.id), u.sup2.id);
      assert.equal(auditRows('supervisor_members_added').length, before + 2);
      const d = JSON.parse(auditRows('supervisor_members_added').pop().details);
      assert.equal(d.entityType, 'supervisor');
      assert.equal(d.reason, 'جابه‌جایی تست');
      assert.ok(calls.length === 1 && [u.sup2.id, u.sup1.id, u.e3.id, u.e1.id].every((id) => calls[0].includes(id)), 'refresh برای قدیم/جدید/کاربر');
    } finally { teamReview.refreshReviewersOf = orig; }
  });

  test('اعتبارسنجی افزودن: خودش، owner، سرپرست غیرفعال/کارمند، حلقه، ناموجود', async () => {
    const url = (id) => `/api/admin/supervisors/${id}/members`;
    assert.equal((await hit('admin', 'POST', url(u.sup1.id), { userIds: [u.sup1.id], reason: 'x' })).status, 400, 'خودش');
    assert.equal((await hit('admin', 'POST', url(u.sup1.id), { userIds: [u.owner.id], reason: 'x' })).status, 400, 'owner عضو نمی‌شود');
    assert.equal((await hit('admin', 'POST', url(u.supOff.id), { userIds: [u.e2.id], reason: 'x' })).status, 400, 'سرپرست غیرفعال');
    assert.equal((await hit('admin', 'POST', url(u.employee.id), { userIds: [u.e2.id], reason: 'x' })).status, 400, 'هدف کارمند');
    assert.equal((await hit('admin', 'POST', url(u.sup1.id), { userIds: [999999], reason: 'x' })).status, 404);
    assert.equal((await hit('admin', 'POST', url(u.sup1.id), { userIds: [], reason: 'x' })).status, 400);
    assert.equal((await hit('admin', 'POST', url(u.sup1.id), { reason: 'x' })).status, 400);
    // حلقه: sup1 زیردست sup2 می‌شود؛ سپس sup2 نمی‌تواند زیردست sup1 شود
    assert.equal((await hit('admin', 'POST', url(u.sup2.id), { userIds: [u.sup1.id], reason: 'x' })).status, 200);
    const loop = await hit('admin', 'POST', url(u.sup1.id), { userIds: [u.sup2.id], reason: 'x' });
    assert.equal(loop.status, 400);
    assert.match(loop.json.error, /حلقه/);
    assert.equal(mgr(u.sup2.id), null);
    await hit('admin', 'POST', url(u.sup2.id), { userIds: [u.sup1.id], dryRun: true });
    db.prepare('UPDATE users SET manager_id = NULL WHERE id = ?').run(u.sup1.id); // پاکسازی برای تست‌های بعد
  });

  test('جابه‌جایی ادمین فقط با owner (admins.manage)', async () => {
    const adm2 = mk({ role: 'admin' });
    const url = `/api/admin/supervisors/${u.sup1.id}/members`;
    assert.equal((await hit('admin', 'POST', url, { userIds: [adm2.id], reason: 'x' })).status, 403);
    assert.equal((await hit('owner', 'POST', url, { userIds: [adm2.id] })).status, 200, 'owner بدون دلیل هم مجاز است');
    assert.equal(mgr(adm2.id), u.sup1.id);
  });

  test('انتقال گروهی: all، انتخابی، null، مقصد نامعتبر، دلیل اجباری، audit', async () => {
    const url = `/api/admin/supervisors/${u.sup2.id}/transfer`;
    const team2 = db.prepare('SELECT id FROM users WHERE manager_id = ?').all(u.sup2.id).map((r) => r.id);
    assert.ok(team2.length >= 2);
    assert.equal((await hit('admin', 'POST', url, { toSupervisorId: u.sup1.id, all: true })).status, 400, 'بدون دلیل');
    assert.equal((await hit('admin', 'POST', url, { all: true, reason: 'x' })).status, 400, 'مقصد مشخص نیست');
    assert.equal((await hit('admin', 'POST', url, { toSupervisorId: u.sup2.id, all: true, reason: 'x' })).status, 400, 'مقصد = مبدأ');
    assert.equal((await hit('admin', 'POST', url, { toSupervisorId: u.supOff.id, all: true, reason: 'x' })).status, 400, 'مقصد غیرفعال');
    assert.equal((await hit('admin', 'POST', url, { toSupervisorId: u.sup1.id, userIds: [u.e2.id], reason: 'x' })).status, 400, 'عضو تیم مبدأ نیست');
    const dry = await hit('admin', 'POST', url, { toSupervisorId: u.sup1.id, all: true, dryRun: true });
    assert.equal(dry.json.count, team2.length);
    assert.equal(team2.every((id) => mgr(id) === u.sup2.id), true, 'dryRun ننوشت');

    const part = await hit('admin', 'POST', url, { toSupervisorId: u.sup1.id, userIds: [team2[0]], reason: 'انتقال بخشی' });
    assert.equal(part.json.moved, 1);
    assert.equal(mgr(team2[0]), u.sup1.id);
    const all = await hit('admin', 'POST', url, { toSupervisorId: null, all: true, reason: 'استعفا' });
    assert.equal(all.status, 200);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM users WHERE manager_id = ?').get(u.sup2.id).n, 0);
    const moved = team2.slice(1);
    assert.ok(moved.every((id) => mgr(id) === null), 'null ⇒ بدون سرپرست');
    const rows = auditRows('supervisor_team_transferred');
    assert.ok(rows.length >= team2.length);
    const d = JSON.parse(rows[rows.length - 1].details);
    assert.equal(d.entityType, 'supervisor');
    assert.equal(d.reason, 'استعفا');
  });

  test('درخواست در انتظارِ کارمند منتقل‌شده به سرپرست جدید می‌رود (مجوز از manager_id زنده)', async () => {
    const { workdayDate } = require('./helpers/factories');
    const leaveRepository = require('../src/repositories/leaveRepository');
    const emp = mk({ managerId: u.sup1.id });
    leaveRepository.createLeaveRequest({ userId: emp.id, startDate: workdayDate(40), endDate: workdayDate(40), leaveType: 'leave', reason: 'تست' });
    const dry = await hit('admin', 'POST', `/api/admin/supervisors/${u.sup1.id}/transfer`, { toSupervisorId: u.sup2.id, userIds: [emp.id], dryRun: true });
    assert.equal(dry.json.pendingRequests, 1);
    await hit('admin', 'POST', `/api/admin/supervisors/${u.sup1.id}/transfer`, { toSupervisorId: u.sup2.id, userIds: [emp.id], reason: 'تست' });
    const list = (await hit('admin', 'GET', '/api/admin/supervisors')).json.supervisors;
    assert.equal(list.find((s) => s.id === u.sup2.id).pendingRequests, 1);
    assert.equal(list.find((s) => s.id === u.sup1.id).pendingRequests, 0);
  });
});

// ---------- فاز C: فرانت (بدون مرورگر) ----------
describe('پنل سرپرست‌ها در تنظیمات — فاز C (فرانت)', () => {
  const fs = require('fs');
  const path = require('path');
  const vm = require('vm');
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'public-admin', 'js', f), 'utf8');
  const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  function loadPanel(perms = ['supervisors.manage']) {
    const AP = {
      state: { perms: new Set(perms), me: { id: 1, role: 'admin' } }, esc, $: () => null, $$: () => [],
      fmt: { num: (n) => String(n), dateTime: (d) => String(d) },
      icon: () => '', badge: (cls, text) => `<span class="badge ${cls}">${esc(text)}</span>`,
      can: (...p) => p.every((x) => AP.state.perms.has(x)), isOwnerMe: () => false,
    };
    vm.runInNewContext(read('supervisors-panel.js'), { window: { AP }, document: {}, console });
    return AP;
  }

  test('کامپوننت ثبت می‌شود و html پنل نقطه‌ی اتصال امن دارد', () => {
    const AP = loadPanel();
    assert.ok(AP.supervisorsPanel && typeof AP.supervisorsPanel.mount === 'function');
    assert.match(AP.supervisorsPanel.html(), /data-sup-panel/);
  });

  test('views-admin: پنل فقط با مجوز supervisors.manage و فقط در گروه supervisors و بعد از repaint دوباره mount می‌شود', () => {
    const src = read('views-admin.js');
    assert.match(src, /g === 'supervisors' && AP\.supervisorsPanel && AP\.can\('supervisors\.manage'\)/);
    assert.match(src, /if \(g === 'supervisors'\) mountSupervisors\(\)/);
    assert.match(src, /supervisor: 'سرپرست\/تیم'/, 'فیلتر ممیزی');
    assert.match(fs.readFileSync(path.join(__dirname, '..', 'public-admin', 'index.html'), 'utf8'), /supervisors-panel\.js/);
  });

  test('پنل: داده‌ی کاربر با esc وارد DOM می‌شود و innerHTML خام ندارد', () => {
    const src = read('supervisors-panel.js');
    assert.doesNotMatch(src, /[>"=]\s*\$\{[a-z]+\.(fullName|department|supName|fromSupervisor)\}/, 'داده‌ی کاربر داخل HTML بدون esc (title/message مودال‌ها داخل AP.modal/askReason esc می‌شوند)');
    assert.match(src, /dryRun: true/, 'پیش‌نمایش');
    assert.match(src, /AP\.askReason/, 'دلیل');
  });
});

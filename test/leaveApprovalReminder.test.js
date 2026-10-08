// S4-11c: Job یادآوری/ارجاع تأیید مرخصی — خاموش پیش‌فرض، یادآوری بعد از T، ارجاع بعد از E، ارجاع فوری وقتی سرپرست مرخصی است،
// مرحله‌ی admin/hr فقط یادآوری، بدون هیچ تصمیم خودکار. زمان با now تزریقی (نسبت به ساعت واقعی).
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

describe('Job یادآوری/ارجاع تأیید مرخصی (S4-11c)', () => {
  let db; let F; let annual; let leaveService; let approvals; let settingsRepo; let leaveRepo; let run; let todayInZone; let admin; let admin2; let hr;
  const H = 3600000;
  before(() => {
    db = resetDb();
    F = require('./helpers/factories');
    annual = require('../src/repositories/leaveTypesRepository').findByCode('annual');
    leaveService = require('../src/services/leaveService');
    approvals = require('../src/services/leaveApprovalService');
    settingsRepo = require('../src/repositories/settingsRepository');
    leaveRepo = require('../src/repositories/leaveRepository');
    ({ runLeaveApprovalReminder: run } = require('../src/bot/scheduler/leaveApprovalReminder'));
    ({ todayInZone } = require('../src/utils/time'));
    admin = F.makeUser({ role: 'admin' });
    admin2 = F.makeUser({ role: 'admin' });
    hr = F.makeUser({ role: 'hr' });
  });
  after(() => cleanup());

  const reset = () => ['leaveApprovalReminderHours', 'leaveApprovalEscalateHours', 'leaveEscalateWhenApproverOnLeave', 'leaveApprovalExtraStepTypes', 'leaveApprovalExtraStepRole'].forEach((k) => settingsRepo.resetValue(k));
  let n = 0;
  const scenario = ({ keep = false } = {}) => {
    reset();
    if (!keep) db.exec('DELETE FROM notifications; DELETE FROM leave_approvals; DELETE FROM leave_requests;'); // Job همه‌ی pendingها را می‌بیند؛ هر تست از صفر
    n += 1;
    const manager = F.makeUser({ role: 'manager' });
    const emp = F.makeUser({ managerId: manager.id });
    const dt = new Date(Date.UTC(2028, 0, 1 + n * 10));
    if (dt.getUTCDay() === 5) dt.setUTCDate(dt.getUTCDate() + 1); // جمعه تعطیل است
    const d = dt.toISOString().slice(0, 10);
    const r = leaveService.create({ userId: emp.id, leaveTypeId: annual.id, startDate: d, endDate: d });
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    return { manager, emp, request: r.request };
  };
  const at = (hours) => new Date(Date.now() + hours * H);
  const notes = (userId, requestId, extra) => db.prepare("SELECT * FROM notifications WHERE user_id = ? AND type = 'leave_requested'").all(userId).filter((x) => x.data.includes(`"requestId":${requestId}`) && (!extra || x.data.includes(extra)));
  const audits = (id) => db.prepare("SELECT * FROM audit_log WHERE action = 'leave_request_escalated' AND details LIKE ?").all(`%"entityId":${id}%`).length;

  test('همه‌ی تنظیمات خاموش (پیش‌فرض) ⇒ skipped و هیچ اعلانی؛ فقط زمان‌بندی ثبت است', async () => {
    const { manager, request } = scenario();
    assert.deepEqual(await run({ now: at(500) }), { checked: 0, reminded: 0, escalated: 0, errors: 0, skipped: true });
    assert.equal(notes(manager.id, request.id, '"reminder":true').length, 0);
    assert.ok(require('../src/bot/scheduler').jobNames().includes('leaveApprovalReminder'));
  });

  test('یادآوری بعد از T ساعت: قبل از T نه؛ بعد از T یک بار (dedupe)؛ هیچ تصمیم خودکاری نمی‌گیرد', async () => {
    const { manager, request } = scenario();
    settingsRepo.setValue('leaveApprovalReminderHours', 24);
    let r = await run({ now: at(23) });
    assert.equal(r.reminded, 0);
    r = await run({ now: at(25) });
    assert.equal(r.reminded, 1);
    const got = notes(manager.id, request.id, '"reminder":true');
    assert.equal(got.length, 1);
    assert.match(got[0].title, /یادآوری/);
    assert.equal((await run({ now: at(26) })).reminded, 0, 'یک بار برای هر مرحله');
    const after = leaveRepo.findById(request.id);
    assert.deepEqual([after.status, after.current_step], ['pending', 1]);
    assert.equal(approvals.getChain(request.id)[0].approverRole, 'manager', 'بدون E ارجاعی نیست');
  });

  test('ارجاع به admin: E ساعت بعد از یادآوری؛ نقش مرحله admin می‌شود، admin‌ها اعلان می‌گیرند، سرپرست دیگر نمی‌تواند، audit ثبت می‌شود', async () => {
    const { manager, request } = scenario();
    settingsRepo.setValue('leaveApprovalReminderHours', 24);
    settingsRepo.setValue('leaveApprovalEscalateHours', 12);
    const remindAt = at(25);
    await run({ now: remindAt });
    // ساعت واقعی به‌جای زمان شبیه‌سازی‌شده ثبت شده؛ زمان اعلان یادآوری را به لحظه‌ی شبیه‌سازی‌شده می‌بریم
    db.prepare("UPDATE notifications SET created_at = ? WHERE dedupe_key = ?").run(remindAt.toISOString(), `leave_reminder:${request.id}:1`);
    assert.equal((await run({ now: at(30) })).escalated, 0, 'هنوز E نگذشته');
    const r = await run({ now: at(25 + 13) });
    assert.equal(r.escalated, 1);
    assert.equal(approvals.getChain(request.id)[0].approverRole, 'admin');
    assert.equal(approvals.awaitingRole(leaveRepo.findById(request.id)), 'admin');
    for (const a of [admin, admin2]) assert.equal(notes(a.id, request.id, '"escalated":true').length, 1, `admin ${a.id}`);
    assert.equal(audits(request.id), 1);
    assert.equal((await run({ now: at(60) })).escalated, 0, 'ارجاع دوباره ندارد');
    assert.equal(approvals.decide({ requestId: request.id, actor: manager, decision: 'approve' }).code, 'FORBIDDEN');
    assert.equal(approvals.decide({ requestId: request.id, actor: admin, decision: 'approve' }).finalStatus, 'approved');
  });

  test('سرپرست در مرخصی تأییدشده‌ی امروز: با تنظیم روشن فوراً ارجاع؛ خاموش یا مرخصی ساعتی ⇒ نه', async () => {
    const s = scenario();
    const today = todayInZone(settingsRepo.getAll().timezone, new Date());
    const leave = leaveRepo.createLeaveRequest({ userId: s.manager.id, startDate: today, endDate: today, leaveType: 'leave' });
    leaveRepo.setStatus(leave.id, 'approved', admin.id);
    assert.equal((await run({ now: new Date() })).skipped, true, 'همه‌ی تنظیمات خاموش');
    settingsRepo.setValue('leaveApprovalReminderHours', 1000); // فقط برای اینکه Job اجرا شود
    assert.equal((await run({ now: new Date() })).escalated, 0, 'قاعده‌ی مرخصی خاموش');
    settingsRepo.setValue('leaveEscalateWhenApproverOnLeave', true);
    assert.equal((await run({ now: new Date() })).escalated, 1);
    assert.equal(approvals.awaitingRole(leaveRepo.findById(s.request.id)), 'admin');
    assert.match(notes(admin.id, s.request.id, '"escalated":true')[0].body, /مرخصی/);

    const hourly = scenario();
    const h = leaveRepo.createLeaveRequest({ userId: hourly.manager.id, startDate: today, endDate: today, leaveType: 'leave', unit: 'hour', startTime: '10:00', endTime: '11:00', durationMinutes: 60 });
    leaveRepo.setStatus(h.id, 'approved', admin.id);
    settingsRepo.setValue('leaveEscalateWhenApproverOnLeave', true);
    assert.equal((await run({ now: new Date() })).escalated, 0, 'مرخصی ساعتی یعنی در دسترس');
  });

  test('مرحله‌ی admin/hr: فقط یادآوری به همان نقش بعد از T از زمان تأیید مرحله‌ی قبل؛ ارجاع ندارد', async () => {
    const s = scenario();
    settingsRepo.setValue('leaveApprovalExtraStepTypes', 'annual');
    settingsRepo.setValue('leaveApprovalExtraStepRole', 'hr');
    settingsRepo.setValue('leaveApprovalReminderHours', 10);
    settingsRepo.setValue('leaveApprovalEscalateHours', 1);
    const second = leaveService.create({ userId: s.emp.id, leaveTypeId: annual.id, startDate: '2029-05-05', endDate: '2029-05-05' }).request;
    approvals.decide({ requestId: second.id, actor: s.manager, decision: 'approve' }); // مرحله‌ی ۲ = hr از همین لحظه
    assert.equal((await run({ now: at(5) })).reminded, 0);
    const r = await run({ now: at(11) });
    assert.ok(r.reminded >= 1);
    assert.equal(notes(hr.id, second.id, '"reminder":true').length, 1);
    assert.equal(notes(admin.id, second.id, '"reminder":true').length, 0);
    await run({ now: at(50) }); // مرحله‌ی ۱ درخواست اول (سرپرست) ممکن است ارجاع شود؛ مرحله‌ی hr هرگز
    assert.equal(approvals.getChain(second.id)[1].approverRole, 'hr');
    assert.equal(leaveRepo.findById(second.id).current_step, 2);
  });

  test('درخواست بدون زنجیره (قدیمی) و درخواست نهایی‌شده نادیده گرفته می‌شود؛ خطای یک درخواست بقیه را نمی‌شکند', async () => {
    const s = scenario();
    settingsRepo.setValue('leaveApprovalReminderHours', 1);
    const legacy = leaveRepo.createLeaveRequest({ userId: s.emp.id, startDate: '2030-06-06', endDate: '2030-06-06', leaveType: 'leave' });
    assert.equal(legacy.current_step, null);
    approvals.decide({ requestId: s.request.id, actor: s.manager, decision: 'approve' });
    const r = await run({ now: at(100) });
    assert.equal(r.checked, 0);
    assert.equal(notes(s.manager.id, legacy.id).length, 0);
    // درخواست جدید + کاربر خراب‌شده ⇒ خطا شمرده می‌شود، Job نمی‌پرد
    const bad = scenario({ keep: true });
    db.prepare('UPDATE leave_requests SET created_at = ? WHERE id = ?').run('خراب', bad.request.id);
    const ok = scenario({ keep: true });
    settingsRepo.setValue('leaveApprovalReminderHours', 1); // scenario تنظیمات را به پیش‌فرض برمی‌گرداند
    const res = await run({ now: at(100) });
    assert.equal(res.errors, 0);
    assert.ok(res.reminded >= 1, 'created_at خراب ⇒ سن ۰ (یادآوری نه)، بقیه یادآوری می‌شوند');
    assert.equal(notes(ok.manager.id, ok.request.id, '"reminder":true').length, 1);
  });
});

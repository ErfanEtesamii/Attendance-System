// Job یادآوری تأیید مرخصی — خاموش پیش‌فرض، یادآوری بعد از T ساعت به سرپرست + ادمین‌ها (یک بار)، بدون ارجاع خودکار به ادمین
// و بدون هیچ تصمیم خودکار. زمان با now تزریقی (نسبت به ساعت واقعی).
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

describe('Job یادآوری تأیید مرخصی', () => {
  let db; let F; let annual; let leaveService; let approvals; let settingsRepo; let leaveRepo; let run; let admin; let admin2;
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
    admin = F.makeUser({ role: 'admin' });
    admin2 = F.makeUser({ role: 'admin' });
  });
  after(() => cleanup());

  const reset = () => ['leaveApprovalReminderHours'].forEach((k) => settingsRepo.resetValue(k));
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

  test('تنظیم خاموش (پیش‌فرض) ⇒ skipped و هیچ اعلانی؛ فقط زمان‌بندی ثبت است', async () => {
    const { manager, request } = scenario();
    assert.deepEqual(await run({ now: at(500) }), { checked: 0, reminded: 0, errors: 0, skipped: true });
    assert.equal(notes(manager.id, request.id, '"reminder":true').length, 0);
    assert.ok(require('../src/bot/scheduler').jobNames().includes('leaveApprovalReminder'));
  });

  test('یادآوری بعد از T ساعت: قبل از T نه؛ بعد از T یک بار (dedupe) برای سرپرست و هر دو ادمین؛ هیچ تصمیم یا ارجاعی نیست', async () => {
    const { manager, emp, request } = scenario();
    settingsRepo.setValue('leaveApprovalReminderHours', 24);
    let r = await run({ now: at(23) });
    assert.equal(r.reminded, 0);
    r = await run({ now: at(25) });
    assert.equal(r.reminded, 1);
    for (const u of [manager, admin, admin2]) {
      const got = notes(u.id, request.id, '"reminder":true');
      assert.equal(got.length, 1, `گیرنده ${u.id}`);
      assert.match(got[0].title, /یادآوری/);
    }
    assert.equal(notes(emp.id, request.id, '"reminder":true').length, 0);
    assert.equal((await run({ now: at(26) })).reminded, 0, 'یک بار برای هر درخواست');
    const after = leaveRepo.findById(request.id);
    assert.equal(after.status, 'pending');
    assert.equal(approvals.awaitingRole(after), 'manager', 'ارجاعی به ادمین نیست');
    assert.equal(approvals.canDecide(manager, after), true);
    assert.equal(await run({ now: at(500) }).then((x) => x.escalated), undefined);
  });

  test('کارمندِ بدون سرپرست: یادآوری فقط به ادمین‌ها', async () => {
    const s = scenario();
    const loner = F.makeUser();
    const d = '2029-05-05';
    const lr = leaveService.create({ userId: loner.id, leaveTypeId: annual.id, startDate: d, endDate: d }).request;
    settingsRepo.setValue('leaveApprovalReminderHours', 1);
    await run({ now: at(5) });
    assert.equal(notes(admin.id, lr.id, '"reminder":true').length, 1);
    assert.equal(notes(admin2.id, lr.id, '"reminder":true').length, 1);
    assert.equal(notes(s.manager.id, lr.id, '"reminder":true').length, 0);
  });

  test('درخواست نهایی‌شده نادیده گرفته می‌شود؛ خطای یک درخواست بقیه را نمی‌شکند', async () => {
    const s = scenario();
    settingsRepo.setValue('leaveApprovalReminderHours', 1);
    approvals.decide({ requestId: s.request.id, actor: s.manager, decision: 'approve' });
    const r = await run({ now: at(100) });
    assert.equal(r.checked, 0);
    // درخواست جدید + created_at خراب ⇒ سن ۰ (یادآوری نه)؛ بقیه یادآوری می‌شوند
    const bad = scenario({ keep: true });
    db.prepare('UPDATE leave_requests SET created_at = ? WHERE id = ?').run('خراب', bad.request.id);
    const ok = scenario({ keep: true });
    settingsRepo.setValue('leaveApprovalReminderHours', 1); // scenario تنظیمات را به پیش‌فرض برمی‌گرداند
    const res = await run({ now: at(100) });
    assert.equal(res.errors, 0);
    assert.ok(res.reminded >= 1);
    assert.equal(notes(ok.manager.id, ok.request.id, '"reminder":true').length, 1);
  });
});

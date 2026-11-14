// تأیید تک‌مرحله‌ای مرخصی/ماموریت: سرپرست مستقیم و ادمین هر دو می‌توانند تصمیم بگیرند؛ تصمیم اول نهایی است؛
// مجوز «زنده» از manager_id فعلی محاسبه می‌شود (درخواست‌های گیرکرده روی admin/چندمرحله‌ای هم باز می‌شوند)؛ ارجاع خودکار وجود ندارد؛
// کارمند می‌بیند چه کسی تصمیم گرفت؛ ادمین‌ها از تصمیم سرپرست باخبر می‌شوند.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

describe('سرپرست روی درخواست‌های تیم خودش تصمیم می‌گیرد', () => {
  let db; let F; let U; let annual; let mission; let leaveService; let approvals; let leaveRepo; let events; let missionDecision; let missionService; let n = 0;
  before(() => {
    db = resetDb();
    F = require('./helpers/factories');
    annual = require('../src/repositories/leaveTypesRepository').findByCode('annual');
    mission = require('../src/repositories/leaveTypesRepository').findByCode('mission');
    leaveService = require('../src/services/leaveService');
    approvals = require('../src/services/leaveApprovalService');
    leaveRepo = require('../src/repositories/leaveRepository');
    events = require('../src/services/notificationEvents');
    missionDecision = require('../src/services/missionDecisionService');
    missionService = require('../src/services/missionService');
    const manager = F.makeUser({ role: 'manager' });
    U = {
      admin: F.makeUser({ role: 'admin' }), admin2: F.makeUser({ role: 'admin' }), hr: F.makeUser({ role: 'hr' }),
      manager, manager2: F.makeUser({ role: 'manager' }), emp: F.makeUser({ managerId: manager.id }), loner: F.makeUser(),
    };
  });
  after(() => cleanup());

  const make = (user, { type = annual, span = 1 } = {}) => {
    n += 1;
    const start = new Date(Date.UTC(2027, 7, 7 + n * 14));
    const end = new Date(start.getTime() + (span - 1) * 86400000);
    const iso = (d) => d.toISOString().slice(0, 10);
    const r = leaveService.create({ userId: user.id, leaveTypeId: type.id, startDate: iso(start), endDate: iso(end) });
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    return r.request;
  };
  const notes = (userId, type, id) => db.prepare('SELECT * FROM notifications WHERE user_id = ? AND type = ?').all(userId, type).filter((x) => x.data.includes(`"requestId":${id}`));

  test('سرپرست مستقیم تأیید می‌کند ⇒ approved و نهایی؛ سرپرست دیگر/hr ممنوع؛ ادمین می‌تواند', () => {
    const req = make(U.emp);
    assert.equal(approvals.getChain(req.id).length, 1, 'تک‌مرحله‌ای');
    assert.equal(approvals.decide({ requestId: req.id, actor: U.manager2, decision: 'approve' }).code, 'FORBIDDEN');
    assert.equal(approvals.decide({ requestId: req.id, actor: U.hr, decision: 'approve' }).code, 'FORBIDDEN');
    const ok = approvals.decide({ requestId: req.id, actor: U.manager, decision: 'approve' });
    assert.deepEqual([ok.ok, ok.completed, ok.finalStatus], [true, true, 'approved']);
    assert.equal(leaveRepo.findById(req.id).approver_id, U.manager.id);
    assert.equal(approvals.decide({ requestId: req.id, actor: U.admin, decision: 'reject' }).code, 'ALREADY_DECIDED', 'تأیید مجدد لازم نیست');

    const byAdmin = make(U.emp);
    assert.equal(approvals.decide({ requestId: byAdmin.id, actor: U.admin, decision: 'reject', note: 'ظرفیت' }).finalStatus, 'rejected');
  });

  test('درخواستِ گیرکرده روی مرحله‌ی admin (سرپرست بعداً ثبت شد / ارجاع قدیمی) برای سرپرست مستقیم باز است', () => {
    const req = make(U.emp);
    db.prepare("UPDATE leave_approvals SET approver_role = 'admin' WHERE leave_request_id = ?").run(req.id);
    assert.equal(approvals.canDecide(U.manager, leaveRepo.findById(req.id)), true);
    assert.equal(approvals.decide({ requestId: req.id, actor: U.manager, decision: 'approve' }).finalStatus, 'approved');
  });

  test('زنجیره‌ی دومرحله‌ایِ قدیمی: تصمیم اول نهایی است و مرحله‌ی باقی‌مانده پاک می‌شود', () => {
    const req = make(U.emp);
    db.prepare("INSERT INTO leave_approvals (leave_request_id, step, approver_role) VALUES (?, 2, 'hr')").run(req.id);
    const r = approvals.decide({ requestId: req.id, actor: U.manager, decision: 'approve' });
    assert.deepEqual([r.completed, r.finalStatus, r.nextRole], [true, 'approved', null]);
    assert.deepEqual(approvals.getChain(req.id).map((s) => [s.step, s.status]), [[1, 'approved']]);
  });

  test('عوض شدن سرپرست وسط pending: مجوز از manager_id فعلی می‌آید (بدون بازسازی زنجیره)', () => {
    const e = F.makeUser({ managerId: U.manager.id });
    const req = make(e);
    db.prepare('UPDATE users SET manager_id = ? WHERE id = ?').run(U.manager2.id, e.id);
    const cur = leaveRepo.findById(req.id);
    assert.equal(approvals.canDecide(U.manager, cur), false);
    assert.equal(approvals.canDecide(U.manager2, cur), true);
    assert.equal(approvals.decide({ requestId: req.id, actor: U.manager2, decision: 'approve' }).ok, true);
  });

  test('کارمند بدون سرپرست: فقط ادمین؛ رد با یادداشت ⇒ rejected', () => {
    const req = make(U.loner);
    assert.equal(approvals.awaitingRole(req), 'admin');
    assert.equal(approvals.canDecide(U.manager, req), false);
    assert.equal(approvals.decide({ requestId: req.id, actor: U.admin2, decision: 'reject', note: 'نه' }).finalStatus, 'rejected');
  });

  test('ماموریت: صف سرپرست با canDecide ساخته می‌شود؛ تأیید/رد سرپرست مستقیم کار می‌کند', () => {
    const m1 = make(U.emp, { type: mission });
    const m2 = make(U.emp, { type: mission });
    db.prepare("UPDATE leave_approvals SET approver_role = 'admin' WHERE leave_request_id IN (?, ?)").run(m1.id, m2.id);
    const ids = missionDecision.pendingForSupervisor(U.manager).map((r) => r.id);
    assert.ok(ids.includes(m1.id) && ids.includes(m2.id), 'ماموریت‌های گیرکرده روی admin هم در صف سرپرست‌اند');
    assert.equal(missionDecision.pendingForSupervisor(U.manager2).some((r) => [m1.id, m2.id].includes(r.id)), false);
    assert.equal(missionDecision.approveMission({ requestId: m1.id, actor: U.manager }).finalStatus, 'approved');
    assert.equal(missionDecision.rejectMission({ requestId: m2.id, actor: U.manager, reason: 'مقصد نامعتبر' }).finalStatus, 'rejected');
    assert.equal(missionService.presentMission(leaveRepo.findById(m2.id)).decidedBy.fullName, U.manager.full_name);
  });

  test('decisionInfo: چه کسی (نقش + نام)، یادداشت؛ pending ⇒ null؛ تصمیم ادمین ⇒ role=admin', () => {
    const a = make(U.emp);
    assert.equal(approvals.decisionInfo(leaveRepo.findById(a.id)), null);
    approvals.decide({ requestId: a.id, actor: U.manager, decision: 'reject', note: 'تداخل با پروژه' });
    const info = approvals.decisionInfo(leaveRepo.findById(a.id));
    assert.deepEqual([info.id, info.fullName, info.role, info.roleLabel, info.note], [U.manager.id, U.manager.full_name, 'manager', 'سرپرست', 'تداخل با پروژه']);
    const b = make(U.emp);
    approvals.decide({ requestId: b.id, actor: U.admin, decision: 'approve' });
    const info2 = approvals.decisionInfo(leaveRepo.findById(b.id));
    assert.deepEqual([info2.role, info2.roleLabel], ['admin', 'ادمین']);
  });

  test('اعلان‌ها: ثبت ⇒ سرپرست + ادمین‌ها؛ تصمیم سرپرست ⇒ کارمند (با نام) + همه‌ی ادمین‌ها (با علت)؛ تصمیم ادمین ⇒ ادمین‌ها خبر نمی‌شوند', async () => {
    const r = make(U.emp);
    await events.leaveRequested(r);
    for (const u of [U.manager, U.admin, U.admin2]) assert.equal(notes(u.id, 'leave_requested', r.id).length, 1);
    assert.equal(notes(U.hr.id, 'leave_requested', r.id).length, 0);
    const res = approvals.decide({ requestId: r.id, actor: U.manager, decision: 'reject', note: 'ظرفیت تیم پر است' });
    await events.leaveDecided(res.request, { note: 'ظرفیت تیم پر است' });
    assert.match(notes(U.emp.id, 'leave_rejected', r.id)[0].body, new RegExp(`ردکننده — سرپرست: ${U.manager.full_name}`));
    for (const a of [U.admin, U.admin2]) {
      const got = notes(a.id, 'leave_supervisor_decided', r.id);
      assert.equal(got.length, 1);
      assert.match(got[0].title, new RegExp(`سرپرست ${U.manager.full_name}.*رد`));
      assert.match(got[0].body, /ظرفیت تیم پر است/);
      assert.match(got[0].body, new RegExp(U.emp.full_name));
    }
    assert.equal(notes(U.manager.id, 'leave_supervisor_decided', r.id).length, 0);

    const r2 = make(U.emp);
    const byAdmin = approvals.decide({ requestId: r2.id, actor: U.admin, decision: 'approve' });
    await events.leaveDecided(byAdmin.request);
    assert.equal(notes(U.admin2.id, 'leave_supervisor_decided', r2.id).length, 0);
    assert.match(notes(U.emp.id, 'leave_approved', r2.id)[0].body, /تأییدکننده — ادمین/);
  });

  test('migration 050: زنجیره‌ی pending چندمرحله‌ای تک‌مرحله‌ای می‌شود؛ نقش از manager_id؛ تنظیمات حذف‌شده پاک می‌شوند؛ تاریخچه دست‌نخورده', () => {
    const migration = require('../src/db/migrations/050_single_step_leave_approval');
    const stuck = make(U.emp);
    db.prepare("UPDATE leave_approvals SET approver_role = 'admin' WHERE leave_request_id = ?").run(stuck.id);
    db.prepare("INSERT INTO leave_approvals (leave_request_id, step, approver_role) VALUES (?, 2, 'hr')").run(stuck.id);
    const decided = make(U.emp);
    approvals.decide({ requestId: decided.id, actor: U.manager, decision: 'approve' });
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('leave_approval_extra_step_days', '3'), ('leave_approval_escalate_hours', '5')").run();
    migration.up(db);
    migration.up(db); // idempotent
    assert.deepEqual(approvals.getChain(stuck.id).map((s) => [s.step, s.approverRole, s.status]), [[1, 'manager', 'pending']]);
    assert.deepEqual(approvals.getChain(decided.id).map((s) => [s.step, s.status, s.decidedBy]), [[1, 'approved', U.manager.id]]);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM settings WHERE key IN ('leave_approval_extra_step_days','leave_approval_escalate_hours')").get().n, 0);
    assert.equal(approvals.decide({ requestId: stuck.id, actor: U.manager, decision: 'approve' }).finalStatus, 'approved');
  });
});

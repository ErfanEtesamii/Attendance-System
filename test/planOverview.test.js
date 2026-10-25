// D1 (فاز ۱۳): فهرست کارمندان با وضعیت برنامه‌ی هفته (GET /admin/plan-overview ← weeklyPlanAdminService.listPlanOverview).
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');

const svc = require('../src/services/weeklyPlanAdminService');
const plansRepo = require('../src/repositories/weeklyPlanRepository');
const { makeUser } = require('./helpers/factories');

const TODAY = '2026-09-19'; // شنبه؛ هفته‌ی بعد از ۰۹-۲۶
const NEXT = '2026-09-26';

describe('فهرست کارمندان با وضعیت برنامه‌ی هفته (D1)', () => {
  let admin; let hr; let mgr; let otherMgr; let emp; let draftEmp; let noPlan; let foreign; let inactive;

  before(() => {
    mock.timers.enable({ apis: ['Date'], now: new Date(`${TODAY}T08:00:00Z`) });
    resetDb();
    admin = makeUser({ role: 'admin' });
    hr = makeUser({ role: 'hr' });
    mgr = makeUser({ role: 'manager' });
    otherMgr = makeUser({ role: 'manager' });
    emp = makeUser({ managerId: mgr.id, name: 'الف' });
    draftEmp = makeUser({ managerId: mgr.id, name: 'ب' });
    noPlan = makeUser({ managerId: mgr.id, name: 'ج' });
    foreign = makeUser({ managerId: otherMgr.id, name: 'د' });
    inactive = makeUser({ managerId: mgr.id, active: false, name: 'غیرفعال' });

    // الف: ثبت‌شده با ۲ تسک معمولی + ۱ فوری + ۱ سیستمی (شمرده نمی‌شوند)
    const p1 = plansRepo.getOrCreate(emp.id, NEXT);
    plansRepo.addTask(p1.id, { title: 'الف۱' });
    plansRepo.addTask(p1.id, { title: 'الف۲' });
    plansRepo.addTask(p1.id, { title: 'فوری', isUrgent: true });
    plansRepo.addTask(p1.id, { title: 'سیستمی', isSystem: true, systemKey: 'x' });
    plansRepo.markSubmitted(p1.id);
    // ب: پیش‌نویس با ۱ تسک
    const p2 = plansRepo.getOrCreate(draftEmp.id, NEXT);
    plansRepo.addTask(p2.id, { title: 'ب۱', managerLocked: true, editedByUserId: mgr.id });
    // برنامه‌ی هفته‌ی دیگر نباید دیده شود
    plansRepo.getOrCreate(noPlan.id, TODAY);
  });
  after(() => { mock.timers.reset(); cleanup(); });

  const byName = (r) => Object.fromEntries(r.employees.map((e) => [e.fullName, e]));

  test('ادمین: همه‌ی کارمندان فعال (نه غیرفعال، نه خودش) با وضعیت و شمار تسک معمولی', () => {
    const r = svc.listPlanOverview(admin);
    assert.equal(r.ok, true);
    assert.equal(r.weekStart, NEXT);
    assert.equal(r.isNextWeek, true);
    assert.equal(r.weekEnd, '2026-10-02');
    assert.match(r.jalaliStart, /^\d{4}\/\d{2}\/\d{2}$/);
    assert.ok(r.employees.every((e) => e.id !== inactive.id));
    const self = r.employees.find((e) => e.id === admin.id); // خودِ ادمین در فهرست است، اول، فقط‌خواندنی و بدون ⚠
    assert.ok(self && self.isSelf === true && self.needsAttention === false);
    assert.equal(r.employees[0].id, admin.id);
    assert.ok(r.employees.filter((e) => e.id !== admin.id).every((e) => e.isSelf === false));
    const m = byName(r);
    assert.deepEqual([m['الف'].planStatus, m['الف'].taskCount, m['الف'].needsAttention], ['submitted', 2, false]);
    assert.deepEqual([m['ب'].planStatus, m['ب'].taskCount, m['ب'].managerConfigured, m['ب'].needsAttention], ['draft', 1, true, false]);
    assert.deepEqual([m['ج'].planStatus, m['ج'].taskCount, m['ج'].needsAttention], ['none', 0, true]); // برنامه‌ی هفته‌ی جاری او شمرده نمی‌شود
    assert.equal(m['د'].planStatus, 'none');
  });

  test('سرپرست فقط زیردست‌های مستقیم خودش؛ سرپرست دیگر هیچ‌کدام؛ hr همه', () => {
    assert.deepEqual(svc.listPlanOverview(mgr).employees.map((e) => e.fullName).sort(), ['الف', 'ب', 'ج'].sort());
    assert.deepEqual(svc.listPlanOverview(otherMgr).employees.map((e) => e.fullName), ['د']);
    assert.ok(svc.listPlanOverview(hr).employees.length >= 5);
  });

  test('کارمند ممنوع؛ کاربر ناموجود ممنوع', () => {
    assert.equal(svc.listPlanOverview(emp).code, 'FORBIDDEN');
    assert.equal(svc.listPlanOverview(null).code, 'FORBIDDEN');
  });

  test('هفته‌ی دلخواه: start داخل هفته نرمال می‌شود؛ هفته‌ی جاری برنامه‌ی ج را دارد؛ ورودی نامعتبر ⇒ INVALID_WEEK', () => {
    const r = svc.listPlanOverview(admin, '2026-09-22');
    assert.equal(r.weekStart, TODAY);
    assert.equal(r.isNextWeek, false);
    assert.equal(byName(r)['ج'].planStatus, 'draft');
    assert.equal(byName(r)['الف'].planStatus, 'none');
    assert.equal(svc.listPlanOverview(admin, 'abc').code, 'INVALID_WEEK');
  });
});

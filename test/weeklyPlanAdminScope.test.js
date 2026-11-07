// A1-۱ (فاز ۱۳): مجوز plan.edit_team، اسکوپ نقش، تعیین هفته و قفل در weeklyPlanAdminService + validateTask مشترک.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const F = require('./helpers/factories');
const { zonedTimeToUtc } = require('../src/utils/time');

describe('ویرایش برنامه‌ی کارمند توسط مدیر — گیت مجوز/اسکوپ/قفل (A1-۱)', () => {
  let db; let admin; let svc; let plan;
  let hr; let boss; let otherBoss; let emp; let otherEmp; let inactive;
  const at = (d, h = '10:00') => zonedTimeToUtc(d, h, 'Asia/Tehran');
  const SUN = at('2026-08-02'); // هفته‌ی جاری از ۰۸-۰۱؛ هفته‌ی بعد از ۰۸-۰۸
  const NEXT = '2026-08-08';

  before(() => {
    db = resetDb();
    svc = require('../src/services/weeklyPlanAdminService');
    plan = require('../src/services/weeklyPlanService');
    admin = F.makeUser({ role: 'admin' });
    hr = F.makeUser({ role: 'hr' });
    boss = F.makeUser({ role: 'manager' });
    otherBoss = F.makeUser({ role: 'manager' });
    emp = F.makeUser({ managerId: boss.id });
    otherEmp = F.makeUser({ managerId: otherBoss.id });
    inactive = F.makeUser({ managerId: boss.id, active: false });
  });
  after(cleanup);

  const open = (actor, userId, week, now = SUN) => svc.openWeek(actor, userId, week, { now });

  test('admin: همه‌ی کارمندان و سرپرست‌ها؛ هفته‌ی پیش‌فرض = هفته‌ی بعد', () => {
    for (const target of [emp, otherEmp, boss]) {
      const r = open(admin, target.id);
      assert.equal(r.ok, true, `target ${target.id}`);
      assert.equal(r.weekStart, NEXT);
      assert.equal(r.target.id, target.id);
    }
  });

  test('سرپرست: فقط کارمند مستقیم خودش؛ دیگران NOT_IN_SCOPE؛ خودش SELF_NOT_ALLOWED', () => {
    assert.equal(open(boss, emp.id).ok, true);
    const other = open(boss, otherEmp.id);
    assert.deepEqual([other.ok, other.code, other.status], [false, 'NOT_IN_SCOPE', 403]);
    const self = open(boss, boss.id);
    assert.deepEqual([self.ok, self.code, self.status], [false, 'SELF_NOT_ALLOWED', 403]);
    // سرپرستِ دیگر هم سرپرست من را نمی‌تواند ویرایش کند
    assert.equal(open(otherBoss, boss.id).code, 'NOT_IN_SCOPE');
  });

  test('hr و کارمند: FORBIDDEN (۴۰۳)؛ admin برای خودش SELF_NOT_ALLOWED', () => {
    for (const actor of [hr, emp, null, undefined, { id: 1, role: 'ناشناخته' }]) {
      const r = open(actor, emp.id);
      assert.deepEqual([r.ok, r.code, r.status], [false, 'FORBIDDEN', 403]);
    }
    assert.equal(open(admin, admin.id).code, 'SELF_NOT_ALLOWED');
  });

  test('کارمند ناموجود، غیرفعال یا شناسه‌ی نامعتبر: USER_NOT_FOUND (۴۰۴)', () => {
    for (const bad of [999999, inactive.id, 'abc', -1, 0, null, undefined]) {
      const r = open(admin, bad);
      assert.deepEqual([r.ok, r.code, r.status], [false, 'USER_NOT_FOUND', 404], String(bad));
    }
    // مجوز قبل از وجود کارمند بررسی می‌شود (وجود/نبود کاربر به غیرمجاز نشت نکند)
    assert.equal(open(hr, 999999).code, 'FORBIDDEN');
  });

  test('سرپرست: هفته‌ی شروع‌شده یا گذشته PLAN_LOCKED (۴۰۹)؛ هفته‌ی آینده‌ی دورتر آزاد', () => {
    for (const week of ['2026-08-01', '2026-07-25']) {
      const r = open(boss, emp.id, week);
      assert.deepEqual([r.ok, r.code, r.status], [false, 'PLAN_LOCKED', 409], week);
    }
    assert.equal(open(boss, emp.id, '2026-08-15').weekStart, '2026-08-15');
    // دقیقاً روز شروع هفته‌ی بعد: today < weekStart هنوز آزاد است
    assert.equal(open(boss, emp.id, NEXT, at('2026-08-07', '23:00')).ok, true);
    assert.equal(open(boss, emp.id, NEXT, at('2026-08-08', '00:30')).code, 'PLAN_LOCKED');
  });

  test('ادمین: هر زمان — هفته‌ی جاری، شروع‌شده و گذشته هم قابل ویرایش است', () => {
    for (const week of ['2026-08-01', '2026-07-25']) {
      const r = open(admin, emp.id, week);
      assert.equal(r.ok, true, week);
      assert.equal(r.weekStart, week);
    }
    assert.equal(open(admin, emp.id, NEXT, at('2026-08-08', '00:30')).ok, true);
    const state = svc.getPlanState(admin, emp.id, '2026-08-01', { now: SUN });
    assert.equal(state.plan.editable, true);
    assert.equal(state.plan.lockReason, null);
    // سرپرست همان هفته را فقط‌خواندنی می‌بیند
    assert.equal(svc.getPlanState(boss, emp.id, '2026-08-01', { now: SUN }).plan.editable, false);
  });

  test('ماه بسته: MONTH_CLOSED (۴۰۹)', () => {
    db.prepare("INSERT INTO month_closures (jalali_year, jalali_month, status, period_from, period_to) VALUES (1405, 5, 'closed', '2026-07-23', '2026-08-22')").run();
    try {
      const r = open(admin, emp.id);
      assert.deepEqual([r.ok, r.code, r.status], [false, 'MONTH_CLOSED', 409]);
      assert.equal(open(boss, emp.id, '2026-08-15').code, 'MONTH_CLOSED');
      assert.equal(open(admin, emp.id, '2026-08-01').code, 'MONTH_CLOSED'); // ماه بسته برای ادمین هم قفل است
    } finally {
      db.exec('DELETE FROM month_closures;');
    }
    assert.equal(open(admin, emp.id).ok, true);
  });

  test('تاریخ شروع هفته نامعتبر یا وسط هفته: INVALID_WEEK (۴۰۰)', () => {
    for (const bad of ['2026-08-09', 'abc', '2026-8-8', 20260808, {}, '2026-13-40']) {
      const r = open(admin, emp.id, bad);
      assert.deepEqual([r.ok, r.code, r.status], [false, 'INVALID_WEEK', 400], String(bad));
    }
  });

  test('گیت هیچ نوشتنی در دیتابیس ندارد (برنامه‌ی خالی ساخته نمی‌شود)', () => {
    db.exec('DELETE FROM plan_tasks; DELETE FROM weekly_plans;');
    open(admin, emp.id);
    open(boss, emp.id, '2026-08-15');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM weekly_plans').get().n, 0);
  });

  test('validateTask مشترک: همان قواعد و پیام‌ها با برچسب دلخواه', () => {
    const v = (t, label = 'تسک') => plan.validateTask(t, label, NEXT);
    assert.equal(v({ title: '  ' }).error.code, 'TITLE_REQUIRED');
    assert.equal(v({ title: '  ' }).error.error, 'عنوان تسک الزامی است.');
    assert.equal(v({ title: ' ' }, 'تسک 3').error.error, 'عنوان تسک 3 الزامی است.');
    assert.equal(v({ title: 'x'.repeat(121) }).error.code, 'TITLE_TOO_LONG');
    assert.equal(v({ title: 'ok', description: 'y'.repeat(501) }).error.code, 'DESCRIPTION_TOO_LONG');
    assert.equal(v({ title: 'ok', priority: 'urgent' }).error.code, 'INVALID_PRIORITY');
    assert.equal(v({ title: 'ok', plannedDate: '2026-08-15' }).error.code, 'DATE_OUT_OF_WEEK');
    assert.equal(v({ title: 'ok', plannedDate: '2026-08-07' }).error.code, 'DATE_OUT_OF_WEEK');
    assert.equal(v({ title: 'ok', plannedDate: 'nope' }).error.code, 'INVALID_DATE');
    assert.deepEqual(v({ title: '  الف   ب ' }).task, { title: 'الف ب', description: null, plannedDate: null, priority: 'normal' });
    assert.deepEqual(v({ title: 'ok', description: 'd', priority: 'high', plannedDate: '2026-08-10' }).task, { title: 'ok', description: 'd', plannedDate: '2026-08-10', priority: 'high' });
    assert.equal(v(null).error.code, 'TITLE_REQUIRED');
  });
});

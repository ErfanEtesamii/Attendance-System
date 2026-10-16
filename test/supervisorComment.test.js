// E3 (فاز ۱۳): یادداشت سرپرست روی برنامه‌ی هفته — weeklyPlanAdminService.setSupervisorComment (مجوز reviews.write، اسکوپ، بدون قفل هفته، بدون ساخت برنامه برای متن خالی).
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const F = require('./helpers/factories');
const { zonedTimeToUtc } = require('../src/utils/time');

describe('یادداشت سرپرست روی برنامه‌ی کارمند (E3)', () => {
  let db; let svc; let plans; let admin; let hr; let boss; let otherBoss; let emp; let otherEmp;
  const at = (d, h = '10:00') => zonedTimeToUtc(d, h, 'Asia/Tehran');
  const SUN = at('2026-08-02'); // هفته‌ی جاری از ۰۸-۰۱؛ هفته‌ی بعد از ۰۸-۰۸
  const NEXT = '2026-08-08';
  const CURRENT = '2026-08-01';
  const reset = () => db.exec('DELETE FROM plan_tasks; DELETE FROM weekly_plans; DELETE FROM audit_log;');
  const put = (actor, userId, comment, week) => svc.setSupervisorComment(actor, userId, week, comment, { now: SUN });

  before(() => {
    db = resetDb();
    svc = require('../src/services/weeklyPlanAdminService');
    plans = require('../src/repositories/weeklyPlanRepository');
    admin = F.makeUser({ role: 'admin' });
    hr = F.makeUser({ role: 'hr' });
    boss = F.makeUser({ role: 'manager' });
    otherBoss = F.makeUser({ role: 'manager' });
    emp = F.makeUser({ managerId: boss.id });
    otherEmp = F.makeUser({ managerId: otherBoss.id });
  });
  after(cleanup);

  test('مجوز/اسکوپ: admin همه؛ سرپرست فقط زیردست مستقیم و نه خودش؛ hr/کارمند FORBIDDEN', () => {
    reset();
    assert.equal(put(admin, otherEmp.id, 'الف', NEXT).ok, true);
    assert.equal(put(boss, emp.id, 'ب', NEXT).ok, true);
    assert.equal(put(boss, otherEmp.id, 'ج', NEXT).code, 'NOT_IN_SCOPE');
    assert.equal(put(boss, boss.id, 'د', NEXT).code, 'SELF_NOT_ALLOWED');
    for (const actor of [hr, emp, null]) assert.equal(put(actor, emp.id, 'ه', NEXT).code, 'FORBIDDEN');
    assert.equal(put(admin, 999999, 'و', NEXT).code, 'USER_NOT_FOUND');
  });

  test('ثبت، تغییر، بدون‌تغییر و پاک‌کردن؛ برنامه‌ی ناموجود draft خالی ساخته می‌شود و وضعیتش draft می‌ماند', () => {
    reset();
    const r1 = put(boss, emp.id, '  لطفاً   تسک‌ها را  کامل کن  ', NEXT);
    assert.deepEqual([r1.ok, r1.changed, r1.before, r1.after], [true, true, null, 'لطفاً تسک‌ها را کامل کن']);
    const p = plans.findByUserWeek(emp.id, NEXT);
    assert.equal(p.status, 'draft');
    assert.equal(p.supervisor_comment, 'لطفاً تسک‌ها را کامل کن');
    assert.equal(p.supervisor_seen_at, null, 'یادداشت «دیده شد»ِ سرپرست را ثبت نمی‌کند');
    const same = put(boss, emp.id, 'لطفاً تسک‌ها را کامل کن', NEXT);
    assert.deepEqual([same.ok, same.changed], [true, false]);
    const r3 = put(boss, emp.id, 'نسخه‌ی جدید', NEXT);
    assert.deepEqual([r3.changed, r3.before, r3.after], [true, 'لطفاً تسک‌ها را کامل کن', 'نسخه‌ی جدید']);
    const r4 = put(boss, emp.id, '', NEXT);
    assert.deepEqual([r4.changed, r4.after], [true, null]);
    assert.equal(plans.findByUserWeek(emp.id, NEXT).supervisor_comment, null);
  });

  test('متن خالی روی برنامه‌ی ناموجود: بدون تغییر و بدون ساخت برنامه', () => {
    reset();
    const r = put(boss, emp.id, '   ', NEXT);
    assert.deepEqual([r.ok, r.changed, r.plan.weekStart], [true, false, NEXT]);
    assert.equal(plans.findByUserWeek(emp.id, NEXT), null);
  });

  test('هفته‌ی شروع‌شده قفل نیست (برخلاف ویرایش تسک)؛ نسخه‌ی برنامه بالا می‌رود', () => {
    reset();
    const r = put(boss, emp.id, 'یادداشت هفته‌ی جاری', CURRENT);
    assert.equal(r.ok, true);
    assert.equal(plans.findByUserWeek(emp.id, CURRENT).supervisor_comment, 'یادداشت هفته‌ی جاری');
    // ویرایش تسک همان هفته همچنان قفل است
    assert.equal(svc.addTask(boss, emp.id, CURRENT, { title: 'x' }, { now: SUN }).code, 'PLAN_LOCKED');
    const v1 = plans.findByUserWeek(emp.id, CURRENT).version;
    put(boss, emp.id, 'ویرایش', CURRENT);
    assert.ok(plans.findByUserWeek(emp.id, CURRENT).version > v1);
  });

  test('اعتبارسنجی: نوع نامعتبر، بیش از ۵۰۰ نویسه، متن شبیه HTML؛ پاسخ وضعیت تازه با یادداشت', () => {
    reset();
    assert.equal(put(boss, emp.id, 123, NEXT).code, 'INVALID_COMMENT');
    const long = put(boss, emp.id, 'ا'.repeat(501), NEXT);
    assert.deepEqual([long.ok, long.code, long.status], [false, 'COMMENT_TOO_LONG', 400]);
    assert.equal(put(boss, emp.id, 'ا'.repeat(500), NEXT).ok, true);
    const r = put(boss, emp.id, '<b>سلام</b>', NEXT);
    assert.equal(r.ok, true);
    assert.equal(r.after, '<b>سلام</b>'); // متن خام ذخیره می‌شود؛ همه‌ی نمایش‌ها (textContent/esc) آن را متن می‌کنند
    const state = svc.withState(boss, emp.id, r, { now: SUN });
    assert.equal(state.ok, true);
    assert.equal(state.plan.supervisorComment, r.after);
  });

  test('شمارنده‌ی «تغییر اطلاع‌داده‌نشده» با یادداشت عوض نمی‌شود', () => {
    reset();
    put(boss, emp.id, 'فقط یادداشت', NEXT);
    const state = svc.getPlanState(boss, emp.id, NEXT, { now: SUN });
    assert.equal(state.plan.unnotifiedChanges, 0);
  });
});

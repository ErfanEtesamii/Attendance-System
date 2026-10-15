// A3-۳الف (فاز ۱۳): سازگاری saveDraft کارمند با ویرایش مدیر — فهرست کهنه‌ی کلاینت، تسک حذف‌شده‌ی مدیر، تسک مدیر غیرقابل‌حذف، سقف ۳۰.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const F = require('./helpers/factories');
const { zonedTimeToUtc } = require('../src/utils/time');

describe('saveDraft کارمند در برابر ویرایش مدیر (A3-۳الف)', () => {
  let db; let svc; let admin; let plans; let boss; let u; let mgr;
  const at = (d, h = '10:00') => zonedTimeToUtc(d, h, 'Asia/Tehran');
  const SUN = at('2026-08-02'); // هفته‌ی بعد از ۰۸-۰۸
  const NEXT = '2026-08-08';
  const t = (title, extra = {}) => ({ title, ...extra });
  const reset = () => db.exec('DELETE FROM task_daily_logs; DELETE FROM plan_tasks; DELETE FROM weekly_plans; DELETE FROM notifications; DELETE FROM month_closures;');
  const save = (tasks) => svc.saveDraft(u, 'next', tasks, { now: SUN });
  const mgrAdd = (title, extra = {}) => {
    const r = mgr.addTask(boss, u.id, NEXT, t(title, extra), { now: SUN });
    assert.equal(r.ok, true, r.message);
    return r.task;
  };

  before(() => {
    db = resetDb();
    svc = require('../src/services/weeklyPlanService');
    mgr = require('../src/services/weeklyPlanAdminService');
    plans = require('../src/repositories/weeklyPlanRepository');
    admin = F.makeUser({ role: 'admin' });
    boss = F.makeUser({ role: 'manager' });
    u = F.makeUser({ managerId: boss.id });
  });
  after(cleanup);

  test('ذخیره با فهرست کهنه: ویرایش مدیر بازنویسی نمی‌شود و تسک مدیر از دست نمی‌رود', () => {
    reset();
    const mine = save([t('الف')]).tasks[0];
    const m = mgrAdd('از مدیر', { priority: 'high', plannedDate: '2026-08-09' });
    // مدیر بعد از لود کلاینت تسک را ویرایش می‌کند
    assert.equal(mgr.updateTask(boss, u.id, m.id, { title: 'ویرایش مدیر' }, { now: SUN }).ok, true);
    // کلاینتِ کهنه: نسخه‌ی قدیمیِ تسک مدیر را برمی‌گرداند + تسک خودش را ویرایش کرده
    const r = save([{ ...mine, title: 'الف۲' }, { id: m.id, title: 'نسخه‌ی کهنه', priority: 'low', plannedDate: null }]);
    assert.equal(r.ok, true);
    const managerTask = r.tasks.find((x) => x.id === m.id);
    assert.equal(managerTask.title, 'ویرایش مدیر');
    assert.equal(managerTask.priority, 'high');
    assert.equal(managerTask.plannedDate, '2026-08-09');
    assert.equal(managerTask.managerLocked, true);
    assert.equal(r.tasks.find((x) => x.id === mine.id).title, 'الف۲');
    // کلاینتی که تسک مدیر را اصلاً نمی‌فرستد هم آن را حذف نمی‌کند
    const r2 = save([{ ...mine }]);
    assert.equal(r2.ok, true);
    assert.ok(r2.tasks.some((x) => x.id === m.id && !plans.findTask(m.id).deleted_at));
  });

  test('تسک حذف‌شده‌ی مدیر در فهرست کهنه: بدون خطا نادیده می‌شود و پاسخ برنامه‌ی تازه است', () => {
    reset();
    const mine = save([t('الف')]).tasks[0];
    const m = mgrAdd('موقت مدیر');
    assert.equal(mgr.removeTask(boss, u.id, m.id, { now: SUN }).ok, true);
    const r = save([{ ...mine }, { id: m.id, title: 'موقت مدیر' }]);
    assert.equal(r.ok, true);
    assert.ok(!r.tasks.some((x) => x.id === m.id)); // زنده نشد
    assert.notEqual(plans.findTask(m.id).deleted_at, null);
    assert.deepEqual(r.tasks.map((x) => x.id), [mine.id]);
  });

  test('تسک مدیر برای کارمند غیرقابل حذف و غیرقابل ویرایش است (حتی با ارسال مستقیم)', () => {
    reset();
    const m = mgrAdd('قفل');
    const r = save([{ id: m.id, title: 'هک', priority: 'low' }, t('خودم')]);
    assert.equal(r.ok, true);
    const row = plans.findTask(m.id);
    assert.equal(row.title, 'قفل');
    assert.equal(row.deleted_at, null);
    assert.equal(save([]).ok, true); // فهرست خالی = حذف همه‌ی تسک‌های خود کارمند، نه تسک مدیر
    assert.equal(plans.findTask(m.id).deleted_at, null);
  });

  test('شناسه‌ی تسک برنامه‌ی کارمند دیگر همچنان TASK_NOT_FOUND', () => {
    reset();
    const other = F.makeUser({ managerId: boss.id });
    const m = mgr.addTask(boss, other.id, NEXT, t('مال دیگری'), { now: SUN }).task;
    assert.equal(save([{ id: m.id, title: 'x' }]).code, 'TASK_NOT_FOUND');
  });

  test('سقف ۳۰: تسک‌های مدیر در مجموع می‌آیند و کارمند نمی‌تواند از سقف رد شود', () => {
    reset();
    for (let i = 0; i < 5; i++) mgrAdd(`مدیر ${i}`);
    assert.equal(save(Array.from({ length: 26 }, (_, i) => t(`خود ${i}`))).code, 'TOO_MANY_TASKS'); // ۵ + ۲۶ = ۳۱
    const ok = save(Array.from({ length: 25 }, (_, i) => t(`خود ${i}`)));
    assert.equal(ok.ok, true);
    assert.equal(ok.tasks.length, 30);
  });

  test('سقف ۳۰ سمت مدیر: افزودن تسک سی‌ویکم رد می‌شود', () => {
    reset();
    assert.equal(save(Array.from({ length: 30 }, (_, i) => t(`خود ${i}`))).ok, true);
    assert.equal(mgr.addTask(boss, u.id, NEXT, t('اضافه'), { now: SUN }).code, 'TOO_MANY_TASKS');
    assert.equal(mgr.addTask(admin, u.id, NEXT, t('اضافه'), { now: SUN }).code, 'TOO_MANY_TASKS');
  });
});

// H5 (بخش ۲ و ۳): تسک واجبِ «بررسی گزارش روز قبلِ تیم» — ساخت خودکار در برنامه‌ی هفتگی، پیشرفت «x از y مشاهده شد»، نمای F1،
// عدم ویرایش/حذف، ماه بسته، idempotent بودن و خط morningDigest. تاریخ با mock.timers ثابت است (دوشنبه ۲۰۲۶-۱۰-۱۲).
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const F = require('./helpers/factories');

const NOW = new Date('2026-10-12T08:00:00Z');
const TODAY = '2026-10-12'; // دوشنبه
const SAT_PREV = '2026-10-10'; // شنبه‌ی هفته‌ی جاری (weekStartDay = 6)
const SUN = '2026-10-11';
const NEXT_MON = '2026-10-19';
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

describe('تسک واجب سرپرست — H5 بخش ۲/۳', () => {
  let db; let svc; let progress; let plans; let logs; let holidays; let weekly; let weekSvc; let digest; let cal;
  const { addDays } = require('../src/utils/shiftDay');
  const weekDates = (start) => Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const reset = () => {
    db.exec('DELETE FROM report_reviews; DELETE FROM task_daily_logs; DELETE FROM plan_tasks; DELETE FROM weekly_plans; DELETE FROM holidays; DELETE FROM leave_approvals; DELETE FROM leave_requests;');
  };
  const reportOf = (user, date) => {
    const plan = plans.getOrCreate(user.id, cal.weekStartOf(date, 6));
    const t = plans.addTask(plan.id, { title: `کار ${user.id}-${date}`, plannedDate: date });
    logs.upsert({ taskId: t.id, userId: user.id, logDate: date, status: 'done' });
    return t;
  };
  const sysDates = (user, start) => {
    const plan = plans.findByUserWeek(user.id, start);
    return plan ? plans.listTasks(plan.id).filter((t) => t.system_key === svc.REVIEW_KEY).map((t) => t.planned_date).sort() : [];
  };
  const workingDates = (user, dates) => dates.filter((d) => cal.getCalendarDay(user, d, { settings: require('../src/repositories/settingsRepository').getAll() }).isWorkingDay);

  before(() => {
    db = resetDb();
    svc = require('../src/services/teamReviewService');
    progress = require('../src/services/teamReviewProgress');
    plans = require('../src/repositories/weeklyPlanRepository');
    logs = require('../src/repositories/taskLogRepository');
    holidays = require('../src/repositories/holidaysRepository');
    weekly = require('../src/services/weeklyPlanService');
    weekSvc = require('../src/services/employeeWeekService');
    digest = require('../src/bot/scheduler/morningDigest');
    cal = require('../src/engine/calendarService');
    mock.timers.enable({ apis: ['Date'], now: NOW });
  });
  after(() => { mock.timers.reset(); cleanup(); });

  test('سرپرست جدید بدون برنامه: ساخت برای همه‌ی روزهای کاری هفته (و فقط آن‌ها)، بدون ساخت تسک عادی', () => {
    reset();
    const boss = F.makeUser({ role: 'manager' });
    F.makeUser({ managerId: boss.id }); F.makeUser({ managerId: boss.id });
    assert.equal(plans.findByUserWeek(boss.id, SAT_PREV), null);
    const settings = require('../src/repositories/settingsRepository').getAll();
    for (const d of weekDates(SAT_PREV)) svc.ensureTask(boss, d, settings);
    const expected = workingDates(boss, weekDates(SAT_PREV)).sort();
    assert.ok(expected.length >= 5);
    assert.deepEqual(sysDates(boss, SAT_PREV), expected);
    const plan = plans.findByUserWeek(boss.id, SAT_PREV);
    assert.equal(plans.listTasks(plan.id).filter((t) => !t.is_system).length, 0);
  });

  test('زیردست جدیدِ وسط هفته: پیش از آن تسکی نیست، بعد از آن تسک روزهای باقی‌مانده ساخته می‌شود', () => {
    reset();
    const boss = F.makeUser({ role: 'manager' });
    assert.equal(svc.ensureTask(boss, TODAY), null); // هنوز تیم ندارد
    F.makeUser({ managerId: boss.id });
    const rest = workingDates(boss, weekDates(TODAY).filter((d) => d <= addDays(SAT_PREV, 6)));
    rest.forEach((d) => assert.ok(svc.ensureTask(boss, d), d));
    assert.ok(sysDates(boss, SAT_PREV).includes(TODAY));
  });

  test('روز قبل تعطیل: مرور به آخرین روز کاریِ قبلی', () => {
    reset();
    const boss = F.makeUser({ role: 'manager' });
    F.makeUser({ managerId: boss.id });
    holidays.addHoliday(SUN, 'تعطیلی تست');
    assert.equal(svc.reviewDateFor(boss, TODAY), SAT_PREV);
    assert.ok(svc.ensureTask(boss, TODAY));
    const p = progress.progressFor(boss, TODAY, TODAY);
    assert.equal(p.reviewDate, SAT_PREV);
  });

  test('ادمین بدون زیردست و سرپرست بدون زیردست: تسکی ساخته نمی‌شود (job/باز شدن F1)', () => {
    reset();
    const admin = F.makeUser({ role: 'admin' });
    const lone = F.makeUser({ role: 'manager' });
    for (const u of [admin, lone]) {
      weekDates(SAT_PREV).forEach((d) => assert.equal(svc.ensureTask(u, d), null));
      const r = weekSvc.getWeek(admin, u.id, {}, { now: NOW });
      assert.equal(r.ok, true);
      assert.ok(r.days.every((d) => !d.tasks.some((t) => t.systemKey === svc.REVIEW_KEY)));
    }
    assert.equal(progress.progressFor(lone, TODAY, TODAY).reportCount, 0); // بدون تیم ⇒ بدون گزارش
  });

  test('اجرای دوباره idempotent است (ensureTask و باز شدن F1)', () => {
    reset();
    const boss = F.makeUser({ role: 'manager' });
    F.makeUser({ managerId: boss.id });
    const admin = F.makeUser({ role: 'admin' });
    const t1 = svc.ensureTask(boss, TODAY);
    const t2 = svc.ensureTask(boss, TODAY);
    assert.equal(t1.id, t2.id);
    weekSvc.getWeek(admin, boss.id, {}, { now: NOW });
    const n1 = sysDates(boss, SAT_PREV);
    weekSvc.getWeek(admin, boss.id, {}, { now: NOW });
    assert.deepEqual(sysDates(boss, SAT_PREV), n1);
    assert.equal(new Set(n1).size, n1.length);
  });

  test('F1: باز شدن نمای سرپرست برای امروز و بعد تسک می‌سازد، روزهای گذشته را نه؛ فیلد review دارد', () => {
    reset();
    const boss = F.makeUser({ role: 'manager' });
    const a = F.makeUser({ managerId: boss.id }); F.makeUser({ managerId: boss.id });
    const admin = F.makeUser({ role: 'admin' });
    reportOf(a, SUN);
    const r = weekSvc.getWeek(admin, boss.id, {}, { now: NOW });
    const dates = sysDates(boss, SAT_PREV);
    assert.ok(dates.includes(TODAY));
    assert.ok(dates.every((d) => d >= TODAY));
    const day = r.days.find((d) => d.date === TODAY);
    const t = day.tasks.find((x) => x.systemKey === svc.REVIEW_KEY);
    assert.ok(t);
    assert.equal(t.isSystem, true);
    assert.equal(t.review.reviewDate, SUN);
    assert.equal(t.review.reportCount, 1);
    assert.equal(t.review.reviewedCount, 0);
    assert.equal(t.review.complete, false);
    assert.equal(r.summary.tasks.total, 0); // تسک سیستمی در شمارش درصد نمی‌آید
  });

  test('پیشرفت زنده در getPlan: ۱ از ۲ ⇒ بعد از مشاهده‌ی دوم کامل و done خودکار', () => {
    reset();
    const boss = F.makeUser({ role: 'manager' });
    const a = F.makeUser({ managerId: boss.id }); const b = F.makeUser({ managerId: boss.id });
    reportOf(a, SUN); reportOf(b, SUN);
    svc.ensureTask(boss, TODAY);
    assert.equal(svc.markReviewed(boss, { subjectUserId: a.id, reportDate: SUN }).ok, true);
    let plan = weekly.getPlan(boss, 'current', { now: NOW });
    let t = plan.tasks.find((x) => x.systemKey === svc.REVIEW_KEY && x.plannedDate === TODAY);
    assert.deepEqual({ r: t.review.reviewedCount, c: t.review.reportCount, done: t.review.complete }, { r: 1, c: 2, done: false });
    assert.equal(svc.markReviewed(boss, { subjectUserId: b.id, reportDate: SUN }).ok, true);
    plan = weekly.getPlan(boss, 'current', { now: NOW });
    t = plan.tasks.find((x) => x.systemKey === svc.REVIEW_KEY && x.plannedDate === TODAY);
    assert.equal(t.review.complete, true);
    assert.equal(t.review.reviewedCount, 2);
    const log = logs.findByTaskDate(t.id, TODAY);
    assert.equal(log && log.status, 'done');
  });

  test('روزِ گزارشِ هنوز نرسیده ⇒ notYet؛ کارمند عادی ⇒ null؛ تسک غیرواجب دست نمی‌خورد', () => {
    reset();
    const boss = F.makeUser({ role: 'manager' });
    F.makeUser({ managerId: boss.id });
    const p = progress.progressFor(boss, addDays(TODAY, 2), TODAY);
    assert.equal(p.reviewDate > TODAY, true);
    assert.equal(p.notYet, true);
    assert.equal(progress.progressFor(F.makeUser(), TODAY, TODAY), null);
    const tasks = [{ systemKey: 'out_of_plan', plannedDate: TODAY }, { systemKey: null, plannedDate: TODAY }];
    progress.decorate(boss, tasks, TODAY);
    assert.ok(tasks.every((t) => t.review === undefined));
  });

  test('ویرایش و حذف توسط سرپرست رد/نادیده می‌شود (هفته‌ی آینده‌ی قابل‌ویرایش)', () => {
    reset();
    const boss = F.makeUser({ role: 'manager' });
    F.makeUser({ managerId: boss.id });
    const t = svc.ensureTask(boss, NEXT_MON);
    assert.ok(t);
    weekly.saveDraft(boss, 'next', [], { now: NOW }); // لیست خالی = حذف همه‌ی تسک‌های کاربر؛ سیستمی باید بماند
    let row = plans.findTask(t.id);
    assert.equal(row.deleted_at, null);
    weekly.saveDraft(boss, 'next', [{ id: t.id, title: 'تغییر عنوان', plannedDate: NEXT_MON, priority: 'high' }], { now: NOW });
    row = plans.findTask(t.id);
    assert.equal(row.title, svc.TITLE);
    assert.equal(row.deleted_at, null);
    assert.equal(row.is_system, 1);
  });

  test('ماه بسته ⇒ تسک ساخته نمی‌شود', () => {
    reset();
    const boss = F.makeUser({ role: 'manager' });
    F.makeUser({ managerId: boss.id });
    const mc = require('../src/repositories/monthClosuresRepository');
    const orig = mc.findClosedOverlapping;
    mc.findClosedOverlapping = () => [{ id: 1 }];
    try {
      assert.equal(svc.ensureTask(boss, TODAY), null);
      const admin = F.makeUser({ role: 'admin' });
      weekSvc.getWeek(admin, boss.id, {}, { now: NOW });
      assert.deepEqual(sysDates(boss, SAT_PREV), []);
    } finally { mc.findClosedOverlapping = orig; }
  });

  test('morningDigest: برای هر سرپرست یک پیام و فقط یک خط «مشاهده نشده»', () => {
    reset();
    const boss = F.makeUser({ role: 'manager' });
    const a = F.makeUser({ managerId: boss.id }); const b = F.makeUser({ managerId: boss.id });
    reportOf(a, SUN); reportOf(b, SUN);
    const mine = digest.buildMorningDigests({ now: NOW }).filter((d) => d.reviewer.id === boss.id);
    assert.equal(mine.length, 1);
    assert.equal(mine[0].text.split('هنوز مشاهده نشده').length - 1, 1);
    assert.deepEqual(mine[0].unreviewed.sort(), [a.id, b.id].sort());
    svc.markReviewed(boss, { subjectUserId: a.id, reportDate: SUN });
    svc.markReviewed(boss, { subjectUserId: b.id, reportDate: SUN });
    assert.equal(digest.buildMorningDigests({ now: NOW }).filter((d) => d.reviewer.id === boss.id && d.unreviewed.length).length, 0);
  });

  test('UI (ایستا): برچسب «🔒 واجب»، دکمه‌ی مشاهده‌ی گزارش‌ها و مسیر teamreports/<تاریخ>', () => {
    const app = read('public/js/app.js');
    assert.ok(app.includes("'🔒 واجب'") && app.includes('مشاهده‌ی گزارش‌ها') && app.includes('گزارش مشاهده شد'));
    assert.ok(app.includes('teamreports/') && app.includes('role') && app.includes('progressbar'));
    const weekly = read('public-admin/js/views-weekly.js');
    assert.ok(weekly.includes('🔒 واجب') && weekly.includes('open-reviews') && weekly.includes("AP.go('teamreports'"));
    assert.ok(weekly.includes('isSelf && AP.can('));
    assert.ok(read('public-admin/js/views-teamreports.js').includes('async render(param)'));
    assert.ok(read('public-admin/js/core.js').includes('goParam'));
  });
});

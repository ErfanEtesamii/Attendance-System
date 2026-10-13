// D14: موارد لبه‌ای و سناریوی کامل برنامه‌ی هفتگی ← گزارش روزانه ← تسک سیستمی سرپرست ← گزارش شبانه.
// تاریخ‌ها نسبت به «امروز» واقعی ساخته می‌شوند (سقف ۶۰ روزه‌ی مشاهده و currentRecordDate از ساعت سیستم می‌آیند).
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const F = require('./helpers/factories');
const { zonedTimeToUtc } = require('../src/utils/time');
const { addDays } = require('../src/utils/shiftDay');
const { todayDateString } = require('../src/utils/serverTime');

const dow = (d) => new Date(`${d}T00:00:00Z`).getUTCDay();
const lastDow = (target, from) => { let d = from; while (dow(d) !== target) d = addDays(d, -1); return d; };

describe('فاز ۱۰: موارد لبه‌ای و سناریوی کامل (D14)', () => {
  let db; let report; let plans; let logs; let rr; let review; let weekly; let teamReports; let nightly; let boss; let boss2; let a; let admin; let solo;
  let SAT; let SUN; let THU;
  const wk = (d) => require('../src/engine/calendarService').weekStartOf(d, 6);
  const at = (d, h = '10:00') => zonedTimeToUtc(d, h, 'Asia/Tehran');
  const mk = (u, date, title, extra = {}) => plans.addTask(plans.getOrCreate(u.id, wk(date)).id, { title, plannedDate: date, ...extra });
  const reset = () => db.exec('DELETE FROM report_reviews; DELETE FROM task_daily_logs; DELETE FROM plan_tasks; DELETE FROM weekly_plans; DELETE FROM notifications; DELETE FROM settings;');

  before(() => {
    db = resetDb();
    report = require('../src/services/taskReportService');
    plans = require('../src/repositories/weeklyPlanRepository');
    logs = require('../src/repositories/taskLogRepository');
    rr = require('../src/repositories/reportReviewRepository');
    review = require('../src/services/teamReviewService');
    weekly = require('../src/services/weeklyPlanService');
    teamReports = require('../src/services/teamReportsService');
    nightly = require('../src/services/nightlyTaskReportService');
    const today = todayDateString();
    SAT = lastDow(6, addDays(today, -2)); // آخرین شنبه‌ای که یکشنبه‌ی بعدش هم گذشته است
    SUN = addDays(SAT, 1);
    THU = addDays(SAT, -2);
    admin = F.makeUser({ role: 'admin', name: 'ادمین' });
    boss = F.makeUser({ role: 'manager', name: 'سرپرست۱', managerId: admin.id });
    boss2 = F.makeUser({ role: 'manager', name: 'سرپرست۲', managerId: admin.id });
    a = F.makeUser({ managerId: boss.id, name: 'علی' });
    solo = F.makeUser({ name: 'بی‌سرپرست' });
  });
  after(cleanup);

  test('سناریوی کامل: برنامه‌ی پنجشنبه ← گزارش شنبه ← تسک سیستمی سرپرست ← مشاهده ← گزارش شبانه', () => {
    reset();
    // ۱) پنجشنبه: برنامه‌ی هفته‌ی بعد (شروع شنبه)
    const saved = weekly.saveDraft(a, 'next', [{ title: 'نوشتن گزارش', plannedDate: SAT }, { title: 'جلسه با مشتری', plannedDate: SAT }, { title: 'مطالعه' }], { now: at(THU) });
    assert.equal(saved.ok, true, saved.error);
    assert.equal(weekly.submit(a, 'next', { now: at(THU) }).ok, true);
    // ۲) شنبه: گزارش (۱ انجام، ۱ نیمه‌کاره با انتقال به فردا، «مطالعه»‌ی هر روز انجام) + کار خارج از برنامه
    const list = report.getDailyTasks(a, { date: SAT });
    assert.deepEqual(list.tasks.map((t) => t.title).sort(), ['جلسه با مشتری', 'مطالعه', 'نوشتن گزارش']);
    const id = (title) => list.tasks.find((t) => t.title === title).id;
    const res = report.submitDailyReport(a, {
      answers: [{ taskId: id('نوشتن گزارش'), status: 'done' }, { taskId: id('مطالعه'), status: 'done' },
        { taskId: id('جلسه با مشتری'), status: 'partial', reasonCode: 'needs_more_time', reschedule: { type: 'tomorrow' } }],
      extra: [{ title: 'کمک به همکار' }],
    }, { date: SAT });
    assert.equal(res.ok, true, res.error);
    assert.equal(res.tasks.length, 0);
    // فردا (یکشنبه) تسک منتقل‌شده در فهرست است
    assert.ok(report.getDailyTasks(a, { date: SUN }).tasks.some((t) => t.title === 'جلسه با مشتری'));
    // ۳) سرپرست یکشنبه: تسک سیستمی review_team_reports
    const boss1 = report.getDailyTasks(boss, { date: SUN });
    assert.ok(boss1.tasks.some((t) => t.systemKey === review.REVIEW_KEY), 'تسک سیستمی ساخته شد');
    assert.ok(boss1.teamReview && boss1.teamReview.unreviewed.some((m) => m.userId === a.id));
    // ۴) مشاهده ⇒ تسک done خودکار و از فهرست پاسخ‌نداده‌ها خارج
    assert.equal(review.markReviewed(boss, { subjectUserId: a.id, reportDate: SAT, comment: 'آفرین' }).ok, true);
    assert.ok(!report.getDailyTasks(boss, { date: SUN }).tasks.some((t) => t.systemKey === review.REVIEW_KEY));
    // ۵) گزارش شبانه‌ی شنبه برای سرپرست و خلاصه‌ی ادمین
    const rep = nightly.buildNightlyTaskReports(SAT).find((r) => r.reviewer.id === boss.id);
    const text = rep.messages.join('\n');
    assert.match(text, /علی — 2 از 3 انجام شد \(67٪\)/);
    assert.match(text, /جلسه با مشتری — زمان بیشتری لازم دارد/);
    assert.match(text, /➕ 1 کار خارج از برنامه/);
    const adm = nightly.buildNightlyTaskReports(SAT).find((r) => r.reviewer.id === admin.id).messages.join('\n');
    assert.match(adm, /خلاصه‌ی کل شرکت/);
    // ۶) کارمند: صفحه‌ی گزارش‌ها کامنت سرپرست را می‌بیند
    assert.equal(teamReports.getReports(a, { date: SAT }).members[0].comment, 'آفرین');
  });

  test('تغییر سرپرست وسط هفته: گزارش به سرپرست فعلی می‌رسد؛ تاریخچه‌ی مشاهده‌ی قبلی حفظ می‌شود', () => {
    reset();
    const t = mk(a, SAT, 'الف');
    logs.upsert({ taskId: t.id, userId: a.id, logDate: SAT, status: 'done' });
    review.markReviewed(boss, { subjectUserId: a.id, reportDate: SAT, comment: 'قبلی' });
    db.prepare('UPDATE users SET manager_id = ? WHERE id = ?').run(boss2.id, a.id);
    try {
      assert.ok(!teamReports.getReports(boss, { date: SAT }).members.some((m) => m.userId === a.id), 'سرپرست قبلی دیگر نمی‌بیند');
      const row = teamReports.getReports(boss2, { date: SAT }).members.find((m) => m.userId === a.id);
      assert.equal(row.status, 'unreviewed');
      assert.equal(review.markReviewed(boss, { subjectUserId: a.id, reportDate: SAT }).code, 'SUBJECT_NOT_IN_SCOPE');
      assert.equal(rr.find(boss.id, a.id, SAT).comment, 'قبلی', 'تاریخچه حفظ است');
      assert.ok(nightly.buildNightlyTaskReports(SAT).find((r) => r.reviewer.id === boss2.id).messages.join('').includes('علی'));
    } finally { db.prepare('UPDATE users SET manager_id = ? WHERE id = ?').run(boss.id, a.id); }
  });

  test('حذف نرم تسکِ پاسخ‌داده‌شده: پاسخ در تاریخچه/خلاصه می‌ماند، از فهرست و معطل‌مانده‌ها بیرون می‌رود', () => {
    reset();
    const t = mk(a, SAT, 'پاک می‌شود'); mk(a, SAT, 'می‌ماند');
    logs.upsert({ taskId: t.id, userId: a.id, logDate: SAT, status: 'done' });
    plans.softDeleteTask(t.id);
    const row = teamReports.getReports(boss, { date: SAT }).members.find((m) => m.userId === a.id);
    assert.equal(row.summary.done, 1);
    assert.deepEqual(report.getDailyTasks(a, { date: SAT }).tasks.map((x) => x.title), ['می‌ماند']);
  });

  test('ماه بسته: مشاهده رد می‌شود (MONTH_CLOSED) ولی خواندن گزارش‌ها آزاد است', () => {
    reset();
    const t = mk(a, SAT, 'الف');
    logs.upsert({ taskId: t.id, userId: a.id, logDate: SAT, status: 'done' });
    const mc = require('../src/repositories/monthClosuresRepository');
    const orig = mc.findClosedOverlapping;
    mc.findClosedOverlapping = () => [{ id: 1 }];
    try {
      assert.equal(review.markReviewed(boss, { subjectUserId: a.id, reportDate: SAT }).code, 'MONTH_CLOSED');
      assert.equal(teamReports.getReports(boss, { date: SAT }).ok, true);
      assert.equal(report.submitDailyReport(a, { answers: [] }, { requestedDate: SAT }).ok, false);
    } finally { mc.findClosedOverlapping = orig; }
  });

  test('کاربر بدون سرپرست ⇒ گزارش به ادمین؛ سرپرست ⇒ مدیر بالادست', () => {
    reset();
    const t = mk(solo, SAT, 'ب'); logs.upsert({ taskId: t.id, userId: solo.id, logDate: SAT, status: 'done' });
    const t2 = mk(boss, SAT, 'ج'); logs.upsert({ taskId: t2.id, userId: boss.id, logDate: SAT, status: 'done' });
    const adm = nightly.buildNightlyTaskReports(SAT).find((r) => r.reviewer.id === admin.id).messages.join('\n');
    assert.match(adm, /بی‌سرپرست/);
    assert.match(adm, /سرپرست۱/);
    assert.deepEqual(teamReports.getReports(admin, { date: SAT }).members.map((m) => m.userId).filter((i) => [solo.id, boss.id].includes(i)).sort(), [solo.id, boss.id].sort());
  });

  test('دبل‌کلیک ثبت گزارش/خروج: بار دوم رد می‌شود و ردیف تکراری ساخته نمی‌شود', () => {
    reset();
    const t = mk(a, SAT, 'الف');
    const body = { answers: [{ taskId: t.id, status: 'done' }] };
    const gate = report.checkoutGate(a, SAT, body);
    report.commitAtomic(a, gate, () => 'خروج');
    const n = () => db.prepare('SELECT COUNT(*) AS n FROM task_daily_logs').get().n;
    assert.equal(n(), 1);
    assert.equal(report.submitDailyReport(a, body, { date: SAT }).ok, false);
    const gate2 = report.checkoutGate(a, SAT, body);
    assert.notEqual(gate2.action, 'allow-with-report');
    assert.equal(n(), 1);
  });

  test('شیفت شب: «امروز» گزارش، روزِ شروع شیفت است (بعد از نیمه‌شب هنوز روز قبل)', () => {
    reset();
    const shifts = require('../src/repositories/shiftsRepository');
    const night = shifts.createShift({ name: 'شب-D14', startTime: '22:00', endTime: '06:00', graceLateMinutes: 0, graceEarlyMinutes: 0, workDays: [0, 1, 2, 3, 4, 5, 6], overnight: true, maxLunchMinutes: 0, fixedLunchDeductMinutes: 0 });
    const n = F.makeUser({ managerId: boss.id, name: 'شبکار' });
    db.prepare('UPDATE users SET shift_id = ? WHERE id = ?').run(night.id, n.id);
    assert.equal(report.reportDateFor(n, at(addDays(SAT, 1), '03:00')), SAT, 'ساعت ۳ بامداد یکشنبه = شیفت شنبه');
    assert.equal(report.reportDateFor(n, at(SAT, '23:00')), SAT);
    const t = mk(n, SAT, 'کار شب');
    const list = report.getDailyTasks(n, { now: at(addDays(SAT, 1), '03:00') });
    assert.equal(list.date, SAT);
    assert.deepEqual(list.tasks.map((x) => x.title), ['کار شب']);
    db.prepare('UPDATE users SET shift_id = NULL WHERE id = ?').run(n.id);
  });

  test('کاربر تازه‌وارد وسط هفته و planGateStartDate: قبل از تاریخ شروع گیت اعمال نمی‌شود', () => {
    reset();
    const gate = require('../src/services/planGateService');
    const settings = require('../src/repositories/settingsRepository');
    settings.setValue('planGateMode', 'enforce');
    const fresh = F.makeUser({ managerId: boss.id, name: 'تازه‌وارد' });
    try {
      settings.setValue('planGateStartDate', addDays(THU, 1));
      assert.equal(gate.evaluate(fresh, THU).applies, false, 'قبل از شروع');
      settings.setValue('planGateStartDate', THU);
      assert.equal(gate.evaluate(fresh, THU).applies, true, 'روز ثبت برنامه و بعد از شروع');
      assert.equal(gate.check(fresh, THU).action, 'block');
    } finally { settings.resetValue('planGateMode'); settings.resetValue('planGateStartDate'); }
  });
});

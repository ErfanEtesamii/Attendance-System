// D9 (بخش اول): تسک سیستمی review_team_reports، «مشاهده‌ی گزارش» و اتصال آن به گزارش روزانه/گیت خروج.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const F = require('./helpers/factories');
const { startServer } = require('./helpers/miniappClient');

let hasDeps = true;
try { require.resolve('express'); } catch (_) { hasDeps = false; }

// تاریخ‌های ثابت برای قواعد تقویم (بدون مشاهده‌ی واقعی): شنبه ۲۰۲۶-۰۸-۰۸ ⇒ روز قبل = پنجشنبه ۰۸-۰۶ (نیم‌روزِ کاری)
const SAT = '2026-08-08';
const THU = '2026-08-06';
const WED = '2026-08-05';

describe('تسک سیستمی و مشاهده‌ی گزارش تیم (D9-الف)', () => {
  let db; let svc; let report; let plans; let logs; let reviews; let holidays; let settings; let weekly; let audit; let attendance;
  let TODAY; let MON; let SUN; // دوشنبه‌ی اخیر (≤ امروز) و یکشنبه‌ی قبلش؛ برای مسیرهایی که سقف ۶۰ روزه/«امروز» سرور دخیل است
  let boss; let a; let b; let c; let hr; let admin; let plain;
  const addDays = (d, n) => require('../src/utils/shiftDay').addDays(d, n);

  const reset = () => {
    db.exec('DELETE FROM report_reviews; DELETE FROM task_daily_logs; DELETE FROM plan_tasks; DELETE FROM weekly_plans; DELETE FROM holidays; DELETE FROM leave_approvals; DELETE FROM leave_requests; DELETE FROM audit_log;');
  };
  // گزارشِ یک عضو در یک روز (یک تسک + پاسخ done)
  const reportOf = (user, date, status = 'done') => {
    const plan = plans.getOrCreate(user.id, require('../src/engine/calendarService').weekStartOf(date, 6));
    const t = plans.addTask(plan.id, { title: `کار ${user.id}-${date}`, plannedDate: date });
    logs.upsert({ taskId: t.id, userId: user.id, logDate: date, status, reasonCode: status === 'done' ? null : 'no_time' });
    return t;
  };
  const sysTask = (user, date) => {
    const plan = plans.findByUserWeek(user.id, require('../src/engine/calendarService').weekStartOf(date, 6));
    return plan ? plans.findSystemTaskOnDate(plan.id, svc.REVIEW_KEY, date) : null;
  };
  const review = (reviewer, subject, date, extra = {}) => svc.markReviewed(reviewer, { subjectUserId: subject.id, reportDate: date, ...extra });

  before(() => {
    db = resetDb();
    svc = require('../src/services/teamReviewService');
    report = require('../src/services/taskReportService');
    plans = require('../src/repositories/weeklyPlanRepository');
    logs = require('../src/repositories/taskLogRepository');
    reviews = require('../src/repositories/reportReviewRepository');
    holidays = require('../src/repositories/holidaysRepository');
    settings = require('../src/repositories/settingsRepository');
    weekly = require('../src/services/weeklyPlanService');
    audit = require('../src/repositories/auditRepository');
    attendance = require('../src/repositories/attendanceRepository');
    // ساعت را روی یک دوشنبه ثابت می‌کنیم: markReviewed تسکِ «امروز» سرپرست را همگام می‌کند، پس MON باید برابر «امروز» باشد
    // (وگرنه تست فقط روزهای دوشنبه پاس می‌شد).
    mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-12T08:00:00Z') });
    TODAY = require('../src/utils/serverTime').todayDateString();
    MON = TODAY;
    while (new Date(`${MON}T00:00:00Z`).getUTCDay() !== 1) MON = addDays(MON, -1);
    SUN = addDays(MON, -1);
    boss = F.makeUser({ role: 'manager', name: 'سرپرست' });
    a = F.makeUser({ managerId: boss.id, name: 'الف' });
    b = F.makeUser({ managerId: boss.id, name: 'ب' });
    c = F.makeUser({ managerId: boss.id, name: 'ج' });
    hr = F.makeUser({ role: 'hr' });
    admin = F.makeUser({ role: 'admin' });
    plain = F.makeUser({ name: 'بدون سرپرست' });
    settings.setValue('dailyReportGateMode', 'enforce');
  });
  after(() => { mock.timers.reset(); cleanup(); });

  // ---------- روز قبل و ساخت تسک ----------

  test('روز قبل = آخرین روز کاری: شنبه ⇒ پنجشنبه (نیم‌روز)، پنجشنبه تعطیل ⇒ چهارشنبه، یکشنبه ⇒ شنبه', () => {
    reset();
    assert.equal(svc.reviewDateFor(boss, SAT), THU);
    assert.equal(svc.reviewDateFor(boss, '2026-08-02'), '2026-08-01');
    holidays.addHoliday(THU, 'تعطیلی تست');
    assert.equal(svc.reviewDateFor(boss, SAT), WED);
  });

  test('نقش و اسکوپ: فقط manager/admin دارای زیردست تسک می‌گیرند', () => {
    reset();
    assert.ok(svc.ensureTask(boss, SAT));
    assert.equal(svc.ensureTask(a, SAT), null); // کارمند
    assert.equal(svc.ensureTask(hr, SAT), null); // hr فقط‌خواندنی
    assert.equal(svc.ensureTask(admin, SAT), null); // ادمینِ بدون زیردست
    const lone = F.makeUser({ role: 'manager' });
    assert.equal(svc.ensureTask(lone, SAT), null); // سرپرستِ بدون تیم
    const sub = F.makeUser({ managerId: admin.id });
    const t = svc.ensureTask(admin, SAT); // ادمینِ دارای زیردست
    assert.ok(t);
    assert.deepEqual(svc.teamOf(admin).map((u) => u.id), [sub.id]);
    db.prepare('UPDATE users SET manager_id = NULL WHERE id = ?').run(sub.id);
  });

  test('تسک: سیستمی، با planned_date، idempotent، غیرقابل‌حذف و بدون اثر روی شمارش حداقل تسک‌ها', () => {
    reset();
    const t1 = svc.ensureTask(boss, SAT);
    const t2 = svc.ensureTask(boss, SAT);
    assert.equal(t1.id, t2.id);
    assert.equal(t1.is_system, 1);
    assert.equal(t1.system_key, 'review_team_reports');
    assert.equal(t1.planned_date, SAT);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM plan_tasks WHERE system_key = 'review_team_reports'").get().n, 1);
    // روز دیگر ⇒ تسکِ جدا
    assert.notEqual(svc.ensureTask(boss, '2026-08-09').id, t1.id);
    // ذخیره‌ی پیش‌نویس با فهرست خالی، تسک سیستمی را حذف نمی‌کند
    weekly.saveDraft(boss, 'current', [], { now: new Date(`${SAT}T08:00:00Z`) });
    assert.ok(sysTask(boss, SAT));
  });

  test('ساخته نمی‌شود: روزِ غیرکاری سرپرست، سرپرست در مرخصی تمام‌روز، ماه بسته، یا کل تیم آن روز تعطیل/مرخصی بودند', () => {
    reset();
    assert.equal(svc.ensureTask(boss, '2026-08-07'), null); // جمعه
    F.makeApprovedMission(boss.id, SAT);
    assert.equal(svc.ensureTask(boss, SAT), null);
    db.exec('DELETE FROM leave_approvals; DELETE FROM leave_requests;');
    const mc = require('../src/repositories/monthClosuresRepository');
    const orig = mc.findClosedOverlapping;
    mc.findClosedOverlapping = () => [{ id: 1 }];
    try { assert.equal(svc.ensureTask(boss, SAT), null); } finally { mc.findClosedOverlapping = orig; }
    // کل تیم در مرخصی/ماموریتِ تمام‌روزِ «روز قبل» (پنجشنبه) و بدون گزارش
    for (const m of [a, b, c]) F.makeApprovedMission(m.id, THU);
    assert.equal(svc.ensureTask(boss, SAT), null);
    // فقط یک عضو سرِ کار بود ⇒ ساخته می‌شود
    db.exec('DELETE FROM leave_approvals; DELETE FROM leave_requests;');
    F.makeApprovedMission(a.id, THU); F.makeApprovedMission(b.id, THU);
    assert.ok(svc.ensureTask(boss, SAT));
    db.exec('DELETE FROM leave_approvals; DELETE FROM leave_requests;');
  });

  // ---------- وضعیت و شرط done ----------

  test('وضعیت اعضا: reviewed / unreviewed / no_report / off؛ complete فقط به اعضای «دارای گزارش» نگاه می‌کند', () => {
    reset();
    reportOf(a, THU); reportOf(b, THU); // c گزارش نداده
    reviews.upsert({ reviewerId: boss.id, subjectUserId: b.id, reportDate: THU });
    let s = svc.reviewState(boss, THU);
    const st = Object.fromEntries(s.members.map((m) => [m.fullName, m.status]));
    assert.deepEqual(st, { 'الف': 'unreviewed', 'ب': 'reviewed', 'ج': 'no_report' });
    assert.equal(s.complete, false);
    assert.equal(s.reportCount, 2);
    assert.equal(s.reviewedCount, 1);
    assert.deepEqual(s.noReport.map((m) => m.userId), [c.id]);
    reviews.upsert({ reviewerId: boss.id, subjectUserId: a.id, reportDate: THU });
    s = svc.reviewState(boss, THU);
    assert.equal(s.complete, true); // «ج» (گزارش‌نداده) شرط نیست
    assert.deepEqual(s.noReport.map((m) => m.userId), [c.id]);
    // مرخصیِ تمام‌روز و بدون گزارش ⇒ off
    F.makeApprovedMission(c.id, THU);
    assert.equal(svc.reviewState(boss, THU).members.find((m) => m.userId === c.id).status, 'off');
    db.exec('DELETE FROM leave_approvals; DELETE FROM leave_requests;');
  });

  test('مشاهده‌ی دیگران/سرپرستِ دیگر مؤثر نیست؛ تیمِ غیرفعال حساب نمی‌شود', () => {
    reset();
    reportOf(a, THU);
    const other = F.makeUser({ role: 'manager' });
    reviews.upsert({ reviewerId: other.id, subjectUserId: a.id, reportDate: THU });
    assert.equal(svc.reviewState(boss, THU).complete, false);
    db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(a.id);
    assert.equal(svc.reviewState(boss, THU).complete, true);
    db.prepare('UPDATE users SET is_active = 1 WHERE id = ?').run(a.id);
  });

  // ---------- اتصال به گزارش روزانه و گیت خروج ----------

  test('daily-tasks سرپرست: تسک سیستمی می‌آید؛ پس از مشاهده‌ی همه‌ی دارای‌گزارش‌ها done خودکار می‌شود و از فهرست بیرون می‌رود', () => {
    reset();
    reportOf(a, SUN); reportOf(b, SUN); // c گزارش نداده
    let r = report.getDailyTasks(boss, { date: MON });
    const t = r.tasks.find((x) => x.systemKey === 'review_team_reports');
    assert.ok(t && t.isSystem === true);
    assert.equal(logs.listByUserDate(boss.id, MON).length, 0);

    assert.equal(review(boss, a, SUN).ok, true);
    assert.ok(report.getDailyTasks(boss, { date: MON }).tasks.some((x) => x.id === t.id)); // هنوز ب مانده
    assert.equal(review(boss, b, SUN).ok, true);

    const log = logs.findByTaskDate(t.id, MON);
    assert.equal(log.status, 'done');
    assert.equal(log.encouragement_text, null);
    r = report.getDailyTasks(boss, { date: MON });
    assert.ok(!r.tasks.some((x) => x.id === t.id));
    assert.ok(r.answered.some((x) => x.taskId === t.id && x.status === 'done'));
  });

  test('گیت خروج (enforce): تسکِ مشاهده‌نشده ⇒ block؛ با مشاهده ⇒ allow', () => {
    reset();
    reportOf(a, SUN);
    let g = report.checkoutGate(boss, MON, {});
    assert.equal(g.action, 'block');
    assert.ok(g.pendingTasks.some((x) => x.systemKey === 'review_team_reports'));
    review(boss, a, SUN);
    g = report.checkoutGate(boss, MON, {});
    assert.equal(g.action, 'allow');
    assert.deepEqual(g.pendingTasks, []);
  });

  test('تیم بدون هیچ گزارش: شرط done خودبه‌خود برقرار است (مسدود نمی‌شود)', () => {
    reset();
    assert.equal(report.checkoutGate(boss, MON, {}).action, 'allow');
    assert.equal(logs.listByUserDate(boss.id, MON).filter((l) => l.status === 'done').length, 1);
  });

  test('پاسخ دستیِ «انجام شد» رد می‌شود؛ «انجام نشد + علت» پذیرفته می‌شود؛ انتقال/حذف رد می‌شود', () => {
    reset();
    reportOf(a, SUN);
    const t = report.getDailyTasks(boss, { date: MON }).tasks.find((x) => x.isSystem);
    assert.equal(report.submitDailyReport(boss, { answers: [{ taskId: t.id, status: 'done' }] }, { date: MON }).code, 'REVIEW_INCOMPLETE');
    assert.equal(report.submitDailyReport(boss, { answers: [{ taskId: t.id, status: 'not_done', reasonCode: 'no_time', reschedule: { type: 'tomorrow' } }] }, { date: MON }).code, 'RESCHEDULE_NOT_ALLOWED');
    assert.equal(report.submitDailyReport(boss, { answers: [{ taskId: t.id, status: 'not_done', reasonCode: 'no_time' }] }, { date: MON }).ok, true);
    assert.equal(logs.findByTaskDate(t.id, MON).status, 'not_done');
    assert.equal(report.checkoutGate(boss, MON, {}).action, 'allow'); // پاسخ داده شد
  });

  test('«انجام نشد» قبلی با مشاهده‌ی کامل بعدی به done ارتقا می‌یابد', () => {
    reset();
    reportOf(a, SUN);
    const t = report.getDailyTasks(boss, { date: MON }).tasks.find((x) => x.isSystem);
    report.submitDailyReport(boss, { answers: [{ taskId: t.id, status: 'not_done', reasonCode: 'no_time' }] }, { date: MON });
    review(boss, a, SUN);
    const log = logs.findByTaskDate(t.id, MON);
    assert.equal(log.status, 'done');
    assert.equal(log.reason_code, null);
  });

  test('کارمند عادی تسک سیستمی نمی‌گیرد', () => {
    reset();
    assert.ok(!report.getDailyTasks(a, { date: MON }).tasks.some((x) => x.isSystem));
  });

  // ---------- markReviewed: اعتبارسنجی و امنیت ----------

  test('نقش و اسکوپ: کارمند/hr رد؛ سرپرست فقط تیم خودش؛ admin هر کاربرِ دیگر؛ خودمشاهده‌ای ممنوع', () => {
    reset();
    reportOf(a, SUN); reportOf(plain, SUN);
    assert.equal(review(a, b, SUN).code, 'FORBIDDEN');
    assert.equal(review(hr, a, SUN).code, 'FORBIDDEN');
    assert.equal(review(boss, plain, SUN).code, 'SUBJECT_NOT_IN_SCOPE'); // عضو تیم نیست
    assert.equal(review(boss, boss, SUN).code, 'SUBJECT_NOT_IN_SCOPE');
    assert.equal(review(admin, admin, SUN).code, 'SUBJECT_NOT_IN_SCOPE');
    assert.equal(review(admin, plain, SUN).ok, true);
    assert.equal(review(admin, a, SUN).ok, true);
    assert.equal(review(boss, a, SUN).ok, true);
    assert.equal(svc.markReviewed(boss, { subjectUserId: 99999, reportDate: SUN }).code, 'USER_NOT_FOUND');
  });

  test('اعتبارسنجی ورودی: شناسه، تاریخ، آینده، قدیمی، بدون گزارش، واکنش، طول کامنت، ماه بسته', () => {
    reset();
    reportOf(a, SUN);
    assert.equal(svc.markReviewed(boss, { subjectUserId: 'x', reportDate: SUN }).code, 'INVALID_SUBJECT');
    assert.equal(svc.markReviewed(boss, null).code, 'INVALID_SUBJECT');
    assert.equal(svc.markReviewed(boss, { subjectUserId: a.id, reportDate: '2026-13-40' }).code, 'INVALID_DATE');
    assert.equal(svc.markReviewed(boss, { subjectUserId: a.id }).code, 'INVALID_DATE');
    assert.equal(review(boss, a, addDays(TODAY, 1)).code, 'DATE_IN_FUTURE');
    assert.equal(review(boss, a, addDays(TODAY, -61)).code, 'DATE_TOO_OLD');
    assert.equal(review(boss, b, SUN).code, 'NO_REPORT');
    assert.equal(review(boss, a, SUN, { reaction: 'angry' }).code, 'INVALID_REACTION');
    assert.equal(review(boss, a, SUN, { comment: 'ا'.repeat(301) }).code, 'COMMENT_TOO_LONG');
    const mc = require('../src/repositories/monthClosuresRepository');
    const orig = mc.findClosedOverlapping;
    mc.findClosedOverlapping = () => [{ id: 1 }];
    try { assert.equal(review(boss, a, SUN).code, 'MONTH_CLOSED'); } finally { mc.findClosedOverlapping = orig; }
    assert.equal(reviews.listBySubjectDate(a.id, SUN).length, 0); // هیچ‌کدام چیزی ننوشتند
  });

  test('idempotent: مشاهده‌ی دوباره ردیف تازه نمی‌سازد؛ کامنت/واکنش به‌روز می‌شود؛ audit فقط هنگام تغییر', () => {
    reset();
    reportOf(a, SUN);
    const countAudit = () => db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action = 'report_reviewed'").get().n;
    const r1 = review(boss, a, SUN);
    assert.equal(r1.ok, true);
    assert.equal(r1.review.comment, null);
    assert.equal(countAudit(), 1);
    review(boss, a, SUN); // تکرار بدون تغییر
    assert.equal(countAudit(), 1);
    const r3 = review(boss, a, SUN, { comment: '  آفرین   <b>عالی</b>  ', reaction: 'great' });
    assert.equal(r3.review.reaction, 'great');
    assert.ok(r3.review.comment.startsWith('آفرین'));
    assert.ok(!/\s{2,}/.test(r3.review.comment));
    assert.equal(countAudit(), 2);
    review(boss, a, SUN); // بدون کامنت ⇒ کامنت قبلی پاک نمی‌شود
    assert.equal(reviews.find(boss.id, a.id, SUN).reaction, 'great');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM report_reviews').get().n, 1);
    const ev = db.prepare("SELECT details FROM audit_log WHERE action = 'report_reviewed' ORDER BY id").all().map((x) => JSON.parse(x.details));
    assert.equal(ev[0].firstTime, true);
    assert.equal(ev[1].reaction, 'great');
  });

  test('پاسخ markReviewed: وضعیت تازه‌ی تیم برمی‌گردد', () => {
    reset();
    reportOf(a, SUN); reportOf(b, SUN);
    const r = review(boss, a, SUN);
    assert.equal(r.state.reviewedCount, 1);
    assert.equal(r.state.complete, false);
    assert.equal(r.state.unreviewed.length, 1);
  });

  test('getTeamReview: نقش، تاریخ نامعتبر، پیش‌فرض «روز قبل» و تاریخ دلخواه', () => {
    reset();
    assert.equal(svc.getTeamReview(a).code, 'FORBIDDEN');
    assert.equal(svc.getTeamReview(boss, { date: 'x' }).code, 'INVALID_DATE');
    assert.equal(svc.getTeamReview(boss, { date: addDays(TODAY, 2) }).code, 'DATE_IN_FUTURE');
    assert.equal(svc.getTeamReview(boss, { date: addDays(TODAY, -90) }).code, 'DATE_TOO_OLD');
    reportOf(a, SUN);
    const r = svc.getTeamReview(boss, { date: SUN });
    assert.equal(r.ok, true);
    assert.equal(r.reviewDate, SUN);
    assert.equal(r.members.find((m) => m.userId === a.id).status, 'unreviewed');
    const dflt = svc.getTeamReview(boss);
    assert.equal(dflt.reviewDate, svc.reviewDateFor(boss, attendance.currentRecordDate(boss.id)));
  });

  test('خطا در ساخت/همگام‌سازی تسک سیستمی گزارش/خروج را نمی‌شکند (fail-open)', () => {
    reset();
    const orig = plans.getOrCreate;
    plans.getOrCreate = () => { throw new Error('boom'); };
    const origErr = console.error; console.error = () => {};
    try {
      assert.equal(report.getDailyTasks(boss, { date: MON }).ok, true);
      assert.equal(report.checkoutGate(boss, MON, {}).failedOpen, undefined);
    } finally { plans.getOrCreate = orig; console.error = origErr; }
  });
});

// ---------- Mini App API ----------
describe('API مشاهده‌ی گزارش تیم (D9-الف)', { skip: !hasDeps }, () => {
  let S; let db; let boss; let a; let hr; let other; let SUN;
  before(async () => {
    db = resetDb();
    const { todayDateString } = require('../src/utils/serverTime');
    const { addDays } = require('../src/utils/shiftDay');
    let mon = todayDateString();
    while (new Date(`${mon}T00:00:00Z`).getUTCDay() !== 1) mon = addDays(mon, -1);
    SUN = addDays(mon, -1);
    boss = F.makeUser({ role: 'manager' });
    a = F.makeUser({ managerId: boss.id });
    hr = F.makeUser({ role: 'hr' });
    other = F.makeUser({ role: 'manager' });
    const plans = require('../src/repositories/weeklyPlanRepository');
    const logs = require('../src/repositories/taskLogRepository');
    const plan = plans.getOrCreate(a.id, require('../src/engine/calendarService').weekStartOf(SUN, 6));
    const t = plans.addTask(plan.id, { title: 'کار', plannedDate: SUN });
    logs.upsert({ taskId: t.id, userId: a.id, logDate: SUN, status: 'done' });
    S = await startServer();
  });
  after(() => { if (S) S.close(); cleanup(); });

  test('GET /team-review و POST /report-reviews: نقش‌ها، اسکوپ، موفق و idempotent', async () => {
    assert.equal((await S.call(a, 'GET', 'team-review')).status, 403);
    assert.equal((await S.call(hr, 'GET', 'team-review')).status, 403);
    assert.equal((await S.call(a, 'POST', 'report-reviews', { subjectUserId: a.id, reportDate: SUN })).status, 403);
    assert.equal((await S.call(other, 'POST', 'report-reviews', { subjectUserId: a.id, reportDate: SUN })).status, 403);
    assert.equal((await S.call(boss, 'POST', 'report-reviews', { subjectUserId: a.id })).status, 400);
    assert.equal((await S.call(boss, 'POST', 'report-reviews', { subjectUserId: 99999, reportDate: SUN })).status, 404);
    let g = await S.call(boss, 'GET', `team-review?date=${SUN}`);
    assert.equal(g.status, 200);
    assert.equal(g.json.complete, false);
    assert.equal((await S.call(boss, 'GET', 'team-review?date=bad')).status, 400);
    const r = await S.call(boss, 'POST', 'report-reviews', { subjectUserId: a.id, reportDate: SUN, comment: 'ممنون', reaction: 'thanks' });
    assert.equal(r.status, 200);
    assert.equal(r.json.state.complete, true);
    assert.equal((await S.call(boss, 'POST', 'report-reviews', { subjectUserId: a.id, reportDate: SUN })).status, 200);
    g = await S.call(boss, 'GET', `team-review?date=${SUN}`);
    assert.equal(g.json.members[0].status, 'reviewed');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM report_reviews').get().n, 1);
  });
});

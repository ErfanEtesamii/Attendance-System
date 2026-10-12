// D9 (بخش دوم): پاسخ ۴۰۹ گیت خروج سرپرست (مشاهده‌نشده‌ها / گزارش‌نداده‌ها جدا)، اعلان کامنت، backfill روزهای گذشته،
// route پنل و دسترسی‌ها، و UI منطقِ خالصِ ویزارد (dailyReport.js).
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const F = require('./helpers/factories');
const { startServer } = require('./helpers/miniappClient');

// تلگرامِ واقعی در تست نباید صدا زده شود: notificationService در require اول، sendMessage را از همین ماژول برمی‌دارد.
const notifier = require('../src/bot/notifier');
const telegramSent = [];
notifier.sendMessage = async (id, text) => { telegramSent.push({ id: String(id), text }); return true; };

const DR = require('../public/js/dailyReport.js');

let hasDeps = true;
try { require.resolve('express'); } catch (_) { hasDeps = false; }

const flush = () => new Promise((r) => setImmediate(r)).then(() => new Promise((r) => setImmediate(r)));

describe('گیت خروج، اعلان و backfill سرپرست (D9-ب)', () => {
  let db; let svc; let report; let plans; let logs; let settings; let attendance; let cal; let addDays;
  let boss; let a; let b; let hr; let TODAY; let MON; let SUN;
  const reset = () => {
    db.exec('DELETE FROM notifications; DELETE FROM report_reviews; DELETE FROM task_daily_logs; DELETE FROM plan_tasks; DELETE FROM weekly_plans; DELETE FROM holidays; DELETE FROM leave_approvals; DELETE FROM leave_requests; DELETE FROM attendance_records; DELETE FROM audit_log;');
    settings.setValue('dailyReportGateMode', 'enforce');
    settings.setValue('reportBackfillDays', 3);
    telegramSent.length = 0;
  };
  const mkTask = (user, date, title, extra = {}) => plans.addTask(plans.getOrCreate(user.id, cal.weekStartOf(date, 6)).id, { title, plannedDate: date, ...extra });
  const answer = (user, date, task, status, reasonCode = null, reasonText = null) => logs.upsert({ taskId: task.id, userId: user.id, logDate: date, status, reasonCode, reasonText });
  const review = (reviewer, subject, date, extra = {}) => svc.markReviewed(reviewer, { subjectUserId: subject.id, reportDate: date, ...extra });
  const notifRows = (user) => db.prepare("SELECT * FROM notifications WHERE user_id = ? AND type = 'report_commented' ORDER BY id").all(user.id);

  before(() => {
    db = resetDb();
    svc = require('../src/services/teamReviewService');
    report = require('../src/services/taskReportService');
    plans = require('../src/repositories/weeklyPlanRepository');
    logs = require('../src/repositories/taskLogRepository');
    settings = require('../src/repositories/settingsRepository');
    attendance = require('../src/repositories/attendanceRepository');
    cal = require('../src/engine/calendarService');
    ({ addDays } = require('../src/utils/shiftDay'));
    TODAY = require('../src/utils/serverTime').todayDateString();
    MON = TODAY;
    while (new Date(`${MON}T00:00:00Z`).getUTCDay() !== 1) MON = addDays(MON, -1);
    SUN = addDays(MON, -1);
    boss = F.makeUser({ role: 'manager', name: 'سرپرست' });
    a = F.makeUser({ managerId: boss.id, name: 'الف' });
    b = F.makeUser({ managerId: boss.id, name: 'ب' });
    hr = F.makeUser({ role: 'hr' });
  });
  after(cleanup);

  test('gateInfo: مشاهده‌نشده‌ها (با خلاصه‌ی گزارش) و گزارش‌نداده‌ها جدا از هم؛ بدون تسک سیستمی ⇒ null', () => {
    reset();
    const t1 = mkTask(a, SUN, 'گزارش مالی'); const t2 = mkTask(a, SUN, 'تماس با مشتری'); const ex = mkTask(a, SUN, 'کار اضطراری', { systemKey: 'out_of_plan' });
    answer(a, SUN, t1, 'done'); answer(a, SUN, t2, 'not_done', 'no_time', 'درگیر جلسه بودم'); answer(a, SUN, ex, 'done');
    const task = svc.ensureTask(boss, MON);
    assert.ok(task);
    const pending = [{ id: task.id, systemKey: svc.REVIEW_KEY }];
    const info = svc.gateInfo(boss, MON, pending);
    assert.equal(info.reviewDate, SUN);
    assert.deepEqual(info.unreviewed.map((m) => m.userId), [a.id]);
    assert.deepEqual(info.noReport.map((m) => m.userId), [b.id]); // روز کاری بوده ولی گزارش نداده
    const r = info.unreviewed[0].report;
    assert.deepEqual([r.total, r.done, r.notDone, r.extra, r.percent], [2, 1, 1, 1, 50]);
    const notDone = r.items.find((i) => i.status === 'not_done');
    assert.deepEqual([notDone.title, notDone.reasonCode, notDone.reasonText], ['تماس با مشتری', 'no_time', 'درگیر جلسه بودم']);
    assert.equal(r.items.find((i) => i.outOfPlan).title, 'کار اضطراری');
    assert.equal(svc.gateInfo(boss, MON, []), null);
    assert.equal(svc.gateInfo(boss, MON, [{ id: 1, systemKey: 'other' }]), null);
    assert.equal(svc.gateInfo(a, MON, pending), null); // کارمند عادی
    review(boss, a, SUN);
    const after2 = svc.gateInfo(boss, MON, pending);
    assert.deepEqual(after2.unreviewed, []);
    assert.deepEqual(after2.noReport.map((m) => m.userId), [b.id]);
  });

  test('checkoutGate (enforce): پاسخ ۴۰۹ شامل teamReview است؛ بعد از مشاهده allow و بدون teamReview', () => {
    reset();
    answer(a, SUN, mkTask(a, SUN, 'کار'), 'done');
    const g = report.checkoutGate(boss, MON, {});
    assert.equal(g.action, 'block');
    assert.deepEqual(g.teamReview.unreviewed.map((m) => m.userId), [a.id]);
    assert.deepEqual(g.teamReview.noReport.map((m) => m.userId), [b.id]);
    assert.equal(g.teamReview.taskId, g.pendingTasks.find((t) => t.systemKey === svc.REVIEW_KEY).id);
    review(boss, a, SUN);
    const ok = report.checkoutGate(boss, MON, {});
    assert.equal(ok.action, 'allow');
    assert.equal(ok.teamReview, undefined);
  });

  test('«انجام نشد + علت» برای تسک سیستمی خروج را باز می‌کند؛ بدون انتقال؛ «انجام شد» و انتقال رد می‌شود', () => {
    reset();
    answer(a, SUN, mkTask(a, SUN, 'کار'), 'done');
    const sys = report.checkoutGate(boss, MON, {}).pendingTasks.find((t) => t.systemKey === svc.REVIEW_KEY);
    const body = (x) => ({ answers: [{ taskId: sys.id, ...x }] });
    assert.equal(report.checkoutGate(boss, MON, body({ status: 'done' })).code, 'REVIEW_INCOMPLETE');
    assert.equal(report.checkoutGate(boss, MON, body({ status: 'not_done', reasonCode: 'no_time', reschedule: { type: 'tomorrow' } })).code, 'RESCHEDULE_NOT_ALLOWED');
    assert.equal(report.checkoutGate(boss, MON, body({ status: 'not_done' })).code, 'REASON_REQUIRED');
    // همان شکلی که UI می‌فرستد (DR.buildBody): بدون reschedule
    const ui = DR.buildBody({ tasks: [{ id: sys.id, systemKey: sys.systemKey }], answers: { [sys.id]: { status: 'not_done', reasonCode: 'no_time', reasonText: '', resType: 'tomorrow', resDate: '' } } }, { today: MON });
    const g = report.checkoutGate(boss, MON, ui);
    assert.equal(g.action, 'allow');
    assert.equal(g.report.answers[0].status, 'not_done');
    assert.equal(g.report.answers[0].rescheduleTo, null);
  });

  test('getDailyTasks: teamReview فقط برای سرپرستِ دارای تسک سیستمی', () => {
    reset();
    answer(a, SUN, mkTask(a, SUN, 'کار'), 'done');
    const d = report.getDailyTasks(boss, { date: MON });
    assert.ok(d.tasks.some((t) => t.systemKey === svc.REVIEW_KEY));
    assert.deepEqual(d.teamReview.unreviewed.map((m) => m.userId), [a.id]);
    assert.equal(report.getDailyTasks(a, { date: MON }).teamReview, null);
    review(boss, a, SUN);
    const d2 = report.getDailyTasks(boss, { date: MON });
    assert.equal(d2.teamReview, null); // تسک done شد و از فهرست بیرون رفت
    assert.ok(!d2.tasks.some((t) => t.systemKey === svc.REVIEW_KEY));
  });

  test('getTeamReview: با detail خلاصه‌ی گزارش می‌آید؛ بدون detail نه', () => {
    reset();
    answer(a, SUN, mkTask(a, SUN, 'کار'), 'done');
    const plain = svc.getTeamReview(boss, { date: SUN });
    assert.equal(plain.members.find((m) => m.userId === a.id).report, undefined);
    const det = svc.getTeamReview(boss, { date: SUN, detail: true });
    assert.equal(det.members.find((m) => m.userId === a.id).report.total, 1);
    assert.equal(det.members.find((m) => m.userId === b.id).report, undefined); // گزارش‌نداده
    assert.equal(svc.statusOf('SUBJECT_NOT_IN_SCOPE'), 403);
    assert.equal(svc.statusOf('MONTH_CLOSED'), 409);
    assert.equal(svc.statusOf('INVALID_DATE'), 400);
  });

  test('اعلان کامنت: درون‌پنلی + تلگرام به کارمند؛ dedupe برای همان متن؛ ویرایش اعلان تازه؛ بدون کامنت/فقط واکنش ⇒ هیچ', async () => {
    reset();
    answer(a, SUN, mkTask(a, SUN, 'کار'), 'done');
    review(boss, a, SUN, { reaction: 'like' }); // فقط واکنش
    await flush();
    assert.equal(notifRows(a).length, 0);
    review(boss, a, SUN, { comment: 'خسته نباشید، گزارش عالی بود', reaction: 'great' });
    await flush();
    const rows = notifRows(a);
    assert.equal(rows.length, 1);
    assert.match(rows[0].body, /گزارش عالی بود/);
    assert.match(rows[0].body, /سرپرست/);
    assert.equal(telegramSent.filter((m) => m.id === String(a.telegram_user_id)).length, 1);
    assert.match(telegramSent[0].text, /گزارش عالی بود/);
    assert.equal(notifRows(b).length, 0); // فقط خودِ کارمند
    assert.equal(notifRows(boss).length, 0);
    review(boss, a, SUN, { comment: 'خسته نباشید، گزارش عالی بود' }); // همان کامنت
    await flush();
    assert.equal(notifRows(a).length, 1);
    assert.equal(telegramSent.length, 1);
    review(boss, a, SUN, { comment: 'یک نکته: ساعت جلسه را هم بنویسید' }); // ویرایش
    await flush();
    assert.equal(notifRows(a).length, 2);
    review(boss, a, SUN, {}); // بدون کامنت ⇒ کامنت قبلی می‌ماند و اعلان تازه نمی‌آید
    await flush();
    assert.equal(notifRows(a).length, 2);
  });

  test('خطای اعلان، «مشاهده شد» را نمی‌شکند', () => {
    reset();
    answer(a, SUN, mkTask(a, SUN, 'کار'), 'done');
    const ev = require('../src/services/notificationEvents');
    const orig = ev.reportCommented;
    ev.reportCommented = () => { throw new Error('boom'); };
    try {
      const r = review(boss, a, SUN, { comment: 'سلام' });
      assert.equal(r.ok, true);
      assert.equal(db.prepare('SELECT COUNT(*) n FROM report_reviews').get().n, 1);
    } finally { ev.reportCommented = orig; }
  });

  test('getBackfillStatus: تسک سیستمیِ روزهای گذشته ساخته می‌شود و در pendingCount می‌آید', () => {
    reset();
    // روزِ کاریِ گذشته‌ی بسته‌شده‌ی خودکار (رکورد بدون خروج) در بازه‌ی backfill
    const D = [-1, -2, -3].map((n) => addDays(TODAY, n)).find((d) => cal.getCalendarDay(boss, d, { settings: settings.getAll() }).isWorkingDay);
    assert.ok(D, 'روز کاری برای تست پیدا نشد');
    attendance.createManual({ userId: boss.id, recordDate: D, checkInTime: `${D}T05:00:00.000Z`, checkOutTime: null, status: 'incomplete' });
    const prev = svc.reviewDateFor(boss, D);
    answer(a, prev, mkTask(a, prev, 'کار قبلی'), 'done');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM plan_tasks WHERE is_system = 1').get().n, 0); // هنوز ساخته نشده
    const s = report.getBackfillStatus(boss);
    const day = s.days.find((x) => x.date === D);
    assert.ok(day, JSON.stringify(s));
    assert.equal(day.pendingCount, 1);
    assert.ok(day.titles.includes(svc.TITLE));
    assert.equal(db.prepare('SELECT COUNT(*) n FROM plan_tasks WHERE is_system = 1').get().n >= 1, true);
    // idempotent: دوباره صدا زدن تسک تازه نمی‌سازد
    const n1 = db.prepare('SELECT COUNT(*) n FROM plan_tasks WHERE is_system = 1').get().n;
    report.getBackfillStatus(boss);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM plan_tasks WHERE is_system = 1').get().n, n1);
    // بعد از مشاهده، تسک done خودکار می‌شود و روز از بنر بیرون می‌رود
    review(boss, a, prev);
    assert.equal(report.getBackfillStatus(boss).days.some((x) => x.date === D), false);
    // کارمند عادی تسک سیستمی نمی‌گیرد
    attendance.createManual({ userId: a.id, recordDate: D, checkInTime: `${D}T05:00:00.000Z`, checkOutTime: null, status: 'incomplete' });
    assert.equal(report.getBackfillStatus(a).days.length, 0);
  });

  test('backfill: خطا در ساخت تسک سیستمی، بنر را نمی‌شکند (fail-open)', () => {
    reset();
    const D = [-1, -2, -3].map((n) => addDays(TODAY, n)).find((d) => cal.getCalendarDay(boss, d, { settings: settings.getAll() }).isWorkingDay);
    attendance.createManual({ userId: boss.id, recordDate: D, checkInTime: `${D}T05:00:00.000Z`, checkOutTime: null, status: 'incomplete' });
    const orig = plans.getOrCreate;
    plans.getOrCreate = () => { throw new Error('boom'); };
    const quiet = console.error; console.error = () => {};
    try { assert.equal(report.getBackfillStatus(boss).ok, true); } finally { plans.getOrCreate = orig; console.error = quiet; }
  });
});

describe('منطق خالصِ UI ویزارد برای تسک سیستمی (dailyReport.js)', () => {
  const sys = { id: 7, systemKey: 'review_team_reports' };
  const normal = { id: 8, systemKey: null };
  const nd = { status: 'not_done', reasonCode: 'no_time', reasonText: '', resType: 'tomorrow', resDate: '' };

  test('تسک سیستمی: فقط «انجام نشد + علت»؛ بدون reschedule در بدنه؛ تسک عادی دست‌نخورده', () => {
    assert.equal(DR.isReviewTask(sys), true);
    assert.equal(DR.isReviewTask(normal), false);
    assert.ok(DR.validateAnswer({ status: 'done' }, { reviewTask: true }));
    assert.ok(DR.validateAnswer({ status: 'partial', reasonCode: 'no_time', resType: 'tomorrow' }, { reviewTask: true }));
    assert.equal(DR.validateAnswer(nd, { reviewTask: true }), '');
    assert.ok(DR.validateAnswer({ ...nd, reasonCode: 'other', reasonText: 'کم' }, { reviewTask: true })); // «سایر» ⇒ حداقل ۵ نویسه
    const body = DR.buildBody({ tasks: [sys, normal], answers: { 7: nd, 8: { ...nd } } }, { today: '2026-08-06' });
    assert.equal(body.answers[0].reschedule, undefined);
    assert.deepEqual(body.answers[1].reschedule, { type: 'tomorrow' });
    assert.ok(!DR.validateAnswer({ ...nd, resType: '' }, { reviewTask: true })); // نوع انتقال برای تسک سیستمی بی‌اهمیت است
    assert.ok(DR.validateAnswer({ ...nd, resType: '' }, {})); // ولی برای تسک عادی خطاست
  });

  test('unanswered/taskOpts: «انجام شد» روی تسک سیستمی پاسخِ معتبر حساب نمی‌شود', () => {
    assert.deepEqual(DR.unanswered([sys], { 7: { status: 'done' } }, {}).map((t) => t.id), [7]);
    assert.deepEqual(DR.unanswered([sys], { 7: nd }, {}), []);
    assert.deepEqual(DR.taskOpts(sys, { today: 'x' }), { today: 'x', reviewTask: true });
    assert.deepEqual(DR.taskOpts(normal, { today: 'x' }), { today: 'x' });
  });

  test('reportLine / validateReview / buildReviewBody', () => {
    assert.equal(DR.reportLine({ total: 5, done: 4, percent: 80, extra: 0 }), '۴ از ۵ انجام شد (۸۰٪)');
    assert.equal(DR.reportLine({ total: 5, done: 4, percent: 80, extra: 2 }), '۴ از ۵ انجام شد (۸۰٪) · ۲ کار خارج از برنامه');
    assert.equal(DR.reportLine({ total: 0, done: 0, percent: null, extra: 1 }), 'تسک برنامه‌ریزی‌شده ندارد · ۱ کار خارج از برنامه');
    assert.equal(DR.reportLine(null), '');
    assert.equal(DR.validateReview({ comment: 'x'.repeat(300), reaction: 'like' }), '');
    assert.ok(DR.validateReview({ comment: 'x'.repeat(301) }));
    assert.ok(DR.validateReview({ reaction: 'angry' }));
    assert.deepEqual(DR.buildReviewBody({ subjectUserId: 3, reportDate: '2026-08-06', comment: '  ', reaction: '' }), { subjectUserId: 3, reportDate: '2026-08-06' });
    assert.deepEqual(DR.buildReviewBody({ subjectUserId: 3, reportDate: '2026-08-06', comment: ' ممنون ', reaction: 'thanks' }), { subjectUserId: 3, reportDate: '2026-08-06', comment: 'ممنون', reaction: 'thanks' });
  });

  test('کلید تسک سیستمی و واکنش‌ها با سرور هم‌خوان است', () => {
    const svc = require('../src/services/teamReviewService');
    assert.equal(DR.REVIEW_KEY, svc.REVIEW_KEY);
    assert.deepEqual(DR.REVIEW_REACTIONS.map((r) => r.value), svc.REACTIONS);
    assert.equal(DR.LIMITS.reviewComment, svc.COMMENT_MAX);
  });
});

describe('UI ویزارد خروج سرپرست — بررسی ساختاری (D9-ب)', () => {
  const fs = require('fs');
  const path = require('path');
  const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

  test('app.js: کارت تسک سیستمی، مرحله‌ی «team»، فراخوانی APIها و عبور teamReview به ویزارد', () => {
    const js = read('public/js/app.js');
    for (const s of ['الان بررسی می‌کنم', '❌ انجام نشد + علت', "ui.step === 'team'", "/team-review?detail=1", "'/report-reviews'", 'refreshAfterReview', 'DR.isReviewTask(t)', 'مشاهده‌نشده (', 'گزارش نداده‌اند (شرط تکمیل نیست)']) {
      assert.ok(js.includes(s), `app.js باید شامل «${s}» باشد`);
    }
    // هر چهار ورودیِ ویزارد (۴۰۹ خروج، soft، گزارش دیرهنگام، ادامه پس از مشاهده‌ی همه) teamReview را پاس می‌دهند
    assert.equal((js.match(/teamReview: (err\.data|d)\.teamReview/g) || []).length, 4);
    // برای تسک سیستمی گزینه‌ی انتقال/حذف نمایش داده نمی‌شود
    assert.ok(/if \(!isReview\) \{[^]*?این تسک چه شود؟/.test(js));
  });

  test('CSS کلاس‌های جدید را دارد و dailyReport.js قبل از app.js بارگذاری می‌شود', () => {
    const css = read('public/css/style.css');
    for (const c of ['.rv-group', '.rv-member', '.rv-items']) assert.ok(css.includes(c), c);
    const html = read('public/index.html');
    assert.ok(html.indexOf('/js/dailyReport.js') > -1 && html.indexOf('/js/dailyReport.js') < html.indexOf('/js/app.js'));
  });
});

describe('API پنل و Mini App — مشاهده‌ی گزارش تیم (D9-ب)', { skip: hasDeps ? false : 'express نصب نیست (npm install)' }, () => {
  let S; let db; let settings; let admin; let boss; let a; let b; let other; let hr; let outsider; let TODAY; let SUN;
  const admCall = async (user, method, p, body) => {
    const res = await fetch(`${S.base}/api/admin/${p}`, {
      method, headers: { 'content-type': 'application/json', cookie: F.sessionCookie(user.id), ...F.CSRF_HEADERS }, body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  };

  before(async () => {
    db = resetDb();
    settings = require('../src/repositories/settingsRepository');
    const { addDays } = require('../src/utils/shiftDay');
    TODAY = require('../src/utils/serverTime').todayDateString();
    let mon = TODAY;
    while (new Date(`${mon}T00:00:00Z`).getUTCDay() !== 1) mon = addDays(mon, -1);
    SUN = addDays(mon, -1);
    admin = F.makeUser({ role: 'admin' });
    boss = F.makeUser({ role: 'manager' });
    a = F.makeUser({ managerId: boss.id });
    b = F.makeUser({ managerId: boss.id });
    other = F.makeUser({ role: 'manager' });
    outsider = F.makeUser({ managerId: other.id });
    hr = F.makeUser({ role: 'hr' });
    const plans = require('../src/repositories/weeklyPlanRepository');
    const logs = require('../src/repositories/taskLogRepository');
    const cal = require('../src/engine/calendarService');
    for (const u of [a, outsider]) {
      const t = plans.addTask(plans.getOrCreate(u.id, cal.weekStartOf(SUN, 6)).id, { title: 'کار', plannedDate: SUN });
      logs.upsert({ taskId: t.id, userId: u.id, logDate: SUN, status: 'done' });
    }
    S = await startServer();
  });
  after(() => { if (S) S.close(); cleanup(); });

  test('GET /admin/team-review و POST /admin/report-reviews: نقش‌ها و اسکوپ', async () => {
    assert.equal((await admCall(a, 'GET', `team-review?date=${SUN}`)).status, 403); // کارمند
    assert.equal((await admCall(hr, 'GET', `team-review?date=${SUN}`)).status, 403); // hr
    assert.equal((await admCall(a, 'POST', 'report-reviews', { subjectUserId: a.id, reportDate: SUN })).status, 403);
    assert.equal((await admCall(hr, 'POST', 'report-reviews', { subjectUserId: a.id, reportDate: SUN })).status, 403);
    const g = await admCall(boss, 'GET', `team-review?date=${SUN}`);
    assert.equal(g.status, 200);
    assert.deepEqual(g.json.members.map((m) => m.userId).sort(), [a.id, b.id].sort()); // فقط تیم خودش
    assert.equal(g.json.members.find((m) => m.userId === a.id).report.total, 1); // پنل همیشه detail دارد
    assert.equal((await admCall(boss, 'GET', 'team-review?date=bad')).status, 400);
    const outRes = await admCall(boss, 'POST', 'report-reviews', { subjectUserId: outsider.id, reportDate: SUN });
    assert.equal(outRes.status, 403);
    assert.equal(outRes.json.code, 'SUBJECT_NOT_IN_SCOPE');
    assert.equal((await admCall(boss, 'POST', 'report-reviews', { subjectUserId: 999999, reportDate: SUN })).status, 404);
    assert.equal((await admCall(boss, 'POST', 'report-reviews', { subjectUserId: b.id, reportDate: SUN })).status, 404); // گزارش ندارد
    const ok = await admCall(boss, 'POST', 'report-reviews', { subjectUserId: a.id, reportDate: SUN, comment: 'ممنون', reaction: 'thanks' });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.state.members.find((m) => m.userId === a.id).status, 'reviewed');
    assert.equal((await admCall(admin, 'POST', 'report-reviews', { subjectUserId: outsider.id, reportDate: SUN })).status, 200); // ادمین هر کاربرِ دیگر
    assert.equal((await admCall(admin, 'GET', `team-review?date=${SUN}`)).status, 200);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action = 'report_reviewed'").get().n, 2);
  });

  test('گیت خروج سرپرست: ۴۰۹ با teamReview؛ ترتیب «گزارش ← برنامه‌ی هفته‌ی بعد ← خروج» (روز ثبت برنامه)', async (t) => {
    const cal = require('../src/engine/calendarService');
    const logsRepo = require('../src/repositories/taskLogRepository');
    const plans = require('../src/repositories/weeklyPlanRepository');
    const svc = require('../src/services/teamReviewService');
    const gateBoss = F.makeUser({ role: 'manager' });
    if (!cal.getCalendarDay(gateBoss, TODAY, { settings: settings.getAll() }).isWorkingDay) return t.skip('امروز روز کاری نیست');
    const m1 = F.makeUser({ managerId: gateBoss.id }); const m2 = F.makeUser({ managerId: gateBoss.id });
    const prev = svc.reviewDateFor(gateBoss, TODAY);
    const task = plans.addTask(plans.getOrCreate(m1.id, cal.weekStartOf(prev, 6)).id, { title: 'کار', plannedDate: prev });
    logsRepo.upsert({ taskId: task.id, userId: m1.id, logDate: prev, status: 'done' });
    settings.setValue('dailyReportGateMode', 'enforce');
    settings.setValue('planGateMode', 'enforce');
    db.exec("DELETE FROM settings WHERE key = 'plan_gate_start_date'");
    settings.setValue('planSubmissionWeekday', String(cal.weekdayOf(TODAY)));

    assert.equal((await S.call(gateBoss, 'POST', 'check-in', {})).status, 201);
    const r1 = await S.call(gateBoss, 'POST', 'check-out', {});
    assert.equal(r1.status, 409);
    assert.equal(r1.json.code, 'daily_report_required'); // گزارش قبل از برنامه‌ی هفته‌ی بعد
    assert.deepEqual(r1.json.teamReview.unreviewed.map((m) => m.userId), [m1.id]);
    assert.deepEqual(r1.json.teamReview.noReport.map((m) => m.userId), [m2.id]);
    const rv = await S.call(gateBoss, 'POST', 'report-reviews', { subjectUserId: m1.id, reportDate: prev, comment: 'دستتان درد نکند' });
    assert.equal(rv.status, 200);
    assert.equal(rv.json.state.complete, true);
    const r2 = await S.call(gateBoss, 'POST', 'check-out', {});
    assert.equal(r2.status, 409);
    assert.equal(r2.json.code, 'weekly_plan_required'); // حالا نوبت برنامه
    assert.equal((await S.call(gateBoss, 'PUT', 'plan', { week: 'next', tasks: [{ title: 'کار هفته' }] })).status, 200);
    assert.equal((await S.call(gateBoss, 'POST', 'plan/submit', { week: 'next' })).status, 200);
    const ok = await S.call(gateBoss, 'POST', 'check-out', {});
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    const d = await S.call(gateBoss, 'GET', 'daily-tasks');
    assert.equal(d.json.teamReview, null);
  });

  test('GET /miniapp/team-review?detail=1 خلاصه‌ی گزارش می‌دهد', async () => {
    const plain = await S.call(boss, 'GET', `team-review?date=${SUN}`);
    assert.equal(plain.json.members.find((m) => m.userId === a.id).report, undefined);
    const det = await S.call(boss, 'GET', `team-review?date=${SUN}&detail=1`);
    assert.equal(det.json.members.find((m) => m.userId === a.id).report.total, 1);
  });
});

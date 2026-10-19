// فاز ۱۱ — A1: قانون اولویت در گیت خروج (high/normal الزامی؛ low اختیاری) + A2: هماهنگی مصرف‌کننده‌های «pending»
// (backfill، گزارش شبانه، خلاصه‌ی صبحگاهی، منطق ویزارد UI و پیام ۴۰۹).
// تست‌ها به روز هفته/ساعت واقعی وابسته نیستند: تاریخ‌ها ثابت‌اند و جایی که «امروز» مهم است Date با mock.timers ثابت می‌شود.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const F = require('./helpers/factories');
const { startServer } = require('./helpers/miniappClient');
const { zonedTimeToUtc } = require('../src/utils/time');

let hasDeps = true;
try { require.resolve('express'); } catch (_) { hasDeps = false; }

const WEEK = '2026-08-01'; // شنبه
const MON = '2026-08-03'; // روز گزارش (کاری)

describe('A1 — گیت خروج بر اساس اولویت (سرویس)', () => {
  let db; let svc; let plans; let logs; let settings; let u;
  const reset = () => {
    db.exec('DELETE FROM task_daily_logs; DELETE FROM plan_tasks; DELETE FROM weekly_plans; DELETE FROM leave_approvals; DELETE FROM leave_requests;');
    settings.setValue('dailyReportGateMode', 'enforce');
  };
  const mk = (title, priority, extra = {}) => plans.addTask(plans.getOrCreate(u.id, WEEK).id, { title, plannedDate: MON, priority, ...extra });
  const gate = (body) => svc.checkoutGate(u, MON, body);

  before(() => {
    db = resetDb();
    svc = require('../src/services/taskReportService');
    plans = require('../src/repositories/weeklyPlanRepository');
    logs = require('../src/repositories/taskLogRepository');
    settings = require('../src/repositories/settingsRepository');
    u = F.makeUser();
  });
  after(cleanup);

  test('فقط تسک low ⇒ مانع نیست (allow)؛ در optionalTasks می‌آید نه pendingTasks', () => {
    reset();
    const low = mk('کم‌اهمیت', 'low');
    const g = gate(undefined);
    assert.equal(g.action, 'allow');
    assert.deepEqual(g.pendingTasks, []);
    assert.deepEqual(g.optionalTasks.map((t) => t.id), [low.id]);
    assert.equal(g.optionalTasks[0].optional, true);
  });

  test('high و normal مانع‌اند (به ترتیب اولویت)؛ low در pendingTasks شمرده نمی‌شود', () => {
    reset();
    const low = mk('کم', 'low'); const normal = mk('عادی', 'normal'); const high = mk('مهم', 'high');
    const g = gate(undefined);
    assert.equal(g.action, 'block');
    assert.deepEqual(g.pendingTasks.map((t) => t.id), [high.id, normal.id]);
    assert.ok(g.pendingTasks.every((t) => t.optional === false));
    assert.deepEqual(g.optionalTasks.map((t) => t.id), [low.id]);
    // پاسخ‌دادن فقط به یکی از الزامی‌ها هنوز مسدود است؛ بعد از هر دو، حتی با low بی‌پاسخ، allow
    const g1 = gate({ answers: [{ taskId: high.id, status: 'done' }] });
    assert.equal(g1.action, 'block');
    assert.deepEqual(g1.pendingTasks.map((t) => t.id), [normal.id]);
    const g2 = gate({ answers: [{ taskId: high.id, status: 'done' }, { taskId: normal.id, status: 'done' }] });
    assert.equal(g2.action, 'allow');
    assert.deepEqual(g2.pendingTasks, []);
    assert.deepEqual(g2.optionalTasks.map((t) => t.id), [low.id]);
  });

  test('not_done و partial همراه با علت خروج را آزاد می‌کنند؛ بدون علت ⇒ invalid', () => {
    reset();
    const normal = mk('عادی', 'normal'); const high = mk('مهم', 'high');
    assert.equal(gate({ answers: [{ taskId: normal.id, status: 'not_done' }] }).code, 'REASON_REQUIRED');
    assert.equal(gate({ answers: [{ taskId: high.id, status: 'partial' }] }).code, 'REASON_REQUIRED');
    const g = gate({ answers: [
      { taskId: high.id, status: 'not_done', reasonCode: 'blocked_by_others', reschedule: { type: 'tomorrow' } },
      { taskId: normal.id, status: 'partial', reasonCode: 'other', reasonText: 'نصفه ماند' },
    ] });
    assert.equal(g.action, 'allow');
    assert.deepEqual(g.pendingTasks, []);
    // «سایر» بدون توضیح کافی هنوز رد می‌شود (قانون علت تغییری نکرده)
    assert.equal(gate({ answers: [{ taskId: normal.id, status: 'not_done', reasonCode: 'other', reasonText: 'x' }] }).code, 'REASON_TEXT_REQUIRED');
  });

  test('پاسخ تسک low (اگر کاربر بدهد) مثل قبل ذخیره می‌شود، با پیام تشویقی؛ برای low «انجام نشد» هم علت لازم است', () => {
    reset();
    const normal = mk('عادی', 'normal'); const low = mk('کم', 'low');
    assert.equal(gate({ answers: [{ taskId: low.id, status: 'not_done' }] }).code, 'REASON_REQUIRED');
    const g = gate({ answers: [{ taskId: normal.id, status: 'done' }, { taskId: low.id, status: 'done' }] });
    assert.equal(g.action, 'allow');
    assert.equal(g.report.answers.length, 2);
    const res = svc.commitAtomic(u, g, () => 'out');
    assert.equal(res, 'out');
    const row = logs.findByTaskDate(low.id, MON);
    assert.equal(row.status, 'done');
    assert.ok(row.encouragement_text, 'پیام تشویقیِ پاسخ low ذخیره می‌شود');
    assert.ok(g.report.encouragements.some((e) => e.taskId === low.id));
    assert.equal(gate({}).action, 'allow'); // بعد از ثبت، گیت idempotent است
  });

  test('تسک سیستمی هیچ‌وقت اختیاری نیست (حتی با priority=low) و مثل قبل مانع است', () => {
    reset();
    const sys = mk('سیستمی', 'low', { isSystem: true, systemKey: 'review_team_reports' });
    const g = gate(undefined);
    assert.equal(g.action, 'block');
    assert.deepEqual(g.pendingTasks.map((t) => [t.id, t.optional, t.isSystem]), [[sys.id, false, true]]);
    assert.deepEqual(g.optionalTasks, []);
  });

  test('soft: فقط low ⇒ allow (نه remind)؛ low + normal ⇒ remind فقط با normal', () => {
    reset();
    settings.setValue('dailyReportGateMode', 'soft');
    mk('کم', 'low');
    assert.equal(gate({}).action, 'allow');
    const n = mk('عادی', 'normal');
    const g = gate({});
    assert.equal(g.action, 'remind');
    assert.deepEqual(g.pendingTasks.map((t) => t.id), [n.id]);
  });

  test('off: گیت اعمال نمی‌شود (با هر اولویتی)', () => {
    reset();
    settings.setValue('dailyReportGateMode', 'off');
    mk('عادی', 'normal'); mk('کم', 'low');
    const g = gate({});
    assert.equal(g.action, 'allow');
    assert.deepEqual(g.pendingTasks, []);
  });

  test('getDailyTasks: low در فهرست با optional:true و بعد از الزامی‌ها؛ submitDailyReport پاسخ low را می‌پذیرد', () => {
    reset();
    const low = mk('کم', 'low'); const normal = mk('عادی', 'normal'); const high = mk('مهم', 'high');
    const d = svc.getDailyTasks(u, { date: MON });
    assert.deepEqual(d.tasks.map((t) => [t.id, t.optional]), [[high.id, false], [normal.id, false], [low.id, true]]);
    const r = svc.submitDailyReport(u, { answers: [{ taskId: low.id, status: 'done' }] }, { date: MON });
    assert.equal(r.ok, true);
    assert.equal(r.saved.answers, 1);
    assert.deepEqual(r.tasks.map((t) => t.id), [high.id, normal.id]);
  });

  test('blockMessage: نام تسک‌های مانع + کار لازم (انجام یا علت)؛ تسک low در متن نیست', () => {
    reset();
    mk('کم‌اهمیت‌ترین', 'low'); mk('گزارش مالی', 'normal'); mk('پیگیری قرارداد', 'high');
    const g = gate(undefined);
    const msg = svc.blockMessage(g.pendingTasks);
    assert.match(msg, /^برای ثبت خروج/);
    assert.match(msg, /2 تسک با اولویت بالا یا عادی/);
    assert.match(msg, /«پیگیری قرارداد»/);
    assert.match(msg, /«گزارش مالی»/);
    assert.match(msg, /انجام شد/);
    assert.match(msg, /علت/);
    assert.match(msg, /اولویت کم مانع خروج نیستند/);
    assert.doesNotMatch(msg, /کم‌اهمیت‌ترین/);
  });

  test('blockMessage: بیش از ۵ تسک ⇒ «و N مورد دیگر»؛ عنوان بلند کوتاه می‌شود؛ تسک سیستمی راهنمای مشاهده دارد؛ لیست خالی ⇒ پیام عمومی', () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ id: i + 1, title: `تسک ${i + 1}`, systemKey: null }));
    const msg = svc.blockMessage(many);
    assert.match(msg, /7 تسک/);
    assert.match(msg, /و 2 مورد دیگر/);
    assert.doesNotMatch(msg, /تسک 6/);
    assert.match(svc.blockMessage([{ id: 1, title: 'ن'.repeat(100), systemKey: null }]), /ن{39}…»/);
    assert.match(svc.blockMessage([{ id: 1, title: 'بررسی گزارش روز قبلِ تیم', systemKey: 'review_team_reports' }]), /مشاهده‌ی گزارش‌ها یا ثبت علت/);
    assert.match(svc.blockMessage([]), /علتش را بنویسید/);
    assert.match(svc.blockMessage(undefined), /علتش را بنویسید/);
  });
});

describe('A2 — backfill (getBackfillStatus) با تسک low و normal', () => {
  let db; let svc; let plans; let settings; let attendance; let u;
  const TODAY = '2026-08-04'; const YEST = '2026-08-03';
  const mk = (date, title, priority) => plans.addTask(plans.getOrCreate(u.id, WEEK).id, { title, plannedDate: date, priority });

  before(() => {
    mock.timers.enable({ apis: ['Date'], now: new Date(`${TODAY}T09:00:00.000Z`) });
    db = resetDb();
    svc = require('../src/services/taskReportService');
    plans = require('../src/repositories/weeklyPlanRepository');
    settings = require('../src/repositories/settingsRepository');
    attendance = require('../src/repositories/attendanceRepository');
    u = F.makeUser();
  });
  after(() => { mock.timers.reset(); cleanup(); });

  test('فقط low بی‌پاسخ ⇒ روز در بنر نمی‌آید؛ با یک normal ⇒ pendingCount فقط الزامی‌ها را می‌شمارد', () => {
    db.exec('DELETE FROM task_daily_logs; DELETE FROM plan_tasks; DELETE FROM weekly_plans; DELETE FROM attendance_records;');
    settings.setValue('dailyReportGateMode', 'soft');
    settings.setValue('reportBackfillDays', 2);
    attendance.createManual({ userId: u.id, recordDate: YEST, checkInTime: `${YEST}T05:00:00.000Z`, checkOutTime: null, status: 'incomplete' }); // خودکار-بسته
    mk(YEST, 'کم ۱', 'low'); mk(YEST, 'کم ۲', 'low');
    assert.deepEqual(svc.getBackfillStatus(u).days, []);
    mk(YEST, 'عادی', 'normal');
    const s = svc.getBackfillStatus(u);
    assert.deepEqual(s.days.map((d) => [d.date, d.source, d.pendingCount, d.titles]), [[YEST, 'backfill', 1, ['عادی']]]);
    // با پاسخ به تسک عادی، روز از بنر می‌رود (low بی‌پاسخ می‌ماند و مهم نیست)
    const normal = svc.getDailyTasks(u, { requestedDate: YEST }).tasks.find((t) => t.title === 'عادی');
    svc.submitDailyReport(u, { answers: [{ taskId: normal.id, status: 'done' }] }, { requestedDate: YEST });
    assert.deepEqual(svc.getBackfillStatus(u).days, []);
    // ولی در فهرست روز (برای پاسخ اختیاری) هنوز هستند
    assert.deepEqual(svc.getDailyTasks(u, { requestedDate: YEST }).tasks.map((t) => [t.title, t.optional]), [['کم ۱', true], ['کم ۲', true]]);
  });
});

describe('A2 — گزارش شبانه با تسک low و normal', () => {
  let db; let svc; let plans; let logs; let boss; let a; let b; let admin;
  const wk = (d) => require('../src/engine/calendarService').weekStartOf(d, 6);
  const task = (user, title, priority, status, extra = {}) => {
    const t = plans.addTask(plans.getOrCreate(user.id, wk(MON)).id, { title, plannedDate: MON, priority });
    if (status) logs.upsert({ taskId: t.id, userId: user.id, logDate: MON, status, ...extra });
    return t;
  };
  const reset = () => db.exec('DELETE FROM settings; DELETE FROM report_reviews; DELETE FROM task_daily_logs; DELETE FROM plan_tasks; DELETE FROM weekly_plans; DELETE FROM notifications;');
  const textFor = (reviewer) => { const r = svc.buildNightlyTaskReports(MON).find((x) => x.reviewer.id === reviewer.id); return r ? r.messages.join('\n') : ''; };

  before(() => {
    db = resetDb();
    svc = require('../src/services/nightlyTaskReportService');
    plans = require('../src/repositories/weeklyPlanRepository');
    logs = require('../src/repositories/taskLogRepository');
    admin = F.makeUser({ role: 'admin', name: 'ادمین' });
    boss = F.makeUser({ role: 'manager', name: 'سرپرست', managerId: admin.id });
    a = F.makeUser({ managerId: boss.id, name: 'علی' });
    b = F.makeUser({ managerId: boss.id, name: 'بهزاد' });
  });
  after(cleanup);

  test('عضوی که فقط تسک low بی‌پاسخ دارد در گزارش نمی‌آید؛ با تسک normal بی‌پاسخ «⏳ N بدون وضعیت» می‌خورد (H1)', () => {
    reset();
    task(a, 'کم', 'low', null);
    assert.equal(textFor(boss), '', 'گزارشی برای سرپرست ساخته نمی‌شود: تسک low معطل/هشدار نیست');
    task(a, 'عادی', 'normal', null);
    assert.match(textFor(boss), /علی — 0 از 1 انجام شد · ⏳ 1 بدون وضعیت/);
  });

  test('گزارش‌داده: low بی‌پاسخ در شمارش/درصد نمی‌آید؛ low پاسخ‌داده مثل قبل حساب می‌شود', () => {
    reset();
    task(a, 'عادی', 'normal', 'done');
    task(a, 'کم بی‌پاسخ', 'low', null);
    task(b, 'عادیِ ب', 'high', 'done');
    task(b, 'کمِ ب', 'low', 'not_done', { reasonCode: 'no_time', rescheduleTo: '2026-08-04' });
    const text = textFor(boss);
    assert.match(text, /علی — 1 از 1 انجام شد \(100٪\)/);
    assert.doesNotMatch(text, /علی — گزارش نداده/);
    assert.doesNotMatch(text, /کم بی‌پاسخ/);
    assert.match(text, /بهزاد — 1 از 2 انجام شد \(50٪\)/);
    assert.match(text, /✗ کمِ ب — وقت نشد/);
  });
});

describe('A2 — خلاصه‌ی صبحگاهی با تسک low و normal', () => {
  let db; let md; let plans; let logs; let boss; let a; let b;
  const TUE = '2026-08-04';
  const at = (d, h) => zonedTimeToUtc(d, h, 'Asia/Tehran');
  const wk = (d) => require('../src/engine/calendarService').weekStartOf(d, 6);
  const add = (user, title, priority) => plans.addTask(plans.getOrCreate(user.id, wk(MON)).id, { title, plannedDate: MON, priority });
  const reset = () => db.exec('DELETE FROM report_reviews; DELETE FROM task_daily_logs; DELETE FROM plan_tasks; DELETE FROM weekly_plans; DELETE FROM job_runs;');

  before(() => {
    db = resetDb();
    md = require('../src/bot/scheduler/morningDigest');
    plans = require('../src/repositories/weeklyPlanRepository');
    logs = require('../src/repositories/taskLogRepository');
    boss = F.makeUser({ role: 'manager', name: 'سرپرست' });
    a = F.makeUser({ managerId: boss.id, name: 'علی' });
    b = F.makeUser({ managerId: boss.id, name: 'بهزاد' });
  });
  after(cleanup);

  test('تسک‌های بی‌پاسخ هشدارِ «دیرهنگام/مشاهده‌نشده» نمی‌سازند؛ فقط «وضعیت نهایی دیروز» (H3) در خلاصه می‌آید', () => {
    reset();
    add(a, 'کم', 'low'); add(a, 'عادی', 'normal'); add(b, 'مهم', 'high'); add(b, 'کمِ ب', 'low');
    const ds = md.buildMorningDigests({ now: at(TUE, '08:00') });
    assert.ok(ds.every((d) => d.late.length === 0 && d.unreviewed.length === 0));
  });

  test('پاسخ low که بعد از ارسال شبانه ثبت شود مثل هر پاسخ دیگری «دیرهنگام» گزارش می‌شود (اطلاعاتی، نه هشدار)', () => {
    reset();
    const t = add(a, 'کم', 'low');
    logs.upsert({ taskId: t.id, userId: a.id, logDate: MON, status: 'done' });
    db.prepare('UPDATE task_daily_logs SET answered_at = ? WHERE task_id = ?').run(at(MON, '22:30').toISOString(), t.id);
    const d = md.buildMorningDigests({ now: at(TUE, '08:00') });
    assert.equal(d.length, 1);
    assert.deepEqual(d[0].late, [a.id]);
  });
});

describe('A2 — منطق ویزارد UI (تسک اختیاری)', () => {
  const DR = require('../public/js/dailyReport.js');
  const root = path.join(__dirname, '..');
  const read = (f) => fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');
  const tasks = [{ id: 1, title: 'الف' }, { id: 2, title: 'ب', optional: true }, { id: 3, title: 'ج', optional: true }];
  const notDoneNoReason = { status: 'not_done', reasonCode: '', reasonText: '', resType: 'tomorrow', resDate: '' };

  test('isOptional فقط با optional===true؛ بدون فلگ (سرور قدیمی/تسک سیستمی) الزامی است', () => {
    assert.equal(DR.isOptional({ optional: true }), true);
    assert.equal(DR.isOptional({ optional: false }), false);
    assert.equal(DR.isOptional({}), false);
    assert.equal(DR.isOptional(null), false);
  });

  test('unanswered: اختیاریِ دست‌نخورده مانع نیست؛ اختیاریِ نیمه‌پر و نامعتبر مانع است؛ الزامی مثل قبل', () => {
    const answers = new Map([[2, notDoneNoReason]]);
    assert.deepEqual(DR.unanswered(tasks, answers).map((t) => t.id), [1, 2]);
    answers.set(1, { status: 'done' });
    answers.set(2, { status: 'done' });
    assert.deepEqual(DR.unanswered(tasks, answers).map((t) => t.id), []);
    assert.deepEqual(DR.unanswered(tasks, new Map()).map((t) => t.id), [1]);
  });

  test('summarize/skippedOptional: بدون‌پاسخِ اختیاری در missing نمی‌آید و جدا شمرده می‌شود', () => {
    const answers = new Map([[1, { status: 'done' }]]);
    assert.deepEqual(DR.summarize(tasks, answers), { done: 1, partial: 0, not_done: 0, missing: 0 });
    assert.equal(DR.skippedOptional(tasks, answers), 2);
    answers.set(2, { status: 'done' });
    assert.equal(DR.skippedOptional(tasks, answers), 1);
    assert.equal(DR.skippedOptional(tasks, new Map([[3, { status: '' }]])), 2); // پاسخِ خالی = رد شده
  });

  test('buildBody: پاسخ معتبرِ اختیاری ارسال می‌شود؛ ناقص/دست‌نخورده ارسال نمی‌شود', () => {
    const answers = new Map([[1, { status: 'done' }], [2, { status: 'done' }], [3, notDoneNoReason]]);
    assert.deepEqual(DR.buildBody({ tasks, answers, extras: [] }).answers.map((x) => x.taskId), [1, 2]);
  });

  test('Mini App: برچسب «اختیاری»، جداسازی، «رد کردن» و استفاده از optionalTasks در پاسخ ۴۰۹', () => {
    const app = read('public/js/app.js');
    assert.ok(app.includes("text: 'اختیاری'"), 'برچسب اختیاری');
    assert.ok(app.includes('(جدا از الزامی‌ها)'), 'جداسازی در مرحله‌ی سؤال');
    assert.ok(app.includes("'رد کردن'"), 'دکمه‌ی رد کردن');
    assert.ok(app.includes('err.data.optionalTasks'), '۴۰۹ ⇒ ویزارد با تسک‌های اختیاری');
    assert.ok(app.includes('DR.skippedOptional'), 'خلاصه‌ی مرور');
    assert.ok(/\.dr-tag\s*\{/.test(read('public/css/style.css')), 'استایل برچسب');
    const route = read('src/api/routes/miniapp.js');
    assert.ok(route.includes('taskReportService.blockMessage(reportGate.pendingTasks)'), 'پیام ۴۰۹ از blockMessage');
    assert.ok(route.includes('optionalTasks: reportGate.optionalTasks'), 'payload ۴۰۹');
  });
});

describe('A1 — پاسخ ۴۰۹ در API', { skip: hasDeps ? false : 'express نصب نیست (npm install)' }, () => {
  let S; let db; let plans; let settings;
  const { todayDateString } = require('../src/utils/serverTime');
  const cal = require('../src/engine/calendarService');
  const seed = (user, items) => {
    const today = todayDateString();
    const plan = plans.getOrCreate(user.id, cal.weekStartOf(today, 6));
    return items.map(([title, priority]) => plans.addTask(plan.id, { title, plannedDate: today, priority }));
  };
  const outTime = (user) => db.prepare('SELECT check_out_time FROM attendance_records WHERE user_id = ?').get(user.id).check_out_time;

  before(async () => {
    db = resetDb();
    plans = require('../src/repositories/weeklyPlanRepository');
    settings = require('../src/repositories/settingsRepository');
    S = await startServer();
  });
  after(() => { if (S) S.close(); cleanup(); });

  test('enforce: low بی‌پاسخ مانع نیست ⇒ خروج ۲۰۰', async () => {
    settings.setValue('dailyReportGateMode', 'enforce');
    const u = F.makeUser();
    seed(u, [['کم', 'low']]);
    assert.equal((await S.call(u, 'POST', 'check-in', {})).status, 201);
    const r = await S.call(u, 'POST', 'check-out', {});
    assert.equal(r.status, 200);
    assert.ok(outTime(u));
  });

  test('enforce: normal/high ⇒ ۴۰۹ با پیام شامل نام تسک‌های مانع؛ pendingTasks فقط الزامی‌ها و optionalTasks جدا', async () => {
    settings.setValue('dailyReportGateMode', 'enforce');
    const u = F.makeUser();
    const [, normal, high] = seed(u, [['کم', 'low'], ['گزارش مالی', 'normal'], ['پیگیری قرارداد', 'high']]);
    await S.call(u, 'POST', 'check-in', {});
    const r = await S.call(u, 'POST', 'check-out', {});
    assert.equal(r.status, 409);
    assert.equal(r.json.code, 'daily_report_required');
    assert.match(r.json.error, /«گزارش مالی»/);
    assert.match(r.json.error, /«پیگیری قرارداد»/);
    assert.match(r.json.error, /علت/);
    assert.doesNotMatch(r.json.error, /«کم»/);
    assert.deepEqual(r.json.pendingTasks.map((t) => t.id), [high.id, normal.id]);
    assert.deepEqual(r.json.optionalTasks.map((t) => t.title), ['کم']);
    assert.equal(outTime(u), null);
    // not_done + علت برای هر دو الزامی ⇒ آزاد
    const ok = await S.call(u, 'POST', 'check-out', { answers: [
      { taskId: high.id, status: 'done' },
      { taskId: normal.id, status: 'not_done', reasonCode: 'no_time', reschedule: { type: 'tomorrow' } },
    ] });
    assert.equal(ok.status, 200);
  });
});

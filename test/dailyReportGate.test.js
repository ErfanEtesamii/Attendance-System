// D7-الف: گیت خروجِ گزارش روزانه (taskReportService.checkoutGate/commitAtomic) + /check-out در Mini App.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const F = require('./helpers/factories');
const { startServer } = require('./helpers/miniappClient');

let hasDeps = true;
try { require.resolve('express'); } catch (_) { hasDeps = false; }

// هفته‌ی شنبه ۲۰۲۶-۰۸-۰۱؛ دوشنبه ۰۸-۰۳
const WEEK = '2026-08-01';
const MON = '2026-08-03';

describe('گیت خروجِ گزارش روزانه — سرویس (D7-الف)', () => {
  let db; let svc; let plans; let logs; let settings; let u;
  const reset = () => {
    db.exec('DELETE FROM task_daily_logs; DELETE FROM plan_tasks; DELETE FROM weekly_plans; DELETE FROM leave_approvals; DELETE FROM leave_requests;');
    settings.setValue('dailyReportGateMode', 'enforce');
  };
  const mk = (title, extra = {}) => plans.addTask(plans.getOrCreate(u.id, WEEK).id, { title, plannedDate: MON, ...extra });
  const gate = (body) => svc.checkoutGate(u, MON, body);
  const logCount = () => db.prepare('SELECT COUNT(*) AS n FROM task_daily_logs').get().n;

  before(() => {
    db = resetDb();
    svc = require('../src/services/taskReportService');
    plans = require('../src/repositories/weeklyPlanRepository');
    logs = require('../src/repositories/taskLogRepository');
    settings = require('../src/repositories/settingsRepository');
    u = F.makeUser();
  });
  after(cleanup);

  test('off ⇒ allow و بدون pending؛ بدون تسک در enforce هم allow', () => {
    reset();
    mk('الف');
    settings.setValue('dailyReportGateMode', 'off');
    const g = gate({});
    assert.equal(g.action, 'allow');
    assert.equal(g.report, null);
    assert.deepEqual(g.pendingTasks, []);
    settings.setValue('dailyReportGateMode', 'enforce');
    db.exec('DELETE FROM plan_tasks');
    assert.equal(gate({}).action, 'allow');
  });

  test('enforce: بدون پاسخ ⇒ block با pendingTasks؛ پاسخ جزئی ⇒ block با باقی‌مانده؛ کامل ⇒ allow', () => {
    reset();
    const a = mk('الف'); const b = mk('ب');
    const g0 = gate(undefined);
    assert.equal(g0.action, 'block');
    assert.deepEqual(g0.pendingTasks.map((t) => t.title), ['الف', 'ب']);
    const g1 = gate({ answers: [{ taskId: a.id, status: 'done' }] });
    assert.equal(g1.action, 'block');
    assert.deepEqual(g1.pendingTasks.map((t) => t.title), ['ب']);
    assert.equal(logCount(), 0); // مرحله‌ی تصمیم چیزی نمی‌نویسد
    const g2 = gate({ answers: [{ taskId: a.id, status: 'done' }, { taskId: b.id, status: 'not_done', reasonCode: 'no_time' }] });
    assert.equal(g2.action, 'allow');
    assert.equal(g2.report.answers.length, 2);
    assert.deepEqual(g2.pendingTasks, []);
    assert.equal(logCount(), 0);
  });

  test('soft: remind با pendingTasks (خروج مجاز)؛ همه پاسخ‌داده ⇒ allow', () => {
    reset();
    settings.setValue('dailyReportGateMode', 'soft');
    const a = mk('الف'); const b = mk('ب');
    const g = gate({ answers: [{ taskId: a.id, status: 'done' }] });
    assert.equal(g.action, 'remind');
    assert.deepEqual(g.pendingTasks.map((t) => t.id), [b.id]);
    assert.ok(g.report);
    assert.equal(gate({ answers: [{ taskId: a.id, status: 'done' }, { taskId: b.id, status: 'done' }] }).action, 'allow');
  });

  test('بدنه‌ی نامعتبر ⇒ invalid با کد؛ تسکِ دیگران/پاسخ‌داده‌شده رد می‌شود', () => {
    reset();
    const a = mk('الف');
    assert.equal(gate({ answers: 'x' }).code, 'INVALID_ANSWERS');
    assert.equal(gate({ answers: [{ taskId: a.id, status: 'not_done' }] }).code, 'REASON_REQUIRED');
    assert.equal(gate({ answers: [{ taskId: 9999, status: 'done' }] }).code, 'TASK_NOT_FOUND');
    assert.equal(gate({ answers: [{ taskId: a.id, status: 'done' }, { taskId: a.id, status: 'done' }] }).code, 'DUPLICATE_ANSWER');
    assert.equal(gate({ answers: [{ taskId: a.id, status: 'done' }, { taskId: a.id, status: 'done' }] }).action, 'invalid');
    logs.upsert({ taskId: a.id, userId: u.id, logDate: MON, status: 'done' });
    assert.equal(gate({ answers: [{ taskId: a.id, status: 'done' }] }).code, 'ALREADY_ANSWERED');
  });

  test('پاسخ‌های قبلی (از /daily-report) حساب می‌شوند: همه پاسخ‌داده ⇒ allow بدون ارسال دوباره', () => {
    reset();
    const a = mk('الف');
    svc.submitDailyReport(u, { answers: [{ taskId: a.id, status: 'done' }] }, { date: MON });
    const g = gate({});
    assert.equal(g.action, 'allow');
    assert.equal(g.report, null);
  });

  test('مرخصی/ماموریت تمام‌روز: گیت اعمال نمی‌شود؛ ارسال گزارش ⇒ FULL_DAY_OFF', () => {
    reset();
    const a = mk('الف');
    F.makeApprovedMission(u.id, MON);
    assert.equal(gate({}).action, 'allow');
    assert.equal(gate({ answers: [{ taskId: a.id, status: 'done' }] }).code, 'FULL_DAY_OFF');
    db.exec('DELETE FROM leave_approvals; DELETE FROM leave_requests;');
  });

  test('ماه بسته: گیت اعمال نمی‌شود؛ ارسال گزارش ⇒ MONTH_CLOSED', () => {
    reset();
    const a = mk('الف');
    const mc = require('../src/repositories/monthClosuresRepository');
    const orig = mc.findClosedOverlapping;
    mc.findClosedOverlapping = () => [{ id: 1 }];
    try {
      assert.equal(gate({}).action, 'allow');
      assert.equal(gate({ answers: [{ taskId: a.id, status: 'done' }] }).code, 'MONTH_CLOSED');
    } finally { mc.findClosedOverlapping = orig; }
  });

  test('«خارج از برنامه» در گیت: ذخیره می‌شود ولی تسکِ pending را پاسخ نمی‌دهد', () => {
    reset();
    mk('الف');
    const g = gate({ extra: [{ title: 'جلسه‌ی فوری' }] });
    assert.equal(g.action, 'block');
    assert.equal(g.report.extras.length, 1);
    assert.equal(g.pendingTasks.length, 1);
  });

  test('commitAtomic: گزارش و خروج با هم ثبت می‌شوند؛ خطا در خروج ⇒ rollback کامل (هیچ پاسخی ذخیره نمی‌شود)', () => {
    reset();
    const a = mk('الف');
    const g = gate({ answers: [{ taskId: a.id, status: 'done' }], extra: [{ title: 'اضافه' }] });
    assert.equal(g.action, 'allow');
    let ran = false;
    assert.throws(() => svc.commitAtomic(u, g, () => { ran = true; throw new Error('boom'); }), /boom/);
    assert.equal(ran, true);
    assert.equal(logCount(), 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM plan_tasks WHERE system_key = 'out_of_plan'").get().n, 0);
    const res = svc.commitAtomic(u, g, () => 'checked-out');
    assert.equal(res, 'checked-out');
    assert.equal(logCount(), 2);
    assert.equal(logs.findByTaskDate(a.id, MON).status, 'done');
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM plan_tasks WHERE system_key = 'out_of_plan'").get().n, 1);
  });

  test('commitAtomic بدون گزارش فقط fn را اجرا می‌کند؛ بعد از ثبت، گیت دوباره allow است (idempotent)', () => {
    reset();
    const a = mk('الف');
    assert.equal(svc.commitAtomic(u, { report: null }, () => 7), 7);
    const g = gate({ answers: [{ taskId: a.id, status: 'done' }] });
    svc.commitAtomic(u, g, () => null);
    assert.equal(gate({}).action, 'allow');
    assert.equal(logCount(), 1);
  });
});

describe('گیت خروجِ گزارش روزانه — API (D7-الف)', { skip: hasDeps ? false : 'express نصب نیست (npm install)' }, () => {
  let S; let db; let plans; let settings;
  const { todayDateString } = require('../src/utils/serverTime');
  const cal = require('../src/engine/calendarService');
  const seed = (user, titles) => {
    const today = todayDateString();
    const plan = plans.getOrCreate(user.id, cal.weekStartOf(today, 6));
    return titles.map((title) => plans.addTask(plan.id, { title, plannedDate: today }));
  };
  const outTime = (user) => db.prepare('SELECT check_out_time FROM attendance_records WHERE user_id = ?').get(user.id).check_out_time;
  const logCount = (user) => db.prepare('SELECT COUNT(*) AS n FROM task_daily_logs WHERE user_id = ?').get(user.id).n;

  before(async () => {
    db = resetDb();
    plans = require('../src/repositories/weeklyPlanRepository');
    settings = require('../src/repositories/settingsRepository');
    S = await startServer();
  });
  after(() => { if (S) S.close(); cleanup(); });

  test('enforce: بدون پاسخ ⇒ ۴۰۹ daily_report_required با pendingTasks و خروج ثبت نمی‌شود', async () => {
    settings.setValue('dailyReportGateMode', 'enforce');
    const u = F.makeUser();
    const [a, b] = seed(u, ['الف', 'ب']);
    assert.equal((await S.call(u, 'POST', 'check-in', {})).status, 201);
    const r = await S.call(u, 'POST', 'check-out', {});
    assert.equal(r.status, 409);
    assert.equal(r.json.code, 'daily_report_required');
    assert.deepEqual(r.json.pendingTasks.map((t) => t.id).sort(), [a.id, b.id].sort());
    assert.ok(Array.isArray(r.json.reasonCodes));
    assert.equal(outTime(u), null);
    // پاسخ جزئی هم مسدود و چیزی ذخیره نمی‌شود
    const p = await S.call(u, 'POST', 'check-out', { answers: [{ taskId: a.id, status: 'done' }] });
    assert.equal(p.status, 409);
    assert.deepEqual(p.json.pendingTasks.map((t) => t.id), [b.id]);
    assert.equal(logCount(u), 0);
    assert.equal(outTime(u), null);
  });

  test('پاسخ کامل همراه خروج ⇒ ۲۰۰ و هر دو ثبت؛ دبل‌کلیک ⇒ ۴۰۰ و پاسخ تکراری ساخته نمی‌شود', async () => {
    settings.setValue('dailyReportGateMode', 'enforce');
    const u = F.makeUser();
    const [a, b] = seed(u, ['الف', 'ب']);
    await S.call(u, 'POST', 'check-in', {});
    const body = { answers: [{ taskId: a.id, status: 'done' }, { taskId: b.id, status: 'not_done', reasonCode: 'no_time', reschedule: { type: 'tomorrow' } }], extra: [{ title: 'اضافه' }] };
    const ok = await S.call(u, 'POST', 'check-out', body);
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assert.ok(ok.json.check_out_time);
    assert.deepEqual(ok.json.reportSaved, { date: todayDateString(), answers: 2, extra: 1 });
    assert.equal(logCount(u), 3);
    assert.equal((await S.call(u, 'POST', 'check-out', body)).status, 400);
    assert.equal(logCount(u), 3);
  });

  test('پاسخ نامعتبر ⇒ ۴۰۰ و نه خروج ثبت می‌شود نه پاسخ', async () => {
    settings.setValue('dailyReportGateMode', 'enforce');
    const u = F.makeUser();
    const [a] = seed(u, ['الف']);
    await S.call(u, 'POST', 'check-in', {});
    const r = await S.call(u, 'POST', 'check-out', { answers: [{ taskId: a.id, status: 'not_done' }] });
    assert.equal(r.status, 400);
    assert.equal(r.json.code, 'REASON_REQUIRED');
    assert.equal(outTime(u), null);
    assert.equal(logCount(u), 0);
  });

  test('پاسخ‌های قبلی از /daily-report ⇒ خروج بدون ارسال دوباره', async () => {
    settings.setValue('dailyReportGateMode', 'enforce');
    const u = F.makeUser();
    const [a] = seed(u, ['الف']);
    await S.call(u, 'POST', 'check-in', {});
    assert.equal((await S.call(u, 'POST', 'daily-report', { answers: [{ taskId: a.id, status: 'done' }] })).status, 200);
    const ok = await S.call(u, 'POST', 'check-out', {});
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assert.equal(ok.json.reportSaved, undefined);
  });

  test('soft: خروج ثبت می‌شود و reportReminder برمی‌گردد؛ off: بدون تغییر', async () => {
    settings.setValue('dailyReportGateMode', 'soft');
    const u = F.makeUser();
    const [a] = seed(u, ['الف']);
    await S.call(u, 'POST', 'check-in', {});
    const r = await S.call(u, 'POST', 'check-out', {});
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.reportReminder.pendingTasks.map((t) => t.id), [a.id]);
    settings.setValue('dailyReportGateMode', 'off');
    const v = F.makeUser();
    seed(v, ['ب']);
    await S.call(v, 'POST', 'check-in', {});
    const r2 = await S.call(v, 'POST', 'check-out', {});
    assert.equal(r2.status, 200);
    assert.equal(r2.json.reportReminder, undefined);
  });

  test('ترتیب گیت‌ها: اول گزارش، بعد برنامه‌ی هفته‌ی بعد؛ هیچ‌چیز تا رد‌شدنِ همه ذخیره نمی‌شود', async () => {
    settings.setValue('dailyReportGateMode', 'enforce');
    settings.setValue('planGateMode', 'enforce');
    settings.setValue('planSubmissionWeekday', String(cal.weekdayOf(todayDateString())));
    db.exec("DELETE FROM settings WHERE key = 'plan_gate_start_date'");
    try {
      const u = F.makeUser();
      const [a] = seed(u, ['الف']);
      await S.call(u, 'POST', 'check-in', {});
      assert.equal((await S.call(u, 'POST', 'check-out', {})).json.code, 'daily_report_required');
      const r = await S.call(u, 'POST', 'check-out', { answers: [{ taskId: a.id, status: 'done' }] });
      assert.equal(r.status, 409);
      assert.equal(r.json.code, 'weekly_plan_required');
      assert.equal(logCount(u), 0); // گزارش هم ذخیره نشد (اتمیک با خروج)
      assert.equal(outTime(u), null);
      assert.equal((await S.call(u, 'PUT', 'plan', { week: 'next', tasks: [{ title: 'کار هفته' }] })).status, 200);
      assert.equal((await S.call(u, 'POST', 'plan/submit', { week: 'next' })).status, 200);
      const ok = await S.call(u, 'POST', 'check-out', { answers: [{ taskId: a.id, status: 'done' }] });
      assert.equal(ok.status, 200, JSON.stringify(ok.json));
      assert.equal(logCount(u), 1);
    } finally { settings.setValue('planGateMode', 'off'); }
  });

  test('گیت برای سرپرست هم اعمال می‌شود', async () => {
    settings.setValue('dailyReportGateMode', 'enforce');
    const m = F.makeUser({ role: 'manager' });
    seed(m, ['کار سرپرست']);
    await S.call(m, 'POST', 'check-in', {});
    assert.equal((await S.call(m, 'POST', 'check-out', {})).json.code, 'daily_report_required');
  });
});

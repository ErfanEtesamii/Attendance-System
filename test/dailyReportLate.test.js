// D7-ب: پارامتر date، پاسخ دیرهنگام (answered_late)، backfill روز قبل و «بعداً پر می‌کنم» (soft).
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const F = require('./helpers/factories');
const { startServer } = require('./helpers/miniappClient');

let hasDeps = true;
try { require.resolve('express'); } catch (_) { hasDeps = false; }

describe('گزارش دیرهنگام و backfill — سرویس (D7-ب)', () => {
  let db; let svc; let plans; let settings; let attendance; let cal; let addDays; let u; let TODAY; let YEST;
  const hoursAfter = (iso, h) => new Date(Date.parse(iso) + h * 3600 * 1000);

  const reset = () => {
    db.exec('DELETE FROM task_daily_logs; DELETE FROM plan_tasks; DELETE FROM weekly_plans; DELETE FROM break_records; DELETE FROM attendance_records; DELETE FROM leave_approvals; DELETE FROM leave_requests;');
    settings.setValue('dailyReportGateMode', 'soft');
    settings.setValue('reportBackfillDays', 2);
  };
  const mk = (date, title, extra = {}) => {
    const week = cal.weekStartOf(date, settings.getAll().weekStartDay);
    return plans.addTask(plans.getOrCreate(u.id, week).id, { title, plannedDate: date, ...extra });
  };
  const rec = (date, { out = null, status } = {}) => attendance.createManual({
    userId: u.id, recordDate: date, checkInTime: `${date}T05:00:00.000Z`, checkOutTime: out, status: status || (out ? 'normal' : 'incomplete'),
  });
  const resolve = (opts) => svc.resolveReportDate(u, opts);
  const lateFlags = () => db.prepare('SELECT answered_late AS l FROM task_daily_logs ORDER BY id').all().map((r) => r.l);

  before(() => {
    db = resetDb();
    svc = require('../src/services/taskReportService');
    plans = require('../src/repositories/weeklyPlanRepository');
    settings = require('../src/repositories/settingsRepository');
    attendance = require('../src/repositories/attendanceRepository');
    cal = require('../src/engine/calendarService');
    ({ addDays } = require('../src/utils/shiftDay'));
    ({ todayDateString: TODAY } = { todayDateString: require('../src/utils/serverTime').todayDateString() });
    YEST = addDays(TODAY, -1);
    u = F.makeUser();
  });
  after(cleanup);

  test('بدون date ⇒ امروز؛ بعد از خروج یا بستن خودکار «دیرهنگام» حساب می‌شود', () => {
    reset();
    let r = resolve({});
    assert.deepEqual([r.ok, r.date, r.late, r.source], [true, TODAY, false, 'normal']);
    rec(TODAY, { out: `${TODAY}T14:00:00.000Z` });
    r = resolve({});
    assert.deepEqual([r.late, r.source], [true, 'after_checkout']);
    db.exec('DELETE FROM attendance_records');
    rec(TODAY, { status: 'incomplete' });
    assert.equal(resolve({}).late, true);
  });

  test('اعتبارسنجی date: قالب/تاریخ ناموجود/آینده/بدون رکورد', () => {
    reset();
    for (const bad of ['abc', '2026-02-31', 20260101, '2026-1-1']) assert.equal(resolve({ requestedDate: bad }).code, 'INVALID_DATE', String(bad));
    assert.equal(resolve({ requestedDate: addDays(TODAY, 1) }).code, 'DATE_IN_FUTURE');
    assert.equal(resolve({ requestedDate: YEST }).code, 'NO_RECORD');
    assert.equal(resolve({ requestedDate: TODAY }).ok, true); // امروز همیشه مجاز (مثل D6)
  });

  test('backfill: رکورد بدون خروج تا reportBackfillDays؛ بیشتر ⇒ BACKFILL_EXPIRED', () => {
    reset();
    rec(YEST);
    const d3 = addDays(TODAY, -3);
    rec(d3);
    const ok = resolve({ requestedDate: YEST });
    assert.deepEqual([ok.ok, ok.late, ok.source], [true, true, 'backfill']);
    assert.equal(resolve({ requestedDate: d3 }).code, 'BACKFILL_EXPIRED');
    settings.setValue('reportBackfillDays', 3);
    assert.equal(resolve({ requestedDate: d3 }).ok, true);
    settings.setValue('reportBackfillDays', 0);
    assert.equal(resolve({ requestedDate: YEST }).code, 'BACKFILL_EXPIRED');
  });

  test('soft «بعداً پر می‌کنم»: تا ۲۴ ساعت بعد از خروج؛ بعدش یا در enforce رد می‌شود', () => {
    reset();
    const out = `${YEST}T14:00:00.000Z`;
    rec(YEST, { out });
    let r = resolve({ requestedDate: YEST, now: hoursAfter(out, 23) });
    assert.deepEqual([r.ok, r.late, r.source], [true, true, 'soft_later']);
    assert.equal(resolve({ requestedDate: YEST, now: hoursAfter(out, 25) }).code, 'LATE_WINDOW_EXPIRED');
    settings.setValue('dailyReportGateMode', 'enforce');
    assert.equal(resolve({ requestedDate: YEST, now: hoursAfter(out, 1) }).code, 'LATE_NOT_ALLOWED');
    settings.setValue('dailyReportGateMode', 'off');
    assert.equal(resolve({ requestedDate: YEST, now: hoursAfter(out, 1) }).code, 'LATE_NOT_ALLOWED');
  });

  test('ماه بسته ⇒ MONTH_CLOSED (حتی بدون رکورد)؛ date مورد اعتمادِ تست اعتبارسنجی نمی‌شود', () => {
    reset();
    rec(YEST);
    const mc = require('../src/repositories/monthClosuresRepository');
    const orig = mc.findClosedOverlapping;
    mc.findClosedOverlapping = () => [{ id: 1 }];
    try {
      assert.equal(resolve({ requestedDate: YEST }).code, 'MONTH_CLOSED');
      assert.equal(svc.submitDailyReport(u, { answers: [] }, { requestedDate: YEST }).code, 'MONTH_CLOSED');
    } finally { mc.findClosedOverlapping = orig; }
    const trusted = svc.resolveReportDate(u, { date: '2020-01-01' });
    assert.deepEqual([trusted.ok, trusted.date, trusted.late], [true, '2020-01-01', false]);
  });

  test('ثبت دیرهنگام: answered_late=1 و پاسخ عادی/گیت 0؛ extra هم دیرهنگام است', () => {
    reset();
    rec(YEST);
    const a = mk(YEST, 'الف'); const b = mk(YEST, 'ب');
    const r = svc.submitDailyReport(u, { answers: [{ taskId: a.id, status: 'done' }], extra: [{ title: 'اضافه' }] }, { requestedDate: YEST });
    assert.equal(r.ok, true);
    assert.deepEqual([r.late, r.source, r.date], [true, 'backfill', YEST]);
    assert.deepEqual(lateFlags(), [1, 1]);
    assert.deepEqual(r.tasks.map((t) => t.id), [b.id]); // ب هنوز بی‌پاسخ
    // پاسخ عادیِ امروز (بدون رکورد خروج‌خورده) late نیست
    const t = mk(TODAY, 'امروزی');
    db.exec('DELETE FROM attendance_records');
    const r2 = svc.submitDailyReport(u, { answers: [{ taskId: t.id, status: 'done' }] }, {});
    assert.equal(r2.late, false);
    assert.equal(lateFlags().pop(), 0);
  });

  test('انتقالِ پاسخ دیرهنگام نسبت به امروزِ واقعی سنجیده می‌شود', () => {
    reset();
    rec(YEST);
    const a = mk(YEST, 'الف'); const b = mk(YEST, 'ب'); const c = mk(YEST, 'پ');
    const bad = (taskId, date) => svc.submitDailyReport(u, { answers: [{ taskId, status: 'not_done', reasonCode: 'no_time', reschedule: { type: 'date', date } }] }, { requestedDate: YEST });
    assert.equal(bad(a.id, TODAY).code, 'DATE_OUT_OF_RANGE'); // امروز دیگر «آینده» نیست
    assert.equal(bad(a.id, YEST).code, 'DATE_OUT_OF_RANGE');
    const ok = svc.submitDailyReport(u, { answers: [
      { taskId: a.id, status: 'not_done', reasonCode: 'no_time', reschedule: { type: 'tomorrow' } },
      { taskId: b.id, status: 'partial', reasonCode: 'no_time', reschedule: { type: 'date', date: addDays(TODAY, 3) } },
      { taskId: c.id, status: 'not_done', reasonCode: 'no_time', reschedule: { type: 'drop' } },
    ] }, { requestedDate: YEST });
    assert.equal(ok.ok, true, ok.error);
    const rows = Object.fromEntries(db.prepare('SELECT task_id, reschedule_to AS r FROM task_daily_logs').all().map((x) => [x.task_id, x.r]));
    assert.ok(rows[a.id] > TODAY, `tomorrow باید بعد از امروز باشد: ${rows[a.id]}`);
    assert.equal(rows[b.id], addDays(TODAY, 3));
    assert.equal(rows[c.id], 'drop');
  });

  test('getDailyTasks با requestedDate: فهرست همان روز + today/mode؛ نامعتبر ⇒ fail', () => {
    reset();
    rec(YEST);
    mk(YEST, 'دیروزی'); mk(TODAY, 'امروزی');
    const r = svc.getDailyTasks(u, { requestedDate: YEST });
    assert.equal(r.ok, true);
    assert.deepEqual(r.tasks.map((t) => t.title), ['دیروزی']);
    assert.deepEqual([r.date, r.today, r.late, r.mode], [YEST, TODAY, true, 'soft']);
    assert.equal(svc.getDailyTasks(u, { requestedDate: 'x' }).ok, false);
    assert.deepEqual(svc.getDailyTasks(u, {}).tasks.map((t) => t.title), ['امروزی']);
  });

  test('getBackfillStatus: backfill و soft_later؛ پاسخ‌داده‌شده/off/بدون رکورد ⇒ خالی', () => {
    reset();
    const d2 = addDays(TODAY, -2);
    rec(d2); // خودکار-بسته
    const out = new Date(Date.now() - 3600 * 1000).toISOString();
    rec(YEST, { out });
    const a = mk(d2, 'قدیمی'); mk(YEST, 'دیروزی');
    mk(addDays(TODAY, -3), 'خارج از بازه');
    const s = svc.getBackfillStatus(u);
    assert.equal(s.ok, true);
    assert.deepEqual(s.days.map((d) => [d.date, d.source, d.pendingCount]), [[YEST, 'soft_later', 1], [d2, 'backfill', 1]]);
    svc.submitDailyReport(u, { answers: [{ taskId: a.id, status: 'done' }] }, { requestedDate: d2 });
    assert.deepEqual(svc.getBackfillStatus(u).days.map((d) => d.date), [YEST]);
    settings.setValue('dailyReportGateMode', 'off');
    assert.deepEqual(svc.getBackfillStatus(u).days, []);
  });

  test('پاسخ همراه خروج (commitAtomic) دیرهنگام نیست', () => {
    reset();
    rec(TODAY);
    settings.setValue('dailyReportGateMode', 'enforce');
    const a = mk(TODAY, 'الف');
    const g = svc.checkoutGate(u, TODAY, { answers: [{ taskId: a.id, status: 'done' }] });
    assert.equal(g.action, 'allow');
    svc.commitAtomic(u, g, () => 'out');
    assert.deepEqual(lateFlags(), [0]);
  });
});

describe('گزارش دیرهنگام — API (D7-ب)', { skip: !hasDeps && 'express نصب نیست' }, () => {
  let db; let S; let u; let settings; let attendance; let plans; let cal; let addDays; let TODAY; let YEST;
  before(async () => {
    db = resetDb();
    settings = require('../src/repositories/settingsRepository');
    attendance = require('../src/repositories/attendanceRepository');
    plans = require('../src/repositories/weeklyPlanRepository');
    cal = require('../src/engine/calendarService');
    ({ addDays } = require('../src/utils/shiftDay'));
    TODAY = require('../src/utils/serverTime').todayDateString();
    YEST = addDays(TODAY, -1);
    u = F.makeUser();
    S = await startServer();
  });
  after(async () => { if (S) S.close(); cleanup(); });

  test('GET daily-tasks / report-backfill / POST daily-report با date و کدهای خطا', async () => {
    settings.setValue('dailyReportGateMode', 'soft');
    settings.setValue('reportBackfillDays', 2);
    assert.equal((await S.call(u, 'GET', `daily-tasks?date=bad`)).status, 400);
    assert.equal((await S.call(u, 'GET', `daily-tasks?date=${addDays(TODAY, 1)}`)).status, 400);
    const none = await S.call(u, 'GET', `daily-tasks?date=${YEST}`);
    assert.equal(none.status, 404);
    assert.equal(none.json.code, 'NO_RECORD');
    attendance.createManual({ userId: u.id, recordDate: YEST, checkInTime: `${YEST}T05:00:00.000Z`, status: 'incomplete' });
    const week = cal.weekStartOf(YEST, settings.getAll().weekStartDay);
    const t = plans.addTask(plans.getOrCreate(u.id, week).id, { title: 'دیروزی', plannedDate: YEST });
    const g = await S.call(u, 'GET', `daily-tasks?date=${YEST}`);
    assert.equal(g.status, 200);
    assert.equal(g.json.late, true);
    const b = await S.call(u, 'GET', 'report-backfill');
    assert.deepEqual(b.json.days.map((d) => [d.date, d.source]), [[YEST, 'backfill']]);
    const post = await S.call(u, 'POST', 'daily-report', { date: YEST, answers: [{ taskId: t.id, status: 'done' }] });
    assert.equal(post.status, 200, JSON.stringify(post.json));
    assert.equal(db.prepare('SELECT answered_late AS l FROM task_daily_logs WHERE task_id = ?').get(t.id).l, 1);
    const ev = db.prepare("SELECT details FROM audit_log WHERE action = 'daily_report_submitted' ORDER BY id DESC LIMIT 1").get();
    assert.ok(ev && /miniapp_late/.test(ev.details));
    assert.equal((await S.call(u, 'POST', 'daily-report', { date: YEST, answers: [{ taskId: t.id, status: 'done' }] })).status, 409); // ALREADY_ANSWERED
    assert.deepEqual((await S.call(u, 'GET', 'report-backfill')).json.days, []);
  });
});

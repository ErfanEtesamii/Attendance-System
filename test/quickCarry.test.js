// A2 (فاز ۱۵): انتقال سریع — nextWorkingDay از سرور، سقف taskCarryMaxTimes (CARRY_LIMIT)، انتقال به هفته‌ی بعد،
// تسک «هرروزه»، فوری بدون drop، ماه بسته، حذف منتقل‌شده/حذف‌شده از carryOver برنامه‌ی هفته‌ی بعد و audit انتقال.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const F = require('./helpers/factories');
const { startServer } = require('./helpers/miniappClient');

let hasDeps = true;
try { require.resolve('express'); } catch (_) { hasDeps = false; }

// هفته‌ی شنبه ۲۰۲۶-۰۸-۰۱؛ دوشنبه ۰۸-۰۳؛ پنجشنبه ۰۸-۰۶؛ جمعه ۰۸-۰۷ (آف)؛ هفته‌ی بعد از ۰۸-۰۸
const WEEK = '2026-08-01';
const MON = '2026-08-03';
const THU = '2026-08-06';
const SUN = new Date('2026-08-02T08:00:00.000Z');

describe('انتقال سریع (A2)', () => {
  let db; let svc; let plans; let logs; let settings; let weekly; let u; let boss;
  const reset = () => {
    db.exec('DELETE FROM task_daily_logs; DELETE FROM plan_tasks; DELETE FROM weekly_plans; DELETE FROM month_closures; DELETE FROM leave_approvals; DELETE FROM leave_requests;');
    settings.setValue('taskCarryMaxTimes', 0);
    settings.setValue('dailyReportGateMode', 'off');
  };
  const planFor = (week = WEEK, user = u) => plans.getOrCreate(user.id, week);
  const mk = (title, extra = {}, week = WEEK) => plans.addTask(planFor(week).id, { title, plannedDate: MON, ...extra });
  const submit = (date, answers) => svc.submitDailyReport(u, { answers }, { date });
  const moved = (taskId, date, to) => logs.upsert({ taskId, userId: u.id, logDate: date, status: 'not_done', reasonCode: 'no_time', rescheduleTo: to });

  before(() => {
    db = resetDb();
    svc = require('../src/services/taskReportService');
    plans = require('../src/repositories/weeklyPlanRepository');
    logs = require('../src/repositories/taskLogRepository');
    settings = require('../src/repositories/settingsRepository');
    weekly = require('../src/services/weeklyPlanService');
    u = F.makeUser();
    boss = F.makeUser({ role: 'manager' });
  });
  after(cleanup);

  test('getDailyTasks: nextWorkingDay از سرور؛ پنجشنبه ⇒ جمعه (آف) رد می‌شود و شنبه برمی‌گردد', () => {
    reset();
    assert.equal(svc.getDailyTasks(u, { date: MON }).nextWorkingDay, '2026-08-04');
    assert.equal(svc.getDailyTasks(u, { date: THU }).nextWorkingDay, '2026-08-08');
    assert.equal(svc.getDailyTasks(u, { date: MON }).taskCarryMaxTimes, 0);
  });

  test('انتقال به هفته‌ی بعد: برنامه‌ی تازه ساخته نمی‌شود؛ در مقصد source=rescheduled و در مبدأ پنهان', () => {
    reset();
    const a = mk('الف');
    const plansBefore = db.prepare('SELECT COUNT(*) AS n FROM weekly_plans').get().n;
    const r = submit(MON, [{ taskId: a.id, status: 'not_done', reasonCode: 'no_time', reschedule: { type: 'date', date: '2026-08-10' } }]);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(r.rescheduled, [{ taskId: a.id, to: '2026-08-10' }]);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM weekly_plans').get().n, plansBefore);
    assert.ok(!svc.getDailyTasks(u, { date: MON }).tasks.some((t) => t.id === a.id), 'در مبدأ پاسخ‌داده است');
    const dest = svc.getDailyTasks(u, { date: '2026-08-10' }).tasks.find((t) => t.id === a.id);
    assert.ok(dest);
    assert.equal(dest.source, 'rescheduled');
  });

  test('tomorrow = روز کاریِ بعدی سرور (از جمعه‌ی آف رد می‌شود)', () => {
    reset();
    const a = mk('الف', { plannedDate: THU });
    const r = submit(THU, [{ taskId: a.id, status: 'partial', reasonCode: 'needs_more_time', reschedule: { type: 'tomorrow' } }]);
    assert.equal(r.ok, true);
    assert.equal(r.rescheduled[0].to, '2026-08-08');
  });

  test('سقف taskCarryMaxTimes: ۰ ⇒ بی‌سقف؛ N ⇒ بعد از N انتقال CARRY_LIMIT (۴۰۰)؛ drop شمرده نمی‌شود و مجاز می‌ماند', () => {
    reset();
    const a = mk('هرروزه', { plannedDate: null }); // تسک «هرروزه» هم قابل انتقال است
    moved(a.id, '2026-08-01', '2026-08-02');
    moved(a.id, '2026-08-02', '2026-08-03');
    const body = [{ taskId: a.id, status: 'not_done', reasonCode: 'no_time', reschedule: { type: 'tomorrow' } }];
    settings.setValue('taskCarryMaxTimes', 2);
    let r = submit(MON, body);
    assert.deepEqual([r.ok, r.code, r.carried, r.max], [false, 'CARRY_LIMIT', 2, 2]);
    assert.match(r.error, /حذفش کن/);
    assert.equal(logs.findByTaskDate(a.id, MON), null, 'چیزی ذخیره نشده');
    settings.setValue('taskCarryMaxTimes', 3);
    assert.equal(submit(MON, body).ok, true, 'زیر سقف مجاز است');
    reset();
    const b = mk('هرروزه ۲', { plannedDate: null });
    moved(b.id, '2026-08-01', '2026-08-02');
    moved(b.id, '2026-08-02', '2026-08-03');
    settings.setValue('taskCarryMaxTimes', 0);
    assert.equal(submit(MON, [{ taskId: b.id, status: 'not_done', reasonCode: 'no_time', reschedule: { type: 'tomorrow' } }]).ok, true, '۰ = بدون سقف');
    reset();
    const c = mk('هرروزه ۳', { plannedDate: null });
    moved(c.id, '2026-08-01', '2026-08-02');
    moved(c.id, '2026-08-02', '2026-08-03');
    settings.setValue('taskCarryMaxTimes', 2);
    assert.equal(submit(MON, [{ taskId: c.id, status: 'not_done', reasonCode: 'no_time', reschedule: { type: 'drop' } }]).ok, true, 'drop سقف ندارد');
  });

  test('تسک فوری: drop ممنوع؛ انتقال مجاز؛ پیام سقف «با سرپرست هماهنگ کن»', () => {
    reset();
    const a = mk('فوری', { priority: 'high', isUrgent: true, assignedByUserId: boss.id, urgentNote: 'x' });
    let r = submit(MON, [{ taskId: a.id, status: 'not_done', reasonCode: 'no_time', reschedule: { type: 'drop' } }]);
    assert.equal(r.code, 'URGENT_DROP_NOT_ALLOWED');
    settings.setValue('taskCarryMaxTimes', 1);
    moved(a.id, '2026-08-02', '2026-08-03');
    r = submit(MON, [{ taskId: a.id, status: 'not_done', reasonCode: 'no_time', reschedule: { type: 'tomorrow' } }]);
    assert.equal(r.code, 'CARRY_LIMIT');
    assert.match(r.error, /سرپرست/);
    assert.doesNotMatch(r.error, /حذفش کن/);
  });

  test('ماه بسته ⇒ MONTH_CLOSED و انتقال ثبت نمی‌شود', () => {
    reset();
    const a = mk('الف');
    db.prepare("INSERT INTO month_closures (jalali_year, jalali_month, status, period_from, period_to) VALUES (1405, 5, 'closed', '2026-07-23', '2026-08-22')").run();
    const r = submit(MON, [{ taskId: a.id, status: 'not_done', reasonCode: 'no_time', reschedule: { type: 'tomorrow' } }]);
    assert.equal(r.code, 'MONTH_CLOSED');
    assert.equal(logs.findByTaskDate(a.id, MON), null);
  });

  test('carryOver برنامه‌ی هفته‌ی بعد: منتقل‌شده به هفته‌ی جدید و حذف‌شده (drop) پیشنهاد نمی‌شوند؛ ناتمام ساده می‌ماند', () => {
    reset();
    const plain = mk('ناتمام ساده'); const toNext = mk('منتقل به هفته‌ی بعد'); const dropped = mk('حذف‌شده'); const sameWeek = mk('منتقل داخل همین هفته');
    moved(plain.id, MON, null);
    moved(toNext.id, MON, '2026-08-10');
    moved(dropped.id, MON, 'drop');
    moved(sameWeek.id, MON, '2026-08-05');
    const titles = weekly.getPlan(u, 'next', { now: SUN }).carryOver.map((x) => x.title).sort();
    assert.deepEqual(titles, ['ناتمام ساده', 'منتقل داخل همین هفته'].sort());
  });
});

describe('route — انتقال (A2)', { skip: !hasDeps && 'express نصب نیست' }, () => {
  let srv; let db; let plans; let settings; let cal; let u; let TODAY;
  before(async () => {
    db = resetDb();
    plans = require('../src/repositories/weeklyPlanRepository');
    settings = require('../src/repositories/settingsRepository');
    cal = require('../src/engine/calendarService');
    TODAY = require('../src/utils/serverTime').todayDateString();
    u = F.makeUser();
    srv = await startServer();
  });
  after(() => { srv.close(); cleanup(); });

  test('GET daily-tasks فیلد nextWorkingDay می‌دهد؛ انتقال در audit با reschedules ثبت می‌شود؛ سقف ⇒ ۴۰۰ CARRY_LIMIT', async () => {
    const week = cal.weekStartOf(TODAY, settings.getAll().weekStartDay);
    const a = plans.addTask(plans.getOrCreate(u.id, week).id, { title: 'الف', plannedDate: TODAY });
    let r = await srv.call(u, 'GET', 'daily-tasks');
    assert.equal(r.status, 200);
    assert.match(r.json.nextWorkingDay, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(r.json.nextWorkingDay > TODAY);
    r = await srv.call(u, 'POST', 'daily-report', { answers: [{ taskId: a.id, status: 'not_done', reasonCode: 'no_time', reschedule: { type: 'tomorrow' } }] });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const row = db.prepare("SELECT details FROM audit_log WHERE user_id = ? AND action = 'daily_report_submitted' ORDER BY id DESC").get(u.id);
    const d = JSON.parse(row.details);
    assert.deepEqual(d.reschedules, [{ taskId: a.id, to: r.json.nextWorkingDay || d.reschedules[0].to }]);
    assert.equal(d.source, 'miniapp');

    settings.setValue('taskCarryMaxTimes', 1);
    const b = plans.addTask(plans.getOrCreate(u.id, week).id, { title: 'ب', plannedDate: TODAY });
    require('../src/repositories/taskLogRepository').upsert({ taskId: b.id, userId: u.id, logDate: addDaysStr(TODAY, -1), status: 'not_done', reasonCode: 'no_time', rescheduleTo: TODAY });
    r = await srv.call(u, 'POST', 'daily-report', { answers: [{ taskId: b.id, status: 'not_done', reasonCode: 'no_time', reschedule: { type: 'tomorrow' } }] });
    assert.deepEqual([r.status, r.json.code], [400, 'CARRY_LIMIT']);
  });
});

function addDaysStr(d, n) { return require('../src/utils/shiftDay').addDays(d, n); }

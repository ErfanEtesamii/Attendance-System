// B1 (فاز ۱۵): گسترش getDailyTasks (progress/limits/note/canUndo/carryCount/…) و GET /week-board (employeeWeekTasks.collect؛ بدون N+1).
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const F = require('./helpers/factories');

const WEEK = '2026-08-01'; // شنبه
const SAT = '2026-08-01';
const SUN = '2026-08-02';
const MON = '2026-08-03';
const TUE = '2026-08-04';
const NEXT = '2026-08-08';

describe('خروجی «امروز» و «هفته» (B1)', () => {
  let db; let svc; let plans; let logs; let urgent; let settings; let u; let boss; let plan;
  const at = (d, h = '08:00') => new Date(`${d}T${h}:00.000Z`);
  const reset = () => {
    db.exec('DELETE FROM task_daily_logs; DELETE FROM plan_tasks; DELETE FROM weekly_plans; DELETE FROM leave_approvals; DELETE FROM leave_requests; DELETE FROM attendance_records;');
    settings.setValue('selfUrgentEnabled', false);
    plan = plans.getOrCreate(u.id, WEEK);
  };
  const mk = (title, extra = {}) => plans.addTask(plan.id, { title, ...extra });
  const day = (board, date) => board.days.find((d) => d.date === date);

  before(() => {
    db = resetDb();
    svc = require('../src/services/taskReportService');
    plans = require('../src/repositories/weeklyPlanRepository');
    logs = require('../src/repositories/taskLogRepository');
    urgent = require('../src/services/urgentTaskService');
    settings = require('../src/repositories/settingsRepository');
    boss = F.makeUser({ role: 'manager' });
    u = F.makeUser({ managerId: boss.id });
    mock.timers.enable({ apis: ['Date'], now: at(SUN) });
  });
  after(() => { mock.timers.reset(); cleanup(); });

  test('روز با ۵ تسک (۲ done، ۱ فوری، ۱ مدیر، ۱ هرروزه): فهرست‌ها، progress، ترتیب فوری اول', () => {
    reset();
    const a = mk('الف', { plannedDate: SUN });
    const b = mk('ب', { plannedDate: SUN, description: 'شرح ب' });
    const m = plans.addTask(plan.id, { title: 'از مدیر', plannedDate: SUN, managerLocked: true, editedByUserId: boss.id });
    const ev = mk('هرروزه');
    const f = urgent.assign(boss, u, { title: 'فوری مدیر', date: SUN }, { now: at(SUN) });
    assert.equal(f.ok, true, JSON.stringify(f));
    logs.upsert({ taskId: a.id, userId: u.id, logDate: SUN, status: 'done' });
    logs.upsert({ taskId: b.id, userId: u.id, logDate: SUN, status: 'done' });
    logs.setNote(b.id, SUN, 'انجام شد با توضیح');

    const r = svc.getDailyTasks(u, { date: SUN, now: at(SUN) });
    assert.equal(r.ok, true);
    assert.deepEqual(r.tasks.map((t) => t.title), ['فوری مدیر', 'از مدیر', 'هرروزه']);
    assert.deepEqual([r.tasks[0].isUrgent, r.tasks[0].assignedByUserId, r.tasks[0].carryCount], [true, boss.id, 0]);
    assert.equal(r.tasks.find((t) => t.title === 'هرروزه').source, 'everyday');
    assert.equal(typeof r.tasks[0].description, 'string');
    assert.deepEqual(r.progress, { done: 2, total: 5, percent: 40 });
    const ans = r.answered.find((x) => x.taskId === b.id);
    assert.deepEqual([ans.priority, ans.description, ans.note, ans.canUndo, ans.answeredLate, typeof ans.answeredAt], ['normal', 'شرح ب', 'انجام شد با توضیح', true, false, 'string']);
    assert.equal(r.nextWorkingDay > SUN, true);
    // D1: managerLocked برای چیپ «🔒 از طرف سرپرست» (هم در بی‌پاسخ‌ها هم در پاسخ‌داده‌شده‌ها)
    assert.deepEqual([r.tasks.find((t) => t.title === 'از مدیر').managerLocked, r.tasks.find((t) => t.title === 'هرروزه').managerLocked, ans.managerLocked], [true, false, false]);
    assert.deepEqual(Object.keys(r.limits), ['selfUrgentEnabled', 'selfUrgentRemaining']);
    assert.equal(m.id > 0 && ev.id > 0, true);
  });

  test('progress: سیستمی/خارج از برنامه/حذف‌شده (drop) در total نمی‌آید؛ نیمه‌کاره نیم‌امتیاز؛ بدون تسک ⇒ percent=null', () => {
    reset();
    assert.deepEqual(svc.getDailyTasks(u, { date: SUN, now: at(SUN) }).progress, { done: 0, total: 0, percent: null });
    const a = mk('الف', { plannedDate: SUN }); const b = mk('ب', { plannedDate: SUN }); const c = mk('ج', { plannedDate: SUN });
    mk('سیستمی', { plannedDate: SUN, isSystem: true, systemKey: 'review_team_reports' });
    logs.upsert({ taskId: a.id, userId: u.id, logDate: SUN, status: 'done' });
    logs.upsert({ taskId: b.id, userId: u.id, logDate: SUN, status: 'partial', reasonCode: 'no_time' });
    logs.upsert({ taskId: c.id, userId: u.id, logDate: SUN, status: 'not_done', reasonCode: 'no_time', rescheduleTo: 'drop' });
    const r = svc.getDailyTasks(u, { date: SUN, now: at(SUN) });
    assert.deepEqual(r.progress, { done: 1, total: 2, percent: 75 });
  });

  test('canUndo=false برای تسک سیستمی «بررسی گزارش تیم»؛ out_of_plan قابل واگرد', () => {
    reset();
    const s = mk('بررسی', { plannedDate: SUN, isSystem: true, systemKey: 'review_team_reports' });
    logs.upsert({ taskId: s.id, userId: u.id, logDate: SUN, status: 'done' });
    const r = svc.getDailyTasks(u, { date: SUN, now: at(SUN) });
    assert.equal(r.answered.find((x) => x.taskId === s.id).canUndo, false);
  });

  test('carryCount و rescheduledFrom: تسک منتقل‌شده به امروز', () => {
    reset();
    const t = mk('منتقل', { plannedDate: SAT });
    logs.upsert({ taskId: t.id, userId: u.id, logDate: SAT, status: 'not_done', reasonCode: 'no_time', rescheduleTo: SUN });
    const r = svc.getDailyTasks(u, { date: SUN, now: at(SUN) });
    const row = r.tasks.find((x) => x.id === t.id);
    assert.deepEqual([row.source, row.rescheduledFrom, row.carryCount], ['rescheduled', SAT, 1]);
  });

  test('limits: خاموش ⇒ ۰؛ روشن ⇒ سقف منهای فوری‌های شخصیِ همان روز', () => {
    reset();
    assert.deepEqual(svc.getDailyTasks(u, { date: SUN, now: at(SUN) }).limits, { selfUrgentEnabled: false, selfUrgentRemaining: 0 });
    settings.setValue('selfUrgentEnabled', true); settings.setValue('selfUrgentMaxPerDay', 3);
    plans.addTask(plan.id, { title: 'خودم', plannedDate: SUN, priority: 'high', isUrgent: true, assignedByUserId: u.id });
    assert.deepEqual(svc.getDailyTasks(u, { date: SUN, now: at(SUN) }).limits, { selfUrgentEnabled: true, selfUrgentRemaining: 2 });
  });

  test('week-board: ۷ روز با نوع روز/ساعت، وضعیت‌ها، منتقل‌شده مبدأ rescheduled و مقصد pending، روز آینده بدون وضعیت', () => {
    reset();
    const d1 = mk('انجام‌شده', { plannedDate: SAT });
    const d2 = mk('منتقل', { plannedDate: SAT });
    const d3 = mk('حذف', { plannedDate: SAT });
    const d4 = mk('نیمه', { plannedDate: SAT });
    mk('آینده', { plannedDate: TUE });
    logs.upsert({ taskId: d1.id, userId: u.id, logDate: SAT, status: 'done' });
    logs.setNote(d1.id, SAT, 'یادداشت');
    logs.upsert({ taskId: d2.id, userId: u.id, logDate: SAT, status: 'not_done', reasonCode: 'no_time', rescheduleTo: MON });
    logs.upsert({ taskId: d3.id, userId: u.id, logDate: SAT, status: 'not_done', reasonCode: 'no_time', rescheduleTo: 'drop' });
    logs.upsert({ taskId: d4.id, userId: u.id, logDate: SAT, status: 'partial', reasonCode: 'no_time' });
    const b = svc.getWeekBoard(u, { week: 'current', now: at(SUN) });
    assert.equal(b.ok, true, JSON.stringify(b));
    assert.deepEqual([b.weekStart, b.weekEnd, b.today, b.days.length, b.hasPlan], [WEEK, '2026-08-07', SUN, 7, true]);
    assert.deepEqual(b.days.map((d) => d.date), ['2026-08-01', SUN, MON, TUE, '2026-08-05', '2026-08-06', '2026-08-07']);
    const sat = day(b, SAT);
    const st = Object.fromEntries(sat.tasks.map((t) => [t.title, t.status]));
    assert.deepEqual(st, { 'انجام‌شده': 'done', 'منتقل': 'rescheduled', 'حذف': 'dropped', 'نیمه': 'partial' });
    assert.equal(sat.tasks.find((t) => t.title === 'انجام‌شده').note, 'یادداشت');
    assert.equal(sat.tasks.find((t) => t.title === 'منتقل').carryCount, 1);
    assert.deepEqual([sat.done, sat.total], [1, 3], 'dropped در total نیست');
    const mon = day(b, MON);
    assert.deepEqual(mon.tasks.map((t) => [t.title, t.status, t.source]), [['منتقل', 'pending', 'rescheduled']]);
    const tue = day(b, TUE);
    assert.deepEqual([tue.isFuture, tue.tasks[0].status, tue.tasks[0].answeredAt, tue.tasks[0].canUndo], [true, 'pending', null, false]);
    assert.equal(day(b, SUN).isToday, true);
    assert.equal(day(b, '2026-08-07').isWorkingDay, false);
    assert.equal(day(b, '2026-08-07').hours, null);
    assert.equal(typeof day(b, MON).hours.startTime, 'string');
  });

  test('week-board: هفته‌ی بدون برنامه و هفته‌ی بعد؛ week نامعتبر', () => {
    reset();
    db.exec('DELETE FROM weekly_plans');
    const empty = svc.getWeekBoard(u, { week: 'next', now: at(SUN) });
    assert.deepEqual([empty.ok, empty.weekStart, empty.hasPlan, empty.planStatus, empty.progress.percent], [true, NEXT, false, 'draft', null]);
    assert.equal(empty.days.every((d) => d.tasks.length === 0), true);
    const bad = svc.getWeekBoard(u, { week: 'prev', now: at(SUN) });
    assert.deepEqual([bad.ok, bad.code], [false, 'INVALID_WEEK']);
  });

  test('week-board: فوریِ شخصی (selfAssigned) و فوریِ مدیر؛ فوری‌ها اول؛ سیستمی canUndo=false', () => {
    reset();
    mk('عادی', { plannedDate: SUN, priority: 'high' });
    plans.addTask(plan.id, { title: 'خودم', plannedDate: SUN, priority: 'high', isUrgent: true, assignedByUserId: u.id });
    assert.equal(urgent.assign(boss, u, { title: 'مدیر', date: SUN }, { now: at(SUN) }).ok, true);
    const sys = mk('بررسی', { plannedDate: SUN, isSystem: true, systemKey: 'review_team_reports' });
    logs.upsert({ taskId: sys.id, userId: u.id, logDate: SUN, status: 'done' });
    const t = day(svc.getWeekBoard(u, { week: 'current', now: at(SUN) }), SUN).tasks;
    assert.deepEqual(t.slice(0, 2).map((x) => [x.title, x.selfAssigned]).sort(), [['خودم', true], ['مدیر', false]]);
    assert.equal(t.find((x) => x.title === 'بررسی').canUndo, false);
    assert.equal(t.find((x) => x.title === 'مدیر').isUrgent, true);
  });

  test('بدون N+1: تعداد کوئری‌های week-board و daily-tasks به تعداد تسک وابسته نیست', () => {
    const { getDb } = require('../src/db/connection');
    const conn = getDb();
    const origPrepare = conn.prepare.bind(conn);
    let n = 0;
    const count = (fn) => { n = 0; conn.prepare = (sql) => { n += 1; return origPrepare(sql); }; try { fn(); } finally { conn.prepare = origPrepare; } return n; };
    const fill = (k) => {
      reset();
      for (let i = 0; i < k; i += 1) {
        const t = mk(`تسک ${i}`, { plannedDate: i % 2 ? SUN : SAT });
        logs.upsert({ taskId: t.id, userId: u.id, logDate: i % 2 ? SUN : SAT, status: i % 3 ? 'done' : 'not_done', reasonCode: 'no_time', rescheduleTo: i % 3 ? null : MON });
      }
    };
    fill(3);
    const smallBoard = count(() => svc.getWeekBoard(u, { week: 'current', now: at(SUN) }));
    const smallDay = count(() => svc.getDailyTasks(u, { date: SUN, now: at(SUN) }));
    fill(40);
    const bigBoard = count(() => svc.getWeekBoard(u, { week: 'current', now: at(SUN) }));
    const bigDay = count(() => svc.getDailyTasks(u, { date: SUN, now: at(SUN) }));
    assert.equal(bigBoard, smallBoard, `week-board ${smallBoard} vs ${bigBoard}`);
    assert.equal(bigDay, smallDay, `daily-tasks ${smallDay} vs ${bigDay}`);
  });
});

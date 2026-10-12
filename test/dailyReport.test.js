// D6: فهرست تسک‌های امروز + API گزارش روزانه (taskReportService).
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const F = require('./helpers/factories');
const { startServer } = require('./helpers/miniappClient');

let hasDeps = true;
try { require.resolve('express'); } catch (_) { hasDeps = false; }

// هفته‌ی شنبه ۲۰۲۶-۰۸-۰۱؛ دوشنبه ۰۸-۰۳، پنجشنبه ۰۸-۰۶ (نیم‌روز)، جمعه ۰۸-۰۷ (تعطیل)
const WEEK = '2026-08-01';
const MON = '2026-08-03';

describe('گزارش روزانه‌ی تسک‌ها — سرویس (D6)', () => {
  let db; let svc; let plans; let logs; let u;
  const reset = () => db.exec('DELETE FROM task_daily_logs; DELETE FROM plan_tasks; DELETE FROM weekly_plans; DELETE FROM leave_approvals; DELETE FROM leave_requests; DELETE FROM month_closures;');
  const mk = (title, extra = {}) => plans.addTask(plans.getOrCreate(u.id, WEEK).id, { title, ...extra });
  const list = (date = MON) => svc.getDailyTasks(u, { date });
  const report = (body, date = MON) => svc.submitDailyReport(u, body, { date });
  const titles = (r) => r.tasks.map((t) => t.title);

  before(() => {
    db = resetDb();
    svc = require('../src/services/taskReportService');
    plans = require('../src/repositories/weeklyPlanRepository');
    logs = require('../src/repositories/taskLogRepository');
    u = F.makeUser();
  });
  after(cleanup);

  test('ساخت فهرست: امروزی‌ها + «هر روز»؛ روز دیگر خارج؛ ترتیب اولویت', () => {
    reset();
    mk('امروزی', { plannedDate: MON });
    mk('فردایی', { plannedDate: '2026-08-04' });
    mk('هر روز کم‌اهمیت', { priority: 'low' });
    mk('هر روز مهم', { priority: 'high' });
    const r = list();
    assert.deepEqual(titles(r), ['هر روز مهم', 'امروزی', 'هر روز کم‌اهمیت']);
    assert.equal(r.date, MON);
    assert.equal(r.fullDayOff, false);
  });

  test('«هر روز»: done ⇒ دیگر نمی‌آید؛ not_done ⇒ فردا هم می‌آید؛ drop ⇒ حذف', () => {
    reset();
    const a = mk('الف'); const b = mk('ب'); const c = mk('ج');
    logs.upsert({ taskId: a.id, userId: u.id, logDate: MON, status: 'done' });
    logs.upsert({ taskId: b.id, userId: u.id, logDate: MON, status: 'not_done', reasonCode: 'no_time' });
    logs.upsert({ taskId: c.id, userId: u.id, logDate: MON, status: 'not_done', reasonCode: 'no_time', rescheduleTo: 'drop' });
    assert.deepEqual(titles(list('2026-08-04')), ['ب']);
    assert.deepEqual(titles(list(MON)), []); // همه‌شان امروز پاسخ دارند
    assert.equal(list(MON).answered.length, 3);
  });

  test('انتقال‌یافته به امروز می‌آید؛ انتقال به آینده در روزهای بینابین پنهان است', () => {
    reset();
    const t = mk('منتقل', { plannedDate: MON });
    logs.upsert({ taskId: t.id, userId: u.id, logDate: MON, status: 'not_done', reasonCode: 'no_time', rescheduleTo: '2026-08-05' });
    assert.deepEqual(titles(list('2026-08-04')), []);
    assert.deepEqual(titles(list('2026-08-05')), ['منتقل']);
    const e = mk('هر روزِ منتقل');
    logs.upsert({ taskId: e.id, userId: u.id, logDate: MON, status: 'partial', reasonCode: 'needs_more_time', rescheduleTo: '2026-08-05' });
    assert.ok(!titles(list('2026-08-04')).includes('هر روزِ منتقل'));
    assert.ok(titles(list('2026-08-05')).includes('هر روزِ منتقل'));
  });

  test('انتقال از هفته‌ی قبل با reschedule_to به این هفته می‌آید', () => {
    reset();
    const prev = plans.getOrCreate(u.id, '2026-07-25');
    const t = plans.addTask(prev.id, { title: 'هفته‌ی قبل', plannedDate: '2026-07-29' });
    logs.upsert({ taskId: t.id, userId: u.id, logDate: '2026-07-29', status: 'not_done', reasonCode: 'blocked_by_others', rescheduleTo: MON });
    assert.deepEqual(titles(list()), ['هفته‌ی قبل']);
  });

  test('مرخصی/ماموریت تمام‌روزِ تأییدشده ⇒ فهرست خالی و ثبت FULL_DAY_OFF', () => {
    reset();
    mk('امروزی', { plannedDate: MON });
    F.makeApprovedMission(u.id, MON);
    const r = list();
    assert.equal(r.fullDayOff, true);
    assert.deepEqual(r.tasks, []);
    assert.equal(report({ answers: [{ taskId: 1, status: 'done' }] }).code, 'FULL_DAY_OFF');
  });

  test('اعتبارسنجی پاسخ‌ها', () => {
    reset();
    const t = mk('الف', { plannedDate: MON });
    const ok = (x) => report({ answers: [{ taskId: t.id, ...x }] });
    assert.equal(report('x').code, 'EMPTY_REPORT');
    assert.equal(report({ answers: 'x' }).code, 'INVALID_ANSWERS');
    assert.equal(report({ answers: [null] }).code, 'INVALID_ANSWER');
    assert.equal(report({ answers: [{ taskId: 'x', status: 'done' }] }).code, 'INVALID_TASK');
    assert.equal(report({ answers: [{ taskId: 9999, status: 'done' }] }).code, 'TASK_NOT_FOUND');
    assert.equal(ok({ status: 'maybe' }).code, 'INVALID_STATUS');
    assert.equal(ok({ status: 'not_done' }).code, 'REASON_REQUIRED');
    assert.equal(ok({ status: 'partial', reasonCode: 'zzz' }).code, 'REASON_REQUIRED');
    assert.equal(ok({ status: 'not_done', reasonCode: 'other', reasonText: 'کم' }).code, 'REASON_TEXT_REQUIRED');
    assert.equal(ok({ status: 'not_done', reasonCode: 'no_time', reasonText: 'x'.repeat(301) }).code, 'REASON_TOO_LONG');
    assert.equal(ok({ status: 'done', reschedule: { type: 'tomorrow' } }).code, 'RESCHEDULE_NOT_ALLOWED');
    assert.equal(ok({ status: 'not_done', reasonCode: 'no_time', reschedule: { type: 'x' } }).code, 'INVALID_RESCHEDULE');
    assert.equal(ok({ status: 'not_done', reasonCode: 'no_time', reschedule: { type: 'date', date: 'abc' } }).code, 'INVALID_DATE');
    assert.equal(ok({ status: 'not_done', reasonCode: 'no_time', reschedule: { type: 'date', date: MON } }).code, 'DATE_OUT_OF_RANGE');
    assert.equal(ok({ status: 'not_done', reasonCode: 'no_time', reschedule: { type: 'date', date: '2027-01-01' } }).code, 'DATE_OUT_OF_RANGE');
    assert.equal(report({ answers: [{ taskId: t.id, status: 'done' }, { taskId: t.id, status: 'done' }] }).code, 'DUPLICATE_ANSWER');
    assert.equal(logs.listByTask(t.id).length, 0); // هیچ‌چیز ذخیره نشده
  });

  test('ذخیره: done، علت «سایر» با متن، انتقال tomorrow (رد کردن جمعه)/date/drop', () => {
    reset();
    const d = mk('انجام‌شده', { plannedDate: '2026-08-06' });
    const n = mk('انجام‌نشده', { plannedDate: '2026-08-06' });
    const p = mk('نیمه', { plannedDate: '2026-08-06' });
    const r = report({ answers: [
      { taskId: d.id, status: 'done', reasonCode: 'no_time' },
      { taskId: n.id, status: 'not_done', reasonCode: 'other', reasonText: ' نیاز   به  هماهنگی ', reschedule: { type: 'tomorrow' } },
      { taskId: p.id, status: 'partial', reasonCode: 'needs_more_time', reschedule: { type: 'date', date: '2026-08-10' } },
    ] }, '2026-08-06');
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(r.saved, { answers: 3, extra: 0 });
    const ld = logs.findByTaskDate(d.id, '2026-08-06');
    assert.deepEqual([ld.status, ld.reason_code, ld.reschedule_to], ['done', null, null]); // علتِ done نادیده
    const ln = logs.findByTaskDate(n.id, '2026-08-06');
    assert.deepEqual([ln.reason_code, ln.reason_text, ln.reschedule_to], ['other', 'نیاز به هماهنگی', '2026-08-08']); // جمعه تعطیل ⇒ شنبه
    assert.equal(logs.findByTaskDate(p.id, '2026-08-06').reschedule_to, '2026-08-10');
    assert.equal(r.tasks.length, 0);
    assert.equal(r.answered.length, 3);
  });

  test('پاسخ دوباره به تسکِ پاسخ‌داده ⇒ ALREADY_ANSWERED؛ ارسال جزئی مجاز است', () => {
    reset();
    const a = mk('الف', { plannedDate: MON }); const b = mk('ب', { plannedDate: MON });
    assert.equal(report({ answers: [{ taskId: a.id, status: 'done' }] }).ok, true);
    assert.equal(report({ answers: [{ taskId: a.id, status: 'done' }] }).code, 'ALREADY_ANSWERED');
    assert.deepEqual(titles(list()), ['ب']);
    assert.ok(b.id);
  });

  test('همه‌یاهیچ: یک پاسخ نامعتبر ⇒ پاسخ معتبرِ کنارش هم ذخیره نمی‌شود', () => {
    reset();
    const a = mk('الف', { plannedDate: MON }); const b = mk('ب', { plannedDate: MON });
    const r = report({ answers: [{ taskId: a.id, status: 'done' }, { taskId: b.id, status: 'not_done' }] });
    assert.equal(r.code, 'REASON_REQUIRED');
    assert.equal(logs.listByTask(a.id).length, 0);
  });

  test('کار خارج از برنامه: به برنامه‌ی هفته اضافه و done ثبت می‌شود؛ اعتبارسنجی', () => {
    reset();
    assert.equal(report({ extra: [{ title: ' ' }] }).code, 'TITLE_REQUIRED');
    assert.equal(report({ extra: [{ title: 'x'.repeat(121) }] }).code, 'TITLE_TOO_LONG');
    assert.equal(report({ extra: 'x' }).code, 'INVALID_EXTRA');
    assert.equal(report({ extra: Array.from({ length: 11 }, () => ({ title: 'a' })) }).code, 'TOO_MANY_EXTRA');
    const r = report({ extra: [{ title: 'جلسه‌ی فوری', description: 'با مشتری' }] });
    assert.equal(r.ok, true);
    assert.deepEqual(r.saved, { answers: 0, extra: 1 });
    assert.equal(r.answered[0].outOfPlan, true);
    assert.equal(r.answered[0].status, 'done');
    assert.equal(r.tasks.length, 0);
  });

  test('ماه بسته ⇒ MONTH_CLOSED', () => {
    reset();
    const t = mk('الف', { plannedDate: MON });
    const mc = require('../src/repositories/monthClosuresRepository');
    const orig = mc.findClosedOverlapping;
    mc.findClosedOverlapping = () => [{ id: 1 }];
    try { assert.equal(report({ answers: [{ taskId: t.id, status: 'done' }] }).code, 'MONTH_CLOSED'); } finally { mc.findClosedOverlapping = orig; }
  });

  test('اسکوپ: تسک کاربر دیگر در فهرست/پاسخ نمی‌آید', () => {
    reset();
    const other = F.makeUser();
    const op = plans.getOrCreate(other.id, WEEK);
    const ot = plans.addTask(op.id, { title: 'دیگری', plannedDate: MON });
    assert.deepEqual(titles(list()), []);
    assert.equal(report({ answers: [{ taskId: ot.id, status: 'done' }] }).code, 'TASK_NOT_FOUND');
  });
});

describe('گزارش روزانه — API (D6)', { skip: hasDeps ? false : 'express نصب نیست (npm install)' }, () => {
  let S; let plans; let db;
  before(async () => { db = resetDb(); plans = require('../src/repositories/weeklyPlanRepository'); S = await startServer(); });
  after(() => { if (S) S.close(); cleanup(); });

  test('GET daily-tasks و POST daily-report روی «امروز» سرور', async () => {
    const { todayDateString } = require('../src/utils/serverTime');
    const { weekStartOf } = require('../src/engine/calendarService');
    const u = F.makeUser();
    const today = todayDateString();
    const plan = plans.getOrCreate(u.id, weekStartOf(today, 6));
    const t = plans.addTask(plan.id, { title: 'کار امروز', plannedDate: today });
    const g = await S.call(u, 'GET', 'daily-tasks');
    assert.equal(g.status, 200);
    assert.deepEqual(g.json.tasks.map((x) => x.title), ['کار امروز']);
    assert.equal((await S.call(u, 'POST', 'daily-report', { answers: [{ taskId: t.id, status: 'not_done' }] })).status, 400);
    const ok = await S.call(u, 'POST', 'daily-report', { answers: [{ taskId: t.id, status: 'done' }], extra: [{ title: 'اضافه' }] });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assert.equal(ok.json.answered.length, 2);
    assert.equal((await S.call(u, 'POST', 'daily-report', { answers: [{ taskId: t.id, status: 'done' }] })).status, 409);
    const other = F.makeUser();
    assert.equal((await S.call(other, 'POST', 'daily-report', { answers: [{ taskId: t.id, status: 'done' }] })).status, 400);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM task_daily_logs').get().n, 2);
  });
});

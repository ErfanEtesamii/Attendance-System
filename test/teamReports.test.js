// D10: صفحه‌ی «گزارش‌های تیم» — اسکوپ نقش‌ها، تب‌ها (روزانه/برنامه/معطل‌مانده/بررسی‌نشده)، فقط‌خواندنی بودن hr.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const F = require('./helpers/factories');

describe('گزارش‌های تیم (D10)', () => {
  let db; let svc; let plans; let logs; let review; let cal;
  let boss; let boss2; let a; let b; let other; let hr; let admin; let D; let TODAY;
  const addDays = (d, n) => require('../src/utils/shiftDay').addDays(d, n);
  const weekOf = (d) => cal.weekStartOf(d, 6);
  const get = (u, input = {}) => svc.getReports(u, { date: D, ...input });
  const log = (user, date, status, extra = {}, taskExtra = {}) => {
    const plan = plans.getOrCreate(user.id, weekOf(date));
    const t = plans.addTask(plan.id, { title: `کار-${user.id}-${date}-${Math.random().toString(36).slice(2, 6)}`, plannedDate: date, ...taskExtra });
    logs.upsert({ taskId: t.id, userId: user.id, logDate: date, status, ...extra });
    return t;
  };
  const reset = () => db.exec('DELETE FROM report_reviews; DELETE FROM task_daily_logs; DELETE FROM plan_tasks; DELETE FROM weekly_plans;');

  before(() => {
    db = resetDb();
    svc = require('../src/services/teamReportsService');
    plans = require('../src/repositories/weeklyPlanRepository');
    logs = require('../src/repositories/taskLogRepository');
    review = require('../src/services/teamReviewService');
    cal = require('../src/engine/calendarService');
    TODAY = require('../src/utils/serverTime').todayDateString();
    D = addDays(TODAY, -3);
    boss = F.makeUser({ role: 'manager', name: 'سرپرست' });
    boss2 = F.makeUser({ role: 'manager', name: 'سرپرست۲' });
    a = F.makeUser({ managerId: boss.id, name: 'الف' });
    b = F.makeUser({ managerId: boss.id, name: 'ب' });
    other = F.makeUser({ managerId: boss2.id, name: 'ج' });
    hr = F.makeUser({ role: 'hr' });
    admin = F.makeUser({ role: 'admin' });
  });
  after(cleanup);

  test('اسکوپ: کارمند فقط خودش؛ سرپرست فقط تیم؛ admin/hr همه', () => {
    reset();
    const ids = (u) => get(u).members.map((m) => m.userId).sort();
    assert.deepEqual(ids(a), [a.id]);
    assert.deepEqual(ids(boss), [a.id, b.id].sort());
    assert.ok(ids(admin).includes(other.id) && ids(admin).includes(a.id) && !ids(admin).includes(admin.id));
    assert.ok(ids(hr).includes(other.id) && ids(hr).includes(admin.id) && !ids(hr).includes(hr.id));
    assert.equal(get(a).scope, 'self');
    assert.equal(get(boss).scope, 'team');
    assert.equal(get(admin).scope, 'all');
  });

  test('فیلتر فرد: خارج از اسکوپ ⇒ SUBJECT_NOT_IN_SCOPE (کارمندِ دیگر، سرپرستِ تیم دیگر)', () => {
    reset();
    assert.equal(get(a, { userId: b.id }).code, 'SUBJECT_NOT_IN_SCOPE');
    assert.equal(get(boss, { userId: other.id }).code, 'SUBJECT_NOT_IN_SCOPE');
    assert.equal(get(boss, { userId: 'x' }).code, 'SUBJECT_NOT_IN_SCOPE');
    assert.deepEqual(get(boss, { userId: a.id }).members.map((m) => m.userId), [a.id]);
    assert.equal(get(admin, { userId: other.id }).ok, true);
  });

  test('گزارش روزانه: درصد، انجام‌نشده‌ها با علت، خارج از برنامه، وضعیت مشاهده', () => {
    reset();
    log(a, D, 'done'); log(a, D, 'done'); log(a, D, 'not_done', { reasonCode: 'technical_issue', reasonText: 'منتظر API' });
    log(a, D, 'done', {}, { systemKey: 'out_of_plan' });
    const r = get(boss);
    const row = r.members.find((m) => m.userId === a.id);
    assert.deepEqual([row.status, row.summary.total, row.summary.done, row.summary.percent, row.summary.extra], ['unreviewed', 3, 2, 67, 1]);
    assert.equal(row.notDone.length, 1);
    assert.equal(row.notDone[0].reasonCode, 'technical_issue');
    assert.equal(row.extras.length, 1);
    assert.ok(['no_report', 'off'].includes(r.members.find((m) => m.userId === b.id).status));
    review.markReviewed(boss, { subjectUserId: a.id, reportDate: D, comment: 'عالی' });
    const row2 = get(boss).members.find((m) => m.userId === a.id);
    assert.deepEqual([row2.status, row2.comment], ['reviewed', 'عالی']);
    assert.equal(get(a).members[0].comment, 'عالی', 'کارمند کامنت را می‌بیند');
    assert.equal(get(boss).summary.percent, 67);
  });

  test('تب بررسی‌نشده‌ها: فقط برای سرپرست/ادمین؛ hr و کارمند خالی (فقط‌خواندنی)', () => {
    reset();
    log(a, D, 'done'); log(b, D, 'done');
    review.markReviewed(boss, { subjectUserId: b.id, reportDate: D });
    assert.deepEqual(get(boss, { tab: 'unreviewed' }).members.map((m) => m.userId), [a.id]);
    assert.deepEqual(get(hr, { tab: 'unreviewed' }).members, []);
    assert.deepEqual(get(a, { tab: 'unreviewed' }).members, []);
    assert.deepEqual([get(hr).readOnly, get(a).readOnly, get(boss).readOnly, get(admin).readOnly], [true, true, false, false]);
  });

  test('تب برنامه‌ی هفتگی: وضعیت ثبت و تسک‌ها (بدون تسک سیستمی)؛ weekStart نامعتبر', () => {
    reset();
    const wk = weekOf(TODAY);
    const p = plans.getOrCreate(a.id, wk);
    plans.addTask(p.id, { title: 'تسک برنامه' });
    plans.addTask(p.id, { title: 'سیستمی', isSystem: true, systemKey: 'review_team_reports', plannedDate: TODAY });
    plans.markSubmitted(p.id);
    const r = get(boss, { tab: 'plan' });
    assert.equal(r.weekStart, wk);
    const ra = r.members.find((m) => m.userId === a.id);
    assert.deepEqual([ra.status, ra.tasks.map((t) => t.title)], ['submitted', ['تسک برنامه']]);
    assert.equal(r.members.find((m) => m.userId === b.id).submitted, false);
    assert.deepEqual([r.summary.submitted, r.summary.missing], [1, 1]);
    assert.equal(get(boss, { tab: 'plan', weekStart: 'zzz' }).code, 'INVALID_DATE');
  });

  test('معطل‌مانده: دو بار پشت‌سرهم منتقل‌شده و هنوز done نشده؛ done شدن آن را برمی‌دارد', () => {
    reset();
    const plan = plans.getOrCreate(a.id, weekOf(TODAY));
    const t = plans.addTask(plan.id, { title: 'گیر کرده' });
    const d1 = addDays(TODAY, -3); const d2 = addDays(TODAY, -2);
    logs.upsert({ taskId: t.id, userId: a.id, logDate: d1, status: 'not_done', reasonCode: 'busy', rescheduleTo: d2 });
    assert.deepEqual(get(boss, { tab: 'stuck' }).members, []);
    logs.upsert({ taskId: t.id, userId: a.id, logDate: d2, status: 'partial', reasonCode: 'busy', rescheduleTo: addDays(TODAY, -1) });
    const r = get(boss, { tab: 'stuck' });
    assert.equal(r.members.length, 1);
    assert.deepEqual([r.members[0].userId, r.members[0].tasks[0].title, r.members[0].tasks[0].carriedCount], [a.id, 'گیر کرده', 2]);
    assert.deepEqual(get(boss2, { tab: 'stuck' }).members, [], 'تیم دیگر نمی‌بیند');
    logs.upsert({ taskId: t.id, userId: a.id, logDate: addDays(TODAY, -1), status: 'done' });
    assert.deepEqual(get(boss, { tab: 'stuck' }).members, []);
  });

  test('اعتبارسنجی ورودی: tab، تاریخ آینده/قدیمی/نامعتبر', () => {
    assert.equal(get(boss, { tab: 'zzz' }).code, 'INVALID_TAB');
    assert.equal(get(boss, { date: addDays(TODAY, 1) }).code, 'DATE_IN_FUTURE');
    assert.equal(get(boss, { date: addDays(TODAY, -61) }).code, 'DATE_TOO_OLD');
    assert.equal(get(boss, { date: '2026-13-40' }).code, 'INVALID_DATE');
    assert.equal(svc.getReports(null).code, 'FORBIDDEN');
  });
});

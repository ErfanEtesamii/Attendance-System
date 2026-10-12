// D1: migration ۰۲۵ و CRUD پایه‌ی repositoryهای برنامه‌ی هفتگی/گزارش روزانه + یکتایی‌ها و CASCADE.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const F = require('./helpers/factories');

describe('مدل داده‌ی برنامه‌ی هفتگی (D1)', () => {
  let db; let plans; let logs; let reviews; let u; let boss;
  before(() => {
    db = resetDb();
    plans = require('../src/repositories/weeklyPlanRepository');
    logs = require('../src/repositories/taskLogRepository');
    reviews = require('../src/repositories/reportReviewRepository');
    boss = F.makeUser({ role: 'manager' });
    u = F.makeUser({ managerId: boss.id });
  });
  after(cleanup);

  test('migration: چهار جدول و ایندکس‌ها ساخته شده‌اند', () => {
    const names = db.prepare("SELECT name FROM sqlite_master WHERE name IN ('weekly_plans','plan_tasks','task_daily_logs','report_reviews')").all().map((r) => r.name).sort();
    assert.deepEqual(names, ['plan_tasks', 'report_reviews', 'task_daily_logs', 'weekly_plans']);
    const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' AND (name LIKE '%plan%' OR name LIKE '%task_logs%' OR name LIKE '%report_reviews%')").all();
    assert.ok(idx.length >= 5);
    assert.ok(db.prepare("SELECT 1 FROM schema_migrations WHERE name = '025_weekly_plans'").get());
  });

  test('برنامه: getOrCreate idempotent؛ یکتا روی (کاربر، هفته)؛ submit', () => {
    const p = plans.getOrCreate(u.id, '2026-08-01');
    assert.equal(p.status, 'draft');
    assert.equal(plans.getOrCreate(u.id, '2026-08-01').id, p.id);
    assert.equal(plans.getOrCreate(u.id, '2026-08-08').id !== p.id, true);
    assert.throws(() => db.prepare("INSERT INTO weekly_plans (user_id, week_start_date) VALUES (?, '2026-08-01')").run(u.id));
    assert.throws(() => plans.getOrCreate(u.id, '۱۴۰۵/۰۵/۱۰'), /CHECK|constraint/i);
    const s = plans.markSubmitted(p.id);
    assert.equal(s.status, 'submitted');
    assert.ok(s.submitted_at);
    assert.equal(plans.markSubmitted(p.id).submitted_at, s.submitted_at, 'submitted_at ثابت می‌ماند');
    assert.equal(plans.findByUserWeek(u.id, '2026-08-01').id, p.id);
    assert.equal(plans.listByWeek('2026-08-01', [u.id]).length, 1);
    assert.equal(plans.listByWeek('2026-08-01', []).length, 0);
  });

  test('تسک: افزودن، ترتیب، ویرایش، حذف نرم، سیستمی؛ محدودیت طول', () => {
    const p = plans.getOrCreate(u.id, '2026-08-15');
    const a = plans.addTask(p.id, { title: 'الف', description: 'شرح', plannedDate: '2026-08-16', priority: 'high' });
    const b = plans.addTask(p.id, { title: 'ب' });
    assert.deepEqual([a.sort_order, b.sort_order, b.priority, b.is_system], [1, 2, 'normal', 0]);
    assert.equal(plans.updateTask(a.id, { title: 'الف۲', priority: 'low' }).title, 'الف۲');
    assert.throws(() => plans.addTask(p.id, { title: 'x'.repeat(121) }), /CHECK|constraint/i);
    assert.throws(() => plans.addTask(p.id, { title: 'ok', description: 'y'.repeat(501) }), /CHECK|constraint/i);
    assert.throws(() => plans.addTask(p.id, { title: 'ok', priority: 'urgent' }), /CHECK|constraint/i);
    const sys = plans.addTask(p.id, { title: 'بررسی گزارش تیم', isSystem: true, systemKey: 'review_team_reports' });
    assert.equal(plans.findSystemTask(p.id, 'review_team_reports').id, sys.id);
    assert.ok(plans.softDeleteTask(b.id).deleted_at);
    assert.deepEqual(plans.listTasks(p.id).map((t) => t.id), [a.id, sys.id]);
    assert.equal(plans.listTasks(p.id, { includeDeleted: true }).length, 3);
  });

  test('گزارش روزانه: upsert یکتا روی (تسک، روز)، لیست‌ها، انتقال', () => {
    const p = plans.getOrCreate(u.id, '2026-08-22');
    const t = plans.addTask(p.id, { title: 'تسک' });
    const l1 = logs.upsert({ taskId: t.id, userId: u.id, logDate: '2026-08-23', status: 'not_done', reasonCode: 'other', reasonText: 'علت تست', rescheduleTo: '2026-08-24' });
    assert.equal(l1.status, 'not_done');
    const l2 = logs.upsert({ taskId: t.id, userId: u.id, logDate: '2026-08-23', status: 'done', encouragementText: 'آفرین', answeredLate: true });
    assert.equal(l2.id, l1.id);
    assert.deepEqual([l2.status, l2.reason_text, l2.answered_late], ['done', null, 1]);
    assert.throws(() => logs.upsert({ taskId: t.id, userId: u.id, logDate: '2026-08-23', status: 'maybe' }), /CHECK|constraint/i);
    logs.upsert({ taskId: t.id, userId: u.id, logDate: '2026-08-24', status: 'partial', rescheduleTo: '2026-08-25' });
    assert.equal(logs.listByUserDate(u.id, '2026-08-23').length, 1);
    assert.equal(logs.listByUserRange(u.id, '2026-08-23', '2026-08-24').length, 2);
    assert.equal(logs.listRescheduledTo(u.id, '2026-08-25').length, 1);
    assert.equal(logs.listByTask(t.id).length, 2);
    assert.equal(logs.remove(t.id, '2026-08-24'), 1);
  });

  test('مشاهده‌ی گزارش: upsert، کامنت حفظ می‌شود، یکتا روی سه‌تایی', () => {
    const r1 = reviews.upsert({ reviewerId: boss.id, subjectUserId: u.id, reportDate: '2026-08-23', comment: 'عالی' });
    const r2 = reviews.upsert({ reviewerId: boss.id, subjectUserId: u.id, reportDate: '2026-08-23', reaction: '👍' });
    assert.equal(r2.id, r1.id);
    assert.deepEqual([r2.comment, r2.reaction], ['عالی', '👍']);
    assert.equal(reviews.listBySubjectDate(u.id, '2026-08-23').length, 1);
    assert.equal(reviews.listByReviewerDate(boss.id, '2026-08-23').length, 1);
    assert.equal(reviews.find(boss.id, u.id, '2026-08-24'), null);
  });

  test('CASCADE: حذف برنامه ⇒ تسک‌ها و پاسخ‌ها پاک می‌شوند', () => {
    const p = plans.getOrCreate(u.id, '2026-09-05');
    const t = plans.addTask(p.id, { title: 'c' });
    logs.upsert({ taskId: t.id, userId: u.id, logDate: '2026-09-06', status: 'done' });
    db.prepare('DELETE FROM weekly_plans WHERE id = ?').run(p.id);
    assert.equal(plans.findTask(t.id), null);
    assert.equal(logs.listByTask(t.id).length, 0);
  });
});

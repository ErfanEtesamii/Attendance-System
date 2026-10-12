// D3: سرویس برنامه‌ی هفتگی — اعتبارسنجی، قواعد ویرایش (آزاد/محدود/فقط‌خواندنی)، ثبت، اعلان به سرپرست، پیشنهاد انتقال/کپی.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const F = require('./helpers/factories');
const { zonedTimeToUtc } = require('../src/utils/time');

describe('سرویس برنامه‌ی هفتگی (D3)', () => {
  let db; let svc; let plans; let logs; let boss; let u; let noteRepo;
  const at = (d, h = '10:00') => zonedTimeToUtc(d, h, 'Asia/Tehran');
  const SUN = at('2026-08-02'); // هفته‌ی جاری از ۰۸-۰۱؛ هفته‌ی بعد از ۰۸-۰۸
  const t = (title, extra = {}) => ({ title, ...extra });
  const reset = () => db.exec('DELETE FROM task_daily_logs; DELETE FROM plan_tasks; DELETE FROM weekly_plans; DELETE FROM notifications; DELETE FROM month_closures;');

  before(() => {
    db = resetDb();
    svc = require('../src/services/weeklyPlanService');
    plans = require('../src/repositories/weeklyPlanRepository');
    logs = require('../src/repositories/taskLogRepository');
    noteRepo = require('../src/repositories/notificationsRepository');
    boss = F.makeUser({ role: 'manager' });
    u = F.makeUser({ managerId: boss.id });
  });
  after(cleanup);

  test('خواندن هفته‌ی بعد/جاری: بازه، planDay، حالت ویرایش', () => {
    reset();
    const n = svc.getPlan(u, 'next', { now: SUN });
    assert.deepEqual([n.weekStart, n.weekEnd, n.planDay, n.editMode, n.status, n.tasks.length], ['2026-08-08', '2026-08-14', '2026-08-13', 'free', 'draft', 0]);
    const c = svc.getPlan(u, 'current', { now: SUN });
    assert.deepEqual([c.weekStart, c.editMode], ['2026-08-01', 'restricted']);
    assert.equal(svc.getPlan(u, 'foo', { now: SUN }).code, 'INVALID_WEEK');
  });

  test('اعتبارسنجی: عنوان/توضیح/اولویت/تاریخ/سقف ۳۰', () => {
    reset();
    const save = (tasks) => svc.saveDraft(u, 'next', tasks, { now: SUN });
    assert.equal(save([t('  ')]).code, 'TITLE_REQUIRED');
    assert.equal(save([t('x'.repeat(121))]).code, 'TITLE_TOO_LONG');
    assert.equal(save([t('ok', { description: 'y'.repeat(501) })]).code, 'DESCRIPTION_TOO_LONG');
    assert.equal(save([t('ok', { priority: 'urgent' })]).code, 'INVALID_PRIORITY');
    assert.equal(save([t('ok', { plannedDate: '2026-08-20' })]).code, 'DATE_OUT_OF_WEEK');
    assert.equal(save([t('ok', { plannedDate: 'abc' })]).code, 'INVALID_DATE');
    assert.equal(save([t('ok', { id: 'x' })]).code, 'INVALID_ID');
    assert.equal(save('nope').code, 'INVALID_TASKS');
    assert.equal(save(Array.from({ length: 31 }, (_, i) => t(`تسک ${i}`))).code, 'TOO_MANY_TASKS');
    assert.equal(save(Array.from({ length: 30 }, (_, i) => t(`تسک ${i}`))).ok, true);
    const r = save([t('<b>سلام</b>\u0000  دنیا')]);
    assert.equal(r.ok, true);
    assert.ok(!/\u0000/.test(r.tasks[0].title));
  });

  test('ذخیره‌ی پیش‌نویس: افزودن/ویرایش/حذف در حالت آزاد؛ idempotent؛ شناسه‌ی غریبه رد', () => {
    reset();
    const a = svc.saveDraft(u, 'next', [t('الف', { plannedDate: '2026-08-09', priority: 'high' }), t('ب')], { now: SUN });
    assert.equal(a.ok, true);
    assert.deepEqual(a.tasks.map((x) => x.title), ['الف', 'ب']);
    const [ta, tb] = a.tasks;
    const b = svc.saveDraft(u, 'next', [{ ...ta, title: 'الف۲', plannedDate: null }], { now: SUN });
    assert.deepEqual(b.tasks.map((x) => [x.id, x.title, x.plannedDate]), [[ta.id, 'الف۲', null]]); // ب حذف شد
    assert.equal(plans.findTask(tb.id).deleted_at !== null, true);
    assert.equal(svc.saveDraft(u, 'next', b.tasks, { now: SUN }).tasks.length, 1);
    const other = F.makeUser();
    const foreign = svc.saveDraft(other, 'next', [{ id: ta.id, title: 'هک' }], { now: SUN });
    assert.equal(foreign.code, 'TASK_NOT_FOUND');
  });

  test('ثبت: حداقل تسک (planMinTasks)، موفق، idempotent، audit', () => {
    reset();
    assert.equal(svc.submit(u, 'next', { now: SUN }).code, 'TOO_FEW_TASKS');
    svc.saveDraft(u, 'next', [t('الف')], { now: SUN });
    const s = svc.submit(u, 'next', { now: SUN });
    assert.deepEqual([s.ok, s.status], [true, 'submitted']);
    assert.ok(s.submittedAt);
    assert.equal(svc.submit(u, 'next', { now: SUN }).submittedAt, s.submittedAt);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action = 'weekly_plan_submitted'").get().n >= 1, true);
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('plan_min_tasks', '3')").run();
    reset();
    svc.saveDraft(u, 'next', [t('الف'), t('ب')], { now: SUN });
    assert.deepEqual([svc.submit(u, 'next', { now: SUN }).code, svc.submit(u, 'next', { now: SUN }).min], ['TOO_FEW_TASKS', 3]);
    db.prepare("DELETE FROM settings WHERE key = 'plan_min_tasks'").run();
  });

  test('تغییر بعد از ثبت (قبل از شروع هفته): آزاد + audit + اعلان به سرپرست', async () => {
    reset();
    svc.saveDraft(u, 'next', [t('الف')], { now: SUN });
    svc.submit(u, 'next', { now: SUN });
    const cur = svc.getPlan(u, 'next', { now: SUN }).tasks;
    const r = svc.saveDraft(u, 'next', [...cur, t('جدید')], { now: SUN });
    assert.equal(r.tasks.length, 2);
    assert.equal(r.status, 'submitted');
    assert.ok(db.prepare("SELECT 1 FROM audit_log WHERE action = 'weekly_plan_changed'").get());
    await new Promise((res) => setTimeout(res, 20));
    assert.ok(noteRepo.listForUser(boss.id, {}).some((n) => n.type === 'weekly_plan_changed'));
  });

  test('بعد از شروع هفته (current): فقط افزودن و انتقال تاریخ؛ حذف/تغییر عنوان رد', () => {
    reset();
    const a = svc.saveDraft(u, 'current', [t('الف', { plannedDate: '2026-08-03' })], { now: at('2026-08-01') });
    // هفته‌ی جاری از امروز شروع شده ⇒ محدود: تسک اول اضافه شد چون برنامه خالی بود
    assert.equal(a.ok, true);
    const [x] = a.tasks;
    assert.equal(svc.saveDraft(u, 'current', [{ ...x, title: 'تغییر' }], { now: SUN }).code, 'EDIT_RESTRICTED');
    assert.equal(svc.saveDraft(u, 'current', [{ ...x, priority: 'high' }], { now: SUN }).code, 'EDIT_RESTRICTED');
    const moved = svc.saveDraft(u, 'current', [{ ...x, plannedDate: '2026-08-05' }, t('تازه')], { now: SUN });
    assert.deepEqual(moved.tasks.map((y) => [y.title, y.plannedDate]), [['الف', '2026-08-05'], ['تازه', null]]);
    const noDelete = svc.saveDraft(u, 'current', [t('فقط‌این')], { now: SUN });
    assert.equal(noDelete.tasks.length, 3, 'حذف در حالت محدود ممکن نیست');
  });

  test('ماه بسته ⇒ فقط‌خواندنی (ذخیره و ثبت)', () => {
    reset();
    db.prepare("INSERT INTO month_closures (jalali_year, jalali_month, status, period_from, period_to) VALUES (1405, 5, 'closed', '2026-07-23', '2026-08-22')").run();
    assert.equal(svc.getPlan(u, 'next', { now: SUN }).editMode, 'readonly');
    assert.equal(svc.saveDraft(u, 'next', [t('الف')], { now: SUN }).code, 'MONTH_CLOSED');
    assert.equal(svc.submit(u, 'next', { now: SUN }).code, 'MONTH_CLOSED');
    db.exec('DELETE FROM month_closures;');
  });

  test('پیشنهاد انتقال (ناتمام‌های هفته‌ی قبل) و کپی از هفته‌ی قبل؛ منبع انتقال اعتبارسنجی می‌شود', () => {
    reset();
    const prev = svc.saveDraft(u, 'next', [t('تمام‌شده'), t('ناتمام'), t('نیمه')], { now: at('2026-07-31') });
    assert.equal(prev.ok, true, JSON.stringify(prev));
    const [done, undone, half] = prev.tasks;
    logs.upsert({ taskId: done.id, userId: u.id, logDate: '2026-08-02', status: 'done' });
    logs.upsert({ taskId: half.id, userId: u.id, logDate: '2026-08-02', status: 'partial' });
    const next = svc.getPlan(u, 'next', { now: SUN });
    assert.deepEqual(next.carryOver.map((x) => x.title).sort(), ['ناتمام', 'نیمه']);
    assert.equal(next.previousWeekTasks.length, 3);
    const saved = svc.saveDraft(u, 'next', [t('ناتمام', { carriedFromTaskId: undone.id })], { now: SUN });
    assert.equal(saved.tasks[0].carriedFromTaskId, undone.id);
    assert.deepEqual(svc.getPlan(u, 'next', { now: SUN }).carryOver.map((x) => x.title), ['نیمه'], 'منتقل‌شده دیگر پیشنهاد نمی‌شود');
    const other = F.makeUser();
    assert.equal(svc.saveDraft(other, 'next', [t('هک', { carriedFromTaskId: undone.id })], { now: SUN }).code, 'INVALID_CARRY');
  });

  test('تسک سیستمی: ویرایش/حذف نمی‌شود و در سقف و حداقل نمی‌آید', () => {
    reset();
    const p = plans.getOrCreate(u.id, '2026-08-08');
    plans.addTask(p.id, { title: 'بررسی گزارش‌ها', isSystem: true, systemKey: 'review_team_reports' });
    assert.equal(svc.submit(u, 'next', { now: SUN }).code, 'TOO_FEW_TASKS');
    const r = svc.saveDraft(u, 'next', [t('الف')], { now: SUN });
    assert.equal(r.tasks.length, 2);
    const cleared = svc.saveDraft(u, 'next', [], { now: SUN });
    assert.deepEqual(cleared.tasks.map((x) => x.isSystem), [true]);
  });
});

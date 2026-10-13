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
    assert.deepEqual([c.weekStart, c.editMode, c.lockReason, n.lockReason], ['2026-08-01', 'readonly', 'week_started', null]);
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

  test('هفته‌ی شروع‌شده (current) قفل است: افزودن/ویرایش/حذف/انتقال/ثبت همه PLAN_LOCKED', () => {
    reset();
    // برنامه‌ی هفته‌ی ۰۸-۰۱ پیش از شروع هفته (آخرین جمعه‌ی قبلش) ثبت شده است
    const a = svc.saveDraft(u, 'next', [t('الف', { plannedDate: '2026-08-03' }), t('ب')], { now: at('2026-07-31') });
    assert.equal(a.ok, true, JSON.stringify(a));
    svc.submit(u, 'next', { now: at('2026-07-31') });
    const cur = svc.getPlan(u, 'current', { now: SUN });
    assert.deepEqual([cur.editMode, cur.lockReason, cur.status], ['readonly', 'week_started', 'submitted']);
    const [x, y] = cur.tasks;
    const snapshot = () => JSON.stringify(plans.listTasks(plans.findByUserWeek(u.id, '2026-08-01').id, { includeDeleted: true }));
    const before = snapshot();
    const changedAudits = () => db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action = 'weekly_plan_changed'").get().n;
    const auditsBefore = changedAudits();
    const attempts = {
      افزودن: [...cur.tasks, t('تازه')],
      'تغییر عنوان': [{ ...x, title: 'تغییر' }, y],
      'تغییر اولویت': [{ ...x, priority: 'high' }, y],
      'انتقال تاریخ': [{ ...x, plannedDate: '2026-08-05' }, y],
      حذف: [x],
      'فهرست خالی': [],
    };
    for (const [name, tasks] of Object.entries(attempts)) {
      const r = svc.saveDraft(u, 'current', tasks, { now: SUN });
      assert.deepEqual([r.ok, r.code], [false, 'PLAN_LOCKED'], name);
      assert.match(r.error, /شروع شده/);
    }
    assert.equal(svc.submit(u, 'current', { now: SUN }).code, 'PLAN_LOCKED');
    assert.equal(snapshot(), before, 'هیچ‌چیز در دیتابیس تغییر نکرده است');
    assert.equal(changedAudits(), auditsBefore, 'تلاش رد‌شده audit تغییر نمی‌سازد');
    // حتی بدون هیچ برنامه‌ای در هفته‌ی شروع‌شده، ساخت برنامه ممکن نیست
    reset();
    assert.equal(svc.saveDraft(u, 'current', [t('الف')], { now: SUN }).code, 'PLAN_LOCKED');
    assert.equal(svc.submit(u, 'current', { now: SUN }).code, 'PLAN_LOCKED');
    assert.equal(plans.findByUserWeek(u.id, '2026-08-01'), null);
  });

  test('مرز قفل: روزِ قبل از شروع هفته آزاد است؛ از روز شروع قفل (هفته‌ی بعدی همیشه آزاد)', () => {
    reset();
    const fri = at('2026-07-31'); // هفته‌ی ۰۸-۰۱ هنوز شروع نشده
    assert.equal(svc.getPlan(u, 'next', { now: fri }).editMode, 'free');
    assert.equal(svc.saveDraft(u, 'next', [t('الف')], { now: fri }).ok, true);
    const sat = at('2026-08-01'); // روز شروع هفته ⇒ قفل
    assert.equal(svc.getPlan(u, 'current', { now: sat }).editMode, 'readonly');
    assert.equal(svc.saveDraft(u, 'current', [t('الف'), t('ب')], { now: sat }).code, 'PLAN_LOCKED');
    assert.equal(svc.getPlan(u, 'next', { now: sat }).editMode, 'free'); // ۰۸-۰۸
    assert.equal(svc.saveDraft(u, 'next', [t('هفته‌ی بعد')], { now: sat }).ok, true);
    const late = at('2026-08-06'); // وسط هفته هم همان قفل
    assert.equal(svc.saveDraft(u, 'current', [t('الف')], { now: late }).code, 'PLAN_LOCKED');
  });

  test('هفته‌ی آینده‌ی شروع‌نشده بعد از ثبت هم ویرایش‌پذیر است (حذف و تغییر عنوان مجاز)', () => {
    reset();
    svc.saveDraft(u, 'next', [t('الف'), t('ب')], { now: SUN });
    svc.submit(u, 'next', { now: SUN });
    const [x] = svc.getPlan(u, 'next', { now: SUN }).tasks;
    const r = svc.saveDraft(u, 'next', [{ ...x, title: 'الف‌نو', priority: 'high' }], { now: SUN });
    assert.deepEqual(r.tasks.map((y) => [y.title, y.priority]), [['الف‌نو', 'high']]);
    assert.equal(r.status, 'submitted');
  });

  test('ماه بسته ⇒ فقط‌خواندنی (ذخیره و ثبت)', () => {
    reset();
    db.prepare("INSERT INTO month_closures (jalali_year, jalali_month, status, period_from, period_to) VALUES (1405, 5, 'closed', '2026-07-23', '2026-08-22')").run();
    assert.equal(svc.getPlan(u, 'next', { now: SUN }).editMode, 'readonly');
    assert.equal(svc.saveDraft(u, 'next', [t('الف')], { now: SUN }).code, 'MONTH_CLOSED');
    assert.equal(svc.submit(u, 'next', { now: SUN }).code, 'MONTH_CLOSED');
    // هفته‌ی شروع‌شده در ماه بسته: همان قفل ماه بسته (MONTH_CLOSED) و lockReason مربوط
    const cur = svc.getPlan(u, 'current', { now: SUN });
    assert.deepEqual([cur.editMode, cur.lockReason], ['readonly', 'month_closed']);
    assert.equal(svc.saveDraft(u, 'current', [t('الف')], { now: SUN }).code, 'MONTH_CLOSED');
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

  test('قفل هفته‌ی شروع‌شده: تسک سیستمی، reschedule_to گزارش روزانه و carry over سالم می‌مانند', () => {
    reset();
    const reports = require('../src/services/taskReportService');
    const settings = require('../src/repositories/settingsRepository').getAll();
    const plan = svc.saveDraft(u, 'next', [t('الف'), t('ب', { plannedDate: '2026-08-03' }), t('پ')], { now: at('2026-07-31') });
    assert.equal(plan.ok, true, JSON.stringify(plan));
    const [ta, tb, tc] = plan.tasks;
    const p = plans.findByUserWeek(u.id, '2026-08-01');
    const sys = plans.addTask(p.id, { title: 'بررسی گزارش‌ها', plannedDate: '2026-08-03', isSystem: true, systemKey: 'review_team_reports' });
    // هفته قفل است
    assert.equal(svc.saveDraft(u, 'current', [], { now: SUN }).code, 'PLAN_LOCKED');
    assert.equal(plans.findTask(sys.id).deleted_at, null, 'تسک سیستمی دست‌نخورده است');
    // reschedule_to روی هفته‌ی قفل‌شده کار می‌کند: «ب» (روز ۰۸-۰۳) به ۰۸-۰۵ منتقل می‌شود
    logs.upsert({ taskId: tb.id, userId: u.id, logDate: '2026-08-03', status: 'not_done', reasonCode: 'other', rescheduleTo: '2026-08-05' });
    assert.deepEqual(reports.buildList(u, '2026-08-03', settings).map((x) => x.title).sort(), ['الف', 'پ', 'بررسی گزارش‌ها'].sort());
    const moved = reports.buildList(u, '2026-08-05', settings).find((x) => x.id === tb.id);
    assert.equal(moved && moved.source, 'rescheduled');
    // drop و «انجام‌شده» هم مثل قبل
    logs.upsert({ taskId: tc.id, userId: u.id, logDate: '2026-08-03', status: 'done' });
    assert.ok(!reports.buildList(u, '2026-08-04', settings).some((x) => x.id === tc.id));
    // carry over: ناتمام‌های هفته‌ی شروع‌شده به هفته‌ی بعد می‌روند (هفته‌ی بعد آزاد است)
    const next = svc.getPlan(u, 'next', { now: SUN });
    assert.deepEqual(next.carryOver.map((x) => x.title).sort(), ['الف', 'ب']);
    const saved = svc.saveDraft(u, 'next', [t('الف', { carriedFromTaskId: ta.id })], { now: SUN });
    assert.equal(saved.ok, true);
    assert.equal(saved.tasks[0].carriedFromTaskId, ta.id);
  });
});

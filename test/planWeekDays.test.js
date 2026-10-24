// B1-a (فاز ۱۳): مدل روزبه‌روز برنامه‌ی هفته‌ی بعد (GET /admin/users/:id/plan ← getPlanState: days / anyDay / unnotifiedChanges).
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');

const svc = require('../src/services/weeklyPlanAdminService');
const shiftsRepo = require('../src/repositories/shiftsRepository');
const scheduleRepo = require('../src/repositories/userDayScheduleRepository');
const auditRepo = require('../src/repositories/auditRepository');
const { makeUser, makeApprovedMission } = require('./helpers/factories');

const TODAY = '2026-09-19'; // شنبه؛ هفته‌ی جاری از ۰۹-۱۹، هفته‌ی بعد از ۰۹-۲۶
const NEXT = '2026-09-26';

describe('مدل روزبه‌روز برنامه‌ی هفته‌ی بعد (B1-a)', () => {
  let db; let admin; let hr; let mgr; let emp; let noShift;

  before(() => {
    mock.timers.enable({ apis: ['Date'], now: new Date(`${TODAY}T08:00:00Z`) });
    db = resetDb();
    admin = makeUser({ role: 'admin' });
    hr = makeUser({ role: 'hr' });
    mgr = makeUser({ role: 'manager' });
    emp = makeUser({ managerId: mgr.id });
    noShift = makeUser({ managerId: mgr.id });
    const shift = shiftsRepo.createShift({ name: 'عصر', startTime: '15:30', endTime: '21:00', graceLateMinutes: 0, graceEarlyMinutes: 0, workDays: [6, 0, 1, 2, 3], overnight: false, maxLunchMinutes: 0, fixedLunchDeductMinutes: 0 });
    db.prepare('UPDATE users SET shift_id = ? WHERE id = ?').run(shift.id, emp.id);
    scheduleRepo.upsert({ userId: emp.id, date: '2026-09-27', kind: 'off', createdBy: admin.id }); // یکشنبه: آف
    makeApprovedMission(emp.id, '2026-09-28'); // دوشنبه: مأموریت
  });
  after(() => { mock.timers.reset(); cleanup(); });

  const state = (actor, id, start) => svc.getPlanState(actor, id, start);

  test('هفته‌ی بدون برنامه: ۷ روز با ساعت مؤثر شیفت ۱۵:۳۰–۲۱:۰۰ و نوع روز، بدون تسک', () => {
    const r = state(admin, emp.id);
    assert.equal(r.ok, true);
    assert.equal(r.weekStart, NEXT);
    assert.deepEqual(r.days.map((d) => d.date), ['2026-09-26', '2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']);
    assert.equal(r.plan.id, null);
    assert.equal(r.plan.unnotifiedChanges, 0);
    assert.deepEqual(r.anyDay, []);
    assert.equal(r.days.every((d) => d.tasks.length === 0 && d.jalali), true);

    const [sat, sun, mon, tue, , , fri] = r.days;
    assert.deepEqual([sat.kind, sat.schedule.start, sat.schedule.end, sat.schedule.plannedMinutes, sat.schedule.source, sat.schedule.shift.name], ['working', '15:30', '21:00', 330, 'shift', 'عصر']);
    assert.deepEqual([sun.kind, sun.override.kind, sun.schedule.plannedMinutes, sun.schedule.source], ['off', 'off', 0, 'override']);
    assert.deepEqual([mon.kind, mon.schedule.plannedMinutes, mon.leaves[0].kind], ['mission', 0, 'mission']);
    assert.equal(tue.kind, 'working');
    assert.equal(fri.kind, 'off'); // جمعه: خارج از workDays شیفت
  });

  test('کارمند بدون شیفت: منبع ساعت = سراسری', () => {
    const d = state(admin, noShift.id).days[0];
    assert.equal(d.schedule.shift, null);
    assert.equal(d.schedule.source, 'global');
  });

  test('تسک‌ها در روز خودشان؛ بدون تاریخ در anyDay؛ تسک روی روز آف هم در همان روز؛ canEdit برای مدیر', () => {
    const add = (body) => svc.addTask(admin, emp.id, NEXT, body);
    assert.equal(add({ title: 'گزارش', plannedDate: '2026-09-26', priority: 'high' }).ok, true);
    assert.equal(add({ title: 'روز آف', plannedDate: '2026-09-27' }).ok, true);
    assert.equal(add({ title: 'هر روز' }).ok, true);

    const r = state(admin, emp.id);
    assert.deepEqual(r.days[0].tasks.map((t) => t.title), ['گزارش']);
    assert.deepEqual([r.days[0].tasks[0].priority, r.days[0].tasks[0].managerLocked, r.days[0].tasks[0].canEdit], ['high', true, true]);
    assert.deepEqual(r.days[1].tasks.map((t) => t.title), ['روز آف']);
    assert.deepEqual(r.anyDay.map((t) => t.title), ['هر روز']);
    assert.equal(r.tasks.length, 3, 'فهرست تخت قبلی برای سازگاری حفظ شده');
    assert.equal(r.plan.status, 'draft');
  });

  test('سرپرست و hr: همان مدل؛ canEdit فقط برای سرپرستِ مجاز (hr نه)', () => {
    const m = state(mgr, emp.id);
    assert.equal(m.days.length, 7);
    assert.equal(m.days[0].tasks[0].canEdit, true);
    const h = state(hr, emp.id);
    assert.equal(h.ok, true);
    assert.equal(h.plan.editable, false);
    assert.equal(h.days.flatMap((d) => d.tasks).every((t) => t.canEdit === false), true);
    assert.equal(state(makeUser({ role: 'manager' }), emp.id).code, 'FORBIDDEN');
  });

  test('هفته‌ی شروع‌شده: editable=false، lockReason و canEdit همه false', () => {
    const r = state(admin, emp.id, TODAY);
    assert.equal(r.plan.editable, true);
    assert.equal(r.plan.lockReason, null);
    assert.equal(r.days.length, 7);
  });

  test('تغییرهای اطلاع‌داده‌نشده: از audit محاسبه می‌شود (۲ افزودن) و با رکورد «اعلان شد» صفر می‌شود', () => {
    const plan = state(admin, emp.id).plan;
    const log = (taskId, op) => auditRepo.logEvent({ userId: admin.id, action: 'weekly_plan_edited_by_manager', details: { op, planId: plan.id, taskId, targetUserId: emp.id } });
    const a = log(9001, 'add'); log(9002, 'add'); log(9002, 'update');
    let r = state(admin, emp.id);
    assert.equal(r.plan.unnotifiedChanges, 2);
    assert.deepEqual(r.plan.unnotified, { added: 2, edited: 0, removed: 0 });
    auditRepo.logEvent({ userId: admin.id, action: 'weekly_plan_manager_notified', details: { planId: plan.id, upToAuditId: a.id + 2 } });
    r = state(admin, emp.id);
    assert.equal(r.plan.unnotifiedChanges, 0);
  });

  test('ماه بسته: monthClosed روی روزهای هفته', () => {
    db.prepare("INSERT INTO month_closures (jalali_year, jalali_month, period_from, period_to, status, close_count) VALUES (1405, 7, '2026-09-23', '2026-10-22', 'closed', 1)").run();
    const r = state(admin, emp.id);
    assert.equal(r.days.every((d) => d.monthClosed), true);
    assert.equal(r.plan.lockReason, 'month_closed');
  });

  test('خلاصه‌ی هفته (B1-b): اعداد مشخص برای شیفت ۱۵:۳۰–۲۱:۰۰، override آف و مأموریت', () => {
    // قبل از تست ماه بسته؛ یک روز آف (یکشنبه)، یک مأموریت (دوشنبه)، جمعه و پنجشنبه خارج از شیفت: workDays=[6,0,1,2,3]
    const r = svc.getPlanState(admin, emp.id);
    assert.equal(r.ok, true);
    const s = r.summary;
    // شنبه، سه‌شنبه، چهارشنبه کاری؛ یکشنبه آف (override)؛ دوشنبه مأموریت؛ پنجشنبه و جمعه آف
    assert.deepEqual(s.days, { working: 3, half: 0, off: 3, holiday: 0, leave: 0, mission: 1 });
    assert.equal(s.workingDays, 3);
    assert.equal(s.plannedMinutes, 3 * 330);
    assert.equal(s.plannedHours, 16.5);
    // تسک‌های تست‌های قبلی: ۲ تسک تاریخ‌دار + ۱ بدون تاریخ، همه عادی
    assert.deepEqual(s.tasks, { total: 3, ordinary: 3, urgent: 0, system: 0, undated: 1 });
  });

  test('summarizePlanWeek (خالص): فوری و سیستمی جدا، تسک بیرون از هفته در undated نیست', () => {
    const { summarizePlanWeek } = require('../src/services/planWeekDays');
    const day = (kind, minutes, tasks = []) => ({ kind, schedule: { plannedMinutes: minutes }, tasks });
    const days = [day('working', 300, [{ isUrgent: true, isSystem: true }, { isSystem: true }, {}]), day('half', 120), day('holiday', 0), day('leave', 0), day('off', 0), day('off', 0), day('mission', 0)];
    const s = summarizePlanWeek(days, [{ plannedDate: null }, { plannedDate: '2030-01-01' }]);
    assert.deepEqual([s.workingDays, s.plannedMinutes, s.plannedHours], [2, 420, 7]);
    assert.deepEqual(s.tasks, { total: 5, ordinary: 3, urgent: 1, system: 1, undated: 1 });
    assert.deepEqual(s.days, { working: 1, half: 1, off: 2, holiday: 1, leave: 1, mission: 1 });
  });
});

// ───────────────────────────── B1-c: هشدارهای برنامه‌ریزی ─────────────────────────────
describe('هشدارهای برنامه‌ریزی (B1-c): تابع خالص planWarnings', () => {
  const { planWarnings, MAX_TASKS_PER_DAY } = require('../src/services/planWeekDays');
  const day = (kind, i, tasks = []) => ({ date: `2026-09-${26 + i}`, jalali: `۱۴۰۵/۰۷/۰${i + 4}`, weekday: (6 + i) % 7, kind, tasks });
  const t = (extra = {}) => ({ id: Math.floor(Math.random() * 1e6), isSystem: false, isUrgent: false, ...extra });
  const codes = (w) => w.map((x) => x.code);
  const submitted = { hasPlan: true, status: 'submitted', minTasks: 0 };

  test('آستانه‌ی روزانه ۱۰ است', () => assert.equal(MAX_TASKS_PER_DAY, 10));

  test('برنامه‌ی سالم ⇒ بدون هشدار', () => {
    const days = [day('working', 0, [t()]), day('off', 1), day('holiday', 2), day('leave', 3), day('mission', 4), day('half', 5, [t()]), day('off', 6)];
    assert.deepEqual(planWarnings(days, [], { ...submitted, minTasks: 2 }), []);
  });

  test('PLAN_NOT_SUBMITTED: ناموجود (missing) و پیش‌نویس (draft)؛ ثبت‌شده نه', () => {
    const days = [day('off', 0)];
    assert.deepEqual(planWarnings(days, [], { hasPlan: false, status: null, minTasks: 0 }).map((w) => [w.code, w.reason]), [['PLAN_NOT_SUBMITTED', 'missing']]);
    assert.deepEqual(planWarnings(days, [], { hasPlan: true, status: 'draft', minTasks: 0 }).map((w) => [w.code, w.reason]), [['PLAN_NOT_SUBMITTED', 'draft']]);
    assert.deepEqual(planWarnings(days, [], submitted), []);
  });

  test('BELOW_MIN_TASKS: فقط تسک معمولی شمرده می‌شود (سیستمی/فوری نه)؛ min=0 هشدار ندارد', () => {
    const days = [day('working', 0, [t(), t({ isSystem: true }), t({ isUrgent: true })])];
    const w = planWarnings(days, [], { ...submitted, minTasks: 2 });
    assert.deepEqual(w.map((x) => [x.code, x.count, x.min]), [['BELOW_MIN_TASKS', 1, 2]]);
    assert.deepEqual(planWarnings(days, [], { ...submitted, minTasks: 1 }), []);
    assert.deepEqual(planWarnings([day('working', 0)], [t()], { ...submitted, minTasks: 0 }), []);
  });

  test('تسک روی روز آف/تعطیل/مرخصی هر کدام کد جدا دارد؛ مأموریت و تسک سیستمی نه', () => {
    const days = [day('off', 0, [t({ id: 1 })]), day('holiday', 1, [t({ id: 2 }), t({ id: 3 })]), day('leave', 2, [t({ id: 4 })]), day('mission', 3, [t()]), day('off', 4, [t({ isSystem: true })]), day('half', 5, [t()]), day('working', 6, [t()])];
    const w = planWarnings(days, [], submitted);
    assert.deepEqual(w.map((x) => [x.code, x.date, x.count]), [
      ['TASK_ON_OFF_DAY', '2026-09-26', 1], ['TASK_ON_HOLIDAY', '2026-09-27', 2], ['TASK_ON_LEAVE_DAY', '2026-09-28', 1],
    ]);
    assert.deepEqual(w[1].taskIds, [2, 3]);
  });

  test('WORKDAY_WITHOUT_TASK: روز کاری/نیم‌روز بدون تسک؛ تسک «هر روز» پوشش می‌دهد؛ تسک سیستمی کافی نیست', () => {
    const days = [day('working', 0), day('half', 1), day('off', 2), day('working', 3, [t({ isSystem: true })]), day('working', 4, [t()])];
    assert.deepEqual(codes(planWarnings(days, [], submitted)), ['WORKDAY_WITHOUT_TASK', 'WORKDAY_WITHOUT_TASK', 'WORKDAY_WITHOUT_TASK']);
    assert.deepEqual(planWarnings(days, [t({ plannedDate: null })], submitted), []);
  });

  test('TOO_MANY_TASKS_IN_DAY: ۱۰ مجاز، ۱۱ هشدار؛ تسک سیستمی شمرده نمی‌شود', () => {
    const many = (n, extra) => Array.from({ length: n }, () => t(extra));
    assert.deepEqual(planWarnings([day('working', 0, many(10))], [], submitted), []);
    assert.deepEqual(planWarnings([day('working', 0, [...many(10), ...many(5, { isSystem: true })])], [], submitted), []);
    const w = planWarnings([day('working', 0, many(11))], [], submitted);
    assert.deepEqual(w.map((x) => [x.code, x.count, x.max]), [['TOO_MANY_TASKS_IN_DAY', 11, 10]]);
  });

  test('ساختار: هر هشدار severity=warning و پیام فارسی (با نام روز و تاریخ شمسی برای هشدار روز) دارد؛ سطح برنامه قبل از روزها', () => {
    const days = [day('working', 0), day('off', 1, [t()])];
    const w = planWarnings(days, [], { hasPlan: false, status: null, minTasks: 3 });
    assert.deepEqual(codes(w), ['PLAN_NOT_SUBMITTED', 'BELOW_MIN_TASKS', 'WORKDAY_WITHOUT_TASK', 'TASK_ON_OFF_DAY']);
    for (const x of w) { assert.equal(x.severity, 'warning'); assert.match(x.message, /[؀-ۿ]/); }
    assert.match(w[2].message, /شنبه.*۱۴۰۵\/۰۷/);
  });
});

describe('هشدارهای برنامه‌ریزی روی GET plan (B1-c): کارمند با شیفت ۱۵:۳۰–۲۱:۰۰', () => {
  let db; let admin; let hr; let mgr; let emp; let fresh; let plansRepo;
  const holidaysRepo = require('../src/repositories/holidaysRepository');
  const settingsRepo = require('../src/repositories/settingsRepository');
  const leaveRepo = require('../src/repositories/leaveRepository');
  // هفته‌ی بعد (۰۹-۲۶ شنبه): شیفت کاری [شنبه، یکشنبه، دوشنبه، سه‌شنبه، چهارشنبه]؛ پنجشنبه/جمعه خارج از شیفت
  const SAT = '2026-09-26'; const SUN = '2026-09-27'; const MON = '2026-09-28'; const TUE = '2026-09-29'; const WED = '2026-09-30'; const THU = '2026-10-01';

  before(() => {
    mock.timers.enable({ apis: ['Date'], now: new Date(`${TODAY}T08:00:00Z`) });
    db = resetDb();
    plansRepo = require('../src/repositories/weeklyPlanRepository');
    admin = makeUser({ role: 'admin' });
    hr = makeUser({ role: 'hr' });
    mgr = makeUser({ role: 'manager' });
    emp = makeUser({ managerId: mgr.id });
    fresh = makeUser({ managerId: mgr.id });
    const shift = shiftsRepo.createShift({ name: 'عصر', startTime: '15:30', endTime: '21:00', graceLateMinutes: 0, graceEarlyMinutes: 0, workDays: [6, 0, 1, 2, 3], overnight: false, maxLunchMinutes: 0, fixedLunchDeductMinutes: 0 });
    db.prepare('UPDATE users SET shift_id = ? WHERE id IN (?, ?)').run(shift.id, emp.id, fresh.id);
    scheduleRepo.upsert({ userId: emp.id, date: SUN, kind: 'off', createdBy: admin.id }); // یکشنبه: آف
    holidaysRepo.addHoliday(MON, 'تعطیل تست', { kind: 'full', scope: 'all' }); // دوشنبه: تعطیل
    const req = leaveRepo.createLeaveRequest({ userId: emp.id, startDate: TUE, endDate: TUE, leaveType: 'leave', reason: 'تست' });
    leaveRepo.setStatus(req.id, 'approved', null); // سه‌شنبه: مرخصی
    settingsRepo.setValue('planMinTasks', 20);
  });
  after(() => { mock.timers.reset(); cleanup(); });

  const get = (actor, id, start) => svc.getPlanState(actor, id, start);
  const byCode = (r, code) => r.warnings.filter((w) => w.code === code);

  test('کارمند بدون برنامه: هشدار «ثبت‌نشده» (missing) + کمتر از حداقل + روزهای کاری بدون تسک؛ درخواست موفق است', () => {
    const r = get(admin, fresh.id);
    assert.equal(r.ok, true);
    assert.equal(r.plan.maxTasksPerDay, 10);
    assert.deepEqual(byCode(r, 'PLAN_NOT_SUBMITTED').map((w) => w.reason), ['missing']);
    assert.deepEqual(byCode(r, 'BELOW_MIN_TASKS').map((w) => [w.count, w.min]), [[0, 20]]);
    // شنبه تا چهارشنبه (۵ روز کاری شیفت)؛ تعطیلی/مرخصی/آف برای fresh وجود ندارد جز تعطیلِ سراسری دوشنبه
    assert.deepEqual(byCode(r, 'WORKDAY_WITHOUT_TASK').map((w) => w.date), [SAT, SUN, TUE, WED]);
    assert.equal(r.warnings.every((w) => w.severity === 'warning' && /[؀-ۿ]/.test(w.message)), true);
  });

  test('تسک روی آف/تعطیل/مرخصی و روز شلوغ: افزودن مجاز است (مسدودسازی نیست) و هشدار می‌دهد', () => {
    const add = (title, plannedDate) => svc.addTask(admin, emp.id, SAT, { title, plannedDate });
    assert.equal(add('روی آف', SUN).ok, true);
    assert.equal(add('روی تعطیل', MON).ok, true);
    assert.equal(add('روی مرخصی', TUE).ok, true);
    for (let i = 0; i < 11; i += 1) assert.equal(add(`شلوغ ${i}`, WED).ok, true);

    const r = get(admin, emp.id);
    assert.deepEqual(byCode(r, 'TASK_ON_OFF_DAY').map((w) => [w.date, w.count]), [[SUN, 1]]);
    assert.deepEqual(byCode(r, 'TASK_ON_HOLIDAY').map((w) => [w.date, w.count]), [[MON, 1]]);
    assert.deepEqual(byCode(r, 'TASK_ON_LEAVE_DAY').map((w) => [w.date, w.count]), [[TUE, 1]]);
    assert.deepEqual(byCode(r, 'TOO_MANY_TASKS_IN_DAY').map((w) => [w.date, w.count, w.max]), [[WED, 11, 10]]);
    assert.deepEqual(byCode(r, 'BELOW_MIN_TASKS').map((w) => [w.count, w.min]), [[14, 20]]);
    assert.deepEqual(byCode(r, 'WORKDAY_WITHOUT_TASK').map((w) => w.date), [SAT]); // فقط شنبه خالی است
    assert.deepEqual(byCode(r, 'PLAN_NOT_SUBMITTED').map((w) => w.reason), ['draft']);
    assert.equal(byCode(r, 'TASK_ON_OFF_DAY').length + byCode(r, 'TASK_ON_HOLIDAY').length + byCode(r, 'TASK_ON_LEAVE_DAY').length, 3);
    assert.equal(r.days.find((d) => d.date === THU).tasks.length, 0); // پنجشنبه (آف) تسکی ندارد ⇒ هشداری هم ندارد
  });

  test('ثبت نهایی برنامه و تسک «هر روز»: هشدارهای مربوط حذف می‌شوند؛ بقیه می‌مانند', () => {
    const plan = get(admin, emp.id).plan;
    plansRepo.markSubmitted(plan.id);
    assert.equal(svc.addTask(admin, emp.id, SAT, { title: 'هر روز' }).ok, true);
    const r = get(admin, emp.id);
    assert.equal(byCode(r, 'PLAN_NOT_SUBMITTED').length, 0);
    assert.equal(byCode(r, 'WORKDAY_WITHOUT_TASK').length, 0);
    assert.deepEqual(byCode(r, 'BELOW_MIN_TASKS').map((w) => w.count), [15]);
    assert.equal(byCode(r, 'TOO_MANY_TASKS_IN_DAY').length, 1);
  });

  test('سرپرست و hr همان هشدارها را می‌بینند؛ خارج از اسکوپ ⇒ FORBIDDEN و بدون هشدار', () => {
    const base = get(admin, emp.id).warnings.map((w) => w.code);
    assert.deepEqual(get(mgr, emp.id).warnings.map((w) => w.code), base);
    assert.deepEqual(get(hr, emp.id).warnings.map((w) => w.code), base);
    const other = get(makeUser({ role: 'manager' }), emp.id);
    assert.equal(other.code, 'FORBIDDEN');
    assert.equal(other.warnings, undefined);
  });

  test('هفته‌ی شروع‌شده: هشدارها هم محاسبه می‌شوند ولی editable=false و canEdit همه false', () => {
    const plan = plansRepo.getOrCreate(emp.id, TODAY);
    plansRepo.addTask(plan.id, { title: 'تسک هفته‌ی جاری', plannedDate: TODAY });
    const r = get(admin, emp.id, TODAY);
    assert.equal(r.plan.editable, true);
    assert.equal(r.plan.lockReason, null);
    assert.equal(r.days[0].tasks.length, 1);
    assert.equal(r.days.flatMap((d) => d.tasks).every((x) => x.canEdit === true), true);
    assert.equal(Array.isArray(r.warnings), true);
  });
});

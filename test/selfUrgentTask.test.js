// A3 (فاز ۱۵): تسک فوریِ خودِ کارمند — تنظیم‌ها، قواعد تاریخ/روز کاری، سقف روزانه، ویرایش/حذف، اسکوپ، اعلان و ناسازگارنبودن با تسک فوریِ مدیر.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const F = require('./helpers/factories');
const { zonedTimeToUtc } = require('../src/utils/time');

// هفته‌ی شنبه ۲۰۲۶-۰۸-۰۱ (شروع‌شده)؛ امروز یکشنبه ۰۸-۰۲؛ دوشنبه ۰۸-۰۳؛ پنجشنبه ۰۸-۰۶؛ جمعه ۰۸-۰۷ (آف)؛ هفته‌ی بعد از ۰۸-۰۸
const WEEK = '2026-08-01';
const TODAY = '2026-08-02';
const MON = '2026-08-03';
const TUE = '2026-08-04';
const FRI = '2026-08-07';
const NEXT_SUN = '2026-08-09';

describe('تسک فوریِ خودِ کارمند (A3)', () => {
  let db; let self; let urgent; let settings; let plans; let logs; let notes; let planSvc; let boss; let emp; let other; let loner; let admin; let NOW;
  const at = (d, h = '11:00') => zonedTimeToUtc(d, h, 'Asia/Tehran');
  const enable = (max = 5) => { settings.setValue('selfUrgentEnabled', true); settings.setValue('selfUrgentMaxPerDay', max); };
  const reset = () => {
    db.exec('DELETE FROM task_daily_logs; DELETE FROM plan_tasks; DELETE FROM weekly_plans; DELETE FROM month_closures; DELETE FROM leave_approvals; DELETE FROM leave_requests; DELETE FROM notifications; DELETE FROM audit_log;');
    settings.setValue('selfUrgentEnabled', false);
    settings.setValue('selfUrgentMaxPerDay', 5);
  };
  const add = (user, over = {}) => self.add(user, { title: 'کار فوری', date: TODAY, ...over }, { now: NOW });
  const row = (id) => plans.findTask(id);
  const settle = () => new Promise((res) => setTimeout(res, 20));
  const notesOf = (u, type) => notes.listForUser(u.id, {}).filter((n) => n.type === type);

  before(() => {
    db = resetDb();
    self = require('../src/services/selfUrgentTaskService');
    urgent = require('../src/services/urgentTaskService');
    settings = require('../src/repositories/settingsRepository');
    plans = require('../src/repositories/weeklyPlanRepository');
    logs = require('../src/repositories/taskLogRepository');
    notes = require('../src/repositories/notificationsRepository');
    planSvc = require('../src/services/weeklyPlanService');
    admin = F.makeUser({ role: 'admin' });
    boss = F.makeUser({ role: 'manager' });
    emp = F.makeUser({ managerId: boss.id });
    other = F.makeUser({ managerId: boss.id });
    loner = F.makeUser(); // بدون سرپرست ⇒ اعلان به ادمین‌ها
    NOW = at(TODAY);
  });
  after(cleanup);

  test('پیش‌فرض خاموش: SELF_URGENT_DISABLED و هیچ ردیفی ساخته نمی‌شود', () => {
    reset();
    const r = add(emp);
    assert.deepEqual([r.ok, r.code, r.status], [false, 'SELF_URGENT_DISABLED', 403]);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM plan_tasks').get().n, 0);
  });

  test('افزودن در هفته‌ی شروع‌شده: ساخت برنامه‌ی submittedِ خالی، فوری/بالا، assigned_by=خودش، manager_locked صفر', () => {
    reset(); enable();
    const r = add(emp, { title: '  تعمیر   چاپگر  ', description: 'کنار میز ۳' });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.createdPlan, true);
    const t = row(r.task.id);
    assert.deepEqual([t.is_urgent, t.priority, t.assigned_by_user_id, t.manager_locked, t.edited_by_user_id, t.planned_date, t.title, t.description],
      [1, 'high', emp.id, 0, null, TODAY, 'تعمیر چاپگر', 'کنار میز ۳']);
    assert.equal(self.isSelfAssigned(t, emp.id), true);
    const plan = plans.findByUserWeek(emp.id, WEEK);
    assert.equal(plan.status, 'submitted');
    assert.equal(r.task.selfAssigned, true);
    assert.ok(db.prepare("SELECT 1 FROM audit_log WHERE action = 'self_urgent_task_added' AND user_id = ?").get(emp.id));
    // برنامه‌ی موجود (حتی پیش‌نویس) دست‌نخورده می‌ماند و فقط تسک به آن اضافه می‌شود
    const r2 = add(emp, { date: MON });
    assert.deepEqual([r2.ok, r2.createdPlan], [true, false]);
  });

  test('مهلت ساعتی و یادداشتِ ارسالی نادیده گرفته می‌شود (فوریِ خودش ساده است)', () => {
    reset(); enable();
    const r = add(emp, { deadlineTime: '23:59', note: 'x' });
    const t = row(r.task.id);
    assert.deepEqual([t.urgent_deadline_time, t.urgent_note], [null, null]);
  });

  test('اعتبارسنجی: عنوان، توضیح، گذشته، دور، روز غیرکاری، مأموریتِ تمام‌روز، ماه بسته', () => {
    reset(); enable();
    const code = (over) => add(emp, over).code;
    assert.equal(code({ title: '   ' }), 'TITLE_REQUIRED');
    assert.equal(code({ title: 'ا'.repeat(121) }), 'TITLE_TOO_LONG');
    assert.equal(code({ description: 'ا'.repeat(501) }), 'DESCRIPTION_TOO_LONG');
    assert.equal(code({ date: 'abc' }), 'INVALID_DATE');
    assert.equal(code({ date: '2026-08-01' }), 'DATE_IN_PAST');
    assert.equal(code({ date: '2026-10-20' }), 'DATE_TOO_FAR');
    assert.equal(code({ date: FRI }), 'NOT_WORKING_DAY');
    F.makeApprovedMission(emp.id, TUE);
    assert.equal(code({ date: TUE }), 'NOT_WORKING_DAY');
    db.prepare("INSERT INTO month_closures (jalali_year, jalali_month, period_from, period_to, closed_by) VALUES (1405, 5, '2026-07-23', '2026-08-22', ?)").run(admin.id);
    assert.equal(code({ date: MON }), 'MONTH_CLOSED');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM plan_tasks').get().n, 0);
  });

  test('سقف روزانه: برای هر «روزِ برنامه‌ریزی‌شده»؛ حذف‌شده نمی‌شمارد؛ فوریِ سرپرست نمی‌شمارد', () => {
    reset(); enable(2);
    assert.equal(add(emp).ok, true);
    const second = add(emp);
    assert.equal(second.ok, true);
    const third = add(emp);
    assert.deepEqual([third.code, third.status], ['SELF_URGENT_LIMIT', 409]);
    assert.equal(add(emp, { date: MON }).ok, true, 'روز دیگر');
    assert.equal(add(other).ok, true, 'کارمند دیگر');
    assert.equal(self.remove(emp, second.task.id).ok, true);
    assert.equal(add(emp).ok, true, 'بعد از حذف جا باز می‌شود');
    // فوریِ مدیر در سقف نمی‌آید
    reset(); enable(1);
    assert.equal(urgent.assign(boss, emp, { title: 'از سرپرست', date: TODAY }, { now: NOW }).ok, true);
    assert.equal(add(emp).ok, true);
  });

  test('اعلان: یک‌بار به سرپرست، نه به خودِ کارمند و نه «تعیین‌شده توسط مدیر»؛ بدون سرپرست ⇒ ادمین‌ها', async () => {
    reset(); enable();
    assert.equal(add(emp).ok, true);
    await settle();
    assert.equal(notesOf(boss, 'self_urgent_task_added').length, 1);
    assert.equal(notes.listForUser(emp.id, {}).length, 0);
    assert.equal(notesOf(emp, 'urgent_task_assigned').length, 0);
    assert.equal(notesOf(admin, 'self_urgent_task_added').length, 0);
    assert.match(notesOf(boss, 'self_urgent_task_added')[0].body, /کار فوری/);
    assert.equal(add(loner).ok, true);
    await settle();
    assert.equal(notesOf(admin, 'self_urgent_task_added').length, 1);
    assert.equal(notes.listForUser(loner.id, {}).length, 0);
  });

  test('ویرایش: عنوان/توضیح/روز (داخل همان هفته)، خارج از هفته رد، روز غیرکاری رد، audit', () => {
    reset(); enable();
    const id = add(emp).task.id;
    const r = self.update(emp, id, { title: 'عنوان تازه', description: '', date: MON }, { now: NOW });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(r.changed, ['title', 'date']);
    const t = row(id);
    assert.deepEqual([t.title, t.planned_date, t.is_urgent, t.assigned_by_user_id, t.manager_locked], ['عنوان تازه', MON, 1, emp.id, 0]);
    assert.equal(self.update(emp, id, { date: NEXT_SUN }, { now: NOW }).code, 'DATE_OUT_OF_WEEK');
    assert.equal(self.update(emp, id, { date: FRI }, { now: NOW }).code, 'NOT_WORKING_DAY');
    assert.equal(self.update(emp, id, { title: ' ' }, { now: NOW }).code, 'TITLE_REQUIRED');
    assert.equal(self.update(emp, id, {}, { now: NOW }).code, 'NOTHING_TO_UPDATE');
    assert.equal(row(id).planned_date, MON);
    assert.ok(db.prepare("SELECT 1 FROM audit_log WHERE action = 'self_urgent_task_edited'").get());
  });

  test('ویرایش/حذف تا قبل از پاسخ؛ با پاسخ HAS_ANSWERS؛ حذف نرم + audit', () => {
    reset(); enable();
    const a = add(emp).task.id;
    const b = add(emp, { title: 'دوم' }).task.id;
    logs.upsert({ taskId: a, userId: emp.id, logDate: TODAY, status: 'done' });
    assert.equal(self.update(emp, a, { title: 'x' }, { now: NOW }).code, 'HAS_ANSWERS');
    assert.deepEqual([self.remove(emp, a).code, self.remove(emp, a).status], ['HAS_ANSWERS', 409]);
    assert.equal(row(a).deleted_at, null);
    assert.equal(self.remove(emp, b).ok, true);
    assert.notEqual(row(b).deleted_at, null);
    assert.equal(self.remove(emp, b).code, 'TASK_NOT_FOUND', 'حذف‌شده دیگر وجود ندارد');
    assert.ok(db.prepare("SELECT 1 FROM audit_log WHERE action = 'self_urgent_task_removed'").get());
  });

  test('فوریِ سرپرست برای کارمند رد (NOT_SELF_URGENT)؛ تسک کارمند دیگر ⇒ TASK_NOT_FOUND؛ مسیر مدیر دست‌نخورده', () => {
    reset(); enable();
    const m = urgent.assign(boss, emp, { title: 'از سرپرست', date: TODAY, deadlineTime: '23:00', note: 'مهم' }, { now: NOW });
    assert.equal(m.ok, true, JSON.stringify(m));
    assert.deepEqual([self.update(emp, m.task.id, { title: 'x' }, { now: NOW }).code, self.remove(emp, m.task.id).code], ['NOT_SELF_URGENT', 'NOT_SELF_URGENT']);
    assert.equal(row(m.task.id).title, 'از سرپرست');
    assert.equal(self.isSelfAssigned(row(m.task.id), emp.id), false);
    const mine = add(emp).task.id;
    assert.deepEqual([self.update(other, mine, { title: 'x' }, { now: NOW }).code, self.remove(other, mine).code], ['TASK_NOT_FOUND', 'TASK_NOT_FOUND']);
    assert.equal(self.remove(emp, 999999).code, 'TASK_NOT_FOUND');
    // مدیر هنوز می‌تواند فوریِ خودِ کارمند را مثل هر فوریِ دیگر حذف کند و برای خودش نمی‌تواند تعیین کند
    assert.equal(urgent.remove(boss, mine).ok, true);
    assert.equal(urgent.assign(boss, boss, { title: 'خود', date: TODAY }, { now: NOW }).code, 'SELF_NOT_ALLOWED');
    assert.equal(urgent.assign(emp, other, { title: 'x', date: TODAY }, { now: NOW }).code, 'FORBIDDEN');
  });

  test('خاموش‌کردن تنظیم ویرایش/حذف را نمی‌بندد، ولی افزودن را می‌بندد', () => {
    reset(); enable();
    const id = add(emp).task.id;
    settings.setValue('selfUrgentEnabled', false);
    assert.equal(add(emp).code, 'SELF_URGENT_DISABLED');
    assert.equal(self.update(emp, id, { title: 'هنوز ممکن' }, { now: NOW }).ok, true);
    assert.equal(self.remove(emp, id).ok, true);
  });

  test('کاربر غیرفعال ⇒ USER_NOT_FOUND', () => {
    reset(); enable();
    const gone = F.makeUser({ managerId: boss.id, active: false });
    assert.equal(add(gone).code, 'USER_NOT_FOUND');
  });

  test('saveDraft (هفته‌ی بعد) فوریِ خودش را نمی‌خواند، نمی‌نویسد و حذف نمی‌کند؛ و با ثبت‌شدن برنامه هم می‌ماند', () => {
    reset(); enable();
    const r = add(emp, { date: NEXT_SUN });
    assert.equal(r.ok, true, JSON.stringify(r));
    const urgentId = r.task.id;
    const draft = planSvc.saveDraft(emp, 'next', [{ title: 'عادی', plannedDate: NEXT_SUN }], { now: NOW });
    assert.equal(draft.ok, true, JSON.stringify(draft));
    assert.equal(row(urgentId).deleted_at, null);
    assert.equal(row(urgentId).title, 'کار فوری');
    // اگر کلاینت کهنه شناسه‌ی فوری را برگرداند، نادیده گرفته می‌شود (نه خطا، نه بازنویسی)
    const again = planSvc.saveDraft(emp, 'next', [{ id: urgentId, title: 'دستکاری', plannedDate: NEXT_SUN }, { title: 'عادی', plannedDate: NEXT_SUN }], { now: NOW });
    assert.equal(again.ok, true, JSON.stringify(again));
    assert.equal(row(urgentId).title, 'کار فوری');
    assert.equal(row(urgentId).is_urgent, 1);
  });

  test('فوریِ مدیر: رفتار قبلی بدون تغییر (اعلان به کارمند، مهلت/یادداشت ذخیره)', async () => {
    reset();
    const m = urgent.assign(boss, emp, { title: 'مدیر', date: MON, deadlineTime: '10:30', note: 'یادداشت' }, { now: NOW });
    assert.equal(m.ok, true, JSON.stringify(m));
    const t = row(m.task.id);
    assert.deepEqual([t.assigned_by_user_id, t.urgent_deadline_time, t.urgent_note, t.priority], [boss.id, '10:30', 'یادداشت', 'high']);
    await settle();
    assert.equal(notesOf(emp, 'urgent_task_assigned').length, 1);
    assert.equal(notesOf(boss, 'self_urgent_task_added').length, 0);
  });
});

// D2: روز ثبت برنامه‌ی هفتگی (getPlanDay)، روز کاریِ قبل، شروع هفته و تنظیمات برنامه‌ریزی.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const F = require('./helpers/factories');

// هفته‌ی شنبه ۲۰۲۶-۰۸-۰۱ (شنبه) … جمعه ۲۰۲۶-۰۸-۰۷. پنجشنبه ۰۸-۰۶ (نیم‌روز پیش‌فرض)، جمعه آخر هفته.
const WEEK = '2026-08-01';

describe('روز ثبت برنامه (D2)', () => {
  let db; let cal; let holidays; let shifts; let settingsRepo; let leaveRepo; let u;
  before(() => {
    db = resetDb();
    cal = require('../src/engine/calendarService');
    holidays = require('../src/repositories/holidaysRepository');
    shifts = require('../src/repositories/shiftsRepository');
    settingsRepo = require('../src/repositories/settingsRepository');
    leaveRepo = require('../src/repositories/leaveRepository');
    u = F.makeUser();
  });
  after(cleanup);
  const reset = () => { db.exec("DELETE FROM holidays; DELETE FROM leave_approvals; DELETE FROM leave_requests; DELETE FROM settings WHERE key = 'plan_submission_weekday';"); };

  test('تنظیمات برنامه‌ریزی: پیش‌فرض‌ها و اعتبارسنجی', () => {
    const s = settingsRepo.getAll();
    assert.deepEqual(
      [s.weekStartDay, s.planSubmissionWeekday, s.planMinTasks, s.planGateMode, s.planGateStartDate, s.dailyReportGateMode, s.reportBackfillDays, s.encouragementsEnabled],
      [6, 'auto', 1, 'off', '', 'enforce', 2, true], // R1: گیت خروج پیش‌فرض روشن
    );
    const reg = require('../src/utils/settingsRegistry');
    assert.deepEqual(reg.selfCheck(), []);
  });

  test('weekStartOf: شنبه‌محور و روز دلخواه', () => {
    assert.equal(cal.weekStartOf('2026-08-01'), '2026-08-01');
    assert.equal(cal.weekStartOf('2026-08-06'), '2026-08-01'); // پنجشنبه
    assert.equal(cal.weekStartOf('2026-08-07'), '2026-08-01'); // جمعه
    assert.equal(cal.weekStartOf('2026-08-08'), '2026-08-08');
    assert.equal(cal.weekStartOf('2026-08-06', 0), '2026-08-02'); // هفته‌ی یکشنبه‌محور
  });

  test('پنجشنبه‌ی عادی (نیم‌روز، کاری) ⇒ planDay = پنجشنبه', () => {
    reset();
    assert.equal(cal.getPlanDay(u, WEEK), '2026-08-06');
  });

  test('پنجشنبه تعطیل ⇒ چهارشنبه', () => {
    reset();
    holidays.addHoliday('2026-08-06', 'تعطیلی تست');
    assert.equal(cal.getPlanDay(u, WEEK), '2026-08-05');
  });

  test('شیفت بدون پنجشنبه (روزهای کاری شنبه..چهارشنبه) ⇒ چهارشنبه؛ شیفتِ شامل جمعه ⇒ جمعه', () => {
    reset();
    const mk = (name, workDays) => shifts.createShift({ name, startTime: '08:00', endTime: '16:00', graceLateMinutes: 0, graceEarlyMinutes: 0, workDays, overnight: false, maxLunchMinutes: 0, fixedLunchDeductMinutes: 0 });
    const s1 = mk('ش۱', [6, 0, 1, 2, 3]);
    db.prepare('UPDATE users SET shift_id = ? WHERE id = ?').run(s1.id, u.id);
    assert.equal(cal.getPlanDay(u, WEEK), '2026-08-05');
    const s2 = mk('ش۲', [6, 0, 1, 2, 3, 4, 5]);
    db.prepare('UPDATE users SET shift_id = ? WHERE id = ?').run(s2.id, u.id);
    assert.equal(cal.getPlanDay(u, WEEK), '2026-08-07');
    db.prepare('UPDATE users SET shift_id = NULL WHERE id = ?').run(u.id);
  });

  test('کاربر در planDay مرخصیِ تمام‌روز دارد ⇒ روز کاریِ قبل؛ مرخصی ساعتی مانع نیست', () => {
    reset();
    const annual = require('../src/repositories/leaveTypesRepository').findByCode('annual');
    const r = leaveRepo.createLeaveRequest({ userId: u.id, startDate: '2026-08-06', endDate: '2026-08-06', leaveTypeId: annual.id });
    leaveRepo.setStatus(r.id, 'approved', null);
    assert.equal(cal.getPlanDay(u, WEEK), '2026-08-05');
    db.exec('DELETE FROM leave_approvals; DELETE FROM leave_requests;');
    const h = leaveRepo.createLeaveRequest({ userId: u.id, startDate: '2026-08-06', endDate: '2026-08-06', leaveTypeId: annual.id, unit: 'hour', startTime: '08:00', endTime: '09:00' });
    leaveRepo.setStatus(h.id, 'approved', null);
    assert.equal(cal.getPlanDay(u, WEEK), '2026-08-06');
  });

  test('تنظیم عددی planSubmissionWeekday: همان روز؛ اگر کاری نبود ⇒ قبل‌تر؛ هفته‌ی بدون روز کاری ⇒ null', () => {
    reset();
    settingsRepo.setValue('planSubmissionWeekday', '2'); // سه‌شنبه
    assert.equal(cal.getPlanDay(u, WEEK), '2026-08-04');
    holidays.addHoliday('2026-08-04', 'تعطیل');
    assert.equal(cal.getPlanDay(u, WEEK), '2026-08-03');
    settingsRepo.setValue('planSubmissionWeekday', 'auto');
    for (const d of ['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06']) holidays.addHoliday(d, 'تعطیل');
    assert.equal(cal.getPlanDay(u, WEEK), null);
    reset();
  });

  test('getPreviousWorkingDay: عادی، پس از آخر هفته، پس از تعطیلی؛ بدون روز کاری ⇒ null', () => {
    reset();
    assert.equal(cal.getPreviousWorkingDay(u, '2026-08-03'), '2026-08-02'); // دوشنبه ⇒ یکشنبه
    assert.equal(cal.getPreviousWorkingDay(u, '2026-08-08'), '2026-08-06'); // شنبه ⇒ پنجشنبه (جمعه آخر هفته)
    holidays.addHoliday('2026-08-06', 'تعطیل');
    assert.equal(cal.getPreviousWorkingDay(u, '2026-08-08'), '2026-08-05');
    assert.equal(cal.getPreviousWorkingDay(u, '2026-08-08', { maxBack: 1 }), null);
    reset();
  });

  test('نوع date در رجیستری: معتبر/خالی/نامعتبر', () => {
    const reg = require('../src/utils/settingsRegistry');
    const def = reg.getDef('planGateStartDate');
    assert.ok(def);
    {
      assert.equal(reg.validateValue(def, '2026-08-01').ok, true);
      assert.equal(reg.validateValue(def, '').value, '');
      assert.equal(reg.validateValue(def, '2026-02-30').ok, false);
      assert.equal(reg.validateValue(def, '۱۴۰۵/۰۵/۱۰').ok, false);
    }
  });
});

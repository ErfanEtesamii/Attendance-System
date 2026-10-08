// S4-8b-2: اتصال مرخصی‌های «تأییدشده» به موتور از مسیر dayService (repository ⇒ leaveWindowsOnDate ⇒ computeDay).
// منطق خالص در leaveEngineEffect.test.js (S4-8b-1) تست شده؛ این‌جا فقط اتصال/DB: ساعتی، نیم‌روز صبح/عصر، چندروزه با تعطیلی وسط،
// و اینکه pending/rejected/کاربر دیگر اثری ندارند و context کش می‌کند.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const dayService = require('../src/engine/dayService');
const leaveRepo = require('../src/repositories/leaveRepository');
const attendanceRepo = require('../src/repositories/attendanceRepository');
const holidaysRepo = require('../src/repositories/holidaysRepository');
const { zonedTimeToUtc } = require('../src/utils/time');
const { makeUser } = require('./helpers/factories');

const TEHRAN = 'Asia/Tehran';
const at = (date, hhmm) => zonedTimeToUtc(date, hhmm, TEHRAN).toISOString();
// هفته‌ی مرجع: شنبه ۰۹-۱۲ … چهارشنبه ۰۹-۱۶ (پنجشنبه نیم‌روز، جمعه آخر هفته؛ ساعت کاری پیش‌فرض ۰۸:۰۰–۱۶:۳۰ = ۵۱۰)
const MON = '2026-09-14';
const TUE = '2026-09-15';
const WED = '2026-09-16';

describe('اتصال مرخصی تأییدشده به موتور (S4-8b-2)', () => {
  let user;
  before(() => {
    resetDb();
    user = makeUser();
    holidaysRepo.addHoliday(TUE, 'تعطیلی تست');
  });
  after(() => cleanup());

  const approve = (u, o) => {
    const r = leaveRepo.createLeaveRequest({ userId: u.id, leaveType: 'leave', ...o });
    return leaveRepo.setStatus(r.id, 'approved', null);
  };
  const record = (u, date, inn, out) => attendanceRepo.createManual({ userId: u.id, recordDate: date, checkInTime: at(date, inn), checkOutTime: out ? at(date, out) : null, status: 'normal' });
  const key = (d) => ({ expected: d.expected, late: d.late, early: d.earlyLeave, overtime: d.overtime });
  const NOW = at(WED, '23:00');

  test('بدون مرخصی تأییدشده: خروجی مثل قبل (و pending/rejected/کاربر دیگر اثر ندارند)', () => {
    const rec = record(user, MON, '08:20', '16:00');
    const base = key(dayService.computeRecordDay(rec, { now: NOW }));
    assert.deepEqual(base, { expected: 510, late: 20, early: 30, overtime: 0 });
    const pending = leaveRepo.createLeaveRequest({ userId: user.id, leaveType: 'leave', startDate: MON, endDate: MON, unit: 'hour', startTime: '10:00', endTime: '12:00' });
    const rejected = leaveRepo.createLeaveRequest({ userId: user.id, leaveType: 'leave', startDate: MON, endDate: MON, unit: 'hour', startTime: '13:00', endTime: '14:00' });
    leaveRepo.setStatus(rejected.id, 'rejected', null);
    const other = makeUser();
    approve(other, { startDate: MON, endDate: MON });
    assert.deepEqual(key(dayService.computeRecordDay(rec, { now: NOW })), base);
    leaveRepo.remove(pending.id);
    leaveRepo.remove(rejected.id);
  });

  test('ساعتی وسط روز و نیم‌روز صبح/عصر', () => {
    const u = makeUser();
    const d1 = '2026-09-13'; // یکشنبه
    const d2 = '2026-09-12'; // شنبه
    const d3 = '2026-09-16'; // چهارشنبه
    approve(u, { startDate: d1, endDate: d1, unit: 'hour', startTime: '10:00', endTime: '12:00' });
    approve(u, { startDate: d2, endDate: d2, unit: 'half_day', halfDayPart: 'morning' });
    approve(u, { startDate: d3, endDate: d3, unit: 'half_day', halfDayPart: 'afternoon' });
    // ساعتی ۱۰–۱۲: expected = ۵۱۰−۱۲۰؛ ورود/خروج کامل ⇒ بدون تأخیر/زودتر رفتن
    assert.deepEqual(key(dayService.computeRecordDay(record(u, d1, '08:00', '16:30'), { now: NOW })), { expected: 390, late: 0, early: 0, overtime: 0 });
    // نیم‌روز صبح = ۲۵۵ دقیقه (۰۸:۰۰–۱۲:۱۵): ورود ۱۲:۱۵ ⇒ تأخیر ۰، expected = ۲۵۵
    assert.deepEqual(key(dayService.computeRecordDay(record(u, d2, '12:15', '16:30'), { now: NOW })), { expected: 255, late: 0, early: 0, overtime: 0 });
    // و ورود ۱۲:۳۵ ⇒ ۲۰ دقیقه تأخیر نسبت به شروعِ مؤثر
    const lateRec = record(makeUserWithLeave(d2), d2, '12:35', '16:30');
    assert.equal(dayService.computeRecordDay(lateRec, { now: NOW }).late, 20);
    // نیم‌روز عصر: خروج ۱۲:۱۵ زودتر رفتن نیست؛ expected = ۲۵۵
    assert.deepEqual(key(dayService.computeRecordDay(record(u, d3, '08:00', '12:15'), { now: NOW })), { expected: 255, late: 0, early: 0, overtime: 0 });
  });

  function makeUserWithLeave(date) {
    const u = makeUser();
    approve(u, { startDate: date, endDate: date, unit: 'half_day', halfDayPart: 'morning' });
    return u;
  }

  test('چندروزه با تعطیلی وسط: روز کاری قبل/بعد از تعطیلی کامل در مرخصی است', () => {
    const u = makeUser();
    approve(u, { startDate: MON, endDate: WED }); // دوشنبه..چهارشنبه؛ سه‌شنبه تعطیل
    for (const d of [MON, WED]) {
      const r = dayService.computeRecordDay(record(u, d, '09:00', '12:00'), { now: NOW });
      assert.deepEqual(key(r), { expected: 0, late: 0, early: 0, overtime: 0 }, d);
    }
    // مرخصی روز کامل برای روز قبل از بازه اثری ندارد
    const before = dayService.computeRecordDay(record(u, '2026-09-13', '08:00', '16:30'), { now: NOW });
    assert.equal(before.expected, 510);
  });

  test('opts.approvedLeaves صریح اولویت دارد؛ context مرخصی‌ها را کش می‌کند؛ summarizeRecord همان اثر را می‌بیند', () => {
    const u = makeUser();
    const d = '2026-09-13';
    approve(u, { startDate: d, endDate: d, unit: 'hour', startTime: '08:00', endTime: '10:00' });
    const rec = record(u, d, '10:30', '16:30');
    const context = dayService.loadContext();
    assert.equal(dayService.computeRecordDay(rec, { now: NOW, context }).late, 30);
    assert.equal(dayService.computeRecordDay(rec, { now: NOW, context, approvedLeaves: null }).late, 150);
    assert.equal(context.leaveCache.size, 1);
    assert.equal(dayService.summarizeRecord(rec, { now: NOW, context }).lateMinutes, 30);
    // context ساخته‌شده‌ی دستی (بدون کش) هم کار می‌کند
    assert.equal(dayService.computeRecordDay(rec, { now: NOW, context: { settings: context.settings, timezone: context.timezone } }).late, 30);
  });
});

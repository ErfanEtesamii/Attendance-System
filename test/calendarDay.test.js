// S3-7a: getCalendarDay (بدون جدول جدید). بخش خالص بدون DB؛ بخش DB با resetDb.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { getCalendarDay, resolveCalendarDay, weekdayOf } = require('../src/engine/calendarService');
const registry = require('../src/utils/settingsRegistry');
const settingsRepo = require('../src/repositories/settingsRepository');
const holidaysRepo = require('../src/repositories/holidaysRepository');
const shiftsRepo = require('../src/repositories/shiftsRepository');
const usersRepo = require('../src/repositories/usersRepository');
const { makeUser } = require('./helpers/factories');

const S = { workDayStart: '08:00', workDayEnd: '16:30', weekendDays: [5], halfDayWeekdays: [4], halfDayEndTime: '12:30' };
const pure = (dateStr, extra = {}) => resolveCalendarDay({ dateStr, settings: S, ...extra });
// هفته‌ی ۲۰۲۶-۰۹-۱۲ (شنبه) تا ۲۰۲۶-۰۹-۱۸ (جمعه)
const WEEK = { sat: '2026-09-12', sun: '2026-09-13', mon: '2026-09-14', tue: '2026-09-15', wed: '2026-09-16', thu: '2026-09-17', fri: '2026-09-18' };

describe('getCalendarDay خالص (S3-7a)', () => {
  test('روز هفته از تاریخ: ۰=یکشنبه … ۶=شنبه؛ تاریخ نامعتبر ⇒ RangeError', () => {
    assert.deepEqual(Object.values(WEEK).map(weekdayOf), [6, 0, 1, 2, 3, 4, 5]);
    assert.equal(weekdayOf('1970-01-01'), 4);
    assert.throws(() => weekdayOf('2026-02-31'), RangeError);
    assert.throws(() => pure('abc'), RangeError);
  });

  test('پیش‌فرض: شنبه تا چهارشنبه کامل، پنجشنبه نیم‌روز ۱۲:۳۰، جمعه آخر هفته', () => {
    const full = { isWorkingDay: true, isHoliday: false, holidayTitle: null, expectedStart: '08:00', expectedEnd: '16:30', kind: 'working' };
    ['sat', 'sun', 'mon', 'tue', 'wed'].forEach((d) => assert.deepEqual(pure(WEEK[d]), full, d));
    assert.deepEqual(pure(WEEK.thu), { ...full, expectedEnd: '12:30', kind: 'half' });
    assert.deepEqual(pure(WEEK.fri), { isWorkingDay: false, isHoliday: false, holidayTitle: null, expectedStart: null, expectedEnd: null, kind: 'weekend' });
  });

  test('تنظیمات: آخر هفته‌ی دو روزه، نیم‌روز خاموش، ساعت نیم‌روز دیگر', () => {
    const two = { ...S, weekendDays: [4, 5], halfDayWeekdays: [] };
    assert.equal(resolveCalendarDay({ dateStr: WEEK.thu, settings: two }).kind, 'weekend');
    assert.equal(resolveCalendarDay({ dateStr: WEEK.sat, settings: two }).kind, 'working');
    const noHalf = { ...S, halfDayWeekdays: [] };
    assert.deepEqual([resolveCalendarDay({ dateStr: WEEK.thu, settings: noHalf }).kind, resolveCalendarDay({ dateStr: WEEK.thu, settings: noHalf }).expectedEnd], ['working', '16:30']);
    assert.equal(resolveCalendarDay({ dateStr: WEEK.thu, settings: { ...S, halfDayEndTime: '13:00' } }).expectedEnd, '13:00');
  });

  test('ساعت نیم‌روز نامعتبر (≤ شروع یا ≥ پایان) نادیده ⇒ روز کامل؛ هرگز exception', () => {
    ['07:59', '08:00', '16:30', '18:00'].forEach((t) => {
      const r = resolveCalendarDay({ dateStr: WEEK.thu, settings: { ...S, halfDayEndTime: t } });
      assert.deepEqual([r.kind, r.expectedEnd, r.isWorkingDay], ['working', '16:30', true], t);
    });
    assert.equal(resolveCalendarDay({ dateStr: WEEK.thu, settings: { ...S, halfDayEndTime: 'x' } }).kind, 'working');
  });

  test('تعطیلی ثبت‌شده: بر روز کاری و آخر هفته غالب است و عنوان برمی‌گردد', () => {
    const h = { title: 'تعطیل تستی' };
    const want = { isWorkingDay: false, isHoliday: true, holidayTitle: 'تعطیل تستی', expectedStart: null, expectedEnd: null, kind: 'holiday' };
    assert.deepEqual(pure(WEEK.mon, { holiday: h }), want);
    assert.deepEqual(pure(WEEK.fri, { holiday: h }), want);
    assert.deepEqual(pure(WEEK.thu, { holiday: h }), want);
  });

  test('شیفت: workDays شیفت مرجع است (نه weekend_days)، ساعت از شیفت، نیم‌روز فقط اگر روز در workDays باشد', () => {
    const shift = { startTime: '14:00', endTime: '22:00', workDays: [0, 1, 2, 3, 6], overnight: false };
    assert.deepEqual([pure(WEEK.mon, { shift }).expectedStart, pure(WEEK.mon, { shift }).expectedEnd], ['14:00', '22:00']);
    assert.equal(pure(WEEK.thu, { shift }).kind, 'weekend'); // پنجشنبه در workDays نیست ⇒ نیم‌روز هم نمی‌شود
    const withThu = { ...shift, workDays: [0, 1, 2, 3, 4, 6] };
    const thu = pure(WEEK.thu, { shift: withThu });
    assert.deepEqual([thu.kind, thu.expectedStart, thu.expectedEnd], ['working', '14:00', '22:00']); // ۱۲:۳۰ پیش از شروع شیفت ⇒ نیم‌روز نادیده
    const morning = { startTime: '08:00', endTime: '16:00', workDays: [0, 1, 2, 3, 4, 6], overnight: false };
    const mThu = pure(WEEK.thu, { shift: morning });
    assert.deepEqual([mThu.kind, mThu.expectedStart, mThu.expectedEnd], ['half', '08:00', '12:30']);
    // شیفتی که جمعه هم کار می‌کند: weekend_days نادیده
    assert.equal(pure(WEEK.fri, { shift: { ...shift, workDays: [5] } }).isWorkingDay, true);
  });

  test('شیفت: نیم‌روز با ساعت بیرون از بازه‌ی شیفت (۱۲:۳۰ پیش از شروع ۱۴:۰۰) نادیده؛ شیفت شب نیم‌روز ندارد', () => {
    const evening = { startTime: '14:00', endTime: '22:00', workDays: [0, 1, 2, 3, 4, 6], overnight: false };
    assert.deepEqual([pure(WEEK.thu, { shift: evening }).kind, pure(WEEK.thu, { shift: evening }).expectedEnd], ['working', '22:00']);
    const night = { startTime: '22:00', endTime: '06:00', workDays: [0, 1, 2, 3, 4, 6], overnight: true };
    const r = pure(WEEK.thu, { shift: night });
    assert.deepEqual([r.kind, r.expectedStart, r.expectedEnd], ['working', '22:00', '06:00']);
  });
});

describe('getCalendarDay با DB (S3-7a)', () => {
  before(() => { resetDb(); });
  after(() => { cleanup(); });

  test('رجیستری: سه کلید تقویم با پیش‌فرض صحیح و اعتبارسنجی', () => {
    assert.deepEqual(registry.selfCheck(), []);
    assert.deepEqual([registry.defaultOf('weekendDays'), registry.defaultOf('halfDayWeekdays'), registry.defaultOf('halfDayEndTime')], [[5], [4], '12:30']);
    assert.deepEqual(registry.validate('weekendDays', '5,4,5'), { ok: true, value: [4, 5] });
    assert.deepEqual(registry.validate('weekendDays', [5]), { ok: true, value: [5] });
    assert.equal(registry.validate('weekendDays', []).ok, false); // آخر هفته حداقل یک روز
    assert.equal(registry.validate('weekendDays', [0, 1, 2, 3, 4, 5, 6]).ok, false);
    assert.equal(registry.validate('weekendDays', [7]).ok, false);
    assert.equal(registry.validate('weekendDays', 'a,b').ok, false);
    assert.deepEqual(registry.validate('halfDayWeekdays', []), { ok: true, value: [] }); // خالی = بدون نیم‌روز
    assert.equal(registry.validate('halfDayEndTime', '25:00').ok, false);
    assert.ok(registry.sameValue([4], [4]) && !registry.sameValue([4], [5]));
  });

  test('ذخیره/خواندن آرایه از DB، خرابی ⇒ پیش‌فرض، isDefault درست', () => {
    assert.equal(settingsRepo.getItem('weekendDays').isDefault, true);
    settingsRepo.setValue('halfDayWeekdays', []);
    assert.deepEqual(settingsRepo.getAll().halfDayWeekdays, []);
    assert.equal(settingsRepo.getItem('halfDayWeekdays').isDefault, false);
    settingsRepo.resetValue('halfDayWeekdays');
    assert.deepEqual(settingsRepo.getAll().halfDayWeekdays, [4]);
    require('../src/db/connection').getDb().prepare("INSERT INTO settings (key, value) VALUES ('weekend_days', 'garbage')").run();
    assert.deepEqual(settingsRepo.getAll().weekendDays, [5]);
    settingsRepo.resetValue('weekendDays');
  });

  test('getCalendarDay: جدول holidays فعلی، کاربر بدون شیفت، کاربر با شیفت و شیفت مستقیم', () => {
    holidaysRepo.addHoliday('2026-09-14', 'تعطیلی آزمایشی');
    assert.equal(holidaysRepo.findByDate('2026-09-15'), null);

    assert.deepEqual(getCalendarDay(null, '2026-09-14'), { isWorkingDay: false, isHoliday: true, holidayTitle: 'تعطیلی آزمایشی', expectedStart: null, expectedEnd: null, kind: 'holiday' });
    assert.equal(getCalendarDay(null, '2026-09-15').kind, 'working');
    assert.equal(getCalendarDay(null, WEEK.thu).kind, 'half');
    assert.equal(getCalendarDay(null, WEEK.fri).kind, 'weekend');

    const plain = makeUser();
    assert.equal(getCalendarDay(plain, WEEK.thu).kind, 'half'); // بدون شیفت ⇒ سراسری

    const shift = shiftsRepo.createShift({ name: 'عصر', startTime: '14:00', endTime: '22:00', graceLateMinutes: 0, graceEarlyMinutes: 0, workDays: [0, 1, 2, 3, 6], overnight: false, maxLunchMinutes: 0, fixedLunchDeductMinutes: 0 });
    const u = makeUser();
    require('../src/db/connection').getDb().prepare('UPDATE users SET shift_id = ? WHERE id = ?').run(shift.id, u.id);
    const withShift = usersRepo.findById(u.id);
    const r = getCalendarDay(withShift, WEEK.sat);
    assert.deepEqual([r.kind, r.expectedStart, r.expectedEnd], ['working', '14:00', '22:00']);
    assert.equal(getCalendarDay(withShift, WEEK.thu).kind, 'weekend'); // پنجشنبه در workDays شیفت نیست
    assert.equal(getCalendarDay(shift, WEEK.sat).expectedStart, '14:00'); // خود شیفت
  });
});

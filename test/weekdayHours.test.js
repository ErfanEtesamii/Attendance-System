// ساعت ثابتِ روزهای مشخص داخل شیفتِ چرخشی (migration ۰۴۴): اعتبارسنجی، ذخیره، شیفتِ مؤثرِ هر روز و تقویم.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const WED = '2026-10-28'; // چهارشنبه (۳)
const THU = '2026-10-29'; // پنجشنبه (۴)
const SUN = '2026-10-25'; // یکشنبه (۰)
const FIXED = { 3: { startTime: '08:30', endTime: '16:00' }, 4: { startTime: '08:30', endTime: '16:00' } };

describe('شیفت چرخشی با ساعت ثابتِ روزهای مشخص', () => {
  let db;
  before(() => { db = resetDb(); });
  after(cleanup);

  test('migration: ستون weekday_hours با پیش‌فرض {}', () => {
    const col = db.prepare("PRAGMA table_info('work_shifts')").all().find((c) => c.name === 'weekday_hours');
    assert.ok(col && col.notnull === 1);
  });

  test('اعتبارسنجی: ورودی درست نرمال می‌شود؛ ورودی نادرست ردّ می‌شود', () => {
    const { validateShiftInput } = require('../src/utils/shiftValidation');
    const ok = validateShiftInput({ name: 'چرخشی', isUntimed: true, workDays: [6, 0, 1, 2, 3, 4], weekdayHours: { 3: { startTime: '8:30', endTime: '16:00' } } });
    assert.equal(ok.ok, true);
    assert.deepEqual(ok.value.weekdayHours, { 3: { startTime: '08:30', endTime: '16:00' } });
    const bad = (input) => validateShiftInput({ name: 'x', startTime: '08:00', endTime: '16:00', ...input });
    assert.equal(bad({ weekdayHours: FIXED }).field, 'weekdayHours'); // شیفت عادی (isUntimed نیست)
    assert.equal(validateShiftInput({ name: 'x', isUntimed: true, workDays: [6], weekdayHours: FIXED }).field, 'weekdayHours'); // روز خارج از workDays
    assert.equal(validateShiftInput({ name: 'x', isUntimed: true, workDays: [3], weekdayHours: { 3: { startTime: '16:00', endTime: '08:00' } } }).field, 'weekdayHours');
    assert.equal(validateShiftInput({ name: 'x', isUntimed: true, workDays: [3], weekdayHours: { 9: { startTime: '08:00', endTime: '16:00' } } }).field, 'weekdayHours');
    assert.equal(validateShiftInput({ name: 'x', isUntimed: true, workDays: [3], weekdayHours: { 3: { startTime: '08:00' } } }).field, 'weekdayHours');
  });

  test('repository + shiftOn + تقویم: چهارشنبه/پنجشنبه زمان‌دار و کامل (نه نیم‌روز)، بقیه‌ی روزها بدون ساعت', () => {
    const shifts = require('../src/repositories/shiftsRepository');
    const { getCalendarDay } = require('../src/engine/calendarService');
    const { makeUser } = require('./helpers/factories');
    const user = makeUser();
    const s = shifts.createShift({ name: 'چرخشی+ثابت', isUntimed: true, startTime: '08:00', endTime: '16:30', workDays: [6, 0, 1, 2, 3, 4], weekdayHours: FIXED });
    assert.deepEqual(s.weekdayHours, FIXED);
    shifts.assignShift({ userId: user.id, shiftId: s.id, effectiveFrom: '2026-01-01' });

    const wed = shifts.shiftOn(user.id, WED);
    assert.deepEqual([wed.isUntimed, wed.startTime, wed.endTime, wed.weekdayHoursApplied], [false, '08:30', '16:00', true]);
    assert.equal(shifts.shiftOn(user.id, SUN).isUntimed, true);
    assert.equal(shifts.makeShiftResolver([user.id])(user.id, WED).startTime, '08:30');
    assert.equal(shifts.makeShiftResolver([user.id])(user.id, SUN).isUntimed, true);

    const thu = getCalendarDay(user, THU);
    assert.deepEqual([thu.isWorkingDay, thu.kind, thu.expectedStart, thu.expectedEnd], [true, 'working', '08:30', '16:00']); // پنجشنبه با وجود half_day_weekdays=[۴] نیم‌روز نیست
    const sun = getCalendarDay(user, SUN);
    assert.deepEqual([sun.isWorkingDay, sun.isTimed, sun.expectedStart], [true, false, null]);

    const upd = shifts.updateShift(s.id, { weekdayHours: {} });
    assert.deepEqual(upd.weekdayHours, {});
    assert.equal(shifts.shiftOn(user.id, WED).isUntimed, true);
  });
});

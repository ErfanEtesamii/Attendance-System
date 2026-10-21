// شیفت چرخشیِ بدون ساعت: ثبت ورود/خروج مجاز است و ساعت مفیدِ ثبت‌شده حساب می‌شود (بدون تأخیر/زودرفتن/اضافه‌کاری).
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { computeDay } = require('../src/engine/computeDay');

const settings = { workDayStart: '08:00', workDayEnd: '16:00', lateGraceMinutes: 0, earlyGraceMinutes: 0, maxLunchMinutes: 0, fixedLunchDeductMinutes: 0, overtimeEnabled: true, overtimeMinMinutes: 0, overtimeRoundStep: 1 };
const shift = { startTime: '08:00', endTime: '16:30', graceLateMinutes: 0, graceEarlyMinutes: 0, workDays: [6], overnight: false, maxLunchMinutes: 0, fixedLunchDeductMinutes: 0, isUntimed: true };
const record = { check_in_time: '2026-10-17T10:00:00Z', check_out_time: '2026-10-17T20:00:00Z', record_date: '2026-10-17', status: 'present' };
const run = (rec, calendar) => computeDay({ record: rec, breaks: [], settings, shift, timezone: 'UTC', calendar });

describe('computeDay: شیفت بدون ساعت', () => {
  test('ساعت مفیدِ ثبت‌شده حساب می‌شود؛ انتظار، تأخیر، زودرفتن، اضافه‌کاری و outside_shift صفر/خالی‌اند', () => {
    const r = run(record, { isWorkingDay: true, isTimed: false, kind: 'working' });
    assert.deepEqual([r.expected, r.effective, r.late, r.earlyLeave, r.overtime, r.flags], [0, 600, 0, 0, 0, []]);
  });
  test('بدون رکورد: انتظار ۰ و ساعت مفیدِ null', () => {
    const r = run(null, { isWorkingDay: true, isTimed: false, kind: 'working' });
    assert.deepEqual([r.expected, r.effective], [0, null]);
  });
  test('شیفت عادی (isTimed نبودن) مثل قبل محاسبه می‌شود', () => {
    const r = run(record, { isWorkingDay: true, kind: 'working' });
    assert.ok(r.expected > 0 && r.late > 0);
  });
});

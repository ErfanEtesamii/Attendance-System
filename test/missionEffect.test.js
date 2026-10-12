// C3: اثر ماموریتِ تأییدشده بر ساعت مفید — |P ∪ M'| (اجتماع، نه جمع)، missionMinutes و effectiveWithMission.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { computeDay } = require('../src/engine/computeDay');
const { leaveWindowsOnDate, requestRowToValue } = require('../src/utils/leaveUnits');
const { zonedTimeToUtc } = require('../src/utils/time');

const TEHRAN = 'Asia/Tehran';
const MON = '2026-09-14';
const at = (hhmm, date = MON) => zonedTimeToUtc(date, hhmm, TEHRAN).toISOString();
const settings = { workDayStart: '08:00', workDayEnd: '16:30' }; // ۵۱۰ دقیقه
const min = (h) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3));
const M = (a, b) => ({ start: min(a), end: min(b), kind: 'mission' });
const L = (a, b) => ({ start: min(a), end: min(b) });

function run(inn, out, wins, extra = {}) {
  const date = extra.date || MON;
  return computeDay({
    record: inn ? { check_in_time: at(inn, date), check_out_time: out ? at(out, date) : null, status: 'normal', record_date: date } : null,
    breaks: extra.breaks || [], settings: { ...settings, ...(extra.settings || {}) }, timezone: TEHRAN, now: at('23:00', date),
    calendar: extra.calendar, shift: extra.shift, approvedLeaves: wins,
  });
}

describe('اثر ماموریت (C3)', () => {
  test('بدون ماموریت: missionMinutes=۰ و effectiveWithMission = effective', () => {
    const r = run('08:00', '16:30', null);
    assert.equal(r.missionMinutes, 0);
    assert.equal(r.effectiveWithMission, r.effective);
    assert.equal(run(null, null, null).effectiveWithMission, null);
  });

  test('ماموریت داخل حضور: دوبار شمرده نمی‌شود', () => {
    const r = run('08:00', '16:30', [M('10:00', '12:00')]);
    assert.equal(r.missionMinutes, 120);
    assert.equal(r.effective, 510);
    assert.equal(r.effectiveWithMission, 510);
  });

  test('ماموریت جدا از حضور: جمع می‌شود', () => {
    const r = run('08:00', '12:00', [M('13:00', '15:00')]);
    assert.equal(r.effective, 240);
    assert.equal(r.effectiveWithMission, 360);
    assert.equal(r.earlyLeave, 150); // ۱۲:۰۰→۱۶:۳۰ (۲۷۰) منهای ۱۲۰ دقیقه ماموریت
  });

  test('نیمه‌همپوشان: فقط اجتماع', () => {
    const r = run('08:00', '12:00', [M('11:00', '14:00')]);
    assert.equal(r.effective, 240);
    assert.equal(r.effectiveWithMission, 360); // 08–14
  });

  test('استراحت داخل ماموریت پوشش داده می‌شود و استراحت بیرون از آن کم می‌ماند', () => {
    const brk = (a, b) => ({ start_time: at(a), end_time: at(b), break_type: 'lunch' });
    const r = run('08:00', '16:30', [M('12:00', '13:00')], { breaks: [brk('12:15', '12:45'), brk('14:00', '14:30')] });
    assert.equal(r.effective, 510 - 60);
    assert.equal(r.effectiveWithMission, 510 - 30); // نیم‌ساعت استراحت داخل ماموریت جبران می‌شود
  });

  test('ماموریت تمام‌روز بدون ورود: effectiveWithMission = دقایق ماموریت، تأخیر ۰', () => {
    const r = run(null, null, [M('08:00', '16:30')]);
    assert.equal(r.missionMinutes, 510);
    assert.equal(r.effectiveWithMission, 510);
    assert.equal(r.expected, 0);
  });

  test('ماموریت صبح: تأخیر از پایان ماموریت سنجیده می‌شود', () => {
    const r = run('10:30', '16:30', [M('08:00', '10:00')]);
    assert.equal(r.late, 30);
    assert.equal(r.missionMinutes, 120);
    assert.equal(r.effectiveWithMission, 120 + 360);
  });

  test('مرخصی (غیر ماموریت) در missionMinutes نمی‌آید', () => {
    const r = run('08:00', '12:00', [L('13:00', '15:00')]);
    assert.equal(r.missionMinutes, 0);
    assert.equal(r.effectiveWithMission, r.effective);
  });

  test('ماموریت بیرون از ساعت کاری برش می‌خورد؛ روز غیرکاری ⇒ ۰', () => {
    assert.equal(run('08:00', '16:30', [M('06:00', '09:00')]).missionMinutes, 60);
    const off = run(null, null, [M('08:00', '12:00')], { calendar: { isWorkingDay: false, kind: 'weekend' } });
    assert.equal(off.missionMinutes, 0);
  });

  test('روز نیم‌روز: ماموریت به پایان نیم‌روز بریده می‌شود', () => {
    const cal = { isWorkingDay: true, kind: 'half', expectedStart: '08:00', expectedEnd: '12:30' };
    const r = run('08:00', '10:00', [M('10:00', '15:00')], { calendar: cal });
    assert.equal(r.missionMinutes, 150);
    assert.equal(r.effectiveWithMission, 270);
  });

  test('شیفت شب: ماموریت روی مبنای دقیقه‌ی روزِ شروع', () => {
    const shift = { startTime: '22:00', endTime: '06:00', overnight: true };
    const r = computeDay({
      record: { check_in_time: at('22:00'), check_out_time: at('02:00', '2026-09-15'), status: 'normal', record_date: MON },
      breaks: [], settings, timezone: TEHRAN, shift, approvedLeaves: [{ start: 1440 + 120, end: 1440 + 240, kind: 'mission' }],
    });
    assert.equal(r.missionMinutes, 120);
    assert.equal(r.effective, 240);
    assert.equal(r.effectiveWithMission, 240 + 120 - 0); // 22→02 + 02→04
  });

  test('requestRowToValue/leaveWindowsOnDate: فقط kind=mission علامت می‌خورد', () => {
    const base = { unit: 'hour', start_date: MON, end_date: MON, start_time: '10:00', end_time: '12:00' };
    assert.equal('kind' in requestRowToValue({ ...base, kind: 'leave' }), false);
    const v = requestRowToValue({ ...base, kind: 'mission' });
    const cal = () => ({ isWorkingDay: true, kind: 'working', expectedStart: '08:00', expectedEnd: '16:30' });
    assert.deepEqual(leaveWindowsOnDate([v], MON, cal), [{ start: 600, end: 720, kind: 'mission' }]);
  });
});

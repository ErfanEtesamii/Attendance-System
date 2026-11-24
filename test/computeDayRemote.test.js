// دورکاری تأییدشده: هر دقیقه‌ی جلسه مفید است؛ استراحت داخل دورکاری کسر نمی‌شود؛ بیرون از بازه‌ی حضور هم حساب می‌شود؛ هم‌پوشانی دوبار شمرده نمی‌شود
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { computeDay } = require('../src/engine/computeDay');
const { zonedTimeToUtc } = require('../src/utils/time');

const TZ = 'Asia/Tehran';
const SETTINGS = { workDayStart: '08:00', workDayEnd: '16:30' };
const at = (hhmm) => zonedTimeToUtc('2026-10-06', hhmm, TZ).toISOString();
const ms = (hhmm) => Date.parse(at(hhmm));
const run = (record, breaks, remoteWindows) => computeDay({ record, breaks, settings: SETTINGS, timezone: TZ, now: at('23:00'), remoteWindows });

describe('computeDay با دورکاری', () => {
  test('بدون remoteWindows دقیقاً رفتار قبلی', () => {
    const rec = { check_in_time: at('08:00'), check_out_time: at('16:00'), status: 'normal' };
    assert.deepEqual(run(rec, [], null), run(rec, [], undefined));
    assert.equal(run(rec, [], []).effective, 480);
    assert.equal('remoteMinutes' in run(rec, [], null), false);
  });

  test('همه‌ی استراحت‌های داخل دورکاری کامل کسر می‌شود (بدون سهمیه‌ی با حقوق)', () => {
    const rec = { check_in_time: at('09:00'), check_out_time: at('18:00'), status: 'normal' };
    const brk = [{ break_type: 'short_break', start_time: at('11:00'), end_time: at('11:20'), via_remote: 1 }, { break_type: 'lunch', start_time: at('13:00'), end_time: at('13:45'), via_remote: 1 }];
    const d = run(rec, brk, [{ start: ms('09:00'), end: ms('18:00') }]);
    assert.equal(d.remoteMinutes, 540 - 20 - 45); // هیچ سهمیه‌ی با حقوقی در دورکاری نیست
    assert.equal(d.effective, 475);
    assert.equal(d.breakUnpaid, 0); // کسرِ استراحتِ حضوری؛ استراحت‌های دورکاری جدا از remoteMinutes کم شدند
  });

  test('دورکاری بیرون از بازه‌ی ورود و خروج هم اضافه می‌شود', () => {
    const rec = { check_in_time: at('08:00'), check_out_time: at('12:00'), status: 'normal' };
    const d = run(rec, [], [{ start: ms('18:00'), end: ms('19:00') }]);
    assert.equal(d.effective, 240 + 60);
  });

  test('هم‌پوشانی دورکاری با حضور یا با خودش دوبار شمرده نمی‌شود', () => {
    const rec = { check_in_time: at('08:00'), check_out_time: at('12:00'), status: 'normal' };
    const d = run(rec, [], [{ start: ms('10:00'), end: ms('13:00') }, { start: ms('12:00'), end: ms('14:00') }]);
    assert.equal(d.effective, 120 + 240); // حضوری تا ۱۰:۰۰ + دورکاری ۱۰:۰۰ تا ۱۴:۰۰
    assert.equal(d.remoteMinutes, 240);
  });

  test('رکورد فقط‌دورکاری و رکورد بدون خروج', () => {
    const only = run({ check_in_time: at('09:00'), check_out_time: at('12:00'), status: 'normal' }, [], [{ start: ms('09:00'), end: ms('12:00') }]);
    assert.equal(only.effective, 180);
    const noOut = run({ check_in_time: at('08:00'), check_out_time: null, status: 'incomplete' }, [], [{ start: ms('18:00'), end: ms('19:30') }]);
    assert.equal(noOut.effective, 90); // حضوریِ بدون خروج صفر؛ دورکاری کامل
  });
});

describe('استراحتِ بسته‌نشده در دورکاری', () => {
  test('فقط تا شروع استراحتِ تا پایان جلسه‌بازمانده کار حساب می‌شود؛ بعدش نه کسر و نه اعتبار', () => {
    const rec = { check_in_time: at('09:00'), check_out_time: at('18:00'), status: 'normal' };
    const brk = [{ break_type: 'short_break', start_time: at('13:00'), end_time: at('18:00'), via_remote: 1 }];
    const d = run(rec, brk, [{ start: ms('09:00'), end: ms('18:00') }]);
    assert.equal(d.effective, 240); // ۰۹:۰۰–۱۳:۰۰
    assert.equal(d.remoteMinutes, 240);
  });
  test('استراحتِ بسته‌شده در وسط جلسه کامل کسر می‌شود', () => {
    const rec = { check_in_time: at('09:00'), check_out_time: at('18:00'), status: 'normal' };
    const brk = [{ break_type: 'short_break', start_time: at('13:00'), end_time: at('14:00'), via_remote: 1 }];
    assert.equal(run(rec, brk, [{ start: ms('09:00'), end: ms('18:00') }]).effective, 480);
  });
});

describe('تایم پرت (idle_minutes) با دورکاری', () => {
  test('از کل ساعت مفید (حضوری + دورکاری) کم می‌شود', () => {
    const rec = { check_in_time: at('09:00'), check_out_time: at('18:00'), status: 'normal', idle_minutes: 60 };
    const d = run(rec, [], [{ start: ms('13:00'), end: ms('18:00') }]);
    assert.equal(d.effective, 240 + 300 - 60);
  });
  test('اگر حضوری از تایم پرت کمتر باشد، باقی‌مانده از دورکاری کم می‌شود', () => {
    const rec = { check_in_time: at('09:00'), check_out_time: at('18:00'), status: 'normal', idle_minutes: 120 };
    const d = run(rec, [], [{ start: ms('10:00'), end: ms('18:00') }]); // حضوری ۶۰ + دورکاری ۴۸۰
    assert.equal(d.effective, 60 + 480 - 120);
  });
});

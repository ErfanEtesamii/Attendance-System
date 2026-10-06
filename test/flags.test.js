// S3-4b: پرچم‌ها و داده‌ی خراب در computeDay (flag نه exception) + سازگاری با autoCloseIncomplete. now ثابت است.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { computeDay } = require('../src/engine/computeDay');
const dayService = require('../src/engine/dayService');
const registry = require('../src/utils/settingsRegistry');
const settingsRepo = require('../src/repositories/settingsRepository');
const attendanceRepo = require('../src/repositories/attendanceRepository');
const { autoCloseIncompleteRecords } = require('../src/bot/scheduler/autoCloseIncomplete');
const { zonedTimeToUtc } = require('../src/utils/time');
const { makeUser } = require('./helpers/factories');

const TEHRAN = 'Asia/Tehran';
const DATE = '2026-09-10';
const at = (hhmm, date = DATE) => zonedTimeToUtc(date, hhmm, TEHRAN).toISOString();
const base = { workDayStart: '08:00', workDayEnd: '16:30' };
const br = (from, to, type = 'lunch') => ({ break_type: type, start_time: at(from), end_time: to ? at(to) : null });
const rec = (inH, outH, status = 'normal', date = DATE) => ({ check_in_time: inH && at(inH, date), check_out_time: outH ? at(outH, date) : null, status });
const NOW = at('12:00'); // همان روز ورود
const run = (record, breaks = [], extra = {}, now = NOW) => computeDay({ record, breaks, settings: { ...base, ...extra }, timezone: TEHRAN, now });
const flags = (...a) => run(...a).flags;

describe('پرچم‌ها و داده‌ی خراب (S3-4b)', () => {
  let db;
  before(() => { db = resetDb(); });
  after(cleanup);

  test('جدول: هر پرچم (مثبت و منفی) و ترتیب ثابت', () => {
    const rows = [
      ['روز عادی بسته ⇒ بدون پرچم', rec('08:00', '16:30'), [br('12:00', '12:30')], {}, NOW, []],
      ['رکورد باز امروز (در جریان) ⇒ بدون پرچم', rec('08:00', null), [], {}, NOW, []],
      ['رکورد باز، روز قبل ⇒ missing_checkout', rec('08:00', null), [], {}, at('09:00', '2026-09-11'), ['missing_checkout']],
      ['رکورد باز، status=incomplete (autoClose) در همان روز ⇒ missing_checkout', rec('08:00', null, 'incomplete'), [], {}, at('23:59'), ['missing_checkout']],
      ['رکورد بسته با status=incomplete ⇒ پرچم نه', rec('08:00', '16:30', 'incomplete'), [], {}, NOW, []],
      ['خروج پیش از ورود', rec('09:00', '08:00'), [], {}, NOW, ['checkout_before_checkin']],
      ['استراحت باز طولانی (۱۲۱ دقیقه تا now) ⇒ long_open_break', rec('08:00', null), [br('10:00', null)], { }, at('12:01'), ['long_open_break']],
      ['استراحت باز دقیقاً روی آستانه ⇒ پرچم نه', rec('08:00', null), [br('10:00', null)], {}, at('12:00'), []],
      ['آستانه‌ی قابل‌تنظیم', rec('08:00', null), [br('10:00', null)], { longOpenBreakMinutes: 30 }, at('10:31'), ['long_open_break']],
      ['استراحت باز در روز بسته: تا خروج سنجیده می‌شود', rec('08:00', '16:30'), [br('12:00', null)], {}, NOW, ['long_open_break']],
      ['استراحت پیش از ورود', rec('08:00', '16:30'), [br('07:00', '07:30')], {}, NOW, ['break_outside_range']],
      ['استراحت بعد از خروج', rec('08:00', '16:30'), [br('16:40', '16:50')], {}, NOW, ['break_outside_range']],
      ['استراحت با پایان پیش از شروع', rec('08:00', '16:30'), [br('12:30', '12:00')], {}, NOW, ['break_outside_range']],
      ['استراحت دقیقاً روی مرز ورود/خروج ⇒ پرچم نه', rec('08:00', '16:30'), [br('08:00', '08:10'), br('16:20', '16:30')], {}, NOW, []],
      ['ورود خیلی زود (۰۵:۴۰ < ۰۶:۰۰)', rec('05:40', '16:30'), [], {}, NOW, ['outside_shift']],
      ['ورود دقیقاً روی حاشیه (۰۶:۰۰) ⇒ پرچم نه', rec('06:00', '16:30'), [], {}, NOW, []],
      ['خروج خیلی دیر (۱۸:۳۱ > ۱۸:۳۰)', rec('08:00', '18:31'), [], {}, NOW, ['outside_shift']],
      ['خروج دقیقاً روی حاشیه (۱۸:۳۰) ⇒ پرچم نه', rec('08:00', '18:30'), [], {}, NOW, []],
      ['حاشیه‌ی قابل‌تنظیم', rec('08:00', '17:31'), [], { outsideShiftMarginMinutes: 60 }, NOW, ['outside_shift']],
      ['خروج پس از نیمه‌شب (روز دیگر)', { check_in_time: at('08:00'), check_out_time: at('01:00', '2026-09-11'), status: 'normal' }, [], { outsideShiftMarginMinutes: 720 }, NOW, ['outside_shift']],
      ['چند پرچم با ترتیب ثابت', rec('05:00', null), [br('04:00', '04:30'), br('09:00', null)], {}, at('12:00', '2026-09-11'), ['missing_checkout', 'long_open_break', 'break_outside_range', 'outside_shift']],
    ];
    for (const [name, record, breaks, extra, now, expected] of rows) assert.deepEqual(flags(record, breaks, extra, now), expected, name);
  });

  test('پرچم‌ها اعداد را عوض نمی‌کنند؛ داده‌ی خراب ⇒ invalid_time بدون exception', () => {
    // خروج پیش از ورود: ساعت مفید ۰ مثل قبل
    const rev = run(rec('09:00', '08:00'));
    assert.equal(rev.effective, 0);
    // استراحت خارج از بازه: همچنان در break حساب می‌شود (مثل قبل)
    const out = run(rec('08:00', '16:30'), [br('07:00', '07:30')]);
    assert.equal(out.break, 30);
    // تنظیمات پرچم هیچ عدد دیگری را تغییر نمی‌دهد
    const a = run(rec('08:00', '17:00'), [br('12:00', '12:30')]);
    const b = run(rec('08:00', '17:00'), [br('12:00', '12:30')], { longOpenBreakMinutes: 5, outsideShiftMarginMinutes: 0 });
    assert.deepEqual({ ...b, flags: a.flags }, a);
    // زمان خراب رکورد: بدون exception؛ هیچ عددی حساب نمی‌شود، status حفظ می‌شود
    for (const bad of [rec(null, null), { check_in_time: 'garbage', check_out_time: null, status: 'late' }, { check_in_time: at('08:00'), check_out_time: 'x', status: 'normal' }]) {
      const d = run(bad);
      if (bad.check_in_time) assert.deepEqual([d.flags, d.workedGross, d.effective, d.late, d.earlyLeave, d.overtime, d.isOpen], [['invalid_time'], null, null, 0, 0, 0, false]);
      assert.equal(d.status, bad.status);
    }
    // استراحت با زمان خراب: نادیده گرفته می‌شود، بقیه‌ی روز حساب می‌شود
    const badBreak = run(rec('08:00', '16:30'), [{ break_type: 'lunch', start_time: 'x', end_time: at('12:30') }, br('13:00', '13:20')]);
    assert.deepEqual([badBreak.flags, badBreak.break, badBreak.effective], [['invalid_time'], 20, 490]);
    // تنظیمات/now نامعتبر همچنان RangeError (خطای برنامه‌نویسی، نه داده‌ی خراب)
    assert.throws(() => run(rec('08:00', null), [], {}, 'garbage'), RangeError);
    for (const key of ['longOpenBreakMinutes', 'outsideShiftMarginMinutes']) {
      [-1, NaN, Infinity, '30', null, true].forEach((v) => assert.throws(() => run(rec('08:00', '16:30'), [], { [key]: v }), RangeError, `${key} ${v}`));
    }
    assert.throws(() => run(rec('08:00', '16:30'), [], { longOpenBreakMinutes: 0 }), RangeError, 'آستانه‌ی استراحت باید > ۰ باشد');
    assert.doesNotThrow(() => run(rec('08:00', '16:30'), [], { outsideShiftMarginMinutes: 0 }));
  });

  test('رجیستری + dayService + سازگاری با autoCloseIncomplete', () => {
    assert.deepEqual(registry.selfCheck(), []);
    assert.equal(registry.defaultOf('longOpenBreakMinutes'), 120);
    assert.equal(registry.defaultOf('outsideShiftMarginMinutes'), 120);
    assert.equal(registry.getDef('longOpenBreakMinutes').dbKey, 'long_open_break_minutes');
    assert.equal(registry.getDef('outsideShiftMarginMinutes').dbKey, 'outside_shift_margin_minutes');
    [0, 721, 1.5, 'abc', ''].forEach((v) => assert.equal(registry.validate('longOpenBreakMinutes', v).ok, false, `long ${JSON.stringify(v)}`));
    [-1, 721, 1.5, 'abc', ''].forEach((v) => assert.equal(registry.validate('outsideShiftMarginMinutes', v).ok, false, `margin ${JSON.stringify(v)}`));
    assert.deepEqual(registry.validate('outsideShiftMarginMinutes', '0'), { ok: true, value: 0 });

    // رکورد واقعی DB: باز، بدون خروج؛ autoCloseIncomplete فقط status را عوض می‌کند و پرچم از روی همان status می‌آید
    const user = makeUser();
    const { todayDateString } = require('../src/utils/serverTime');
    const today = todayDateString();
    const id = db.prepare('INSERT INTO attendance_records (user_id, record_date, check_in_time, check_out_time, status) VALUES (?, ?, ?, NULL, ?)')
      .run(user.id, today, at('08:00', today), 'normal').lastInsertRowid;
    const load = () => attendanceRepo.findById ? attendanceRepo.findById(id) : db.prepare('SELECT * FROM attendance_records WHERE id = ?').get(id);
    const ctxNow = at('12:00', today);
    assert.deepEqual(dayService.computeRecordDay(load(), { now: ctxNow }).flags, [], 'در جریان');
    return autoCloseIncompleteRecords().then(() => {
      const closed = db.prepare('SELECT * FROM attendance_records WHERE id = ?').get(id);
      assert.equal(closed.status, 'incomplete');
      assert.equal(closed.check_out_time, null, 'زمان خروج دست‌نخورده');
      const day = dayService.computeRecordDay(closed, { now: ctxNow });
      assert.deepEqual(day.flags, ['missing_checkout']);
      assert.equal(day.isOpen, true);
      // خلاصه‌ی قدیمی بدون تغییر شکل
      assert.deepEqual(Object.keys(dayService.summarizeRecord(closed, { now: ctxNow })), ['effectiveMinutes', 'lateMinutes', 'earlyLeaveMinutes', 'overtimeMinutes', 'isOpen']);
    });
  });
});

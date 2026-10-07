// S3-6b/6c: computeDay با شیفت (shift = null ⇒ تنظیمات سراسری) و شیفت شب (record_date = روز شروع شیفت).
// بخش‌های «خالص» بدون DB؛ بخش‌های DB با resetDb و ساعت جعلی (mock.timers) برای ثبت ورود/خروج و Job.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');

const { computeDay } = require('../src/engine/computeDay');
const dayService = require('../src/engine/dayService');
const shiftsRepo = require('../src/repositories/shiftsRepository');
const usersRepo = require('../src/repositories/usersRepository');
const attendanceRepo = require('../src/repositories/attendanceRepository');
const { shiftRecordDate, dayDiff, addDays, isOvernightShift } = require('../src/utils/shiftDay');
const { zonedTimeToUtc } = require('../src/utils/time');
const { makeUser } = require('./helpers/factories');

const TEHRAN = 'Asia/Tehran';
const at = (date, hhmm) => zonedTimeToUtc(date, hhmm, TEHRAN);
const iso = (date, hhmm) => at(date, hhmm).toISOString();
const GLOBAL = { workDayStart: '08:00', workDayEnd: '16:30' };
const shiftOf = (o) => ({ name: 's', graceLateMinutes: 0, graceEarlyMinutes: 0, workDays: [0, 1, 2, 3, 6], overnight: false, maxLunchMinutes: 0, fixedLunchDeductMinutes: 0, ...o });
const day = (record, { settings = GLOBAL, shift, now, breaks = [] } = {}) => computeDay({ record, breaks, settings, shift, now, timezone: TEHRAN });
const rec = (date, inHhmm, outHhmm, outDate = date, extra = {}) => ({ record_date: date, check_in_time: iso(date, inHhmm), check_out_time: outHhmm ? iso(outDate, outHhmm) : null, status: 'normal', ...extra });

describe('computeDay با شیفت (S3-6b)', () => {
  test('بدون شیفت (null/undefined) دقیقاً مثل تنظیمات سراسری؛ شیفتِ هم‌ارزِ تنظیمات هم همان خروجی را می‌دهد', () => {
    const r = rec('2026-09-10', '08:20', '17:00');
    const base = day(r);
    assert.deepEqual(day(r, { shift: null }), base);
    assert.deepEqual([base.expected, base.late, base.overtime], [510, 20, 30]);
    assert.deepEqual(day(r, { shift: shiftOf({ startTime: '08:00', endTime: '16:30' }) }), base);
  });

  test('دو شیفت متفاوت روی یک ورود/خروج، نتیجه‌ی متفاوت می‌دهند (شروع/پایان/expected/مهلت)', () => {
    const r = rec('2026-09-10', '14:20', '22:30');
    const morning = shiftOf({ startTime: '08:00', endTime: '16:00', graceLateMinutes: 10, graceEarlyMinutes: 5 });
    const evening = shiftOf({ startTime: '14:00', endTime: '22:00' });
    const a = day(r, { shift: morning });
    const b = day(r, { shift: evening });
    const none = day(r);
    assert.deepEqual([a.expected, a.late, a.earlyLeave, a.overtime], [480, 380, 0, 390]);
    assert.deepEqual([b.expected, b.late, b.earlyLeave, b.overtime], [480, 20, 0, 30]);
    assert.deepEqual([none.expected, none.late, none.overtime], [510, 380, 360]);
    // روی خروجی‌های مستقل از شیفت اثری نیست
    assert.equal(a.workedGross, b.workedGross);
  });

  test('مهلت و ناهار شیفت جایگزین تنظیمات سراسری می‌شوند (۰ در شیفت = خاموش، نه «از تنظیمات»)', () => {
    const r = rec('2026-09-10', '08:10', '16:00');
    const settings = { ...GLOBAL, workDayEnd: '16:00', lateGraceMinutes: 15, fixedLunchDeductMinutes: 45 };
    const g = day(r, { settings });
    assert.deepEqual([g.late, g.breakAuto], [0, 45]); // سراسری: مهلت ۱۵، کسر ۴۵
    const s = day(r, { settings, shift: shiftOf({ startTime: '08:00', endTime: '16:00' }) });
    assert.deepEqual([s.late, s.breakAuto], [10, 0]); // شیفت: بدون مهلت و بدون کسر
    const s2 = day(r, { settings, shift: shiftOf({ startTime: '08:00', endTime: '16:00', graceLateMinutes: 10, fixedLunchDeductMinutes: 30 }) });
    assert.deepEqual([s2.late, s2.breakAuto, s2.effective], [0, 30, 440]); // ۴۷۰ دقیقه حضور − ۳۰ کسر ناهار
    const cap = day(r, { shift: shiftOf({ startTime: '08:00', endTime: '16:00', maxLunchMinutes: 30 }), breaks: [{ start_time: iso('2026-09-10', '12:00'), end_time: iso('2026-09-10', '13:00'), break_type: 'lunch' }] });
    assert.equal(cap.breakExcess, 30);

    for (const bad of [
      shiftOf({ startTime: '08:00', endTime: '16:00', overnight: true }), // overnight با پایان بعد از شروع
      shiftOf({ startTime: '22:00', endTime: '06:00' }), // رد از نیمه‌شب بدون overnight
      shiftOf({ startTime: '25:00', endTime: '16:00' }), shiftOf({ startTime: '08:00', endTime: '16:00', graceLateMinutes: -1 }),
    ]) assert.throws(() => day(r, { shift: bad }), RangeError);
    assert.throws(() => day(r, { shift: 5 }), TypeError);
  });

  test('DB: دو کاربر با شیفت متفاوت و یک کاربر بدون شیفت از کانتکست/کش جدا محاسبه می‌شوند', () => {
    const db = resetDb();
    const sA = shiftsRepo.createShift(shiftOf({ name: 'صبح', startTime: '08:00', endTime: '16:00', graceLateMinutes: 10 }));
    const sB = shiftsRepo.createShift(shiftOf({ name: 'عصر', startTime: '14:00', endTime: '22:00' }));
    const [u1, u2, u3] = [makeUser(), makeUser(), makeUser()];
    usersRepo.setUserShift(u1.id, sA.id);
    usersRepo.setUserShift(u2.id, sB.id);
    const mk = (u) => attendanceRepo.createManual({ userId: u.id, recordDate: '2026-09-10', checkInTime: iso('2026-09-10', '14:20'), checkOutTime: iso('2026-09-10', '22:30'), status: 'normal' });
    const [r1, r2, r3] = [mk(u1), mk(u2), mk(u3)];
    const context = dayService.loadContext();
    const [d1, d2, d3] = [r1, r2, r3].map((r) => dayService.computeRecordDay(r, { context }));
    assert.deepEqual([d1.expected, d1.late], [480, 380]);
    assert.deepEqual([d2.expected, d2.late], [480, 20]);
    assert.deepEqual([d3.expected, d3.late], [510, 380]); // بدون شیفت = ساعت‌های سراسری پیش‌فرض (۰۸:۰۰–۱۶:۳۰)
    assert.equal(context.shiftCache.size, 3);
    // شکل قدیمی خلاصه هم شیفت را می‌بیند
    assert.equal(dayService.summarizeRecord(r2, { context }).lateMinutes, 20);
    // انتساب بعدی روی «همان کانتکست» دیده نمی‌شود (کش)، روی کانتکست تازه دیده می‌شود؛ shift صریح null = بدون شیفت
    usersRepo.setUserShift(u1.id, null);
    assert.equal(dayService.computeRecordDay(r1, { context }).expected, 480);
    assert.equal(dayService.computeRecordDay(r1, { context: dayService.loadContext() }).expected, 510);
    assert.equal(dayService.computeRecordDay(r2, { context: dayService.loadContext(), shift: null }).expected, 510);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM attendance_records').get().n, 3);
  });
});

describe('شیفت شب (S3-6c) — محاسبه', () => {
  const night = shiftOf({ name: 'شب', startTime: '22:00', endTime: '06:00', overnight: true, graceLateMinutes: 10 });
  const D = '2026-09-14';
  const N = '2026-09-15'; // روز بعد
  const nightDay = (r, extra = {}) => day(r, { shift: night, ...extra });

  test('جدول: ورود/خروج دو طرف نیمه‌شب با مبنای روز شروع شیفت (تأخیر، زودتر رفتن، اضافه‌کاری، expected)', () => {
    // [ورود(D), خروج(N), expected, late, earlyLeave, overtime]
    const rows = [
      ['21:55', '06:02', 480, 0, 0, 2], ['22:10', '06:00', 480, 0, 0, 0], ['22:11', '06:00', 480, 11, 0, 0],
      ['22:00', '05:30', 480, 0, 30, 0], ['22:00', '07:15', 480, 0, 0, 75], ['22:00', '06:00', 480, 0, 0, 0],
    ];
    for (const [i, o, exp, late, early, ot] of rows) {
      const d = nightDay(rec(D, i, o, N));
      assert.deepEqual([d.expected, d.late, d.earlyLeave, d.overtime], [exp, late, early, ot], `${i}→${o}`);
      assert.deepEqual(d.flags, [], `${i}→${o}`); // شیفت شب عادی پرچم «خارج از شیفت» نمی‌خورد
    }
    // ورود بعد از نیمه‌شب روز بعد = ۱۵۰ دقیقه تأخیر (نسبت به ۲۲:۰۰ روز شروع)
    const late = nightDay({ record_date: D, check_in_time: iso(N, '00:30'), check_out_time: iso(N, '06:00'), status: 'late' });
    assert.deepEqual([late.late, late.earlyLeave, late.workedGross], [150, 0, 330]);
    // مهلت زودتر رفتن شیفت: پایان − ۵ دقیقه (۰۵:۵۵) هنوز زودتر رفتن نیست
    const early = shiftOf({ startTime: '22:00', endTime: '06:00', overnight: true, graceEarlyMinutes: 5 });
    assert.deepEqual([day(rec(D, '22:00', '05:55', N), { shift: early }).earlyLeave, day(rec(D, '22:00', '05:54', N), { shift: early }).earlyLeave], [0, 6]);
    // استراحت نیمه‌شب داخل بازه: پرچم ندارد و از ساعت مفید کم می‌شود
    const br = [{ start_time: iso(N, '02:00'), end_time: iso(N, '02:30'), break_type: 'lunch' }];
    const withBreak = nightDay(rec(D, '22:00', '06:00', N), { breaks: br });
    assert.deepEqual([withBreak.break, withBreak.effective, withBreak.flags], [30, 450, []]);
    // بدون record_date معتبر، تاریخ ورود مبنا می‌شود (همان نتیجه)
    const noDate = { ...rec(D, '22:11', '06:00', N), record_date: undefined };
    assert.deepEqual(nightDay(noDate).late, 11);
    assert.deepEqual(nightDay({ ...noDate, record_date: 'x' }), nightDay(noDate));
  });

  test('پرچم‌ها روی مبنای شیفت شب: outside_shift با حاشیه‌ی ۱۲۰، missing_checkout با «پایان + حاشیه» (نه تغییر تاریخ تقویمی)', () => {
    assert.deepEqual(nightDay(rec(D, '19:30', '06:00', N)).flags, ['outside_shift']); // ۲ ساعت و نیم زودتر از شروع
    assert.deepEqual(nightDay(rec(D, '21:00', '06:00', N)).flags, []);
    assert.deepEqual(nightDay(rec(D, '22:00', '08:30', N)).flags, ['outside_shift']); // بعد از پایان + ۱۲۰
    assert.deepEqual(nightDay(rec(D, '22:00', '08:00', N)).flags, []);
    // رکورد باز: ساعت ۰۱:۰۰ روز بعد هنوز در شیفت است؛ ۰۹:۰۰ دیگر «خروج فراموش‌شده»
    const open = rec(D, '22:00', null);
    const during = nightDay(open, { now: at(N, '01:00') });
    assert.deepEqual([during.isOpen, during.workedGross, during.flags], [true, 180, []]);
    assert.deepEqual(nightDay(open, { now: at(N, '09:00') }).flags, ['missing_checkout']);
    assert.deepEqual(nightDay({ ...open, status: 'incomplete' }, { now: at(N, '01:00') }).flags, ['missing_checkout']);
    // رفتار شیفت عادی بدون تغییر: خروج در روز دیگر همچنان outside_shift است
    assert.deepEqual(day(rec(D, '08:00', '01:00', N), { shift: shiftOf({ startTime: '08:00', endTime: '16:30' }) }).flags, ['outside_shift']);
  });

  test('shiftRecordDate: مرز نیمه‌شب تا پایان + حاشیه و پس از آن؛ شیفت عادی = تاریخ همان روز؛ helperهای تاریخ', () => {
    const f = (date, hhmm, shift = night, marginMinutes) => shiftRecordDate(at(date, hhmm), shift, { timezone: TEHRAN, marginMinutes });
    assert.deepEqual([f(D, '22:00'), f(D, '23:59'), f(N, '00:00'), f(N, '06:10'), f(N, '08:00')], [D, D, D, D, D]);
    assert.deepEqual([f(N, '08:01'), f(N, '14:00'), f(N, '21:59')], [N, N, N]);
    assert.equal(f(N, '06:30', night, 0), N); // حاشیه ۰ ⇒ بعد از ۰۶:۰۰ روز جدید
    assert.equal(f(N, '05:59', night, 0), D);
    assert.equal(f(N, '02:00', shiftOf({ startTime: '08:00', endTime: '16:00' })), N); // شیفت عادی
    assert.equal(f(N, '01:00', null), N);
    assert.equal(f(N, '23:00', shiftOf({ startTime: '23:00', endTime: '01:00', overnight: true }), 600), N); // سقف: وسط فاصله‌ی پایان تا شروع
    assert.deepEqual([isOvernightShift(night), isOvernightShift(shiftOf({ startTime: '08:00', endTime: '16:00' })), isOvernightShift(null)], [true, false, false]);
    assert.equal(dayDiff('2026-03-01', '2026-02-27'), 2);
    assert.equal(addDays('2026-03-01', -1), '2026-02-28');
    assert.throws(() => dayDiff('2026-02-31', '2026-02-27'), RangeError);
  });
});

describe('شیفت شب (S3-6c) — ثبت ورود/خروج و Job', () => {
  const canMock = typeof mock.timers?.enable === 'function';
  const opts = { skip: canMock ? false : 'mock.timers در این نسخه‌ی Node نیست' };
  let nightUser;
  let nightShift;
  before(() => {
    resetDb();
    nightShift = shiftsRepo.createShift(shiftOf({ name: 'شب', startTime: '22:00', endTime: '06:00', overnight: true }));
    nightUser = makeUser();
    usersRepo.setUserShift(nightUser.id, nightShift.id);
  });
  after(() => { if (canMock) mock.timers.reset(); cleanup(); });
  const setNow = (date, hhmm) => { mock.timers.reset(); mock.timers.enable({ apis: ['Date'], now: at(date, hhmm).getTime() }); };

  test('ورود ۲۲:۰۵ و خروج ۰۶:۱۰ روز بعد در «یک رکورد» با record_date = روز شروع؛ بعد از پایان + حاشیه رکورد جدید', opts, () => {
    setNow('2026-09-14', '22:05');
    const r = attendanceRepo.recordCheckIn(nightUser.id, '192.168.10.5');
    assert.equal(r.record_date, '2026-09-14');
    setNow('2026-09-15', '00:40');
    assert.equal(attendanceRepo.findTodayRecord(nightUser.id).id, r.id);
    assert.equal(attendanceRepo.recordCheckIn(nightUser.id, '192.168.10.5').id, r.id); // ورود دوباره، رکورد جدید نمی‌سازد
    setNow('2026-09-15', '06:10');
    const out = attendanceRepo.recordCheckOut(attendanceRepo.findTodayRecord(nightUser.id).id, '192.168.10.5');
    assert.equal(out.id, r.id);
    assert.ok(out.check_out_time);
    const d = dayService.computeRecordDay(out, { now: at('2026-09-15', '06:10') });
    assert.deepEqual([d.expected, d.late, d.overtime, d.earlyLeave, d.flags], [480, 5, 10, 0, []]);
    assert.equal(attendanceRepo.listByUserAndRange(nightUser.id, '2026-09-14', '2026-09-15').length, 1); // گزارش بازه: یک روز کاری
    setNow('2026-09-15', '08:30'); // بعد از ۰۶:۰۰ + ۱۲۰ ⇒ روز کاریِ بعدی
    assert.equal(attendanceRepo.findTodayRecord(nightUser.id), undefined);
    assert.equal(attendanceRepo.recordCheckIn(nightUser.id, '192.168.10.5').record_date, '2026-09-15');
  });

  test('کاربر بدون شیفت/شیفت عادی: record_date مثل قبل (todayDateString، بدون تغییر)', opts, () => {
    const plain = makeUser();
    setNow('2026-09-15', '00:40'); // ۲۱:۱۰ روز قبل به UTC
    const r = attendanceRepo.recordCheckIn(plain.id, '192.168.10.6');
    assert.equal(r.record_date, new Date().toISOString().slice(0, 10));
    const day = makeUser();
    usersRepo.setUserShift(day.id, shiftsRepo.createShift(shiftOf({ name: 'روز', startTime: '08:00', endTime: '16:00' })).id);
    assert.equal(attendanceRepo.recordCheckIn(day.id, '192.168.10.7').record_date, new Date().toISOString().slice(0, 10));
  });

  test('Job بستن خودکار: شیفتِ در جریان امروز دست نمی‌خورد، شیفتِ تمام‌شده‌ی دیروز علامت می‌خورد، کاربر عادی مثل قبل', opts, async () => {
    const { autoCloseIncompleteRecords } = require('../src/bot/scheduler/autoCloseIncomplete');
    const normal = makeUser();
    setNow('2026-09-20', '23:59'); // todayDateString (UTC) = 2026-09-20
    const mkOpen = (u, date) => attendanceRepo.createManual({ userId: u.id, recordDate: date, checkInTime: iso(date, '22:00'), status: 'normal' });
    const nightYesterday = mkOpen(nightUser, '2026-09-19');
    const nightToday = mkOpen(nightUser, '2026-09-20');
    const normalToday = mkOpen(normal, '2026-09-20');
    const normalYesterday = mkOpen(normal, '2026-09-19');
    assert.equal(await autoCloseIncompleteRecords(), 2);
    const status = (r) => attendanceRepo.findById(r.id).status;
    assert.deepEqual([status(nightYesterday), status(nightToday), status(normalToday), status(normalYesterday)], ['incomplete', 'normal', 'incomplete', 'normal']);
  });
});

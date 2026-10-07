// S3-7c: اتصال getCalendarDay به computeDay (calendar) / dayService و به مصرف‌کننده‌های «تعطیل بودن امروز» (فهرست کاربران پنل، /status بات).
// بخش خالص: computeDay با calendar. بخش DB: تعطیل کامل، تعطیلی نیم‌روز، تعطیلی دپارتمانی، نیم‌روز هفتگی، آخر هفته و شیفتِ با روزهای کاری متفاوت.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { computeDay } = require('../src/engine/computeDay');
const dayService = require('../src/engine/dayService');
const holidaysRepo = require('../src/repositories/holidaysRepository');
const shiftsRepo = require('../src/repositories/shiftsRepository');
const usersRepo = require('../src/repositories/usersRepository');
const attendanceRepo = require('../src/repositories/attendanceRepository');
const { todayDateString } = require('../src/utils/serverTime');
const { zonedTimeToUtc } = require('../src/utils/time');
const { makeUser, sessionCookie } = require('./helpers/factories');

const TEHRAN = 'Asia/Tehran';
const iso = (date, hhmm) => zonedTimeToUtc(date, hhmm, TEHRAN).toISOString();
const GLOBAL = { workDayStart: '08:00', workDayEnd: '16:30' };
const FULL = { isWorkingDay: true, kind: 'working', expectedEnd: '16:30' };
const HALF = { isWorkingDay: true, kind: 'half', expectedEnd: '12:30' };
const OFF = { isWorkingDay: false, kind: 'weekend', expectedEnd: null };
const D = '2026-09-13';
const rec = (inHhmm, outHhmm, extra = {}) => ({ record_date: D, check_in_time: iso(D, inHhmm), check_out_time: outHhmm ? iso(D, outHhmm) : null, status: 'normal', ...extra });
const day = (record, { calendar, settings = GLOBAL, shift, breaks = [], now } = {}) => computeDay({ record, breaks, settings, shift, calendar, now, timezone: TEHRAN });
const shiftOf = (o) => ({ name: 's', graceLateMinutes: 0, graceEarlyMinutes: 0, workDays: [0, 1, 2, 3, 6], overnight: false, maxLunchMinutes: 0, fixedLunchDeductMinutes: 0, ...o });

describe('computeDay با calendar (S3-7c، خالص)', () => {
  test('بدون calendar، calendar=null و روز کاریِ کامل ⇒ دقیقاً خروجی قبلی', () => {
    const r = rec('08:20', '17:10', { status: 'late' });
    const base = day(r);
    assert.deepEqual(day(r, { calendar: null }), base);
    assert.deepEqual(day(r, { calendar: FULL }), base);
    assert.deepEqual([base.expected, base.late, base.overtime], [510, 20, 40]);
  });

  test('نیم‌روز: پایانِ مؤثر = expectedEnd؛ زودتر رفتن/اضافه‌کاری نسبت به همان', () => {
    assert.deepEqual([day(rec('08:00', '12:30')).earlyLeave, day(rec('08:00', '12:30')).expected], [240, 510], 'بدون calendar (قبلی)');
    const exact = day(rec('08:00', '12:30'), { calendar: HALF });
    assert.deepEqual([exact.expected, exact.earlyLeave, exact.overtime, exact.late], [270, 0, 0, 0]);
    assert.equal(day(rec('08:00', '12:00'), { calendar: HALF }).earlyLeave, 30);
    assert.deepEqual([day(rec('08:00', '13:30'), { calendar: HALF }).overtime, day(rec('08:00', '13:30'), { calendar: HALF }).earlyLeave], [60, 0]);
  });

  test('نیم‌روز با پایان نامعتبر/بیرون از بازه نادیده ⇒ روز کامل؛ شیفت شب نیم‌روز ندارد', () => {
    ['07:00', '08:00', '16:30', '17:00', 'x', null].forEach((expectedEnd) => {
      assert.equal(day(rec('08:00', '16:30'), { calendar: { isWorkingDay: true, kind: 'half', expectedEnd } }).expected, 510, String(expectedEnd));
    });
    const night = shiftOf({ startTime: '22:00', endTime: '06:00', overnight: true });
    const r = { record_date: D, check_in_time: iso(D, '22:00'), check_out_time: iso('2026-09-14', '06:00'), status: 'normal' };
    assert.equal(day(r, { shift: night, calendar: { isWorkingDay: true, kind: 'half', expectedEnd: '12:30' } }).expected, 480);
  });

  test('روز غیرکاری: expected/late/earlyLeave صفر، کل کار اضافه‌کاری با ضریب تعطیل، بدون پرچم outside_shift', () => {
    const settings = { ...GLOBAL, overtimeEnabled: true, overtimeFactor: 1, overtimeHolidayFactor: 2 };
    const r = rec('09:00', '13:00');
    const brk = [{ start_time: iso(D, '12:00'), end_time: iso(D, '12:30') }];
    const d = day(r, { calendar: OFF, settings, breaks: brk });
    assert.deepEqual([d.expected, d.late, d.earlyLeave, d.workedGross, d.effective, d.overtime, d.overtimePayable], [0, 0, 0, 240, 210, 240, 480]);
    const normal = day(r, { settings, breaks: brk });
    assert.deepEqual([normal.expected, normal.late, normal.earlyLeave, normal.overtime], [510, 60, 210, 0], 'بدون calendar: مثل قبل');
    // ورود/خروج دور از «ساعت کاری» در روز غیرکاری غیرعادی نیست
    assert.deepEqual(day(rec('03:00', '04:00'), { calendar: OFF }).flags, []);
    assert.deepEqual(day(rec('03:00', '04:00')).flags, ['outside_shift']);
    // رکورد باز: اضافه‌کاری فقط با خروج
    const open = day(rec('09:00', null), { calendar: OFF, now: iso(D, '10:00') });
    assert.deepEqual([open.isOpen, open.overtime, open.expected, open.workedGross], [true, 0, 0, 60]);
  });

  test('calendar نامعتبر: isWorkingDay غیر boolean ⇒ RangeError؛ غیر شیء ⇒ TypeError', () => {
    assert.throws(() => day(rec('08:00', '16:00'), { calendar: { kind: 'working' } }), RangeError);
    assert.throws(() => day(rec('08:00', '16:00'), { calendar: { isWorkingDay: 'yes' } }), RangeError);
    assert.throws(() => day(rec('08:00', '16:00'), { calendar: 5 }), TypeError);
  });
});

describe('dayService + getCalendarDay (S3-7c، DB)', () => {
  // هفته‌ی ۲۰۲۶-۰۹-۱۲ (شنبه) … ۰۹-۱۸ (جمعه)
  const W = { sat: '2026-09-12', mon: '2026-09-14', tue: '2026-09-15', wed: '2026-09-16', thu: '2026-09-17', fri: '2026-09-18' };
  let uA; let uB; let uS;
  const mk = (u, date, inHhmm, outHhmm) => attendanceRepo.createManual({ userId: u.id, recordDate: date, checkInTime: iso(date, inHhmm), checkOutTime: iso(date, outHhmm), status: 'normal' });
  const run = (u, date, inHhmm = '08:00', outHhmm = '16:30', opts = {}) => dayService.computeRecordDay(mk(u, date, inHhmm, outHhmm), opts);
  const pick = (d) => [d.expected, d.overtime, d.earlyLeave];

  before(() => {
    resetDb();
    uA = makeUser({ department: 'A' });
    uB = makeUser({ department: 'B' });
    uS = makeUser({ department: 'B' });
    const shift = shiftsRepo.createShift(shiftOf({ name: 'عصر', startTime: '14:00', endTime: '22:00', workDays: [6, 0, 1, 2, 3] })); // شنبه تا چهارشنبه
    usersRepo.setUserShift(uS.id, shift.id);
    holidaysRepo.addHoliday(W.mon, 'تعطیل کامل');
    holidaysRepo.addHoliday(W.tue, 'تعطیل دپارتمان A', { scope: 'department', department: 'A' });
    holidaysRepo.addHoliday(W.wed, 'نیم‌روز', { kind: 'half', halfEndTime: '11:00' });
  });
  after(cleanup);

  test('روز عادی (شنبه): بدون تغییر', () => {
    assert.deepEqual(pick(run(uA, W.sat)), [510, 0, 0]);
    assert.deepEqual(pick(run(uS, W.sat, '14:00', '22:00')), [480, 0, 0]);
  });

  test('تعطیل کامل برای همه (دوشنبه): همه‌ی کاربران، حتی شیفت‌دار، روز غیرکاری‌اند', () => {
    assert.deepEqual(pick(run(uA, W.mon)), [0, 510, 0]);
    assert.deepEqual(pick(run(uS, W.mon, '14:00', '22:00')), [0, 480, 0]);
  });

  test('تعطیلی دپارتمانی (سه‌شنبه): فقط دپارتمان A', () => {
    assert.deepEqual(pick(run(uA, W.tue)), [0, 510, 0]);
    assert.deepEqual(pick(run(uB, W.tue)), [510, 0, 0]);
  });

  test('تعطیلی نیم‌روز (چهارشنبه ۱۱:۰۰): پایان کوتاه می‌شود؛ شیفتی که ۱۱:۰۰ بیرون بازه‌اش است نادیده می‌گیرد', () => {
    assert.deepEqual(pick(run(uA, W.wed)), [180, 330, 0]);
    assert.deepEqual(pick(run(uS, W.wed, '14:00', '22:00')), [480, 0, 0]);
  });

  test('نیم‌روز هفتگی (پنجشنبه) و شیفتی که پنجشنبه جزو روزهای کاری‌اش نیست', () => {
    assert.deepEqual(pick(run(uB, W.thu, '08:00', '12:30')), [270, 0, 0]);
    assert.deepEqual(pick(run(uB, '2026-09-10', '08:00', '12:30')), [270, 0, 0], 'روز پنجشنبه‌ی قبل');
    assert.deepEqual(pick(run(uS, W.thu, '14:00', '22:00')), [0, 480, 0]);
  });

  test('آخر هفته‌ی عادی (جمعه): روز غیرکاری', () => {
    assert.deepEqual(pick(run(uA, W.fri)), [0, 510, 0]);
  });

  test('opts.calendar=null ⇒ بدون تقویم (مثل قبل)؛ opts.calendar صریح اولویت دارد؛ context مشترک درست کار می‌کند', () => {
    const r = mk(uA, '2026-09-19', '08:00', '16:30'); // شنبه‌ی بعد، تعطیلی ندارد
    assert.deepEqual(pick(dayService.computeRecordDay(r, { calendar: OFF })), [0, 510, 0]);
    const holidayRec = mk(uB, W.mon, '08:00', '16:30'); // دوشنبه‌ی تعطیل
    assert.deepEqual(pick(dayService.computeRecordDay(holidayRec, { calendar: null })), [510, 0, 0]);
    const context = dayService.loadContext();
    const [a, b] = [holidayRec, mk(uA, '2026-09-26', '08:00', '16:30')].map((x) => dayService.computeRecordDay(x, { context }));
    assert.deepEqual([pick(a), pick(b)], [[0, 510, 0], [510, 0, 0]]);
  });

  test('رکورد بدون record_date معتبر یا بدون ورود: تقویم اعمال نمی‌شود و exception نمی‌دهد', () => {
    const bad = { user_id: uA.id, record_date: 'x', check_in_time: iso(W.mon, '08:00'), check_out_time: iso(W.mon, '16:30'), status: 'normal' };
    assert.deepEqual(pick(dayService.computeRecordDay(bad)), [510, 0, 0]);
    assert.equal(dayService.computeRecordDay(null).expected, 510);
  });
});

describe('مصرف‌کننده‌های «تعطیل بودن امروز» (S3-7c)', () => {
  let adminUser; let eA; let eB; let eC;
  const today = todayDateString();

  before(() => {
    resetDb();
    adminUser = makeUser({ role: 'admin' });
    eA = makeUser({ department: 'A' });
    eB = makeUser({ department: 'B' });
    eC = makeUser({ department: '' });
    holidaysRepo.addHoliday(today, 'تعطیلی دپارتمان A', { scope: 'department', department: 'A' });
  });
  after(cleanup);

  test('فهرست کاربران پنل: todayStatus=holiday فقط برای دپارتمانِ مشمول', { skip: (() => { try { require.resolve('express'); return false; } catch (_) { return 'express نصب نیست'; } })() }, async () => {
    const { createApp } = require('../src/server');
    const server = createApp().listen(0);
    await new Promise((r) => server.once('listening', r));
    try {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/api/admin/users`, { headers: { cookie: sessionCookie(adminUser.id), 'x-requested-with': 'AttendancePanel' } });
      assert.equal(res.status, 200);
      const rows = await res.json();
      const st = (u) => rows.find((r) => r.id === u.id).todayStatus;
      assert.deepEqual([st(eA), st(eB), st(eC)], ['holiday', 'not_checked_in', 'not_checked_in']);
    } finally {
      server.close();
    }
  });

  test('/status بات: پیام تعطیل فقط برای دپارتمانِ مشمول', async () => {
    const { handleStatus } = require('../src/bot/commands/status');
    const say = async (u) => {
      const sent = [];
      await handleStatus({ sendMessage: async (_chat, text) => sent.push(text) }, { chat: { id: 1 }, from: { id: u.telegram_user_id } });
      return sent.join('\n');
    };
    const [a, b] = [await say(eA), await say(eB)];
    assert.match(a, /تعطیل/);
    assert.doesNotMatch(b, /تعطیل/);
  });
});

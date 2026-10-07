// S3-8a: Jobهای یادآور (ورود دیرهنگام، خروج) هر روز اجرا می‌شوند و برای هر کاربر از getCalendarDay تصمیم می‌گیرند.
// زمان با mock.timers (Date) کنترل می‌شود تا findTodayRecord/todayDateString هم با همان روز کار کنند.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');

const { checkLateCheckins, checkRepeatedLateness } = require('../src/bot/scheduler/lateCheckinReminder');
const { checkCheckoutReminders } = require('../src/bot/scheduler/checkoutReminder');
const holidaysRepo = require('../src/repositories/holidaysRepository');
const shiftsRepo = require('../src/repositories/shiftsRepository');
const usersRepo = require('../src/repositories/usersRepository');
const attendanceRepo = require('../src/repositories/attendanceRepository');
const { zonedTimeToUtc } = require('../src/utils/time');
const { makeUser } = require('./helpers/factories');

const TEHRAN = 'Asia/Tehran';
const at = (date, hhmm) => zonedTimeToUtc(date, hhmm, TEHRAN);
// هفته‌ی ۲۰۲۶-۰۹-۱۲ (شنبه) … ۰۹-۱۸ (جمعه)
const W = { sat: '2026-09-12', mon: '2026-09-14', tue: '2026-09-15', wed: '2026-09-16', thu: '2026-09-17', fri: '2026-09-18', sat2: '2026-09-19', sat3: '2026-09-26' };
const canMock = typeof mock.timers?.enable === 'function';

describe('یادآورها بر پایه‌ی تقویم (S3-8a)', { skip: canMock ? false : 'mock.timers در این Node نیست' }, () => {
  let uA; let uB; let uS; let label;
  const setNow = (date, hhmm) => { mock.timers.reset(); mock.timers.enable({ apis: ['Date'], now: at(date, hhmm).getTime() }); };
  const run = async (fn, date, hhmm) => {
    setNow(date, hhmm);
    const sent = [];
    await fn({ sendMessage: async (chatId, text) => { sent.push(label[String(chatId)]); return text; } });
    return sent.sort();
  };
  const open = (users, date) => users.forEach((u) => attendanceRepo.createManual({ userId: u.id, recordDate: date, checkInTime: at(date, '08:00').toISOString(), status: 'normal' }));

  before(() => {
    resetDb();
    uA = makeUser({ department: 'A' });
    uB = makeUser({ department: 'B' });
    uS = makeUser({ department: 'B' });
    label = { [uA.telegram_user_id]: 'A', [uB.telegram_user_id]: 'B', [uS.telegram_user_id]: 'S' };
    const shift = shiftsRepo.createShift({ name: 'عصر', startTime: '14:00', endTime: '22:00', graceLateMinutes: 0, graceEarlyMinutes: 0, workDays: [6, 0, 1, 2, 3], overnight: false, maxLunchMinutes: 0, fixedLunchDeductMinutes: 0 });
    usersRepo.setUserShift(uS.id, shift.id);
    holidaysRepo.addHoliday(W.mon, 'تعطیل کامل');
    holidaysRepo.addHoliday(W.tue, 'تعطیل دپارتمان A', { scope: 'department', department: 'A' });
    holidaysRepo.addHoliday(W.wed, 'نیم‌روز', { kind: 'half', halfEndTime: '11:00' });
  });
  after(() => { mock.timers.reset(); cleanup(); });

  test('ورود دیرهنگام: روز عادی همه (به‌جز شیفت عصر که هنوز شروع نشده)؛ تکرار همان روز پیامی نمی‌فرستد', async () => {
    assert.deepEqual(await run(checkLateCheckins, W.sat, '09:00'), ['A', 'B']);
    assert.deepEqual(await run(checkLateCheckins, W.sat, '09:10'), [], 'یک‌بار در روز');
  });

  test('ورود دیرهنگام: پیش از «شروع + مهلت» پیامی نیست؛ شیفت عصر با ساعت شروع خودش', async () => {
    assert.deepEqual(await run(checkLateCheckins, W.sat2, '08:10'), []);
    assert.deepEqual(await run(checkLateCheckins, W.sat2, '08:20'), ['A', 'B']);
    assert.deepEqual(await run(checkLateCheckins, W.sat2, '14:10'), []);
    assert.deepEqual(await run(checkLateCheckins, W.sat2, '14:20'), ['S']);
  });

  test('ورود دیرهنگام: تعطیل کامل ⇒ هیچ‌کس؛ تعطیلی دپارتمان A ⇒ فقط B؛ جمعه ⇒ هیچ‌کس؛ پنجشنبه (نیم‌روز) و نیم‌روز تعطیلی ⇒ مثل روز کاری', async () => {
    assert.deepEqual(await run(checkLateCheckins, W.mon, '09:00'), []);
    assert.deepEqual(await run(checkLateCheckins, W.tue, '09:00'), ['B']);
    assert.deepEqual(await run(checkLateCheckins, W.wed, '09:00'), ['A', 'B']);
    assert.deepEqual(await run(checkLateCheckins, W.thu, '09:00'), ['A', 'B'], 'شیفت عصر پنجشنبه کاری نیست');
    assert.deepEqual(await run(checkLateCheckins, W.fri, '09:00'), []);
  });

  test('خروج: روز عادی تا پایان ۱۶:۳۰ (شیفت عصر تا ۲۲:۰۰)؛ بیرون از پنجره پیامی نیست', async () => {
    open([uA, uB, uS], W.sat);
    assert.deepEqual(await run(checkCheckoutReminders, W.sat, '16:00'), []);
    assert.deepEqual(await run(checkCheckoutReminders, W.sat, '16:20'), ['A', 'B']);
    assert.deepEqual(await run(checkCheckoutReminders, W.sat, '21:50'), ['S']);
  });

  test('خروج: پنجشنبه نیم‌روز ۱۲:۳۰ و نیم‌روز تعطیلی ۱۱:۰۰ (۱۵ دقیقه قبل)', async () => {
    open([uA, uB], W.thu);
    assert.deepEqual(await run(checkCheckoutReminders, W.thu, '12:20'), ['A', 'B']);
    open([uA, uB], W.wed);
    assert.deepEqual(await run(checkCheckoutReminders, W.wed, '16:20'), [], 'پایان ۱۱:۰۰ گذشته است');
    assert.deepEqual(await run(checkCheckoutReminders, W.wed, '10:50'), ['A', 'B']);
  });

  test('خروج: تعطیل کامل، تعطیلی دپارتمان A و جمعه', async () => {
    open([uA, uB], W.mon);
    assert.deepEqual(await run(checkCheckoutReminders, W.mon, '16:20'), []);
    open([uA, uB], W.tue);
    assert.deepEqual(await run(checkCheckoutReminders, W.tue, '16:20'), ['B']);
    open([uA, uB], W.fri);
    assert.deepEqual(await run(checkCheckoutReminders, W.fri, '16:20'), []);
  });

  test('تأخیر مکرر: هر روز اجرا می‌شود ولی در روز غیرکاریِ کارمند هشدار نمی‌دهد (بدون exception)', async () => {
    const mgr = makeUser({ role: 'manager' });
    usersRepo.updateUser(uA.id, { manager_id: mgr.id });
    await assert.doesNotReject(() => run(checkRepeatedLateness, W.fri, '09:00'));
    await assert.doesNotReject(() => run(checkRepeatedLateness, W.sat3, '09:00'));
  });
});

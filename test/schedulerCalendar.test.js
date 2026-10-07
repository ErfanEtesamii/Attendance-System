// S3-8b: بقیه‌ی Jobها (markNonWorkingDays، گزارش پایان روز، غایب‌ها/dayReview، مرور شبانه) برای هر کاربر از getCalendarDay تصمیم می‌گیرند.
// زمان با mock.timers (Date) کنترل می‌شود تا todayDateString/findTodayRecord با همان روز کار کنند.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');

const { markNonWorkingDays } = require('../src/bot/scheduler/markNonWorkingDays');
const { sendDailyReport } = require('../src/bot/scheduler/reports');
const { sendNightlyReview, isTeamOffDay } = require('../src/bot/scheduler/nightlyReview');
const { reviewDay } = require('../src/utils/dayReview');
const holidaysRepo = require('../src/repositories/holidaysRepository');
const shiftsRepo = require('../src/repositories/shiftsRepository');
const usersRepo = require('../src/repositories/usersRepository');
const attendanceRepo = require('../src/repositories/attendanceRepository');
const { zonedTimeToUtc } = require('../src/utils/time');
const { makeUser, makeApprovedMission } = require('./helpers/factories');
const { getDb } = require('../src/db/connection');

const TEHRAN = 'Asia/Tehran';
const at = (date, hhmm) => zonedTimeToUtc(date, hhmm, TEHRAN);
// هفته‌ی ۲۰۲۶-۰۹-۱۲ (شنبه) … ۰۹-۱۸ (جمعه)
const W = { sat: '2026-09-12', mon: '2026-09-14', tue: '2026-09-15', wed: '2026-09-16', thu: '2026-09-17', fri: '2026-09-18' };
const canMock = typeof mock.timers?.enable === 'function';

describe('Jobهای گزارش/غایب/شبانه بر پایه‌ی تقویم (S3-8b)', { skip: canMock ? false : 'mock.timers در این Node نیست' }, () => {
  let admin; let mgrA; let mgrB; let uA; let uB; let uN;
  const setNow = (date, hhmm) => { mock.timers.reset(); mock.timers.enable({ apis: ['Date'], now: at(date, hhmm).getTime() }); };
  const statusOf = (user, date) => (attendanceRepo.listByUserAndRange(user.id, date, date)[0] || {}).status || null;
  // پیام‌های ارسال‌شده به هر گیرنده (کلید: نام کامل گیرنده)
  const collect = async (fn, date, hhmm) => {
    setNow(date, hhmm);
    const sent = {};
    const names = Object.fromEntries(usersRepo.listUsers({}).map((u) => [String(u.telegram_user_id), u.full_name]));
    await fn({ sendMessage: async (chatId, text) => { sent[names[String(chatId)]] = text; return text; } });
    return sent;
  };
  const checkIn = (user, date) => attendanceRepo.createManual({ userId: user.id, recordDate: date, checkInTime: at(date, '08:00').toISOString(), checkOutTime: at(date, '16:30').toISOString(), status: 'normal' });

  before(() => {
    resetDb();
    admin = makeUser({ role: 'admin', department: 'مدیریت', name: 'ادمین' });
    mgrA = makeUser({ role: 'manager', department: 'A', name: 'سرپرست الف' });
    mgrB = makeUser({ role: 'manager', department: 'B', name: 'سرپرست ب' });
    uA = makeUser({ department: 'A', managerId: mgrA.id, name: 'کارمند الف' });
    uB = makeUser({ department: 'B', managerId: mgrB.id, name: 'کارمند ب' });
    uN = makeUser({ department: 'B', managerId: mgrB.id, name: 'کارمند شبانه' });
    const night = shiftsRepo.createShift({ name: 'شب', startTime: '22:00', endTime: '06:00', graceLateMinutes: 0, graceEarlyMinutes: 0, workDays: [6, 0, 1, 2], overnight: true, maxLunchMinutes: 0, fixedLunchDeductMinutes: 0 });
    usersRepo.setUserShift(uN.id, night.id);
    // reviewDay کاربرانِ ساخته‌شده «بعد از» تاریخ را نادیده می‌گیرد؛ تاریخ‌های تست در گذشته‌اند
    getDb().prepare("UPDATE users SET created_at = '2026-01-01 00:00:00'").run();
    holidaysRepo.addHoliday(W.mon, 'تعطیل کامل');
    holidaysRepo.addHoliday(W.tue, 'تعطیل دپارتمان A', { scope: 'department', department: 'A' });
    holidaysRepo.addHoliday(W.wed, 'نیم‌روز', { kind: 'half', halfEndTime: '11:00' });
  });
  after(() => { mock.timers.reset(); cleanup(); });

  test('markNonWorkingDays: تعطیل کامل ⇒ همه، تعطیلی دپارتمانی ⇒ فقط همان دپارتمان؛ جمعه/نیم‌روز ⇒ هیچ‌کس؛ مرخصی تأییدشده همچنان', async () => {
    setNow(W.mon, '12:00'); // todayDateString به UTC است؛ ۰۰:۰۵ تهران روز قبل می‌شد
    await markNonWorkingDays();
    [admin, mgrA, uA, uB, uN].forEach((u) => assert.equal(statusOf(u, W.mon), 'holiday', u.full_name));

    setNow(W.tue, '12:00');
    await markNonWorkingDays();
    assert.equal(statusOf(uA, W.tue), 'holiday');
    assert.equal(statusOf(mgrA, W.tue), 'holiday');
    assert.equal(statusOf(uB, W.tue), null, 'دپارتمان B تعطیل نیست');

    for (const day of [W.wed, W.thu, W.fri]) {
      setNow(day, '12:00');
      // eslint-disable-next-line no-await-in-loop
      await markNonWorkingDays();
      assert.equal(statusOf(uB, day), null, `${day}: نیم‌روز/پنجشنبه/جمعه placeholder نمی‌گیرد`);
    }

    makeApprovedMission(uB.id, W.sat); // مأموریت ⇒ placeholder نمی‌گیرد (مثل قبل)
    setNow(W.sat, '12:00');
    await markNonWorkingDays();
    assert.equal(statusOf(uB, W.sat), null);
  });

  test('گزارش پایان روز: جمعه ⇒ پیامی نیست (مگر کسی ورود زده)؛ تعطیل کامل/دپارتمانی «تعطیل رسمی»؛ پنجشنبه (نیم‌روز) و روز عادی «غایب»', async () => {
    assert.deepEqual(await collect(sendDailyReport, W.fri, '17:00'), {}, 'جمعه: همه روز غیرکاری');

    checkIn(uB, W.fri); // کسی که جمعه کار کرده در گزارش می‌آید، بقیه نه
    const fri = await collect(sendDailyReport, W.fri, '17:00');
    assert.ok(fri['سرپرست ب'].includes('کارمند ب: خروج ثبت شده'));
    assert.ok(!fri['سرپرست ب'].includes('کارمند شبانه'), 'غیرکاری و بدون ورود حذف می‌شود');
    assert.equal(fri['سرپرست الف'], undefined, 'تیم الف کسی ندارد ⇒ پیامی نیست');
    getDb().prepare('DELETE FROM attendance_records WHERE user_id = ? AND record_date = ?').run(uB.id, W.fri); // تست‌ها به هم وابسته نباشند

    const mon = await collect(sendDailyReport, W.mon, '17:00');
    assert.ok(mon['سرپرست ب'].includes('کارمند ب: تعطیل رسمی'));
    assert.ok(mon['ادمین'].includes('کارمند الف: تعطیل رسمی'));

    const tue = await collect(sendDailyReport, W.tue, '17:00');
    assert.ok(tue['سرپرست الف'].includes('کارمند الف: تعطیل رسمی'), 'تعطیلی دپارتمان A');
    assert.ok(tue['سرپرست ب'].includes('کارمند ب: غایب / بدون ثبت ورود'), 'دپارتمان B تعطیل نیست');

    const thu = await collect(sendDailyReport, W.thu, '17:00');
    assert.ok(thu['سرپرست ب'].includes('کارمند ب: غایب / بدون ثبت ورود'), 'پنجشنبه نیم‌روزِ کاری است');
    assert.ok(!thu['سرپرست ب'].includes('کارمند شبانه'), 'شیفت شب: پنجشنبه در workDays او نیست');
  });

  test('reviewDay (غایب‌ها): آخر هفته/تعطیل دپارتمانی «تعطیل»، نیم‌روز و روز عادی «غایب»؛ calendarKind افزوده شده', () => {
    const state = (rows, u) => { const r = rows.find((x) => x.user.id === u.id); return `${r.state}/${r.calendarKind}`; };
    const team = [uA, uB, uN].map((u) => usersRepo.findById(u.id)); // ردیف تازه (created_at اصلاح‌شده)
    assert.deepEqual(team.map((u) => state(reviewDay(team, W.fri), u)), ['holiday/weekend', 'holiday/weekend', 'holiday/weekend']);
    assert.deepEqual(team.map((u) => state(reviewDay(team, W.tue), u)), ['holiday/holiday', 'absent/working', 'absent/working']);
    assert.deepEqual(team.map((u) => state(reviewDay(team, W.wed), u)), ['absent/half', 'absent/half', 'holiday/weekend']); // چهارشنبه در workDays شیفت شب نیست
    assert.equal(reviewDay(team, W.fri).some((r) => r.needsAttention), false, 'روز غیرکاری نیازمند بررسی نیست');
    const [fA, fB] = [uA, uB].map((u) => usersRepo.findById(u.id));
    assert.equal(isTeamOffDay(reviewDay([fA], W.tue)), true);
    assert.equal(isTeamOffDay(reviewDay([fA, fB], W.tue)), false);
  });

  test('مرور شبانه: روز غیرکاریِ کل تیم ⇒ پیامی نیست؛ تعطیلی یک دپارتمان فقط سرپرست همان تیم را ساکت می‌کند؛ شمارش تعطیل در «نفر» نمی‌آید', async () => {
    assert.deepEqual(await collect(sendNightlyReview, W.fri, '20:00'), {}, 'جمعه');
    assert.deepEqual(await collect(sendNightlyReview, W.mon, '20:00'), {}, 'تعطیل کامل');

    const tue = await collect(sendNightlyReview, W.tue, '20:00');
    assert.equal(tue['سرپرست الف'], undefined, 'تیم الف تعطیل است');
    assert.ok(tue['سرپرست ب'].includes('(2 نفر)') || tue['سرپرست ب'].includes('(۲ نفر)'), tue['سرپرست ب']);
    assert.ok(tue['سرپرست ب'].includes('کارمند ب — غایب'));

    const sat = await collect(sendNightlyReview, W.sat, '20:00');
    assert.ok(sat['سرپرست الف'] && sat['سرپرست ب'], 'روز عادی: هر دو سرپرست پیام می‌گیرند');

    checkIn(uB, W.fri); // ورود در روز غیرکاری ⇒ تیم «کاری» حساب می‌شود
    const fri = await collect(sendNightlyReview, W.fri, '20:00');
    assert.ok(fri['سرپرست ب'], 'کسی ورود زده است');
    assert.equal(fri['سرپرست الف'], undefined);
  });
});

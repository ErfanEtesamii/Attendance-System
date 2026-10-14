// B1 (فاز ۱۲): شیفت اختصاصی کارمند (مثلاً ۱۵:۳۰–۲۱:۰۰) + انتساب با «تاریخ اعمال» (user_shift_assignments، shiftOn).
// ساعت جعلی با mock.timers (Date) تا «امروز» به روز هفته/ساعت واقعی وابسته نباشد.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');

const shiftsRepo = require('../src/repositories/shiftsRepository');
const usersRepo = require('../src/repositories/usersRepository');
const attendanceRepo = require('../src/repositories/attendanceRepository');
const dayService = require('../src/engine/dayService');
const migration = require('../src/db/migrations/028_user_shift_assignments');
const { checkLateCheckins } = require('../src/bot/scheduler/lateCheckinReminder');
const { checkCheckoutReminders } = require('../src/bot/scheduler/checkoutReminder');
const { zonedTimeToUtc } = require('../src/utils/time');
const { makeUser } = require('./helpers/factories');

const TEHRAN = 'Asia/Tehran';
const at = (date, hhmm) => zonedTimeToUtc(date, hhmm, TEHRAN);
const iso = (date, hhmm) => at(date, hhmm).toISOString();
const SAT = '2026-09-12'; // شنبه (روز کاری عادی)
const canMock = typeof mock.timers?.enable === 'function';
const setNow = (date, hhmm) => { mock.timers.reset(); mock.timers.enable({ apis: ['Date'], now: at(date, hhmm).getTime() }); };
const mkShift = (o) => shiftsRepo.createShift({ graceLateMinutes: 0, graceEarlyMinutes: 0, workDays: [6, 0, 1, 2, 3], overnight: false, maxLunchMinutes: 0, fixedLunchDeductMinutes: 0, ...o });

describe('شیفت اختصاصی ۱۵:۳۰–۲۱:۰۰ و تاریخ اعمال (B1)', { skip: canMock ? false : 'mock.timers در این Node نیست' }, () => {
  let db; let evening; let morning; let uE; let uPlain;

  before(() => {
    db = resetDb();
    evening = mkShift({ name: 'عصرِ ۱۵:۳۰', startTime: '15:30', endTime: '21:00' });
    morning = mkShift({ name: 'صبح', startTime: '08:00', endTime: '16:00' });
    uE = makeUser({ name: 'کارمند عصر' });
    uPlain = makeUser({ name: 'کارمند بدون شیفت' });
    setNow(SAT, '10:00');
    usersRepo.setUserShift(uE.id, evening.id);
  });
  after(() => { mock.timers.reset(); cleanup(); });

  const rec = (user, date, inH, outH) => attendanceRepo.createManual({ userId: user.id, recordDate: date, checkInTime: iso(date, inH), checkOutTime: outH ? iso(date, outH) : null, status: 'normal' });

  test('ورود ۱۵:۴۰ ⇒ تأخیر ۱۰؛ خروج ۲۰:۳۰ ⇒ ۳۰ دقیقه زودتر؛ expected = ۳۳۰ (نه ساعت سراسری)', () => {
    const d = dayService.computeRecordDay(rec(uE, '2026-09-13', '15:40', '20:30'));
    assert.deepEqual([d.expected, d.late, d.earlyLeave, d.overtime], [330, 10, 30, 0]);
  });

  test('خروج ۲۱:۳۰ ⇒ ۳۰ دقیقه اضافه‌کاری؛ ورود/خروج داخل حاشیه ⇒ بدون outside_shift', () => {
    const d = dayService.computeRecordDay(rec(uE, '2026-09-14', '15:30', '21:30'));
    assert.deepEqual([d.late, d.earlyLeave, d.overtime], [0, 0, 30]);
    assert.ok(!d.flags.includes('outside_shift'));
  });

  test('ورود ۰۸:۰۰ (۷٫۵ ساعت قبل از شروع، بیش از حاشیه‌ی ۱۲۰ دقیقه) ⇒ outside_shift؛ همان رکورد برای کارمند بدون شیفت عادی است', () => {
    const e = dayService.computeRecordDay(rec(uE, '2026-09-15', '08:00', '16:00'));
    assert.ok(e.flags.includes('outside_shift'));
    const p = dayService.computeRecordDay(rec(uPlain, '2026-09-15', '08:00', '16:00'));
    assert.deepEqual([p.expected, p.late, p.flags.includes('outside_shift')], [510, 0, false]); // کاربر بدون شیفت دست‌نخورده
  });

  test('یادآور ورود: برای کارمند عصر با ساعت شیفت خودش (نه ۰۸:۰۰ سراسری)؛ یادآور خروج نزدیک ۲۱:۰۰', async () => {
    const sentTo = async (fn, date, hhmm) => {
      setNow(date, hhmm);
      const sent = [];
      await fn({ sendMessage: async (chatId) => { sent.push(String(chatId)); return true; } });
      return sent;
    };
    const e = String(uE.telegram_user_id);
    const day = '2026-09-19'; // شنبه‌ی بعد
    assert.ok(!(await sentTo(checkLateCheckins, day, '09:00')).includes(e), 'ساعت ۰۹:۰۰ برای شیفت عصر هنوز زود است');
    assert.ok((await sentTo(checkLateCheckins, day, '15:50')).includes(e), 'بعد از شروع ۱۵:۳۰ + مهلت');
    attendanceRepo.createManual({ userId: uE.id, recordDate: day, checkInTime: iso(day, '15:35'), status: 'normal' });
    assert.ok(!(await sentTo(checkCheckoutReminders, day, '17:00')).includes(e), 'خیلی تا پایان مانده');
    assert.ok((await sentTo(checkCheckoutReminders, day, '20:55')).includes(e), 'نزدیک پایان ۲۱:۰۰');
  });

  test('نیم‌روز/تعطیلی با ساعت شیفت کارمند: نیم‌روز ساعت ۱۸:۰۰ روی شیفت ۱۵:۳۰–۲۱:۰۰ ⇒ پایان مؤثر ۱۸:۰۰', () => {
    const holidays = require('../src/repositories/holidaysRepository');
    holidays.addHoliday('2026-09-16', 'نیم‌روز', { kind: 'half', halfEndTime: '18:00' });
    const cal = require('../src/engine/calendarService').getCalendarDay(uE, '2026-09-16');
    assert.deepEqual([cal.isWorkingDay, cal.kind, cal.expectedStart, cal.expectedEnd], [true, 'half', '15:30', '18:00']);
  });

  test('تاریخ اعمال: شیفت جدید فقط از آن روز؛ روزهای قبل با شیفت قبلی محاسبه می‌شوند', () => {
    const u = makeUser();
    shiftsRepo.assignShift({ userId: u.id, shiftId: morning.id, effectiveFrom: '2026-08-01' });
    shiftsRepo.assignShift({ userId: u.id, shiftId: evening.id, effectiveFrom: '2026-09-01' });
    assert.equal(shiftsRepo.shiftOn(u.id, '2026-07-31'), null, 'قبل از اولین انتساب ⇒ بدون شیفت');
    assert.equal(shiftsRepo.shiftOn(u.id, '2026-08-31').id, morning.id);
    assert.equal(shiftsRepo.shiftOn(u.id, '2026-09-01').id, evening.id);
    setNow(SAT, '10:00');
    assert.equal(shiftsRepo.findByUserId(u.id).id, evening.id, 'findByUserId = شیفتِ امروز');

    // همان ساعت‌های ورود/خروج: قبل از ۰۹-۰۱ شیفت صبح، بعد از آن شیفت عصر
    const before = dayService.computeRecordDay(rec(u, '2026-08-30', '08:10', '16:00'));
    assert.deepEqual([before.expected, before.late], [480, 10]);
    const after = dayService.computeRecordDay(rec(u, '2026-09-06', '15:40', '21:00'));
    assert.deepEqual([after.expected, after.late], [330, 10]);

    // انتساب آینده هنوز اثر ندارد؛ برداشتن شیفت (null) از یک تاریخ
    shiftsRepo.assignShift({ userId: u.id, shiftId: null, effectiveFrom: '2026-12-01' });
    assert.equal(shiftsRepo.shiftOn(u.id, '2026-11-30').id, evening.id);
    assert.equal(shiftsRepo.shiftOn(u.id, '2026-12-01'), null);
    assert.equal(shiftsRepo.findByUserId(u.id).id, evening.id);
    assert.equal(db.prepare('SELECT shift_id FROM users WHERE id = ?').get(u.id).shift_id, evening.id, 'آینه‌ی users.shift_id = شیفتِ امروز');
    // ثبت دوباره برای همان تاریخ جایگزین می‌شود
    shiftsRepo.assignShift({ userId: u.id, shiftId: morning.id, effectiveFrom: '2026-09-01' });
    assert.equal(shiftsRepo.listAssignments(u.id).filter((a) => a.effective_from === '2026-09-01').length, 1);
    assert.equal(shiftsRepo.shiftOn(u.id, '2026-09-02').id, morning.id);
  });

  test('makeShiftResolver = shiftOn (دسته‌ای)؛ userCount/لیست طبق شیفتِ امروز؛ حذفِ شیفتِ دارای تاریخچه رد می‌شود', () => {
    const u = makeUser();
    shiftsRepo.assignShift({ userId: u.id, shiftId: morning.id, effectiveFrom: '2026-01-01' });
    shiftsRepo.assignShift({ userId: u.id, shiftId: evening.id, effectiveFrom: '2026-10-01' });
    setNow(SAT, '10:00'); // امروز ۲۰۲۶-۰۹-۱۲ ⇒ هنوز صبح
    const resolve = shiftsRepo.makeShiftResolver([u.id, uPlain.id]);
    for (const d of ['2025-12-31', '2026-01-01', '2026-09-30', '2026-10-01', '2027-01-01']) assert.equal((resolve(u.id, d) || {}).id, (shiftsRepo.shiftOn(u.id, d) || {}).id, d);
    assert.equal(resolve(uPlain.id, '2026-09-12'), null);
    assert.ok(shiftsRepo.listUsersOfShift(morning.id).some((x) => x.id === u.id));
    assert.ok(!shiftsRepo.listUsersOfShift(evening.id).some((x) => x.id === u.id), 'عصر از ۱۰-۰۱ است');
    const spare = mkShift({ name: 'بی‌مصرف', startTime: '06:00', endTime: '14:00' });
    shiftsRepo.assignShift({ userId: uPlain.id, shiftId: spare.id, effectiveFrom: '2026-01-01' });
    shiftsRepo.assignShift({ userId: uPlain.id, shiftId: null, effectiveFrom: '2026-02-01' });
    assert.equal(shiftsRepo.countUsers(spare.id), 0);
    assert.equal(shiftsRepo.deleteShiftIfUnused(spare.id), false, 'تاریخچه‌ی انتساب هنوز به آن اشاره می‌کند');
  });

  test('migration ۰۲۸: backfill از users.shift_id با effective_from=۱۹۷۰ (تاریخچه بدون تغییر) و اجرای دوباره بی‌اثر', () => {
    const u = makeUser();
    db.prepare('UPDATE users SET shift_id = ? WHERE id = ?').run(morning.id, u.id); // مثل داده‌ی قبل از migration
    assert.equal(shiftsRepo.listAssignments(u.id).length, 0);
    migration.up(db);
    const rows = shiftsRepo.listAssignments(u.id);
    assert.deepEqual(rows.map((r) => [r.shift_id, r.effective_from]), [[morning.id, '1970-01-01']]);
    const total = db.prepare('SELECT COUNT(*) n FROM user_shift_assignments').get().n;
    migration.up(db);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM user_shift_assignments').get().n, total, 'idempotent');
    assert.equal(shiftsRepo.shiftOn(u.id, '2020-01-01').id, morning.id);
  });
});

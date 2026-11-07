// C1 (فاز ۱۲): استراحت کوتاهِ با حقوق — موتور خالص computeDay + تنظیمات + فیلد روی شیفت + migration ۰۳۰.
// قانون: i‌امین استراحت کوتاه (به ترتیب شروع) با i ≤ paidBreakCount تا سقف paidBreakMinutes با حقوق است؛ مازاد و استراحت‌های بعدی و ناهار بدون حقوق.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { computeDay } = require('../src/engine/computeDay');
const { zonedTimeToUtc } = require('../src/utils/time');
const { validateShiftInput } = require('../src/utils/shiftValidation');
const settingsRepo = require('../src/repositories/settingsRepository');
const shiftsRepo = require('../src/repositories/shiftsRepository');
const usersRepo = require('../src/repositories/usersRepository');
const attendanceRepo = require('../src/repositories/attendanceRepository');
const breakRepo = require('../src/repositories/breakRepository');
const dayService = require('../src/engine/dayService');
const migration = require('../src/db/migrations/030_paid_breaks');
const { makeUser } = require('./helpers/factories');

const D = '2026-09-13'; // یکشنبه
const at = (hhmm) => zonedTimeToUtc(D, hhmm, 'Asia/Tehran').toISOString();
const BASE = { workDayStart: '08:00', workDayEnd: '16:00' };
const record = { check_in_time: at('08:00'), check_out_time: at('16:00'), status: 'normal', record_date: D };
const sb = (from, to) => ({ break_type: 'short_break', start_time: at(from), end_time: at(to) });
const lunch = (from, to) => ({ break_type: 'lunch', start_time: at(from), end_time: at(to) });
const run = (breaks, settings = {}, shift) => computeDay({ record, breaks, settings: { ...BASE, ...settings }, timezone: 'Asia/Tehran', shift });
const pick = (d) => [d.break, d.breakPaid, d.breakUnpaid, d.effective];
const PAID = { paidBreakCount: 3, paidBreakMinutes: 45 };

describe('استراحت با حقوق — موتور computeDay (C1)', () => {
  test('paidBreakCountUnlimited ⇒ تعداد نامحدود ولی استخر دقیقه برقرار؛ مازاد ۴۵ دقیقه بدون حقوق', () => {
    const shorts = [];
    for (let h = 9; h < 15; h += 1) { const p = String(h).padStart(2, '0'); shorts.push(sb(`${p}:00`, `${p}:20`), sb(`${p}:30`, `${p}:50`)); } // ۱۲ بار × ۲۰ = ۲۴۰
    const d = run(shorts, { paidBreakCountUnlimited: true, paidBreakCount: 0, paidBreakMinutes: 45 });
    assert.deepEqual(pick(d), [240, 45, 195, 285]);
    const many = run([sb('09:00', '09:10'), sb('10:00', '10:10'), sb('11:00', '11:10'), sb('12:00', '12:10'), sb('13:00', '13:10')], { paidBreakCountUnlimited: true, paidBreakMinutes: 45 });
    assert.deepEqual(pick(many), [50, 45, 5, 475]); // استراحت پنجم هم از استخر سهم می‌گیرد
    assert.equal(run(shorts, { paidBreakCountUnlimited: true, paidBreakMinutes: 0 }).breakPaid, 0); // استخر ۰ ⇒ خاموش
  });

  test('۳ استراحت ۱۵دقیقه‌ای ⇒ breakUnpaid=۰ و effective کم نمی‌شود (۴۸۰)', () => {
    const d = run([sb('10:00', '10:15'), sb('12:00', '12:15'), sb('14:00', '14:15')], PAID);
    assert.deepEqual(pick(d), [45, 45, 0, 480]);
  });

  test('استراحت ۲۵ دقیقه‌ای ⇒ ۱۰ دقیقه بدون حقوق', () => {
    const d = run([sb('10:00', '10:25')], { paidBreakCount: 3, paidBreakMinutes: 15 });
    assert.deepEqual(pick(d), [25, 15, 10, 470]);
  });

  test('daily pool is shared by the first three short breaks', () => {
    const d = run([sb('10:00', '10:20'), sb('12:00', '12:20'), sb('14:00', '14:20')], PAID);
    assert.deepEqual(pick(d), [60, 45, 15, 465]);
  });

  test('the fourth short break is unpaid even when the pool is not exhausted', () => {
    const d = run([sb('09:00', '09:10'), sb('11:00', '11:10'), sb('13:00', '13:10'), sb('15:00', '15:10')], PAID);
    assert.deepEqual(pick(d), [40, 30, 10, 470]);
  });

  test('استراحت چهارم کاملاً بدون حقوق؛ ترتیب شروع (نه ترتیب ورودی) تعیین‌کننده است', () => {
    const d = run([sb('14:00', '14:15'), sb('10:00', '10:15'), sb('13:00', '13:10'), sb('11:00', '11:15')], PAID); // چهارمی به ترتیب شروع = ۱۴:۰۰
    assert.deepEqual(pick(d), [55, 40, 15, 465]);
  });

  test('ناهار بدون تغییر و بدون حقوق؛ کنار استراحت‌های با حقوق', () => {
    const d = run([lunch('12:00', '12:30'), sb('10:00', '10:15')], PAID);
    assert.deepEqual(pick(d), [45, 15, 30, 450]);
    const noPaid = run([lunch('12:00', '12:30'), sb('10:00', '10:15')]);
    assert.deepEqual(pick(noPaid), [45, 0, 45, 435]);
  });

  test('paidBreakCount=۰ (یا minutes=۰) ⇒ دقیقاً مثل قبل؛ break = breakPaid + breakUnpaid', () => {
    const breaks = [sb('10:00', '10:20'), lunch('12:00', '12:40'), sb('14:00', '14:05')];
    const legacy = run(breaks);
    for (const s of [{}, { paidBreakCount: 0, paidBreakMinutes: 15 }, { paidBreakCount: 3, paidBreakMinutes: 0 }]) {
      const d = run(breaks, s);
      assert.deepEqual([d.break, d.effective, d.breakPaid], [legacy.break, legacy.effective, 0]);
    }
    const p = run(breaks, PAID);
    assert.equal(p.break, p.breakPaid + p.breakUnpaid);
    assert.equal(p.break, legacy.break, 'مجموع کل (سازگار با قبل) عوض نمی‌شود');
  });

  test('override روی شیفت: مقدار شیفت بر سراسری غالب است؛ null/نبودن ⇒ سراسری؛ ۰ در شیفت = خاموش', () => {
    const breaks = [sb('10:00', '10:20'), sb('12:00', '12:20')];
    const shift = { startTime: '08:00', endTime: '16:00', graceLateMinutes: 0, graceEarlyMinutes: 0, overnight: false, maxLunchMinutes: 0, fixedLunchDeductMinutes: 0 };
    assert.deepEqual(pick(run(breaks, PAID, { ...shift, paidBreakCount: 1, paidBreakMinutes: 10 })), [40, 10, 30, 450]);
    assert.deepEqual(pick(run(breaks, PAID, { ...shift, paidBreakCount: null, paidBreakMinutes: null })), [40, 40, 0, 480]);
    assert.deepEqual(pick(run(breaks, PAID, shift)), [40, 40, 0, 480]);
    assert.deepEqual(pick(run(breaks, PAID, { ...shift, paidBreakCount: 0 })), [40, 0, 40, 440]);
    assert.deepEqual(pick(run(breaks, {}, { ...shift, paidBreakCount: 2, paidBreakMinutes: 20 })), [40, 20, 20, 460], 'شیفت می‌تواند بدون تنظیم سراسری هم روشن کند');
  });

  test('کسر ثابت ناهار همیشه بدون حقوق؛ effective نه دوبار کم می‌شود نه منفی', () => {
    const d = run([sb('10:00', '10:15')], { ...PAID, fixedLunchDeductMinutes: 30 });
    assert.deepEqual([d.break, d.breakAuto, d.breakPaid, d.breakUnpaid, d.effective], [45, 30, 15, 30, 450]);
    const huge = run([sb('08:30', '15:30')], PAID); // ۷ ساعت استراحت: فقط ۱۵ دقیقه با حقوق
    assert.deepEqual([huge.breakPaid, huge.breakUnpaid, huge.effective], [45, 375, 105]);
    const tiny = computeDay({ record: { ...record, check_out_time: at('08:10') }, breaks: [sb('08:00', '08:10')], settings: { ...BASE, ...PAID }, timezone: 'Asia/Tehran' });
    assert.deepEqual([tiny.breakPaid, tiny.breakUnpaid, tiny.effective], [10, 0, 10]);
  });

  test('استراحت بازِ فراموش‌شده شمرده نمی‌شود (مثل قبل)؛ پرچم‌ها سالم', () => {
    const open = { break_type: 'short_break', start_time: at('10:00'), end_time: null };
    const d = run([open, sb('12:00', '12:15')], { ...PAID, longOpenBreakMinutes: 60 });
    assert.deepEqual([d.breakPaid, d.breakUnpaid, d.break], [15, 0, 15]);
    assert.ok(d.flags.includes('long_open_break'));
    const out = run([{ break_type: 'short_break', start_time: at('07:00'), end_time: at('07:10') }], PAID);
    assert.ok(out.flags.includes('break_outside_range'));
  });

  test('رکورد باز و بدون ورود: breakPaid/breakUnpaid صفر و خنثی', () => {
    const none = computeDay({ record: null, breaks: [], settings: { ...BASE, ...PAID }, timezone: 'Asia/Tehran' });
    assert.deepEqual([none.breakPaid, none.breakUnpaid, none.effective], [0, 0, null]);
  });

  test('ورودی نامعتبر ⇒ RangeError (مقدار منفی در شیفت یا تنظیمات)', () => {
    assert.throws(() => run([], { paidBreakCount: -1 }), RangeError);
    assert.throws(() => run([], {}, { startTime: '08:00', endTime: '16:00', overnight: false, paidBreakMinutes: -5 }), RangeError);
  });

  test('ماموریت: بخش با حقوق دوبار از حضور کم نمی‌شود (effectiveWithMission ≥ effective)', () => {
    const win = [{ start: 9 * 60, end: 11 * 60, kind: 'mission' }];
    const d = computeDay({ record, breaks: [sb('10:00', '10:15')], settings: { ...BASE, ...PAID }, timezone: 'Asia/Tehran', approvedLeaves: win });
    assert.ok(d.effectiveWithMission >= d.effective);
    assert.equal(d.effective, 480);
  });
});

describe('تنظیمات، شیفت و migration (C1)', () => {
  let db; let shift; let u;
  before(() => { db = resetDb(); });
  after(cleanup);

  test('تنظیمات سراسری: پیش‌فرض ۰، حدود ۰..۱۰ و ۰..۱۲۰', () => {
    const all = settingsRepo.getAll();
    assert.deepEqual([all.paidBreakCount, all.paidBreakMinutes], [3, 45]);
    const reg = require('../src/utils/settingsRegistry');
    assert.equal(reg.validate('paidBreakCount', 3).ok, true);
    assert.equal(reg.validate('paidBreakCount', 11).ok, false);
    assert.equal(reg.validate('paidBreakCount', -1).ok, false);
    assert.equal(reg.validate('paidBreakMinutes', 120).ok, true);
    assert.equal(reg.validate('paidBreakMinutes', 121).ok, false);
    assert.deepEqual(reg.selfCheck && reg.selfCheck(), reg.selfCheck && reg.selfCheck(), 'selfCheck بدون استثنا');
  });

  test('اعتبارسنجی شیفت: null = سراسری، حدود، رشته‌ی خالی', () => {
    const ok = validateShiftInput({ name: 'ش', startTime: '08:00', endTime: '16:00' });
    assert.deepEqual([ok.value.paidBreakCount, ok.value.paidBreakMinutes], [null, null]);
    const v = validateShiftInput({ name: 'ش', startTime: '08:00', endTime: '16:00', paidBreakCount: '3', paidBreakMinutes: 15 });
    assert.deepEqual([v.value.paidBreakCount, v.value.paidBreakMinutes], [3, 15]);
    assert.equal(validateShiftInput({ name: 'ش', startTime: '08:00', endTime: '16:00', paidBreakCount: 11 }).field, 'paidBreakCount');
    assert.equal(validateShiftInput({ name: 'ش', startTime: '08:00', endTime: '16:00', paidBreakMinutes: 121 }).field, 'paidBreakMinutes');
    assert.equal(validateShiftInput({ paidBreakCount: -1 }, { partial: true }).field, 'paidBreakCount');
    assert.equal(validateShiftInput({ paidBreakCount: null }, { partial: true }).value.paidBreakCount, null);
  });

  test('ذخیره/خواندن/ویرایش فیلدهای شیفت؛ پاک‌کردن با null', () => {
    shift = shiftsRepo.createShift({ ...validateShiftInput({ name: 'اداری', startTime: '08:00', endTime: '16:00', paidBreakCount: 3, paidBreakMinutes: 15 }).value });
    assert.deepEqual([shift.paidBreakCount, shift.paidBreakMinutes], [3, 15]);
    assert.deepEqual([shiftsRepo.findById(shift.id).paidBreakCount, shiftsRepo.listShifts()[0].paidBreakMinutes], [3, 15]);
    const edited = shiftsRepo.updateShift(shift.id, { paidBreakCount: null });
    assert.deepEqual([edited.paidBreakCount, edited.paidBreakMinutes], [null, 15]);
    shiftsRepo.updateShift(shift.id, { paidBreakCount: 3 });
    assert.throws(() => db.prepare('UPDATE work_shifts SET paid_break_count = 99 WHERE id = ?').run(shift.id), 'CHECK در دیتابیس');
  });

  test('کل مسیر dayService: شیفتِ مؤثر با تنظیم خودش؛ بدون شیفت ⇒ تنظیمات سراسری', () => {
    u = makeUser();
    usersRepo.setUserShift(u.id, shift.id);
    const date = '2026-09-14';
    const rec = attendanceRepo.createManual({ userId: u.id, recordDate: date, checkInTime: zonedTimeToUtc(date, '08:00', 'Asia/Tehran').toISOString(), checkOutTime: zonedTimeToUtc(date, '16:00', 'Asia/Tehran').toISOString(), status: 'normal' });
    breakRepo.createManual
      ? breakRepo.createManual({ attendanceRecordId: rec.id, startTime: zonedTimeToUtc(date, '10:00', 'Asia/Tehran').toISOString(), endTime: zonedTimeToUtc(date, '10:25', 'Asia/Tehran').toISOString(), breakType: 'short_break' })
      : db.prepare("INSERT INTO break_records (attendance_record_id, start_time, end_time, break_type) VALUES (?, ?, ?, 'short_break')").run(rec.id, zonedTimeToUtc(date, '10:00', 'Asia/Tehran').toISOString(), zonedTimeToUtc(date, '10:25', 'Asia/Tehran').toISOString());
    const d = dayService.computeRecordDay(rec);
    assert.deepEqual([d.breakPaid, d.breakUnpaid, d.effective], [15, 10, 470]);
    usersRepo.setUserShift(u.id, null);
    const g = dayService.computeRecordDay(rec);
    assert.deepEqual([g.breakPaid, g.breakUnpaid, g.effective], [25, 45, 435]);
  });

  test('migration ۰۳۰ idempotent؛ ستون‌ها NULL پیش‌فرض (رفتار قبلی)', () => {
    migration.up(db);
    migration.up(db);
    const cols = db.prepare('PRAGMA table_info(work_shifts)').all().map((c) => c.name);
    assert.ok(cols.includes('paid_break_count') && cols.includes('paid_break_minutes'));
    const s = shiftsRepo.createShift({ ...validateShiftInput({ name: 'بی‌تنظیم', startTime: '09:00', endTime: '17:00' }).value });
    assert.deepEqual([s.paidBreakCount, s.paidBreakMinutes], [null, null]);
  });
});

describe('سرویس سیاست (Mini App) و گزارش ماهانه (C1)', () => {
  let db; let u; let shift;
  const breakSvc = require('../src/services/breakPolicyService');
  const settings = require('../src/repositories/settingsRepository');
  before(() => { db = resetDb(); u = makeUser(); shift = shiftsRepo.createShift({ ...validateShiftInput({ name: 'ش۱', startTime: '08:00', endTime: '16:00' }).value }); });
  after(cleanup);

  test('policyFor: پیش‌فرض خاموش؛ تنظیم سراسری؛ شیفتِ مؤثر آن روز بر سراسری غالب است', () => {
    assert.deepEqual(breakSvc.policyFor(u.id, '2026-09-14'), { enabled: true, unlimited: false, count: 3, minutes: 45 });
    settings.setValue('paidBreakCount', 3);
    settings.setValue('paidBreakMinutes', 15);
    assert.deepEqual(breakSvc.policyFor(u.id, '2026-09-14'), { enabled: true, unlimited: false, count: 3, minutes: 15 });
    shiftsRepo.updateShift(shift.id, { paidBreakCount: 2, paidBreakMinutes: 10 });
    shiftsRepo.assignShift({ userId: u.id, shiftId: shift.id, effectiveFrom: '2026-09-10' });
    assert.deepEqual(breakSvc.policyFor(u.id, '2026-09-14'), { enabled: true, unlimited: false, count: 2, minutes: 10 });
    assert.deepEqual(breakSvc.policyFor(u.id, '2026-09-09'), { enabled: true, unlimited: false, count: 3, minutes: 15 }, 'قبل از تاریخ اعمال شیفت ⇒ سراسری');
    shiftsRepo.updateShift(shift.id, { paidBreakCount: 0 });
    assert.equal(breakSvc.policyFor(u.id, '2026-09-14').enabled, false, '۰ روی شیفت = خاموش');
    shiftsRepo.updateShift(shift.id, { paidBreakCount: null, paidBreakMinutes: null });
  });

  test('paidInfo: شماره‌ی استراحت کوتاه (۱‌مبنا) به ترتیب شروع؛ ناهار ⇒ null؛ سهمیه‌ی تمام‌شده isPaid=false', () => {
    settings.setValue('paidBreakCount', 2);
    settings.setValue('paidBreakMinutes', 15);
    const rows = [
      { id: 1, break_type: 'short_break', start_time: '2026-09-14T06:00:00.000Z' },
      { id: 2, break_type: 'lunch', start_time: '2026-09-14T08:00:00.000Z' },
      { id: 3, break_type: 'short_break', start_time: '2026-09-14T09:00:00.000Z' },
      { id: 4, break_type: 'short_break', start_time: '2026-09-14T10:00:00.000Z' },
    ];
    const info = (row) => breakSvc.paidInfo(u.id, '2026-09-14', rows, row);
    assert.deepEqual(info(rows[0]), { count: 2, minutes: 15, index: 1, remainingMinutes: 15, isPaid: true });
    assert.equal(info(rows[1]), null);
    assert.deepEqual(info(rows[2]), { count: 2, minutes: 15, index: 2, remainingMinutes: 15, isPaid: true });
    assert.deepEqual(info(rows[3]), { count: 2, minutes: 15, index: 3, remainingMinutes: 15, isPaid: false });
    settings.setValue('paidBreakCount', 0);
    assert.equal(info(rows[0]), null, 'خاموش ⇒ UI چیزی نشان نمی‌دهد');
  });

  test('گزارش ماهانه: جمع استراحت با/بدون حقوق در breaks (جدا از time) و ریز روزانه', () => {
    settings.setValue('paidBreakCount', 3);
    settings.setValue('paidBreakMinutes', 45);
    const { computeMonthlyReport } = require('../src/services/monthlyReportService');
    const date = '2026-12-02'; // سه‌شنبه؛ ماه ۱۴۰۵/۹
    const rec = attendanceRepo.createManual({ userId: u.id, recordDate: date, checkInTime: zonedTimeToUtc(date, '08:00', 'Asia/Tehran').toISOString(), checkOutTime: zonedTimeToUtc(date, '16:00', 'Asia/Tehran').toISOString(), status: 'normal' });
    const mk = (a, b) => breakRepo.createManual({ attendanceRecordId: rec.id, breakType: 'short_break', startTime: zonedTimeToUtc(date, a, 'Asia/Tehran').toISOString(), endTime: zonedTimeToUtc(date, b, 'Asia/Tehran').toISOString() });
    mk('10:00', '10:25'); mk('12:00', '12:10');
    const rep = computeMonthlyReport({ users: [usersRepo.findById(u.id)], year: 1405, month: 9, now: '2026-12-31T12:00:00Z', includeDays: true, includeBalances: false });
    const r = rep.users[0];
    assert.deepEqual(r.breaks, { paidMinutes: 35, unpaidMinutes: 0 });
    assert.ok(!('breakPaidMinutes' in r.time), 'time دست‌نخورده (snapshotهای ماه بسته‌ی قبلی)');
    const day = r.days.find((d) => d.date === date);
    assert.deepEqual([day.breakPaid, day.breakUnpaid, day.effective], [35, 0, 480]);
    const { buildMonthlySheets } = require('../src/services/monthlyExportService');
    const sheets = buildMonthlySheets(rep);
    const main = sheets[0];
    // ستون‌های دورکاری (فاز ۱۴) بعد از ستون‌های استراحت اضافه شده‌اند؛ پس موقعیت را از روی نام سرستون پیدا می‌کنیم نه از انتها.
    const iPaid = main.headers.indexOf('استراحت با حقوق (دقیقه)');
    assert.ok(iPaid >= 0);
    assert.equal(main.headers[iPaid + 1], 'استراحت بدون حقوق (دقیقه)');
    assert.deepEqual(main.rows[0].slice(iPaid, iPaid + 2), [35, 0]);
    settings.setValue('paidBreakCount', 0);
  });
});

// گزارش ماهانه/حقوق باید نوبت‌های ورود/خروج (ورود مجدد) را مثل گزارش روزانه حساب کند: فاصله‌ی بین دو نوبت «حضور» نیست.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { zonedTimeToUtc } = require('../src/utils/time');

describe('گزارش ماهانه با چند نوبت', () => {
  let F; let attendanceRepo; let usersRepo; let dayService;
  before(() => { resetDb(); F = require('./helpers/factories'); attendanceRepo = require('../src/repositories/attendanceRepository'); usersRepo = require('../src/repositories/usersRepository'); dayService = require('../src/engine/dayService'); });
  after(() => cleanup());

  test('ساعت مفید روز در گزارش ماهانه = گزارش روزانه (فاصله‌ی بین دو نوبت کم می‌شود)', () => {
    const { computeMonthlyReport } = require('../src/services/monthlyReportService');
    const u = F.makeUser();
    const date = '2026-12-02'; // ۱۴۰۵/۹
    const T = (h) => zonedTimeToUtc(date, h, 'Asia/Tehran').toISOString();
    const rec = attendanceRepo.createManual({ userId: u.id, recordDate: date, checkInTime: T('08:00'), checkOutTime: T('11:00'), status: 'normal' });
    assert.ok(attendanceRepo.addManualSegment(rec.id, { checkInTime: T('14:00'), checkOutTime: T('17:00') }).segment);
    const fresh = attendanceRepo.findById(rec.id);
    const daily = dayService.computeRecordDay(fresh);
    assert.equal(daily.workedGross, 360); // ۳ ساعت + ۳ ساعت؛ نه ۹ ساعت پیوسته
    const rep = computeMonthlyReport({ users: [usersRepo.findById(u.id)], year: 1405, month: 9, now: '2026-12-31T12:00:00Z', includeDays: true, includeBalances: false });
    const day = rep.users[0].days.find((d) => d.date === date);
    assert.equal(day.effective, daily.effective);
    assert.ok(day.effective <= 360);
  });

  test('listSegmentsByRecordIds: فقط رکوردهای دارای ردیف نوبت، به ترتیب seq', () => {
    const u = F.makeUser();
    const T = (h) => zonedTimeToUtc('2026-12-03', h, 'Asia/Tehran').toISOString();
    const r1 = attendanceRepo.createManual({ userId: u.id, recordDate: '2026-12-03', checkInTime: T('08:00'), checkOutTime: T('10:00'), status: 'normal' });
    attendanceRepo.addManualSegment(r1.id, { checkInTime: T('11:00'), checkOutTime: T('12:00') });
    const r2 = attendanceRepo.createManual({ userId: u.id, recordDate: '2026-12-04', checkInTime: T('08:00'), checkOutTime: T('10:00'), status: 'normal' });
    const m = attendanceRepo.listSegmentsByRecordIds([r1.id, r2.id, 'x']);
    assert.deepEqual((m.get(r1.id) || []).map((s) => s.seq), [1, 2]);
    assert.equal(m.has(r2.id), false);
  });
});

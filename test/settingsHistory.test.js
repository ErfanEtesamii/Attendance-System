// تنظیمات محاسباتی تاریخ‌دار: تغییر استراحت با حقوق از یک تاریخ به بعد اعمال می‌شود و روزهای قبل با مقدار قبلی می‌مانند.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { zonedTimeToUtc } = require('../src/utils/time');
const { settingsAt } = require('../src/utils/settingsHistory');

describe('settingsAt (خالص)', () => {
  test('بدون تاریخچه همان settings؛ با تاریخچه مقدار مؤثرِ همان روز', () => {
    const s = { paidBreakMinutes: 20 };
    assert.equal(settingsAt(s, '2026-11-01'), s);
    Object.defineProperty(s, '__history', { value: { paidBreakMinutes: [{ from: '0000-00-00', value: 45 }, { from: '2026-11-18', value: 20 }] } });
    assert.equal(settingsAt(s, '2026-11-17').paidBreakMinutes, 45);
    assert.equal(settingsAt(s, '2026-11-18').paidBreakMinutes, 20);
    assert.equal(settingsAt(s, '2027-01-01').paidBreakMinutes, 20);
  });
});

describe('تغییر تنظیم با تاریخ شروع', () => {
  let repo; let hist; let attendanceRepo; let breakRepo; let dayService; let F;
  before(() => {
    resetDb(); F = require('./helpers/factories');
    repo = require('../src/repositories/settingsRepository'); hist = require('../src/repositories/settingsHistoryRepository');
    attendanceRepo = require('../src/repositories/attendanceRepository'); breakRepo = require('../src/repositories/breakRepository'); dayService = require('../src/engine/dayService');
  });
  after(() => cleanup());

  function dayWithBreak(userId, date) {
    const T = (h) => zonedTimeToUtc(date, h, 'Asia/Tehran').toISOString();
    const rec = attendanceRepo.createManual({ userId, recordDate: date, checkInTime: T('08:00'), checkOutTime: T('17:00'), status: 'normal' });
    breakRepo.createManual({ attendanceRecordId: rec.id, breakType: 'short_break', startTime: T('10:00'), endTime: T('10:40') });
    return attendanceRepo.findById(rec.id);
  }

  test('از تاریخ مشخص اعمال می‌شود و قبلش مقدار قبلی', () => {
    const u = F.makeUser();
    repo.setValue('paidBreakMinutes', 45);
    repo.setValue('paidBreakMinutes', 20, { effectiveFrom: '2026-11-18' });
    assert.equal(repo.getAll().paidBreakMinutes, 20);
    assert.deepEqual(hist.listForKey('paidBreakMinutes').map((r) => r.from), ['0000-00-00', '2026-11-18']);
    const before = dayService.computeRecordDay(dayWithBreak(u.id, '2026-11-10'));
    const after = dayService.computeRecordDay(dayWithBreak(u.id, '2026-11-20'));
    assert.ok(before.effective > after.effective, `${before.effective} باید بیشتر از ${after.effective} باشد`);
  });

  test('تغییر بدون مقدار تازه تاریخچه نمی‌سازد؛ کلید غیرمحاسباتی ردیابی نمی‌شود', () => {
    const n = hist.listForKey('paidBreakMinutes').length;
    repo.setValue('paidBreakMinutes', 20);
    assert.equal(hist.listForKey('paidBreakMinutes').length, n);
    repo.setValue('timezone', 'Asia/Tehran');
    assert.equal(hist.listForKey('timezone').length, 0);
  });

  test('getAll: __history غیرقابل‌شمارش است (در JSON نشت نمی‌کند)', () => {
    assert.equal(JSON.stringify(repo.getAll()).includes('__history'), false);
  });
});

describe('همه‌ی مسیرهای محاسبه تنظیمات «همان روز» را می‌خوانند', () => {
  let F; let repo; let attendanceRepo; let dayService; let usersRepo;
  before(() => {
    resetDb(); F = require('./helpers/factories'); repo = require('../src/repositories/settingsRepository');
    attendanceRepo = require('../src/repositories/attendanceRepository'); dayService = require('../src/engine/dayService'); usersRepo = require('../src/repositories/usersRepository');
  });
  after(() => cleanup());

  test('مهلت تأخیر: روز قبل از تاریخ با مقدار قبلی، بعد از آن با مقدار جدید (روزانه و ماهانه یکسان)', () => {
    const { computeMonthlyReport } = require('../src/services/monthlyReportService');
    const u = F.makeUser();
    repo.update({ workDayStart: '08:00', workDayEnd: '16:00', lateGraceMinutes: 0, weekendDays: [5] });
    repo.setValue('lateGraceMinutes', 15, { effectiveFrom: '2026-12-01' });
    const T = (d, h) => zonedTimeToUtc(d, h, 'Asia/Tehran').toISOString();
    const mk = (d) => attendanceRepo.createManual({ userId: u.id, recordDate: d, checkInTime: T(d, '08:10'), checkOutTime: T(d, '16:00'), status: 'normal' });
    const early = dayService.computeRecordDay(attendanceRepo.findById(mk('2026-11-25').id));
    const late = dayService.computeRecordDay(attendanceRepo.findById(mk('2026-12-02').id));
    assert.equal(early.late, 10);
    assert.equal(late.late, 0);
    const rep = computeMonthlyReport({ users: [usersRepo.findById(u.id)], year: 1405, month: 9, now: '2026-12-31T12:00:00Z', includeDays: true, includeBalances: false });
    const d = (date) => rep.users[0].days.find((x) => x.date === date);
    assert.equal(d('2026-12-02').late, 0);
  });
});

// پیش‌نمایش اثر شیفت روی گذشته: شیفت چرخشیِ اعمال‌نشده ⇒ تأخیر اشتباه؛ بعد از اعمال (تاریخ گذشته) تأخیر صفر.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const shiftsRepo = require('../src/repositories/shiftsRepository');
const attendanceRepo = require('../src/repositories/attendanceRepository');
const impact = require('../src/services/shiftImpactService');
const { zonedTimeToUtc } = require('../src/utils/time');
const { makeUser } = require('./helpers/factories');

const at = (date, hhmm) => zonedTimeToUtc(date, hhmm, 'Asia/Tehran');
const canMock = typeof mock.timers?.enable === 'function';

describe('شیفت اصلاحی روی گذشته', { skip: canMock ? false : 'mock.timers در این Node نیست' }, () => {
  let u; let rotating; let morning;
  before(() => {
    resetDb();
    mock.timers.enable({ apis: ['Date'], now: at('2026-09-14', '12:00').getTime() });
    morning = shiftsRepo.createShift({ name: 'صبح', startTime: '08:00', endTime: '16:00', workDays: [6, 0, 1, 2, 3] });
    rotating = shiftsRepo.createShift({ name: 'چرخشی', startTime: '00:00', endTime: '23:59', workDays: [6, 0, 1, 2, 3], isUntimed: true });
    u = makeUser({ name: 'کارمند چرخشی' });
    shiftsRepo.setForAllDates(u.id, morning.id);
    attendanceRepo.createManual({ userId: u.id, recordDate: '2026-09-12', checkInTime: at('2026-09-12', '10:30').toISOString(), checkOutTime: at('2026-09-12', '16:00').toISOString(), status: 'normal' });
  });
  after(() => { mock.timers.reset(); cleanup(); });

  test('پیش‌نمایش: تأخیر ۱۵۰ دقیقه ⇒ ۰ با شیفت چرخشی، و چیزی ذخیره نمی‌شود', () => {
    const r = impact.preview(u, rotating, '2026-09-12');
    assert.equal(r.isRetroactive, true);
    assert.equal(r.totals.records, 1);
    assert.equal(r.totals.lateBefore, 150);
    assert.equal(r.totals.lateAfter, 0);
    assert.equal(r.days[0].changed, true);
    assert.equal(shiftsRepo.shiftOn(u.id, '2026-09-12').id, morning.id);
  });

  test('بعد از انتساب با تاریخ گذشته، تأخیر زنده صفر می‌شود', () => {
    shiftsRepo.assignShift({ userId: u.id, shiftId: rotating.id, effectiveFrom: '2026-09-12' });
    const r = impact.preview(u, rotating, '2026-09-12');
    assert.equal(r.totals.lateBefore, 0);
    assert.equal(r.totals.changedDays, 0);
  });
});

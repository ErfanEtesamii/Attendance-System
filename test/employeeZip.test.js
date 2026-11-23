// ارسال ماهانه‌ی زیپ اکسل کارمندان: تنظیمات، گیرنده‌ها، محتوای زیپ و یادداشت تغییر سیاست استراحت.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { zonedTimeToUtc } = require('../src/utils/time');

describe('زیپ اکسل ماهانه‌ی کارمندان', () => {
  let F; let settings; let attendanceRepo; let svc; let job; let zipLib;
  before(() => {
    resetDb(); F = require('./helpers/factories'); settings = require('../src/repositories/settingsRepository');
    attendanceRepo = require('../src/repositories/attendanceRepository'); svc = require('../src/services/employeeMonthlyExcelService');
    job = require('../src/bot/scheduler/employeeZip'); zipLib = require('jszip');
  });
  after(() => cleanup());

  test('parseIds: فقط عدد صحیح مثبت و بدون تکرار', () => {
    assert.deepEqual(job.parseIds(' 1, 22,x,-3,22 ,0'), [1, 22]);
    assert.deepEqual(job.parseIds(''), []);
  });

  test('پیش‌فرض خاموش و بدون گیرنده؛ ارسال انجام نمی‌شود', async () => {
    const sent = [];
    const bot = { sendDocument: async (...a) => sent.push(a) };
    assert.equal(settings.getAll().employeeZipEnabled, false);
    assert.equal((await job.sendEmployeeZipReports(bot)).skipped, 'disabled');
    settings.setValue('employeeZipEnabled', true);
    assert.equal((await job.sendEmployeeZipReports(bot)).skipped, 'no_recipients');
    assert.equal(sent.length, 0);
  });

  test('زیپ: یک اکسل برای هر کارمند دارای رکورد، با یادداشت تغییر سیاست؛ ارسال به گیرنده‌ها', async () => {
    const a = F.makeUser({ name: 'کارمند الف' }); const b = F.makeUser({ name: 'کارمند ب' }); F.makeUser({ name: 'بدون رکورد' });
    const T = (d, h) => zonedTimeToUtc(d, h, 'Asia/Tehran').toISOString();
    for (const u of [a, b]) attendanceRepo.createManual({ userId: u.id, recordDate: '2026-12-02', checkInTime: T('2026-12-02', '08:00'), checkOutTime: T('2026-12-02', '16:00'), status: 'normal' });
    settings.setValue('paidBreakMinutes', 45);
    settings.setValue('paidBreakMinutes', 20, { effectiveFrom: '2026-12-01' });
    const file = await svc.buildEmployeesZip({ year: 1405, month: 9 });
    assert.equal(file.count, 2);
    const zip = await zipLib.loadAsync(file.buffer);
    const names = Object.keys(zip.files);
    assert.equal(names.length, 2);
    assert.ok(names.some((n) => n.startsWith('کارمند الف')));
    assert.match(svc.policyNote('2026-12-20'), /۲۰ دقیقه‌ای شد.*قبل از آن ۴۵/);
    assert.equal(svc.policyNote('2026-11-30'), null);

    const rec = F.makeUser({ name: 'گیرنده' });
    require('../src/repositories/usersRepository').updateUser(rec.id, { telegram_user_id: '999001' });
    settings.setValue('employeeZipRecipientIds', String(rec.id));
    const sent = [];
    const r = await job.sendEmployeeZipReports({ sendDocument: async (...x) => sent.push(x) }, { now: new Date('2027-01-01T08:00:00Z') });
    assert.equal(r.sent, 1);
    assert.equal(String(sent[0][0]), '999001');
    assert.equal(sent[0][3].contentType, 'application/zip');
  });
});

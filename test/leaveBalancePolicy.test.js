// S4-9b: تنظیمات مرخصی/مانده (استحقاق پیش‌فرض، سقف انتقالی، سیاست block|warn|allow_negative) و تبدیل دقیقه به روز/ساعت بر پایه‌ی روز کاری کاربر.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { formatMinutes, evaluatePolicy, dayLengthMinutes } = require('../src/utils/leaveBalanceFormat');
const svc = require('../src/services/leaveBalanceService');
const settingsRepo = require('../src/repositories/settingsRepository');
const shiftsRepo = require('../src/repositories/shiftsRepository');
const usersRepo = require('../src/repositories/usersRepository');
const leaveTypesRepo = require('../src/repositories/leaveTypesRepository');
const { makeUser } = require('./helpers/factories');

describe('منطق خالص مانده (S4-9b)', () => {
  test('dayLengthMinutes: عادی، شیفت شب، نامعتبر', () => {
    assert.equal(dayLengthMinutes('08:00', '16:30'), 510);
    assert.equal(dayLengthMinutes('22:00', '06:00'), 480);
    assert.equal(dayLengthMinutes('x', '06:00'), null);
  });

  test('formatMinutes بر پایه‌ی طول روز؛ منفی؛ ورودی نامعتبر', () => {
    assert.deepEqual(formatMinutes(1020, 510), { negative: false, days: 2, hours: 0, minutes: 0, text: '2 روز' });
    assert.equal(formatMinutes(600, 510).text, '1 روز و 1 ساعت و 30 دقیقه');
    assert.equal(formatMinutes(600, 480).text, '1 روز و 2 ساعت');
    assert.equal(formatMinutes(0, 480).text, '0 دقیقه');
    assert.equal(formatMinutes(-90, 480).text, 'منفی 1 ساعت و 30 دقیقه');
    assert.throws(() => formatMinutes(1.5, 480), RangeError);
    assert.throws(() => formatMinutes(10, 0), RangeError);
  });

  test('evaluatePolicy: سه سیاست', () => {
    assert.deepEqual(evaluatePolicy('block', 100, 100), { allowed: true, warn: false, shortfall: 0, remainingAfter: 0 });
    assert.deepEqual(evaluatePolicy('block', 100, 160), { allowed: false, warn: false, shortfall: 60, remainingAfter: -60 });
    assert.deepEqual(evaluatePolicy('warn', 100, 160), { allowed: true, warn: true, shortfall: 60, remainingAfter: -60 });
    assert.deepEqual(evaluatePolicy('allow_negative', -10, 50), { allowed: true, warn: false, shortfall: 60, remainingAfter: -60 });
    assert.throws(() => evaluatePolicy('x', 1, 1), RangeError);
    assert.throws(() => evaluatePolicy('warn', 1, -1), RangeError);
  });
});

describe('تنظیمات و سرویس مانده (S4-9b)', () => {
  let emp; let admin; let annual; let mission;
  const Y = 1405;
  before(() => {
    resetDb();
    admin = makeUser({ role: 'admin' });
    emp = makeUser();
    annual = leaveTypesRepo.findByCode('annual');
    mission = leaveTypesRepo.findByCode('mission');
  });
  after(() => cleanup());
  const key = (o = {}) => ({ userId: emp.id, leaveTypeId: annual.id, jalaliYear: Y, ...o });

  test('پیش‌فرض‌های خنثی: بدون استحقاق، بدون سقف انتقالی، سیاست warn', () => {
    const s = settingsRepo.getAll();
    assert.deepEqual([s.leaveDefaultEntitlementMinutes, s.leaveCarryOverCapMinutes, s.leaveBalancePolicy], [0, 0, 'warn']);
    assert.equal(svc.getBalance(key()).entitled, 0);
  });

  test('استحقاق پیش‌فرض فقط بدون ردیف صریح؛ ردیف صریح اولویت دارد؛ نوع بدون مانده اثر نمی‌گیرد', () => {
    settingsRepo.setValue('leaveDefaultEntitlementMinutes', 5100);
    assert.equal(svc.getBalance(key()).entitled, 5100);
    assert.equal(svc.getBalance(key()).remaining, 5100);
    assert.equal(svc.getBalance(key({ leaveTypeId: mission.id })).tracked, false);
    svc.setEntitlement({ ...key(), entitledMinutes: 1000, actor: admin.id, reason: 'صریح' });
    assert.equal(svc.getBalance(key()).entitled, 1000);
    assert.equal(svc.getBalance(key({ userId: makeUser().id })).entitled, 5100);
  });

  test('سقف انتقالی: ۰ بدون سقف؛ بیشتر از سقف رد می‌شود؛ برابر سقف مجاز', () => {
    assert.equal(svc.setEntitlement({ ...key(), carriedOverMinutes: 99999, actor: admin.id, reason: 'x' }).ok, true);
    settingsRepo.setValue('leaveCarryOverCapMinutes', 600);
    assert.equal(svc.setEntitlement({ ...key(), carriedOverMinutes: 601, actor: admin.id, reason: 'x' }).code, 'CARRY_OVER_EXCEEDS_CAP');
    assert.equal(svc.setEntitlement({ ...key(), carriedOverMinutes: 600, actor: admin.id, reason: 'x' }).ok, true);
    assert.equal(svc.setEntitlement({ ...key(), entitledMinutes: 2000, actor: admin.id, reason: 'x' }).ok, true, 'تغییر استحقاق به سقف انتقالی ربط ندارد');
  });

  test('نمایش بر پایه‌ی روز کاری کاربر: تنظیمات سراسری و شیفت', () => {
    const u = makeUser();
    svc.setEntitlement({ userId: u.id, leaveTypeId: annual.id, jalaliYear: Y, entitledMinutes: 1020, actor: admin.id, reason: 'x' });
    let d = svc.describeBalance({ userId: u.id, leaveTypeId: annual.id, jalaliYear: Y });
    assert.equal(d.dayMinutes, 510);
    assert.equal(d.display.entitled.text, '2 روز');
    assert.equal(d.policy, 'warn');
    const shift = shiftsRepo.createShift({ name: 'کوتاه', startTime: '08:00', endTime: '14:00', graceLateMinutes: 0, graceEarlyMinutes: 0, workDays: [0, 1, 2, 3, 6], overnight: false, maxLunchMinutes: 0, fixedLunchDeductMinutes: 0 });
    usersRepo.setUserShift(u.id, shift.id);
    d = svc.describeBalance({ userId: u.id, leaveTypeId: annual.id, jalaliYear: Y });
    assert.equal(d.dayMinutes, 360);
    assert.equal(d.display.entitled.text, '2 روز و 5 ساعت');
  });

  test('checkRequest با سیاست جاری', () => {
    const u = makeUser();
    svc.setEntitlement({ userId: u.id, leaveTypeId: annual.id, jalaliYear: Y, entitledMinutes: 500, actor: admin.id, reason: 'x' });
    const k = { userId: u.id, leaveTypeId: annual.id, jalaliYear: Y };
    settingsRepo.setValue('leaveBalancePolicy', 'block');
    assert.deepEqual([svc.checkRequest(k, 500).allowed, svc.checkRequest(k, 501).allowed, svc.checkRequest(k, 501).shortfall], [true, false, 1]);
    settingsRepo.setValue('leaveBalancePolicy', 'warn');
    assert.deepEqual([svc.checkRequest(k, 501).allowed, svc.checkRequest(k, 501).warn], [true, true]);
    settingsRepo.setValue('leaveBalancePolicy', 'allow_negative');
    assert.deepEqual([svc.checkRequest(k, 900).allowed, svc.checkRequest(k, 900).warn], [true, false]);
    assert.deepEqual(svc.checkRequest({ ...k, leaveTypeId: mission.id }, 99999), { ok: true, tracked: false, allowed: true, warn: false, shortfall: 0 });
  });
});

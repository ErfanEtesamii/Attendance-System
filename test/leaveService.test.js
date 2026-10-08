// S4-10a: leaveService.validate/create — تداخل، گذشته/آینده، پیش‌اطلاع، سقف روز متوالی، سیاست مانده (با رزرو درخواست‌های در انتظار)، skip، ذخیره‌ی کامل.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const leaveService = require('../src/services/leaveService');
const balanceSvc = require('../src/services/leaveBalanceService');
const leaveRepo = require('../src/repositories/leaveRepository');
const leaveTypesRepo = require('../src/repositories/leaveTypesRepository');
const settingsRepo = require('../src/repositories/settingsRepository');
const { zonedTimeToUtc } = require('../src/utils/time');
const { makeUser } = require('./helpers/factories');

const NOW = zonedTimeToUtc('2026-09-14', '10:00', 'Asia/Tehran'); // دوشنبه، سال شمسی ۱۴۰۵
const D = { sat: '2026-09-12', sun: '2026-09-13', mon: '2026-09-14', tue: '2026-09-15', wed: '2026-09-16', thu: '2026-09-17', fri: '2026-09-18' };
const codes = (r) => r.errors.map((e) => e.code);

describe('leaveService (S4-10a)', () => {
  let emp; let admin; let annual; let sick;
  before(() => {
    resetDb();
    admin = makeUser({ role: 'admin' });
    annual = leaveTypesRepo.findByCode('annual');
  });
  after(() => cleanup());
  // هر تست کاربر تازه می‌گیرد؛ تنظیمات به پیش‌فرض برمی‌گردند
  const fresh = () => {
    for (const k of ['leaveAllowPastRequests', 'leaveMaxPastDays', 'leaveMaxFutureDays', 'leaveMinNoticeHours', 'leaveBalancePolicy', 'leaveDefaultEntitlementMinutes']) settingsRepo.resetValue(k);
    emp = makeUser();
    return emp;
  };
  const input = (o = {}) => ({ userId: emp.id, leaveTypeId: annual.id, startDate: D.wed, endDate: D.wed, ...o });
  const entitle = (minutes) => balanceSvc.setEntitlement({ userId: emp.id, leaveTypeId: annual.id, jalaliYear: 1405, entitledMinutes: minutes, actor: admin.id, reason: 'تست' });

  test('درخواست ساده معتبر: مدت کاری و بدون هشدار؛ خطاهای پایه از prepare می‌آیند', () => {
    fresh();
    assert.deepEqual(leaveService.validate(input(), { now: NOW }).warnings.map((w) => w.code), ['LOW_BALANCE'], 'بدون استحقاق + سیاست پیش‌فرض warn ⇒ هشدار');
    entitle(5000);
    const r = leaveService.validate(input(), { now: NOW });
    assert.deepEqual([r.ok, r.durationMinutes, r.errors.length, r.warnings.length], [true, 510, 0, 0]);
    assert.equal(leaveService.validate(input({ userId: 99999 }), { now: NOW }).errors[0].code, 'USER_NOT_FOUND');
    assert.equal(leaveService.validate(input({ unit: 'hour', startTime: '10:00', endTime: '12:00' }), { now: NOW }).errors[0].code, 'UNIT_NOT_ALLOWED');
    assert.equal(leaveService.validate(input({ startDate: D.fri, endDate: D.fri }), { now: NOW }).errors[0].code, 'NO_WORKING_TIME');
  });

  test('تداخل با درخواست pending/approved رد می‌شود؛ rejected مانعی نیست', () => {
    fresh();
    assert.equal(leaveService.create(input(), { now: NOW }).ok, true);
    assert.deepEqual(codes(leaveService.validate(input(), { now: NOW })), ['OVERLAP']);
    const other = fresh();
    const rej = leaveRepo.createLeaveRequest({ userId: other.id, startDate: D.wed, endDate: D.wed, leaveType: 'leave' });
    leaveRepo.setStatus(rej.id, 'rejected', null);
    assert.equal(leaveService.validate(input(), { now: NOW }).ok, true);
  });

  test('گذشته: پیش‌فرض آزاد؛ ممنوع؛ سقف روز گذشته؛ امروز گذشته حساب نمی‌شود', () => {
    fresh();
    const past = input({ startDate: D.sat, endDate: D.sat }); // ۲ روز قبل
    assert.equal(leaveService.validate(past, { now: NOW }).ok, true);
    settingsRepo.setValue('leaveMaxPastDays', 1);
    assert.deepEqual(codes(leaveService.validate(past, { now: NOW })), ['PAST_TOO_FAR']);
    assert.equal(leaveService.validate(input({ startDate: D.sun, endDate: D.sun }), { now: NOW }).ok, true, 'یک روز قبل در سقف');
    settingsRepo.setValue('leaveAllowPastRequests', false);
    assert.deepEqual(codes(leaveService.validate(past, { now: NOW })), ['PAST_NOT_ALLOWED']);
    assert.equal(leaveService.validate(input({ startDate: D.mon, endDate: D.mon }), { now: NOW }).ok, true, 'امروز');
    assert.equal(leaveService.validate(past, { now: NOW, skip: ['past'] }).ok, true);
  });

  test('آینده و حداقل پیش‌اطلاع (روزانه از ابتدای روز؛ ساعتی از ساعت شروع)', () => {
    fresh();
    settingsRepo.setValue('leaveMaxFutureDays', 1);
    assert.deepEqual(codes(leaveService.validate(input(), { now: NOW })), ['FUTURE_TOO_FAR']); // ۲ روز بعد
    assert.equal(leaveService.validate(input({ startDate: D.tue, endDate: D.tue }), { now: NOW }).ok, true);
    assert.equal(leaveService.validate(input(), { now: NOW, skip: ['future'] }).ok, true);

    fresh();
    settingsRepo.setValue('leaveMinNoticeHours', 24);
    // سه‌شنبه ۰۰:۰۰ = ۱۴ ساعت بعد از دوشنبه ۱۰:۰۰ ⇒ کم؛ چهارشنبه ۰۰:۰۰ = ۳۸ ساعت ⇒ کافی
    assert.deepEqual(codes(leaveService.validate(input({ startDate: D.tue, endDate: D.tue }), { now: NOW })), ['INSUFFICIENT_NOTICE']);
    assert.equal(leaveService.validate(input(), { now: NOW }).ok, true);
    assert.equal(leaveService.validate(input({ startDate: D.tue, endDate: D.tue }), { now: NOW, skip: ['notice'] }).ok, true);
    // گذشته/امروز مشمول پیش‌اطلاع نیستند
    assert.equal(leaveService.validate(input({ startDate: D.sun, endDate: D.sun }), { now: NOW }).ok, true);
  });

  test('سقف روز متوالی نوع (روزهای تقویمی)', () => {
    fresh();
    sick = leaveTypesRepo.createLeaveType({ code: 'sick_t', title: 'استعلاجی', kind: 'leave', isPaid: true, requiresAttachment: false, countsAgainstBalance: false, allowedUnits: ['day'], maxConsecutiveDays: 3, isActive: true });
    const r = leaveService.validate({ userId: emp.id, leaveTypeId: sick.id, startDate: D.sat, endDate: D.tue }, { now: NOW }); // ۴ روز تقویمی
    assert.deepEqual(codes(r), ['MAX_CONSECUTIVE_EXCEEDED']);
    assert.equal(r.errors[0].requestedDays, 4);
    assert.equal(leaveService.validate({ userId: emp.id, leaveTypeId: sick.id, startDate: D.sat, endDate: D.mon }, { now: NOW }).ok, true);
    assert.equal(leaveService.validate({ userId: emp.id, leaveTypeId: sick.id, startDate: D.sat, endDate: D.tue }, { now: NOW, skip: ['maxConsecutive'] }).ok, true);
  });

  test('سیاست مانده: block / warn / allow_negative و رزرو درخواست‌های در انتظار؛ نوع بدون مانده مستثنا', () => {
    fresh();
    entitle(600); // درخواست یک‌روزه = ۵۱۰
    assert.equal(leaveService.validate(input(), { now: NOW }).ok, true);
    // درخواست دوم همان روز نیست؛ روز دیگر: بعد از ثبت اولی مانده‌ی در دسترس ۹۰ است
    assert.equal(leaveService.create(input(), { now: NOW }).ok, true);
    const second = input({ startDate: D.thu, endDate: D.thu }); // پنجشنبه نیم‌روز = ۲۷۰
    settingsRepo.setValue('leaveBalancePolicy', 'block');
    const blocked = leaveService.validate(second, { now: NOW });
    assert.deepEqual(codes(blocked), ['INSUFFICIENT_BALANCE']);
    assert.equal(blocked.errors[0].shortfall, 270 - 90);
    settingsRepo.setValue('leaveBalancePolicy', 'warn');
    const warned = leaveService.validate(second, { now: NOW });
    assert.deepEqual([warned.ok, warned.warnings.map((w) => w.code), warned.warnings[0].shortfall], [true, ['LOW_BALANCE'], 180]);
    settingsRepo.setValue('leaveBalancePolicy', 'allow_negative');
    const neg = leaveService.validate(second, { now: NOW });
    assert.deepEqual([neg.ok, neg.warnings.length, neg.balance.remainingAfter], [true, 0, -180]);
    settingsRepo.setValue('leaveBalancePolicy', 'block');
    assert.equal(leaveService.validate(second, { now: NOW, skip: ['balance'] }).ok, true);
    const m = leaveTypesRepo.findByCode('mission');
    assert.equal(leaveService.validate({ userId: emp.id, leaveTypeId: m.id, startDate: D.sun, endDate: D.sun }, { now: NOW }).ok, true);
  });

  test('create: همه‌ی ستون‌های واحد/مدت ذخیره می‌شود؛ خطا ⇒ هیچ‌چیز نوشته نمی‌شود', () => {
    fresh();
    const types = leaveTypesRepo.listLeaveTypes();
    leaveTypesRepo.updateLeaveType(annual.id, { allowedUnits: ['day', 'half_day', 'hour'] });
    const half = leaveService.create(input({ unit: 'half_day', halfDayPart: 'morning', reason: 'کار شخصی' }), { now: NOW });
    assert.equal(half.ok, true);
    assert.deepEqual([half.request.unit, half.request.half_day_part, half.request.duration_minutes, half.request.status, half.request.reason], ['half_day', 'morning', 255, 'pending', 'کار شخصی']);
    const hourly = leaveService.create(input({ startDate: D.sun, endDate: D.sun, unit: 'hour', startTime: '10:00', endTime: '12:00' }), { now: NOW });
    assert.deepEqual([hourly.request.unit, hourly.request.start_time, hourly.request.end_time, hourly.request.duration_minutes], ['hour', '10:00', '12:00', 120]);
    const count = () => leaveRepo.listByUser(emp.id).length;
    const before = count();
    assert.equal(leaveService.create(input({ unit: 'half_day', halfDayPart: 'afternoon' }), { now: NOW }).ok, true, 'عصرِ همان روز با صبح تداخل ندارد');
    assert.equal(leaveService.create(input({ unit: 'half_day', halfDayPart: 'morning' }), { now: NOW }).ok, false);
    assert.equal(count(), before + 1);
    assert.throws(() => leaveService.validate(input(), { now: NOW, skip: ['x'] }), RangeError);
    assert.ok(types.length >= 2);
  });
});

// S4-9a: ledger مانده‌ی مرخصی — migration ۰۱۶، محاسبه (استحقاق + انتقالی + تعدیل − مصرف approved)، تعدیل دستی با دلیل و audit، سال شمسی.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const svc = require('../src/services/leaveBalanceService');
const leaveRepo = require('../src/repositories/leaveRepository');
const leaveTypesRepo = require('../src/repositories/leaveTypesRepository');
const auditRepo = require('../src/repositories/auditRepository');
const { jalaliYearOfDateString, jalaliYearToDateRange } = require('../src/utils/jalali');
const { makeUser } = require('./helpers/factories');

describe('ledger مانده (S4-9a)', () => {
  let admin; let emp; let annual; let mission;
  const Y = 1405; // ۲۰۲۶-۰۳-۲۱ تا ۲۰۲۷-۰۳-۲۰
  before(() => {
    resetDb();
    admin = makeUser({ role: 'admin' });
    emp = makeUser();
    annual = leaveTypesRepo.findByCode('annual');
    mission = leaveTypesRepo.findByCode('mission');
  });
  after(() => cleanup());
  const key = (o = {}) => ({ userId: emp.id, leaveTypeId: annual.id, jalaliYear: Y, ...o });
  const approved = (start, minutes, { type = 'leave', status = 'approved' } = {}) => {
    const r = leaveRepo.createLeaveRequest({ userId: emp.id, startDate: start, endDate: start, leaveType: type, durationMinutes: minutes });
    return leaveRepo.setStatus(r.id, status, null);
  };

  test('سال شمسی: مرز نوروز و بازه‌ی سال', () => {
    assert.equal(jalaliYearOfDateString('2026-03-20'), 1404);
    assert.equal(jalaliYearOfDateString('2026-03-21'), 1405);
    assert.equal(jalaliYearOfDateString('2026-02-30'), null);
    assert.deepEqual(jalaliYearToDateRange(1405), { from: '2026-03-21', to: '2027-03-20' });
  });

  test('بدون ردیف: همه صفر؛ نوعِ بدون کسر ⇒ tracked:false؛ ورودی نامعتبر', () => {
    const b = svc.getBalance(key());
    assert.deepEqual([b.ok, b.tracked, b.entitled, b.used, b.remaining], [true, true, 0, 0, 0]);
    assert.equal(svc.getBalance(key({ leaveTypeId: mission.id })).tracked, false);
    assert.equal(svc.getBalance(key({ userId: 99999 })).code, 'USER_NOT_FOUND');
    assert.equal(svc.getBalance(key({ leaveTypeId: 99999 })).code, 'TYPE_NOT_FOUND');
    assert.equal(svc.getBalance(key({ jalaliYear: 5 })).code, 'INVALID_YEAR');
  });

  test('محاسبه: استحقاق + انتقالی + تعدیل − فقط approved همان نوع و همان سال', () => {
    const s = svc.setEntitlement({ ...key(), entitledMinutes: 10000, carriedOverMinutes: 500, actor: admin.id, reason: 'استحقاق سال' });
    assert.equal(s.ok, true);
    approved('2026-04-01', 480);
    approved('2026-04-05', 960);
    approved('2026-05-01', 1000, { status: 'pending' }); // اثر ندارد
    approved('2026-05-02', 1000, { status: 'rejected' }); // اثر ندارد
    approved('2026-05-03', 300, { type: 'mission' }); // نوع دیگر
    approved('2026-03-01', 777); // سال ۱۴۰۴
    const b = svc.getBalance(key());
    assert.deepEqual([b.entitled, b.carriedOver, b.adjustments, b.used, b.usedCount, b.remaining], [10000, 500, 0, 1440, 2, 9060]);
    assert.equal(svc.getBalance(key({ jalaliYear: 1404 })).used, 777);
  });

  test('تعدیل دستی: دلیل اجباری، مقدار نامعتبر رد، audit ثبت، اثر در مانده، فقط‌افزودنی', () => {
    assert.equal(svc.addAdjustment({ ...key(), minutes: 60, actor: admin.id, reason: '  ' }).code, 'REASON_REQUIRED');
    for (const m of [0, 1.5, '5', NaN, null]) assert.equal(svc.addAdjustment({ ...key(), minutes: m, actor: admin.id, reason: 'x' }).code, 'INVALID_MINUTES');
    assert.equal(svc.addAdjustment({ ...key({ leaveTypeId: mission.id }), minutes: 60, actor: admin.id, reason: 'x' }).code, 'NOT_TRACKED');
    const a = svc.addAdjustment({ ...key(), minutes: -120, actor: admin.id, reason: 'کسر اشتباه قبلی' });
    assert.equal(a.ok, true);
    assert.equal(a.balance.adjustments, -120);
    assert.equal(a.balance.remaining, 9060 - 120);
    svc.addAdjustment({ ...key(), minutes: 480, actor: admin, reason: 'پاداش' });
    assert.equal(svc.getBalance(key()).adjustments, 360);
    const list = svc.listAdjustments(key()).adjustments;
    assert.deepEqual(list.map((x) => [x.minutes, x.actorId]), [[-120, admin.id], [480, admin.id]]);
    const logs = auditRepo.search({ entityType: 'leave_balance_adjustment' });
    assert.equal(logs.length, 2);
    assert.ok(logs.every((l) => l.user_id === admin.id && l.details.includes('"reason"')));
  });

  test('setEntitlement: نیمه‌کاره، ویرایش با before/after در audit، مقدار نامعتبر', () => {
    assert.equal(svc.setEntitlement({ ...key(), actor: admin.id, reason: 'x' }).code, 'NOTHING_TO_SET');
    assert.equal(svc.setEntitlement({ ...key(), entitledMinutes: -1, actor: admin.id, reason: 'x' }).code, 'INVALID_MINUTES');
    assert.equal(svc.setEntitlement({ ...key(), entitledMinutes: 100, actor: admin.id, reason: '' }).code, 'REASON_REQUIRED');
    const r = svc.setEntitlement({ ...key(), entitledMinutes: 12000, actor: admin.id, reason: 'اصلاح استحقاق' });
    assert.equal(r.balance.entitledMinutes, 12000);
    assert.equal(r.balance.carriedOverMinutes, 500, 'مقدار نداده‌شده حفظ می‌شود');
    const last = auditRepo.search({ entityType: 'leave_balance' })[0];
    const d = JSON.parse(last.details);
    assert.equal(d.reason, 'اصلاح استحقاق');
    assert.ok(JSON.stringify(d).includes('12000') && JSON.stringify(d).includes('10000'));
  });

  test('درخواست approved بدون duration_minutes شمرده نمی‌شود ولی گزارش می‌شود', () => {
    const u2 = makeUser();
    const r = leaveRepo.createLeaveRequest({ userId: u2.id, startDate: '2026-06-01', endDate: '2026-06-01', leaveType: 'leave' });
    leaveRepo.setStatus(r.id, 'approved', null);
    const b = svc.getBalance({ userId: u2.id, leaveTypeId: annual.id, jalaliYear: Y });
    assert.deepEqual([b.used, b.missingDuration, b.usedCount], [0, 1, 1]);
  });
});

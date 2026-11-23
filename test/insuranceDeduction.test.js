// کسر ماهانه‌ی حق بیمه: ذخیره در repository (حساس، بیرون از ردیف عمومی)، رسیدن به ردیف حقوق، و پر شدن در فیش.
const { resetDb } = require('./helpers/testEnv');
const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const usersRepository = require('../src/repositories/usersRepository');
const PS = require('../public-admin/js/payslip.js');

describe('کسر حق بیمه', () => {
  let id;
  before(() => {
    resetDb();
    id = usersRepository.createUser({ telegramUserId: '7101', fullName: 'کارمند بیمه', personnelCode: 'IN1', department: 'فنی', role: 'employee' }).id;
  });

  test('پیش‌فرض NULL؛ set/get و حذف', () => {
    assert.equal(usersRepository.getInsuranceDeductionToman(id), null);
    assert.equal(usersRepository.setInsuranceDeductionToman(id, 2500000), true);
    assert.equal(usersRepository.getInsuranceDeductionToman(id), 2500000);
    assert.equal(usersRepository.setInsuranceDeductionToman(id, null), true);
    assert.equal(usersRepository.getInsuranceDeductionToman(id), null);
    assert.equal(usersRepository.getInsuranceDeductionToman(999999), undefined);
  });

  test('در ردیف عمومی کاربر نمی‌آید', () => {
    usersRepository.setInsuranceDeductionToman(id, 2500000);
    for (const row of [usersRepository.findById(id), usersRepository.listUsers().find((u) => u.id === id), usersRepository.updateUser(id, { department: 'سایت' })]) {
      assert.equal(Object.prototype.hasOwnProperty.call(row, 'insurance_deduction_toman'), false);
    }
    assert.equal(usersRepository.getInsuranceDeductionToman(id), 2500000);
  });

  test('ردیف حقوق insuranceToman دارد', () => {
    const perf = require('../src/services/performanceService');
    const r = perf.monthlyPayroll({ users: [usersRepository.findById(id)], year: 1405, month: 9, now: '2026-12-31T12:00:00Z' });
    assert.equal(r.rows[0].insuranceToman, 2500000);
  });

  test('فیش: بیمه در «حق بیمه کارگری» پر و از خالص کم می‌شود', () => {
    const s = PS.buildSlip({ user: { id: 1, fullName: 'x' }, rateKt: 100, usefulMinutes: 12000, overtimeMinutes: 0, amountToman: 20000000, insuranceToman: 2500000 }, { month: 9, to: '2026-12-21' }, { isoToJalali: () => ({ jy: 1405, jm: 9, jd: 30 }) });
    assert.equal(s.insurance, 2500000);
    const mk = (kind, text) => ({ dataset: { kind }, textContent: text });
    const roles = { subs: { textContent: '' }, net: { textContent: '' }, paid: { textContent: '' } };
    const slip = { dataset: { base: String(s.amount) }, querySelectorAll: (sel) => (/"sub"/.test(sel) ? [mk('sub', PS.num(s.insurance))] : []), querySelector: (sel) => roles[/"(\w+)"/.exec(sel)[1]] || null };
    PS.recompute(slip, 541850, false);
    assert.equal(roles.net.textContent, PS.num(17500000));
    assert.equal(roles.subs.textContent, PS.num(2500000));
  });
});

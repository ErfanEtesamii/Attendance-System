// Phase 20 — نرخ ساعتی در لایه‌ی repository: هرگز در ردیف عمومی کاربر نیست؛ فقط با getHourlyRateKt/setHourlyRateKt.
const { resetDb } = require('./helpers/testEnv');
const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const usersRepository = require('../src/repositories/usersRepository');

describe('نرخ ساعتی — repository (Phase 20)', () => {
  let db; let id;
  before(() => {
    db = resetDb();
    id = usersRepository.createUser({ telegramUserId: '7001', fullName: 'کارمند نرخ', personnelCode: 'RT1', department: 'فنی', role: 'employee' }).id;
  });

  test('پیش‌فرض NULL؛ set/get درست کار می‌کند و null حذف می‌کند', () => {
    assert.equal(usersRepository.getHourlyRateKt(id), null);
    assert.equal(usersRepository.setHourlyRateKt(id, 120), true);
    assert.equal(usersRepository.getHourlyRateKt(id), 120);
    assert.equal(usersRepository.setHourlyRateKt(id, null), true);
    assert.equal(usersRepository.getHourlyRateKt(id), null);
    assert.equal(usersRepository.getHourlyRateKt(999999), undefined);
    assert.equal(usersRepository.setHourlyRateKt(999999, 5), false);
  });

  test('ردیف کاربر در findById/findByTelegramId/listUsers/updateUser/createUser ستون نرخ ندارد', () => {
    usersRepository.setHourlyRateKt(id, 155);
    const rows = [
      usersRepository.findById(id),
      usersRepository.findByTelegramId('7001'),
      usersRepository.listUsers().find((u) => u.id === id),
      usersRepository.updateUser(id, { department: 'سایت' }),
    ];
    for (const row of rows) {
      assert.ok(row);
      assert.equal(Object.prototype.hasOwnProperty.call(row, 'hourly_rate_kt'), false);
      assert.equal(JSON.stringify(row).includes('155'), false);
    }
    assert.equal(rows[3].department, 'سایت');
    assert.equal(usersRepository.getHourlyRateKt(id), 155); // updateUser نرخ را دست نمی‌زند
  });
});

// سقف اعتراض جدید در ماه (disputeMaxPerMonth، پیش‌فرض ۳) برای کارمند و سرپرست؛ ۰ = بدون سقف؛ ادامه‌ی اعتراض به این سقف نمی‌شمارد.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

describe('disputeService.create — سقف اعتراض جدید در ماه', () => {
  let db; let svc; let F; let emp; let mgr;
  before(() => {
    db = resetDb();
    F = require('./helpers/factories');
    svc = require('../src/services/disputeService');
    mgr = F.makeUser({ role: 'manager', name: 'سرپرست' });
    emp = F.makeUser({ name: 'کارمند', managerId: mgr.id });
  });
  after(cleanup);

  test('پیش‌فرض ۳: سه اعتراض مجاز، چهارم ⇒ NEW_DISPUTE_LIMIT با maxPerMonth', () => {
    assert.equal(require('../src/repositories/settingsRepository').getAll().disputeMaxPerMonth, 3);
    for (let i = 0; i < 3; i += 1) assert.equal(svc.create(emp, { message: `اعتراض ${i}` }).ok, true);
    const r = svc.create(emp, { message: 'چهارم' });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'NEW_DISPUTE_LIMIT');
    assert.equal(r.maxPerMonth, 3);
    assert.equal(svc.statusOf(r.code), 409);
  });

  test('سرپرست هم همان سقف را دارد و سقفِ هر کاربر مستقل است', () => {
    for (let i = 0; i < 3; i += 1) assert.equal(svc.create(mgr, { message: `س${i}` }).ok, true);
    assert.equal(svc.create(mgr, { message: 'چهارم' }).code, 'NEW_DISPUTE_LIMIT');
  });

  test('۰ ⇒ بدون سقف؛ تغییر سقف بدون ری‌استارت اعمال می‌شود', () => {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('dispute_max_per_month', '0')").run();
    assert.equal(svc.create(emp, { message: 'بدون سقف' }).ok, true);
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('dispute_max_per_month', '4')").run();
    assert.equal(svc.create(emp, { message: 'بیشتر از سقف' }).code, 'NEW_DISPUTE_LIMIT'); // ۵ تا ثبت شده
  });
});

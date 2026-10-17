// R5-۱ (فاز ۱۴): اسکوپ نقش‌ها برای بررسی دورکاری — خواندن (admin/hr همه، سرپرست تیم خودش) و تصمیم (admin/سرپرست؛ هیچ‌کس برای خودش).
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const F = require('./helpers/factories');

describe('اسکوپ بررسی دورکاری (R5-۱)', () => {
  let svc; let admin; let admin2; let hr; let boss; let otherBoss; let emp; let otherEmp; let inactive; let loose;

  before(() => {
    resetDb();
    svc = require('../src/services/remoteWorkAdminService');
    admin = F.makeUser({ role: 'admin' });
    admin2 = F.makeUser({ role: 'admin' });
    hr = F.makeUser({ role: 'hr' });
    boss = F.makeUser({ role: 'manager' });
    otherBoss = F.makeUser({ role: 'manager' });
    emp = F.makeUser({ managerId: boss.id });
    otherEmp = F.makeUser({ managerId: otherBoss.id });
    inactive = F.makeUser({ managerId: boss.id, active: false });
    loose = F.makeUser(); // بدون سرپرست
  });
  after(cleanup);

  const code = (r) => (r ? r.code : null);

  test('خواندن: admin و hr همه (از جمله سرپرست‌ها و بدون‌سرپرست)؛ سرپرست فقط کارمند مستقیمش', () => {
    for (const actor of [admin, hr]) {
      for (const t of [emp, otherEmp, boss, loose, inactive]) assert.equal(svc.readScopeFailure(actor, t), null, `${actor.role}→${t.id}`);
    }
    assert.equal(svc.readScopeFailure(boss, emp), null);
    assert.equal(svc.readScopeFailure(boss, inactive), null, 'کاربر غیرفعالِ تیم قابل مشاهده است');
    assert.equal(code(svc.readScopeFailure(boss, otherEmp)), 'NOT_IN_SCOPE');
    assert.equal(code(svc.readScopeFailure(boss, loose)), 'NOT_IN_SCOPE', 'manager_id خالی با هیچ سرپرستی برابر نیست');
    assert.equal(code(svc.readScopeFailure(boss, boss)), 'NOT_IN_SCOPE', 'سرپرست از مسیر صف خودش را نمی‌بیند');
  });

  test('خواندن: کارمند و نقش/ورودی ناشناخته ⇒ FORBIDDEN (۴۰۳)؛ کاربر ناموجود ⇒ USER_NOT_FOUND (۴۰۴)', () => {
    assert.equal(code(svc.readScopeFailure(emp, emp)), 'FORBIDDEN');
    assert.equal(svc.readScopeFailure(emp, emp).status, 403);
    assert.equal(code(svc.readScopeFailure({ id: 1, role: 'ناشناخته' }, emp)), 'FORBIDDEN');
    assert.equal(code(svc.readScopeFailure(null, emp)), 'FORBIDDEN');
    assert.equal(code(svc.readScopeFailure(undefined, emp)), 'FORBIDDEN');
    const nf = svc.readScopeFailure(admin, null);
    assert.equal(nf.code, 'USER_NOT_FOUND');
    assert.equal(nf.status, 404);
  });

  test('تصمیم: admin همه‌ی کاربران به‌جز خودش؛ سرپرست فقط کارمند مستقیمش', () => {
    for (const t of [emp, otherEmp, boss, loose, inactive, admin2]) assert.equal(svc.reviewScopeFailure(admin, t), null, `admin→${t.id}`);
    assert.equal(svc.reviewScopeFailure(boss, emp), null);
    assert.equal(svc.reviewScopeFailure(boss, inactive), null);
    assert.equal(code(svc.reviewScopeFailure(boss, otherEmp)), 'NOT_IN_SCOPE');
    assert.equal(code(svc.reviewScopeFailure(boss, otherBoss)), 'NOT_IN_SCOPE', 'سرپرستِ هم‌رده را سرپرست دیگر تأیید نمی‌کند');
    assert.equal(code(svc.reviewScopeFailure(boss, loose)), 'NOT_IN_SCOPE');
  });

  test('تصمیم: خود ⇒ SELF_NOT_ALLOWED برای همه‌ی نقش‌های دارای مجوز (حتی admin)؛ hr و کارمند ⇒ FORBIDDEN', () => {
    assert.equal(code(svc.reviewScopeFailure(admin, admin)), 'SELF_NOT_ALLOWED');
    assert.equal(code(svc.reviewScopeFailure(boss, boss)), 'SELF_NOT_ALLOWED');
    assert.equal(svc.reviewScopeFailure(boss, boss).status, 403);
    assert.equal(code(svc.reviewScopeFailure(hr, emp)), 'FORBIDDEN', 'hr فقط خواندن');
    assert.equal(code(svc.reviewScopeFailure(hr, hr)), 'FORBIDDEN');
    assert.equal(code(svc.reviewScopeFailure(emp, emp)), 'FORBIDDEN');
    assert.equal(code(svc.reviewScopeFailure(emp, otherEmp)), 'FORBIDDEN');
    assert.equal(code(svc.reviewScopeFailure(null, emp)), 'FORBIDDEN');
    assert.equal(code(svc.reviewScopeFailure(admin, null)), 'USER_NOT_FOUND');
  });

  test('اسکوپ صف: admin/hr ⇒ null (همه)؛ سرپرست ⇒ شناسه‌ی کارمندان مستقیم؛ تیم خالی ⇒ آرایه‌ی خالی؛ کارمند ⇒ FORBIDDEN', () => {
    assert.deepEqual(svc.queueScope(admin), { ok: true, userIds: null });
    assert.deepEqual(svc.queueScope(hr), { ok: true, userIds: null });
    const b = svc.queueScope(boss);
    assert.equal(b.ok, true);
    assert.deepEqual([...b.userIds].sort((x, y) => x - y), [emp.id, inactive.id].sort((x, y) => x - y));
    assert.ok(!b.userIds.includes(otherEmp.id) && !b.userIds.includes(boss.id));
    const lonely = F.makeUser({ role: 'manager' });
    assert.deepEqual(svc.queueScope(lonely), { ok: true, userIds: [] });
    assert.equal(svc.queueScope(emp).code, 'FORBIDDEN');
    assert.equal(svc.queueScope(null).code, 'FORBIDDEN');
  });

  test('checkRead / checkReview: کاربر را از دیتابیس می‌خوانند؛ شناسه‌ی نامعتبر یا ناموجود ⇒ USER_NOT_FOUND', () => {
    const r = svc.checkReview(boss, String(emp.id));
    assert.equal(r.ok, true);
    assert.equal(r.target.id, emp.id);
    assert.equal(svc.checkRead(hr, loose.id).ok, true);
    assert.equal(svc.checkRead(admin, 999999).code, 'USER_NOT_FOUND');
    assert.equal(svc.checkReview(admin, 'abc').code, 'USER_NOT_FOUND');
    assert.equal(svc.checkReview(boss, otherEmp.id).code, 'NOT_IN_SCOPE');
    assert.equal(svc.checkReview(hr, emp.id).code, 'FORBIDDEN');
  });
});

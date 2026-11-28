// هدف فروش ماهانه + تشویقی: مجوز (ادمین/مالک یا مدیر مستقیم)، اعتبارسنجی، پیشرفت، حذف، اعلان رسیدن به هدف (یک‌بار).
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

describe('commissionService — هدف فروش ماهانه', () => {
  let db; let svc; let F; let owner; let mgr; let other; let emp; let ym;
  before(() => {
    db = resetDb();
    F = require('./helpers/factories');
    svc = require('../src/services/commissionService');
    const { toJalaliFromDate } = require('../src/utils/jalali');
    ym = toJalaliFromDate(new Date());
    owner = F.makeUser({ role: 'owner', name: 'مالک' });
    mgr = F.makeUser({ role: 'manager', name: 'سرپرست' });
    other = F.makeUser({ role: 'manager', name: 'سرپرست دیگر' });
    emp = F.makeUser({ name: 'کارشناس', managerId: mgr.id });
    db.prepare("UPDATE users SET didar_email = 'sale@example.com' WHERE id = ?").run(emp.id);
  });
  after(cleanup);

  test('مدیر مستقیم می‌تواند هدف بگذارد؛ سرپرست دیگر ۴۰۳؛ مالک مجاز', () => {
    assert.equal(svc.setTarget(other, emp.id, { jy: ym.jy, jm: ym.jm, targetToman: 500000000 }).status, 403);
    const r = svc.setTarget(mgr, emp.id, { jy: ym.jy, jm: ym.jm, targetToman: 500000000, rewardToman: 5000000, rewardNote: 'یک روز مرخصی' });
    assert.equal(r.ok, true);
    assert.equal(r.target.targetToman, 500000000);
    assert.equal(r.target.rewardToman, 5000000);
    assert.equal(r.target.rewardText, 'یک روز مرخصی');
    assert.equal(r.target.progress, 0);
    assert.equal(r.target.achieved, false);
    assert.equal(svc.setTarget(owner, emp.id, { jy: ym.jy, jm: ym.jm, targetToman: 600000000 }).ok, true);
  });

  test('اعتبارسنجی: مبلغ هدف مثبت، ماه معتبر، کارمند ناموجود ⇒ ۴۰۴', () => {
    assert.equal(svc.setTarget(mgr, emp.id, { targetToman: 0 }).code, 'VALIDATION');
    assert.equal(svc.setTarget(mgr, emp.id, { targetToman: 'abc' }).code, 'VALIDATION');
    assert.equal(svc.setTarget(mgr, emp.id, { targetToman: 100, rewardToman: -5 }).code, 'VALIDATION');
    assert.equal(svc.setTarget(mgr, emp.id, { targetToman: 100, jy: 1200, jm: 1 }).code, 'VALIDATION');
    assert.equal(svc.setTarget(mgr, 999999, { targetToman: 100 }).status, 404);
  });

  test('پیشرفت از روی فروش همان ماه؛ myCommission هدف را برای بازه‌ی یک‌ماهه برمی‌گرداند', () => {
    const { jalaliMonthRangeOf } = require('../src/utils/jalali');
    const r = jalaliMonthRangeOf(ym.jy, ym.jm);
    db.prepare("INSERT INTO sales_deals (didar_id, code, title, customer, owner_email, owner_name, won_at, price_rial, items_json) VALUES ('t1','1','d','c','sale@example.com','x', ?, 0, ?)")
      .run(`${r.from}T09:00:00.000Z`, JSON.stringify([{ Title: 'a', UnitPrice: 2500000000, Quantity: 1, Discount: 0, DiscountPercent: 0 }])); // ۲۵۰ میلیون تومان
    const c = svc.myCommission({ id: emp.id, didar_email: 'sale@example.com' }, { from: r.from, to: r.to });
    assert.ok(c.target);
    assert.equal(c.target.salesToman, 250000000);
    assert.equal(c.target.progress, 41); // ۲۵۰ از ۶۰۰ (هدف آخرین ویرایش مالک)
    assert.equal(c.targetMonth.jm, ym.jm);
    const season = svc.myCommission({ id: emp.id, didar_email: 'sale@example.com' }, { from: '2020-01-01', to: '2030-01-01' });
    assert.equal(season.target, null);
    assert.equal(season.targetMonth, null);
  });

  test('رسیدن به هدف ⇒ achieved؛ اعلان فقط یک‌بار به کارمند و مدیر؛ حذف هدف', async () => {
    const before = svc.myCommission({ id: emp.id, didar_email: 'sale@example.com' }, { jy: ym.jy, jm: ym.jm });
    svc.setTarget(mgr, emp.id, { jy: ym.jy, jm: ym.jm, targetToman: 200000000, rewardToman: 3000000, rewardNote: '' });
    const c = svc.myCommission({ id: emp.id, didar_email: 'sale@example.com' }, { jy: ym.jy, jm: ym.jm });
    assert.equal(c.target.achieved, true);
    assert.equal(c.totals.targetRewardToman, 3000000);
    assert.equal(c.totals.commissionToman, c.totals.dealsCommissionToman + 3000000, 'مبلغ تشویقی به پورسانت ماه اضافه می‌شود');
    assert.equal(c.totals.dealsCommissionToman, before.totals.commissionToman - before.totals.targetRewardToman);
    assert.ok(c.season.commissionToman >= 3000000);
    assert.equal(c.target.rewardText, require('../src/utils/motivation').pickMotivation(emp.id, ym.jy, ym.jm), 'بدون جمله‌ی اختصاصی، جمله‌ی انگیزشیِ خودکار می‌آید');
    svc.setTarget(mgr, emp.id, { jy: ym.jy, jm: ym.jm, targetToman: 200000000, rewardToman: 3000000, rewardNote: 'شام دسته‌جمعی' });
    assert.equal(svc.myCommission({ id: emp.id, didar_email: 'sale@example.com' }, { jy: ym.jy, jm: ym.jm }).target.rewardText, 'شام دسته‌جمعی');
    // هدف نرسیده ⇒ تشویقی اضافه نمی‌شود
    svc.setTarget(mgr, emp.id, { jy: ym.jy, jm: ym.jm, targetToman: 900000000, rewardToman: 3000000 });
    const miss = svc.myCommission({ id: emp.id, didar_email: 'sale@example.com' }, { jy: ym.jy, jm: ym.jm });
    assert.equal(miss.totals.targetRewardToman, 0);
    assert.equal(miss.totals.commissionToman, miss.totals.dealsCommissionToman);
    svc.setTarget(mgr, emp.id, { jy: ym.jy, jm: ym.jm, targetToman: 200000000, rewardToman: 3000000 });
    const sent = [];
    const notifySvc = require('../src/services/salesNotifyService');
    const n1 = await notifySvc.announceTargets({ sendTelegram: async (...a) => { sent.push(a); return { ok: true }; } });
    assert.equal(n1, 1);
    const n2 = await notifySvc.announceTargets({ sendTelegram: async () => ({ ok: true }) });
    assert.equal(n2, 0, 'اعلان تکراری نباید ارسال شود');
    const rows = db.prepare("SELECT user_id FROM notifications WHERE type = 'sales_target_reached' ORDER BY user_id").all();
    assert.deepEqual(rows.map((x) => x.user_id).sort(), [emp.id, mgr.id].sort());
    assert.equal(svc.removeTarget(mgr, emp.id, { jy: ym.jy, jm: ym.jm }).removed, true);
    assert.equal(svc.removeTarget(mgr, emp.id, { jy: ym.jy, jm: ym.jm }).removed, false);
  });
});

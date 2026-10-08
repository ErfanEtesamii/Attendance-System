// S4-11b: جانشین مرخصی (ستون substitute_user_id) و اعلان‌ها — جانشین پس از تأیید قطعی، تأییدکننده‌ی مرحله‌ی بعد پس از تأیید میانی، بدون اعلان تکراری، اعتبارسنجی جانشین.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

describe('جانشین و اعلان‌های مرخصی (S4-11b)', () => {
  let db; let U; let annual; let leaveService; let approvals; let events; let settingsRepo; let leaveRepo;
  before(() => {
    db = resetDb();
    const F = require('./helpers/factories');
    leaveService = require('../src/services/leaveService');
    approvals = require('../src/services/leaveApprovalService');
    events = require('../src/services/notificationEvents');
    settingsRepo = require('../src/repositories/settingsRepository');
    leaveRepo = require('../src/repositories/leaveRepository');
    annual = require('../src/repositories/leaveTypesRepository').findByCode('annual');
    const manager = F.makeUser({ role: 'manager' });
    U = {
      admin: F.makeUser({ role: 'admin' }), admin2: F.makeUser({ role: 'admin' }), hr: F.makeUser({ role: 'hr' }), manager,
      emp: F.makeUser({ managerId: manager.id }), sub: F.makeUser(), off: F.makeUser(),
    };
  });
  after(() => cleanup());

  const notes = (userId, type) => db.prepare('SELECT * FROM notifications WHERE user_id = ? AND type = ? ORDER BY id').all(userId, type);
  let n = 0;
  const create = (extra = {}, span = 1) => {
    n += 1;
    const start = new Date(Date.UTC(2027, 8, 4 + n * 14));
    const end = new Date(start.getTime() + (span - 1) * 86400000);
    const iso = (d) => d.toISOString().slice(0, 10);
    return leaveService.create({ userId: U.emp.id, leaveTypeId: annual.id, startDate: iso(start), endDate: iso(end), ...extra });
  };

  test('ذخیره‌ی جانشین و اعتبارسنجی: ناموجود/غیرفعال/خود کارمند/جانشینِ در مرخصی تأییدشده', () => {
    const ok = create({ substituteUserId: U.sub.id });
    assert.equal(ok.ok, true);
    assert.equal(ok.request.substitute_user_id, U.sub.id);
    assert.equal(create({}).request.substitute_user_id, null);
    assert.equal(create({ substituteUserId: 999999 }).errors[0].code, 'SUBSTITUTE_NOT_FOUND');
    assert.equal(create({ substituteUserId: U.emp.id }).errors[0].code, 'SUBSTITUTE_IS_SELF');
    db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(U.off.id);
    assert.equal(create({ substituteUserId: U.off.id }).errors[0].code, 'SUBSTITUTE_NOT_FOUND');

    // جانشینی که همان روز مرخصی تأییدشده دارد (روز تازه تا با درخواست‌های خود کارمند تداخل نخورد)
    const busy = leaveRepo.createLeaveRequest({ userId: U.sub.id, startDate: '2031-03-01', endDate: '2031-03-01', leaveType: 'leave' });
    leaveRepo.setStatus(busy.id, 'approved', U.admin.id);
    const clash = leaveService.validate({ userId: U.emp.id, leaveTypeId: annual.id, startDate: '2031-03-01', endDate: '2031-03-01', substituteUserId: U.sub.id });
    assert.deepEqual(clash.errors.map((e) => e.code), ['SUBSTITUTE_UNAVAILABLE']);
    const pendingOnly = leaveRepo.createLeaveRequest({ userId: U.off.id, startDate: '2030-01-05', endDate: '2030-01-05', leaveType: 'leave' });
    assert.ok(pendingOnly.id, 'جانشین با درخواست pending مانعی ندارد (فقط approved)');
  });

  test('جانشین فقط پس از «تأیید قطعی» اعلان می‌گیرد؛ رد ⇒ نه؛ فراخوانی دوباره تکراری نمی‌سازد', async () => {
    const a = create({ substituteUserId: U.sub.id }).request;
    assert.equal(notes(U.sub.id, 'leave_substitute').length, 0, 'با ثبت درخواست هنوز اعلان نیست');
    const res = approvals.decide({ requestId: a.id, actor: U.manager, decision: 'approve' });
    await events.leaveDecided(res.request);
    const got = notes(U.sub.id, 'leave_substitute');
    assert.equal(got.length, 1);
    assert.match(got[0].title, /جانشین/);
    await events.leaveDecided(res.request);
    assert.equal(notes(U.sub.id, 'leave_substitute').length, 1, 'dedupe');

    const b = create({ substituteUserId: U.sub.id }).request;
    const rej = approvals.decide({ requestId: b.id, actor: U.manager, decision: 'reject' });
    await events.leaveDecided(rej.request);
    assert.equal(notes(U.sub.id, 'leave_substitute').length, 1, 'رد ⇒ جانشین خبر نمی‌شود');
  });

  test('تأیید مرحله‌ی میانی ⇒ اعلان به همه‌ی ادمین‌های فعال (و فقط آن‌ها)؛ کارمند و سرپرست نه؛ مرحله‌ی hr ⇒ hrها', async () => {
    settingsRepo.setValue('leaveApprovalExtraStepTypes', 'annual');
    const r = create({}).request;
    assert.deepEqual(notes(U.admin.id, 'leave_requested').filter((x) => x.data.includes(`"requestId":${r.id}`)), [], 'مرحله‌ی ۱ سرپرست است نه ادمین');
    const s1 = approvals.decide({ requestId: r.id, actor: U.manager, decision: 'approve' });
    assert.equal(s1.completed, false);
    await events.leaveStepAdvanced(s1.request);
    for (const a of [U.admin, U.admin2]) {
      const mine = notes(a.id, 'leave_requested').filter((x) => x.data.includes(`"requestId":${r.id}`));
      assert.equal(mine.length, 1, `admin ${a.id}`);
      assert.match(mine[0].body, /مرحله 2/);
    }
    assert.equal(notes(U.emp.id, 'leave_requested').length, 0);
    await events.leaveStepAdvanced(s1.request);
    assert.equal(notes(U.admin.id, 'leave_requested').filter((x) => x.data.includes(`"requestId":${r.id}`)).length, 1, 'dedupe');

    settingsRepo.setValue('leaveApprovalExtraStepRole', 'hr');
    const h = create({}).request;
    const hs = approvals.decide({ requestId: h.id, actor: U.manager, decision: 'approve' });
    await events.leaveStepAdvanced(hs.request);
    assert.equal(notes(U.hr.id, 'leave_requested').filter((x) => x.data.includes(`"requestId":${h.id}`)).length, 1);
    assert.equal(notes(U.admin.id, 'leave_requested').filter((x) => x.data.includes(`"requestId":${h.id}`)).length, 0);
    // رویداد برای درخواست نهایی/بدون زنجیره بی‌اثر است
    const done = approvals.decide({ requestId: r.id, actor: U.admin, decision: 'approve' });
    assert.equal(done.completed, true);
    assert.deepEqual(await events.leaveStepAdvanced(done.request), []);
    settingsRepo.resetValue('leaveApprovalExtraStepTypes');
    settingsRepo.resetValue('leaveApprovalExtraStepRole');
  });
});

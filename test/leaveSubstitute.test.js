// S4-11b: جانشین مرخصی (ستون substitute_user_id) و اعلان‌ها — جانشین پس از تأیید قطعی، اعلان به سرپرست/ادمین‌ها هنگام ثبت و پس از تصمیم سرپرست، بدون اعلان تکراری، اعتبارسنجی جانشین.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

describe('جانشین و اعلان‌های مرخصی (S4-11b)', () => {
  let db; let U; let annual; let leaveService; let approvals; let events; let leaveRepo;
  before(() => {
    db = resetDb();
    const F = require('./helpers/factories');
    leaveService = require('../src/services/leaveService');
    approvals = require('../src/services/leaveApprovalService');
    events = require('../src/services/notificationEvents');
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

  test('اعلان‌ها: ثبت ⇒ سرپرست و همه‌ی ادمین‌ها؛ تصمیم سرپرست ⇒ کارمند (با نام) + ادمین‌ها (با علت)؛ تصمیم ادمین ⇒ ادمین‌ها خبر نمی‌شوند', async () => {
    const mine = (userId, type, id) => notes(userId, type).filter((x) => x.data.includes(`"requestId":${id}`));
    const r = create({}).request;
    await events.leaveRequested(r);
    for (const u of [U.manager, U.admin, U.admin2]) assert.equal(mine(u.id, 'leave_requested', r.id).length, 1, `گیرنده ${u.id}`);
    assert.equal(mine(U.emp.id, 'leave_requested', r.id).length, 0);
    assert.equal(mine(U.hr.id, 'leave_requested', r.id).length, 0);

    const res = approvals.decide({ requestId: r.id, actor: U.manager, decision: 'approve', note: 'موافقم' });
    assert.equal(res.completed, true);
    await events.leaveDecided(res.request, { note: 'موافقم' });
    const empNote = mine(U.emp.id, 'leave_approved', r.id)[0];
    assert.match(empNote.body, new RegExp(U.manager.full_name), 'کارمند نام تأییدکننده را می‌بیند');
    for (const a of [U.admin, U.admin2]) {
      const got = mine(a.id, 'leave_supervisor_decided', r.id);
      assert.equal(got.length, 1);
      assert.match(got[0].title, new RegExp(U.manager.full_name));
      assert.match(got[0].body, /موافقم/);
    }
    assert.equal(mine(U.manager.id, 'leave_supervisor_decided', r.id).length, 0);

    const r2 = create({}).request;
    const byAdmin = approvals.decide({ requestId: r2.id, actor: U.admin, decision: 'reject', note: 'ظرفیت' });
    await events.leaveDecided(byAdmin.request, { note: 'ظرفیت' });
    assert.equal(mine(U.emp.id, 'leave_rejected', r2.id).length, 1);
    assert.equal(mine(U.admin2.id, 'leave_supervisor_decided', r2.id).length, 0, 'تصمیم ادمین اعلان «سرپرست» ندارد');
  });
});

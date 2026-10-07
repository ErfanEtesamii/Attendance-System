// S4-7c: چک‌های 'leave'|'mission' به leave_types.kind منتقل شدند (نه ستون قدیمی leave_requests.leave_type)
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

describe('leaveRepository بر پایه‌ی kind (S4-7c)', () => {
  let db, repo, typesRepo, user;
  before(() => {
    db = resetDb();
    repo = require('../src/repositories/leaveRepository');
    typesRepo = require('../src/repositories/leaveTypesRepository');
    user = require('./helpers/factories').makeUser();
  });
  after(cleanup);

  const mkType = (code, kind) => typesRepo.createLeaveType({ code, title: code, kind, isPaid: true, requiresAttachment: false, countsAgainstBalance: false, allowedUnits: ['day'], maxConsecutiveDays: null, isActive: true });
  const mk = (typeId, date) => {
    const r = repo.createLeaveRequest({ userId: user.id, startDate: date, endDate: date, leaveTypeId: typeId, reason: 'تست' });
    return repo.setStatus(r.id, 'approved', null);
  };

  test('نوع سفارشی با kind خودش شمرده می‌شود و ردیف‌ها فیلد kind دارند', () => {
    const sick = mkType('sick', 'leave');
    const trip = mkType('trip', 'mission');
    const a = mk(sick.id, '2026-11-01');
    const b = mk(trip.id, '2026-11-02');
    assert.equal(a.kind, 'leave');
    assert.equal(b.kind, 'mission');
    assert.equal(repo.findById(a.id).kind, 'leave');
    assert.ok(repo.listAll().every((r) => ['leave', 'mission'].includes(r.kind)));
    assert.ok(repo.listByUser(user.id).every((r) => r.kind));
    assert.equal(repo.hasApprovedLeaveOnDate(user.id, '2026-11-01', 'leave'), true);
    assert.equal(repo.hasApprovedLeaveOnDate(user.id, '2026-11-01', 'mission'), false);
    assert.equal(repo.hasApprovedMissionOnDate(user.id, '2026-11-02'), true);
    assert.equal(repo.hasApprovedLeaveOnDate(user.id, '2026-11-02', 'leave'), false);
  });

  test('تصمیم فقط از kind می‌آید: ستون قدیمی leave_type دستکاری شود نتیجه عوض نمی‌شود؛ kind نامعتبر ⇒ Error؛ pending شمرده نمی‌شود', () => {
    const r = mk(typesRepo.findByCode('annual').id, '2026-11-05');
    db.prepare("UPDATE leave_requests SET leave_type = 'mission' WHERE id = ?").run(r.id); // ناهم‌خوان عمدی
    assert.equal(repo.hasApprovedLeaveOnDate(user.id, '2026-11-05', 'leave'), true);
    assert.equal(repo.hasApprovedMissionOnDate(user.id, '2026-11-05'), false);
    assert.equal(repo.findById(r.id).kind, 'leave');
    assert.throws(() => repo.hasApprovedLeaveOnDate(user.id, '2026-11-05', 'sick'), /kind/);
    const p = repo.createLeaveRequest({ userId: user.id, startDate: '2026-11-09', endDate: '2026-11-09', leaveType: 'mission' });
    assert.equal(p.status, 'pending');
    assert.equal(repo.hasApprovedMissionOnDate(user.id, '2026-11-09'), false);
  });
});

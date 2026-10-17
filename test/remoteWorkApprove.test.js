// R5-۴ (فاز ۱۴): تأیید تکی دورکاری — سطح سرویس (approve): اسکوپ، اعتبارسنجی، رکورد رسمی via_remote، انتقال استراحت، idempotent،
// اصلاح ساعت، هم‌پوشانی ساعت دو نشست، ONSITE_OVERLAP با rollback کامل و MONTH_CLOSED.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

describe('تأیید تکی دورکاری (R5-4)', () => {
  let db; let repo; let svc; let U; let mk; let F;
  const D = '2026-10-10';
  const now = new Date('2026-10-16T10:00:00Z');

  before(() => {
    db = resetDb();
    F = require('./helpers/factories');
    repo = require('../src/repositories/remoteWorkRepository');
    svc = require('../src/services/remoteWorkAdminService');
    const mgr = F.makeUser({ role: 'manager' });
    U = { mgr, other: F.makeUser({ role: 'manager' }), admin: F.makeUser({ role: 'admin' }), hr: F.makeUser({ role: 'hr' }), emp: F.makeUser({ managerId: mgr.id }) };
    mk = (u, d, s, e, br) => {
      const x = repo.insertSession({ userId: u.id, workDate: d, startAt: `${d}T${s}.000Z`, ip: '203.0.113.9' });
      if (br) { const b = repo.insertBreak(x.id, `${d}T${br[0]}.000Z`); repo.closeBreak(b.id, `${d}T${br[1]}.000Z`); }
      if (e) repo.closeSession(x.id, `${d}T${e}.000Z`);
      return x.id;
    };
  });
  after(() => cleanup());

  let a; let b;
  test('مجوز، اسکوپ و اعتبارسنجی ورودی', () => {
    a = mk(U.emp, D, '05:00:00', '09:00:00', ['06:00:00', '06:30:00']);
    b = mk(U.emp, D, '10:00:00', '12:00:00');
    assert.equal(svc.approve(U.hr, a, {}, { now }).code, 'FORBIDDEN');
    assert.equal(svc.approve(U.other, a, {}, { now }).code, 'NOT_IN_SCOPE');
    assert.equal(svc.approve(U.mgr, 9999, {}, { now }).code, 'SESSION_NOT_FOUND');
    assert.equal(svc.approve(U.mgr, a, { approvedEndAt: 'junk' }, { now }).code, 'INVALID_TIME');
    assert.equal(svc.approve(U.mgr, a, { approvedEndAt: '2026-10-10T04:00:00Z' }, { now }).code, 'INVALID_TIME');
    assert.equal(svc.approve(U.mgr, a, { approvedEndAt: '2026-10-17T04:00:00Z' }, { now }).code, 'INVALID_TIME'); // آینده
    assert.equal(svc.approve(U.mgr, a, { reviewNote: 'x'.repeat(501) }, { now }).code, 'INVALID_NOTE');
    assert.equal(repo.findSessionFull(a).status, 'pending');
  });

  test('تأیید: رکورد رسمی via_remote، استراحت منتقل، reviewed_* و یک audit؛ تکرار idempotent', () => {
    const r = svc.approve(U.mgr, a, { reviewNote: ' ok ' }, { ip: '10.0.0.1', now });
    assert.ok(r.ok && !r.alreadyApproved);
    const rec = db.prepare('SELECT * FROM attendance_records WHERE user_id = ?').all(U.emp.id);
    assert.equal(rec.length, 1);
    assert.equal(rec[0].via_remote, 1);
    assert.equal(rec[0].check_in_time, `${D}T05:00:00.000Z`);
    assert.equal(rec[0].check_out_time, `${D}T09:00:00.000Z`);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM break_records WHERE via_remote = 1').get().n, 1);
    const s = repo.findSessionFull(a);
    assert.deepEqual([s.status, s.reviewed_by, s.review_note, s.attendance_record_id], ['approved', U.mgr.id, 'ok', rec[0].id]);
    const again = svc.approve(U.mgr, a, {}, { now });
    assert.ok(again.ok && again.alreadyApproved);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM attendance_records WHERE user_id = ?').get(U.emp.id).n, 1);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action = 'remote_work_approve'").get().n, 1);
  });

  test('نشست دوم همان روز: هم‌پوشانی ⇒ TIME_CONFLICT؛ اصلاح ساعت ⇒ ادغام در همان رکورد با استراحتِ فاصله', () => {
    assert.equal(svc.approve(U.admin, b, { approvedStartAt: '2026-10-10T08:30:00Z' }, { now }).code, 'TIME_CONFLICT');
    assert.ok(svc.approve(U.admin, b, { approvedStartAt: '2026-10-10T10:30:00Z' }, { now }).ok);
    const rec = db.prepare('SELECT * FROM attendance_records WHERE user_id = ?').all(U.emp.id);
    assert.equal(rec.length, 1);
    assert.equal(rec[0].check_out_time, `${D}T12:00:00.000Z`);
    const brs = db.prepare('SELECT start_time, end_time FROM break_records ORDER BY start_time').all();
    assert.equal(brs.length, 2);
    assert.deepEqual([brs[1].start_time, brs[1].end_time], [`${D}T09:00:00.000Z`, `${D}T10:30:00.000Z`]);
    const s = repo.findSessionFull(b);
    assert.equal(s.approved_start_at, '2026-10-10T10:30:00.000Z');
  });

  test('خود، نشست باز، حضور حضوری (rollback کامل) و ماه بسته', () => {
    const own = mk(U.mgr, D, '05:00:00', '06:00:00');
    assert.equal(svc.approve(U.mgr, own, {}, { now }).code, 'SELF_NOT_ALLOWED');
    const e2 = F.makeUser({ managerId: U.mgr.id });
    assert.equal(svc.approve(U.mgr, mk(e2, D, '05:00:00', null), {}, { now }).code, 'SESSION_OPEN');

    const e3 = F.makeUser({ managerId: U.mgr.id });
    db.prepare("INSERT INTO attendance_records (user_id, record_date, check_in_time, status) VALUES (?, ?, ?, 'normal')").run(e3.id, '2026-10-09', '2026-10-09T05:00:00.000Z');
    const ov = mk(e3, '2026-10-09', '06:00:00', '08:00:00');
    assert.equal(svc.approve(U.mgr, ov, {}, { now }).code, 'ONSITE_OVERLAP');
    assert.equal(repo.findSessionFull(ov).status, 'pending');
    assert.equal(db.prepare('SELECT via_remote FROM attendance_records WHERE user_id = ?').get(e3.id).via_remote, 0);

    const e4 = F.makeUser({ managerId: U.mgr.id });
    const mc = mk(e4, '2026-09-05', '05:00:00', '07:00:00');
    db.prepare("INSERT INTO month_closures (jalali_year, jalali_month, period_from, period_to, status, close_count) VALUES (1405, 6, '2026-08-23', '2026-09-22', 'closed', 1)").run();
    assert.equal(svc.approve(U.mgr, mc, {}, { now }).code, 'MONTH_CLOSED');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM attendance_records WHERE user_id = ?').get(e4.id).n, 0);
  });
});

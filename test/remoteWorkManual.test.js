// ثبت دستی دورکاری توسط ادمین (createManual): فقط admin، دلیل الزامی، خود ممنوع، تأیید در یک تراکنش با rollback کامل در هر خطا،
// ادغام با حضور حضوری فقط با decision=merge، ماه بسته/آینده/۲۴ ساعت، audit.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

describe('ثبت دستی دورکاری توسط ادمین', () => {
  let db; let repo; let svc; let U;
  const D = '2026-10-10';
  const now = new Date('2026-10-16T10:00:00Z');
  const input = (over = {}) => ({ userId: U.emp.id, startAt: `${D}T05:00:00Z`, endAt: `${D}T09:00:00Z`, note: 'قطعی اینترنت دفتر', ...over });
  const count = (sql, ...a) => db.prepare(sql).get(...a).n;

  before(() => {
    db = resetDb();
    const F = require('./helpers/factories');
    repo = require('../src/repositories/remoteWorkRepository');
    svc = require('../src/services/remoteWorkAdminService');
    const mgr = F.makeUser({ role: 'manager' });
    U = { mgr, admin: F.makeUser({ role: 'admin' }), admin2: F.makeUser({ role: 'admin' }), hr: F.makeUser({ role: 'hr' }), emp: F.makeUser({ managerId: mgr.id }) };
  });
  after(() => cleanup());

  test('مجوز و اعتبارسنجی؛ هیچ ردیفی ساخته نمی‌شود', () => {
    assert.equal(svc.createManual(U.mgr, input(), { now }).code, 'FORBIDDEN');
    assert.equal(svc.createManual(U.hr, input(), { now }).code, 'FORBIDDEN');
    assert.equal(svc.createManual(U.admin, input({ userId: 99999 }), { now }).code, 'USER_NOT_FOUND');
    assert.equal(svc.createManual(U.admin, input({ userId: U.admin.id }), { now }).code, 'SELF_NOT_ALLOWED');
    assert.equal(svc.createManual(U.admin, input({ note: '  ' }), { now }).code, 'REVIEW_NOTE_REQUIRED');
    assert.equal(svc.createManual(U.admin, input({ note: 'x'.repeat(501) }), { now }).code, 'INVALID_NOTE');
    assert.equal(svc.createManual(U.admin, input({ endAt: `${D}T04:00:00Z` }), { now }).code, 'INVALID_TIME');
    assert.equal(svc.createManual(U.admin, input({ startAt: 'junk' }), { now }).code, 'INVALID_TIME');
    assert.equal(svc.createManual(U.admin, input({ endAt: '2026-10-17T04:00:00Z', startAt: '2026-10-17T01:00:00Z' }), { now }).code, 'INVALID_TIME'); // آینده
    assert.equal(svc.createManual(U.admin, input({ overlapDecision: 'keep_onsite' }), { now }).code, 'INVALID_DECISION');
    assert.equal(count('SELECT COUNT(*) n FROM remote_work_sessions'), 0);
    assert.equal(count('SELECT COUNT(*) n FROM attendance_records'), 0);
  });

  test('موفق: نشست approved + رکورد رسمی via_remote + audit؛ ثبت هم‌پوشان ⇒ TIME_CONFLICT با rollback کامل', () => {
    const r = svc.createManual(U.admin, input(), { ip: '10.0.0.1', now });
    assert.ok(r.ok, JSON.stringify(r));
    const s = repo.findSessionFull(r.session.id);
    assert.deepEqual([s.status, s.reviewed_by, s.review_note, s.user_id], ['approved', U.admin.id, 'قطعی اینترنت دفتر', U.emp.id]);
    const rec = db.prepare('SELECT * FROM attendance_records WHERE user_id = ?').all(U.emp.id);
    assert.equal(rec.length, 1);
    assert.equal(rec[0].via_remote, 1);
    assert.equal(count("SELECT COUNT(*) n FROM audit_log WHERE action = 'remote_work_manual_create'"), 1);
    const dup = svc.createManual(U.admin, input({ startAt: `${D}T08:00:00Z`, endAt: `${D}T11:00:00Z` }), { now });
    assert.equal(dup.code, 'TIME_CONFLICT');
    assert.equal(count('SELECT COUNT(*) n FROM remote_work_sessions WHERE user_id = ?', U.emp.id), 1, 'نشست ناموفق نمی‌ماند');
  });

  test('هم‌پوشانی با حضور حضوری: بدون تصمیم ⇒ ONSITE_OVERLAP و rollback؛ با merge ⇒ ادغام', () => {
    const F = require('./helpers/factories');
    const other = F.makeUser({ managerId: U.mgr.id });
    const day = '2026-10-11';
    db.prepare('INSERT INTO attendance_records (user_id, record_date, check_in_time, check_out_time, status) VALUES (?, ?, ?, ?, ?)')
      .run(other.id, day, `${day}T04:00:00.000Z`, `${day}T08:00:00.000Z`, 'normal');
    const base = { userId: other.id, startAt: `${day}T09:00:00Z`, endAt: `${day}T11:00:00Z`, note: 'ادامه‌ی کار در خانه' };
    assert.equal(svc.createManual(U.admin, base, { now }).code, 'ONSITE_OVERLAP');
    assert.equal(count('SELECT COUNT(*) n FROM remote_work_sessions WHERE user_id = ?', other.id), 0);
    const ok = svc.createManual(U.admin, { ...base, overlapDecision: 'merge' }, { now });
    assert.ok(ok.ok, JSON.stringify(ok));
    assert.equal(ok.outcome, 'merged');
  });
});

// R5-۵ تا R5-۷ (فاز ۱۴): رد با یادداشت اجباری و اعلان، تصمیم صریح در هم‌پوشانی با حضور حضوری (merge | keep_onsite)،
// تأیید دسته‌ای و جریان یکپارچه‌ی صف ⇒ تأیید/رد ⇒ رکورد رسمی. سطح سرویس (بدون HTTP).
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

describe('بررسی دورکاری: رد، هم‌پوشانی، دسته‌ای (R5-5..7)', () => {
  let db; let repo; let svc; let U; let mk; let F; let notes;
  const now = new Date('2026-10-16T10:00:00Z');
  const D1 = '2026-10-10'; const D2 = '2026-10-11'; const D3 = '2026-10-12';

  before(() => {
    db = resetDb();
    F = require('./helpers/factories');
    repo = require('../src/repositories/remoteWorkRepository');
    svc = require('../src/services/remoteWorkAdminService');
    const mgr = F.makeUser({ role: 'manager' });
    U = { mgr, other: F.makeUser({ role: 'manager' }), admin: F.makeUser({ role: 'admin' }), hr: F.makeUser({ role: 'hr' }), emp: F.makeUser({ managerId: mgr.id }), emp2: F.makeUser({ managerId: mgr.id }), outsider: F.makeUser({ managerId: null }) };
    mk = (u, d, s, e, br) => {
      const x = repo.insertSession({ userId: u.id, workDate: d, startAt: `${d}T${s}.000Z`, ip: '203.0.113.9' });
      if (br) { const b = repo.insertBreak(x.id, `${d}T${br[0]}.000Z`); repo.closeBreak(b.id, `${d}T${br[1]}.000Z`); }
      if (e) repo.closeSession(x.id, `${d}T${e}.000Z`);
      return x.id;
    };
    // اعلان‌ها را بدون تلگرام/شبکه می‌خوانیم: ردیف‌های notifications
    notes = (userId) => db.prepare("SELECT * FROM notifications WHERE user_id = ? AND type = 'remote_work_rejected'").all(userId);
  });
  after(() => cleanup());

  test('رد: یادداشت اجباری، اسکوپ، بدون رکورد رسمی، audit، اعلان و idempotent', async () => {
    const s = mk(U.emp, D1, '05:00:00', '09:00:00');
    assert.equal(svc.reject(U.mgr, s, {}, { now }).code, 'REVIEW_NOTE_REQUIRED');
    assert.equal(svc.reject(U.mgr, s, { reviewNote: '   ' }, { now }).code, 'REVIEW_NOTE_REQUIRED');
    assert.equal(svc.reject(U.hr, s, { reviewNote: 'x' }, { now }).code, 'FORBIDDEN');
    assert.equal(svc.reject(U.other, s, { reviewNote: 'x' }, { now }).code, 'NOT_IN_SCOPE');
    assert.equal(svc.reject(U.mgr, 9999, { reviewNote: 'x' }, { now }).code, 'SESSION_NOT_FOUND');
    assert.equal(repo.findSessionFull(s).status, 'pending');

    const r = svc.reject(U.mgr, s, { reviewNote: ' ساعت‌ها با تسک‌ها نمی‌خواند ' }, { ip: '10.0.0.5', now });
    assert.ok(r.ok && !r.alreadyRejected);
    const row = repo.findSessionFull(s);
    assert.deepEqual([row.status, row.reviewed_by, row.review_note, row.attendance_record_id], ['rejected', U.mgr.id, 'ساعت‌ها با تسک‌ها نمی‌خواند', null]);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM attendance_records WHERE user_id = ?').get(U.emp.id).n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action = 'remote_work_reject'").get().n, 1);
    await new Promise((res) => setTimeout(res, 50));
    assert.equal(notes(U.emp.id).length, 1);

    const again = svc.reject(U.mgr, s, { reviewNote: 'بار دوم' }, { now });
    assert.ok(again.ok && again.alreadyRejected);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action = 'remote_work_reject'").get().n, 1);
    assert.equal(svc.approve(U.mgr, s, {}, { now }).code, 'NOT_PENDING'); // ردشده تأیید نمی‌شود
  });

  test('رد: نشست باز یا تأییدشده قابل رد نیست؛ خود ممنوع', () => {
    const open = mk(U.emp2, D1, '05:00:00', null);
    assert.equal(svc.reject(U.mgr, open, { reviewNote: 'x' }, { now }).code, 'SESSION_OPEN');
    repo.closeSession(open, `${D1}T07:00:00.000Z`);
    assert.ok(svc.approve(U.mgr, open, {}, { now }).ok);
    assert.equal(svc.reject(U.mgr, open, { reviewNote: 'x' }, { now }).code, 'NOT_PENDING');
    const own = mk(U.mgr, D3, '05:00:00', '06:00:00');
    assert.equal(svc.reject(U.mgr, own, { reviewNote: 'x' }, { now }).code, 'SELF_NOT_ALLOWED');
  });

  function onsite(user, date, inT, outT) {
    db.prepare("INSERT INTO attendance_records (user_id, record_date, check_in_time, check_out_time, status) VALUES (?, ?, ?, ?, 'normal')")
      .run(user.id, date, `${date}T${inT}.000Z`, outT ? `${date}T${outT}.000Z` : null);
    return db.prepare('SELECT id FROM attendance_records WHERE user_id = ? AND record_date = ?').get(user.id, date).id;
  }

  test('هم‌پوشانی: بدون تصمیم ⇒ ONSITE_OVERLAP؛ تصمیم نامعتبر؛ بدون یادداشت؛ بدون هم‌پوشانی ⇒ NO_OVERLAP', () => {
    const u = F.makeUser({ managerId: U.mgr.id });
    onsite(u, D2, '04:30:00', '12:00:00');
    const s = mk(u, D2, '13:00:00', '15:00:00', ['14:00:00', '14:15:00']);
    assert.equal(svc.approve(U.mgr, s, {}, { now }).code, 'ONSITE_OVERLAP');
    assert.equal(svc.approve(U.mgr, s, { overlapDecision: 'bogus', reviewNote: 'n' }, { now }).code, 'INVALID_DECISION');
    assert.equal(svc.approve(U.mgr, s, { overlapDecision: 'merge' }, { now }).code, 'REVIEW_NOTE_REQUIRED');
    assert.equal(repo.findSessionFull(s).status, 'pending');
    const clean = mk(U.emp, D3, '05:00:00', '06:00:00');
    assert.equal(svc.approve(U.mgr, clean, { overlapDecision: 'merge', reviewNote: 'n' }, { now }).code, 'NO_OVERLAP');
  });

  test('merge: اجتماع بازه‌ها روی رکورد حضوری، استراحت فاصله و استراحت‌های دورکاری؛ دو audit؛ idempotent', () => {
    const u = F.makeUser({ managerId: U.mgr.id });
    const recId = onsite(u, D2, '04:30:00', '12:00:00');
    const s = mk(u, D2, '13:00:00', '15:00:00', ['14:00:00', '14:15:00']);
    const r = svc.approve(U.mgr, s, { overlapDecision: 'merge', reviewNote: 'کار شبانه بعد از ظهر' }, { ip: '10.0.0.7', now });
    assert.ok(r.ok && r.outcome === 'merged' && r.attendanceRecordId === recId);
    const rec = db.prepare('SELECT * FROM attendance_records WHERE id = ?').get(recId);
    assert.equal(rec.via_remote, 0); // رکورد حضوری می‌ماند
    assert.equal(rec.check_in_time, `${D2}T04:30:00.000Z`);
    assert.equal(rec.check_out_time, `${D2}T15:00:00.000Z`);
    const brs = db.prepare('SELECT start_time, end_time, via_remote FROM break_records WHERE attendance_record_id = ? ORDER BY start_time').all(recId);
    assert.deepEqual(brs.map((b) => [b.start_time.slice(11, 16), b.end_time.slice(11, 16), b.via_remote]), [['12:00', '13:00', 1], ['14:00', '14:15', 1]]);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action = 'remote_work_overlap_decision' AND user_id = ?").get(U.mgr.id).n, 1);
    const again = svc.approve(U.mgr, s, { overlapDecision: 'merge', reviewNote: 'n' }, { now });
    assert.ok(again.ok && again.alreadyApproved);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM break_records WHERE attendance_record_id = ?').get(recId).n, 2);
  });

  test('merge: خروج حضوری ثبت‌نشده ⇒ ONSITE_NOT_CLOSED و هیچ تغییری', () => {
    const u = F.makeUser({ managerId: U.mgr.id });
    const recId = onsite(u, D2, '04:30:00', null);
    const s = mk(u, D2, '13:00:00', '15:00:00');
    assert.equal(svc.approve(U.mgr, s, { overlapDecision: 'merge', reviewNote: 'n' }, { now }).code, 'ONSITE_NOT_CLOSED');
    assert.equal(repo.findSessionFull(s).status, 'pending');
    assert.equal(db.prepare('SELECT check_out_time FROM attendance_records WHERE id = ?').get(recId).check_out_time, null);
  });

  test('keep_onsite: نشست رد می‌شود، رکورد حضوری دست‌نخورده، اعلان و audit', async () => {
    const u = F.makeUser({ managerId: U.mgr.id });
    const recId = onsite(u, D2, '04:30:00', '12:00:00');
    const s = mk(u, D2, '06:00:00', '10:00:00');
    const r = svc.approve(U.admin, s, { overlapDecision: 'keep_onsite', reviewNote: 'همان ساعت‌ها حضوری بوده' }, { now });
    assert.ok(r.ok && r.outcome === 'rejected');
    const row = repo.findSessionFull(s);
    assert.equal(row.status, 'rejected');
    assert.ok(row.review_note.includes('همان ساعت‌ها حضوری بوده'));
    const rec = db.prepare('SELECT * FROM attendance_records WHERE id = ?').get(recId);
    assert.deepEqual([rec.check_in_time, rec.check_out_time], [`${D2}T04:30:00.000Z`, `${D2}T12:00:00.000Z`]);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM break_records WHERE attendance_record_id = ?').get(recId).n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action IN ('remote_work_reject', 'remote_work_overlap_decision') AND user_id = ?").get(U.admin.id).n, 2);
    await new Promise((res) => setTimeout(res, 50));
    assert.equal(notes(u.id).length, 1);
  });

  test('تأیید دسته‌ای: scope الزامی، اسکوپ، رد شدن‌ها در skipped، idempotent', () => {
    const t = F.makeUser({ managerId: U.mgr.id }); // کارمند تازه با نشست‌های مخصوص این تست
    const a = mk(t, '2026-10-05', '05:00:00', '09:00:00');
    const b = mk(t, '2026-10-06', '05:00:00', '09:00:00');
    const week2 = mk(t, '2026-10-14', '05:00:00', '09:00:00');
    onsite(t, '2026-10-07', '04:00:00', '10:00:00');
    const ov = mk(t, '2026-10-07', '11:00:00', '13:00:00');
    const open = mk(F.makeUser({ managerId: U.mgr.id }), '2026-10-06', '05:00:00', null);

    assert.equal(svc.approveBatch(U.mgr, {}, { now }).code, 'BATCH_SCOPE_REQUIRED');
    assert.equal(svc.approveBatch(U.hr, { userId: t.id }, { now }).code, 'FORBIDDEN');
    assert.equal(svc.approveBatch(U.other, { userId: t.id }, { now }).code, 'NOT_IN_SCOPE');
    assert.equal(svc.approveBatch(U.mgr, { week: 'نامعتبر' }, { now }).code, 'INVALID_WEEK');
    assert.equal(svc.approveBatch(U.mgr, { userId: U.mgr.id }, { now }).code, 'SELF_NOT_ALLOWED');

    // یک کارمند (همه‌ی هفته‌ها): a, b, week2 تأیید؛ ov به‌خاطر هم‌پوشانی skipped
    const r = svc.approveBatch(U.mgr, { userId: t.id, reviewNote: 'تأیید هفتگی' }, { ip: '10.0.0.9', now });
    assert.ok(r.ok);
    assert.equal(r.approved, 3);
    assert.deepEqual(r.skipped.map((x) => [x.id, x.code]), [[ov, 'ONSITE_OVERLAP']]);
    for (const id of [a, b, week2]) assert.equal(repo.findSessionFull(id).status, 'approved');
    assert.equal(repo.findSessionFull(ov).status, 'pending');
    assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action = 'remote_work_batch_approve'").get().n, 1);

    const again = svc.approveBatch(U.mgr, { userId: t.id }, { now });
    assert.equal(again.approved, 0); // idempotent
    assert.equal(db.prepare('SELECT COUNT(*) n FROM attendance_records WHERE user_id = ? AND via_remote = 1').get(t.id).n, 3);

    // هفته‌ای: نشست باز (open) skipped، چیز دیگری باقی نیست؛ سرپرست دیگر هیچ‌چیز نمی‌بیند
    const w = svc.approveBatch(U.mgr, { week: '2026-10-06' }, { now });
    assert.ok(w.ok && w.approved === 0);
    assert.deepEqual(w.skipped.map((x) => [x.id, x.code]).filter((x) => x[0] === open), [[open, 'SESSION_OPEN']]);
    const none = svc.approveBatch(U.other, { week: '2026-10-06' }, { now });
    assert.ok(none.ok && none.total === 0);
  });

  test('جریان یکپارچه: صف ⇒ تأیید و رد ⇒ فقط تأییدشده رکورد رسمی دارد و canReview خاموش می‌شود', () => {
    const u = F.makeUser({ managerId: U.mgr.id });
    const ok = mk(u, '2026-10-13', '05:00:00', '09:00:00', ['07:00:00', '07:30:00']);
    const no = mk(u, '2026-10-14', '05:00:00', '09:00:00');
    const q1 = svc.listQueue(U.mgr, { userId: String(u.id), week: 'all' }, { now });
    assert.deepEqual(q1.items.map((i) => [i.id, i.canReview]), [[ok, true], [no, true]]);
    assert.ok(svc.approve(U.mgr, ok, {}, { now }).ok);
    assert.ok(svc.reject(U.mgr, no, { reviewNote: 'نامعتبر' }, { now }).ok);
    const q2 = svc.listQueue(U.mgr, { userId: String(u.id), status: 'all', week: 'all' }, { now });
    assert.deepEqual(q2.items.map((i) => [i.id, i.status, i.canReview]), [[ok, 'approved', false], [no, 'rejected', false]]);
    assert.equal(svc.listQueue(U.mgr, { userId: String(u.id), week: 'all' }, { now }).total, 0);
    const recs = db.prepare('SELECT record_date, via_remote FROM attendance_records WHERE user_id = ?').all(u.id);
    assert.deepEqual(recs.map((r) => [r.record_date, r.via_remote]), [['2026-10-13', 1]]);
  });
});

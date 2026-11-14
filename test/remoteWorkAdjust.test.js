// اصلاح ساعت دورکاری از مودال رکورد تردد: GET رکورد با remoteSessions، و PATCH /admin/remote-work/:id (adjustApproved).
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

describe('اصلاح ساعت دورکاری در رکورد تردد', () => {
  let db; let repo; let svc; let F; let U; let mk; let attRouter; let remRouter;
  const D = '2026-10-10';
  const now = new Date('2026-10-16T10:00:00Z');
  const iso = (d, t) => `${d}T${t}.000Z`;

  before(() => {
    db = resetDb();
    F = require('./helpers/factories');
    repo = require('../src/repositories/remoteWorkRepository');
    svc = require('../src/services/remoteWorkAdminService');
    attRouter = require('../src/api/routes/admin/attendance');
    remRouter = require('../src/api/routes/admin/remoteWork');
    const mgr = F.makeUser({ role: 'manager' });
    U = { mgr, other: F.makeUser({ role: 'manager' }), admin: F.makeUser({ role: 'admin' }), hr: F.makeUser({ role: 'hr' }), emp: F.makeUser({ managerId: mgr.id }) };
    mk = (u, d, s, e) => {
      const x = repo.insertSession({ userId: u.id, workDate: d, startAt: iso(d, s), ip: '203.0.113.9' });
      if (e) repo.closeSession(x.id, iso(d, e));
      return x.id;
    };
  });
  after(() => cleanup());

  async function call(router, user, method, path, { params = {}, body = {} } = {}) {
    const l = router.stack.filter((x) => x.route).find((x) => x.route.path === path && x.route.methods[method.toLowerCase()]);
    assert.ok(l, `route ثبت نشده: ${method} ${path}`);
    const handlers = l.route.stack.map((s) => s.handle);
    const req = { ...F.fakeReq({ method, url: `/api${path}`, body }), adminUser: user, params, ip: '127.0.0.1' };
    const res = F.fakeRes();
    let i = 0;
    const next = () => { const h = handlers[i++]; if (h) h(req, res, next); };
    next();
    await new Promise((r) => setTimeout(r, 15));
    return { status: res.statusCode, body: res.body };
  }

  test('رکورد دورکاری: ساعت اصلاح می‌شود، رکورد و استراحت‌ها دوباره ساخته می‌شوند، audit با دلیل', () => {
    const a = mk(U.emp, D, '05:00:00', '09:00:00');
    assert.ok(svc.approve(U.mgr, a, {}, { now }).ok);
    assert.equal(svc.adjustApproved(U.mgr, a, { endAt: '2026-10-10T08:00:00Z' }, { now }).code, 'REVIEW_NOTE_REQUIRED');
    assert.equal(svc.adjustApproved(U.hr, a, { endAt: '2026-10-10T08:00:00Z', note: 'x' }, { now }).code, 'FORBIDDEN');
    assert.equal(svc.adjustApproved(U.other, a, { endAt: '2026-10-10T08:00:00Z', note: 'x' }, { now }).code, 'NOT_IN_SCOPE');
    assert.equal(svc.adjustApproved(U.mgr, a, { endAt: '2026-10-10T04:00:00Z', note: 'x' }, { now }).code, 'INVALID_TIME');
    assert.equal(svc.adjustApproved(U.mgr, a, {}, { now }).code, 'INVALID_TIME');
    const r = svc.adjustApproved(U.mgr, a, { startAt: '2026-10-10T05:30:00Z', endAt: '2026-10-10T08:00:00Z', note: 'اصلاح ساعت' }, { now });
    assert.ok(r.ok && r.recordUpdated && !r.recordUnchanged);
    const rec = db.prepare('SELECT * FROM attendance_records WHERE user_id = ?').get(U.emp.id);
    assert.deepEqual([rec.check_in_time, rec.check_out_time, rec.via_remote], [iso(D, '05:30:00'), iso(D, '08:00:00'), 1]);
    const s = repo.findSessionFull(a);
    assert.deepEqual([s.approved_start_at, s.approved_end_at], [iso(D, '05:30:00'), iso(D, '08:00:00')]);
    const au = db.prepare("SELECT details FROM audit_log WHERE action = 'remote_work_adjust'").all();
    assert.equal(au.length, 1);
    assert.ok(au[0].details.includes('اصلاح ساعت') && au[0].details.includes(String(a)));
  });

  test('نشست در انتظار/ردشده با این مسیر اصلاح نمی‌شود؛ هم‌پوشانی دو نشست ⇒ TIME_CONFLICT', () => {
    const e = F.makeUser({ managerId: U.mgr.id });
    const p = mk(e, D, '05:00:00', '07:00:00');
    assert.equal(svc.adjustApproved(U.mgr, p, { endAt: '2026-10-10T06:00:00Z', note: 'x' }, { now }).code, 'NOT_APPROVED');
    const q = mk(e, D, '09:00:00', '11:00:00');
    assert.ok(svc.approve(U.mgr, p, {}, { now }).ok && svc.approve(U.mgr, q, {}, { now }).ok);
    assert.equal(svc.adjustApproved(U.mgr, q, { startAt: '2026-10-10T06:30:00Z', note: 'x' }, { now }).code, 'TIME_CONFLICT');
    assert.ok(svc.adjustApproved(U.mgr, q, { startAt: '2026-10-10T08:00:00Z', note: 'x' }, { now }).ok);
  });

  test('نشستِ ادغام‌شده در رکورد حضوری: رکورد گسترش می‌یابد؛ کوتاه‌کردن ⇒ recordUnchanged', () => {
    const e = F.makeUser({ managerId: U.mgr.id });
    db.prepare("INSERT INTO attendance_records (user_id, record_date, check_in_time, check_out_time, status) VALUES (?, ?, ?, ?, 'normal')").run(e.id, '2026-10-09', iso('2026-10-09', '06:00:00'), iso('2026-10-09', '10:00:00'));
    const s = mk(e, '2026-10-09', '10:30:00', '12:00:00');
    assert.ok(svc.approve(U.mgr, s, { overlapDecision: 'merge', reviewNote: 'ادغام' }, { now }).ok);
    const widen = svc.adjustApproved(U.mgr, s, { endAt: '2026-10-09T13:00:00Z', note: 'تمدید' }, { now });
    assert.ok(widen.ok && widen.recordUpdated);
    assert.equal(db.prepare('SELECT check_out_time FROM attendance_records WHERE user_id = ?').get(e.id).check_out_time, iso('2026-10-09', '13:00:00'));
    const shrink = svc.adjustApproved(U.mgr, s, { endAt: '2026-10-09T11:00:00Z', note: 'کوتاه' }, { now });
    assert.ok(shrink.ok && shrink.recordUnchanged && !shrink.recordUpdated);
    assert.equal(db.prepare('SELECT via_remote FROM attendance_records WHERE user_id = ?').get(e.id).via_remote, 0);
  });

  test('ادمین و مالک روی هر کارمندی (حتی بدون سرپرستی مستقیم) می‌توانند ساعت را اصلاح کنند؛ خود ممنوع', () => {
    const owner = F.makeUser({ role: 'owner' });
    for (const [i, actor] of [U.admin, owner].entries()) {
      const e = F.makeUser({ managerId: U.other.id });
      const d = `2026-10-0${i + 1}`;
      const s = mk(e, d, '05:00:00', '08:00:00');
      assert.ok(svc.approve(actor, s, {}, { now }).ok);
      const r = svc.adjustApproved(actor, s, { endAt: `${d}T07:00:00Z`, note: i ? undefined : 'ادمین' }, { now });
      assert.ok(r.ok, `${actor.role}: ${r.code}`);
      assert.equal(svc.listQueue(actor, { status: 'approved', week: 'all', userId: String(e.id) }).items[0].canAdjust, true);
    }
    const own = mk(U.admin, '2026-10-05', '05:00:00', '06:00:00');
    repo.markApproved(own, { reviewedBy: owner.id, reviewedAt: now.toISOString(), reviewNote: null, approvedStartAt: null, approvedEndAt: null, attendanceRecordId: null });
    assert.equal(svc.adjustApproved(U.admin, own, { endAt: '2026-10-05T05:30:00Z', note: 'x' }, { now }).code, 'SELF_NOT_ALLOWED');
  });

  test('ماه بسته ⇒ MONTH_CLOSED', () => {
    const e = F.makeUser({ managerId: U.mgr.id });
    const s = mk(e, '2026-09-05', '05:00:00', '07:00:00');
    assert.ok(svc.approve(U.mgr, s, {}, { now }).ok);
    db.prepare("INSERT INTO month_closures (jalali_year, jalali_month, period_from, period_to, status, close_count) VALUES (1405, 6, '2026-08-23', '2026-09-22', 'closed', 1)").run();
    assert.equal(svc.adjustApproved(U.mgr, s, { endAt: '2026-09-05T06:00:00Z', note: 'x' }, { now }).code, 'MONTH_CLOSED');
  });

  test('route ها: GET رکورد دورکاریِ همان روز را می‌دهد (با علامت هم‌پوشانی)، PATCH ساعت را اصلاح می‌کند', async () => {
    const e = F.makeUser({ managerId: U.mgr.id });
    const rec = db.prepare("INSERT INTO attendance_records (user_id, record_date, check_in_time, check_out_time, status) VALUES (?, '2026-10-08', ?, ?, 'normal')").run(e.id, iso('2026-10-08', '06:00:00'), iso('2026-10-08', '10:00:00'));
    const pend = mk(e, '2026-10-08', '11:00:00', '12:00:00');
    const g = await call(attRouter, U.mgr, 'GET', '/admin/attendance-records/:id', { params: { id: String(rec.lastInsertRowid) } });
    assert.equal(g.status, 200);
    assert.equal(g.body.remoteSessions.length, 1);
    assert.deepEqual([g.body.remoteSessions[0].id, g.body.remoteSessions[0].status, g.body.remoteSessions[0].overlapsOnsite, g.body.remoteSessions[0].canReview], [pend, 'pending', true, true]);
    const hr = await call(attRouter, U.hr, 'GET', '/admin/attendance-records/:id', { params: { id: String(rec.lastInsertRowid) } });
    assert.equal(hr.body.remoteSessions[0].canReview, false);

    const q0 = svc.listQueue(U.mgr, { status: 'all', week: 'all', userId: String(e.id) });
    assert.equal(q0.items.find((i) => i.id === pend).canAdjust, false); // در انتظار ⇒ با مسیر تأیید، نه اصلاح
    assert.ok(svc.approve(U.mgr, pend, { overlapDecision: 'merge', reviewNote: 'n' }, { now: new Date() }).ok);
    const q1 = svc.listQueue(U.mgr, { status: 'approved', week: 'all', userId: String(e.id) });
    assert.equal(q1.items.find((i) => i.id === pend).canAdjust, true);
    assert.equal(svc.listQueue(U.hr, { status: 'approved', week: 'all', userId: String(e.id) }).items.find((i) => i.id === pend).canAdjust, false);
    const bad = await call(remRouter, U.mgr, 'PATCH', '/admin/remote-work/:id', { params: { id: String(pend) }, body: { end_at: '2026-10-08T12:30:00Z' } });
    assert.deepEqual([bad.status, bad.body.code], [400, 'REVIEW_NOTE_REQUIRED']);
    const ok = await call(remRouter, U.mgr, 'PATCH', '/admin/remote-work/:id', { params: { id: String(pend) }, body: { end_at: '2026-10-08T12:30:00Z', review_note: 'اصلاح' } });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.session.approvedEndAt, iso('2026-10-08', '12:30:00'));
  });
});

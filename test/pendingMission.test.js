// C5: ورود/خروج از بیرون شبکه با ماموریتِ pending — سه حالت (pending/approved/rejected) + تنظیم خاموش؛ نشانه و مرور شبانه.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const F = require('./helpers/factories');

describe('ماموریت pending و ورود بیرون از شبکه (C5)', () => {
  let db; let mgr; let emp; let mw; let leaveRepo; let attendance; let svc; let susp; let reviewDay; let today; let missionId;
  const call = (user) => {
    const req = { ip: '8.8.8.8', originalUrl: '/api/miniapp/check-in', miniAppUser: user };
    const out = { nexted: false, status: null };
    const res = { status(c) { out.status = c; return this; }, json(b) { out.body = b; return this; } };
    mw.networkRestriction(req, res, () => { out.nexted = true; });
    return { req, out };
  };
  const setStatus = (id, status) => db.prepare('UPDATE leave_requests SET status = ? WHERE id = ?').run(status, id);

  before(() => {
    db = resetDb();
    process.env.ALLOWED_NETWORK_CIDR = process.env.ALLOWED_NETWORK_CIDR || '10.0.0.0/8';
    mw = require('../src/middleware/networkRestriction');
    leaveRepo = require('../src/repositories/leaveRepository');
    attendance = require('../src/repositories/attendanceRepository');
    svc = require('../src/services/pendingMissionService');
    susp = require('../src/repositories/suspiciousRepository');
    ({ reviewDay } = require('../src/utils/dayReview'));
    today = require('../src/utils/serverTime').todayDateString();
    mgr = F.makeUser({ role: 'manager' });
    emp = F.makeUser({ managerId: mgr.id });
    const lt = require('../src/repositories/leaveTypesRepository').findByCode('mission');
    missionId = leaveRepo.createLeaveRequest({ userId: emp.id, startDate: today, endDate: today, leaveTypeId: lt.id, reason: 'جلسه‌ی بیرونی' }).id;
  });
  after(cleanup);

  test('pending + تنظیم روشن (پیش‌فرض) ⇒ عبور با پرچم', () => {
    const { req, out } = call(emp);
    assert.equal(out.nexted, true);
    assert.equal(req.viaPendingMission, missionId);
  });

  test('تنظیم خاموش ⇒ ۴۰۳', () => {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('allow_checkin_with_pending_mission', 'false')").run();
    const { out } = call(emp);
    assert.equal(out.nexted, false);
    assert.equal(out.status, 403);
    db.prepare("DELETE FROM settings WHERE key = 'allow_checkin_with_pending_mission'").run();
  });

  test('کاربر بدون ماموریت ⇒ ۴۰۳؛ ماموریتِ ردشده ⇒ ۴۰۳', () => {
    assert.equal(call(F.makeUser()).out.status, 403);
    setStatus(missionId, 'rejected');
    assert.equal(call(emp).out.status, 403);
    setStatus(missionId, 'pending');
  });

  test('approved ⇒ عبور بدون پرچم pending (مسیر قبلی)', () => {
    setStatus(missionId, 'approved');
    const { req, out } = call(emp);
    assert.equal(out.nexted, true);
    assert.equal(req.viaPendingMission, undefined);
    setStatus(missionId, 'pending');
  });

  test('ثبت ورود با پرچم ⇒ via_pending_mission=1 و نشانه pending_mission_outside (idempotent)', () => {
    const rec = attendance.recordCheckIn(emp.id, '8.8.8.8', {}, { viaPendingMission: true });
    assert.equal(rec.via_pending_mission, 1);
    const r1 = svc.flagPendingMissionOutside({ userId: emp.id, record: rec, requestId: missionId, action: 'check_in' });
    assert.equal(r1.created, true);
    assert.equal(svc.flagPendingMissionOutside({ userId: emp.id, record: rec, requestId: missionId, action: 'check_out' }).created, false);
    const ev = susp.list({ status: 'open', limit: 10 }).find((e) => e.event_type === 'pending_mission_outside');
    assert.deepEqual(ev.user_ids, [emp.id]);
    assert.equal(attendance.recordCheckOut(rec.id, '8.8.8.8', {}, { viaPendingMission: true }).via_pending_mission, 1);
  });

  test('ورود عادی ⇒ via_pending_mission=0', () => {
    const other = F.makeUser();
    assert.equal(attendance.recordCheckIn(other.id, '10.0.0.5').via_pending_mission, 0);
  });

  test('مرور شبانه: pending ⇒ عادی؛ رد شد ⇒ نیازمند بررسی؛ تأیید شد ⇒ عادی', () => {
    const row = () => reviewDay([emp], today)[0];
    assert.equal(row().pendingMissionRejected, false);
    setStatus(missionId, 'rejected');
    assert.equal(row().pendingMissionRejected, true);
    assert.equal(row().needsAttention, true);
    setStatus(missionId, 'approved');
    assert.equal(row().pendingMissionRejected, false);
  });
});

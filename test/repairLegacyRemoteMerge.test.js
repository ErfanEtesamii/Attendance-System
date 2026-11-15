// اسکریپت تعمیر ادغام‌های قدیمیِ دورکاری (scripts/repair-legacy-remote-merge.js)
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

describe('تعمیر دورکاریِ ادغام‌شده‌ی قدیمی', () => {
  let db; let F; let repo; let svc; let tool; let mgr;
  const now = new Date('2026-10-16T10:00:00Z');
  const iso = (d, t) => `${d}T${t}.000Z`;

  before(() => {
    db = resetDb();
    F = require('./helpers/factories');
    repo = require('../src/repositories/remoteWorkRepository');
    svc = require('../src/services/remoteWorkAdminService');
    tool = require('../scripts/repair-legacy-remote-merge');
    mgr = F.makeUser({ role: 'manager' });
  });
  after(() => cleanup());

  // یک روز ادغام‌شده‌ی «قدیمی»: حضوری onIn–onOut، دورکاری s–e، سپس ستون‌های بازه‌ی حضوری NULL می‌شوند (مثل قبل از migration 051)
  function legacyDay(date, onIn, onOut, s, e) {
    const emp = F.makeUser({ managerId: mgr.id });
    db.prepare("INSERT INTO attendance_records (user_id, record_date, check_in_time, check_out_time, status) VALUES (?, ?, ?, ?, 'normal')").run(emp.id, date, iso(date, onIn), iso(date, onOut));
    const x = repo.insertSession({ userId: emp.id, workDate: date, startAt: iso(date, s), ip: '203.0.113.9' });
    repo.closeSession(x.id, iso(date, e));
    assert.ok(svc.approve(mgr, x.id, { overlapDecision: 'merge', reviewNote: 'ادغام' }, { now }).ok);
    db.prepare('UPDATE remote_work_sessions SET onsite_in_at = NULL, onsite_out_at = NULL WHERE id = ?').run(x.id);
    return { emp, sid: x.id, date };
  }
  const rec = (emp) => db.prepare('SELECT * FROM attendance_records WHERE user_id = ?').get(emp.id);
  const remBreaks = (emp) => db.prepare('SELECT start_time, end_time FROM break_records WHERE attendance_record_id = ? AND via_remote = 1 ORDER BY start_time').all(rec(emp).id).map((b) => [b.start_time, b.end_time]);

  test('dry-run چیزی را تغییر نمی‌دهد؛ بدون بازه‌ی حضوری ⇒ ردشده با راهنمای --onsite', () => {
    const d = legacyDay('2026-10-05', '06:00:00', '10:00:00', '10:30:00', '20:00:00');
    const before = rec(d.emp);
    const res = tool.run({ apply: false, db, tz: 'UTC', now }).find((r) => r.group.sessionIds.includes(d.sid));
    assert.equal(res.status, 'skipped');
    assert.match(res.reason, /--onsite/);
    assert.deepEqual(rec(d.emp), before);
  });

  test('--onsite دستی + --apply: رکورد به بازه‌ی حضوری و دورکاریِ اصلاح‌شده برمی‌گردد و استراحت فاصله ساخته می‌شود', () => {
    const d = legacyDay('2026-10-04', '06:00:00', '10:00:00', '10:30:00', '20:00:00');
    // دورکاریِ واقعی ۱۰:۳۰ تا ۱۱:۳۰ بوده (قبلاً اصلاح شده ولی رکورد کوتاه نشده بود)
    db.prepare('UPDATE remote_work_sessions SET approved_end_at = ? WHERE id = ?').run(iso(d.date, '11:30:00'), d.sid);
    assert.equal(rec(d.emp).check_out_time, iso(d.date, '20:00:00'));
    const ov = new Map([[d.sid, { id: d.sid, start: '06:00', end: '10:00' }]]);
    const dry = tool.run({ apply: false, overrides: ov, db, tz: 'UTC', now }).find((r) => r.group.sessionIds.includes(d.sid));
    assert.equal(dry.status, 'ready');
    assert.equal(rec(d.emp).check_out_time, iso(d.date, '20:00:00')); // هنوز تغییر نکرده
    const res = tool.run({ apply: true, overrides: ov, db, tz: 'UTC', now }).find((r) => r.group.sessionIds.includes(d.sid));
    assert.equal(res.status, 'applied');
    assert.deepEqual([rec(d.emp).check_in_time, rec(d.emp).check_out_time], [iso(d.date, '06:00:00'), iso(d.date, '11:30:00')]);
    assert.deepEqual(remBreaks(d.emp), [[iso(d.date, '10:00:00'), iso(d.date, '10:30:00')]]);
    const s = repo.findSessionFull(d.sid);
    assert.deepEqual([s.onsite_in_at, s.onsite_out_at], [iso(d.date, '06:00:00'), iso(d.date, '10:00:00')]);
    // از این به بعد اصلاح دورکاری مثل ادغام‌های جدید کار می‌کند
    assert.ok(svc.adjustApproved(mgr, d.sid, { endAt: iso(d.date, '11:00:00'), note: 'کوتاه' }, { now }).ok);
    assert.equal(rec(d.emp).check_out_time, iso(d.date, '11:00:00'));
    assert.equal(tool.run({ apply: false, db, tz: 'UTC', now }).some((r) => r.group.sessionIds.includes(d.sid)), false);
  });

  test('بازه‌ی حضوری از لاگ ورود/خروج (audit) پیدا می‌شود', () => {
    const d = legacyDay('2026-10-03', '06:00:00', '10:00:00', '10:30:00', '18:00:00');
    const ins = db.prepare('INSERT INTO audit_log (user_id, action, occurred_at, details) VALUES (?, ?, ?, ?)');
    ins.run(d.emp.id, 'check_in', '2026-10-03 06:00:00', '{"source":"miniapp"}');
    ins.run(d.emp.id, 'check_out', '2026-10-03 10:00:00', '{"source":"miniapp"}');
    const res = tool.run({ apply: true, db, tz: 'UTC', now }).find((r) => r.group.sessionIds.includes(d.sid));
    assert.equal(res.status, 'applied', res.reason);
    assert.deepEqual([rec(d.emp).check_in_time, rec(d.emp).check_out_time], [iso(d.date, '06:00:00'), iso(d.date, '18:00:00')]);
  });

  test('رکوردِ ویرایش‌شده‌ی دستی بعد از ادغام خودکار اعمال نمی‌شود', () => {
    const d = legacyDay('2026-10-02', '06:00:00', '10:00:00', '10:30:00', '18:00:00');
    db.prepare('INSERT INTO audit_log (user_id, action, occurred_at, details) VALUES (?, ?, ?, ?)')
      .run(mgr.id, 'attendance_record_manually_fixed', '2026-10-17 08:00:00', JSON.stringify({ meta: { targetUserId: d.emp.id }, entityId: 1, after: { check_out_time: iso(d.date, '15:00:00') }, note: d.date }));
    db.prepare('INSERT INTO audit_log (user_id, action, occurred_at) VALUES (?, ?, ?)').run(d.emp.id, 'check_in', '2026-10-02 06:00:00');
    const res = tool.run({ apply: true, db, tz: 'UTC', now }).find((r) => r.group.sessionIds.includes(d.sid));
    assert.equal(res.status, 'skipped');
    assert.equal(rec(d.emp).check_out_time, iso(d.date, '18:00:00'));
  });

  test('parseOnsiteArg و localToIso', () => {
    assert.deepEqual(tool.parseOnsiteArg('57=7:44-15:00'), { id: 57, start: '07:44', end: '15:00' });
    assert.equal(tool.parseOnsiteArg('x'), null);
    assert.equal(tool.localToIso('2026-10-10', '07:30', 'Asia/Tehran'), '2026-10-10T04:00:00.000Z');
  });
});

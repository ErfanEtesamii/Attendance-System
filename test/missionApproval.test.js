// C4: تأیید شبانه‌ی ماموریت — پیام مرور شبانه + دکمه‌ها، رد با علت اجباری، اصلاح ساعت، یادآوری ۱۰ صبح و ارجاع ۴۸ ساعته.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const F = require('./helpers/factories');
const missionService = require('../src/services/missionService');
const decisions = require('../src/services/missionDecisionService');
const leaveRepo = require('../src/repositories/leaveRepository');
const approval = require('../src/services/leaveApprovalService');
const notificationsRepo = require('../src/repositories/notificationsRepository');
const { buildNightlyMessage, missionSection } = require('../src/bot/scheduler/nightlyReview');
const { runMissionApprovalReminder } = require('../src/bot/scheduler/leaveApprovalReminder');

const NOW = new Date('2026-08-02T08:00:00Z');
const D = (n) => F.workdayDate(n);

describe('تأیید ماموریت (C4)', () => {
  let db; let admin; let mgr; let other; let emp; let teamIds;
  const mk = (user, extra = {}) => {
    const r = missionService.create({ userId: user.id, startDate: D(3), reason: 'جلسه با مشتری', ...extra }, { now: NOW });
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    return r.request;
  };
  const setCreated = (id, iso) => db.prepare('UPDATE leave_requests SET created_at = ? WHERE id = ?').run(iso.replace('T', ' ').slice(0, 19), id);

  before(() => {
    db = resetDb();
    admin = F.makeUser({ role: 'admin' });
    mgr = F.makeUser({ role: 'manager' });
    other = F.makeUser({ role: 'manager' });
    emp = F.makeUser({ managerId: mgr.id });
    teamIds = [emp.id];
  });
  after(cleanup);

  test('پیام شبانه: بخش ماموریت‌ها و ردیف دکمه (ساعتی ⇒ + اصلاح ساعت)؛ سرپرست دیگر چیزی نمی‌بیند', () => {
    const day = mk(emp, { destination: 'شعبه شمال' });
    const hour = mk(emp, { startDate: D(4), unit: 'hour', startTime: '10:00', endTime: '12:00', reason: 'بازدید ساعتی' });
    const sec = missionSection(mgr);
    assert.equal(sec.shown.length, 2);
    const text = buildNightlyMessage(mgr, [emp], '2026-08-02');
    assert.match(text, /🚗 ماموریت‌های منتظر تأیید \(2\)/);
    assert.match(text, /شعبه شمال/);
    const rows = Object.fromEntries(sec.shown.map((r) => [r.id, decisions.missionKeyboardRow(r).map((b) => b.callback_data)]));
    assert.deepEqual(rows[day.id], [`leave_approve:${day.id}`, `leave_reject:${day.id}`]);
    assert.deepEqual(rows[hour.id], [`leave_approve:${hour.id}`, `leave_reject:${hour.id}`, `mission_edit:${hour.id}`]);
    assert.equal(missionSection(other).shown.length, 0);
    assert.doesNotMatch(buildNightlyMessage(other, [F.makeUser({ managerId: other.id })], '2026-08-02'), /ماموریت‌های منتظر/);
    db.exec('DELETE FROM leave_approvals; DELETE FROM leave_requests;');
  });

  test('رد: بدون علت/علت کوتاه ⇒ خطا و وضعیت دست‌نخورده؛ با علت ⇒ rejected و اعلان با «پاسخ»', async () => {
    const r = mk(emp);
    assert.equal(decisions.rejectMission({ requestId: r.id, actor: mgr, reason: '  ' }).code, 'REASON_REQUIRED');
    assert.equal(decisions.rejectMission({ requestId: r.id, actor: mgr, reason: 'ab' }).code, 'REASON_REQUIRED');
    assert.equal(leaveRepo.findById(r.id).status, 'pending');
    assert.equal(decisions.rejectMission({ requestId: r.id, actor: other, reason: 'علت کافی' }).code, 'FORBIDDEN');
    const ok = decisions.rejectMission({ requestId: r.id, actor: mgr, reason: 'تداخل با جلسه‌ی تیم' });
    assert.equal(ok.ok, true);
    assert.equal(leaveRepo.findById(r.id).status, 'rejected');
    await new Promise((res) => setTimeout(res, 20));
    const notes = notificationsRepo.listForUser(emp.id, {});
    assert.ok(notes.some((n) => /تداخل با جلسه‌ی تیم/.test(n.body || '')));
    assert.equal(decisions.rejectMission({ requestId: r.id, actor: mgr, reason: 'دوباره' }).code, 'ALREADY_DECIDED');
  });

  test('تأیید از مسیر دکمه‌ی تأیید', () => {
    const r = mk(emp, { startDate: D(5) });
    const res = decisions.approveMission({ requestId: r.id, actor: mgr });
    assert.equal(res.ok, true);
    assert.equal(leaveRepo.findById(r.id).status, 'approved');
  });

  test('اصلاح ساعت: قالب، مجوز، تداخل، ذخیره‌ی مدت جدید و audit', () => {
    const r = mk(emp, { startDate: D(6), unit: 'hour', startTime: '09:00', endTime: '10:00', reason: 'کار بیرون' });
    assert.equal(decisions.parseTimeRange('۹:۳۰ - ۱۱:۰۰').startTime, '09:30');
    assert.equal(decisions.parseTimeRange('25:00-26:00'), null);
    assert.equal(decisions.adjustTimes({ requestId: r.id, actor: mgr, text: 'abc' }).code, 'BAD_FORMAT');
    assert.equal(decisions.adjustTimes({ requestId: r.id, actor: other, text: '09:00-11:00' }).code, 'FORBIDDEN');
    assert.equal(decisions.adjustTimes({ requestId: r.id, actor: emp, text: '09:00-11:00' }).code, 'FORBIDDEN'); // خودِ کارمند نه
    const res = decisions.adjustTimes({ requestId: r.id, actor: mgr, text: '09:30-12:00' });
    assert.equal(res.ok, true, JSON.stringify(res));
    const q = leaveRepo.findById(r.id);
    assert.deepEqual([q.start_time, q.end_time, q.duration_minutes, q.status], ['09:30', '12:00', 150, 'pending']);
    assert.ok(db.prepare("SELECT 1 FROM audit_log WHERE action = 'mission_time_adjusted'").get());
    // ماموریت روزانه قابل اصلاح ساعت نیست
    const d = mk(emp, { startDate: D(7) });
    assert.equal(decisions.adjustTimes({ requestId: d.id, actor: mgr, text: '09:00-10:00' }).code, 'NOT_HOURLY');
    // تأییدشده دیگر قابل اصلاح نیست
    decisions.approveMission({ requestId: r.id, actor: mgr });
    assert.equal(decisions.adjustTimes({ requestId: r.id, actor: mgr, text: '09:00-10:00' }).code, 'ALREADY_DECIDED');
  });

  describe('یادآوری و ارجاع', () => {
    let r; let key;
    before(() => {
      db.exec('DELETE FROM notifications; DELETE FROM leave_approvals; DELETE FROM leave_requests;');
      r = mk(emp, { startDate: D(10) });
      key = `mission_reminder:${r.id}:1`;
    });

    test('همان روز ثبت: یادآوری نمی‌رود؛ قبل از ساعت ۱۰ روز بعد هم نه', async () => {
      setCreated(r.id, '2026-08-02T05:00:00Z');
      let out = await runMissionApprovalReminder({ now: new Date('2026-08-02T15:00:00Z') });
      assert.equal(out.reminded, 0);
      out = await runMissionApprovalReminder({ now: new Date('2026-08-03T05:00:00Z') }); // ۰۸:۳۰ تهران
      assert.equal(out.reminded, 0);
    });

    test('ساعت ۱۰ روز بعد ⇒ یک‌بار یادآوری (idempotent)', async () => {
      const now = new Date('2026-08-03T07:00:00Z'); // ۱۰:۳۰ تهران
      const a = await runMissionApprovalReminder({ now });
      assert.equal(a.reminded, 1);
      assert.ok(notificationsRepo.findByDedupe(mgr.id, key));
      const b = await runMissionApprovalReminder({ now });
      assert.equal(b.reminded, 0);
      assert.equal(leaveRepo.findById(r.id).status, 'pending');
    });

    test('۴۸ ساعت ⇒ ارجاع به ادمین؛ تصمیم خودکار نیست', async () => {
      const out = await runMissionApprovalReminder({ now: new Date('2026-08-04T06:00:00Z') });
      assert.equal(out.escalated, 1);
      assert.equal(approval.awaitingRole(leaveRepo.findById(r.id)), 'admin');
      assert.equal(leaveRepo.findById(r.id).status, 'pending');
      assert.ok(notificationsRepo.findByDedupe(admin.id, `mission_escalated:${r.id}:1`));
      const again = await runMissionApprovalReminder({ now: new Date('2026-08-05T06:00:00Z') });
      assert.equal(again.escalated, 0);
    });
  });
});

describe('جریان بات: رد با علت و اصلاح ساعت (C4)', () => {
  let mgr; let emp; let session; let flow; let bot; let sent; let M; let E;
  before(() => {
    resetDb();
    session = require('../src/bot/session');
    flow = require('../src/bot/commands/missionApproval');
    mgr = F.makeUser({ role: 'manager' });
    emp = F.makeUser({ managerId: mgr.id });
    M = Number(mgr.telegram_user_id); E = Number(emp.telegram_user_id);
    sent = [];
    bot = {
      answerCallbackQuery: async (id, o) => sent.push(['answer', o && o.text]),
      sendMessage: async (chat, text, o) => sent.push(['msg', chat, text, o]),
      editMessageReplyMarkup: async () => sent.push(['edit']),
    };
  });
  after(cleanup);

  test('رد: callback ⇒ سؤال علت؛ متن کوتاه ⇒ جریان باز؛ علت درست ⇒ رد + پیام به کارمند با علت', async () => {
    const r = missionService.create({ userId: emp.id, startDate: D(3), reason: 'جلسه با مشتری' }, { now: NOW }).request;
    const q = { id: 'q1', from: { id: M }, data: `leave_reject:${r.id}`, message: { chat: { id: M }, message_id: 5 } };
    await flow.startMissionReject(bot, q);
    const sess = session.get(M);
    assert.equal(sess.flow, 'mission_reject');
    assert.ok(sent.some((s) => s[0] === 'msg' && /علت رد/.test(s[2])));
    await flow.handleMissionRejectText(bot, { chat: { id: M }, from: { id: M }, text: 'ab' }, sess);
    assert.equal(leaveRepo.findById(r.id).status, 'pending');
    assert.ok(session.get(M));
    await flow.handleMissionRejectText(bot, { chat: { id: M }, from: { id: M }, text: 'بودجه تأیید نشده' }, session.get(M));
    assert.equal(leaveRepo.findById(r.id).status, 'rejected');
    assert.equal(session.get(M), null);
    assert.ok(sent.some((s) => s[0] === 'msg' && String(s[1]) === String(E) && /بودجه تأیید نشده/.test(s[2])));
  });

  test('کاربر غیرمجاز یا درخواست تصمیم‌گرفته‌شده ⇒ جریان شروع نمی‌شود', async () => {
    const r = missionService.create({ userId: emp.id, startDate: D(4), reason: 'جلسه با مشتری' }, { now: NOW }).request;
    const stranger = F.makeUser({ role: 'manager' });
    const SX = Number(stranger.telegram_user_id);
    await flow.startMissionReject(bot, { id: 'q2', from: { id: SX }, data: `leave_reject:${r.id}`, message: { chat: { id: SX }, message_id: 1 } });
    assert.equal(session.get(SX), null);
        await flow.startMissionEdit(bot, { id: 'q3', from: { id: M }, data: `mission_edit:99999`, message: { chat: { id: M }, message_id: 1 } });
    assert.equal(session.get(M), null);
  });
});

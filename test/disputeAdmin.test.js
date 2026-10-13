// D3 (فاز ۱۱): سمت ادمین/سرپرستِ گفت‌وگوی اعتراض — فیلتر وضعیت با مدل جدید، شمارنده‌ی «منتظر پاسخ ادمین»، thread کامل،
// پاسخ ادمین، resolve (با پیام پایانیِ اختیاری، closed_by=admin) و reopen (بدون شمارش در سقف کارمند).
// لایه‌ی سرویس/repository (بدون express)؛ route، مجوز و اسکوپ نقش در disputeAdminRoutes.test.js.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

describe('disputeService — سمت ادمین (D3)', () => {
  let db; let svc; let repo; let F; let attendanceRepo;
  let emp; let emp2; let mgr; let admin; let record;

  before(() => {
    db = resetDb();
    F = require('./helpers/factories');
    svc = require('../src/services/disputeService');
    repo = require('../src/repositories/disputeRepository');
    attendanceRepo = require('../src/repositories/attendanceRepository');
    mgr = F.makeUser({ role: 'manager', name: 'سرپرست' });
    admin = F.makeUser({ role: 'admin', name: 'ادمین' });
    emp = F.makeUser({ name: 'کارمند', managerId: mgr.id });
    emp2 = F.makeUser({ name: 'همکار' });
    record = attendanceRepo.createManual({ userId: emp.id, recordDate: '2026-09-20', checkInTime: '2026-09-20T05:00:00.000Z', checkOutTime: '2026-09-20T13:00:00.000Z', status: 'normal' });
  });
  after(cleanup);
  beforeEach(() => {
    for (const t of ['dispute_messages', 'record_disputes', 'month_closures']) db.prepare(`DELETE FROM ${t}`).run();
    db.prepare("DELETE FROM settings WHERE key = 'dispute_max_reopens'").run();
  });

  const open = (user = emp, message = 'ساعت خروج من اشتباه ثبت شده', recordId = null) => {
    const r = svc.create(user, { attendanceRecordId: recordId, message });
    assert.equal(r.ok, true);
    return r.dispute;
  };
  const staffReply = (id, text = 'در حال بررسی') => repo.addMessage({ disputeId: id, senderUserId: admin.id, senderRole: 'admin', message: text });
  const userReply = (id, text = 'ممنون، منتظرم', user = emp) => repo.addMessage({ disputeId: id, senderUserId: user.id, senderRole: 'user', message: text });
  const ids = (list) => list.map((d) => d.id).sort((a, b) => a - b);
  const closeMonth = () => db.prepare("INSERT INTO month_closures (jalali_year, jalali_month, status, period_from, period_to) VALUES (1405, 6, 'closed', '2026-08-23', '2026-09-22')").run();

  // مجموعه‌ی نمونه با هر پنج حالت: باز/منتظر، پاسخ‌داده‌شده، حل‌شده توسط ادمین، خاتمه توسط کارمند، قدیمیِ بدون پیام
  function seed() {
    const awaiting = open(emp, 'منتظر پاسخ', record.id);
    const answered = open(emp, 'پاسخ داده شد');
    staffReply(answered.id);
    const byAdmin = open(emp2, 'حل شد توسط ادمین');
    repo.setStatus(byAdmin.id, 'resolved');
    const byUser = open(emp2, 'کارمند بست');
    repo.setStatus(byUser.id, 'resolved', { closedBy: 'user' });
    const legacy = db.prepare("INSERT INTO record_disputes (user_id, message) VALUES (?, 'قدیمی بدون پیام')").run(emp.id).lastInsertRowid;
    return { awaiting: awaiting.id, answered: answered.id, byAdmin: byAdmin.id, byUser: byUser.id, legacy: Number(legacy) };
  }

  describe('فهرست و فیلتر وضعیت', () => {
    test('هر فیلتر دقیقاً اعتراض‌های خودش را برمی‌گرداند؛ مقدار ناشناخته/بدون فیلتر ⇒ همه', () => {
      const s = seed();
      const f = (status) => ids(svc.listForAdmin({ status }));
      assert.deepEqual(f(null), ids(Object.values(s).map((id) => ({ id }))));
      assert.deepEqual(f('open'), [s.awaiting, s.answered, s.legacy].sort((a, b) => a - b));
      assert.deepEqual(f('resolved'), [s.byAdmin, s.byUser].sort((a, b) => a - b));
      assert.deepEqual(f('awaiting_admin'), [s.awaiting, s.legacy].sort((a, b) => a - b), 'قدیمیِ بدون پیام = پیام از کارمند ⇒ منتظر پاسخ');
      assert.deepEqual(f('answered'), [s.answered]);
      assert.deepEqual(f('resolved_by_admin'), [s.byAdmin]);
      assert.deepEqual(f('closed_by_user'), [s.byUser]);
      assert.deepEqual(f('نامعتبر'), f(null));
      assert.ok(svc.ADMIN_STATUS_FILTERS.every((x) => Array.isArray(svc.listForAdmin({ status: x }))));
    });

    test('نمای هر ردیف: فیلدهای قدیمی + closedBy/reopenCount/messageCount/lastSenderRole/phase/awaitingAdmin/recordDate', () => {
      const s = seed();
      const by = (id) => svc.listForAdmin().find((d) => d.id === id);
      const a = by(s.awaiting);
      assert.equal(a.userId, emp.id);
      assert.equal(a.message, 'منتظر پاسخ');
      assert.equal(a.status, 'open');
      assert.equal(a.attendanceRecordId, record.id);
      assert.equal(a.recordDate, '2026-09-20');
      assert.deepEqual([a.messageCount, a.lastSenderRole, a.phase, a.awaitingAdmin, a.closedBy, a.reopenCount], [1, 'user', 'open', true, null, 0]);
      assert.ok(a.createdAt && a.updatedAt && a.lastMessageAt);

      const b = by(s.answered);
      assert.deepEqual([b.messageCount, b.lastSenderRole, b.phase, b.awaitingAdmin], [2, 'admin', 'answered', false]);
      assert.deepEqual([by(s.byAdmin).phase, by(s.byAdmin).closedBy, by(s.byAdmin).awaitingAdmin], ['resolved', 'admin', false]);
      assert.deepEqual([by(s.byUser).phase, by(s.byUser).closedBy], ['closed_by_user', 'user']);
      assert.deepEqual([by(s.legacy).messageCount, by(s.legacy).awaitingAdmin], [1, true]);
    });

    test('اسکوپ: userIds فقط همان کارمندان؛ آرایه‌ی خالی ⇒ هیچ؛ null ⇒ همه', () => {
      const s = seed();
      assert.deepEqual(ids(svc.listForAdmin({ userIds: [emp.id] })), [s.awaiting, s.answered, s.legacy].sort((a, b) => a - b));
      assert.deepEqual(ids(svc.listForAdmin({ userIds: [emp2.id] })), [s.byAdmin, s.byUser].sort((a, b) => a - b));
      assert.deepEqual(svc.listForAdmin({ userIds: [] }), []);
      assert.equal(svc.listForAdmin({ userIds: null }).length, 5);
      assert.deepEqual(ids(svc.listForAdmin({ status: 'open', userIds: [emp2.id] })), []);
    });
  });

  describe('شمارنده‌ی «منتظر پاسخ ادمین»', () => {
    test('شمارش هر حالت و تغییرش با پاسخ ادمین / پیام کارمند', () => {
      assert.deepEqual(svc.countsForAdmin(), { total: 0, open: 0, awaitingAdmin: 0, answered: 0, resolved: 0, resolvedByAdmin: 0, closedByUser: 0 });
      const s = seed();
      assert.deepEqual(svc.countsForAdmin(), { total: 5, open: 3, awaitingAdmin: 2, answered: 1, resolved: 2, resolvedByAdmin: 1, closedByUser: 1 });
      assert.equal(svc.replyAsAdmin(admin, s.awaiting, { message: 'پاسخ' }).ok, true);
      assert.equal(svc.countsForAdmin().awaitingAdmin, 1);
      userReply(s.answered); // کارمند دوباره جواب داد ⇒ دوباره منتظر ادمین
      const c = svc.countsForAdmin();
      assert.deepEqual([c.awaitingAdmin, c.answered], [2, 1]);
    });

    test('اسکوپ شمارنده مثل فهرست است', () => {
      seed();
      assert.deepEqual(svc.countsForAdmin({ userIds: [emp2.id] }), { total: 2, open: 0, awaitingAdmin: 0, answered: 0, resolved: 2, resolvedByAdmin: 1, closedByUser: 1 });
      assert.equal(svc.countsForAdmin({ userIds: [] }).total, 0);
    });
  });

  describe('thread کامل (getForAdmin)', () => {
    test('پیام‌ها به ترتیب، با فرستنده‌ی هر پیام (نام و نقش) و خلاصه‌ی اعتراض', () => {
      const d = open(emp, 'اول', record.id);
      staffReply(d.id, 'دوم');
      userReply(d.id, 'سوم');
      const r = svc.getForAdmin(d.id);
      assert.equal(r.ok, true);
      assert.deepEqual(r.messages.map((m) => [m.senderRole, m.message]), [['user', 'اول'], ['admin', 'دوم'], ['user', 'سوم']]);
      assert.deepEqual(r.messages[0].sender, { id: emp.id, fullName: 'کارمند', role: 'employee' });
      assert.deepEqual(r.messages[1].sender, { id: admin.id, fullName: 'ادمین', role: 'admin' });
      assert.ok(r.messages.every((m) => Number.isInteger(m.id) && m.createdAt));
      assert.deepEqual([r.dispute.messageCount, r.dispute.phase, r.dispute.recordDate], [3, 'open', '2026-09-20']);
    });

    test('اعتراض قدیمیِ بدون پیام: متن اولیه اولین پیام است؛ فرستنده‌ی حذف‌شده ⇒ sender=null', () => {
      const legacy = Number(db.prepare("INSERT INTO record_disputes (user_id, message) VALUES (?, 'قدیمی')").run(emp.id).lastInsertRowid);
      const r = svc.getForAdmin(legacy);
      assert.deepEqual(r.messages.map((m) => [m.id, m.senderRole, m.message]), [[null, 'user', 'قدیمی']]);
      const gone = F.makeUser({ role: 'manager', name: 'حذف‌شونده' });
      const d = open(emp);
      repo.addMessage({ disputeId: d.id, senderUserId: gone.id, senderRole: 'admin', message: 'پاسخ' });
      db.prepare('UPDATE dispute_messages SET sender_user_id = NULL WHERE dispute_id = ? AND sender_role = ?').run(d.id, 'admin');
      assert.equal(svc.getForAdmin(d.id).messages[1].sender, null);
    });

    test('ناموجود/نامعتبر ⇒ NOT_FOUND (۴۰۴)', () => {
      for (const id of [99999, 0, -1, 'abc', null, undefined, 1.5]) {
        const r = svc.getForAdmin(id);
        assert.deepEqual([r.ok, r.code, svc.statusOf(r.code)], [false, 'NOT_FOUND', 404], String(id));
      }
    });
  });

  describe('پاسخ ادمین (replyAsAdmin)', () => {
    test('پاسخ روی اعتراضِ باز: ثبت پیام، phase ⇒ answered، last_message_at به‌روز، فرستنده = ادمین', () => {
      const d = open();
      const r = svc.replyAsAdmin(admin, d.id, { message: '  بررسی شد، اصلاح می‌شود  ' });
      assert.equal(r.ok, true);
      assert.equal(r.message.message, 'بررسی شد، اصلاح می‌شود');
      assert.ok(Number.isInteger(r.message.id));
      assert.equal(r.dispute.phase, 'answered');
      assert.equal(r.dispute.awaitingAdmin, false);
      assert.deepEqual(r.messages.map((m) => m.senderRole), ['user', 'admin']);
      assert.equal(r.messages[1].sender.id, admin.id);
      assert.equal(repo.findById(d.id).status, 'open', 'پاسخ وضعیت را عوض نمی‌کند');
    });

    test('سرپرست هم پاسخ می‌دهد؛ نقش پیام «admin» (نقش‌های پیام: user | admin)', () => {
      const d = open();
      const r = svc.replyAsAdmin(mgr, d.id, { message: 'سلام' });
      assert.equal(r.ok, true);
      assert.equal(r.messages[1].senderRole, 'admin');
      assert.equal(r.messages[1].sender.role, 'manager');
    });

    test('اعتبارسنجی: خالی/فقط فاصله/غیرمتن/بیش از ۵۰۰ ⇒ VALIDATION و چیزی ثبت نمی‌شود؛ دقیقاً ۵۰۰ مجاز', () => {
      const d = open();
      for (const bad of [undefined, null, '', '  \n ', 5, {}, 'ا'.repeat(501)]) {
        const r = svc.replyAsAdmin(admin, d.id, { message: bad });
        assert.deepEqual([r.ok, r.code, svc.statusOf(r.code)], [false, 'VALIDATION', 400], String(bad));
      }
      assert.equal(repo.listMessages(d.id).length, 1);
      assert.equal(svc.replyAsAdmin(admin, d.id, { message: 'ا'.repeat(500) }).ok, true);
    });

    test('اعتراضِ بسته ⇒ DISPUTE_CLOSED (۴۰۹)؛ ناموجود ⇒ NOT_FOUND؛ پیامی ثبت نمی‌شود', () => {
      const d = open();
      repo.setStatus(d.id, 'resolved');
      const r = svc.replyAsAdmin(admin, d.id, { message: 'x' });
      assert.deepEqual([r.ok, r.code, svc.statusOf(r.code)], [false, 'DISPUTE_CLOSED', 409]);
      assert.equal(repo.listMessages(d.id).length, 1);
      assert.equal(svc.replyAsAdmin(admin, 99999, { message: 'x' }).code, 'NOT_FOUND');
    });

    test('sanitizeText: توکن بات در پیام ادمین ذخیره نمی‌شود', () => {
      const token = '123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'; // secret-scan:allow (ساختگی)
      const d = open();
      const r = svc.replyAsAdmin(admin, d.id, { message: `توکن ${token}` });
      assert.ok(!r.message.message.includes(token));
      assert.ok(r.message.message.includes('[REDACTED]'));
    });

    test('اعتراض قدیمیِ بدون پیام: با اولین پاسخ، پیام اولیه هم در thread می‌نشیند (۲ پیام)', () => {
      const legacy = Number(db.prepare("INSERT INTO record_disputes (user_id, message) VALUES (?, 'قدیمی')").run(emp.id).lastInsertRowid);
      const r = svc.replyAsAdmin(admin, legacy, { message: 'پاسخ' });
      assert.deepEqual(r.messages.map((m) => [m.senderRole, m.message]), [['user', 'قدیمی'], ['admin', 'پاسخ']]);
    });
  });

  describe('بستن (resolveAsAdmin)', () => {
    test('بدون یادداشت: resolved با closed_by=admin و closed_at؛ پیامی اضافه نمی‌شود', () => {
      const d = open();
      const r = svc.resolveAsAdmin(admin, d.id, {});
      assert.equal(r.ok, true);
      assert.equal(r.note, null);
      assert.equal(r.updated.status, 'resolved');
      assert.equal(r.updated.closed_by, 'admin');
      assert.ok(r.updated.closed_at);
      assert.equal(r.before.status, 'open');
      assert.equal(repo.listMessages(d.id).length, 1);
      assert.equal(svc.listForAdmin()[0].phase, 'resolved');
    });

    test('با یادداشت: پیام پایانی آخرین پیام thread است (از ادمین)؛ در یک تراکنش با بستن', () => {
      const d = open();
      const r = svc.resolveAsAdmin(admin, d.id, { note: '  اصلاح شد  ' });
      assert.equal(r.ok, true);
      assert.equal(r.note, 'اصلاح شد');
      const msgs = repo.listMessages(d.id);
      assert.deepEqual(msgs.map((m) => [m.sender_role, m.sender_user_id, m.message]), [['user', emp.id, 'ساعت خروج من اشتباه ثبت شده'], ['admin', admin.id, 'اصلاح شد']]);
      assert.equal(repo.findById(d.id).last_message_at, msgs[1].created_at);
    });

    test('یادداشتِ خالی/فقط فاصله/null ⇒ بدون پیام؛ غیرمتن یا بیش از ۵۰۰ ⇒ VALIDATION و اعتراض باز می‌ماند', () => {
      for (const note of [undefined, null, '', '   ']) {
        const d = open();
        assert.equal(svc.resolveAsAdmin(admin, d.id, { note }).ok, true, String(note));
        assert.equal(repo.listMessages(d.id).length, 1);
      }
      const d = open();
      for (const bad of [5, {}, ['x'], 'ا'.repeat(501)]) {
        const r = svc.resolveAsAdmin(admin, d.id, { note: bad });
        assert.deepEqual([r.ok, r.code], [false, 'VALIDATION'], String(bad));
        assert.equal(repo.findById(d.id).status, 'open');
      }
    });

    test('اعتراضِ از قبل بسته ⇒ DISPUTE_ALREADY_CLOSED (۴۰۹) و closed_by قبلی (کارمند) بازنویسی نمی‌شود', () => {
      const d = open();
      repo.setStatus(d.id, 'resolved', { closedBy: 'user' });
      const before = repo.findById(d.id);
      const r = svc.resolveAsAdmin(admin, d.id, { note: 'دوباره' });
      assert.deepEqual([r.ok, r.code, svc.statusOf(r.code)], [false, 'DISPUTE_ALREADY_CLOSED', 409]);
      assert.deepEqual(repo.findById(d.id), before);
      assert.equal(repo.listMessages(d.id).length, 1);
      assert.equal(svc.resolveAsAdmin(admin, 99999, {}).code, 'NOT_FOUND');
    });

    test('ماهِ بسته مانع ادمین نیست (فقط‌خواندنی برای کارمند است)', () => {
      const d = open(emp, 'ماه بسته', record.id);
      closeMonth();
      assert.equal(svc.replyAsAdmin(admin, d.id, { message: 'پاسخ' }).ok, true);
      assert.equal(svc.resolveAsAdmin(admin, d.id, { note: 'بسته شد' }).ok, true);
      assert.equal(svc.reopenAsAdmin(admin, d.id, {}).ok, true);
    });
  });

  describe('بازگشایی (reopenAsAdmin)', () => {
    test('از resolved (توسط ادمین یا کارمند): باز می‌شود، closed_* پاک؛ reopen_count (سقف کارمند) زیاد نمی‌شود', () => {
      const a = open();
      repo.setStatus(a.id, 'resolved');
      const b = open();
      repo.setStatus(b.id, 'resolved', { closedBy: 'user' });
      for (const d of [a, b]) {
        const r = svc.reopenAsAdmin(admin, d.id, {});
        assert.equal(r.ok, true);
        assert.deepEqual([r.updated.status, r.updated.closed_by, r.updated.closed_at, r.updated.reopen_count], ['open', null, null, 0]);
        assert.equal(r.message, null);
        assert.equal(r.before.status, 'resolved');
        assert.equal(repo.listMessages(d.id).length, 1, 'بدون یادداشت ⇒ بدون پیام');
      }
    });

    test('با یادداشت: پیام ادمین ثبت و برگردانده می‌شود (برای اعلان)؛ phase ⇒ answered', () => {
      const d = open();
      repo.setStatus(d.id, 'resolved');
      const r = svc.reopenAsAdmin(admin, d.id, { note: 'دوباره بررسی می‌کنم' });
      assert.equal(r.ok, true);
      assert.equal(r.note, 'دوباره بررسی می‌کنم');
      const last = repo.listMessages(d.id).slice(-1)[0];
      assert.deepEqual(r.message, { id: last.id, message: 'دوباره بررسی می‌کنم' });
      assert.deepEqual([last.sender_role, last.sender_user_id], ['admin', admin.id]);
      assert.equal(svc.listForAdmin()[0].phase, 'answered');
    });

    test('اعتراضِ باز ⇒ DISPUTE_NOT_CLOSED (۴۰۹)؛ یادداشت نامعتبر ⇒ VALIDATION؛ ناموجود ⇒ NOT_FOUND', () => {
      const d = open();
      const r = svc.reopenAsAdmin(admin, d.id, {});
      assert.deepEqual([r.ok, r.code, svc.statusOf(r.code)], [false, 'DISPUTE_NOT_CLOSED', 409]);
      repo.setStatus(d.id, 'resolved');
      assert.equal(svc.reopenAsAdmin(admin, d.id, { note: 'ا'.repeat(501) }).code, 'VALIDATION');
      assert.equal(repo.findById(d.id).status, 'resolved');
      assert.equal(svc.reopenAsAdmin(admin, 99999, {}).code, 'NOT_FOUND');
    });

    test('سقف کارمند دست‌نخورده: reopen ادمین به سهمیه‌ی reopen کارمند (disputeMaxReopens) نمی‌شمارد', () => {
      const settings = require('../src/repositories/settingsRepository');
      const d = open();
      repo.setStatus(d.id, 'resolved');
      const prev = settings.getAll().disputeMaxReopens;
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('dispute_max_reopens', '1')").run();
      try {
        assert.equal(svc.reopenAsAdmin(admin, d.id, {}).ok, true); // ادمین باز کرد
        repo.setStatus(d.id, 'resolved');
        const r = svc.reopen(emp, d.id, { message: 'ادامه می‌دهم' }); // سهمیه‌ی ۱ تایی کارمند هنوز سالم است
        assert.equal(r.ok, true);
        assert.equal(repo.findById(d.id).reopen_count, 1);
      } finally {
        db.prepare("DELETE FROM settings WHERE key = 'dispute_max_reopens'").run();
        assert.equal(settings.getAll().disputeMaxReopens, prev);
      }
    });
  });

  test('چرخه‌ی کامل: ثبت ⇒ پاسخ ادمین ⇒ بستن با پیام ⇒ ادامه‌ی کارمند ⇒ پاسخ ⇒ بستن ⇒ باز کردن ادمین', () => {
    const d = open();
    assert.equal(svc.replyAsAdmin(admin, d.id, { message: 'بررسی می‌کنم' }).dispute.phase, 'answered');
    assert.equal(svc.resolveAsAdmin(admin, d.id, { note: 'اصلاح شد' }).ok, true);
    assert.equal(svc.reopen(emp, d.id, { message: 'هنوز درست نشده' }).ok, true);
    assert.equal(svc.getForAdmin(d.id).dispute.awaitingAdmin, true);
    assert.equal(svc.replyAsAdmin(admin, d.id, { message: 'درست شد' }).ok, true);
    assert.equal(svc.close(emp, d.id).ok, true); // خاتمه توسط کارمند
    assert.equal(svc.getForAdmin(d.id).dispute.phase, 'closed_by_user');
    assert.equal(svc.reopenAsAdmin(admin, d.id, {}).ok, true);
    const t = svc.getForAdmin(d.id);
    assert.deepEqual([t.dispute.status, t.dispute.reopenCount, t.dispute.messageCount], ['open', 1, 5]);
  });
});

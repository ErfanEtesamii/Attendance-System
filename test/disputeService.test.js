// D2 (فاز ۱۱): سرویس اعتراضِ کارمند — مالکیت، ارسال پیام، ادامه‌ی اعتراض با سقف، خاتمه توسط کارمند، ماه بسته، audit.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

describe('disputeService — اعتراض کارمند و گفت‌وگو (D2)', () => {
  let db; let svc; let repo; let F; let settings; let attendanceRepo;
  let emp; let other; let admin; let record; let otherRecord;

  before(() => {
    db = resetDb();
    F = require('./helpers/factories');
    svc = require('../src/services/disputeService');
    repo = require('../src/repositories/disputeRepository');
    settings = require('../src/repositories/settingsRepository');
    attendanceRepo = require('../src/repositories/attendanceRepository');
    emp = F.makeUser({ name: 'کارمند' });
    other = F.makeUser({ name: 'همکار' });
    admin = F.makeUser({ role: 'admin', name: 'ادمین' });
    record = attendanceRepo.createManual({ userId: emp.id, recordDate: '2026-09-20', checkInTime: '2026-09-20T05:00:00.000Z', checkOutTime: '2026-09-20T13:00:00.000Z', status: 'normal' });
    otherRecord = attendanceRepo.createManual({ userId: other.id, recordDate: '2026-09-20', checkInTime: '2026-09-20T05:00:00.000Z', checkOutTime: '2026-09-20T13:00:00.000Z', status: 'normal' });
  });
  after(cleanup);
  beforeEach(() => {
    for (const t of ['dispute_messages', 'record_disputes', 'month_closures', 'audit_log']) db.prepare(`DELETE FROM ${t}`).run();
    db.prepare("DELETE FROM settings WHERE key = 'dispute_max_reopens'").run();
  });

  const open = (message = 'ساعت خروج من اشتباه ثبت شده') => {
    const r = svc.create(emp, { attendanceRecordId: record.id, message });
    assert.equal(r.ok, true);
    return r.dispute;
  };
  const adminReply = (id, text = 'در حال بررسی') => repo.addMessage({ disputeId: id, senderUserId: admin.id, senderRole: 'admin', message: text });
  const adminResolve = (id) => repo.setStatus(id, 'resolved'); // مسیر فعلی ادمین
  const audits = (action) => db.prepare('SELECT * FROM audit_log WHERE action = ?').all(action);
  const closeMonth = () => db.prepare("INSERT INTO month_closures (jalali_year, jalali_month, status, period_from, period_to) VALUES (1405, 6, 'closed', '2026-08-23', '2026-09-22')").run();

  describe('ثبت اعتراض', () => {
    test('پیام اولیه در thread نوشته می‌شود و audit ثبت می‌شود', () => {
      const d = open('متن اعتراض');
      assert.equal(d.status, 'open');
      assert.deepEqual(repo.listMessages(d.id).map((m) => [m.sender_role, m.message]), [['user', 'متن اعتراض']]);
      assert.equal(audits('record_dispute_submitted').length, 1);
    });

    test('اعتبارسنجی: خالی/فقط فاصله/غیرمتن/بیش از ۵۰۰ نویسه ⇒ VALIDATION (۴۰۰)؛ دقیقاً ۵۰۰ مجاز', () => {
      for (const bad of [undefined, null, '', '   \n ', 123, {}, 'ا'.repeat(501)]) {
        const r = svc.create(emp, { message: bad });
        assert.equal(r.ok, false, String(bad));
        assert.equal(r.code, 'VALIDATION');
        assert.equal(svc.statusOf(r.code), 400);
      }
      assert.equal(svc.create(emp, { message: 'ا'.repeat(500) }).ok, true);
      assert.equal(db.prepare('SELECT COUNT(*) n FROM record_disputes').get().n, 1);
    });

    test('رکورد دیگران یا ناموجود ⇒ NOT_FOUND و چیزی ساخته نمی‌شود', () => {
      for (const id of [otherRecord.id, 99999]) {
        const r = svc.create(emp, { attendanceRecordId: id, message: 'x' });
        assert.deepEqual([r.ok, r.code], [false, 'NOT_FOUND']);
      }
      assert.equal(db.prepare('SELECT COUNT(*) n FROM record_disputes').get().n, 0);
    });

    test('sanitizeText: توکن بات در متن پیام ذخیره نمی‌شود', () => {
      const token = '123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'; // secret-scan:allow (ساختگی)
      const d = svc.create(emp, { message: `توکن ${token} را دیدم` }).dispute;
      assert.ok(!d.message.includes(token));
      assert.ok(repo.listMessages(d.id)[0].message.includes('[REDACTED]'));
    });
  });

  describe('فهرست و thread (فقط مالک)', () => {
    test('listMine: فقط اعتراض‌های خودِ کارمند، با وضعیت (phase)، تعداد پیام و امکان‌ها', () => {
      const a = open('الف');
      svc.create(other, { message: 'مال همکار' });
      adminReply(a.id);
      const list = svc.listMine(emp);
      assert.equal(list.length, 1);
      const x = list[0];
      assert.equal(x.id, a.id);
      assert.deepEqual([x.message_count, x.last_sender_role, x.phase, x.status], [2, 'admin', 'answered', 'open']);
      assert.deepEqual([x.can_reply, x.can_close, x.can_reopen, x.record_date, x.max_reopens], [true, true, false, '2026-09-20', 3]);
    });

    test('phase: open ⇒ answered ⇒ open (پاسخ کارمند) ⇒ resolved ⇒ closed_by_user', () => {
      const d = open();
      const phase = () => svc.listMine(emp)[0].phase;
      assert.equal(phase(), 'open');
      adminReply(d.id);
      assert.equal(phase(), 'answered');
      assert.equal(svc.postMessage(emp, d.id, { message: 'ممنون' }).ok, true);
      assert.equal(phase(), 'open');
      adminResolve(d.id);
      assert.equal(phase(), 'resolved');
      assert.equal(svc.reopen(emp, d.id, { message: 'ادامه' }).ok, true);
      assert.equal(svc.close(emp, d.id).ok, true);
      assert.equal(phase(), 'closed_by_user');
    });

    test('getMine: thread کامل با is_mine؛ اعتراض دیگران/ناموجود/شناسه‌ی نامعتبر ⇒ NOT_FOUND (۴۰۴)', () => {
      const d = open('اول');
      adminReply(d.id, 'پاسخ');
      const r = svc.getMine(emp, d.id);
      assert.equal(r.ok, true);
      assert.deepEqual(r.messages.map((m) => [m.sender_role, m.is_mine, m.message]), [['user', true, 'اول'], ['admin', false, 'پاسخ']]);
      assert.equal(r.dispute.message_count, 2);
      for (const id of [d.id, 99999, 'abc', '1; DROP TABLE users', -1, '']) {
        const res = svc.getMine(other, id);
        assert.deepEqual([res.ok, res.code], [false, 'NOT_FOUND'], String(id));
        assert.equal(svc.statusOf(res.code), 404);
      }
      assert.equal(svc.getMine(emp, 99999).code, 'NOT_FOUND');
    });

    test('اعتراض قدیمی بدون پیام: thread همان متن اولیه است', () => {
      const id = db.prepare("INSERT INTO record_disputes (user_id, message) VALUES (?, 'قدیمی')").run(emp.id).lastInsertRowid;
      const r = svc.getMine(emp, id);
      assert.deepEqual(r.messages.map((m) => [m.sender_role, m.is_mine, m.message]), [['user', true, 'قدیمی']]);
      assert.equal(svc.listMine(emp)[0].message_count, 1);
    });
  });

  describe('ارسال پیام', () => {
    test('روی اعتراضِ باز: ذخیره می‌شود، thread برمی‌گردد، audit بدون متن پیام ثبت می‌شود', () => {
      const d = open();
      const r = svc.postMessage(emp, d.id, { message: '  توضیح بیشتر  ' }, { ip: '192.168.10.9' });
      assert.equal(r.ok, true);
      assert.deepEqual(r.messages.map((m) => m.message), ['ساعت خروج من اشتباه ثبت شده', 'توضیح بیشتر']);
      assert.equal(r.dispute.message_count, 2);
      const [a] = audits('record_dispute_message_sent');
      assert.equal(a.user_id, emp.id);
      assert.equal(a.ip_address, '192.168.10.9');
      const details = JSON.parse(a.details);
      assert.equal(details.disputeId, d.id);
      assert.ok(!a.details.includes('توضیح بیشتر'), 'متن پیام نباید در audit بیاید');
    });

    test('اعتبارسنجی: خالی ⇒ ۴۰۰؛ ۵۰۰ نویسه مجاز؛ ۵۰۱ ⇒ ۴۰۰؛ چیزی ذخیره نمی‌شود', () => {
      const d = open();
      for (const bad of [undefined, '', '   ', 42, 'ب'.repeat(501)]) {
        const r = svc.postMessage(emp, d.id, { message: bad });
        assert.deepEqual([r.ok, r.code], [false, 'VALIDATION']);
      }
      assert.equal(repo.listMessages(d.id).length, 1);
      assert.equal(svc.postMessage(emp, d.id, { message: 'ب'.repeat(500) }).ok, true);
      assert.equal(svc.postMessage(emp, d.id, undefined).code, 'VALIDATION');
    });

    test('اعتراض دیگران ⇒ NOT_FOUND و پیامی ثبت نمی‌شود', () => {
      const d = open();
      const r = svc.postMessage(other, d.id, { message: 'نفوذ' });
      assert.deepEqual([r.ok, r.code], [false, 'NOT_FOUND']);
      assert.equal(repo.listMessages(d.id).length, 1);
    });

    test('اعتراضِ بسته ⇒ DISPUTE_CLOSED (۴۰۹) با راهنمای «ادامه‌ی اعتراض»', () => {
      const d = open();
      adminResolve(d.id);
      const r = svc.postMessage(emp, d.id, { message: 'هنوز مشکل دارم' });
      assert.deepEqual([r.ok, r.code], [false, 'DISPUTE_CLOSED']);
      assert.equal(svc.statusOf(r.code), 409);
      assert.match(r.error, /ادامه‌ی اعتراض/);
      assert.equal(repo.listMessages(d.id).length, 1);
    });
  });

  describe('ادامه‌ی اعتراض (reopen) و سقف', () => {
    test('بعد از حل‌شدن توسط ادمین: باز می‌شود، پیام جدید ثبت و reopen_count زیاد می‌شود، audit ثبت می‌شود', () => {
      const d = open();
      adminResolve(d.id);
      const r = svc.reopen(emp, d.id, { message: 'هنوز درست نشده' }, { ip: '192.168.10.9' });
      assert.equal(r.ok, true);
      assert.deepEqual([r.dispute.status, r.dispute.phase, r.dispute.reopen_count, r.dispute.closed_by, r.dispute.message_count], ['open', 'open', 1, null, 2]);
      assert.equal(r.messages[1].message, 'هنوز درست نشده');
      const [a] = audits('record_dispute_reopened_by_user');
      assert.equal(JSON.parse(a.details).reopenCount, 1);
    });

    test('اعتراضِ هنوز باز ⇒ DISPUTE_NOT_CLOSED؛ بدون پیام ⇒ VALIDATION؛ دیگران ⇒ NOT_FOUND', () => {
      const d = open();
      assert.equal(svc.reopen(emp, d.id, { message: 'x' }).code, 'DISPUTE_NOT_CLOSED');
      adminResolve(d.id);
      assert.equal(svc.reopen(emp, d.id, {}).code, 'VALIDATION');
      assert.equal(svc.reopen(emp, d.id, { message: '  ' }).code, 'VALIDATION');
      assert.equal(svc.reopen(other, d.id, { message: 'x' }).code, 'NOT_FOUND');
      assert.equal(repo.findById(d.id).status, 'resolved');
      assert.equal(repo.findById(d.id).reopen_count, 0);
    });

    test('سقف پیش‌فرض ۳: بار چهارم ⇒ REOPEN_LIMIT (۴۰۹)؛ بعد از آن can_reopen=false', () => {
      const d = open();
      for (let i = 1; i <= 3; i += 1) {
        adminResolve(d.id);
        assert.equal(svc.reopen(emp, d.id, { message: `ادامه ${i}` }).ok, true, `ادامه ${i}`);
      }
      adminResolve(d.id);
      assert.equal(svc.listMine(emp)[0].can_reopen, false);
      const r = svc.reopen(emp, d.id, { message: 'ادامه ۴' });
      assert.deepEqual([r.ok, r.code], [false, 'REOPEN_LIMIT']);
      assert.equal(svc.statusOf(r.code), 409);
      assert.match(r.error, /۳|3/);
      assert.equal(repo.findById(d.id).status, 'resolved');
      assert.equal(repo.findById(d.id).reopen_count, 3);
    });

    test('تنظیم disputeMaxReopens: مقدار دیگر اعمال می‌شود؛ ۰ = خاموش', () => {
      settings.update({ disputeMaxReopens: 1 });
      const d = open();
      adminResolve(d.id);
      assert.equal(svc.reopen(emp, d.id, { message: 'یک' }).ok, true);
      adminResolve(d.id);
      assert.equal(svc.reopen(emp, d.id, { message: 'دو' }).code, 'REOPEN_LIMIT');

      settings.update({ disputeMaxReopens: 0 });
      const e = open('دیگر');
      adminResolve(e.id);
      assert.equal(svc.listMine(emp).find((x) => x.id === e.id).can_reopen, false);
      const r = svc.reopen(emp, e.id, { message: 'x' });
      assert.deepEqual([r.ok, r.code], [false, 'REOPEN_LIMIT']);
    });

    test('بعد از خاتمه توسط خود کارمند هم می‌شود ادامه داد (و می‌شمارد)', () => {
      const d = open();
      svc.close(emp, d.id);
      const r = svc.reopen(emp, d.id, { message: 'پشیمان شدم' });
      assert.equal(r.ok, true);
      assert.deepEqual([r.dispute.reopen_count, r.dispute.closed_by], [1, null]);
    });

    test('reopen ادمین (مسیر فعلی) به سقف کارمند نمی‌شمارد', () => {
      const d = open();
      for (let i = 0; i < 5; i += 1) { adminResolve(d.id); repo.setStatus(d.id, 'open'); }
      assert.equal(repo.findById(d.id).reopen_count, 0);
      adminResolve(d.id);
      assert.equal(svc.reopen(emp, d.id, { message: 'ادامه' }).ok, true);
    });
  });

  describe('خاتمه توسط کارمند', () => {
    test('فقط وقتی باز است: closed_by=user با closed_at؛ audit ثبت می‌شود؛ بار دوم ⇒ DISPUTE_ALREADY_CLOSED', () => {
      const d = open();
      const r = svc.close(emp, d.id, { ip: '192.168.10.9' });
      assert.equal(r.ok, true);
      assert.deepEqual([r.dispute.status, r.dispute.closed_by, r.dispute.phase, r.dispute.can_reply, r.dispute.can_close, r.dispute.can_reopen], ['resolved', 'user', 'closed_by_user', false, false, true]);
      assert.ok(r.dispute.closed_at);
      assert.equal(audits('record_dispute_closed_by_user').length, 1);
      const again = svc.close(emp, d.id);
      assert.deepEqual([again.ok, again.code], [false, 'DISPUTE_ALREADY_CLOSED']);
      assert.equal(audits('record_dispute_closed_by_user').length, 1);
    });

    test('اعتراضِ حل‌شده توسط ادمین را نمی‌شود دوباره بست؛ دیگران ⇒ NOT_FOUND و وضعیت عوض نمی‌شود', () => {
      const d = open();
      assert.equal(svc.close(other, d.id).code, 'NOT_FOUND');
      assert.equal(repo.findById(d.id).status, 'open');
      adminResolve(d.id);
      assert.equal(svc.close(emp, d.id).code, 'DISPUTE_ALREADY_CLOSED');
      assert.equal(repo.findById(d.id).closed_by, 'admin');
    });
  });

  describe('ماه بسته', () => {
    test('اعتراض به رکوردِ ماه بسته‌شده: ارسال پیام/ادامه/خاتمه ⇒ MONTH_CLOSED (۴۰۹)؛ خواندن آزاد است', () => {
      const d = open();
      const resolved = open('دوم');
      adminResolve(resolved.id);
      closeMonth();
      for (const r of [svc.postMessage(emp, d.id, { message: 'x' }), svc.close(emp, d.id), svc.reopen(emp, resolved.id, { message: 'x' })]) {
        assert.deepEqual([r.ok, r.code], [false, 'MONTH_CLOSED']);
        assert.equal(svc.statusOf(r.code), 409);
      }
      assert.equal(repo.findById(d.id).status, 'open');
      assert.equal(repo.listMessages(d.id).length, 1);
      assert.equal(svc.getMine(emp, d.id).ok, true);
      assert.equal(svc.listMine(emp).length, 2);
    });

    test('اعتراضِ بدون رکورد با روز ثبتش سنجیده می‌شود', () => {
      const d = svc.create(emp, { message: 'بدون رکورد' }).dispute;
      db.prepare("UPDATE record_disputes SET created_at = '2026-09-10 09:00:00' WHERE id = ?").run(d.id);
      closeMonth();
      assert.equal(svc.postMessage(emp, d.id, { message: 'x' }).code, 'MONTH_CLOSED');
      db.prepare("UPDATE record_disputes SET created_at = '2026-11-10 09:00:00' WHERE id = ?").run(d.id);
      assert.equal(svc.postMessage(emp, d.id, { message: 'x' }).ok, true);
    });

    test('ماهِ بازگشایی‌شده (reopened) قفل نیست', () => {
      const d = open();
      closeMonth();
      db.prepare("UPDATE month_closures SET status = 'reopened'").run();
      assert.equal(svc.postMessage(emp, d.id, { message: 'x' }).ok, true);
    });
  });

  test('statusOf: نگاشت کدها به وضعیت HTTP', () => {
    assert.deepEqual(
      ['NOT_FOUND', 'VALIDATION', 'DISPUTE_CLOSED', 'DISPUTE_NOT_CLOSED', 'DISPUTE_ALREADY_CLOSED', 'REOPEN_LIMIT', 'MONTH_CLOSED', 'UNKNOWN'].map(svc.statusOf),
      [404, 400, 409, 409, 409, 409, 409, 400]
    );
  });
});

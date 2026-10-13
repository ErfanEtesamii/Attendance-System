// D4 (فاز ۱۱): اعلان‌های گفت‌وگوی اعتراض و سازگاری با بستن ماه.
//   • پیام تازه‌ی ادمین/سرپرست ⇒ اعلان پنل + تلگرام به کارمند؛ پیام تازه‌ی کارمند یا «ادامه‌ی اعتراض» ⇒ اعلان پنل به تأییدکننده‌ها (مثل disputeOpened).
//   • خطای اعلان هیچ‌وقت ثبت پیام را نمی‌شکند.
//   • اعتراضِ resolved یا خاتمه‌یافته توسط کارمند مانع بستن ماه نیست؛ باز یا reopen‌شده مانع است.
// بخش‌های اول و آخر بدون express اجرا می‌شوند؛ سیم‌کشی routeهای Mini App به express نیاز دارد (handlerها مستقیم و بدون سرور اجرا می‌شوند).
// تلگرام ماک است و باید قبل از require شدن اعلان‌ها جایگزین شود (notificationService هنگام load آن را می‌گیرد).
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

let hasExpress = true;
try { require.resolve('express'); } catch (_) { hasExpress = false; }

describe('اعلان‌های گفت‌وگوی اعتراض (D4)', () => {
  let db; let F; let events; let repo; let svc; let notifier;
  let admin; let admin2; let hr; let mgr; let emp; let empNoManager; let emp3;
  const telegram = [];
  let telegramFails = false;

  before(() => {
    db = resetDb();
    notifier = require('../src/bot/notifier');
    notifier.sendMessage = async (to, text) => {
      if (telegramFails) throw new Error('telegram down');
      telegram.push({ to: String(to), text });
      return true;
    };
    F = require('./helpers/factories');
    events = require('../src/services/notificationEvents');
    repo = require('../src/repositories/disputeRepository');
    svc = require('../src/services/disputeService');
    admin = F.makeUser({ role: 'admin', name: 'ادمین ۱' });
    admin2 = F.makeUser({ role: 'admin', name: 'ادمین ۲' });
    hr = F.makeUser({ role: 'hr', name: 'منابع انسانی' });
    mgr = F.makeUser({ role: 'manager', name: 'سرپرست' });
    emp = F.makeUser({ name: 'کارمند تیمی', managerId: mgr.id });
    empNoManager = F.makeUser({ name: 'کارمند بدون سرپرست' });
    emp3 = F.makeUser({ name: 'کارمند بدون تلگرام' });
    db.prepare('UPDATE users SET telegram_user_id = NULL WHERE id = ?').run(emp3.id);
  });
  after(cleanup);
  beforeEach(() => {
    for (const t of ['dispute_messages', 'record_disputes', 'notifications']) db.prepare(`DELETE FROM ${t}`).run();
    db.prepare('UPDATE users SET is_active = 1').run();
    telegram.length = 0;
    telegramFails = false;
  });

  const open = (user = emp, message = 'ساعت خروج اشتباه است') => {
    const r = svc.create(user, { message });
    assert.equal(r.ok, true);
    return r.dispute;
  };
  const saved = (m) => ({ id: m.id, message: m.message });
  const adminMsg = (d, text = 'در حال بررسی', by = admin) => saved(repo.addMessage({ disputeId: d.id, senderUserId: by.id, senderRole: 'admin', message: text }));
  const userMsg = (d, text = 'منتظرم', by = emp) => saved(repo.addMessage({ disputeId: d.id, senderUserId: by.id, senderRole: 'user', message: text }));
  const notifs = (user, type) => db.prepare('SELECT * FROM notifications WHERE user_id = ? AND type = ? ORDER BY id').all(user.id, type)
    .map((n) => ({ ...n, data: n.data ? JSON.parse(n.data) : null }));
  const total = (type) => db.prepare('SELECT COUNT(*) n FROM notifications WHERE type = ?').get(type).n;

  describe('disputeAdminMessage ⇒ کارمند (پنل + تلگرام)', () => {
    test('یک اعلان پنل با لینک/داده/عنوان و یک پیام تلگرام؛ فقط به خودِ کارمند', async () => {
      const d = open(emp);
      const m = adminMsg(d, 'مشکل بررسی شد');
      await events.disputeAdminMessage(d, m, { actor: admin });
      const n = notifs(emp, 'dispute_admin_message');
      assert.equal(n.length, 1);
      assert.equal(n[0].title, 'پاسخ تازه به اعتراض شما');
      assert.equal(n[0].body, 'پاسخ ادمین: مشکل بررسی شد');
      assert.equal(n[0].link, '#/disputes');
      assert.deepEqual(n[0].data, { disputeId: d.id, messageId: m.id });
      assert.equal(n[0].telegram_status, 'sent');
      assert.equal(telegram.length, 1);
      assert.equal(telegram[0].to, String(emp.telegram_user_id));
      assert.match(telegram[0].text, /پاسخ تازه به اعتراض شما[\s\S]*مشکل بررسی شد/);
      assert.equal(total('dispute_admin_message'), 1, 'به هیچ‌کس دیگری اعلان نمی‌رود');
    });

    test('برچسب فرستنده: ادمین ⇒ «ادمین»، غیر از آن ⇒ «سرپرست»', async () => {
      const d = open(emp);
      await events.disputeAdminMessage(d, adminMsg(d, 'الف', admin), { actor: admin });
      await events.disputeAdminMessage(d, adminMsg(d, 'ب', mgr), { actor: mgr });
      assert.deepEqual(notifs(emp, 'dispute_admin_message').map((n) => n.body), ['پاسخ ادمین: الف', 'پاسخ سرپرست: ب']);
    });

    test('dedupe با شناسه‌ی پیام: ثبت مجدد همان پیام ⇒ نه اعلان دوباره نه تلگرام دوباره؛ پیام تازه ⇒ اعلان تازه', async () => {
      const d = open(emp);
      const m1 = adminMsg(d, 'یک');
      await events.disputeAdminMessage(d, m1, { actor: admin });
      await events.disputeAdminMessage(d, m1, { actor: admin });
      assert.equal(notifs(emp, 'dispute_admin_message').length, 1);
      assert.equal(telegram.length, 1);
      await events.disputeAdminMessage(d, adminMsg(d, 'دو'), { actor: admin });
      assert.equal(notifs(emp, 'dispute_admin_message').length, 2);
      assert.equal(telegram.length, 2);
    });

    test('کارمند بدون آیدی تلگرام: اعلان پنل ثبت می‌شود، تلگرام skipped', async () => {
      const d = open(emp3);
      await events.disputeAdminMessage(d, adminMsg(d, 'پاسخ'), { actor: admin });
      const n = notifs(emp3, 'dispute_admin_message');
      assert.equal(n.length, 1);
      assert.equal(n[0].telegram_status, 'skipped');
      assert.equal(telegram.length, 0);
    });

    test('خطای تلگرام: اعلان پنل می‌ماند (failed) و استثنا نمی‌دهد', async () => {
      const d = open(emp);
      telegramFails = true;
      const out = await events.disputeAdminMessage(d, adminMsg(d), { actor: admin });
      assert.equal(out.length, 1);
      assert.equal(notifs(emp, 'dispute_admin_message')[0].telegram_status, 'failed');
    });

    test('ورودی/گیرنده‌ی خراب هرگز استثنا نمی‌دهد (اعلان جریان اصلی را نمی‌شکند)', async () => {
      assert.deepEqual(await events.disputeAdminMessage(null, { id: 1, message: 'x' }), []);
      assert.deepEqual(await events.disputeAdminMessage({ id: 1, user_id: emp.id }, null), []);
      assert.deepEqual(await events.disputeAdminMessage({ id: 1, user_id: emp.id }, { message: 'بدون شناسه' }), []);
      assert.deepEqual(await events.disputeAdminMessage({ id: 1, user_id: 999999 }, { id: 5, message: 'گیرنده‌ی ناموجود' }), []);
      assert.equal(total('dispute_admin_message'), 0);
    });

    test('متن بلند اعلان کوتاه می‌شود (۳۰۰ نویسه) و توکن بات در بدنه نمی‌آید', async () => {
      const d = open(emp);
      const token = '123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'; // secret-scan:allow (ساختگی)
      await events.disputeAdminMessage(d, { id: adminMsg(d, 'x').id, message: `${token} ${'ا'.repeat(450)}` }, { actor: admin });
      const body = notifs(emp, 'dispute_admin_message')[0].body;
      assert.ok(!body.includes(token));
      assert.ok(body.endsWith('…') && body.length <= 'پاسخ ادمین: '.length + 301, 'کوتاه‌شده با «…»');
    });
  });

  describe('disputeUserMessage ⇒ تأییدکننده‌ها (فقط پنل)', () => {
    test('کارمندِ دارای سرپرست فعال: فقط سرپرست؛ ادمین/hr/خود کارمند اعلان نمی‌گیرند؛ تلگرام نمی‌رود', async () => {
      const d = open(emp);
      const m = userMsg(d, 'هنوز درست نشده');
      await events.disputeUserMessage(d, m);
      const n = notifs(mgr, 'dispute_user_message');
      assert.equal(n.length, 1);
      assert.equal(n[0].title, 'پیام تازه در اعتراض');
      assert.equal(n[0].body, 'کارمند تیمی: هنوز درست نشده');
      assert.equal(n[0].link, '#/disputes');
      assert.deepEqual(n[0].data, { disputeId: d.id, employeeId: emp.id, messageId: m.id, reopened: false });
      assert.equal(total('dispute_user_message'), 1);
      assert.equal(telegram.length, 0, 'مثل disputeOpened فقط پنل');
    });

    test('بدون سرپرست یا سرپرستِ غیرفعال ⇒ همه‌ی ادمین‌های فعال (نه hr، نه ادمین غیرفعال)', async () => {
      const d1 = open(empNoManager);
      await events.disputeUserMessage(d1, userMsg(d1, 'سلام', empNoManager));
      assert.deepEqual([notifs(admin, 'dispute_user_message').length, notifs(admin2, 'dispute_user_message').length, notifs(hr, 'dispute_user_message').length, notifs(mgr, 'dispute_user_message').length], [1, 1, 0, 0]);

      db.prepare('UPDATE users SET is_active = 0 WHERE id IN (?, ?)').run(mgr.id, admin2.id);
      const d2 = open(emp);
      await events.disputeUserMessage(d2, userMsg(d2, 'سرپرستم غیرفعال است'));
      assert.equal(notifs(mgr, 'dispute_user_message').length, 0);
      assert.equal(notifs(admin, 'dispute_user_message').length, 2);
      assert.equal(notifs(admin2, 'dispute_user_message').length, 1, 'ادمین غیرفعال چیزی نمی‌گیرد');
    });

    test('«ادامه‌ی اعتراض» (reopened) عنوان و داده‌ی خودش را دارد', async () => {
      const d = open(emp);
      await events.disputeUserMessage(d, userMsg(d, 'ادامه می‌دهم'), { reopened: true });
      const n = notifs(mgr, 'dispute_user_message')[0];
      assert.equal(n.title, 'کارمند اعتراض را ادامه داد');
      assert.equal(n.data.reopened, true);
    });

    test('dedupe با شناسه‌ی پیام؛ کارمند ناموجود/ورودی خراب ⇒ [] بدون استثنا', async () => {
      const d = open(emp);
      const m = userMsg(d);
      await events.disputeUserMessage(d, m);
      await events.disputeUserMessage(d, m);
      assert.equal(notifs(mgr, 'dispute_user_message').length, 1);
      assert.deepEqual(await events.disputeUserMessage({ id: 1, user_id: 999999 }, { id: 9, message: 'x' }), []);
      assert.deepEqual(await events.disputeUserMessage(null, { id: 1, message: 'x' }), []);
      assert.deepEqual(await events.disputeUserMessage(d, undefined), []);
    });

    test('متن بلند: بدنه‌ی اعلان حداکثر ۲۰۰ نویسه از پیام را نشان می‌دهد', async () => {
      const d = open(emp);
      await events.disputeUserMessage(d, { id: userMsg(d, 'x').id, message: 'ب'.repeat(450) });
      const body = notifs(mgr, 'dispute_user_message')[0].body;
      assert.ok(body.endsWith('…') && body.length <= 'کارمند تیمی: '.length + 201, 'کوتاه‌شده با «…»');
    });
  });

  describe('Mini App: سیم‌کشی اعلان به routeها', { skip: hasExpress ? false : 'express نصب نیست (npm install)' }, () => {
    let router;
    before(() => { router = require('../src/api/routes/miniapp'); });

    // آخرین handlerِ هر route (middlewareها مثل rate limit کنار گذاشته می‌شوند؛ سقف/احراز هویت تست خودشان را دارند)
    function handle(method, path, user, params, body) {
      const layer = router.stack.filter((l) => l.route).find((l) => l.route.path === path && l.route.methods[method]);
      assert.ok(layer, `${method} ${path}`);
      const fn = layer.route.stack[layer.route.stack.length - 1].handle;
      const req = { ...F.fakeReq({ method: method.toUpperCase(), url: `/api${path}`, body }), miniAppUser: user, params, ip: '127.0.0.1' };
      const res = F.fakeRes();
      fn(req, res);
      return new Promise((r) => setTimeout(() => r({ status: res.statusCode, body: res.body }), 15));
    }
    const post = (user, id, message) => handle('post', '/miniapp/dispute/:id/messages', user, { id: String(id) }, { message });
    const reopen = (user, id, message) => handle('post', '/miniapp/dispute/:id/reopen', user, { id: String(id) }, { message });

    test('پیام کارمند ⇒ اعلان به سرپرست با شناسه‌ی همان پیام؛ پیام نامعتبر/اعتراض بسته ⇒ اعلان نه', async () => {
      const d = open(emp);
      const r = await post(emp, d.id, 'پیام جدید من');
      assert.equal(r.status, 201);
      const lastId = r.body.messages[r.body.messages.length - 1].id;
      const n = notifs(mgr, 'dispute_user_message');
      assert.equal(n.length, 1);
      assert.equal(n[0].data.messageId, lastId);
      assert.match(n[0].body, /پیام جدید من/);

      assert.equal((await post(emp, d.id, '   ')).status, 400);
      repo.setStatus(d.id, 'resolved');
      assert.equal((await post(emp, d.id, 'بعد از بسته‌شدن')).status, 409);
      assert.equal(notifs(mgr, 'dispute_user_message').length, 1);
    });

    test('«ادامه‌ی اعتراض» ⇒ اعلان reopened=true؛ سقف پر ⇒ ۴۰۹ و اعلان نه', async () => {
      const d = open(emp);
      repo.setStatus(d.id, 'resolved');
      const r = await reopen(emp, d.id, 'ادامه می‌دهم');
      assert.equal(r.status, 200);
      const n = notifs(mgr, 'dispute_user_message');
      assert.equal(n.length, 1);
      assert.equal(n[0].data.reopened, true);

      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('dispute_max_reopens', '1')").run();
      try {
        repo.setStatus(d.id, 'resolved');
        const full = await reopen(emp, d.id, 'بار دوم');
        assert.deepEqual([full.status, full.body.code], [409, 'REOPEN_LIMIT']);
        assert.equal(notifs(mgr, 'dispute_user_message').length, 1);
      } finally {
        db.prepare("DELETE FROM settings WHERE key = 'dispute_max_reopens'").run();
      }
    });

    test('اعتراضِ دیگران ⇒ ۴۰۴ و اعلانی ساخته نمی‌شود', async () => {
      const d = open(empNoManager);
      assert.equal((await post(emp, d.id, 'x')).status, 404);
      assert.equal(total('dispute_user_message'), 0);
    });

    test('خرابیِ اعلان ثبت پیام را نمی‌شکند: گیرنده‌ی اعلان خطا بدهد پیام همچنان ۲۰۱ و ثبت‌شده است', async () => {
      const d = open(emp);
      db.prepare('DROP TABLE notifications').run(); // خطای واقعی دیتابیس هنگام درج اعلان
      try {
        const r = await post(emp, d.id, 'پیام با اعلانِ خراب');
        assert.equal(r.status, 201);
        assert.equal(repo.listMessages(d.id).length, 2);
      } finally {
        // بازسازی جدول برای تست‌های بعدی (migration 012)
        require('../src/db/migrations/012_notifications').up(db);
      }
    });
  });
});

describe('سازگاری با بستن ماه (D4)', () => {
  const { getDb } = require('../src/db/connection');
  let db; let svc; let repo; let F; let attendanceRepo; let monthClose; let settingsRepo; let zonedTimeToUtc;
  let admin; let emp;
  const Y = 1405; const M = 6; // شهریور ۱۴۰۵ = ۲۰۲۶-۰۸-۲۳ تا ۲۰۲۶-۰۹-۲۲
  const at = (date, hhmm) => zonedTimeToUtc(date, hhmm, 'Asia/Tehran').toISOString();
  let NOW;
  let record;

  before(() => {
    db = resetDb();
    F = require('./helpers/factories');
    svc = require('../src/services/disputeService');
    repo = require('../src/repositories/disputeRepository');
    attendanceRepo = require('../src/repositories/attendanceRepository');
    settingsRepo = require('../src/repositories/settingsRepository');
    monthClose = require('../src/services/monthCloseService');
    ({ zonedTimeToUtc } = require('../src/utils/time'));
    NOW = at('2026-10-05', '10:00');
    admin = F.makeUser({ role: 'admin', name: 'ادمین' });
    emp = F.makeUser({ name: 'کارمند' });
    for (const u of [admin, emp]) getDb().prepare('UPDATE users SET created_at = ? WHERE id = ?').run('2020-01-01 00:00:00', u.id);
  });
  after(cleanup);
  beforeEach(() => {
    for (const t of ['dispute_messages', 'record_disputes', 'month_closures', 'attendance_records']) db.prepare(`DELETE FROM ${t}`).run();
    db.prepare("DELETE FROM settings WHERE key LIKE 'month_close_%'").run();
    record = attendanceRepo.createManual({ userId: emp.id, recordDate: '2026-09-01', checkInTime: at('2026-09-01', '08:00'), checkOutTime: at('2026-09-01', '16:30'), status: 'normal' });
  });

  const disputeItem = () => monthClose.buildChecklist({ year: Y, month: M, now: NOW }).items.find((i) => i.key === 'open_disputes');
  const canClose = () => monthClose.buildChecklist({ year: Y, month: M, now: NOW }).canClose;
  const openDispute = (message = 'ساعت خروج اشتباه است') => {
    const r = svc.create(emp, { attendanceRecordId: record.id, message });
    assert.equal(r.ok, true);
    return r.dispute;
  };

  test('اعتراضِ باز (منتظر پاسخ) و پاسخ‌داده‌شده مانع‌اند', () => {
    const d = openDispute();
    assert.equal(disputeItem().count, 1);
    assert.equal(canClose(), false);
    svc.replyAsAdmin(admin, d.id, { message: 'در حال بررسی' }); // پاسخ‌دادن به معنی حل‌شدن نیست
    assert.equal(disputeItem().count, 1);
    assert.equal(canClose(), false);
  });

  test('resolved توسط ادمین ⇒ مانع نیست (با یا بدون پیام پایانی)', () => {
    const a = openDispute();
    svc.resolveAsAdmin(admin, a.id, { note: 'اصلاح شد' });
    const b = openDispute('دومی');
    svc.resolveAsAdmin(admin, b.id, {});
    assert.equal(disputeItem().count, 0);
    assert.equal(canClose(), true);
  });

  test('خاتمه توسط کارمند ⇒ مانع نیست', () => {
    const d = openDispute();
    assert.equal(svc.close(emp, d.id).ok, true);
    assert.equal(repo.findById(d.id).closed_by, 'user');
    assert.equal(disputeItem().count, 0);
    assert.equal(canClose(), true);
  });

  test('reopen‌شده (ادامه‌ی کارمند یا بازگشایی ادمین) دوباره مانع است؛ با بسته‌شدن دوباره آزاد', () => {
    const d = openDispute();
    svc.resolveAsAdmin(admin, d.id, {});
    assert.equal(canClose(), true);
    assert.equal(svc.reopen(emp, d.id, { message: 'هنوز درست نشده' }).ok, true);
    assert.equal(disputeItem().count, 1);
    assert.equal(canClose(), false);
    svc.resolveAsAdmin(admin, d.id, {});
    assert.equal(canClose(), true);
    assert.equal(svc.reopenAsAdmin(admin, d.id, {}).ok, true);
    assert.equal(disputeItem().count, 1);
    svc.close(emp, d.id);
    assert.equal(disputeItem().count, 0);
  });

  test('اعتراضِ قدیمیِ بدون پیام (باز) مانع است؛ بعد از resolve آزاد', () => {
    const id = Number(db.prepare("INSERT INTO record_disputes (user_id, attendance_record_id, message) VALUES (?, ?, 'قدیمی')").run(emp.id, record.id).lastInsertRowid);
    assert.equal(disputeItem().count, 1);
    assert.equal(svc.resolveAsAdmin(admin, id, {}).ok, true);
    assert.equal(disputeItem().count, 0);
  });

  test('نمونه‌ی چک‌لیست: شناسه، کارمند، تاریخ رکورد و متن اولیه‌ی اعتراضِ باز', () => {
    const d = openDispute('متن اولیه');
    svc.replyAsAdmin(admin, d.id, { message: 'پاسخ' });
    const it = disputeItem();
    assert.equal(it.samples[0].disputeId, d.id);
    assert.equal(it.samples[0].fullName, 'کارمند');
    assert.equal(it.samples[0].date, '2026-09-01');
    assert.equal(it.samples[0].message, 'متن اولیه', 'متن اولیه‌ی اعتراض؛ نه آخرین پیام thread');
  });

  test('تنظیم monthCloseBlockOpenDisputes=خاموش: اعتراضِ باز فقط هشدار است ولی همچنان شمرده می‌شود', () => {
    openDispute();
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('month_close_block_open_disputes', 'false')").run();
    assert.equal(settingsRepo.getAll().monthCloseBlockOpenDisputes, false);
    const it = disputeItem();
    assert.equal(it.count, 1);
    assert.equal(canClose(), true);
  });

  test('بستن واقعی ماه (closeMonth): با اعتراضِ باز ⇒ CHECKLIST_BLOCKED؛ پس از resolve ⇒ بسته می‌شود؛ بعد از آن کارمند فقط‌خواندنی است ولی ادمین نه', () => {
    const d = openDispute();
    assert.throws(() => monthClose.closeMonth({ year: Y, month: M, closedBy: admin.id, now: NOW }), (err) => err.code === 'CHECKLIST_BLOCKED');
    svc.resolveAsAdmin(admin, d.id, { note: 'اصلاح شد' });
    const { closure } = monthClose.closeMonth({ year: Y, month: M, closedBy: admin.id, now: NOW });
    assert.equal(closure.status, 'closed');
    // کارمند: ادامه‌ی اعتراضِ ماهِ بسته ممنوع (D2)
    const r = svc.reopen(emp, d.id, { message: 'ادامه' });
    assert.deepEqual([r.ok, r.code], [false, 'MONTH_CLOSED']);
    // ادمین: بازگشایی/پاسخ مجاز است (تصمیم D3)
    assert.equal(svc.reopenAsAdmin(admin, d.id, { note: 'بررسی مجدد' }).ok, true);
  });
});

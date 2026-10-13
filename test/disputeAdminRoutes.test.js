// D3/D4 (فاز ۱۱): routeهای ادمین اعتراض — مجوز (hr فقط‌خواندنی)، اسکوپ سرپرست، شکل پاسخ، audit، و اعلان‌ها.
// handlerهای route مستقیم و بدون سرور اجرا می‌شوند (router.stack + fakeReq/fakeRes)، پس به شبکه/پورت وابسته نیست؛
// فقط به express نیاز دارد (خودِ فایل route آن را require می‌کند).
// تلگرام ماک است: باید قبل از require شدن route/اعلان‌ها جایگزین شود (آن‌ها sendMessage را هنگام load می‌گیرند).
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

let hasDeps = true;
try { require.resolve('express'); } catch (_) { hasDeps = false; }

const GUARD_MSG = 'برای این عملیات مجوز لازم را ندارید.';

describe('routeهای ادمین اعتراض (D3/D4)', { skip: hasDeps ? false : 'express نصب نیست (npm install)' }, () => {
  let db; let F; let router; let repo; let svc;
  let admin; let hr; let mgr; let mgr2; let emp; let emp2; let record;
  const telegram = [];

  before(() => {
    db = resetDb();
    const notifier = require('../src/bot/notifier');
    notifier.sendMessage = async (to, text) => { telegram.push({ to: String(to), text }); return true; };
    F = require('./helpers/factories');
    router = require('../src/api/routes/admin/disputes');
    repo = require('../src/repositories/disputeRepository');
    svc = require('../src/services/disputeService');
    const attendanceRepo = require('../src/repositories/attendanceRepository');
    admin = F.makeUser({ role: 'admin', name: 'ادمین' });
    hr = F.makeUser({ role: 'hr', name: 'منابع انسانی' });
    mgr = F.makeUser({ role: 'manager', name: 'سرپرست الف' });
    mgr2 = F.makeUser({ role: 'manager', name: 'سرپرست ب' });
    emp = F.makeUser({ name: 'کارمند', managerId: mgr.id });
    emp2 = F.makeUser({ name: 'همکارِ تیم دیگر', managerId: mgr2.id });
    record = attendanceRepo.createManual({ userId: emp.id, recordDate: '2026-09-20', checkInTime: '2026-09-20T05:00:00.000Z', checkOutTime: '2026-09-20T13:00:00.000Z', status: 'normal' });
  });
  after(cleanup);
  beforeEach(() => {
    for (const t of ['dispute_messages', 'record_disputes', 'notifications']) db.prepare(`DELETE FROM ${t}`).run();
    telegram.length = 0;
  });

  const settle = () => new Promise((r) => setTimeout(r, 15)); // اعلان‌ها async‌اند (تلگرام)؛ ردیف پنل همگام ثبت می‌شود
  const routeLayers = () => router.stack.filter((l) => l.route);
  function handlersOf(method, path) {
    const l = routeLayers().find((x) => x.route.path === path && x.route.methods[method.toLowerCase()]);
    assert.ok(l, `route ثبت نشده: ${method} ${path}`);
    return l.route.stack.map((s) => s.handle);
  }
  async function call(user, method, path, { params = {}, body = {}, query = {} } = {}) {
    const handlers = handlersOf(method, path);
    const req = { ...F.fakeReq({ method, url: `/api${path}`, body, query }), adminUser: user, params, ip: '127.0.0.1' };
    const res = F.fakeRes();
    let i = 0;
    const next = () => { const h = handlers[i++]; if (h) h(req, res, next); };
    next();
    await settle();
    return { status: res.statusCode, body: res.body };
  }
  const list = (user, query) => call(user, 'GET', '/admin/disputes', { query });
  const counts = (user) => call(user, 'GET', '/admin/disputes/counts');
  const thread = (user, id) => call(user, 'GET', '/admin/disputes/:id', { params: { id: String(id) } });
  const reply = (user, id, message) => call(user, 'POST', '/admin/disputes/:id/messages', { params: { id: String(id) }, body: { message } });
  const act = (user, action, id, body = {}) => call(user, 'POST', '/admin/disputes/:id/:action(resolve|reopen)', { params: { id: String(id), action }, body });

  const open = (user = emp, message = 'ساعت خروج اشتباه است', recordId = null) => {
    const r = svc.create(user, { attendanceRecordId: recordId, message });
    assert.equal(r.ok, true);
    return r.dispute;
  };
  const notifs = (user, type) => db.prepare('SELECT * FROM notifications WHERE user_id = ? AND type = ? ORDER BY id').all(user.id, type)
    .map((n) => ({ ...n, data: n.data ? JSON.parse(n.data) : null }));
  const lastAudit = (action) => {
    const row = db.prepare('SELECT * FROM audit_log WHERE action = ? ORDER BY id DESC LIMIT 1').get(action);
    return row ? JSON.parse(row.details) : null;
  };

  test('ترتیب ثبت: /admin/disputes/counts قبل از /admin/disputes/:id (وگرنه «counts» به‌عنوان شناسه خوانده می‌شود)', () => {
    const idx = (path, method) => routeLayers().findIndex((l) => l.route.path === path && l.route.methods[method]);
    assert.ok(idx('/admin/disputes/counts', 'get') >= 0 && idx('/admin/disputes/:id', 'get') >= 0);
    assert.ok(idx('/admin/disputes/counts', 'get') < idx('/admin/disputes/:id', 'get'));
  });

  describe('مجوز و اسکوپ', () => {
    test('hr: فقط‌خواندنی — فهرست/شمارنده/thread همه‌ی کارمندان مجاز؛ پاسخ/resolve/reopen ⇒ ۴۰۳ گارد مجوز', async () => {
      const d = open(emp2, 'تیم دیگر');
      assert.equal((await list(hr)).status, 200);
      assert.equal((await list(hr)).body.length, 1);
      assert.equal((await counts(hr)).body.total, 1);
      assert.equal((await thread(hr, d.id)).status, 200);
      for (const r of [await reply(hr, d.id, 'x'), await act(hr, 'resolve', d.id), await act(hr, 'reopen', d.id)]) {
        assert.equal(r.status, 403);
        assert.equal(r.body.error, GUARD_MSG);
      }
      assert.equal(repo.findById(d.id).status, 'open');
      assert.equal(repo.listMessages(d.id).length, 1);
    });

    test('کارمند: پاسخ/resolve/reopen ⇒ ۴۰۳ گارد مجوز (کارمند از Mini App استفاده می‌کند)', async () => {
      const d = open(emp);
      for (const r of [await reply(emp, d.id, 'x'), await act(emp, 'resolve', d.id), await act(emp, 'reopen', d.id)]) {
        assert.equal(r.status, 403);
        assert.equal(r.body.error, GUARD_MSG);
      }
      assert.equal(repo.findById(d.id).status, 'open');
    });

    test('سرپرست: فقط تیم خودش — thread/پاسخ/resolve/reopen برای تیم دیگر ⇒ ۴۰۳ اسکوپ و هیچ تغییری ثبت نمی‌شود', async () => {
      const mine = open(emp, 'تیم من');
      const other = open(emp2, 'تیم دیگر');
      assert.equal((await thread(mgr, mine.id)).status, 200);
      for (const r of [await thread(mgr, other.id), await reply(mgr, other.id, 'x'), await act(mgr, 'resolve', other.id), await act(mgr, 'reopen', other.id)]) {
        assert.equal(r.status, 403);
        assert.equal(r.body.error, 'به این کارمند دسترسی ندارید.');
      }
      assert.equal(repo.findById(other.id).status, 'open');
      assert.equal(repo.listMessages(other.id).length, 1);
      assert.equal((await reply(mgr, mine.id, 'پاسخ سرپرست')).status, 201);
      assert.equal((await list(mgr)).body.length, 1);
      assert.equal((await counts(mgr)).body.total, 1);
      assert.equal((await counts(admin)).body.total, 2);
    });

    test('ناموجود/نامعتبر ⇒ ۴۰۴ در همه‌ی routeها', async () => {
      for (const id of [99999, 'abc', 0]) {
        for (const r of [await thread(admin, id), await reply(admin, id, 'x'), await act(admin, 'resolve', id), await act(admin, 'reopen', id)]) {
          assert.equal(r.status, 404, String(id));
        }
      }
    });
  });

  describe('فهرست، شمارنده، thread', () => {
    test('فهرست: فیلدهای قدیمی حفظ + فیلدهای گفت‌وگو؛ employee و record', async () => {
      const d = open(emp, 'متن اعتراض', record.id);
      const r = await list(admin);
      assert.equal(r.status, 200);
      const it = r.body[0];
      assert.equal(it.id, d.id);
      assert.equal(it.message, 'متن اعتراض');
      assert.equal(it.status, 'open');
      assert.ok(it.createdAt && it.updatedAt);
      assert.equal(it.employee.id, emp.id);
      assert.equal(it.employee.fullName, 'کارمند');
      assert.deepEqual(it.record, { id: record.id, date: '2026-09-20' });
      assert.deepEqual([it.messageCount, it.lastSenderRole, it.phase, it.awaitingAdmin, it.closedBy, it.reopenCount], [1, 'user', 'open', true, null, 0]);
      const bare = open(emp, 'بدون رکورد');
      assert.equal((await list(admin)).body.find((x) => x.id === bare.id).record, null);
    });

    test('فیلتر ?status با مدل جدید؛ مقدار ناشناخته ⇒ همه', async () => {
      const a = open(emp, 'منتظر');
      const b = open(emp, 'پاسخ‌داده');
      await reply(admin, b.id, 'پاسخ');
      const c = open(emp, 'حل‌شده');
      await act(admin, 'resolve', c.id);
      const e = open(emp, 'خاتمه توسط کارمند');
      svc.close(emp, e.id);
      const ids = async (status) => (await list(admin, { status })).body.map((x) => x.id).sort((x, y) => x - y);
      assert.deepEqual(await ids('open'), [a.id, b.id]);
      assert.deepEqual(await ids('resolved'), [c.id, e.id]);
      assert.deepEqual(await ids('awaiting_admin'), [a.id]);
      assert.deepEqual(await ids('answered'), [b.id]);
      assert.deepEqual(await ids('resolved_by_admin'), [c.id]);
      assert.deepEqual(await ids('closed_by_user'), [e.id]);
      assert.deepEqual(await ids('هرچیز'), [a.id, b.id, c.id, e.id]);
      assert.deepEqual(await ids(undefined), [a.id, b.id, c.id, e.id]);
    });

    test('شمارنده: awaitingAdmin با پاسخ ادمین کم و با پیام کارمند زیاد می‌شود', async () => {
      const a = open(emp, 'یک');
      open(emp, 'دو');
      assert.deepEqual((await counts(admin)).body, { total: 2, open: 2, awaitingAdmin: 2, answered: 0, resolved: 0, resolvedByAdmin: 0, closedByUser: 0 });
      await reply(admin, a.id, 'پاسخ');
      assert.equal((await counts(admin)).body.awaitingAdmin, 1);
      svc.postMessage(emp, a.id, { message: 'ممنون' });
      assert.equal((await counts(admin)).body.awaitingAdmin, 2);
    });

    test('thread: dispute + messages (با فرستنده) + employee + record', async () => {
      const d = open(emp, 'اول', record.id);
      await reply(admin, d.id, 'دوم');
      const r = await thread(admin, d.id);
      assert.equal(r.status, 200);
      assert.deepEqual(Object.keys(r.body).sort(), ['dispute', 'employee', 'messages', 'record']);
      assert.deepEqual(r.body.messages.map((m) => [m.senderRole, m.message, m.sender.fullName]), [['user', 'اول', 'کارمند'], ['admin', 'دوم', 'ادمین']]);
      assert.equal(r.body.employee.id, emp.id);
      assert.deepEqual(r.body.record, { id: record.id, date: '2026-09-20' });
      assert.equal(r.body.dispute.phase, 'answered');
    });
  });

  describe('پاسخ ادمین (POST /messages)', () => {
    test('۲۰۱ با thread به‌روز؛ audit؛ اعلان درون‌پنلی + تلگرام فقط برای کارمند', async () => {
      const d = open(emp, 'اعتراض');
      const r = await reply(mgr, d.id, 'بررسی می‌شود');
      assert.equal(r.status, 201);
      assert.deepEqual(r.body.messages.map((m) => m.message), ['اعتراض', 'بررسی می‌شود']);
      assert.equal(r.body.dispute.phase, 'answered');

      const a = lastAudit('dispute_message_sent');
      assert.equal(a.disputeId, d.id);
      assert.equal(a.targetUserId, emp.id);
      assert.equal(a.source, 'admin_panel');
      assert.equal(a.messageId, r.body.messages[1].id);
      assert.ok(!JSON.stringify(a).includes('بررسی می‌شود'), 'متن پیام در audit نمی‌آید (فقط طول)');

      const n = notifs(emp, 'dispute_admin_message');
      assert.equal(n.length, 1);
      assert.equal(n[0].title, 'پاسخ تازه به اعتراض شما');
      assert.match(n[0].body, /پاسخ سرپرست: بررسی می‌شود/);
      assert.deepEqual(n[0].data, { disputeId: d.id, messageId: r.body.messages[1].id });
      assert.equal(n[0].telegram_status, 'sent');
      assert.equal(telegram.length, 1);
      assert.equal(telegram[0].to, String(emp.telegram_user_id));
      assert.match(telegram[0].text, /بررسی می‌شود/);
      assert.equal(notifs(mgr, 'dispute_admin_message').length + notifs(admin, 'dispute_admin_message').length, 0);
    });

    test('خطاها: ۴۰۰ (خالی/بلند) با code=VALIDATION؛ ۴۰۹ روی اعتراضِ بسته؛ هیچ اعلانی ساخته نمی‌شود', async () => {
      const d = open(emp);
      for (const bad of ['', '   ', undefined, 'ا'.repeat(501)]) {
        const r = await reply(admin, d.id, bad);
        assert.deepEqual([r.status, r.body.code], [400, 'VALIDATION']);
      }
      await act(admin, 'resolve', d.id);
      const closed = await reply(admin, d.id, 'x');
      assert.deepEqual([closed.status, closed.body.code], [409, 'DISPUTE_CLOSED']);
      assert.equal(notifs(emp, 'dispute_admin_message').length, 0);
      assert.equal(repo.listMessages(d.id).length, 1);
    });
  });

  describe('resolve / reopen', () => {
    test('resolve با یادداشت: closed_by=admin، پیام پایانی در thread، audit با دلیل، اعلان resolved + تلگرام مستقیم؛ اعلان «پاسخ» تکراری نیست', async () => {
      const d = open(emp, 'اعتراض', record.id);
      const r = await act(mgr, 'resolve', d.id, { note: 'اصلاح شد' });
      assert.equal(r.status, 200);
      assert.deepEqual([r.body.status, r.body.closed_by], ['resolved', 'admin']);
      assert.deepEqual(repo.listMessages(d.id).map((m) => [m.sender_role, m.message]), [['user', 'اعتراض'], ['admin', 'اصلاح شد']]);

      const a = lastAudit('dispute_resolved');
      assert.deepEqual(a.changes, { status: { before: 'open', after: 'resolved' } });
      assert.equal(a.reason, 'اصلاح شد');
      assert.equal(a.disputeId, d.id);

      const n = notifs(emp, 'dispute_resolved');
      assert.equal(n.length, 1);
      assert.match(n[0].body, /اصلاح شد/);
      assert.equal(notifs(emp, 'dispute_admin_message').length, 0, 'پیام پایانی دوبار اعلام نمی‌شود');
      assert.equal(telegram.length, 1);
      assert.match(telegram[0].text, /اعتراض شما بررسی و بسته شد/);
      assert.match(telegram[0].text, /پاسخ سرپرست: اصلاح شد/);
    });

    test('resolve بدون یادداشت: بدون پیام و بدون «پاسخ»ِ تلگرام؛ audit بدون reason', async () => {
      const d = open(emp);
      const r = await act(admin, 'resolve', d.id, {});
      assert.equal(r.status, 200);
      assert.equal(repo.listMessages(d.id).length, 1);
      assert.equal(lastAudit('dispute_resolved').reason, undefined);
      assert.ok(!/پاسخ/.test(telegram[0].text.replace('اعتراض شما بررسی و بسته شد', '')));
    });

    test('resolve: یادداشت نامعتبر ⇒ ۴۰۰ و اعتراض باز می‌ماند؛ اعتراضِ از قبل بسته ⇒ ۴۰۹ و بدون اعلان/audit تازه', async () => {
      const d = open(emp);
      for (const note of ['ا'.repeat(501), 7]) {
        const r = await act(admin, 'resolve', d.id, { note });
        assert.deepEqual([r.status, r.body.code], [400, 'VALIDATION']);
      }
      assert.equal(repo.findById(d.id).status, 'open');
      assert.equal((await act(admin, 'resolve', d.id)).status, 200);
      const resolvedAt = repo.findById(d.id).closed_at;
      const again = await act(admin, 'resolve', d.id, { note: 'دوباره' });
      assert.deepEqual([again.status, again.body.code], [409, 'DISPUTE_ALREADY_CLOSED']);
      assert.equal(repo.findById(d.id).closed_at, resolvedAt);
      assert.equal(notifs(emp, 'dispute_resolved').length, 1);
    });

    test('resolve روی اعتراضِ خاتمه‌یافته توسط کارمند ⇒ ۴۰۹ و closed_by=user دست‌نخورده', async () => {
      const d = open(emp);
      svc.close(emp, d.id);
      assert.equal((await act(admin, 'resolve', d.id)).status, 409);
      assert.equal(repo.findById(d.id).closed_by, 'user');
    });

    test('reopen بدون یادداشت: باز می‌شود؛ بدون پیام و بدون اعلان (رفتار قبلی)؛ audit', async () => {
      const d = open(emp);
      await act(admin, 'resolve', d.id);
      telegram.length = 0;
      const r = await act(admin, 'reopen', d.id, {});
      assert.equal(r.status, 200);
      assert.deepEqual([r.body.status, r.body.closed_by, r.body.reopen_count], ['open', null, 0]);
      assert.deepEqual(lastAudit('dispute_reopened').changes, { status: { before: 'resolved', after: 'open' } });
      assert.equal(notifs(emp, 'dispute_admin_message').length, 0);
      assert.equal(telegram.length, 0);
    });

    test('reopen با یادداشت: پیام ادمین ثبت می‌شود و مثل پاسخ به کارمند اعلان (پنل + تلگرام) می‌رود؛ audit با دلیل', async () => {
      const d = open(emp);
      await act(admin, 'resolve', d.id);
      telegram.length = 0;
      const r = await act(admin, 'reopen', d.id, { note: 'دوباره بررسی می‌کنم' });
      assert.equal(r.status, 200);
      assert.equal(lastAudit('dispute_reopened').reason, 'دوباره بررسی می‌کنم');
      const n = notifs(emp, 'dispute_admin_message');
      assert.equal(n.length, 1);
      assert.match(n[0].body, /دوباره بررسی می‌کنم/);
      assert.equal(telegram.length, 1);
    });

    test('reopen روی اعتراضِ باز ⇒ ۴۰۹ DISPUTE_NOT_CLOSED؛ reopen روی خاتمه‌یافته‌ی کارمند مجاز', async () => {
      const d = open(emp);
      const bad = await act(admin, 'reopen', d.id);
      assert.deepEqual([bad.status, bad.body.code], [409, 'DISPUTE_NOT_CLOSED']);
      svc.close(emp, d.id);
      assert.equal((await act(admin, 'reopen', d.id)).status, 200);
      assert.equal(repo.findById(d.id).status, 'open');
    });
  });
});

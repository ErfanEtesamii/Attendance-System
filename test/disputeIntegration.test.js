// D7 (فاز ۱۱) — بخش ۱ از ۳: سناریوی کامل گفت‌وگوی اعتراض، سرتاسری (کارمند ⇄ ادمین)، و رد دسترسی کارمند دیگر.
//   ثبت اعتراض ← پاسخ ادمین ← resolve ← ادامه‌ی کارمند ← پاسخ دوم ← خاتمه توسط کارمند.
//   سمت کارمند: سرور واقعی Mini App (test/helpers/miniappClient)؛ سمت ادمین: handlerهای route مستقیم (بدون پورت).
//   بخش ۲: سقف reopen و اعتراض قدیمی بدون پیام. بخش ۳ (۳ زیربخش): بستن ماه در هر مرحله — ۳-۱: مانع‌بودن اعتراض در چک‌لیست؛ ۳-۲: ۴۰۹ MONTH_CLOSED و خواندن آزاد؛ ۳-۳: ماه reopened.
//   تست‌ها به روز هفته/ساعت واقعی وابسته نیستند (رکورد با تاریخ ثابت؛ ماه بسته در این بخش نیست).
// تلگرام ماک است و باید قبل از require شدن routeها جایگزین شود.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');

let hasDeps = true;
try { require.resolve('express'); } catch (_) { hasDeps = false; }

describe('تست یکپارچه‌ی اعتراض — سناریوی کامل (D7 بخش ۱)', { skip: hasDeps ? false : 'express نصب نیست (npm install)' }, () => {
  let db; let F; let S; let repo; let router;
  let admin; let emp; let other; let record;
  const telegram = [];

  before(async () => {
    db = resetDb();
    const notifier = require('../src/bot/notifier');
    notifier.sendMessage = async (to, text) => { telegram.push({ to: String(to), text }); return true; };
    F = require('./helpers/factories');
    const { startServer } = require('./helpers/miniappClient');
    repo = require('../src/repositories/disputeRepository');
    router = require('../src/api/routes/admin/disputes');
    const attendanceRepo = require('../src/repositories/attendanceRepository');
    admin = F.makeUser({ role: 'admin', name: 'ادمین' });
    emp = F.makeUser({ name: 'کارمند' });
    other = F.makeUser({ name: 'همکار' });
    record = attendanceRepo.createManual({ userId: emp.id, recordDate: '2026-09-20', checkInTime: '2026-09-20T05:00:00.000Z', checkOutTime: '2026-09-20T13:00:00.000Z', status: 'normal' });
    S = await startServer();
  });
  after(() => { if (S) S.close(); cleanup(); });

  // ---- سمت ادمین: اجرای مستقیم handlerهای route ----
  const settle = () => new Promise((r) => setTimeout(r, 15)); // اعلان‌های تلگرام async‌اند
  function handlersOf(method, path) {
    const l = router.stack.filter((x) => x.route).find((x) => x.route.path === path && x.route.methods[method.toLowerCase()]);
    assert.ok(l, `route ثبت نشده: ${method} ${path}`);
    return l.route.stack.map((s) => s.handle);
  }
  async function adminCall(method, path, { params = {}, body = {}, query = {} } = {}) {
    const handlers = handlersOf(method, path);
    const req = { ...F.fakeReq({ method, url: `/api${path}`, body, query }), adminUser: admin, params, ip: '127.0.0.1' };
    const res = F.fakeRes();
    let i = 0;
    const next = () => { const h = handlers[i++]; if (h) h(req, res, next); };
    next();
    await settle();
    return { status: res.statusCode, body: res.body };
  }
  const aCounts = () => adminCall('GET', '/admin/disputes/counts');
  const aThread = (id) => adminCall('GET', '/admin/disputes/:id', { params: { id: String(id) } });
  const aReply = (id, message) => adminCall('POST', '/admin/disputes/:id/messages', { params: { id: String(id) }, body: { message } });
  const aAct = (action, id, body = {}) => adminCall('POST', '/admin/disputes/:id/:action(resolve|reopen)', { params: { id: String(id), action }, body });

  // ---- کمکی‌های داده ----
  const notifs = (user, type) => db.prepare('SELECT * FROM notifications WHERE user_id = ? AND type = ? ORDER BY id').all(user.id, type);
  const auditCount = (action) => db.prepare('SELECT COUNT(*) n FROM audit_log WHERE action = ?').get(action).n;
  const rolesOf = (id) => repo.listMessages(id).map((m) => m.sender_role);

  test('ثبت ← پاسخ ادمین ← resolve ← ادامه ← پاسخ دوم ← خاتمه توسط کارمند (با اعلان‌ها، audit و رد دسترسی دیگران در هر مرحله)', async () => {
    // ۱) ثبت اعتراض
    const created = await S.call(emp, 'POST', 'dispute', { attendanceRecordId: record.id, message: 'ساعت خروج من اشتباه ثبت شده' });
    assert.equal(created.status, 201);
    const id = created.json.id;
    assert.deepEqual([created.json.status, created.json.attendance_record_id], ['open', record.id]);
    assert.deepEqual(rolesOf(id), ['user']);
    let mine = (await S.call(emp, 'GET', 'dispute')).json;
    assert.deepEqual([mine.length, mine[0].phase, mine[0].message_count, mine[0].can_reply, mine[0].can_close, mine[0].can_reopen], [1, 'open', 1, true, true, false]);
    assert.equal((await aCounts()).body.awaitingAdmin, 1);
    assert.equal(notifs(admin, 'dispute_opened').length, 1);
    assert.equal(auditCount('record_dispute_submitted'), 1);

    // کارمند دیگر: هیچ مسیری به این اعتراض باز نیست و چیزی عوض نمی‌شود
    const denyOther = async () => {
      assert.equal((await S.call(other, 'GET', `dispute/${id}`)).status, 404);
      assert.equal((await S.call(other, 'POST', `dispute/${id}/messages`, { message: 'نفوذ' })).status, 404);
      assert.equal((await S.call(other, 'POST', `dispute/${id}/reopen`, { message: 'نفوذ' })).status, 404);
      assert.equal((await S.call(other, 'POST', `dispute/${id}/close`)).status, 404);
      assert.deepEqual((await S.call(other, 'GET', 'dispute')).json, []);
    };
    await denyOther();
    assert.deepEqual([repo.findById(id).status, rolesOf(id).length], ['open', 1]);

    // ۲) پاسخ ادمین
    const replied = await aReply(id, 'در حال بررسی ساعت ورودی هستم');
    assert.equal(replied.status, 201);
    assert.deepEqual(replied.body.messages.map((m) => m.senderRole), ['user', 'admin']);
    assert.equal(replied.body.dispute.awaitingAdmin, false);
    const thread = (await S.call(emp, 'GET', `dispute/${id}`)).json;
    assert.deepEqual(thread.messages.map((m) => [m.sender_role, m.is_mine]), [['user', true], ['admin', false]]);
    assert.equal(thread.dispute.phase, 'answered');
    assert.equal(notifs(emp, 'dispute_admin_message').length, 1);
    assert.ok(telegram.some((t) => t.to === String(emp.telegram_user_id)), 'پیام ادمین باید به تلگرام کارمند برسد');
    assert.deepEqual([(await aCounts()).body.answered, (await aCounts()).body.awaitingAdmin], [1, 0]);
    await denyOther();

    // ۳) resolve توسط ادمین با پیام پایانی
    const resolved = await aAct('resolve', id, { note: 'اصلاح شد' });
    assert.equal(resolved.status, 200);
    assert.deepEqual([repo.findById(id).status, repo.findById(id).closed_by], ['resolved', 'admin']);
    assert.deepEqual(rolesOf(id), ['user', 'admin', 'admin']);
    assert.equal(notifs(emp, 'dispute_resolved').length, 1);
    assert.ok(telegram.some((t) => t.to === String(emp.telegram_user_id) && /بسته شد/.test(t.text) && t.text.includes('اصلاح شد')));
    mine = (await S.call(emp, 'GET', 'dispute')).json;
    assert.deepEqual([mine[0].phase, mine[0].can_reply, mine[0].can_close, mine[0].can_reopen], ['resolved', false, false, true]);
    const blocked = await S.call(emp, 'POST', `dispute/${id}/messages`, { message: 'هنوز مشکل دارم' });
    assert.deepEqual([blocked.status, blocked.json.code], [409, 'DISPUTE_CLOSED']);
    assert.equal(rolesOf(id).length, 3);
    await denyOther();

    // ۴) ادامه‌ی اعتراض توسط کارمند
    const reopened = await S.call(emp, 'POST', `dispute/${id}/reopen`, { message: 'اصلاح کامل نبود' });
    assert.equal(reopened.status, 200);
    assert.deepEqual([reopened.json.dispute.status, reopened.json.dispute.reopen_count, reopened.json.dispute.closed_by, reopened.json.dispute.phase], ['open', 1, null, 'open']);
    assert.deepEqual(rolesOf(id), ['user', 'admin', 'admin', 'user']);
    assert.equal(notifs(admin, 'dispute_user_message').length, 1);
    assert.equal((await aCounts()).body.awaitingAdmin, 1);
    assert.equal(auditCount('record_dispute_reopened_by_user'), 1);

    // ۵) پاسخ دوم ادمین
    assert.equal((await aReply(id, 'خروج را به ۱۷:۰۰ اصلاح کردم')).status, 201);
    assert.deepEqual(rolesOf(id), ['user', 'admin', 'admin', 'user', 'admin']);
    assert.equal(notifs(emp, 'dispute_admin_message').length, 2);
    assert.equal((await S.call(emp, 'GET', `dispute/${id}`)).json.dispute.phase, 'answered');

    // ۶) خاتمه توسط کارمند
    const closed = await S.call(emp, 'POST', `dispute/${id}/close`);
    assert.equal(closed.status, 200);
    assert.deepEqual([closed.json.dispute.status, closed.json.dispute.closed_by, closed.json.dispute.phase], ['resolved', 'user', 'closed_by_user']);
    assert.ok(closed.json.dispute.closed_at);
    assert.equal(auditCount('record_dispute_closed_by_user'), 1);
    const again = await S.call(emp, 'POST', `dispute/${id}/close`);
    assert.deepEqual([again.status, again.json.code], [409, 'DISPUTE_ALREADY_CLOSED']);
    assert.equal((await aReply(id, 'پس از خاتمه')).status, 409); // ادمین هم روی اعتراضِ بسته پاسخ نمی‌دهد
    assert.equal(rolesOf(id).length, 5);
    await denyOther();

    // نمای ادمین در پایان: thread کامل با ترتیب درست و شمارنده‌ها
    const final = await aThread(id);
    assert.equal(final.status, 200);
    assert.deepEqual(final.body.messages.map((m) => m.senderRole), ['user', 'admin', 'admin', 'user', 'admin']);
    assert.deepEqual([final.body.dispute.phase, final.body.dispute.reopenCount, final.body.dispute.closedBy], ['closed_by_user', 1, 'user']);
    const c = (await aCounts()).body;
    assert.deepEqual([c.total, c.awaitingAdmin, c.closedByUser], [1, 0, 1]);
    assert.equal(auditCount('dispute_message_sent'), 2);
    assert.equal(auditCount('dispute_resolved'), 1);
  });

  test('اعتراضِ کارمند دیگر ⇒ ساخته می‌شود ولی از دید این کارمند و مسیرهای ثبت/ادامه‌ی او کاملاً جداست', async () => {
    const mine = (await S.call(emp, 'GET', 'dispute')).json;
    const mineIds = mine.map((d) => d.id);
    const theirs = await S.call(other, 'POST', 'dispute', { message: 'اعتراض همکار' });
    assert.equal(theirs.status, 201);
    assert.ok(!mineIds.includes(theirs.json.id));
    assert.deepEqual((await S.call(emp, 'GET', 'dispute')).json.map((d) => d.id), mineIds);
    assert.equal((await S.call(emp, 'GET', `dispute/${theirs.json.id}`)).status, 404);
    // ثبت اعتراض روی رکوردِ همکار هم رد می‌شود
    const rec = require('../src/repositories/attendanceRepository').createManual({ userId: other.id, recordDate: '2026-09-21', checkInTime: '2026-09-21T05:00:00.000Z', checkOutTime: '2026-09-21T13:00:00.000Z', status: 'normal' });
    assert.equal((await S.call(emp, 'POST', 'dispute', { attendanceRecordId: rec.id, message: 'x' })).status, 404);
  });

  // ======== بخش ۲ از ۳: سقف reopen و اعتراضِ قدیمیِ بدون پیام ========
  // هر تست کارمند تازه می‌سازد: سطل rate limit (۱۰ پیام/دقیقه برای هر کارمند) و فهرست‌ها قاطی نمی‌شوند.
  describe('بخش ۲ — سقف reopen و اعتراض قدیمی بدون پیام', () => {
    const settings = () => require('../src/repositories/settingsRepository');
    const resetCap = () => db.prepare("DELETE FROM settings WHERE key = 'dispute_max_reopens'").run();
    let seq = 0;
    before(resetCap);
    beforeEach(resetCap);
    after(resetCap);

    function freshEmployee() {
      seq += 1;
      const user = F.makeUser({ name: `کارمند بخش۲-${seq}` });
      const rec = require('../src/repositories/attendanceRepository').createManual({
        userId: user.id, recordDate: '2026-09-20', checkInTime: '2026-09-20T05:00:00.000Z', checkOutTime: '2026-09-20T13:00:00.000Z', status: 'normal',
      });
      return { user, rec };
    }
    const openDispute = async (e, message = 'ساعت خروج من اشتباه ثبت شده') => {
      const r = await S.call(e.user, 'POST', 'dispute', { attendanceRecordId: e.rec.id, message });
      assert.equal(r.status, 201);
      return r.json.id;
    };
    const adminResolve = async (id) => { const r = await aAct('resolve', id, { note: 'بسته شد' }); assert.equal(r.status, 200); return r; };
    const adminReopen = async (id) => { const r = await aAct('reopen', id, { note: 'بازگشایی توسط ادمین' }); assert.equal(r.status, 200); return r; };
    const empReopen = (e, id, message = 'ادامه می‌دهم') => S.call(e.user, 'POST', `dispute/${id}/reopen`, { message });
    const mineOf = async (e, id) => (await S.call(e.user, 'GET', 'dispute')).json.find((d) => d.id === id);
    const msgCount = (id) => db.prepare('SELECT COUNT(*) n FROM dispute_messages WHERE dispute_id = ?').get(id).n;
    // اعتراضِ قدیمی (قبل از گفت‌وگو): فقط ستون message؛ هیچ ردیفی در dispute_messages ندارد
    const legacy = (e, { status = 'open', recordId = null, text = 'اعتراض قدیمی من' } = {}) => {
      const id = db.prepare('INSERT INTO record_disputes (user_id, attendance_record_id, message, status) VALUES (?, ?, ?, ?)').run(e.user.id, recordId, text, status).lastInsertRowid;
      assert.equal(msgCount(id), 0);
      return id;
    };

    // ---------- سقف reopen ----------
    test('سقف پیش‌فرض ۳: سه ادامه آزاد است و بار چهارم ۴۰۹ REOPEN_LIMIT؛ مسیرهای دیگر هنوز طبق قاعده‌ی «بسته»', async () => {
      assert.equal(settings().getAll().disputeMaxReopens, 3);
      const e = freshEmployee();
      const id = await openDispute(e);
      const audits0 = auditCount('record_dispute_reopened_by_user');
      for (let i = 1; i <= 3; i += 1) {
        await adminResolve(id);
        const r = await empReopen(e, id, `ادامه ${i}`);
        assert.equal(r.status, 200);
        assert.deepEqual([r.json.dispute.status, r.json.dispute.reopen_count, r.json.dispute.max_reopens], ['open', i, 3]);
      }
      await adminResolve(id);
      const mine = await mineOf(e, id);
      assert.deepEqual([mine.reopen_count, mine.max_reopens, mine.can_reopen, mine.phase], [3, 3, false, 'resolved']);

      const before = msgCount(id);
      const fourth = await empReopen(e, id, 'ادامه ۴');
      assert.deepEqual([fourth.status, fourth.json.code, fourth.json.maxReopens], [409, 'REOPEN_LIMIT', 3]);
      assert.match(fourth.json.error, /۳|3/);
      assert.deepEqual([repo.findById(id).status, repo.findById(id).reopen_count, msgCount(id)], ['resolved', 3, before]); // هیچ چیز عوض نشد
      assert.equal(auditCount('record_dispute_reopened_by_user') - audits0, 3);

      const msg = await S.call(e.user, 'POST', `dispute/${id}/messages`, { message: 'پیام' });
      assert.deepEqual([msg.status, msg.json.code], [409, 'DISPUTE_CLOSED']);
      const cls = await S.call(e.user, 'POST', `dispute/${id}/close`);
      assert.deepEqual([cls.status, cls.json.code], [409, 'DISPUTE_ALREADY_CLOSED']);
      assert.equal(msgCount(id), before);
    });

    test('reopen ادمین به سقف کارمند نمی‌شمارد: چند بار ادمین باز کند، کارمند هنوز سه ادامه‌ی کامل دارد', async () => {
      const e = freshEmployee();
      const id = await openDispute(e);
      for (let i = 0; i < 4; i += 1) { await adminResolve(id); await adminReopen(id); }
      assert.deepEqual([repo.findById(id).status, repo.findById(id).reopen_count], ['open', 0]);

      for (let i = 1; i <= 3; i += 1) {
        await adminResolve(id);
        const r = await empReopen(e, id, `ادامه ${i}`);
        assert.equal(r.status, 200);
        assert.equal(r.json.dispute.reopen_count, i);
      }
      await adminResolve(id);
      assert.equal((await empReopen(e, id, 'ادامه ۴')).json.code, 'REOPEN_LIMIT');

      // سقف کارمند پر است ولی ادمین همچنان می‌تواند باز کند و گفت‌وگو ادامه پیدا می‌کند (بدون زیادشدن شمارنده)
      await adminReopen(id);
      assert.equal(repo.findById(id).reopen_count, 3);
      assert.equal((await S.call(e.user, 'POST', `dispute/${id}/messages`, { message: 'ممنون که باز کردید' })).status, 201);
      assert.deepEqual([(await mineOf(e, id)).phase, repo.findById(id).reopen_count], ['open', 3]);
    });

    test('تنظیم disputeMaxReopens اعمال می‌شود (کم/زیاد، بدون ری‌استارت) و ۰ یعنی خاموش', async () => {
      settings().update({ disputeMaxReopens: 1 });
      const e = freshEmployee();
      const id = await openDispute(e);
      await adminResolve(id);
      assert.equal((await empReopen(e, id, 'یک')).status, 200);
      await adminResolve(id);
      let r = await empReopen(e, id, 'دو');
      assert.deepEqual([r.status, r.json.code, r.json.maxReopens], [409, 'REOPEN_LIMIT', 1]);
      assert.deepEqual([(await mineOf(e, id)).max_reopens, (await mineOf(e, id)).can_reopen], [1, false]);

      settings().update({ disputeMaxReopens: 2 }); // بالا بردن سقف، همان اعتراض دوباره قابل ادامه است
      assert.deepEqual([(await mineOf(e, id)).max_reopens, (await mineOf(e, id)).can_reopen], [2, true]);
      assert.equal((await empReopen(e, id, 'دو')).status, 200);
      assert.equal(repo.findById(id).reopen_count, 2);
      await adminResolve(id);
      assert.equal((await empReopen(e, id, 'سه')).json.code, 'REOPEN_LIMIT');

      settings().update({ disputeMaxReopens: 0 }); // خاموش
      const f = freshEmployee();
      const id2 = await openDispute(f);
      await adminResolve(id2);
      const m = await mineOf(f, id2);
      assert.deepEqual([m.max_reopens, m.can_reopen, m.phase], [0, false, 'resolved']);
      r = await empReopen(f, id2, 'ادامه');
      assert.deepEqual([r.status, r.json.code, r.json.maxReopens], [409, 'REOPEN_LIMIT', 0]);
      assert.deepEqual([repo.findById(id2).status, repo.findById(id2).reopen_count], ['resolved', 0]);
      await adminReopen(id2); // خاموش‌بودن فقط برای کارمند است؛ ادمین آزاد است
      assert.equal(repo.findById(id2).status, 'open');
    });

    test('ادامه‌ی اعتراضِ بسته‌شده توسط خود کارمند هم می‌شمارد؛ ادامه‌ی اعتراضِ باز ⇒ ۴۰۹ DISPUTE_NOT_CLOSED و چیزی نمی‌شمارد', async () => {
      const e = freshEmployee();
      const id = await openDispute(e);
      const early = await empReopen(e, id, 'هنوز باز است');
      assert.deepEqual([early.status, early.json.code], [409, 'DISPUTE_NOT_CLOSED']);
      assert.equal(repo.findById(id).reopen_count, 0);
      for (let i = 1; i <= 3; i += 1) {
        assert.equal((await S.call(e.user, 'POST', `dispute/${id}/close`)).status, 200);
        assert.equal((await empReopen(e, id, `ادامه ${i}`)).json.dispute.reopen_count, i);
      }
      assert.equal((await S.call(e.user, 'POST', `dispute/${id}/close`)).status, 200);
      assert.equal((await empReopen(e, id, 'ادامه ۴')).json.code, 'REOPEN_LIMIT');
      assert.equal((await mineOf(e, id)).phase, 'closed_by_user');
    });

    // ---------- اعتراضِ قدیمیِ بدون پیام ----------
    test('قدیمیِ باز: در thread پیام اول است؛ کارمند پیام می‌دهد، ادمین پاسخ می‌دهد، کارمند می‌بندد؛ کارمند دیگر ⇒ ۴۰۴', async () => {
      const e = freshEmployee();
      const id = legacy(e, { recordId: e.rec.id, text: 'ساعت ورودم اشتباه است' });

      const mine = await mineOf(e, id);
      assert.deepEqual([mine.message_count, mine.phase, mine.can_reply, mine.can_close, mine.can_reopen], [1, 'open', true, true, false]);
      const t = (await S.call(e.user, 'GET', `dispute/${id}`)).json;
      assert.deepEqual(t.messages.map((m) => [m.sender_role, m.is_mine, m.message]), [['user', true, 'ساعت ورودم اشتباه است']]);
      assert.equal(msgCount(id), 0); // خواندن چیزی در جدول نمی‌نویسد

      const at = await aThread(id); // ادمین هم می‌بیند
      assert.equal(at.status, 200);
      assert.deepEqual(at.body.messages.map((m) => [m.senderRole, m.message]), [['user', 'ساعت ورودم اشتباه است']]);
      assert.deepEqual([at.body.dispute.messageCount, at.body.dispute.awaitingAdmin, at.body.dispute.phase], [1, true, 'open']);

      // کارمند روی پیام قدیمی ادامه می‌دهد
      const posted = await S.call(e.user, 'POST', `dispute/${id}/messages`, { message: 'یک مورد دیگر هم هست' });
      assert.equal(posted.status, 201);
      assert.deepEqual(posted.json.messages.map((m) => [m.sender_role, m.message]), [['user', 'ساعت ورودم اشتباه است'], ['user', 'یک مورد دیگر هم هست']]);
      assert.equal(msgCount(id), 2); // پیام قدیمی با اولین پیام جدید در جدول نشست (بدون تکرار)

      // ادمین پاسخ می‌دهد
      const rep = await aReply(id, 'بررسی شد');
      assert.equal(rep.status, 201);
      assert.deepEqual(rep.body.messages.map((m) => m.senderRole), ['user', 'user', 'admin']);
      assert.equal((await S.call(e.user, 'GET', `dispute/${id}`)).json.dispute.phase, 'answered');

      // کارمند دیگر راهی به آن ندارد
      assert.equal((await S.call(other, 'GET', `dispute/${id}`)).status, 404);
      assert.equal((await S.call(other, 'POST', `dispute/${id}/messages`, { message: 'نفوذ' })).status, 404);
      assert.equal((await S.call(other, 'POST', `dispute/${id}/close`)).status, 404);

      // کارمند می‌بندد
      const closed = await S.call(e.user, 'POST', `dispute/${id}/close`);
      assert.deepEqual([closed.status, closed.json.dispute.closed_by, closed.json.dispute.phase, closed.json.messages.length], [200, 'user', 'closed_by_user', 3]);
      assert.deepEqual((await aThread(id)).body.messages.map((m) => m.senderRole), ['user', 'user', 'admin']);
    });

    test('قدیمیِ باز: اگر ادمین اول پاسخ بدهد، پیام قدیمی همچنان اول می‌ماند و فقط یک‌بار ثبت می‌شود', async () => {
      const e = freshEmployee();
      const id = legacy(e, { text: 'اعتراض بدون رکورد' });
      const rep = await aReply(id, 'پاسخ ادمین');
      assert.equal(rep.status, 201);
      assert.deepEqual(rep.body.messages.map((m) => [m.senderRole, m.message]), [['user', 'اعتراض بدون رکورد'], ['admin', 'پاسخ ادمین']]);
      assert.equal(rep.body.dispute.awaitingAdmin, false);
      const t = (await S.call(e.user, 'GET', `dispute/${id}`)).json;
      assert.deepEqual(t.messages.map((m) => [m.sender_role, m.is_mine]), [['user', true], ['admin', false]]);
      assert.equal(t.dispute.phase, 'answered');
      assert.equal(msgCount(id), 2);
      const posted = await S.call(e.user, 'POST', `dispute/${id}/messages`, { message: 'ممنون' });
      assert.equal(posted.status, 201);
      assert.equal(msgCount(id), 3); // پیام قدیمی دوباره درج نشد
    });

    test('قدیمیِ حل‌شده (closed_by تهی): کارمند ادامه می‌دهد؛ پیام قدیمی اول است و ادمین هر دو را می‌بیند', async () => {
      const e = freshEmployee();
      const id = legacy(e, { status: 'resolved', text: 'اعتراض حل‌شده‌ی قدیمی' });
      const mine = await mineOf(e, id);
      assert.deepEqual([mine.phase, mine.message_count, mine.can_reply, mine.can_close, mine.can_reopen], ['resolved', 1, false, false, true]);
      const blocked = await S.call(e.user, 'POST', `dispute/${id}/messages`, { message: 'پیام' });
      assert.deepEqual([blocked.status, blocked.json.code], [409, 'DISPUTE_CLOSED']);

      const r = await empReopen(e, id, 'هنوز مشکل دارم');
      assert.equal(r.status, 200);
      assert.deepEqual([r.json.dispute.status, r.json.dispute.reopen_count, r.json.dispute.phase], ['open', 1, 'open']);
      assert.deepEqual(r.json.messages.map((m) => [m.sender_role, m.message]), [['user', 'اعتراض حل‌شده‌ی قدیمی'], ['user', 'هنوز مشکل دارم']]);

      const at = await aThread(id);
      assert.deepEqual(at.body.messages.map((m) => m.message), ['اعتراض حل‌شده‌ی قدیمی', 'هنوز مشکل دارم']);
      assert.deepEqual([at.body.dispute.awaitingAdmin, at.body.dispute.reopenCount], [true, 1]);
      assert.equal((await aReply(id, 'اصلاح می‌شود')).status, 201);
      assert.equal((await S.call(e.user, 'POST', `dispute/${id}/close`)).status, 200);
      assert.equal((await mineOf(e, id)).phase, 'closed_by_user');
    });

    test('قدیمیِ باز: اعتبارسنجی پیام کارمند (خالی/بلندتر از ۵۰۰) ⇒ ۴۰۰ و هیچ ردیفی نمی‌نویسد', async () => {
      const e = freshEmployee();
      const id = legacy(e);
      for (const message of ['', '   ', 'ن'.repeat(501)]) {
        const r = await S.call(e.user, 'POST', `dispute/${id}/messages`, { message });
        assert.deepEqual([r.status, r.json.code], [400, 'VALIDATION']);
      }
      assert.equal(msgCount(id), 0);
      assert.equal((await S.call(e.user, 'GET', `dispute/${id}`)).json.messages.length, 1);
    });
  });

  // ======== بخش ۳ از ۳ — زیربخش ۱: چک‌لیست بستن ماه در هر مرحله‌ی گفت‌وگو ========
  // اعتراضِ باز یا reopen‌شده مانع بستن ماه است (monthCloseBlockOpenDisputes)؛ resolved یا خاتمه‌یافته توسط کارمند مانع نیست.
  // زمان با mock.timers (Date) روی ۱۴۰۵/۰۷/۱۳ (۲۰۲۶-۱۰-۰۵) ثابت است؛ ماه هدف شهریور ۱۴۰۵ (۲۰۲۶-۰۸-۲۳ تا ۰۹-۲۲).
  describe('بخش ۳ — بستن ماه در هر مرحله (۱ از ۳: مانع‌بودن اعتراض)', { skip: typeof mock.timers?.enable === 'function' ? false : 'mock.timers در این Node نیست' }, () => {
    const Y = 1405; const M = 6;
    const NOW = '2026-10-05T06:30:00.000Z';
    const monthClose = () => require('../src/services/monthCloseService');
    let seq3 = 0;

    before(() => { mock.timers.enable({ apis: ['Date'], now: new Date(NOW) }); });
    after(() => {
      mock.timers.reset();
      db.prepare('DELETE FROM month_closures').run();
      db.prepare("DELETE FROM settings WHERE key = 'month_close_block_open_disputes'").run();
    });
    beforeEach(() => {
      db.prepare('DELETE FROM month_closures').run();
      db.prepare("DELETE FROM settings WHERE key IN ('dispute_max_reopens','month_close_block_open_disputes')").run();
      // اعتراض‌های بخش‌های قبلی ماه را مسدود نکنند: همه‌ی اعتراض‌های موجود به «حل‌شده» می‌روند
      db.prepare("UPDATE record_disputes SET status = 'resolved' WHERE status = 'open'").run();
    });

    function fresh() {
      seq3 += 1;
      const user = F.makeUser({ name: `کارمند بستن-${seq3}` });
      db.prepare('UPDATE users SET created_at = ? WHERE id = ?').run('2020-01-01 00:00:00', user.id);
      const rec = require('../src/repositories/attendanceRepository').createManual({
        userId: user.id, recordDate: '2026-09-10', checkInTime: '2026-09-10T05:00:00.000Z', checkOutTime: '2026-09-10T13:00:00.000Z', status: 'normal',
      });
      return { user, rec };
    }
    const item = () => monthClose().buildChecklist({ year: Y, month: M }).items.find((i) => i.key === 'open_disputes');
    const checklist = () => monthClose().buildChecklist({ year: Y, month: M });
    const blockedNow = () => assert.throws(() => monthClose().closeMonth({ year: Y, month: M, closedBy: admin.id }), (err) => err.code === 'CHECKLIST_BLOCKED');
    const create = async (e, message = 'ساعت ورود من اشتباه است') => {
      const r = await S.call(e.user, 'POST', 'dispute', { attendanceRecordId: e.rec.id, message });
      assert.equal(r.status, 201);
      return r.json.id;
    };
    const state = (id) => { const d = db.prepare('SELECT status, closed_by, reopen_count FROM record_disputes WHERE id = ?').get(id); return [d.status, d.closed_by, d.reopen_count]; };

    test('زمان ثابت است: «امروز» همان ۲۰۲۶-۱۰-۰۵ و ماه شهریور تمام‌شده', () => {
      assert.equal(new Date().toISOString().slice(0, 10), '2026-10-05');
      const c = checklist();
      assert.deepEqual([c.from, c.to], ['2026-08-23', '2026-09-22']);
      assert.equal(c.items.find((i) => i.key === 'month_not_ended').count, 0);
    });

    test('اعتراضِ تازه (منتظر پاسخ ادمین) ⇒ مانع؛ نمونه‌ی چک‌لیست همان اعتراض است و closeMonth ⇒ CHECKLIST_BLOCKED', async () => {
      const e = fresh();
      const id = await create(e);
      const it = item();
      assert.deepEqual([it.blocking, it.count, it.ok], [true, 1, false]);
      assert.deepEqual([it.samples[0].disputeId, it.samples[0].date], [id, '2026-09-10']);
      assert.equal(checklist().canClose, false);
      assert.equal(checklist().blockingCount >= 1, true);
      blockedNow();
      assert.equal(db.prepare('SELECT COUNT(*) n FROM month_closures').get().n, 0, 'بستنِ ناموفق چیزی ننوشته');
    });

    test('پاسخ ادمین، اعتراض را «باز» نگه می‌دارد ⇒ هنوز مانع (resolve نشده)', async () => {
      const e = fresh();
      const id = await create(e);
      assert.equal((await aReply(id, 'در حال بررسی')).status, 201);
      assert.equal(state(id)[0], 'open');
      assert.equal(item().count, 1);
      blockedNow();
    });

    test('resolve توسط ادمین ⇒ مانع نیست و ماه بسته می‌شود', async () => {
      const e = fresh();
      const id = await create(e);
      await aReply(id, 'اصلاح شد');
      assert.equal((await aAct('resolve', id, { note: 'اصلاح شد' })).status, 200);
      assert.deepEqual(state(id), ['resolved', 'admin', 0]);
      assert.deepEqual([item().count, item().ok, checklist().canClose], [0, true, true]);
      const { closure } = monthClose().closeMonth({ year: Y, month: M, closedBy: admin.id });
      assert.equal(closure.status, 'closed');
    });

    test('ادامه‌ی کارمند بعد از resolve (reopen‌شده) ⇒ دوباره مانع؛ با resolve مجدد آزاد', async () => {
      const e = fresh();
      const id = await create(e);
      await aAct('resolve', id, { note: 'حل شد' });
      assert.equal(item().count, 0);
      assert.equal((await S.call(e.user, 'POST', `dispute/${id}/reopen`, { message: 'هنوز درست نشده' })).status, 200);
      assert.deepEqual(state(id), ['open', null, 1]);
      assert.equal(item().count, 1);
      blockedNow();
      await aAct('resolve', id, { note: 'این بار قطعی' });
      assert.equal(item().count, 0);
      assert.equal(monthClose().closeMonth({ year: Y, month: M, closedBy: admin.id }).closure.status, 'closed');
    });

    test('بازگشایی توسط خودِ ادمین (reopen) هم مانع است', async () => {
      const e = fresh();
      const id = await create(e);
      await aAct('resolve', id, { note: 'حل شد' });
      assert.equal((await aAct('reopen', id, { note: 'بررسی مجدد' })).status, 200);
      assert.equal(state(id)[0], 'open');
      assert.equal(item().count, 1);
      blockedNow();
    });

    test('خاتمه توسط کارمند (closed_by=user) ⇒ مانع نیست؛ ماه بسته می‌شود', async () => {
      const e = fresh();
      const id = await create(e);
      assert.equal((await S.call(e.user, 'POST', `dispute/${id}/close`)).status, 200);
      assert.deepEqual(state(id), ['resolved', 'user', 0]);
      assert.deepEqual([item().count, checklist().canClose], [0, true]);
      assert.equal(monthClose().closeMonth({ year: Y, month: M, closedBy: admin.id }).closure.status, 'closed');
    });

    test('سناریوی کامل: هر مرحله‌ی گفت‌وگو وضعیت چک‌لیست را درست عوض می‌کند (باز ← پاسخ ← resolve ← ادامه ← خاتمه)', async () => {
      const e = fresh();
      const id = await create(e);
      const counts = [item().count];                                       // ۱: ثبت
      await aReply(id, 'پاسخ اول'); counts.push(item().count);              // ۱: پاسخ ادمین
      await aAct('resolve', id, { note: 'حل شد' }); counts.push(item().count); // ۰: resolve
      await S.call(e.user, 'POST', `dispute/${id}/reopen`, { message: 'ادامه' }); counts.push(item().count); // ۱: ادامه
      await aReply(id, 'پاسخ دوم'); counts.push(item().count);              // ۱: پاسخ دوم
      await S.call(e.user, 'POST', `dispute/${id}/close`); counts.push(item().count); // ۰: خاتمه
      assert.deepEqual(counts, [1, 1, 0, 1, 1, 0]);
    });

    test('فقط اعتراضِ باز همان ماه می‌شمرد: اعتراضِ ماهِ دیگر مانع نیست و اعتراضِ دیگر کارمندان هم مانع است', async () => {
      const a = fresh(); const b = fresh();
      const outside = require('../src/repositories/attendanceRepository').createManual({
        userId: a.user.id, recordDate: '2026-09-25', checkInTime: '2026-09-25T05:00:00.000Z', checkOutTime: '2026-09-25T13:00:00.000Z', status: 'normal',
      });
      const r = await S.call(a.user, 'POST', 'dispute', { attendanceRecordId: outside.id, message: 'مربوط به مهر' });
      assert.equal(r.status, 201);
      assert.equal(item().count, 0, 'رکورد ۲۰۲۶-۰۹-۲۵ بیرون از شهریور است');
      const idB = await create(b);
      assert.equal(item().count, 1);
      assert.equal(item().samples[0].disputeId, idB);
    });

    test('تنظیم monthCloseBlockOpenDisputes=خاموش: اعتراضِ باز فقط هشدار است و ماه بسته می‌شود', async () => {
      const e = fresh();
      await create(e);
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('month_close_block_open_disputes', 'false')").run();
      const it = item();
      assert.deepEqual([it.blocking, it.count], [false, 1]);
      assert.equal(checklist().canClose, true);
      assert.equal(monthClose().closeMonth({ year: Y, month: M, closedBy: admin.id }).closure.status, 'closed');
    });
  });

  // ======== بخش ۳ از ۳ — زیربخش ۲: بعد از بسته‌شدن ماه ========
  // پیام/ادامه/خاتمه‌ی کارمند ⇒ ۴۰۹ MONTH_CLOSED و هیچ ردیفی نمی‌نویسد؛ خواندن (فهرست/thread، کارمند و ادمین) آزاد است.
  // اعتراضِ «باز» در ماه بسته فقط وقتی پیش می‌آید که مانع‌بودن خاموش باشد (یا اعتراض بعداً باز شود)؛ برای پیام/خاتمه همین راه را می‌رویم.
  describe('بخش ۳ — بستن ماه در هر مرحله (۲ از ۳: ماه بسته ⇒ ۴۰۹ و خواندن آزاد)', { skip: typeof mock.timers?.enable === 'function' ? false : 'mock.timers در این Node نیست' }, () => {
    const Y = 1405; const M = 6;
    const NOW = '2026-10-05T06:30:00.000Z';
    const monthClose = () => require('../src/services/monthCloseService');
    let seq4 = 0;

    before(() => { mock.timers.enable({ apis: ['Date'], now: new Date(NOW) }); });
    after(() => {
      mock.timers.reset();
      db.prepare('DELETE FROM month_closures').run();
      db.prepare("DELETE FROM settings WHERE key IN ('dispute_max_reopens','month_close_block_open_disputes')").run();
    });
    beforeEach(() => {
      db.prepare('DELETE FROM month_closures').run();
      db.prepare("DELETE FROM settings WHERE key IN ('dispute_max_reopens','month_close_block_open_disputes')").run();
      db.prepare("UPDATE record_disputes SET status = 'resolved' WHERE status = 'open'").run();
    });

    function fresh() {
      seq4 += 1;
      const user = F.makeUser({ name: `کارمند ماه‌بسته-${seq4}` });
      db.prepare('UPDATE users SET created_at = ? WHERE id = ?').run('2020-01-01 00:00:00', user.id);
      const rec = require('../src/repositories/attendanceRepository').createManual({
        userId: user.id, recordDate: '2026-09-10', checkInTime: '2026-09-10T05:00:00.000Z', checkOutTime: '2026-09-10T13:00:00.000Z', status: 'normal',
      });
      return { user, rec };
    }
    const create = async (e, message = 'ساعت ورود من اشتباه است') => {
      const r = await S.call(e.user, 'POST', 'dispute', { attendanceRecordId: e.rec.id, message });
      assert.equal(r.status, 201);
      return r.json.id;
    };
    const closeTheMonth = () => { assert.equal(monthClose().closeMonth({ year: Y, month: M, closedBy: admin.id }).closure.status, 'closed'); };
    const allowOpenWhenClosing = () => db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('month_close_block_open_disputes', 'false')").run();
    const msgCount = (id) => db.prepare('SELECT COUNT(*) n FROM dispute_messages WHERE dispute_id = ?').get(id).n;
    const row = (id) => db.prepare('SELECT status, closed_by, reopen_count FROM record_disputes WHERE id = ?').get(id);
    const isMonthClosedErr = (r) => { assert.deepEqual([r.status, r.json.code], [409, 'MONTH_CLOSED']); assert.ok(r.json.error); };

    test('اعتراضِ باز در ماه بسته: پیام کارمند ⇒ ۴۰۹ MONTH_CLOSED و پیامی ذخیره نمی‌شود', async () => {
      const e = fresh();
      const id = await create(e);
      allowOpenWhenClosing();
      closeTheMonth();
      const before = msgCount(id);
      isMonthClosedErr(await S.call(e.user, 'POST', `dispute/${id}/messages`, { message: 'یادآوری' }));
      assert.equal(msgCount(id), before);
    });

    test('اعتراضِ باز در ماه بسته: خاتمه‌ی کارمند ⇒ ۴۰۹ MONTH_CLOSED و وضعیت همان «باز» می‌ماند', async () => {
      const e = fresh();
      const id = await create(e);
      allowOpenWhenClosing();
      closeTheMonth();
      isMonthClosedErr(await S.call(e.user, 'POST', `dispute/${id}/close`));
      assert.deepEqual([row(id).status, row(id).closed_by], ['open', null]);
    });

    test('اعتراضِ حل‌شده در ماه بسته: ادامه‌ی کارمند ⇒ ۴۰۹ MONTH_CLOSED؛ reopen_count و وضعیت تغییر نمی‌کنند', async () => {
      const e = fresh();
      const id = await create(e);
      assert.equal((await aAct('resolve', id, { note: 'حل شد' })).status, 200);
      closeTheMonth();
      const before = msgCount(id);
      isMonthClosedErr(await S.call(e.user, 'POST', `dispute/${id}/reopen`, { message: 'ادامه می‌دهم' }));
      assert.deepEqual([row(id).status, row(id).reopen_count, msgCount(id)], ['resolved', 0, before]);
    });

    test('خواندن در ماه بسته آزاد است: فهرست و thread کارمند (۲۰۰، با پیام‌ها) و thread ادمین', async () => {
      const e = fresh();
      const id = await create(e, 'متن اولیه');
      await aReply(id, 'پاسخ ادمین');
      await aAct('resolve', id, { note: 'حل شد' });
      closeTheMonth();

      const list = await S.call(e.user, 'GET', 'dispute');
      assert.equal(list.status, 200);
      const mine = list.json.find((d) => d.id === id);
      assert.deepEqual([mine.status, mine.phase, mine.message_count], ['resolved', 'resolved', 2]);

      const th = await S.call(e.user, 'GET', `dispute/${id}`);
      assert.equal(th.status, 200);
      assert.deepEqual(th.json.messages.map((m) => [m.sender_role, m.message]), [['user', 'متن اولیه'], ['admin', 'پاسخ ادمین']]);

      const at = await aThread(id);
      assert.equal(at.status, 200);
      assert.deepEqual(at.body.messages.map((m) => m.message), ['متن اولیه', 'پاسخ ادمین']);
    });

    test('قفل فقط کارمند را می‌گیرد: ادمین در ماه بسته می‌تواند پاسخ بدهد و اعتراض را reopen/resolve کند (تصمیم D3)', async () => {
      const e = fresh();
      const id = await create(e);
      allowOpenWhenClosing();
      closeTheMonth();
      assert.equal((await aReply(id, 'پاسخ در ماه بسته')).status, 201);
      assert.equal((await aAct('resolve', id, { note: 'حل شد' })).status, 200);
      assert.equal((await aAct('reopen', id, { note: 'بررسی مجدد' })).status, 200);
      assert.equal(row(id).status, 'open');
    });

    test('قفل به ماه بسته‌ی همان اعتراض محدود است: اعتراضِ رکوردِ ماه دیگر (مهر) با ماه شهریورِ بسته آزاد می‌ماند', async () => {
      const e = fresh();
      const other = require('../src/repositories/attendanceRepository').createManual({
        userId: e.user.id, recordDate: '2026-09-25', checkInTime: '2026-09-25T05:00:00.000Z', checkOutTime: '2026-09-25T13:00:00.000Z', status: 'normal',
      });
      const r = await S.call(e.user, 'POST', 'dispute', { attendanceRecordId: other.id, message: 'مربوط به مهر' });
      assert.equal(r.status, 201);
      closeTheMonth();
      const m = await S.call(e.user, 'POST', `dispute/${r.json.id}/messages`, { message: 'هنوز آزاد است' });
      assert.equal(m.status, 201);
    });

    test('بعد از بسته‌شدن ماه: اعتبارسنجی و مالکیت همچنان جلوتر از قفل‌اند (دیگری ⇒ ۴۰۴؛ پیام خالی ⇒ ۴۰۰)', async () => {
      const e = fresh(); const stranger = fresh();
      const id = await create(e);
      allowOpenWhenClosing();
      closeTheMonth();
      assert.equal((await S.call(stranger.user, 'POST', `dispute/${id}/messages`, { message: 'سلام' })).status, 404);
      const empty = await S.call(e.user, 'POST', `dispute/${id}/messages`, { message: '   ' });
      assert.deepEqual([empty.status, empty.json.code], [400, 'VALIDATION']);
    });
  });

  describe('بخش ۳ — بستن ماه در هر مرحله (۳ از ۳: ماه بازگشایی‌شده دوباره قفل نیست)', { skip: typeof mock.timers?.enable === 'function' ? false : 'mock.timers در این Node نیست' }, () => {
    const Y = 1405; const M = 6;
    const NOW = '2026-10-05T06:30:00.000Z';
    const monthClose = () => require('../src/services/monthCloseService');
    const closures = () => require('../src/repositories/monthClosuresRepository');
    let seq5 = 0;

    before(() => { mock.timers.enable({ apis: ['Date'], now: new Date(NOW) }); });
    after(() => {
      mock.timers.reset();
      db.prepare('DELETE FROM month_closures').run();
      db.prepare("DELETE FROM settings WHERE key IN ('dispute_max_reopens','month_close_block_open_disputes')").run();
    });
    beforeEach(() => {
      db.prepare('DELETE FROM month_closures').run();
      db.prepare("DELETE FROM settings WHERE key IN ('dispute_max_reopens','month_close_block_open_disputes')").run();
      db.prepare("UPDATE record_disputes SET status = 'resolved' WHERE status = 'open'").run();
    });

    function fresh() {
      seq5 += 1;
      const user = F.makeUser({ name: `کارمند ماه‌بازشده-${seq5}` });
      db.prepare('UPDATE users SET created_at = ? WHERE id = ?').run('2020-01-01 00:00:00', user.id);
      const rec = require('../src/repositories/attendanceRepository').createManual({
        userId: user.id, recordDate: '2026-09-10', checkInTime: '2026-09-10T05:00:00.000Z', checkOutTime: '2026-09-10T13:00:00.000Z', status: 'normal',
      });
      return { user, rec };
    }
    const create = async (e, message = 'ساعت ورود من اشتباه است') => {
      const r = await S.call(e.user, 'POST', 'dispute', { attendanceRecordId: e.rec.id, message });
      assert.equal(r.status, 201);
      return r.json.id;
    };
    const allowOpenWhenClosing = () => db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('month_close_block_open_disputes', 'false')").run();
    const closeTheMonth = () => { assert.equal(monthClose().closeMonth({ year: Y, month: M, closedBy: admin.id }).closure.status, 'closed'); };
    const reopenTheMonth = () => { assert.equal(closures().reopen(Y, M, { reopenedBy: admin.id, reason: 'اصلاح اعتراض' }).status, 'reopened'); };
    const msgCount = (id) => db.prepare('SELECT COUNT(*) n FROM dispute_messages WHERE dispute_id = ?').get(id).n;
    const row = (id) => db.prepare('SELECT status, closed_by, reopen_count FROM record_disputes WHERE id = ?').get(id);
    const isMonthClosedErr = (r) => { assert.deepEqual([r.status, r.json.code], [409, 'MONTH_CLOSED']); };

    test('ماه بسته ⇒ پیام ۴۰۹؛ بعد از reopen ماه ⇒ همان اعتراضِ باز دوباره پیام می‌پذیرد (و ذخیره می‌شود)', async () => {
      const e = fresh();
      const id = await create(e);
      allowOpenWhenClosing();
      closeTheMonth();
      isMonthClosedErr(await S.call(e.user, 'POST', `dispute/${id}/messages`, { message: 'در ماه بسته' }));
      const before = msgCount(id);
      reopenTheMonth();
      const r = await S.call(e.user, 'POST', `dispute/${id}/messages`, { message: 'بعد از بازگشایی' });
      assert.equal(r.status, 201);
      assert.equal(msgCount(id), before + 1);
    });

    test('ماه بازگشایی‌شده: خاتمه‌ی کارمند آزاد است', async () => {
      const e = fresh();
      const id = await create(e);
      allowOpenWhenClosing();
      closeTheMonth();
      isMonthClosedErr(await S.call(e.user, 'POST', `dispute/${id}/close`));
      reopenTheMonth();
      assert.equal((await S.call(e.user, 'POST', `dispute/${id}/close`)).status, 200);
      assert.deepEqual([row(id).status, row(id).closed_by], ['resolved', 'user']);
    });

    test('ماه بازگشایی‌شده: «ادامه‌ی اعتراض» بعد از resolve آزاد است و به سقف می‌شمارد', async () => {
      const e = fresh();
      const id = await create(e);
      assert.equal((await aAct('resolve', id, { note: 'حل شد' })).status, 200);
      closeTheMonth();
      isMonthClosedErr(await S.call(e.user, 'POST', `dispute/${id}/reopen`, { message: 'ادامه' }));
      assert.equal(row(id).reopen_count, 0);
      reopenTheMonth();
      const r = await S.call(e.user, 'POST', `dispute/${id}/reopen`, { message: 'ادامه می‌دهم' });
      assert.equal(r.status, 200);
      assert.deepEqual([row(id).status, row(id).reopen_count], ['open', 1]);
    });

    test('دوباره بسته‌شدنِ ماه (close_count=2) قفل را برمی‌گرداند و دوباره reopen کردن آن را آزاد می‌کند', async () => {
      const e = fresh();
      const id = await create(e);
      allowOpenWhenClosing();
      closeTheMonth();
      reopenTheMonth();
      assert.equal((await S.call(e.user, 'POST', `dispute/${id}/messages`, { message: 'در ماه بازشده' })).status, 201);
      closeTheMonth();
      assert.equal(closures().findByMonth(Y, M).close_count, 2);
      const before = msgCount(id);
      isMonthClosedErr(await S.call(e.user, 'POST', `dispute/${id}/messages`, { message: 'دوباره قفل' }));
      assert.equal(msgCount(id), before);
      reopenTheMonth();
      assert.equal((await S.call(e.user, 'POST', `dispute/${id}/messages`, { message: 'دوباره آزاد' })).status, 201);
    });

    test('خواندن در همه‌ی حالت‌های ماه (بسته ← بازشده) آزاد است و thread ثابت می‌ماند', async () => {
      const e = fresh();
      const id = await create(e, 'متن اولیه');
      await aReply(id, 'پاسخ ادمین');
      allowOpenWhenClosing();
      closeTheMonth();
      const closedView = (await S.call(e.user, 'GET', `dispute/${id}`)).json.messages.map((m) => m.message);
      reopenTheMonth();
      const th = await S.call(e.user, 'GET', `dispute/${id}`);
      assert.equal(th.status, 200);
      assert.deepEqual(th.json.messages.map((m) => m.message), closedView);
      assert.deepEqual(closedView, ['متن اولیه', 'پاسخ ادمین']);
      assert.equal((await S.call(e.user, 'GET', 'dispute')).status, 200);
      assert.equal((await aThread(id)).status, 200);
    });

    test('ماه بازگشایی‌شده با اعتراضِ باز: چک‌لیست دوباره مانع است (status=reopened) و با resolve آزاد می‌شود', async () => {
      const e = fresh();
      const id = await create(e);
      allowOpenWhenClosing();
      closeTheMonth();
      reopenTheMonth();
      db.prepare("DELETE FROM settings WHERE key = 'month_close_block_open_disputes'").run();
      const c = monthClose().buildChecklist({ year: Y, month: M });
      assert.equal(c.closure.status, 'reopened');
      assert.ok(c.items.find((i) => i.key === 'open_disputes').count >= 1);
      assert.throws(() => monthClose().closeMonth({ year: Y, month: M, closedBy: admin.id }), (err) => err.code === 'CHECKLIST_BLOCKED');
      assert.equal((await aAct('resolve', id, { note: 'حل شد' })).status, 200);
      assert.equal(monthClose().closeMonth({ year: Y, month: M, closedBy: admin.id }).closure.status, 'closed');
    });

    test('سناریوی کامل با ماه: ثبت ← بستن ماه ← reopen ماه ← پاسخ/resolve/ادامه/خاتمه ← بستن دوباره ⇒ وضعیت نهایی و قفل درست', async () => {
      const e = fresh();
      const id = await create(e);
      assert.equal((await aReply(id, 'پاسخ ادمین')).status, 201);
      assert.equal((await aAct('resolve', id, { note: 'حل شد' })).status, 200);
      closeTheMonth();
      reopenTheMonth();
      assert.equal((await S.call(e.user, 'POST', `dispute/${id}/reopen`, { message: 'هنوز مشکل دارم' })).status, 200);
      assert.equal((await aReply(id, 'پاسخ دوم')).status, 201);
      assert.equal((await S.call(e.user, 'POST', `dispute/${id}/close`)).status, 200);
      closeTheMonth();
      assert.deepEqual([row(id).status, row(id).closed_by, row(id).reopen_count], ['resolved', 'user', 1]);
      isMonthClosedErr(await S.call(e.user, 'POST', `dispute/${id}/reopen`, { message: 'بعد از بستن' }));
      assert.equal(row(id).reopen_count, 1);
    });
  });
});

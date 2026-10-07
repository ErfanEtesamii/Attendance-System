// S4-6b: اتصال رویدادهای موجود به اعلان‌های پنل — هر رویداد اعلان درست (گیرنده، نوع، لینک، dedupe) می‌سازد
// و هیچ‌وقت جریان اصلی را نمی‌شکند. مسیرهای واقعی: Mini App، API پنل، callbackهای بات، watchdog، fraudRunner.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

let hasDeps = true;
try { require.resolve('express'); } catch (_) { hasDeps = false; }

describe('اتصال رویدادها به اعلان‌ها (S4-6b)', { skip: hasDeps ? false : 'express نصب نیست (npm install)' }, () => {
  let db; let server; let base; let F; let cookies; let U;
  let wrapJob; let runWatchdog; let runFraudChecks; let leaveRepository; let disputeRepository;
  let handleLeaveCallback; let handlePendingLeavesCallback; let handleDisputeCallback;
  const TOKEN = process.env.TELEGRAM_BOT_TOKEN;

  const notifs = (user, type) =>
    db.prepare('SELECT * FROM notifications WHERE user_id = ? AND type = ? ORDER BY id').all(user.id, type)
      .map((n) => ({ ...n, data: n.data ? JSON.parse(n.data) : null }));
  const alerts = (user, key) => notifs(user, 'system_alert').filter((n) => n.data.alertKey === key);
  const total = (type) => db.prepare('SELECT COUNT(*) n FROM notifications WHERE type = ?').get(type).n;

  function signInitData(telegramId) {
    const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: Number(telegramId), first_name: 'تست' }) });
    const dcs = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
    const secret = crypto.createHmac('sha256', 'WebAppData').update(TOKEN).digest();
    params.set('hash', crypto.createHmac('sha256', secret).update(dcs).digest('hex'));
    return params.toString();
  }
  async function miniapp(user, path, body) {
    const res = await fetch(`${base}/api/miniapp/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-telegram-init-data': signInitData(user.telegram_user_id) },
      body: JSON.stringify(body),
    });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  }
  async function panel(user, method, url, body = {}) {
    const res = await fetch(base + url, {
      method,
      headers: { 'content-type': 'application/json', cookie: cookies[user.id], 'x-requested-with': 'AttendancePanel' },
      body: JSON.stringify(body),
    });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  }
  const mockBot = () => ({
    sent: [],
    async sendMessage(chatId, text) { this.sent.push({ chatId, text }); return true; },
    async answerCallbackQuery() { return true; },
    async editMessageReplyMarkup() { return true; },
  });
  const callback = (fromUser, data) => ({ id: 'cb1', from: { id: Number(fromUser.telegram_user_id) }, data, message: { chat: { id: 5000 }, message_id: 1 } });

  before(async () => {
    db = resetDb();
    F = require('./helpers/factories');
    const config = require('../src/config');
    config.allowedNetworkCidr = '127.0.0.0/8';
    config.monitor.backupCheck = false; // مثل monitoring.test.js: پوشه‌ی بک‌آپ در تست نیست و backup_stale نباید قاطی شود
    ({ wrapJob } = require('../src/utils/jobRunner'));
    ({ runWatchdog } = require('../src/bot/scheduler/watchdog'));
    ({ runFraudChecks } = require('../src/utils/fraudRunner'));
    leaveRepository = require('../src/repositories/leaveRepository');
    disputeRepository = require('../src/repositories/disputeRepository');
    ({ handleLeaveCallback } = require('../src/bot/commands/leave'));
    ({ handlePendingLeavesCallback } = require('../src/bot/commands/pendingLeaves'));
    ({ handleDisputeCallback } = require('../src/bot/commands/pendingDisputes'));
    const { createApp } = require('../src/server');

    const admin = F.makeUser({ role: 'admin' });
    const admin2 = F.makeUser({ role: 'admin' });
    const inactiveAdmin = F.makeUser({ role: 'admin', active: false });
    const manager = F.makeUser({ role: 'manager' });
    const manager2 = F.makeUser({ role: 'manager' });
    const emp = F.makeUser({ managerId: manager.id });       // تیم manager
    const emp2 = F.makeUser({ managerId: manager.id });      // تیم manager
    const empOther = F.makeUser({ managerId: manager2.id }); // تیم manager2
    const loner = F.makeUser();                               // بدون مدیر مستقیم
    U = { admin, admin2, inactiveAdmin, manager, manager2, emp, emp2, empOther, loner };
    cookies = Object.fromEntries(Object.values(U).map((u) => [u.id, F.sessionCookie(u.id)]));

    server = createApp().listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => { if (server) server.close(); cleanup(); });

  test('مرخصی جدید (Mini App و بات): مدیر مستقیم؛ بدون مدیر ⇒ ادمین‌های فعال؛ نه کارمند/ادمین غیرفعال؛ لینک و data درست', async () => {
    const r1 = await miniapp(U.emp, 'leave', { startDate: '2026-11-01', endDate: '2026-11-03', leaveType: 'leave', reason: 'سفر' });
    assert.equal(r1.status, 201);
    const n = notifs(U.manager, 'leave_requested');
    assert.equal(n.length, 1);
    assert.equal(n[0].title, 'درخواست مرخصی جدید');
    assert.equal(n[0].link, '#/leave');
    assert.deepEqual(n[0].data, { requestId: r1.json.id, employeeId: U.emp.id, leaveType: 'leave' });
    assert.match(n[0].body, /2026-11-01 تا 2026-11-03/);
    assert.equal(n[0].dedupe_key, `leave_requested:${r1.json.id}`);
    assert.equal(n[0].telegram_status, 'none', 'تلگرام از مسیر قبلی است، نه notify');
    assert.equal(notifs(U.admin, 'leave_requested').length, 0, 'ادمین وقتی مدیر دارد اعلان نمی‌گیرد');

    // بدون مدیر مستقیم + مأموریت ⇒ همه‌ی ادمین‌های «فعال»
    const r2 = await miniapp(U.loner, 'leave', { startDate: '2026-11-05', endDate: '2026-11-05', leaveType: 'mission' });
    assert.equal(r2.status, 201);
    for (const a of [U.admin, U.admin2]) assert.equal(notifs(a, 'leave_requested').at(-1).title, 'درخواست مأموریت جدید');
    assert.equal(notifs(U.inactiveAdmin, 'leave_requested').length, 0);
    assert.equal(notifs(U.loner, 'leave_requested').length, 0);

    // مسیر بات
    const bot = mockBot();
    await handleLeaveCallback(bot, { id: 'q', data: 'leave_confirm:yes', message: { chat: { id: 5001 } } }, {
      data: { userId: U.emp2.id, startDate: '2026-11-10', endDate: '2026-11-10', leaveType: 'leave', reason: null },
    });
    assert.equal(notifs(U.manager, 'leave_requested').length, 2);
  });

  test('تصمیم مرخصی (پنل approve/reject، PATCH، بات): اعلان به کارمند با نوع/یادداشت؛ بازگشت به pending و تصمیم تکراری ⇒ اعلان اضافه نه', async () => {
    const a = leaveRepository.createLeaveRequest({ userId: U.emp.id, startDate: '2026-12-01', endDate: '2026-12-02', leaveType: 'leave' });
    const ok = await panel(U.manager, 'POST', `/api/admin/leave-requests/${a.id}/approve`, { note: 'موافقم' });
    assert.equal(ok.status, 200);
    let n = notifs(U.emp, 'leave_approved');
    assert.equal(n.length, 1);
    assert.equal(n[0].title, 'درخواست مرخصی شما تأیید شد');
    assert.match(n[0].body, /پاسخ: موافقم/);
    assert.equal(n[0].link, '#/leave');
    assert.deepEqual(n[0].data, { requestId: a.id, status: 'approved' });
    assert.equal((await panel(U.manager, 'POST', `/api/admin/leave-requests/${a.id}/approve`)).status, 400, 'تصمیم دوباره رد می‌شود');
    assert.equal(notifs(U.emp, 'leave_approved').length, 1);

    // رد مأموریت با یادداشت
    const b = leaveRepository.createLeaveRequest({ userId: U.emp.id, startDate: '2026-12-05', endDate: '2026-12-05', leaveType: 'mission' });
    await panel(U.admin, 'POST', `/api/admin/leave-requests/${b.id}/reject`, { note: 'ظرفیت نیست' });
    n = notifs(U.emp, 'leave_rejected');
    assert.equal(n.length, 1);
    assert.equal(n[0].title, 'درخواست مأموریت شما رد شد');
    assert.match(n[0].body, /ظرفیت نیست/);

    // PATCH: تغییر وضعیت ⇒ تصمیم؛ بازگشت به pending ⇒ هیچ اعلانی
    await panel(U.admin, 'PATCH', `/api/admin/leave-requests/${b.id}`, { status: 'approved' });
    assert.equal(notifs(U.emp, 'leave_approved').length, 2);
    await panel(U.admin, 'PATCH', `/api/admin/leave-requests/${b.id}`, { status: 'pending' });
    assert.equal(notifs(U.emp, 'leave_approved').length, 2);
    assert.equal(notifs(U.emp, 'leave_rejected').length, 1);

    // بات
    const c = leaveRepository.createLeaveRequest({ userId: U.emp2.id, startDate: '2026-12-09', endDate: '2026-12-09', leaveType: 'leave' });
    await handlePendingLeavesCallback(mockBot(), callback(U.manager, `leave_reject:${c.id}`));
    assert.equal(notifs(U.emp2, 'leave_rejected').length, 1);
    assert.equal(notifs(U.manager, 'leave_rejected').length, 0, 'اعلان فقط به کارمند می‌رود');
  });

  test('اعتراض: جدید ⇒ تأییدکننده‌ها؛ بسته‌شدن (پنل و بات) ⇒ کارمند؛ بازگشایی ⇒ اعلان ندارد', async () => {
    const r = await miniapp(U.emp, 'dispute', { message: 'ورود من ثبت نشده' });
    assert.equal(r.status, 201);
    const n = notifs(U.manager, 'dispute_opened');
    assert.equal(n.length, 1);
    assert.equal(n[0].link, '#/disputes');
    assert.match(n[0].body, /ورود من ثبت نشده/);
    assert.deepEqual(n[0].data, { disputeId: r.json.id, employeeId: U.emp.id, attendanceRecordId: null });
    assert.equal(notifs(U.emp, 'dispute_opened').length, 0);

    const done = await panel(U.manager, 'POST', `/api/admin/disputes/${r.json.id}/resolve`, { note: 'اصلاح شد' });
    assert.equal(done.status, 200);
    const res1 = notifs(U.emp, 'dispute_resolved');
    assert.equal(res1.length, 1);
    assert.equal(res1[0].title, 'اعتراض شما بررسی و بسته شد');
    assert.match(res1[0].body, /اصلاح شد/);

    await panel(U.manager, 'POST', `/api/admin/disputes/${r.json.id}/reopen`);
    assert.equal(notifs(U.emp, 'dispute_resolved').length, 1, 'بازگشایی اعلان نمی‌سازد');

    const d = disputeRepository.createDispute({ userId: U.emp2.id, attendanceRecordId: null, message: 'اعتراض بات' });
    await handleDisputeCallback(mockBot(), callback(U.manager, `dispute_close:${d.id}`));
    const res2 = notifs(U.emp2, 'dispute_resolved');
    assert.equal(res2.length, 1);
    assert.equal(res2[0].body, null, 'بستن بدون پاسخ ⇒ بدون بدنه');
  });

  test('هشدار سیستم: فقط ادمین‌های فعال؛ یک اعلان برای هر دوره‌ی هشدار (تکرار چرخه/یادآوری ⇒ نه)؛ دوره‌ی تازه ⇒ اعلان تازه', async () => {
    await wrapJob('dailyReport', () => { throw new Error('خطای عمدی'); })();
    const t0 = Date.now();
    await runWatchdog({ bot: mockBot(), now: t0 });
    await runWatchdog({ bot: mockBot(), now: t0 + 5 * 60 * 1000 });
    await runWatchdog({ bot: mockBot(), now: t0 + 25 * 3600 * 1000 }); // یادآوری ۲۴ساعته‌ی تلگرام
    for (const a of [U.admin, U.admin2]) {
      const n = alerts(a, 'job_failed:dailyReport');
      assert.equal(n.length, 1);
      assert.equal(notifs(a, 'system_alert').length, 1, 'هشدار دیگری فعال نیست');
      assert.match(n[0].title, /dailyReport/);
      assert.equal(n[0].link, '#/system');
    }
    for (const u of [U.inactiveAdmin, U.manager, U.emp]) assert.equal(notifs(u, 'system_alert').length, 0);

    // دوره‌ی تازه: بعد از رفع (Job موفق) و شکست دوباره
    db.prepare("DELETE FROM job_runs WHERE job_name = 'dailyReport'").run();
    await runWatchdog({ bot: mockBot(), now: t0 + 26 * 3600 * 1000 }); // «رفع شد»
    await wrapJob('dailyReport', () => { throw new Error('دوباره'); })();
    await runWatchdog({ bot: mockBot(), now: t0 + 27 * 3600 * 1000 });
    assert.equal(alerts(U.admin, 'job_failed:dailyReport').length, 2);
  });

  test('مورد مشکوک: ادمین‌ها + فقط سرپرستی که «همه‌ی» کاربران مورد در تیم اویند؛ اجرای دوباره (تکراری) اعلان نمی‌سازد', () => {
    const ins = (userId, date, dev, ip) =>
      db.prepare('INSERT INTO attendance_records (user_id, record_date, check_in_time, check_in_ip, check_in_device) VALUES (?, ?, ?, ?, ?)')
        .run(userId, date, `${date}T08:00:00.000Z`, ip, dev);
    const D1 = '2026-10-06'; const D2 = '2026-10-07';
    ins(U.emp.id, D1, 'dev-a-0000000000001', '10.1.0.1'); ins(U.emp2.id, D1, 'dev-a-0000000000001', '10.1.0.2'); // هر دو تیم manager
    ins(U.emp.id, D2, 'dev-b-0000000000001', '10.1.0.3'); ins(U.empOther.id, D2, 'dev-b-0000000000001', '10.1.0.4'); // دو تیم متفاوت

    const first = runFraudChecks({ date: D1 });
    assert.deepEqual(first.created.map((e) => e.event_type), ['shared_device']);
    assert.equal(runFraudChecks({ date: D2 }).created.length, 1);
    const [ev1, ev2] = db.prepare("SELECT id FROM suspicious_events WHERE event_type = 'shared_device' ORDER BY id").all();

    for (const a of [U.admin, U.admin2]) assert.equal(notifs(a, 'suspicious_event').length, 2);
    const mine = notifs(U.manager, 'suspicious_event');
    assert.equal(mine.length, 1, 'manager فقط مورد داخل تیم خودش را می‌گیرد');
    assert.equal(mine[0].data.eventId, ev1.id);
    assert.equal(mine[0].title, 'نشانه‌ی جدید برای بررسی', 'نشانه، نه اتهام');
    assert.match(mine[0].body, /یک دستگاه برای چند نفر · 2026-10-06/);
    assert.equal(mine[0].link, '#/suspicious');
    assert.equal(notifs(U.manager2, 'suspicious_event').length, 0, 'مورد مشترک با تیم دیگر ⇒ سرپرست نمی‌بیند');
    assert.equal(notifs(U.inactiveAdmin, 'suspicious_event').length, 0);
    assert.equal(notifs(U.emp, 'suspicious_event').length, 0);
    assert.ok(ev2.id > ev1.id);

    const before = total('suspicious_event');
    const again = runFraudChecks({ date: D1 });
    assert.equal(again.created.length, 0);
    assert.equal(total('suspicious_event'), before);
  });

  test('خرابی اعلان هرگز جریان اصلی را نمی‌شکند: بدون جدول notifications مرخصی/اعتراض/تصمیم هنوز موفق‌اند', async () => {
    db.exec('ALTER TABLE notifications RENAME TO notifications_off');
    try {
      const l = await miniapp(U.loner, 'leave', { startDate: '2027-01-01', endDate: '2027-01-01', leaveType: 'leave' });
      assert.equal(l.status, 201);
      const d = await miniapp(U.emp, 'dispute', { message: 'تست خرابی' });
      assert.equal(d.status, 201);
      assert.equal((await panel(U.admin, 'POST', `/api/admin/leave-requests/${l.json.id}/approve`)).status, 200);
      assert.equal((await panel(U.manager, 'POST', `/api/admin/disputes/${d.json.id}/resolve`)).status, 200);
      const r = runFraudChecks({ date: '2026-10-06' });
      assert.equal(r.ok, true);
      // رویدادها با ورودی نامعتبر هم استثنا نمی‌دهند
      const events = require('../src/services/notificationEvents');
      assert.deepEqual(await events.leaveRequested({ id: 1, user_id: 999999, leave_type: 'leave' }), []);
      assert.deepEqual(await events.leaveDecided({ id: 1, user_id: 1, status: 'pending' }), []);
    } finally {
      db.exec('ALTER TABLE notifications_off RENAME TO notifications');
    }
  });
});

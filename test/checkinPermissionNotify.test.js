// D3 (فاز ۱۲): اعلان و تصمیم سرپرست/ادمین روی «اجازه‌ی ورود» (سقف تأخیر ماهانه).
//   • اعلان درخواست (پنل + تلگرام با دکمه‌های cp_ok/cp_no) به سرپرست مستقیم (وگرنه ادمین‌ها؛ hr هرگز) و اعلان تصمیم به کارمند؛ dedupe
//   • API: GET /admin/checkin-permissions (اسکوپ نقش) و POST .../decide (۴۰۹ برای تصمیم دوباره، ۴۰۳ خارج از اسکوپ/hr/کارمند، audit)
//   • دکمه‌های بات (تلگرام ماک‌شده) با همان سرویس مشترک
//   • miniapp: درخواست کارمند ⇒ اعلان به سرپرست؛ خلاصه‌ی «۲ از ۳» (monthSummary + فیلد lateLimit پرونده)
// تلگرام واقعی در تست نیست: notifier.sendMessage قبل از require بقیه‌ی ماژول‌ها ماک می‌شود.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');

const db = resetDb();
const sent = []; // { to, text, options }
const notifier = require('../src/bot/notifier');
notifier.notifyUser = async (to, text) => { sent.push({ to: String(to), text, options: undefined }); };
let failTelegram = false; // نشان‌دادن خرابی تلگرام (sendMessage هنگام load ماژول‌ها گرفته می‌شود؛ پس سوییچ داخل خود ماک است)
notifier.sendMessage = async (to, text, options) => { if (failTelegram) throw new Error('telegram down'); sent.push({ to: String(to), text, options }); return true; };

let hasDeps = true;
try { require('express'); } catch (_) { hasDeps = false; }

const F = require('./helpers/factories');
const repo = require('../src/repositories/checkinPermissionRepository');
const settings = require('../src/repositories/settingsRepository');
const attendanceRepo = require('../src/repositories/attendanceRepository');
const lateLimit = require('../src/services/lateLimitService');
const events = require('../src/services/notificationEvents');
const { hasPermission } = require('../src/middleware/permissions');
const { handleCheckinPermissionCallback } = require('../src/bot/commands/checkinPermission');
const { todayInZone, zonedTimeToUtc } = require('../src/utils/time');

after(() => cleanup());

const today = () => todayInZone(settings.getAll().timezone, new Date());
const view = (row) => ({ id: row.id, userId: row.user_id, reason: row.reason, status: row.status });
const ask = (emp, reason = 'ترافیک') => repo.insert({ userId: emp.id, date: today(), reason, requestedAt: new Date().toISOString() });
const notifRows = (type, key) => db.prepare('SELECT * FROM notifications WHERE type = ? AND dedupe_key = ? ORDER BY id').all(type, key);
const auditOf = (action, userId) => db.prepare('SELECT details FROM audit_log WHERE action = ? AND user_id = ?').all(action, userId).map((r) => (typeof r.details === 'string' ? JSON.parse(r.details) : r.details));
const tick = () => new Promise((r) => setImmediate(r));

let admin; let hr; let m1; let m2;
let n = 0;
const fresh = (manager) => { n += 1; return F.makeUser({ managerId: manager ? manager.id : null, name: `کارمند D3-${n}` }); };

describe('مجوزهای اجازه‌ی ورود (D3)', () => {
  test('admin و سرپرست: read و decide؛ hr فقط read؛ کارمند هیچ', () => {
    for (const p of ['checkin_permissions.read', 'checkin_permissions.decide']) {
      assert.equal(hasPermission('admin', p), true, `admin ${p}`);
      assert.equal(hasPermission('manager', p), true, `manager ${p}`);
      assert.equal(hasPermission('employee', p), false, `employee ${p}`);
    }
    assert.equal(hasPermission('hr', 'checkin_permissions.read'), true);
    assert.equal(hasPermission('hr', 'checkin_permissions.decide'), false);
  });
});

describe('اعلان و تصمیم اجازه‌ی ورود (D3)', { skip: hasDeps ? false : 'express نصب نیست' }, () => {
  let server; let base; let cookies;
  const bots = () => {
    const calls = { answer: [], edit: [], send: [] };
    return {
      calls,
      answerCallbackQuery: async (id, o) => { calls.answer.push(o); },
      editMessageReplyMarkup: async (m, o) => { calls.edit.push({ m, o }); },
      sendMessage: async (chat, text) => { calls.send.push({ chat, text }); },
    };
  };
  const query = (user, data) => ({ id: 'q1', data, from: { id: Number(user.telegram_user_id) }, message: { chat: { id: 5 }, message_id: 7 } });

  before(async () => {
    admin = F.makeUser({ role: 'admin' });
    hr = F.makeUser({ role: 'hr' });
    m1 = F.makeUser({ role: 'manager', name: 'سرپرست ۱' });
    m2 = F.makeUser({ role: 'manager', name: 'سرپرست ۲' });
    const { createApp } = require('../src/server');
    cookies = { admin: F.sessionCookie(admin.id), hr: F.sessionCookie(hr.id), m1: F.sessionCookie(m1.id), m2: F.sessionCookie(m2.id) };
    server = createApp().listen(0);
    await new Promise((res) => server.once('listening', res));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => { if (server) server.close(); });
  beforeEach(() => { sent.length = 0; });

  async function hit(who, method, url, body) {
    const headers = { 'content-type': 'application/json', 'x-requested-with': 'AttendancePanel' };
    if (who && cookies[who]) headers.cookie = cookies[who];
    const res = await fetch(base + url, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(body || {}) });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  }
  const list = (who, qs = '') => hit(who, 'GET', `/api/admin/checkin-permissions${qs}`);
  const decide = (who, id, body) => hit(who, 'POST', `/api/admin/checkin-permissions/${id}/decide`, body);

  // ---------- اعلان ----------

  test('درخواست تازه ⇒ اعلان پنل + تلگرام با دکمه‌های تأیید/رد فقط به سرپرست مستقیم (نه ادمین، hr یا سرپرست دیگر)؛ dedupe', async () => {
    const e = fresh(m1);
    const p = ask(e, 'ترافیک سنگین');
    await events.checkinPermissionRequested(view(p));
    const rows = notifRows('checkin_permission_requested', `checkin_permission_requested:${p.id}`);
    assert.deepEqual(rows.map((r) => r.user_id), [m1.id]);
    assert.equal(rows[0].link, '#/checkin_permissions');
    assert.match(rows[0].body, /علت: ترافیک سنگین/);
    const tg = sent.filter((s) => s.to === String(m1.telegram_user_id));
    assert.equal(tg.length, 1);
    assert.deepEqual(tg[0].options.reply_markup.inline_keyboard[0].map((b) => b.callback_data), [`cp_ok:${p.id}`, `cp_no:${p.id}`]);
    assert.equal(sent.filter((s) => [admin, hr, m2].some((u) => s.to === String(u.telegram_user_id))).length, 0);
    await events.checkinPermissionRequested(view(p)); // دوباره: اعلان/پیام تکراری نه
    assert.equal(notifRows('checkin_permission_requested', `checkin_permission_requested:${p.id}`).length, 1);
    assert.equal(sent.filter((s) => s.to === String(m1.telegram_user_id)).length, 1);
  });

  test('کارمندِ بدون سرپرست ⇒ اعلان به ادمین‌ها؛ خطای تلگرام اعلان پنل را نمی‌شکند', async () => {
    const e = fresh(null);
    const p = ask(e);
    failTelegram = true;
    try { await events.checkinPermissionRequested(view(p)); } finally { failTelegram = false; }
    const rows = notifRows('checkin_permission_requested', `checkin_permission_requested:${p.id}`);
    assert.deepEqual(rows.map((r) => r.user_id), [admin.id], 'پنل ثبت شد');
    assert.notEqual(rows[0].telegram_status, 'sent');
  });

  // ---------- API ----------

  test('GET: اسکوپ نقش — سرپرست فقط تیم خودش، admin و hr همه؛ hr هرگز canDecide ندارد؛ کارمند ۴۰۳؛ بدون سشن ۴۰۱', async () => {
    const e1 = fresh(m1); const e2 = fresh(m2); const lone = fresh(null);
    const [p1, p2, p3] = [ask(e1), ask(e2), ask(lone)];
    const ids = (r) => r.json.items.map((i) => i.id);

    const a = await list('m1');
    assert.equal(a.status, 200);
    assert.ok(ids(a).includes(p1.id) && !ids(a).includes(p2.id) && !ids(a).includes(p3.id));
    assert.ok(a.json.items.every((i) => usersTeam(m1, i.userId)), 'همه‌ی ردیف‌ها زیرمجموعه‌ی m1');
    const mine = a.json.items.find((i) => i.id === p1.id);
    assert.deepEqual([mine.canDecide, mine.status, mine.reason, mine.user.id, mine.limit], [true, 'pending', 'ترافیک', e1.id, Number(settings.getAll().lateMonthlyLimit) || 0]);
    assert.equal(typeof mine.lateCount, 'number');

    const b = await list('m2');
    assert.ok(ids(b).includes(p2.id) && !ids(b).includes(p1.id));

    const c = await list('admin');
    assert.ok([p1, p2, p3].every((p) => ids(c).includes(p.id)));
    assert.ok(c.json.items.filter((i) => [p1, p2, p3].some((p) => p.id === i.id)).every((i) => i.canDecide === true));

    const h = await list('hr');
    assert.equal(h.status, 200);
    assert.ok([p1, p2, p3].every((p) => ids(h).includes(p.id)));
    assert.ok(h.json.items.every((i) => i.canDecide === false), 'hr فقط‌خواندنی');

    // کارمند: ورودی ممنوع (لیست سفید + بدون مجوز)
    const emp = F.sessionCookie(e1.id);
    const r = await fetch(`${base}/api/admin/checkin-permissions`, { headers: { cookie: emp } });
    assert.equal(r.status, 403);
    assert.equal((await fetch(`${base}/api/admin/checkin-permissions`)).status, 401);
  });
  const usersTeam = (mgr, userId) => require('../src/repositories/usersRepository').findById(userId).manager_id === mgr.id;

  test('GET: فیلتر وضعیت و اعتبارسنجی', async () => {
    const e = fresh(m1);
    const p = ask(e);
    assert.equal((await list('m1', '?status=bogus')).status, 400);
    assert.equal((await list('m1', '?status=bogus')).json.code, 'INVALID_STATUS');
    assert.ok((await list('m1', '?status=pending')).json.items.some((i) => i.id === p.id));
    assert.ok(!(await list('m1', '?status=approved')).json.items.some((i) => i.id === p.id));
    assert.equal((await decide('m1', p.id, { decision: 'approve' })).status, 200);
    assert.ok((await list('m1', '?status=approved')).json.items.some((i) => i.id === p.id));
    const all = (await list('m1', '?status=all')).json.items.find((i) => i.id === p.id);
    assert.deepEqual([all.status, all.canDecide], ['approved', false], 'تصمیم‌گرفته‌شده دیگر canDecide ندارد');
  });

  test('POST تأیید توسط سرپرست مستقیم: approved با expiresAt، audit، اعلان پنل + تلگرام به کارمند', async () => {
    const e = fresh(m1);
    const p = ask(e);
    const auditBefore = auditOf('checkin_permission_approved', m1.id).length;
    const r = await decide('m1', p.id, { decision: 'approve', note: 'برو' });
    assert.equal(r.status, 200);
    assert.deepEqual([r.json.permission.status, r.json.permission.decidedBy, r.json.permission.decisionNote], ['approved', m1.id, 'برو']);
    assert.ok(r.json.permission.expiresAt);
    const a = auditOf('checkin_permission_approved', m1.id);
    assert.equal(a.length, auditBefore + 1, 'دقیقاً یک audit برای این تصمیم');
    const last = JSON.stringify(a[a.length - 1]);
    assert.match(last, /checkin_permission/);
    assert.match(last, /admin_panel/);
    assert.match(last, /approved/);
    assert.match(last, /pending/, 'before = pending');
    const rows = notifRows('checkin_permission_approved', `checkin_permission_decided:${p.id}:approved`);
    assert.deepEqual(rows.map((x) => x.user_id), [e.id]);
    assert.match(rows[0].body, /می‌توانید ورود خود را ثبت کنید/);
    assert.match(rows[0].body, /پاسخ سرپرست: برو/);
    const tg = sent.filter((s) => s.to === String(e.telegram_user_id));
    assert.equal(tg.length, 1);
    assert.match(tg[0].text, /اجازه‌ی ورود شما تأیید شد/);
  });

  test('POST رد با یادداشت: rejected و اعلان رد به کارمند؛ admin هم می‌تواند (پاسخ ادمین)', async () => {
    const e = fresh(m1);
    const p = ask(e);
    const r = await decide('admin', p.id, { decision: 'reject', note: 'امروز نه' });
    assert.deepEqual([r.status, r.json.permission.status, r.json.permission.expiresAt], [200, 'rejected', null]);
    assert.equal(auditOf('checkin_permission_rejected', admin.id).length >= 1, true);
    const rows = notifRows('checkin_permission_rejected', `checkin_permission_decided:${p.id}:rejected`);
    assert.equal(rows.length, 1);
    assert.match(rows[0].body, /پاسخ ادمین: امروز نه/);
    assert.match(sent.find((s) => s.to === String(e.telegram_user_id)).text, /رد شد/);
  });

  test('POST: تصمیم دوباره ⇒ ۴۰۹ (حتی از ادمین) و چیزی عوض نمی‌شود؛ اعلان تکراری نه', async () => {
    const e = fresh(m1);
    const p = ask(e);
    assert.equal((await decide('m1', p.id, { decision: 'reject' })).status, 200);
    sent.length = 0;
    const again = await decide('admin', p.id, { decision: 'approve' });
    assert.deepEqual([again.status, again.json.code], [409, 'PERMISSION_NOT_PENDING']);
    assert.equal(repo.findById(p.id).status, 'rejected');
    assert.equal(sent.length, 0);
    assert.equal(notifRows('checkin_permission_approved', `checkin_permission_decided:${p.id}:approved`).length, 0);
  });

  test('POST: اسکوپ و نقش — سرپرستِ دیگر/hr/کارمند ۴۰۳، سرپرست روی کارمندِ بدون سرپرست ۴۰۳ و فقط ادمین؛ ناموجود ۴۰۴', async () => {
    const e = fresh(m1);
    const lone = fresh(null);
    const p = ask(e);
    const pl = ask(lone);
    assert.equal((await decide('m2', p.id, { decision: 'approve' })).status, 403);
    assert.equal((await decide('hr', p.id, { decision: 'approve' })).status, 403);
    const empRes = await fetch(`${base}/api/admin/checkin-permissions/${p.id}/decide`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'AttendancePanel', cookie: F.sessionCookie(e.id) }, body: JSON.stringify({ decision: 'approve' }) });
    assert.equal(empRes.status, 403);
    assert.equal(repo.findById(p.id).status, 'pending', 'هیچ‌کدام اثر نداشت');
    assert.equal((await decide('m1', pl.id, { decision: 'approve' })).status, 403);
    assert.equal((await decide('admin', pl.id, { decision: 'approve' })).status, 200);
    assert.equal((await decide('admin', 99999999, { decision: 'approve' })).status, 404);
  });

  test('POST: اعتبارسنجی ورودی', async () => {
    const e = fresh(m1);
    const p = ask(e);
    assert.deepEqual([(await decide('m1', p.id, {})).status, (await decide('m1', p.id, {})).json.code], [400, 'INVALID_DECISION']);
    assert.equal((await decide('m1', p.id, { decision: 'maybe' })).status, 400);
    assert.equal((await decide('m1', 'abc', { decision: 'approve' })).status, 400);
    assert.equal((await decide('m1', p.id, { decision: 'approve', note: 123 })).status, 400);
    const long = await decide('m1', p.id, { decision: 'approve', note: 'ا'.repeat(201) });
    assert.deepEqual([long.status, long.json.code], [400, 'NOTE_TOO_LONG']);
    assert.equal(repo.findById(p.id).status, 'pending');
    assert.equal((await decide('m1', p.id, { approve: false })).json.permission.status, 'rejected', 'شکل boolean هم پذیرفته است');
  });

  test('پرونده‌ی کارمند: فیلد lateLimit (سقف تعریف‌نشده ⇒ limit=۰؛ با سقف ⇒ «از ۳»)', async () => {
    const e = fresh(m1);
    const off = await hit('m1', 'GET', `/api/admin/users/${e.id}/details`);
    assert.equal(off.status, 200);
    assert.equal(off.json.lateLimit.limit, 0);
    settings.setValue('lateMonthlyLimit', 3);
    try {
      const on = await hit('m1', 'GET', `/api/admin/users/${e.id}/details`);
      assert.deepEqual([on.json.lateLimit.limit, typeof on.json.lateLimit.lateCount, on.json.lateLimit.overLimit], [3, 'number', false]);
    } finally { settings.resetValue('lateMonthlyLimit'); }
  });

  // ---------- بات ----------

  test('بات: cp_ok سرپرستِ مستقیم ⇒ تأیید، حذف دکمه‌ها، پیام تأیید و اعلان به کارمند؛ فشردن دوباره ⇒ هشدار', async () => {
    const e = fresh(m1);
    const p = ask(e);
    const bot = bots();
    await handleCheckinPermissionCallback(bot, query(m1, `cp_ok:${p.id}`));
    assert.equal(repo.findById(p.id).status, 'approved');
    assert.equal(bot.calls.edit.length, 1);
    assert.match(bot.calls.send[0].text, /✅.*تأیید شد/);
    assert.match(sent.find((s) => s.to === String(e.telegram_user_id)).text, /اجازه‌ی ورود شما تأیید شد/);
    assert.match(JSON.stringify(auditOf('checkin_permission_approved', m1.id).pop()), /telegram_bot/);

    const bot2 = bots();
    await handleCheckinPermissionCallback(bot2, query(m1, `cp_no:${p.id}`));
    assert.equal(repo.findById(p.id).status, 'approved', 'تصمیم اول ثابت می‌ماند');
    assert.equal(bot2.calls.answer[0].show_alert, true);
    assert.equal(bot2.calls.edit.length, 1, 'دکمه‌های پیام قدیمی حذف می‌شوند');
    assert.equal(bot2.calls.send.length, 0);
  });

  test('بات: cp_no ⇒ رد؛ سرپرست دیگر/hr/ثبت‌نشده/داده‌ی نامعتبر ⇒ هشدار و بدون اثر', async () => {
    const e = fresh(m1);
    const p = ask(e);
    const bad = bots();
    await handleCheckinPermissionCallback(bad, query(m2, `cp_ok:${p.id}`));
    assert.equal(repo.findById(p.id).status, 'pending');
    assert.equal(bad.calls.answer[0].show_alert, true);
    const h = bots();
    await handleCheckinPermissionCallback(h, query(hr, `cp_ok:${p.id}`));
    assert.match(h.calls.answer[0].text, /اجازه/);
    assert.equal(repo.findById(p.id).status, 'pending');
    const stranger = bots();
    await handleCheckinPermissionCallback(stranger, { id: 'q', data: `cp_ok:${p.id}`, from: { id: 1 }, message: { chat: { id: 1 }, message_id: 1 } });
    assert.equal(repo.findById(p.id).status, 'pending');
    const junk = bots();
    await handleCheckinPermissionCallback(junk, query(m1, 'cp_ok:abc'));
    assert.match(junk.calls.answer[0].text, /نامعتبر/);

    const ok = bots();
    await handleCheckinPermissionCallback(ok, query(m1, `cp_no:${p.id}`));
    assert.equal(repo.findById(p.id).status, 'rejected');
    assert.match(ok.calls.send[0].text, /❌/);
  });
});

// ---------- مسیر درخواست در Mini App (زمان ثابت با mock.timers؛ بدون HTTP) ----------
const canMock = typeof mock.timers?.enable === 'function';
let router = null;
try { require('express'); router = require('../src/api/routes/miniapp'); } catch (_) { /* express نصب نیست */ }

describe('درخواست از Mini App ⇒ اعلان به سرپرست؛ خلاصه‌ی تأخیر ماه (D3)', { skip: !router ? 'express نصب نیست' : (canMock ? false : 'mock.timers نیست') }, () => {
  const TZ = 'Asia/Tehran';
  const TODAY = '2026-12-12'; // شنبه (آذر ۱۴۰۵)
  const WORK = ['2026-12-01', '2026-12-02', '2026-12-05', '2026-12-06', '2026-12-07'];
  const at = (date, hhmm) => zonedTimeToUtc(date, hhmm, TZ);
  let mgr; let emp;
  const lates = (u, count) => WORK.slice(0, count).forEach((d) => attendanceRepo.createManual({ userId: u.id, recordDate: d, checkInTime: at(d, '08:20').toISOString(), checkOutTime: at(d, '16:30').toISOString(), status: 'normal' }));
  function post(path, user, body) {
    const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods.post);
    const out = { status: 200, body: undefined };
    const res = { status(c) { out.status = c; return this; }, json(b) { out.body = b; return this; } };
    layer.route.stack[layer.route.stack.length - 1].handle({ miniAppUser: user, body, query: {}, headers: {}, ip: '10.0.0.1', get: () => undefined }, res, () => {});
    return out;
  }

  before(() => { mgr = F.makeUser({ role: 'manager' }); });
  after(() => { mock.timers.reset(); settings.resetValue('lateMonthlyLimit'); settings.resetValue('lateLimitGateMode'); });
  beforeEach(() => {
    emp = F.makeUser({ managerId: mgr.id });
    settings.setValue('lateMonthlyLimit', 3);
    settings.setValue('lateLimitGateMode', 'enforce');
    mock.timers.reset();
    mock.timers.enable({ apis: ['Date'], now: at(TODAY, '09:00').getTime() });
    sent.length = 0;
  });

  test('POST /miniapp/checkin-permission ⇒ اعلان پنل + تلگرام (با «۳ از ۳» و دکمه‌ها) به سرپرست مستقیم', async () => {
    lates(emp, 3);
    const r = post('/miniapp/checkin-permission', emp, { reason: 'ترافیک' });
    assert.equal(r.status, 201);
    await tick();
    const id = r.body.permission.id;
    const rows = notifRows('checkin_permission_requested', `checkin_permission_requested:${id}`);
    assert.deepEqual(rows.map((x) => x.user_id), [mgr.id]);
    assert.match(rows[0].body, /تأخیر این ماه: 3 از 3/);
    const tg = sent.filter((s) => s.to === String(mgr.telegram_user_id));
    assert.equal(tg.length, 1);
    assert.deepEqual(tg[0].options.reply_markup.inline_keyboard[0].map((b) => b.callback_data), [`cp_ok:${id}`, `cp_no:${id}`]);
  });

  test('درخواستِ ردشده (نه لازم / تکراری) اعلان نمی‌سازد', async () => {
    lates(emp, 2); // زیر سقف ⇒ PERMISSION_NOT_REQUIRED
    const count = () => db.prepare("SELECT COUNT(*) c FROM notifications WHERE type = 'checkin_permission_requested' AND user_id = ?").get(mgr.id).c;
    const before = count();
    const r = post('/miniapp/checkin-permission', emp, { reason: 'x' });
    assert.equal(r.status, 409);
    await tick();
    assert.equal(sent.length, 0);
    assert.equal(count(), before);
  });

  test('monthSummary: «۲ از ۳» فقط‌خواندنی؛ سقف تعریف‌نشده ⇒ limit=۰', () => {
    lates(emp, 2);
    const s = lateLimit.monthSummary(emp.id, at(TODAY, '09:00'));
    assert.deepEqual([s.limit, s.lateCount, s.overLimit, s.enabled], [3, 2, false, true]);
    const e3 = F.makeUser({ managerId: mgr.id });
    lates(e3, 3);
    assert.equal(lateLimit.monthSummary(e3.id, at(TODAY, '09:00')).overLimit, true);
    settings.setValue('lateLimitGateMode', 'off');
    assert.deepEqual([lateLimit.monthSummary(emp.id, at(TODAY, '09:00')).enabled, lateLimit.monthSummary(emp.id, at(TODAY, '09:00')).lateCount], [false, 2], 'خاموش: شمارش برای نمایش می‌ماند ولی enabled=false');
    settings.setValue('lateMonthlyLimit', 0);
    const z = lateLimit.monthSummary(emp.id, at(TODAY, '09:00'));
    assert.deepEqual([z.limit, z.lateCount, z.enabled], [0, 0, false]);
  });
});

// S4-13a: API صف تأیید مرخصی — فیلترها، مانده‌ی کارمند، لینک پیوست، تأیید/رد دسته‌جمعی، اسکوپ و دسترسی.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

describe('API صف تأیید مرخصی (S4-13a)', () => {
  let server; let base; let cookies; let U; let db; let annual; let mission; let leaveRepo; let approvals; let settingsRepo;
  const telegramSent = []; // پیام‌های تلگرامی که notifier می‌فرستاد (شبکه‌ی واقعی در تست نیست)

  before(async () => {
    db = resetDb();
    // transport تلگرام را قبل از require سایر ماژول‌ها جایگزین می‌کنیم تا تست به شبکه وابسته نباشد
    const notifier = require('../src/bot/notifier');
    notifier.notifyUser = async (to, text) => { telegramSent.push({ to: String(to), text }); };
    notifier.sendMessage = async (to, text) => { telegramSent.push({ to: String(to), text }); return true; };
    const F = require('./helpers/factories');
    const typesRepo = require('../src/repositories/leaveTypesRepository');
    settingsRepo = require('../src/repositories/settingsRepository');
    approvals = require('../src/services/leaveApprovalService');
    leaveRepo = require('../src/repositories/leaveRepository');
    const balances = require('../src/services/leaveBalanceService');
    const { createApp } = require('../src/server');
    const m1 = F.makeUser({ role: 'manager', name: 'سرپرست ۱' });
    const m2 = F.makeUser({ role: 'manager', name: 'سرپرست ۲' });
    U = {
      admin: F.makeUser({ role: 'admin' }), hr: F.makeUser({ role: 'hr' }), m1, m2,
      e1: F.makeUser({ managerId: m1.id, name: 'کارمند ۱' }), e1b: F.makeUser({ managerId: m1.id, name: 'کارمند ۱ب' }),
      e2: F.makeUser({ managerId: m2.id, name: 'کارمند ۲' }), loner: F.makeUser({ name: 'بدون سرپرست' }),
    };
    annual = typesRepo.findByCode('annual');
    mission = typesRepo.findByCode('mission');
    cookies = Object.fromEntries(Object.entries(U).map(([k, u]) => [k, F.sessionCookie(u.id)]));
    // استحقاق ۱۰ روز (۴۸۰ دقیقه‌ای نیست؛ dayMinutes از تنظیمات کار می‌آید) برای e1 در سال ۱۴۰۶
    const r = balances.setEntitlement({ userId: U.e1.id, leaveTypeId: annual.id, jalaliYear: 1406, entitledMinutes: 4800, actor: U.admin.id, reason: 'تست' });
    assert.equal(r.ok, true, JSON.stringify(r));
    server = createApp().listen(0);
    await new Promise((res) => server.once('listening', res));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => { if (server) server.close(); cleanup(); });

  async function hit(role, method, url, { body, csrf = true } = {}) {
    const headers = { 'content-type': 'application/json' };
    if (cookies[role]) headers.cookie = cookies[role];
    if (csrf) headers['x-requested-with'] = 'AttendancePanel';
    const res = await fetch(base + url, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(body || {}) });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  }
  const queue = (role, qs = '') => hit(role, 'GET', `/api/admin/leave-queue${qs}`);
  const bulk = (role, body) => hit(role, 'POST', '/api/admin/leave-queue/bulk', { body });
  const idsOf = (r) => r.json.items.map((i) => i.id).sort((a, b) => a - b);

  // درخواست مستقیم از repository (بدون اعتبارسنجی‌های زمانی) + زنجیره؛ هر درخواست بازه‌ی جدا
  let n = 0;
  function make(user, { type = annual, days = 1, start, duration, attachment, reason = 'تست', status } = {}) {
    n += 1;
    const s = start || new Date(Date.UTC(2027, 7, 7 + n * 7)).toISOString().slice(0, 10); // 2027-08 ⇒ سال شمسی ۱۴۰۶
    const e = new Date(new Date(`${s}T00:00:00Z`).getTime() + (days - 1) * 86400000).toISOString().slice(0, 10);
    const r = leaveRepo.createLeaveRequest({ userId: user.id, leaveTypeId: type.id, startDate: s, endDate: e, reason, durationMinutes: duration === undefined ? 480 * days : duration, attachment });
    if (status && status !== 'pending') leaveRepo.setStatus(r.id, status, U.admin.id);
    else approvals.initChain(r.id);
    return leaveRepo.findById(r.id);
  }
  const reset = () => { for (const k of ['leaveApprovalExtraStepDays', 'leaveApprovalExtraStepTypes', 'leaveApprovalExtraStepRole']) settingsRepo.resetValue(k); };

  test('دسترسی: بدون نشست ۴۰۱؛ کارمند ۴۰۳ (GET و POST)؛ بدون هدر CSRF در POST ۴۰۳؛ سرپرست/hr/admin مجاز', async () => {
    reset();
    assert.equal((await hit('nobody', 'GET', '/api/admin/leave-queue')).status, 401);
    for (const role of ['e1', 'loner']) {
      assert.equal((await queue(role)).status, 403, role);
      assert.equal((await bulk(role, { action: 'approve', ids: [1] })).status, 403, role);
    }
    assert.equal((await hit('admin', 'POST', '/api/admin/leave-queue/bulk', { csrf: false, body: { action: 'approve', ids: [1] } })).status, 403);
    for (const role of ['m1', 'hr', 'admin']) assert.equal((await queue(role)).status, 200, role);
  });

  test('اسکوپ: سرپرست فقط تیم مستقیم خودش؛ admin و hr همه؛ team= برای سرپرستِ دیگر ۴۰۳', async () => {
    reset();
    const a = make(U.e1); const b = make(U.e1b); const c = make(U.e2); const d = make(U.loner);
    assert.deepEqual(idsOf(await queue('m1')), [a.id, b.id].sort((x, y) => x - y));
    assert.deepEqual(idsOf(await queue('m2')), [c.id]);
    const all = [a.id, b.id, c.id, d.id].sort((x, y) => x - y);
    assert.deepEqual(idsOf(await queue('admin', '?limit=100')).filter((i) => all.includes(i)), all);
    assert.deepEqual(idsOf(await queue('hr', '?limit=100')).filter((i) => all.includes(i)), all);

    assert.deepEqual(idsOf(await queue('m1', '?team=mine')), [a.id, b.id].sort((x, y) => x - y));
    assert.deepEqual(idsOf(await queue('m1', `?team=${U.m1.id}`)), [a.id, b.id].sort((x, y) => x - y));
    assert.equal((await queue('m1', `?team=${U.m2.id}`)).status, 403);
    assert.deepEqual(idsOf(await queue('admin', `?team=${U.m2.id}`)), [c.id]);
    assert.deepEqual(idsOf(await queue('hr', `?team=${U.m2.id}`)), [c.id]);
    assert.deepEqual(idsOf(await queue('admin', '?team=mine')), [], 'ادمین تیم ندارد');
    for (const id of all) { const r = leaveRepo.findById(id); leaveRepo.setStatus(r.id, 'rejected', U.admin.id); } // پاک‌سازی صف برای تست‌های بعد
  });

  test('فیلترها: وضعیت (پیش‌فرض pending)، kind، نوع، بازه‌ی تاریخ (هم‌پوشانی)، ترکیب؛ ترتیب FIFO برای pending', async () => {
    reset();
    const p1 = make(U.e1, { start: '2027-03-01', days: 3 });                       // ۰۳-۰۱..۰۳-۰۳
    const p2 = make(U.e1b, { type: mission, start: '2027-03-10', duration: null }); // مأموریت
    const ap = make(U.e1, { start: '2027-03-20', status: 'approved' });
    const rj = make(U.e1b, { start: '2027-04-01', status: 'rejected' });
    const pend = (r) => idsOf(r);
    const mine = (r) => r.json.items.filter((i) => [p1.id, p2.id, ap.id, rj.id].includes(i.id)).map((i) => i.id).sort((a, b) => a - b);

    assert.deepEqual(mine(await queue('m1', '?limit=100')), [p1.id, p2.id], 'پیش‌فرض: pending');
    assert.deepEqual(pend(await queue('m1', '?status=approved')).filter((i) => i === ap.id), [ap.id]);
    assert.deepEqual(mine(await queue('m1', '?status=rejected&limit=100')), [rj.id]);
    assert.deepEqual(mine(await queue('m1', '?status=all&limit=100')), [p1.id, p2.id, ap.id, rj.id].sort((a, b) => a - b));
    assert.deepEqual(mine(await queue('m1', '?kind=mission&limit=100')), [p2.id]);
    assert.deepEqual(mine(await queue('m1', '?kind=leave&limit=100')), [p1.id]);
    assert.deepEqual(mine(await queue('m1', `?leaveTypeId=${mission.id}&limit=100`)), [p2.id]);
    assert.deepEqual(mine(await queue('m1', '?from=2027-03-03&to=2027-03-05&limit=100')), [p1.id], 'روز آخرِ p1 با بازه هم‌پوشان است');
    assert.deepEqual(mine(await queue('m1', '?from=2027-03-04&to=2027-03-09&limit=100')), [], 'بین p1 و p2');
    assert.deepEqual(mine(await queue('m1', '?from=2027-03-10&limit=100')), [p2.id]);
    assert.deepEqual(mine(await queue('m1', '?to=2027-03-02&limit=100')), [p1.id]);
    assert.deepEqual(mine(await queue('m1', `?status=all&kind=leave&team=mine&from=2027-03-15&limit=100`)), [ap.id, rj.id].sort((a, b) => a - b));
    // FIFO: قدیمی‌تر اول (created_at برابر ⇒ id)
    const order = (await queue('m1', '?limit=100')).json.items.map((i) => i.id).filter((i) => [p1.id, p2.id].includes(i));
    assert.deepEqual(order, [p1.id, p2.id]);
    for (const r of [p1, p2]) leaveRepo.setStatus(r.id, 'rejected', U.admin.id);
  });

  test('ورودی نامعتبر ⇒ ۴۰۰ با code', async () => {
    const bad = {
      '?status=weird': 'INVALID_STATUS', '?kind=sick': 'INVALID_KIND', '?leaveTypeId=abc': 'INVALID_TYPE', '?from=1405/01/01': 'INVALID_DATE',
      '?to=2027-13-45x': 'INVALID_DATE', '?from=2027-05-02&to=2027-05-01': 'INVALID_DATE', '?team=x': 'INVALID_TEAM', '?decidable=maybe': 'INVALID_DECIDABLE',
      '?limit=0': 'INVALID_PAGING', '?limit=101': 'INVALID_PAGING', '?limit=-1': 'INVALID_PAGING', '?offset=abc': 'INVALID_PAGING',
    };
    for (const [qs, code] of Object.entries(bad)) {
      const r = await queue('admin', qs);
      assert.deepEqual([qs, r.status, r.json.code], [qs, 400, code]);
    }
  });

  test('صفحه‌بندی: total مستقل از limit/offset؛ صفحه‌ها هم‌پوشانی ندارند', async () => {
    reset();
    const made = [make(U.e1b), make(U.e1b), make(U.e1b), make(U.e1b), make(U.e1b)].map((r) => r.id);
    const p1 = await queue('m1', '?limit=2&offset=0');
    const p2 = await queue('m1', '?limit=2&offset=2');
    const p3 = await queue('m1', '?limit=2&offset=4');
    for (const p of [p1, p2, p3]) assert.equal(p.json.total >= 5, true);
    assert.deepEqual([p1.json.items.length, p2.json.items.length], [2, 2]);
    const seen = [...p1.json.items, ...p2.json.items, ...p3.json.items].map((i) => i.id);
    assert.equal(new Set(seen).size, seen.length);
    assert.deepEqual([p1.json.limit, p1.json.offset, p2.json.offset], [2, 0, 2]);
    const full = (await queue('m1', '?limit=100')).json.items.map((i) => i.id);
    assert.deepEqual(made.filter((id) => full.includes(id)), made);
    for (const id of made) leaveRepo.setStatus(id, 'rejected', U.admin.id);
  });

  test('هر آیتم: کارمند، نوع، زنجیره/نقش منتظر، canDecide، پیوست و مانده (قبل/بعد از تأیید، کسری)', async () => {
    reset();
    const att = { id: 'a'.repeat(32), mime: 'application/pdf', size: 1234, name: 'x.pdf' };
    const ok = make(U.e1, { days: 2, attachment: att });            // ۹۶۰ دقیقه از ۴۸۰۰
    const big = make(U.e1, { days: 12 });                           // ۵۷۶۰ > مانده ⇒ کسری
    const none = make(U.e1, { duration: null });                    // مدت نامشخص
    const ms = make(U.e1, { type: mission });                       // نوع بدون کسر
    const items = Object.fromEntries((await queue('m1', '?limit=100')).json.items.map((i) => [i.id, i]));

    const a = items[ok.id];
    assert.deepEqual([a.employee.id, a.employee.fullName, a.employee.managerId, a.kind, a.leaveType.code, a.status], [U.e1.id, 'کارمند ۱', U.m1.id, 'leave', 'annual', 'pending']);
    assert.deepEqual([a.awaitingRole, a.currentStep, a.canDecide, a.chain.length], ['manager', 1, true, 1]);
    assert.deepEqual(a.attachment, { url: `/api/admin/leave-requests/${ok.id}/attachment`, mime: 'application/pdf', name: 'x.pdf', size: 1234 });
    assert.equal(a.balance.tracked, true);
    assert.deepEqual([a.balance.jalaliYear, a.balance.entitled, a.balance.used, a.balance.remaining, a.balance.remainingAfterApproval, a.balance.insufficient], [1406, 4800, 0, 4800, 3840, false]);
    assert.equal(typeof a.balance.display.remaining.text, 'string');
    assert.equal(a.balance.display.remainingAfterApproval.negative, false);

    assert.deepEqual([items[big.id].balance.remainingAfterApproval, items[big.id].balance.insufficient, items[big.id].balance.display.remainingAfterApproval.negative], [-960, true, true]);
    assert.deepEqual([items[none.id].balance.remainingAfterApproval, items[none.id].balance.insufficient, items[none.id].balance.display.remainingAfterApproval], [null, null, null]);
    assert.deepEqual(items[ms.id].balance, { tracked: false });
    assert.equal(items[ms.id].attachment, null);

    // admin/hr: همان فهرست؛ hr فقط‌خواندنی ⇒ canDecide=false روی مرحله‌ی manager
    assert.equal((await queue('admin', '?limit=100')).json.items.find((i) => i.id === ok.id).canDecide, true);
    assert.equal((await queue('hr', '?limit=100')).json.items.find((i) => i.id === ok.id).canDecide, false);
    // سرپرستِ دیگر اصلاً آن را نمی‌بیند
    assert.equal((await queue('m2', '?limit=100')).json.items.some((i) => i.id === ok.id), false);
    for (const r of [ok, big, none, ms]) leaveRepo.setStatus(r.id, 'rejected', U.admin.id);
  });

  test('مانده بعد از تأیید: درخواست تأییدشده در used می‌آید و remainingAfterApproval = remaining', async () => {
    reset();
    const done = make(U.e1, { days: 1, status: 'approved' }); // ۴۸۰ دقیقه مصرف
    const item = (await queue('admin', '?status=approved&limit=100')).json.items.find((i) => i.id === done.id);
    assert.equal(item.balance.used >= 480, true);
    assert.equal(item.balance.remainingAfterApproval, item.balance.remaining);
    assert.equal(item.canDecide, false);
    assert.equal(item.awaitingRole, null);
  });

  test('decidable=1: فقط pendingهایی که همین کاربر همین الان می‌تواند تصمیم بگیرد (با total درست)', async () => {
    reset();
    settingsRepo.setValue('leaveApprovalExtraStepDays', 2);
    settingsRepo.setValue('leaveApprovalExtraStepRole', 'hr');
    const longReq = make(U.e1b, { days: 3 });          // مرحله ۱ manager، مرحله ۲ hr
    const shortReq = make(U.e1b, { days: 1 });
    const solo = make(U.loner);                         // مرحله‌ی admin
    const dec = async (role) => idsOf(await queue(role, '?decidable=1&limit=100')).filter((i) => [longReq.id, shortReq.id, solo.id].includes(i));
    assert.deepEqual(await dec('m1'), [longReq.id, shortReq.id].sort((a, b) => a - b));
    assert.deepEqual(await dec('hr'), [], 'مرحله‌ی فعال هنوز manager است');
    assert.deepEqual(await dec('admin'), [longReq.id, shortReq.id, solo.id].sort((a, b) => a - b));
    const r = await queue('m1', '?decidable=1&limit=1');
    assert.deepEqual([r.json.items.length, r.json.total >= 2], [1, true]);
    // مرحله‌ی ۱ تأیید ⇒ نوبت hr
    const step = await bulk('m1', { action: 'approve', ids: [longReq.id] });
    assert.deepEqual([step.json.results[0].ok, step.json.results[0].completed, step.json.results[0].nextRole], [true, false, 'hr']);
    assert.deepEqual(await dec('hr'), [longReq.id]);
    assert.deepEqual((await dec('m1')).includes(longReq.id), false);
    reset();
    for (const id of [longReq.id, shortReq.id, solo.id]) leaveRepo.setStatus(id, 'rejected', U.admin.id);
  });

  test('تصمیم دسته‌جمعی — تأیید: همه‌ی درخواست‌ها approved، audit با bulk، اعلان کارمند، پاسخ خلاصه', async () => {
    reset();
    const a = make(U.e1); const b = make(U.e1b); const m = make(U.e1, { type: mission });
    const before = db.prepare("SELECT COUNT(*) n FROM notifications WHERE type = 'leave_approved'").get().n;
    const r = await bulk('m1', { action: 'approve', ids: [a.id, b.id, m.id], note: 'موافقم' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.summary, { requested: 3, succeeded: 3, failed: 0 });
    assert.deepEqual(r.json.results.map((x) => [x.id, x.ok, x.status, x.completed]), [[a.id, true, 'approved', true], [b.id, true, 'approved', true], [m.id, true, 'approved', true]]);
    for (const x of [a, b, m]) {
      const row = leaveRepo.findById(x.id);
      assert.deepEqual([row.status, row.approver_id, row.current_step], ['approved', U.m1.id, null]);
    }
    assert.equal(db.prepare("SELECT COUNT(*) n FROM notifications WHERE type = 'leave_approved'").get().n - before, 3, 'اعلان پنل برای هر کارمند');
    const tg = telegramSent.filter((m) => m.to === String(U.e1.telegram_user_id) && m.text.includes('تأیید شد') && m.text.includes('موافقم'));
    assert.equal(tg.length >= 2, true, 'پیام تلگرام کارمند (مثل route تکی) با یادداشت');
    const audits = db.prepare("SELECT details FROM audit_log WHERE action = 'leave_request_approved' ORDER BY id DESC LIMIT 3").all().map((x) => JSON.parse(x.details));
    assert.equal(audits.length, 3);
    for (const d of audits) assert.equal(JSON.stringify(d).includes('"bulk":true'), true);
    const sum = JSON.parse(db.prepare("SELECT details FROM audit_log WHERE action = 'leave_queue_bulk_decision' ORDER BY id DESC LIMIT 1").get().details);
    assert.deepEqual([sum.decision, sum.requested, sum.succeeded, sum.failed, sum.ids.length], ['approve', 3, 3, 0, 3]);
    // مانده بعد از تأیید کم شد
    const bal = (await queue('m1', '?status=approved&limit=100')).json.items.find((i) => i.id === a.id).balance;
    assert.equal(bal.used >= 480, true);
  });

  test('تصمیم دسته‌جمعی — رد: دلیل اجباری (۴۰۰ و هیچ تغییری)، سپس رد با دلیل ثبت می‌شود', async () => {
    reset();
    const a = make(U.e1); const b = make(U.e1b);
    for (const note of [undefined, '', '   ']) {
      const r = await bulk('m1', { action: 'reject', ids: [a.id, b.id], ...(note === undefined ? {} : { note }) });
      assert.deepEqual([r.status, r.json.code], [400, 'REASON_REQUIRED']);
    }
    assert.deepEqual([leaveRepo.findById(a.id).status, leaveRepo.findById(b.id).status], ['pending', 'pending']);
    const ok = await bulk('m1', { action: 'reject', ids: [a.id, b.id], note: 'ظرفیت تیم' });
    assert.deepEqual(ok.json.summary, { requested: 2, succeeded: 2, failed: 0 });
    assert.deepEqual([leaveRepo.findById(a.id).status, leaveRepo.findById(b.id).status], ['rejected', 'rejected']);
    const d = JSON.parse(db.prepare("SELECT details FROM audit_log WHERE action = 'leave_request_rejected' ORDER BY id DESC LIMIT 1").get().details);
    assert.equal(JSON.stringify(d).includes('ظرفیت تیم'), true, 'دلیل در audit');
    assert.equal(db.prepare("SELECT COUNT(*) n FROM notifications WHERE type = 'leave_rejected' AND body LIKE '%ظرفیت تیم%'").get().n >= 2, true);
  });

  test('تصمیم دسته‌جمعی بخشی‌موفق: خارج از تیم ⇒ FORBIDDEN، ناموجود ⇒ NOT_FOUND، تمام‌شده ⇒ ALREADY_DECIDED؛ بقیه انجام می‌شوند', async () => {
    reset();
    const good1 = make(U.e1); const good2 = make(U.e1b); const foreign = make(U.e2); const done = make(U.e1, { status: 'approved' });
    const r = await bulk('m1', { action: 'approve', ids: [good1.id, foreign.id, 999999, done.id, good2.id, good1.id] }); // تکراری حذف می‌شود
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.summary, { requested: 5, succeeded: 2, failed: 3 });
    const by = Object.fromEntries(r.json.results.map((x) => [x.id, x]));
    assert.deepEqual([by[good1.id].ok, by[good2.id].ok], [true, true]);
    assert.deepEqual([by[foreign.id].ok, by[foreign.id].code], [false, 'FORBIDDEN']);
    assert.deepEqual([by[999999].ok, by[999999].code], [false, 'NOT_FOUND']);
    assert.deepEqual([by[done.id].ok, by[done.id].code], [false, 'ALREADY_DECIDED']);
    assert.equal(typeof by[foreign.id].error, 'string');
    assert.equal(leaveRepo.findById(foreign.id).status, 'pending', 'درخواست خارج از تیم دست‌نخورده');
    assert.deepEqual([leaveRepo.findById(good1.id).status, leaveRepo.findById(good2.id).status], ['approved', 'approved']);
    // ادمین هر دو را می‌تواند
    assert.equal((await bulk('admin', { action: 'approve', ids: [foreign.id] })).json.summary.succeeded, 1);
  });

  test('تصمیم دسته‌جمعی با زنجیره: مرحله‌ی میانی completed=false و بدون اعلان به کارمند؛ hr روی مرحله‌ی manager ⇒ FORBIDDEN (route مجاز است)', async () => {
    reset();
    settingsRepo.setValue('leaveApprovalExtraStepDays', 2);
    settingsRepo.setValue('leaveApprovalExtraStepRole', 'admin');
    const req = make(U.e1b, { days: 3 });
    const notif = () => db.prepare("SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND type IN ('leave_approved','leave_rejected')").get(U.e1b.id).n;
    const n0 = notif();
    const hrTry = await bulk('hr', { action: 'approve', ids: [req.id] });
    assert.deepEqual([hrTry.status, hrTry.json.results[0].ok, hrTry.json.results[0].code], [200, false, 'FORBIDDEN']);
    const s1 = await bulk('m1', { action: 'approve', ids: [req.id] });
    assert.deepEqual([s1.json.results[0].ok, s1.json.results[0].status, s1.json.results[0].completed, s1.json.results[0].nextRole], [true, 'pending', false, 'admin']);
    assert.equal(notif(), n0, 'تأیید مرحله‌ی میانی اعلان نهایی نمی‌سازد');
    assert.equal((await bulk('m1', { action: 'approve', ids: [req.id] })).json.results[0].code, 'FORBIDDEN', 'مرحله‌ی ۲ فقط admin');
    const s2 = await bulk('admin', { action: 'approve', ids: [req.id] });
    assert.deepEqual([s2.json.results[0].status, s2.json.results[0].completed], ['approved', true]);
    assert.equal(notif(), n0 + 1);
    reset();
  });

  test('تصمیم دسته‌جمعی: ورودی نامعتبر ⇒ ۴۰۰ و هیچ تغییری', async () => {
    reset();
    const a = make(U.e1);
    const cases = [
      [{ ids: [a.id] }, 'INVALID_ACTION'], [{ action: 'delete', ids: [a.id] }, 'INVALID_ACTION'],
      [{ action: 'approve' }, 'INVALID_IDS'], [{ action: 'approve', ids: [] }, 'INVALID_IDS'], [{ action: 'approve', ids: 'x' }, 'INVALID_IDS'],
      [{ action: 'approve', ids: [a.id, 'abc'] }, 'INVALID_IDS'], [{ action: 'approve', ids: [a.id, -1] }, 'INVALID_IDS'], [{ action: 'approve', ids: [a.id, 1.5] }, 'INVALID_IDS'],
      [{ action: 'approve', ids: [a.id], note: { x: 1 } }, 'INVALID_NOTE'],
      [{ action: 'approve', ids: Array.from({ length: 51 }, (_, i) => i + 1) }, 'TOO_MANY'],
    ];
    for (const [body, code] of cases) {
      const r = await bulk('admin', body);
      assert.deepEqual([r.status, r.json.code], [400, code], JSON.stringify(body).slice(0, 60));
    }
    assert.equal(leaveRepo.findById(a.id).status, 'pending');
    assert.equal((await bulk('admin', { action: 'approve', ids: Array.from({ length: 50 }, (_, i) => 900000 + i) })).status, 200, '۵۰ تا مجاز است');
    leaveRepo.setStatus(a.id, 'rejected', U.admin.id);
  });

  test('route تکی تأیید/رد همچنان کار می‌کند (مشترک‌سازی با leaveDecision) و یادداشت را تا ۵۰۰ نویسه می‌برد', async () => {
    reset();
    const a = make(U.e1); const b = make(U.e1b);
    const ok = await hit('m1', 'POST', `/api/admin/leave-requests/${a.id}/approve`, { body: { note: 'x'.repeat(600) } });
    assert.deepEqual([ok.status, ok.json.status, ok.json.completed], [200, 'approved', true]);
    const d = db.prepare("SELECT details FROM audit_log WHERE action = 'leave_request_approved' ORDER BY id DESC LIMIT 1").get().details;
    assert.equal(JSON.stringify(JSON.parse(d)).includes('x'.repeat(501)), false);
    assert.equal(JSON.stringify(JSON.parse(d)).includes('"bulk"'), false, 'route تکی علامت bulk ندارد');
    const rj = await hit('m1', 'POST', `/api/admin/leave-requests/${b.id}/reject`, { body: { note: 'نه' } });
    assert.deepEqual([rj.status, rj.json.status], [200, 'rejected']);
    assert.deepEqual((await hit('m1', 'POST', `/api/admin/leave-requests/${b.id}/approve`)).json.code, 'ALREADY_DECIDED');
    assert.equal((await hit('m1', 'POST', '/api/admin/leave-requests/999999/approve')).status, 404);
  });
});

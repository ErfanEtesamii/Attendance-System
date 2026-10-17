// R6 (فاز ۱۴): خلاصه‌ی «منتظر بررسی»، آیتم منوی بات با نشانگر تعداد، handler بات و یادآوری هفتگی سرپرست. سطح سرویس/بات (بدون HTTP).
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

describe('دورکاری: شمارنده، منوی بات و یادآوری هفتگی (R6)', () => {
  let db; let repo; let svc; let F; let menu; let U; let mk;
  const now = new Date('2026-10-16T10:00:00Z');

  before(() => {
    db = resetDb();
    F = require('./helpers/factories');
    repo = require('../src/repositories/remoteWorkRepository');
    svc = require('../src/services/remoteWorkAdminService');
    menu = require('../src/bot/menu/menuRouter');
    const m1 = F.makeUser({ role: 'manager', name: 'سرپرست ۱' });
    const m2 = F.makeUser({ role: 'manager', name: 'سرپرست ۲' });
    U = {
      admin: F.makeUser({ role: 'admin' }), hr: F.makeUser({ role: 'hr' }), m1, m2,
      a: F.makeUser({ managerId: m1.id, name: 'الف' }), b: F.makeUser({ managerId: m1.id, name: 'ب' }), c: F.makeUser({ managerId: m2.id, name: 'ج' }),
      orphan: F.makeUser({ managerId: null, name: 'بدون سرپرست' }), emp: F.makeUser({ managerId: m2.id, name: 'کارمند عادی' }),
    };
    mk = (u, d, e = '09:00:00') => {
      const x = repo.insertSession({ userId: u.id, workDate: d, startAt: `${d}T05:00:00.000Z`, ip: '203.0.113.9' });
      if (e) repo.closeSession(x.id, `${d}T${e}.000Z`);
      return x.id;
    };
    mk(U.a, '2026-10-10'); mk(U.a, '2026-10-11'); mk(U.b, '2026-10-12'); mk(U.c, '2026-10-12');
    mk(U.orphan, '2026-10-09');
    mk(U.m1, '2026-10-13'); // دورکاریِ خودِ سرپرست ۱ (ادمین باید تأییدش کند)
    mk(U.emp, '2026-10-14', null); // نشست باز: هنوز قابل بررسی نیست و شمرده نمی‌شود
  });
  after(() => cleanup());

  test('pendingSummary: اسکوپ، بدون خود، بدون نشست باز؛ hr همه را می‌بیند؛ کارمند ممنوع', () => {
    const m1 = svc.pendingSummary(U.m1);
    assert.ok(m1.ok);
    assert.equal(m1.total, 3);
    assert.deepEqual(m1.employees.map((e) => [e.fullName, e.count, e.oldestWorkDate]), [['الف', 2, '2026-10-10'], ['ب', 1, '2026-10-12']]);
    assert.equal(svc.pendingSummary(U.m2).total, 1);
    assert.equal(svc.pendingSummary(U.admin).total, 6); // همه به‌جز دورکاریِ خودِ ادمین (ندارد) و نشست باز
    assert.equal(svc.pendingSummary(U.hr).total, 7 - 1); // hr همه را می‌بیند (خود ندارد)
    assert.equal(svc.pendingSummary(U.emp).code, 'FORBIDDEN');
  });

  test('reminderTargets: هر سرپرست برای تیمش؛ ادمین فقط برای کارمندِ بدون سرپرست', () => {
    const t = svc.reminderTargets();
    const byRole = (id) => t.find((x) => x.user.id === id);
    assert.equal(byRole(U.m1.id).summary.total, 3);
    assert.equal(byRole(U.m2.id).summary.total, 1);
    const adm = byRole(U.admin.id);
    assert.ok(adm);
    assert.deepEqual(adm.summary.employees.map((e) => e.fullName).sort(), ['بدون سرپرست', 'سرپرست ۱'].sort()); // m1 خودش سرپرست ندارد ⇒ ادمین مسئول است
    assert.equal(byRole(U.hr.id), undefined);
  });

  test('منوی بات: آیتم برای سرپرست/ادمین با نشانگر تعداد؛ کارمند ندارد؛ بدون صف ⇒ بدون عدد', () => {
    const texts = (u) => menu.buildMenuInline(u).inline_keyboard.flat().map((b) => b.text);
    assert.ok(texts(U.m1).includes(`🏠 دورکاری‌های منتظر (${(3).toLocaleString('fa-IR')})`));
    assert.ok(texts(U.admin).some((x) => x.startsWith('🏠 دورکاری‌های منتظر (')));
    assert.ok(!texts(U.emp).some((x) => x.includes('دورکاری‌های منتظر')));
    const calm = F.makeUser({ role: 'manager' });
    assert.ok(texts(calm).includes('🏠 دورکاری‌های منتظر')); // صف خالی ⇒ متن ساده
    const item = menu.ITEMS.find((i) => i.id === 'pending_remote');
    assert.equal(item.handler, 'pendingRemote');
    assert.deepEqual(item.roles, ['manager', 'admin']);
    const kb = menu.buildMenuInline(U.m1).inline_keyboard.flat().find((b) => b.callback_data === 'mn:pending_remote');
    assert.equal(kb.style, 'success'); // گروه «تیم»
  });

  test('handler بات: خلاصه + دکمه‌ی پنل؛ صف خالی؛ نقش نامجاز', async () => {
    const { handlePendingRemote, buildSummaryText } = require('../src/bot/commands/pendingRemote');
    const sent = [];
    const bot = { sendMessage: async (chatId, text, opts) => { sent.push({ chatId, text, opts }); } };
    const msgFor = (u) => ({ chat: { id: 1 }, from: { id: u.telegram_user_id } });
    await handlePendingRemote(bot, msgFor(U.m1));
    assert.match(sent[0].text, /منتظر بررسی: 3 ثبت/);
    assert.match(sent[0].text, /الف — 2 ثبت/);
    await handlePendingRemote(bot, msgFor(U.emp));
    assert.match(sent[1].text, /فقط برای سرپرستان/);
    const calm = F.makeUser({ role: 'manager' });
    await handlePendingRemote(bot, msgFor(calm));
    assert.match(sent[2].text, /هیچ دورکاری/);
    assert.match(buildSummaryText({ total: 1, employees: [{ fullName: 'x', count: 1, oldestWorkDate: '2026-10-10' }] }), /x — 1 ثبت/);
  });

  test('یادآوری هفتگی: یک اعلان برای هر گیرنده، تکرار در همان هفته dedupe، صف خالی ⇒ هیچ', async () => {
    const { runRemoteWorkWeeklyReminder } = require('../src/bot/scheduler/remoteWorkReminder');
    const r1 = await runRemoteWorkWeeklyReminder({ now });
    assert.equal(r1.errors, 0);
    assert.equal(r1.reminded, r1.checked);
    const rows = db.prepare("SELECT user_id, title, link FROM notifications WHERE type = 'remote_work_review_reminder'").all();
    assert.deepEqual(rows.map((r) => r.user_id).sort((a, b) => a - b), [U.admin.id, U.m1.id, U.m2.id].sort((a, b) => a - b));
    assert.ok(rows.every((r) => r.link === '#/remote'));
    const r2 = await runRemoteWorkWeeklyReminder({ now });
    assert.equal(r2.reminded, 0); // همان هفته
    assert.equal(db.prepare("SELECT COUNT(*) n FROM notifications WHERE type = 'remote_work_review_reminder'").get().n, 3);
    // هفته‌ی بعد با صف باقی‌مانده دوباره یادآوری می‌شود
    const r3 = await runRemoteWorkWeeklyReminder({ now: new Date('2026-10-24T10:00:00Z') });
    assert.equal(r3.reminded, 3);
  });

  test('job هفتگی: weeklyReport همچنان یک job است و یادآوری دورکاری را هم اجرا می‌کند (بدون job/تنظیم جدید)', () => {
    const fs = require('fs'); const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'bot', 'scheduler', 'index.js'), 'utf8');
    assert.match(src, /name: 'weeklyReport', run: \(\) => runAll\(\(\) => sendWeeklyReport\(bot\), \(\) => runRemoteWorkWeeklyReminder\(\)\)/);
  });
});

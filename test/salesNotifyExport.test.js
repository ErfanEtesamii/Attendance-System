// اعلان تلگرامِ معامله‌ی موفق (پیام‌های متنوع، گروه بدون مبلغ، ایدمپوتنت، مبنا) + اکسل پورسانت برای حسابداری.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

describe('اعلان فروش و اکسل پورسانت', () => {
  let server; let base; let cookies; let U; let service; let notifyService; let db;
  const nowIso = () => new Date().toISOString();
  const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();
  const deal = (id, email, name, price, wonAt, disc = 0) => ({ Id: id, Code: 1, Title: `معامله ${id}`, ChangeToWonTime: wonAt, Price: '0', Owner: { Email: email, DisplayName: name }, Contact: { DisplayName: 'مشتری' }, Items: price ? [{ Title: 'کالا', UnitPrice: price * 10, Quantity: 1, Discount: 0, DiscountPercent: disc }] : [] });
  const fakeFetch = (deals) => async () => ({ ok: true, status: 200, json: async () => ({ Response: { List: deals } }) });
  const sync = (deals) => service.sync({ fetchImpl: fakeFetch(deals), announce: false });
  const sent = []; const grp = [];
  const deps = { sendTelegram: async (to, text) => { sent.push({ to, text }); return true; }, sendGroup: async (to, text) => { grp.push({ to, text }); return true; } };
  const run = (extra = {}) => notifyService.announceNewDeals({ ...deps, rng: () => 0, ...extra });
  const tg = (u) => db.prepare('SELECT telegram_user_id FROM users WHERE id = ?').get(u.id).telegram_user_id;
  const setSetting = (k, v) => db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(k, v);

  before(async () => {
    resetDb();
    const F = require('./helpers/factories');
    require('../src/config').didar.apiKey = 'test-key';
    service = require('../src/services/commissionService');
    notifyService = require('../src/services/salesNotifyService');
    db = require('../src/db/connection').getDb();
    const { createApp } = require('../src/server');
    const sup = F.makeUser({ name: 'سرپرست فروش' });
    U = { sup, a: F.makeUser({ name: 'الف نمونه', managerId: sup.id, telegramUserId: 9001 }), b: F.makeUser({ name: 'ب', telegramUserId: 9002 }), admin: F.makeUser({ role: 'admin' }), plain: F.makeUser({ name: 'ساده' }) };
    db.prepare('UPDATE users SET didar_email = ? WHERE id = ?').run('a@x.com', U.a.id);
    db.prepare('UPDATE users SET didar_email = ? WHERE id = ?').run('b@x.com', U.b.id);
    cookies = Object.fromEntries(Object.entries(U).map(([k, u]) => [k, F.sessionCookie(u.id)]));
    server = createApp().listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => { if (server) server.close(); cleanup(); });

  const hit = async (role, url) => { const res = await fetch(base + url, { headers: { cookie: cookies[role], 'x-requested-with': 'AttendancePanel' } }); return { status: res.status, res }; };

  test('اولین همگام‌سازی بی‌صدا مبنا می‌شود (بدون پیام برای معامله‌های قدیمی)', async () => {
    await sync([deal('old1', 'a@x.com', 'الف', 100_000_000, nowIso())]);
    const r = await run();
    assert.equal(r.baseline, true); assert.equal(sent.length, 0); assert.equal(grp.length, 0);
    assert.equal((await run()).sent, 0);
  });

  test('معامله‌ی تازه ⇒ پیام خصوصی با پورسانتِ همان فاکتور؛ گروه بدون مبلغ؛ فقط یک‌بار', async () => {
    setSetting('sales_group_chat_id', '-100777');
    await sync([deal('old1', 'a@x.com', 'الف', 100_000_000, nowIso()), deal('n1', 'a@x.com', 'الف', 300_000_000, nowIso(), 5)]);
    const r = await run();
    assert.equal(r.sent, 1);
    assert.equal(sent.length, 1); assert.equal(sent[0].to, String(tg(U.a)));
    assert.ok(sent[0].text.includes('الف'), 'نام کوچک');
    // ۳۰۰ میلیون، تخفیف ۵٪ ⇒ ۲۸۵ میلیون، ۷٪ ⇒ ۱۹٬۹۵۰٬۰۰۰
    assert.ok(sent[0].text.includes('۱۹٬۹۵۰٬۰۰۰'), sent[0].text);
    assert.equal(grp.length, 1); assert.equal(grp[0].to, '-100777');
    assert.ok(!/[0-9۰-۹]{4,}/.test(grp[0].text), 'پیام گروه هیچ مبلغی ندارد');
    const row = db.prepare("SELECT type FROM notifications WHERE user_id = ? AND type = 'sales_deal_won'").all(U.a.id);
    assert.equal(row.length, 1);
    assert.equal((await run()).sent, 0); assert.equal(sent.length, 1); // ایدمپوتنت
  });

  test('پله‌ی بالاتر ⇒ پیام «tier»؛ فاکتور پنجم ماه ⇒ «milestone»', async () => {
    const base2 = [deal('old1', 'a@x.com', 'الف', 100_000_000, nowIso()), deal('n1', 'a@x.com', 'الف', 300_000_000, nowIso(), 5)];
    await sync([...base2, deal('n2', 'a@x.com', 'الف', 500_000_000, nowIso())]); // ۵۰۰ میلیون > ۴۵۰ ⇒ پله‌ی ۵٪ (قبلاً ۳٪)
    await run();
    assert.ok(sent[sent.length - 1].text.includes(notifyService.HEADLINES.tier[0]({ name: 'الف' })), sent[sent.length - 1].text);
    await sync([...base2, deal('n2', 'a@x.com', 'الف', 500_000_000, nowIso()), deal('n3', 'a@x.com', 'الف', 100_000_000, nowIso())]);
    await run(); // ۴مین فاکتور ماه (old1,n1,n2,n3) ⇒ معمولی
    assert.ok(sent[sent.length - 1].text.includes(notifyService.HEADLINES.deal[0]({ name: 'الف' })));
    await sync([...base2, deal('n2', 'a@x.com', 'الف', 500_000_000, nowIso()), deal('n3', 'a@x.com', 'الف', 100_000_000, nowIso()), deal('n4', 'a@x.com', 'الف', 120_000_000, nowIso())]);
    await run(); // ۵مین فاکتور
    assert.ok(sent[sent.length - 1].text.includes(notifyService.HEADLINES.milestone[0]({ name: 'الف', count: 5 })), sent[sent.length - 1].text);
  });

  test('معامله‌ی قدیمی (بیش از ۳ روز)، مالکِ بدون نگاشت، و تخفیف بالا', async () => {
    const before = sent.length;
    await sync([deal('n1', 'a@x.com', 'الف', 300_000_000, nowIso(), 5), deal('ancient', 'b@x.com', 'ب', 100_000_000, daysAgo(10)), deal('ghost', 'gone@x.com', 'رفته', 100_000_000, nowIso()), deal('hi', 'b@x.com', 'ب', 100_000_000, nowIso(), 40)]);
    await run();
    const msgs = sent.slice(before);
    assert.equal(msgs.length, 1); assert.equal(msgs[0].to, String(tg(U.b)));
    assert.ok(msgs[0].text.includes('تخفیف'), 'پیام تخفیف بالا');
    assert.ok(!msgs[0].text.includes('پورسانت این فاکتور'));
  });

  test('خاموش‌کردن تنظیم ⇒ پیام نمی‌رود و معامله «اعلام‌شده» می‌شود', async () => {
    setSetting('sales_notify_enabled', 'false');
    const before = sent.length;
    await sync([deal('n1', 'a@x.com', 'الف', 300_000_000, nowIso(), 5), deal('quiet', 'b@x.com', 'ب', 200_000_000, nowIso())]);
    assert.equal((await run()).sent, 0); assert.equal(sent.length, before);
    setSetting('sales_notify_enabled', 'true');
    assert.equal((await run()).sent, 0); assert.equal(sent.length, before); // بعد از روشن‌شدن هم قدیمی‌ها تکرار نمی‌شوند
  });

  test('پیام‌ها متنوع‌اند: بانک‌ها کافی و خروجی با rng متفاوت فرق می‌کند', () => {
    for (const k of ['deal', 'tier', 'milestone', 'ineligible']) { assert.ok(notifyService.HEADLINES[k].length >= 4); assert.ok(notifyService.CLOSINGS[k].length >= 4); }
    assert.ok(notifyService.HEADLINES.deal.length >= 8 && notifyService.CLOSINGS.deal.length >= 8);
    const ctx = { name: 'الف', count: 2, monthCommission: 1000, tierUp: false, deal: { eligible: true, title: 't', customer: '', amountToman: 1000, commissionToman: 100, ratePercent: 7, amountRate: 3 } };
    const set = new Set([0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9].map((x) => notifyService.buildPrivateMessage(ctx, () => x).title));
    assert.ok(set.size >= 5, `تیترها متنوع نیستند: ${set.size}`);
  });

  test('اکسل پورسانت: ادمین و سرپرستِ فروش بله؛ کارمند فروش و ساده ۴۰۳', async () => {
    await sync([deal('n1', 'a@x.com', 'الف', 300_000_000, nowIso(), 5), deal('quiet', 'b@x.com', 'ب', 200_000_000, nowIso())]);
    const q = `from=${new Date(Date.now() - 20 * 86400000).toISOString().slice(0, 10)}&to=${new Date(Date.now() + 86400000).toISOString().slice(0, 10)}`;
    const csv = await hit('admin', `/api/admin/sales-team/export?${q}&format=csv`);
    assert.equal(csv.status, 200);
    const text = await csv.res.text();
    assert.ok(text.includes('معامله n1'));
    const x = await hit('sup', `/api/admin/sales-team/export?${q}&format=xlsx`);
    assert.equal(x.status, 200); assert.match(x.res.headers.get('content-type'), /spreadsheetml/);
    assert.equal((await hit('b', `/api/admin/sales-team/export?${q}&format=xlsx`)).status, 403);
    assert.equal((await hit('plain', `/api/admin/sales-team/export?${q}&format=xlsx`)).status, 403);
    const { buildCommissionSheets } = require('../src/services/commissionExportService');
    const r = buildCommissionSheets({ id: U.admin.id, role: 'admin' }, { from: q.slice(5, 15), to: q.slice(19) });
    assert.equal(r.sheets.length, 2);
    const total = r.sheets[0].rows[r.sheets[0].rows.length - 1];
    assert.equal(total[0], 'جمع کل');
    assert.ok(total[4] > 0);
  });
});

// پورسانت فروش: همگام‌سازی از دیدار (fetch جعلی)، پورسانت من، لیدربرد با حذف مبلغ دیگران، نگاشت ایمیل.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

describe('API پورسانت فروش', () => {
  let server; let base; let cookies; let U; let service;
  const deal = (id, email, name, items, wonAt = '2026-11-10T08:00:00Z', price = '0') => ({ Id: id, Code: 1, Title: `معامله ${id}`, ChangeToWonTime: wonAt, Price: price, Owner: { Email: email, DisplayName: name }, Contact: { DisplayName: 'مشتری' }, Items: items });
  const fakeFetch = (deals) => async () => ({ ok: true, status: 200, json: async () => ({ Response: { List: deals } }) });

  before(async () => {
    resetDb();
    const F = require('./helpers/factories');
    require('../src/config').didar.apiKey = 'test-key';
    service = require('../src/services/commissionService');
    const { createApp } = require('../src/server');
    const sup = F.makeUser({ role: 'manager', name: 'سرپرست' });
    U = { sup, a: F.makeUser({ name: 'الف', managerId: sup.id }), b: F.makeUser({ name: 'ب' }), admin: F.makeUser({ role: 'admin' }) };
    cookies = Object.fromEntries(Object.entries(U).map(([k, u]) => [k, F.sessionCookie(u.id)]));
    server = createApp().listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
    const r = await service.sync({ fetchImpl: fakeFetch([
      // الف: ۳۰۰ میلیون تومان = ۳ میلیارد ریال، تخفیف ۵٪ ⇒ ۴٪ + ۳٪ = ۷٪ از ۲۸۵ میلیون
      deal('d1', 'a@x.com', 'الف', [{ Title: 'کالا', UnitPrice: 3_000_000_000, Quantity: 1, Discount: 0, DiscountPercent: 5 }]),
      deal('d2', 'a@x.com', 'الف', []), // بدون فاکتور
      deal('d3', 'b@x.com', 'ب', [{ Title: 'کالا', UnitPrice: 500_000_000, Quantity: 1, Discount: 0, DiscountPercent: 0 }]),
      deal('d4', 'b@x.com', 'ب', [{ Title: 'کالا', UnitPrice: 500_000_000, Quantity: 1, Discount: 0, DiscountPercent: 0 }], '2026-10-01T08:00:00Z'), // ماه دیگر
    ]) });
    assert.deepEqual(r, { ok: true, count: 4 });
  });
  after(() => { if (server) server.close(); cleanup(); });

  async function hit(role, method, url, body) {
    const headers = { 'content-type': 'application/json', cookie: cookies[role], 'x-requested-with': 'AttendancePanel' };
    const res = await fetch(base + url, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(body || {}) });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  }
  const month = '?year=1405&month=8';

  test('بدون ایمیل دیدار ⇒ commission: null', async () => {
    assert.equal((await hit('a', 'GET', `/api/admin/me/commission${month}`)).json.commission, null);
  });
  test('canViewTeam: ادمین بله (بدون ایمیل)، فروشنده‌ی عادی خیر', async () => {
    const adm = (await hit('admin', 'GET', `/api/admin/me/commission${month}`)).json;
    assert.equal(adm.commission, null);
    assert.equal(adm.canViewTeam, true);
    assert.equal((await hit('b', 'GET', `/api/admin/me/commission${month}`)).json.canViewTeam, false);
  });
  test('نگاشت ایمیل فقط با users.write؛ ایمیل نامعتبر رد می‌شود', async () => {
    assert.equal((await hit('a', 'PUT', `/api/admin/users/${U.a.id}/didar-email`, { email: 'a@x.com' })).status, 403);
    assert.equal((await hit('admin', 'PUT', `/api/admin/users/${U.a.id}/didar-email`, { email: 'bad' })).status, 400);
    assert.equal((await hit('admin', 'PUT', `/api/admin/users/${U.a.id}/didar-email`, { email: 'A@x.com' })).status, 200);
    assert.equal((await hit('admin', 'PUT', `/api/admin/users/${U.b.id}/didar-email`, { email: 'b@x.com' })).status, 200);
    assert.equal((await hit('admin', 'GET', `/api/admin/users/${U.b.id}/didar-email`)).json.email, 'b@x.com');
  });
  test('پورسانت من: ۷٪ از ۲۸۵ میلیون، معامله‌ی بدون فاکتور جدا شمرده می‌شود', async () => {
    const { commission: c } = (await hit('a', 'GET', `/api/admin/me/commission${month}`)).json;
    assert.equal(c.totals.dealsCount, 1); assert.equal(c.totals.noInvoiceCount, 1);
    assert.equal(c.totals.salesToman, 285_000_000); assert.equal(c.totals.commissionToman, 19_950_000);
    const d = c.deals.find((x) => !x.noInvoice); assert.equal(d.ratePercent, 7);
  });
  test('لیدربرد: کارمند مبلغ دیگران را نمی‌بیند؛ ماهانه+فصلی دارد و «کل زمان» ندارد', async () => {
    const lb = (await hit('a', 'GET', `/api/admin/sales-team/leaderboard${month}`)).json.leaderboard;
    const rowB = lb.month.byAmount.find((x) => x.userId === U.b.id); const rowA = lb.month.byAmount.find((x) => x.userId === U.a.id);
    assert.equal(rowB.amountToman, null); assert.equal(rowA.amountToman, 285_000_000);
    assert.ok(!JSON.stringify(lb).includes('500000000') && !JSON.stringify(lb).includes('50000000'));
    assert.deepEqual(lb.month.byCount.map((x) => x.count), [1, 1]);
    assert.equal(lb.all, null);
    // فصل پاییز ۱۴۰۵ = مهر تا آذر ⇒ فاکتور مهرِ ب (۲۰۲۶-۱۰-۰۱) هم در فصل می‌آید (۲ فاکتور)، ولی در ماه نه
    assert.equal(lb.season.label, 'پاییز 1405');
    assert.equal(lb.season.byCount.find((x) => x.userId === U.b.id).count, 2);
  });
  test('جزئیات لیدربرد: فیلدهای مالیِ دیگران null؛ خلاصه فقط برای ادمین مبلغ دارد', async () => {
    const lb = (await hit('b', 'GET', `/api/admin/sales-team/leaderboard${month}`)).json.leaderboard;
    const other = lb.month.byAmount.find((x) => x.userId === U.a.id);
    assert.equal(other.amountToman, null); assert.equal(other.commissionToman, null); assert.equal(other.avgInvoiceToman, null); assert.equal(other.maxInvoiceToman, null); assert.equal(other.avgDiscountPercent, null);
    assert.equal(lb.month.summary.amountToman, null);
    assert.ok(lb.month.byCount.every((x) => typeof x.sharePercent === 'number'));
    const adm = (await hit('admin', 'GET', `/api/admin/sales-team/leaderboard${month}`)).json.leaderboard;
    assert.ok(adm.month.summary.amountToman > 0 && adm.month.summary.commissionToman > 0);
    assert.ok(adm.month.byAmount.find((x) => x.userId === U.a.id).avgInvoiceToman > 0);
  });
  test('کارشناس فروشِ سابق (بدون حساب فعال) فقط در لیدربرد می‌آید؛ مبلغش برای عادی/سرپرست پنهان', async () => {
    const db = require('../src/db/connection').getDb();
    const items = JSON.stringify([{ Title: 'کالا', UnitPrice: 1_000_000_000, Quantity: 1, Discount: 0, DiscountPercent: 0 }]);
    db.prepare("INSERT INTO sales_deals (didar_id, code, title, customer, owner_email, owner_name, won_at, price_rial, items_json) VALUES ('old1','1','سابق','م','old@x.com','سجاد سابق','2026-11-01T08:00:00Z',1000000000,?)").run(items);
    try {
      const adm = (await hit('admin', 'GET', `/api/admin/sales-team/leaderboard${month}`)).json.leaderboard.month;
      const f = adm.byAmount.find((x) => x.isFormer);
      assert.equal(f.name, 'سجاد سابق'); assert.equal(f.amountToman, 100_000_000);
      assert.equal(adm.summary.members, 2); // سابق‌ها در شمار فروشنده‌ی فعال نیستند
      const b = (await hit('b', 'GET', `/api/admin/sales-team/leaderboard${month}`)).json.leaderboard.month;
      assert.equal(b.byAmount.find((x) => x.isFormer).amountToman, null);
      const sup = (await hit('sup', 'GET', `/api/admin/sales-team/leaderboard${month}`)).json.leaderboard.month;
      assert.equal(sup.byAmount.find((x) => x.isFormer).amountToman, null);
      const mem = (await hit('admin', 'GET', `/api/admin/sales-team/members${month}`)).json.members;
      const fm = mem.find((m) => m.isFormer && m.name === 'سجاد سابق');
      assert.ok(fm && fm.dealsCount === 1 && fm.commissionToman > 0); // کارت اعضا: سابق‌ها هم (فقط ادمین/مالک)
      const det = (await hit('admin', 'GET', `/api/admin/sales-team/members/${encodeURIComponent(fm.userId)}${month}`)).json;
      assert.equal(det.isFormer, true); assert.equal(det.commission.totals.dealsCount, 1);
      assert.ok(!(await hit('sup', 'GET', `/api/admin/sales-team/members${month}`)).json.members.some((m) => m.isFormer));
      assert.equal((await hit('sup', 'GET', `/api/admin/sales-team/members/${encodeURIComponent(fm.userId)}${month}`)).status, 404);
      // سابقِ فقط با معامله‌ی بدون فاکتور (قیمت صفر) هم با صفر فاکتور در لیدربرد می‌آید
      db.prepare("INSERT INTO sales_deals (didar_id, code, title, customer, owner_email, owner_name, won_at, price_rial, items_json) VALUES ('old3','3','بی‌فاکتور','م','z@x.com','زد بی‌فاکتور','2026-11-03T08:00:00Z',0,'[]')").run();
      const adm3 = (await hit('admin', 'GET', `/api/admin/sales-team/leaderboard${month}`)).json.leaderboard.month;
      const z = adm3.byCount.find((x) => x.name === 'زد بی‌فاکتور');
      assert.ok(z && z.isFormer && z.count === 0 && z.noInvoiceCount === 1);
      // مالکِ بدون ایمیل (دیدار برای کاربر غیرفعال ایمیل برنمی‌گرداند) با نام می‌آید
      db.prepare("INSERT INTO sales_deals (didar_id, code, title, customer, owner_email, owner_name, won_at, price_rial, items_json) VALUES ('old2','2','سابق۲','م','','میلاد بدون‌ایمیل','2026-11-02T08:00:00Z',1000000000,?)").run(items);
      const adm2 = (await hit('admin', 'GET', `/api/admin/sales-team/leaderboard${month}`)).json.leaderboard.month;
      const g = adm2.byAmount.find((x) => x.name === 'میلاد بدون‌ایمیل');
      assert.ok(g && g.isFormer && g.amountToman === 100_000_000);
    } finally { db.prepare("DELETE FROM sales_deals WHERE didar_id IN ('old1','old2','old3')").run(); }
  });
  test('بازه‌ی دلخواه from/to: لیدربرد، کارت من و کارت اعضا', async () => {
    const q = '?from=2026-09-23&to=2026-11-21'; // مهر تا آبان ۱۴۰۵
    const lb = (await hit('admin', 'GET', `/api/admin/sales-team/leaderboard${q}`)).json.leaderboard;
    assert.equal(lb.range.from, '2026-09-23'); assert.equal(lb.range.clamped, false);
    assert.equal(lb.byCount.find((x) => x.userId === U.b.id).count, 2);
    const mine = (await hit('b', 'GET', `/api/admin/me/commission${q}`)).json.commission;
    assert.equal(mine.totals.dealsCount, 2); assert.equal(mine.season, null); assert.equal(mine.range.custom, true);
    const mem = (await hit('admin', 'GET', `/api/admin/sales-team/members${q}`)).json;
    assert.equal(mem.members.find((m) => m.userId === U.b.id).dealsCount, 2);
    const bad = (await hit('admin', 'GET', '/api/admin/sales-team/leaderboard?from=2026-11-21&to=2026-09-23')).json.leaderboard;
    assert.ok(bad.month && !bad.range); // بازه‌ی نامعتبر ⇒ برگشت به ماه
  });
  test('کارمند عادی نمی‌تواند با from خیلی قدیمی «کل زمان» بگیرد (کف سمت سرور)', async () => {
    const lb = (await hit('b', 'GET', '/api/admin/sales-team/leaderboard?from=2015-01-01&to=2026-11-21')).json.leaderboard;
    assert.equal(lb.range.clamped, true);
    assert.ok(lb.range.from > '2026-01-01');
  });
  test('عکس پروفایل: همکاران فروش (دارای ایمیل دیدار) عکس هم‌دیگر را در فهرست می‌بینند، فروشنده‌ی نگاشت‌نشده نه', async () => {
    const db = require('../src/db/connection').getDb();
    db.prepare("INSERT INTO user_avatars (user_id, file_id, mime, size) VALUES (?, 'fid1', 'image/jpeg', 10)").run(U.b.id);
    try {
      const a = (await hit('a', 'GET', '/api/admin/avatars')).json.versions;
      assert.equal(a[U.b.id], 'fid1'); // الف و ب هر دو فروشنده‌اند (ایمیل دیدار) ولی در اسکوپ هم نیستند
      db.prepare('UPDATE users SET didar_email = NULL WHERE id = ?').run(U.a.id);
      assert.equal((await hit('a', 'GET', '/api/admin/avatars')).json.versions[U.b.id], undefined);
    } finally { db.prepare('UPDATE users SET didar_email = ? WHERE id = ?').run('a@x.com', U.a.id); db.prepare('DELETE FROM user_avatars WHERE user_id = ?').run(U.b.id); }
  });
  test('ممیزی نشت: پاسخ لیدربرد/کارت اعضا برای کارمند عادی هیچ مبلغِ دیگران ندارد (همه‌ی بازه‌ها و فیلدها)', async () => {
    const MONEY = ['amountToman', 'avgInvoiceToman', 'maxInvoiceToman', 'commissionToman', 'avgDiscountPercent', 'salesToman', 'seasonToman'];
    const walk = (node, path, out) => {
      if (Array.isArray(node)) node.forEach((x, i) => walk(x, `${path}[${i}]`, out));
      else if (node && typeof node === 'object') {
        for (const [k, v] of Object.entries(node)) {
          if (MONEY.includes(k) && v !== null && v !== undefined) out.push({ path: `${path}.${k}`, owner: node.userId, v });
          walk(v, `${path}.${k}`, out);
        }
      }
    };
    const urls = [`/api/admin/sales-team/leaderboard${month}`, '/api/admin/sales-team/leaderboard?from=2015-01-01&to=2026-11-21', '/api/admin/sales-team/leaderboard?from=2026-09-23&to=2026-11-21', `/api/admin/sales-team/members${month}`];
    for (const who of ['a', 'b']) {
      for (const u of urls) {
        const json = (await hit(who, 'GET', u)).json; const found = [];
        walk(json, '$', found);
        const me = U[who].id;
        for (const f of found) assert.equal(f.owner, me, `${who} ${u} ${f.path} مبلغِ غیرِ خود را دارد`);
        // خلاصه‌ی بازه (جمع مبلغ/پورسانت تیم) فقط ادمین/مالک
        const lbm = json.leaderboard && (json.leaderboard.range ? json.leaderboard : json.leaderboard.month);
        const sm = (json.leaderboard && json.leaderboard.summary) || (lbm && lbm.summary);
        if (sm) { assert.equal(sm.amountToman, null); assert.equal(sm.commissionToman, null); }
      }
    }
  });
  test('admin همه‌ی مبلغ‌ها و «کل زمان» را می‌بیند', async () => {
    const lb = (await hit('admin', 'GET', `/api/admin/sales-team/leaderboard${month}`)).json.leaderboard;
    assert.equal(lb.month.byAmount.find((x) => x.userId === U.b.id).amountToman, 50_000_000);
    assert.ok(lb.all && lb.all.byCount.length === 2);
  });
  test('سرپرست تیم: مبلغ اعضای تیم خودش + «کل زمان»؛ مبلغ عضوِ دیگران را نه', async () => {
    const lb = (await hit('sup', 'GET', `/api/admin/sales-team/leaderboard${month}`)).json.leaderboard;
    assert.equal(lb.month.byAmount.find((x) => x.userId === U.a.id).amountToman, 285_000_000);
    assert.equal(lb.month.byAmount.find((x) => x.userId === U.b.id).amountToman, null);
    assert.ok(lb.all);
  });
  test('کارت پورسانت اعضا: ادمین همه، سرپرست فقط تیم خودش، عادی هیچ', async () => {
    const adm = (await hit('admin', 'GET', `/api/admin/sales-team/members${month}`)).json;
    assert.equal(adm.members.length, 2);
    const mem = (await hit('admin', 'GET', `/api/admin/sales-team/members/${U.a.id}${month}`)).json;
    assert.equal(mem.commission.totals.commissionToman, 19_950_000);
    const sup = (await hit('sup', 'GET', `/api/admin/sales-team/members${month}`)).json;
    assert.deepEqual(sup.members.map((m) => m.userId), [U.a.id]);
    assert.equal((await hit('sup', 'GET', `/api/admin/sales-team/members/${U.a.id}${month}`)).status, 200);
    assert.equal((await hit('sup', 'GET', `/api/admin/sales-team/members/${U.b.id}${month}`)).status, 404);
    assert.equal((await hit('b', 'GET', `/api/admin/sales-team/members${month}`)).json.members.length, 0);
    assert.equal((await hit('b', 'GET', `/api/admin/sales-team/members/${U.a.id}${month}`)).status, 404);
  });
  test('پورسانت من: جمع فصل هم برمی‌گردد', async () => {
    const c = (await hit('b', 'GET', `/api/admin/me/commission${month}`)).json.commission;
    assert.equal(c.season.dealsCount, 2);
  });
  test('همگام‌سازی بدون کلید ⇒ خطای قابل‌فهم و کلید لو نمی‌رود', async () => {
    const cfg = require('../src/config').didar; const old = cfg.apiKey; cfg.apiKey = '';
    const r = await service.sync(); cfg.apiKey = old;
    assert.equal(r.ok, false); assert.equal(r.code, 'DIDAR_NOT_CONFIGURED'); assert.ok(!JSON.stringify(r).includes('test-key'));
  });
});

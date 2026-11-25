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

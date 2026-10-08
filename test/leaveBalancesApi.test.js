// S4-9c: API مانده‌ی مرخصی — اسکوپ (کارمند خودش، سرپرست خودش+تیم، admin/hr همه)، نوشتن فقط admin با دلیل و audit، ورودی نامعتبر.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

describe('API مانده‌ی مرخصی (S4-9c)', () => {
  let server; let base; let cookies; let users; let annualId; let missionId; let db;
  const Y = 1405;

  before(async () => {
    db = resetDb();
    const { makeUser, sessionCookie } = require('./helpers/factories');
    const leaveTypesRepo = require('../src/repositories/leaveTypesRepository');
    const { createApp } = require('../src/server');
    const manager = makeUser({ role: 'manager', name: 'سرپرست' });
    users = {
      admin: makeUser({ role: 'admin' }), hr: makeUser({ role: 'hr' }), manager,
      employee: makeUser({ role: 'employee', managerId: manager.id, name: 'کارمند تیم' }),
      other: makeUser({ role: 'employee', name: 'کارمند بیرون تیم' }),
    };
    annualId = leaveTypesRepo.findByCode('annual').id;
    missionId = leaveTypesRepo.findByCode('mission').id;
    cookies = Object.fromEntries(Object.entries(users).map(([k, u]) => [k, sessionCookie(u.id)]));
    server = createApp().listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => { if (server) server.close(); cleanup(); });

  async function hit(role, method, url, { csrf = true, body } = {}) {
    const headers = { 'content-type': 'application/json' };
    if (cookies[role]) headers.cookie = cookies[role];
    if (csrf) headers['x-requested-with'] = 'AttendancePanel';
    const res = await fetch(base + url, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(body || {}) });
    let json = null;
    try { json = await res.json(); } catch (_) { /* بدنه‌ی غیر JSON */ }
    return { status: res.status, json };
  }
  const ids = (r) => r.json.items.map((i) => i.userId).sort((a, b) => a - b);
  const sorted = (...us) => us.map((u) => u.id).sort((a, b) => a - b);

  test('اسکوپ فهرست: کارمند خودش؛ سرپرست خودش+تیم؛ admin و hr همه', async () => {
    assert.deepEqual(ids(await hit('employee', 'GET', `/api/admin/leave-balances?year=${Y}`)), sorted(users.employee));
    assert.deepEqual(ids(await hit('manager', 'GET', `/api/admin/leave-balances?year=${Y}`)), sorted(users.manager, users.employee));
    const all = sorted(...Object.values(users));
    assert.deepEqual(ids(await hit('admin', 'GET', `/api/admin/leave-balances?year=${Y}`)), all);
    assert.deepEqual(ids(await hit('hr', 'GET', `/api/admin/leave-balances?year=${Y}`)), all);
    assert.equal((await hit('employee', 'GET', '/api/admin/leave-balances')).status, 200);
    assert.equal((await hit('employee', 'GET', '/api/admin/leave-balances', {})).json.jalaliYear >= 1405, true, 'پیش‌فرض: سال شمسی جاری');
  });

  test('userId مشخص: خودش مجاز، خارج از اسکوپ ۴۰۳، ناموجود ۴۰۴، نامعتبر ۴۰۰', async () => {
    const q = (u) => `/api/admin/leave-balances?userId=${u.id}&year=${Y}`;
    assert.equal((await hit('employee', 'GET', q(users.employee))).status, 200);
    assert.equal((await hit('employee', 'GET', q(users.other))).status, 403);
    assert.equal((await hit('employee', 'GET', q(users.manager))).status, 403);
    assert.equal((await hit('manager', 'GET', q(users.manager))).status, 200);
    assert.equal((await hit('manager', 'GET', q(users.employee))).status, 200);
    assert.equal((await hit('manager', 'GET', q(users.other))).status, 403);
    assert.equal((await hit('hr', 'GET', q(users.other))).status, 200);
    assert.equal((await hit('admin', 'GET', '/api/admin/leave-balances?userId=999999')).status, 404);
    assert.equal((await hit('admin', 'GET', '/api/admin/leave-balances?userId=abc')).status, 400);
    assert.equal((await hit('admin', 'GET', '/api/admin/leave-balances?year=99')).status, 400);
    assert.equal((await hit('admin', 'GET', '/api/admin/leave-balances?year=1900')).status, 400);
  });

  test('نوشتن فقط admin؛ دلیل اجباری؛ audit؛ اثر در مانده و نمایش؛ نوع بدون مانده رد می‌شود', async () => {
    const e = users.employee;
    const body = { userId: e.id, leaveTypeId: annualId, year: Y };
    for (const role of ['employee', 'manager', 'hr']) {
      assert.equal((await hit(role, 'POST', '/api/admin/leave-balances/adjust', { body: { ...body, minutes: 60, reason: 'x' } })).status, 403, role);
      assert.equal((await hit(role, 'PUT', '/api/admin/leave-balances/entitlement', { body: { ...body, entitledMinutes: 1, reason: 'x' } })).status, 403, role);
    }
    assert.equal((await hit('admin', 'POST', '/api/admin/leave-balances/adjust', { csrf: false, body: { ...body, minutes: 60, reason: 'x' } })).status, 403, 'بدون هدر CSRF');
    assert.equal((await hit('admin', 'POST', '/api/admin/leave-balances/adjust', { body: { ...body, minutes: 60 } })).status, 400);
    assert.equal((await hit('admin', 'POST', '/api/admin/leave-balances/adjust', { body: { ...body, minutes: 0, reason: 'x' } })).status, 400);
    assert.equal((await hit('admin', 'POST', '/api/admin/leave-balances/adjust', { body: { ...body, leaveTypeId: missionId, minutes: 60, reason: 'x' } })).json.code, 'NOT_TRACKED');
    assert.equal((await hit('admin', 'POST', '/api/admin/leave-balances/adjust', { body: { ...body, userId: 999999, minutes: 60, reason: 'x' } })).status, 404);

    const put = await hit('admin', 'PUT', '/api/admin/leave-balances/entitlement', { body: { ...body, entitledMinutes: 5000, carriedOverMinutes: 100, reason: 'استحقاق' } });
    assert.equal(put.status, 200);
    const post = await hit('admin', 'POST', '/api/admin/leave-balances/adjust', { body: { ...body, minutes: -200, reason: 'کسر' } });
    assert.equal(post.status, 201);
    assert.equal(post.json.balance.remaining, 4900);

    const got = await hit('employee', 'GET', `/api/admin/leave-balances?userId=${e.id}&year=${Y}`);
    const bal = got.json.items[0].balances;
    assert.deepEqual(bal.map((b) => b.leaveType.code), ['annual'], 'فقط نوع‌های دارای مانده');
    assert.deepEqual([bal[0].entitled, bal[0].carriedOver, bal[0].adjustments, bal[0].used, bal[0].remaining], [5000, 100, -200, 0, 4900]);
    assert.equal(bal[0].display.remaining.text.includes('روز'), true);
    assert.equal(bal[0].policy, 'warn');

    const rows = db.prepare("SELECT user_id, details FROM audit_log WHERE action IN ('leave_balance_adjusted','leave_balance_entitlement_set')").all();
    assert.equal(rows.length, 2);
    assert.ok(rows.every((r) => r.user_id === users.admin.id));
  });

  test('تاریخچه‌ی تعدیل‌ها با همان اسکوپ', async () => {
    const e = users.employee;
    const url = (u) => `/api/admin/leave-balances/${u.id}/adjustments?leaveTypeId=${annualId}&year=${Y}`;
    const own = await hit('employee', 'GET', url(e));
    assert.equal(own.status, 200);
    assert.deepEqual(own.json.adjustments.map((a) => [a.minutes, a.reason]), [[-200, 'کسر']]);
    assert.equal((await hit('employee', 'GET', url(users.other))).status, 403);
    assert.equal((await hit('manager', 'GET', url(e))).status, 200);
    assert.equal((await hit('manager', 'GET', url(users.other))).status, 403);
    assert.equal((await hit('hr', 'GET', url(users.other))).status, 200);
    assert.equal((await hit('admin', 'GET', `/api/admin/leave-balances/${e.id}/adjustments`)).status, 400);
  });

  test('بدون ورود ⇒ ۴۰۱', async () => {
    assert.equal((await hit('nobody', 'GET', '/api/admin/leave-balances')).status, 401);
  });
});

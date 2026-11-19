// «خروجی‌ها»: خروجی CSV لیست‌های جدید (مرخصی/مأموریت، مانده‌ی مرخصی، اعتراض‌ها، تعطیلات، شیفت‌ها) + دسترسی
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

let hasDeps = true;
try { require.resolve('express'); } catch (_) { hasDeps = false; }

describe('خروجی‌های Excel/CSV بخش «خروجی‌ها»', { skip: hasDeps ? false : 'express نصب نیست' }, () => {
  let server, base, cookies;
  before(async () => {
    resetDb();
    const { makeUser, sessionCookie } = require('./helpers/factories');
    const { createApp } = require('../src/server');
    const admin = makeUser({ role: 'admin' });
    const employee = makeUser({ role: 'employee' });
    cookies = { admin: sessionCookie(admin.id), employee: sessionCookie(employee.id) };
    server = createApp().listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => { if (server) server.close(); cleanup(); });

  const get = async (role, url) => {
    const res = await fetch(base + url, { headers: { cookie: cookies[role], 'x-requested-with': 'AttendancePanel' } });
    return { status: res.status, type: res.headers.get('content-type') || '', text: await res.text() };
  };

  for (const path of ['leave-requests', 'leave-balances', 'disputes', 'holidays', 'shifts']) {
    test(`${path}: ادمین CSV می‌گیرد و کارمند عادی ۴۰۳`, async () => {
      const ok = await get('admin', `/api/admin/${path}/export?format=csv`);
      assert.equal(ok.status, 200, ok.text.slice(0, 200));
      assert.match(ok.type, /csv/);
      const no = await get('employee', `/api/admin/${path}/export?format=csv`);
      assert.equal(no.status, 403);
    });
  }

  test('بازه‌ی تاریخ و سال نامعتبر ⇒ ۴۰۰', async () => {
    assert.equal((await get('admin', '/api/admin/leave-requests/export?from=xx&format=csv')).status, 400);
    assert.equal((await get('admin', '/api/admin/leave-balances/export?year=12&format=csv')).status, 400);
  });
});

describe('صفحه‌ی «خروجی‌ها» در پنل (ساختار)', () => {
  const fs = require('node:fs'); const path = require('node:path');
  const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
  test('view ثبت شده، در index.html لود می‌شود و مسیرهای خروجی به routeهای واقعی وصل‌اند', () => {
    const js = read('public-admin', 'js', 'views-exports.js');
    assert.match(js, /AP\.view\('exports'/);
    assert.match(read('public-admin', 'index.html'), /views-exports\.js/);
    assert.match(read('public-admin', 'index.html'), /45-exports\.css/);
    const paths = [...js.matchAll(/path: '(\/api\/admin\/[^']+)'/g)].map((m) => m[1]);
    assert.ok(paths.length >= 13, `تعداد مسیرها: ${paths.length}`);
    const routes = ['attendance', 'reports', 'performance', 'teamReview', 'users', 'audit', 'exportsHub', 'employeeWeek']
      .map((f) => read('src', 'api', 'routes', 'admin', `${f}.js`)).join('\n');
    for (const p of paths) assert.ok(routes.includes(p.replace('/api', '')), `route برای ${p} پیدا نشد`);
  });
});

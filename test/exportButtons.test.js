// S5-5b: دکمه‌های دانلود Excel/CSV/چاپ با فیلتر فعال؛ فیلترهای سمت سرور users/export و reports/export؛ اتصال به همه‌ی صفحه‌های گزارش.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const EX = require('../public-admin/js/exports.js');
const { makeUser, sessionCookie } = require('./helpers/factories');
const panel = (f) => fs.readFileSync(path.join(__dirname, '..', 'public-admin', f), 'utf8');

describe('سازنده‌ی دکمه‌های دانلود (S5-5b)', () => {
  test('buildUrl: پارامترهای خالی حذف، encode، format اضافه', () => {
    assert.equal(EX.buildUrl('/api/x', { a: '', b: undefined, c: 'فنی', d: 0 }, 'xlsx'), '/api/x?c=%D9%81%D9%86%DB%8C&d=0&format=xlsx');
    assert.equal(EX.buildUrl('/api/x', {}), '/api/x');
  });

  test('exportBarHtml: Excel + CSV + چاپ؛ همه با فیلتر؛ مقدارها escape', () => {
    const h = EX.exportBarHtml({ path: '/api/admin/users/export', params: { q: '"><img>', department: 'فنی' } });
    assert.match(h, /data-export="xlsx"/);
    assert.match(h, /data-export="csv"/);
    assert.match(h, /format=xlsx/);
    assert.match(h, /format=csv/);
    assert.match(h, /data-print/);
    assert.doesNotMatch(h, /<img>/); // escape شده
    assert.doesNotMatch(h, /\son[a-z]+=/i);
  });

  test('چاپ: window / href مستقل / بدون', () => {
    const base = { path: '/api/x', params: {} };
    assert.match(EX.exportBarHtml({ ...base, print: { href: '/admin/print.html?year=1405&month=6' } }), /href="\/admin\/print\.html\?year=1405&amp;month=6" target="_blank" rel="noopener"/);
    assert.doesNotMatch(EX.exportBarHtml({ ...base, print: false }), /چاپ/);
  });

  test('همه‌ی صفحه‌های گزارش (تردد، تحلیلی، رویدادها، کارمندان، ماهانه) از AP.exportBar استفاده می‌کنند و لینک CSV ثابت قدیمی نمانده', () => {
    const all = ['views-ops.js', 'views-admin.js', 'views-main.js'].map((f) => panel(`js/${f}`)).join('\n');
    for (const p of ['/api/admin/attendance/export', '/api/admin/reports/export', '/api/admin/audit-log/export', '/api/admin/users/export', '/api/admin/reports/monthly/export']) {
      assert.match(all, new RegExp(`exportBar\\(\\{ path: '${p.replace(/\//g, '\\/')}'`), p);
    }
    assert.doesNotMatch(all, /خروجی CSV/);
    assert.match(panel('index.html'), /src="\/admin\/js\/exports\.js"/);
    assert.match(panel('css/style.css'), /@media print/);
  });

  test('گزارش ماهانه: لینک چاپ همان پارامترها را به print.html می‌دهد', () => {
    const src = panel('js/views-admin.js');
    assert.match(src, /print: \{ href: AP\.buildExportUrl\('\/admin\/print\.html', params\) \}/);
  });
});

// ---- فیلترهای سمت سرور (route واقعی؛ با شیم express ممکن است در محیط بدون نصب اجرا نشود) ----
describe('فیلتر خروجی کارمندان و گزارش خلاصه', () => {
  let app; let server; let base; let admin; let cookie;
  const get = (p) => new Promise((resolve, reject) => {
    http.get(`${base}${p}`, { headers: { Cookie: cookie, 'X-Requested-With': 'AttendancePanel' } }, (res) => {
      let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, body: b }));
    }).on('error', reject);
  });
  before(async () => {
    resetDb();
    admin = makeUser({ role: 'admin', name: 'ادمین فیلتر', department: 'مدیریت' });
    makeUser({ role: 'employee', name: 'الف فنی', department: 'فنی' });
    makeUser({ role: 'employee', name: 'ب فروش', department: 'فروش' });
    makeUser({ role: 'employee', name: 'ج فنی غیرفعال', department: 'فنی', active: false });
    cookie = sessionCookie(admin.id);
    const { createApp } = require('../src/server');
    app = createApp();
    await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => { if (server) server.close(); cleanup(); });

  test('users/export: department، q، isActive، role', async () => {
    const names = async (qs) => (await get(`/api/admin/users/export${qs}`)).body;
    const all = await names('');
    assert.match(all, /الف فنی/); assert.match(all, /ب فروش/);
    const tech = await names('?department=%D9%81%D9%86%DB%8C');
    assert.match(tech, /الف فنی/); assert.doesNotMatch(tech, /ب فروش/);
    const active = await names('?department=%D9%81%D9%86%DB%8C&isActive=1');
    assert.match(active, /الف فنی/); assert.doesNotMatch(active, /غیرفعال/);
    const q = await names('?q=%D9%81%D8%B1%D9%88%D8%B4');
    assert.match(q, /ب فروش/); assert.doesNotMatch(q, /الف فنی/);
    assert.doesNotMatch(await names('?role=admin'), /الف فنی/);
  });

  test('reports/export: department فیلتر می‌کند', async () => {
    const r = await get('/api/admin/reports/export?from=2026-08-01&to=2026-08-31&department=%D9%81%D8%B1%D9%88%D8%B4');
    assert.equal(r.status, 200);
    assert.match(r.body, /ب فروش/);
    assert.doesNotMatch(r.body, /الف فنی/);
  });
});

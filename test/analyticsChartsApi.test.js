// S5-7a: تطبیق آداپتورهای نمودار با «پاسخ واقعی» APIهای S5-6 (route واقعی + دیتابیس نمونه) — شکل پاسخ عوض شود این تست می‌شکند.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const C = require('../public-admin/js/charts.js');
const attendanceRepo = require('../src/repositories/attendanceRepository');
const usersRepo = require('../src/repositories/usersRepository');
const settingsRepo = require('../src/repositories/settingsRepository');
const { getDb } = require('../src/db/connection');
const { zonedTimeToUtc } = require('../src/utils/time');
const { makeUser, sessionCookie } = require('./helpers/factories');

const NO_NAN = (html) => assert.doesNotMatch(html, /NaN|undefined|Infinity/);
const SAFE = (html) => {
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i);
  assert.doesNotMatch(html, /\sstyle\s*=/i);
  assert.doesNotMatch(html, /https?:\/\//i);
};

describe('آداپتورها روی پاسخ واقعی API (S5-6)', () => {
  const at = (date, hhmm) => zonedTimeToUtc(date, hhmm, 'Asia/Tehran').toISOString();
  const rec = (userId, date, inn, out) => attendanceRepo.createManual({ userId, recordDate: date, checkInTime: at(date, inn), checkOutTime: out ? at(date, out) : null, status: 'normal' });
  let server; let base; let cookie;
  before(async () => {
    resetDb();
    settingsRepo.update({ overtimeEnabled: true });
    const admin = makeUser({ role: 'admin', name: 'ادمین', department: 'مدیریت' });
    const a = makeUser({ role: 'employee', department: 'فنی', name: 'الف' });
    const b = makeUser({ role: 'employee', department: 'فروش', name: 'ب' });
    for (const u of usersRepo.listUsers({})) getDb().prepare("UPDATE users SET created_at = '2020-01-01 00:00:00' WHERE id = ?").run(u.id);
    rec(a.id, '2026-08-23', '08:00', '18:30'); rec(a.id, '2026-08-24', '08:40', '17:30'); rec(b.id, '2026-08-23', '09:05', '17:30');
    const { createApp } = require('../src/server');
    cookie = sessionCookie(admin.id);
    server = createApp().listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => { if (server) server.close(); cleanup(); });
  const get = async (u) => { const r = await fetch(base + u, { headers: { cookie, 'x-requested-with': 'AttendancePanel' } }); assert.equal(r.status, 200, u); return r.json(); };
  const faDeps = { num: (v) => new Intl.NumberFormat('fa-IR').format(v), min: (m) => `${m}m`, fa: (s) => s };

  test('روند تأخیر هفتگی (کل و به‌تفکیک دپارتمان): خط به‌ازای هر سری، جدول به تعداد سطل‌ها', async () => {
    for (const groupBy of ['none', 'department']) {
      const d = await get(`/api/admin/analytics/late-trend?granularity=week&groupBy=${groupBy}&from=2026-08-01&to=2026-09-05`);
      const spec = C.fromLateTrend(d, faDeps);
      assert.equal(spec.labels.length, d.buckets.length);
      assert.equal(spec.series.length, d.series.length);
      const h = C.lineChartHtml(spec, faDeps);
      NO_NAN(h); SAFE(h);
      assert.match(h, /<svg class="chart chart-line"/);
      assert.equal((h.match(/<tbody>.*<\/tbody>/)[0].match(/<tr>/g) || []).length, d.buckets.length);
      // هفته‌ی بدون حضور = null ⇒ «بدون داده»، نه ۰٪
      assert.match(h, /حضوری ثبت نشده/);
    }
  });

  test('مقایسه با ماه قبل: عدد جدول = پاسخ API', async () => {
    const d = await get('/api/admin/analytics/late-compare?year=1405&month=6&groupBy=department');
    const spec = C.fromLateCompare(d, faDeps);
    assert.equal(spec.categories.length, d.groups.length);
    const h = C.barChartHtml(spec, faDeps);
    NO_NAN(h); SAFE(h);
    assert.equal(spec.series[0].values.length, d.groups.length);
    const total = C.fromLateCompare(await get('/api/admin/analytics/late-compare?year=1405&month=6'), faDeps);
    assert.deepEqual(total.categories, ['همه']);
  });

  test('رتبه‌ها (اضافه‌کاری/کسری)، نرخ حضور، مرخصی، توزیع ورود: ساخته می‌شوند و مقدارها با API برابرند', async () => {
    const P = 'year=1405&month=6';
    const ot = await get(`/api/admin/analytics/rankings?${P}&metric=overtime`);
    const otSpec = C.fromRankings(ot, faDeps);
    assert.deepEqual(otSpec.series[0].values, ot.rows.map((r) => r.payableMinutes));
    NO_NAN(C.barChartHtml(otSpec, faDeps));
    const sf = await get(`/api/admin/analytics/rankings?${P}&metric=shortfall`);
    NO_NAN(C.barChartHtml(C.fromRankings(sf, faDeps), faDeps));
    const rate = await get(`/api/admin/analytics/attendance-rate?${P}&groupBy=department`);
    const rateSpec = C.fromAttendanceRate(rate, faDeps);
    assert.equal(rateSpec.yMax, 100);
    assert.deepEqual(rateSpec.series[0].values, rate.groups.map((g) => (g.rate === null ? null : Math.round(g.rate * 10000) / 100)));
    NO_NAN(C.barChartHtml(rateSpec, faDeps));
    const leave = await get(`/api/admin/analytics/leave-by-type?${P}`);
    const lh = C.barChartHtml(C.fromLeaveByType(leave, faDeps), faDeps);
    NO_NAN(lh);
    const dist = await get('/api/admin/analytics/checkin-distribution?from=2026-08-23&to=2026-08-25');
    const distSpec = C.fromCheckinDistribution(dist, faDeps);
    assert.equal(distSpec.series[0].values.reduce((s, x) => s + x, 0), dist.count);
    const dh = C.barChartHtml(distSpec, faDeps);
    NO_NAN(dh); SAFE(dh);
    assert.match(dh, /chart-bar/);
  });

  test('بازه‌ی بدون داده (توزیع ورود/رتبه): پیام خالی، بدون خطا', async () => {
    const dist = await get('/api/admin/analytics/checkin-distribution?from=2020-01-01&to=2020-01-05');
    assert.match(C.barChartHtml(C.fromCheckinDistribution(dist, faDeps), faDeps), /class="empty"/);
    const ot = await get('/api/admin/analytics/rankings?year=1390&month=1&metric=overtime');
    assert.match(C.barChartHtml(C.fromRankings(ot, faDeps), faDeps), /class="empty"/);
  });
});


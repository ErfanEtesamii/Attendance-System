// S5-6a: روند تأخیر هفتگی/ماهانه و مقایسه با ماه قبل — منطق (تعریف موتور)، سطل‌ها، گروه‌بندی، اسکوپ و ممنوعیت کارمند.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { lateTrend, compareLate, makeBuckets, weekStartOf, AnalyticsError } = require('../src/services/analyticsService');
const attendanceRepo = require('../src/repositories/attendanceRepository');
const usersRepo = require('../src/repositories/usersRepository');
const { zonedTimeToUtc } = require('../src/utils/time');
const { makeUser, sessionCookie } = require('./helpers/factories');

const at = (date, hhmm) => zonedTimeToUtc(date, hhmm, 'Asia/Tehran').toISOString();
const rec = (userId, date, inn) => attendanceRepo.createManual({ userId, recordDate: date, checkInTime: at(date, inn), checkOutTime: at(date, '16:30'), status: 'normal' });
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);

describe('سطل‌های هفته/ماه (S5-6a)', () => {
  test('هفته از شنبه شروع می‌شود', () => {
    assert.equal(weekStartOf('2026-08-22'), '2026-08-22'); // شنبه
    assert.equal(weekStartOf('2026-08-23'), '2026-08-22'); // یکشنبه
    assert.equal(weekStartOf('2026-08-28'), '2026-08-22'); // جمعه
    assert.equal(weekStartOf('2026-08-29'), '2026-08-29');
  });
  test('سطل‌های پیوسته، حتی بدون داده؛ ماهِ شمسی با مرز درست', () => {
    const w = makeBuckets('2026-08-23', '2026-09-05', 'week');
    assert.deepEqual(w.map((b) => b.key), ['2026-08-22', '2026-08-29', '2026-09-05']);
    const m = makeBuckets('2026-07-25', '2026-09-25', 'month');
    assert.deepEqual(m.map((b) => b.key), ['1405-05', '1405-06', '1405-07']);
    assert.equal(m[1].from, '2026-08-23');
    assert.equal(m[1].to, '2026-09-22');
  });
});

describe('روند و مقایسه‌ی تأخیر (S5-6a)', () => {
  let admin; let hr; let mgr; let a1; let a2; let b1; let nobody; let outsider; let ctx;
  before(() => {
    resetDb();
    admin = makeUser({ role: 'admin', name: 'ادمین', department: 'مدیریت' });
    hr = makeUser({ role: 'hr', name: 'منابع', department: 'مدیریت' });
    mgr = makeUser({ role: 'manager', name: 'سرپرست', department: 'فنی' });
    a1 = makeUser({ role: 'employee', managerId: mgr.id, department: 'فنی', name: 'الف۱' });
    a2 = makeUser({ role: 'employee', managerId: mgr.id, department: 'فنی', name: 'الف۲' });
    b1 = makeUser({ role: 'employee', department: 'فروش', name: 'ب۱' });
    nobody = makeUser({ role: 'employee', department: '', name: 'بدون‌داده' });
    outsider = b1;
    // شهریور ۱۴۰۵ = ۲۰۲۶-۰۸-۲۳ … ۲۰۲۶-۰۹-۲۲ (روزهای یکشنبه تا چهارشنبه)
    rec(a1.id, '2026-08-23', '08:30'); rec(a1.id, '2026-08-24', '08:45'); rec(a1.id, '2026-08-25', '08:00'); rec(a1.id, '2026-08-26', '08:00');
    rec(a2.id, '2026-08-30', '08:00'); rec(a2.id, '2026-08-31', '08:00');
    rec(b1.id, '2026-08-23', '08:20'); rec(b1.id, '2026-08-24', '08:00');
    // مرداد ۱۴۰۵ (ماه قبل)
    rec(a1.id, '2026-08-10', '08:30'); rec(a1.id, '2026-08-11', '08:00');
    const dayService = require('../src/engine/dayService');
    ctx = dayService.loadContext();
  });
  after(cleanup);
  const all = () => usersRepo.listUsers({ onlyActive: true });

  test('روند هفتگی کل: شمارش با تعریف موتور، نرخ، دقیقه، سطل خالی', () => {
    const r = lateTrend({ users: all(), from: '2026-08-23', to: '2026-09-05', granularity: 'week', context: ctx });
    assert.deepEqual(r.buckets.map((b) => b.key), ['2026-08-22', '2026-08-29', '2026-09-05']);
    const [w1, w2, w3] = r.series[0].points;
    assert.equal(w1.presentDays, 6); assert.equal(w1.lateCount, 3); assert.equal(w1.lateMinutes, 95); near(w1.lateRate, 0.5);
    assert.equal(w2.presentDays, 2); assert.equal(w2.lateCount, 0); assert.equal(w2.lateRate, 0);
    assert.equal(w3.presentDays, 0); assert.equal(w3.lateRate, null); // بدون حضور ⇒ null نه ۰
    assert.equal(r.series[0].total.presentDays, 8);
  });

  test('رکوردهای بیرون از بازه شمرده نمی‌شوند', () => {
    const r = lateTrend({ users: all(), from: '2026-08-30', to: '2026-09-05', granularity: 'week', context: ctx });
    assert.equal(r.series[0].total.presentDays, 2);
    assert.equal(r.series[0].total.lateCount, 0);
  });

  test('روند ماهانه به‌تفکیک دپارتمان؛ کاربر بی‌دپارتمان زیر «بدون دپارتمان»', () => {
    const r = lateTrend({ users: all(), from: '2026-07-25', to: '2026-09-25', granularity: 'month', groupBy: 'department', context: ctx });
    const by = Object.fromEntries(r.series.map((s) => [s.label, s]));
    assert.deepEqual(Object.keys(by).sort(), ['بدون دپارتمان', 'فروش', 'فنی', 'مدیریت'].sort());
    const tech = by['فنی'].points; // مرداد، شهریور، مهر
    assert.equal(tech[0].lateCount, 1); assert.equal(tech[1].presentDays, 6); assert.equal(tech[1].lateCount, 2);
    assert.equal(by['بدون دپارتمان'].total.presentDays, 0);
    assert.equal(by['بدون دپارتمان'].total.lateRate, null);
  });

  test('به‌تفکیک فرد', () => {
    const r = lateTrend({ users: [a1, a2], from: '2026-08-23', to: '2026-09-22', granularity: 'month', groupBy: 'user', context: ctx });
    assert.deepEqual(r.series.map((s) => s.userId), [a1.id, a2.id]);
    assert.equal(r.series[0].total.lateCount, 2);
    assert.equal(r.series[1].total.lateCount, 0);
  });

  test('مقایسه با ماه قبل: اختلاف تعداد/دقیقه/درصد/نرخ؛ ماه گذشته partial نیست', () => {
    const c = compareLate({ users: all(), year: 1405, month: 6, context: ctx, today: '2026-10-10' });
    assert.equal(c.current.label, 'شهریور 1405');
    assert.equal(c.previous.label, 'مرداد 1405');
    assert.equal(c.current.partial, false);
    assert.equal(c.current.presentDays, 8); assert.equal(c.current.lateCount, 3); assert.equal(c.current.lateMinutes, 95); near(c.current.lateRate, 0.375);
    assert.equal(c.previous.presentDays, 2); assert.equal(c.previous.lateCount, 1); near(c.previous.lateRate, 0.5);
    assert.equal(c.delta.lateCount, 2); assert.equal(c.delta.lateMinutes, 65); assert.equal(c.delta.lateCountPercent, 200); near(c.delta.lateRatePoints, -0.125);
    assert.deepEqual(c.groups, []);
    assert.equal(compareLate({ users: all(), year: 1405, month: 6, context: ctx, today: '2026-09-10' }).current.partial, true);
  });

  test('ماه قبل بدون تأخیر ⇒ درصد null (نه Infinity)؛ ماه اول سال به اسفند سال قبل می‌رود؛ بدون کاربر ⇒ صفرها', () => {
    const c = compareLate({ users: [b1], year: 1405, month: 7, context: ctx }); // مهر در برابر شهریور: b1 شهریور 1 تأخیر
    assert.equal(c.delta.lateCountPercent, -100);
    const z = compareLate({ users: [a2], year: 1405, month: 6, context: ctx }); // a2 هرگز دیر نیامده
    assert.equal(z.delta.lateCountPercent, null);
    assert.equal(compareLate({ users: [], year: 1405, month: 1, context: ctx }).previous.label, 'اسفند 1404');
    assert.equal(compareLate({ users: [], year: 1405, month: 6, context: ctx }).current.lateRate, null);
  });

  test('مقایسه به‌تفکیک دپارتمان', () => {
    const c = compareLate({ users: all(), year: 1405, month: 6, groupBy: 'department', context: ctx });
    const tech = c.groups.find((g) => g.label === 'فنی');
    assert.equal(tech.current.lateCount, 2); assert.equal(tech.previous.lateCount, 1); assert.equal(tech.delta.lateCount, 1);
  });

  test('اعتبارسنجی: ورودی نامعتبر ⇒ AnalyticsError با کد', () => {
    const code = (fn) => { try { fn(); } catch (e) { return e instanceof AnalyticsError ? e.code : `other:${e.message}`; } return null; };
    assert.equal(code(() => lateTrend({ users: [], from: '2026-09-02', to: '2026-09-01' })), 'INVALID_RANGE');
    assert.equal(code(() => lateTrend({ users: [], from: 'x', to: '2026-09-01' })), 'INVALID_RANGE');
    assert.equal(code(() => lateTrend({ users: [], from: '2020-01-01', to: '2026-09-01' })), 'RANGE_TOO_LARGE');
    assert.equal(code(() => lateTrend({ users: [], from: '2026-08-01', to: '2026-09-01', granularity: 'day' })), 'INVALID_GRANULARITY');
    assert.equal(code(() => lateTrend({ users: [], from: '2026-08-01', to: '2026-09-01', groupBy: 'x' })), 'INVALID_GROUP');
  });

  // ---- route (با express) ----
  describe('API: اسکوپ و ممنوعیت کارمند', () => {
    let server; let base; let cookies;
    before(async () => {
      const { createApp } = require('../src/server');
      cookies = { admin: sessionCookie(admin.id), hr: sessionCookie(hr.id), manager: sessionCookie(mgr.id), employee: sessionCookie(a1.id) };
      server = createApp().listen(0);
      await new Promise((r) => server.once('listening', r));
      base = `http://127.0.0.1:${server.address().port}`;
    });
    after(() => { if (server) server.close(); });
    const get = async (role, url) => {
      const res = await fetch(base + url, { headers: { cookie: cookies[role], 'x-requested-with': 'AttendancePanel' } });
      return { status: res.status, json: await res.json().catch(() => null) };
    };
    const Q = 'from=2026-08-23&to=2026-09-22&granularity=month&groupBy=user';

    test('کارمند ممنوع (هر دو route)', async () => {
      assert.equal((await get('employee', `/api/admin/analytics/late-trend?${Q}`)).status, 403);
      assert.equal((await get('employee', '/api/admin/analytics/late-compare?year=1405&month=6')).status, 403);
    });
    test('سرپرست فقط تیم خودش؛ userId بیرون از تیم ⇒ ۴۰۳؛ admin/hr همه', async () => {
      const m = await get('manager', `/api/admin/analytics/late-trend?${Q}`);
      assert.equal(m.status, 200);
      assert.deepEqual(m.json.series.map((s) => s.userId).sort(), [a1.id, a2.id].sort());
      assert.equal((await get('manager', `/api/admin/analytics/late-trend?${Q}&userId=${outsider.id}`)).status, 403);
      for (const role of ['admin', 'hr']) {
        const r = await get(role, `/api/admin/analytics/late-trend?${Q}`);
        assert.equal(r.status, 200, role);
        assert.ok(r.json.series.length >= 5, role);
      }
      const c = await get('manager', '/api/admin/analytics/late-compare?year=1405&month=6');
      assert.equal(c.json.current.presentDays, 6); // b1 (تیم دیگر) نیست
    });
    test('پارامتر نامعتبر ⇒ ۴۰۰ با کد', async () => {
      assert.equal((await get('admin', '/api/admin/analytics/late-trend?from=abc')).json.code, 'INVALID_RANGE');
      assert.equal((await get('admin', '/api/admin/analytics/late-trend?granularity=day')).json.code, 'INVALID_GRANULARITY');
      assert.equal((await get('admin', '/api/admin/analytics/late-compare?year=1405&month=13')).json.code, 'INVALID_MONTH');
      assert.equal((await get('admin', '/api/admin/analytics/late-compare?year=1405&month=6&groupBy=zzz')).json.code, 'INVALID_GROUP');
      assert.equal((await get('admin', '/api/admin/analytics/late-trend?userId=abc')).json.code, 'INVALID_USER');
    });
    test('پیش‌فرض بازه: بدون from/to ⇒ ۱۲ هفته‌ی اخیر', async () => {
      const r = await get('admin', '/api/admin/analytics/late-trend');
      assert.equal(r.status, 200);
      assert.equal(r.json.granularity, 'week');
      assert.ok(r.json.buckets.length >= 12 && r.json.buckets.length <= 13);
    });
  });
});

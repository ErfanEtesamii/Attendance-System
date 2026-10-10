// S5-6c: ایندکس‌های migration 022، کش کوتاه‌مدت تحلیل‌ها (TTL، سقف، خطا کش نشود)، جداسازی اسکوپ نقش در کش و پاک‌سازی با نوشتن پنل.
const { resetDb, cleanup } = require('./helpers/testEnv');
process.env.ANALYTICS_CACHE_TTL_SECONDS = '60'; // قبل از require به src (config یک‌بار می‌خواند)
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { getDb } = require('../src/db/connection');
const migration022 = require('../src/db/migrations/022_analytics_indexes');
const { createTtlCache, analyticsCacheKey, analyticsCache } = require('../src/utils/analyticsCache');
const attendanceRepo = require('../src/repositories/attendanceRepository');
const usersRepo = require('../src/repositories/usersRepository');
const { zonedTimeToUtc } = require('../src/utils/time');
const { makeUser, sessionCookie } = require('./helpers/factories');

const at = (date, hhmm) => zonedTimeToUtc(date, hhmm, 'Asia/Tehran').toISOString();
const planOf = (sql, ...args) => getDb().prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args).map((r) => r.detail).join(' | ');

describe('migration 022: ایندکس‌های تحلیل (S5-6c)', () => {
  before(() => resetDb());
  after(cleanup);

  test('ایندکس‌ها ساخته می‌شوند، تکرار migration بی‌خطر است و کوئری استراحت از ایندکس می‌رود', () => {
    const db = getDb();
    const names = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map((r) => r.name);
    for (const n of migration022.indexes) assert.ok(names.includes(n), `${n} باید وجود داشته باشد`);
    assert.doesNotThrow(() => migration022.up(db)); // IF NOT EXISTS
    const brk = planOf('SELECT * FROM break_records WHERE attendance_record_id = ? ORDER BY start_time', 1);
    assert.match(brk, /idx_break_records_attendance/, brk);
    assert.doesNotMatch(brk, /SCAN break_records/, brk);
    const leave = planOf("SELECT * FROM leave_requests lr WHERE lr.user_id = ? AND lr.status = 'approved' AND ? BETWEEN lr.start_date AND lr.end_date", 1, '2026-09-01');
    assert.match(leave, /idx_leave_user_status/, leave); // هر دو ایندکس (user,status…) قابل‌قبول‌اند؛ مهم این‌که SCAN کامل نباشد
    assert.doesNotMatch(leave, /SCAN leave_requests/, leave);
  });
});

describe('کش TTL (واحد)', () => {
  test('hit/miss، انقضا، ۰ = خاموش، سقف ورودی‌ها، و خطا کش نمی‌شود', () => {
    let t = 1000;
    const c = createTtlCache({ ttlMs: 100, maxEntries: 2, now: () => t });
    let calls = 0;
    const compute = () => { calls += 1; return { n: calls }; };
    assert.deepEqual(c.memo('a', compute), { value: { n: 1 }, hit: false, enabled: true });
    assert.equal(c.memo('a', compute).hit, true);
    assert.equal(calls, 1);
    t += 101; // منقضی
    assert.equal(c.memo('a', compute).hit, false);
    assert.equal(calls, 2);
    // سقف ۲: با ورودی سوم، قدیمی‌ترین حذف می‌شود
    c.memo('b', compute); c.memo('c', compute);
    assert.equal(c.size, 2);
    assert.equal(c.get('a'), undefined);
    assert.ok(c.get('c'));
    // خطا ذخیره نمی‌شود و دفعه‌ی بعد دوباره تلاش می‌شود
    assert.throws(() => c.memo('boom', () => { throw new Error('x'); }), /x/);
    assert.equal(c.get('boom'), undefined);
    // clear
    c.clear();
    assert.equal(c.size, 0);
    // TTL صفر = خاموش: همیشه محاسبه، هیچ‌چیز ذخیره نمی‌شود
    const off = createTtlCache({ ttlMs: 0 });
    assert.equal(off.memo('k', compute).enabled, false);
    assert.equal(off.memo('k', compute).hit, false);
    assert.equal(off.size, 0);
    // کلید: مستقل از ترتیب شناسه‌ها/کلیدهای پارامتر؛ وابسته به مجموعه‌ی کاربران، پارامتر و روز
    const k = (ids, params, day = '2026-09-01') => analyticsCacheKey('x', ids, params, day);
    assert.equal(k([3, 1, 2], { a: 1, b: 2 }), k([1, 2, 3], { b: 2, a: 1 }));
    assert.notEqual(k([1, 2], { a: 1 }), k([1, 2, 3], { a: 1 }));
    assert.notEqual(k([1, 2], { a: 1 }), k([1, 2], { a: 2 }));
    assert.notEqual(k([1, 2], { a: 1 }), k([1, 2], { a: 1 }, '2026-09-02'));
  });
});

describe('API: کش، اسکوپ نقش و پاک‌سازی (S5-6c)', () => {
  let server; let base; let cookies; let a1;
  before(async () => {
    resetDb();
    const admin = makeUser({ role: 'admin', name: 'ادمین', department: 'مدیریت' });
    const mgr = makeUser({ role: 'manager', name: 'سرپرست', department: 'فنی' });
    a1 = makeUser({ role: 'employee', managerId: mgr.id, department: 'فنی', name: 'الف' });
    const b1 = makeUser({ role: 'employee', department: 'فروش', name: 'ب' });
    for (const u of usersRepo.listUsers({})) getDb().prepare("UPDATE users SET created_at = '2020-01-01 00:00:00' WHERE id = ?").run(u.id);
    for (const [u, d, inn] of [[a1, '2026-08-23', '08:40'], [a1, '2026-08-24', '08:00'], [b1, '2026-08-23', '09:10']]) {
      attendanceRepo.createManual({ userId: u.id, recordDate: d, checkInTime: at(d, inn), checkOutTime: at(d, '16:30'), status: 'normal' });
    }
    cookies = { admin: sessionCookie(admin.id), manager: sessionCookie(mgr.id) };
    const { createApp } = require('../src/server');
    server = createApp().listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
    analyticsCache.clear();
  });
  after(() => { if (server) server.close(); cleanup(); });

  const get = async (role, url) => {
    const res = await fetch(base + url, { headers: { cookie: cookies[role], 'x-requested-with': 'AttendancePanel' } });
    return { status: res.status, cache: res.headers.get('x-analytics-cache'), json: await res.json().catch(() => null) };
  };
  const LATE = '/api/admin/analytics/late-trend?from=2026-08-23&to=2026-09-22&granularity=month&groupBy=user';
  const RANK = '/api/admin/analytics/rankings?year=1405&month=6&metric=shortfall';

  test('درخواست دوم همان URL از کش می‌آید و پاسخ یکسان است؛ اسکوپ مدیر با admin کش مشترک ندارد', async () => {
    analyticsCache.clear();
    const first = await get('admin', LATE);
    assert.equal(first.status, 200);
    assert.equal(first.cache, 'miss');
    const second = await get('admin', LATE);
    assert.equal(second.cache, 'hit');
    assert.deepEqual(second.json, first.json);
    // سرپرست فقط تیم خودش را می‌بیند؛ نباید ورودی کش admin را بگیرد (اسکوپ نقش)
    const mine = await get('manager', LATE);
    assert.equal(mine.status, 200);
    assert.equal(mine.cache, 'miss');
    assert.deepEqual(mine.json.series.map((s) => s.userId), [a1.id]);
    assert.ok(first.json.series.length > mine.json.series.length);
    assert.equal((await get('manager', LATE)).cache, 'hit');
    // مسیر ماهانه (rankings) هم کش می‌شود و خطای اعتبارسنجی هرگز کش نمی‌شود
    assert.equal((await get('admin', RANK)).cache, 'miss');
    assert.equal((await get('admin', RANK)).cache, 'hit');
    const bad = await get('admin', '/api/admin/analytics/rankings?year=1405&month=6&metric=zzz');
    assert.equal(bad.status, 400);
    assert.equal((await get('admin', '/api/admin/analytics/rankings?year=1405&month=6&metric=zzz')).status, 400);
    assert.equal(analyticsCache.get(analyticsCacheKey('rankings', [], {}, 'x')), undefined);
  });

  test('نوشتن موفق در پنل کش را پاک می‌کند؛ نوشتن ناموفق (۴xx) پاک نمی‌کند', async () => {
    await get('admin', LATE); // پر
    assert.equal((await get('admin', LATE)).cache, 'hit');
    const post = (body) => fetch(`${base}/api/admin/holidays`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: cookies.admin, 'x-requested-with': 'AttendancePanel' }, body: JSON.stringify(body) });
    const bad = await post({});
    assert.ok(bad.status >= 400 && bad.status < 500, `status=${bad.status}`);
    assert.equal((await get('admin', LATE)).cache, 'hit'); // ناموفق ⇒ دست‌نخورده
    const ok = await post({ date: '2026-12-01', title: 'تعطیل تست' });
    assert.ok(ok.status < 400, `status=${ok.status}`);
    assert.equal((await get('admin', LATE)).cache, 'miss'); // موفق ⇒ پاک شد
    assert.equal((await get('admin', LATE)).cache, 'hit');
  });
});

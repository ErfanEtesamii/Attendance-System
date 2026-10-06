// بخش ۲-ب۲: rate limit ماندگار (SQLite)، ثبت throttle‌شده‌ی ۴۲۹ در audit و fallback به حافظه.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');

let hasDeps = true;
try { require.resolve('express'); } catch (_) { hasDeps = false; }
const skip = hasDeps ? false : 'express نصب نیست (npm install)';

const rateLimitRepository = require('../src/repositories/rateLimitRepository');
const auditRepository = require('../src/repositories/auditRepository');
const { createRateLimiter, runCleanup, AUDIT_ACTION } = require('../src/middleware/rateLimiter');
const { closeDb, getDb } = require('../src/db/connection');

// req/res ساختگی؛ نتیجه‌ی middleware را برمی‌گرداند: { passed, status, headers, body }
function call(limiter, { ip = '10.0.0.1', method = 'POST', baseUrl = '/api', path: p = '/admin/auth/code' } = {}) {
  const res = {
    statusCode: 200,
    headers: {},
    set(k, v) { this.headers[k] = v; return this; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  let passed = false;
  limiter({ ip, method, baseUrl, path: p }, res, () => { passed = true; });
  return { passed, status: res.statusCode, headers: res.headers, body: res.body };
}

const auditRows = () => auditRepository.search({ action: AUDIT_ACTION, limit: 1000 });

describe('rateLimitRepository — شمارنده‌ی ماندگار', () => {
  before(() => resetDb());
  after(() => cleanup());

  test('شمارش پیاپی و ریست بعد از پایان پنجره', () => {
    const t0 = 1_000_000;
    assert.equal(rateLimitRepository.hit('L', 'k', 1000, t0).count, 1);
    assert.equal(rateLimitRepository.hit('L', 'k', 1000, t0 + 10).count, 2);
    const third = rateLimitRepository.hit('L', 'k', 1000, t0 + 999);
    assert.equal(third.count, 3);
    assert.equal(third.resetAt, t0 + 1000, 'پایان پنجره با ضربه‌های بعدی جابه‌جا نمی‌شود');
    const after = rateLimitRepository.hit('L', 'k', 1000, t0 + 1000);
    assert.equal(after.count, 1, 'پنجره‌ی جدید از ۱ شروع می‌شود');
    assert.equal(after.resetAt, t0 + 2000);
  });

  test('limiter و کلید مستقل‌اند؛ کلید خیلی بلند بریده می‌شود', () => {
    const t0 = 5_000_000;
    rateLimitRepository.hit('A', 'x', 1000, t0);
    rateLimitRepository.hit('A', 'x', 1000, t0);
    assert.equal(rateLimitRepository.hit('A', 'y', 1000, t0).count, 1);
    assert.equal(rateLimitRepository.hit('B', 'x', 1000, t0).count, 1);
    const long = 'z'.repeat(5000);
    assert.equal(rateLimitRepository.hit('A', long, 1000, t0).count, 1);
    assert.equal(rateLimitRepository.hit('A', long, 1000, t0).count, 2);
    assert.equal(rateLimitRepository.get('A', long).count, 2);
  });

  test('purgeExpired فقط ردیف‌های منقضی را پاک می‌کند', () => {
    const t0 = 9_000_000;
    rateLimitRepository.hit('P', 'old', 100, t0);
    rateLimitRepository.hit('P', 'live', 100_000, t0);
    const removed = rateLimitRepository.purgeExpired(t0 + 1000);
    assert.ok(removed >= 1);
    assert.equal(rateLimitRepository.get('P', 'old'), undefined);
    assert.equal(rateLimitRepository.get('P', 'live').count, 1);
    assert.equal(runCleanup(t0 + 1_000_000) >= 1, true);
  });
});

describe('createRateLimiter — رفتار middleware', { skip }, () => {
  before(() => resetDb());
  after(() => cleanup());

  test('درخواست max+1 → ۴۲۹ با Retry-After و پیام فارسی؛ IPها جدا شمرده می‌شوند', () => {
    const lim = createRateLimiter({ name: 't-basic', windowMs: 60_000, max: 3, message: 'پیام تست' });
    for (let i = 0; i < 3; i += 1) assert.equal(call(lim).passed, true);
    const blocked = call(lim);
    assert.equal(blocked.passed, false);
    assert.equal(blocked.status, 429);
    assert.equal(blocked.body.error, 'پیام تست');
    assert.ok(Number(blocked.headers['Retry-After']) >= 1 && Number(blocked.headers['Retry-After']) <= 60);
    assert.equal(call(lim, { ip: '10.0.0.2' }).passed, true, 'IP دیگر باید آزاد باشد');
  });

  test('limiterهای هم‌نام نیستند → شمارنده‌ی مستقل؛ keyFn سفارشی (آیدی تلگرام) رعایت می‌شود', () => {
    const a = createRateLimiter({ name: 't-a', windowMs: 60_000, max: 1, keyFn: (req) => `miniapp:${req.ip}` });
    const b = createRateLimiter({ name: 't-b', windowMs: 60_000, max: 1 });
    assert.equal(call(a).passed, true);
    assert.equal(call(a).passed, false);
    assert.equal(call(b).passed, true, 'شمارنده‌ی a روی b اثر ندارد');
    assert.ok(rateLimitRepository.get('t-a', 'miniapp:10.0.0.1'), 'کلید سفارشی ذخیره شده');
  });

  test('ماندگاری: بستن و باز کردن دوباره‌ی دیتابیس (شبیه‌سازی ری‌استارت) شمارنده را صفر نمی‌کند', () => {
    const lim = createRateLimiter({ name: 't-persist', windowMs: 60_000, max: 2 });
    assert.equal(call(lim).passed, true);
    assert.equal(call(lim).passed, true);
    closeDb();
    getDb();
    assert.equal(call(lim).status, 429, 'بعد از re-open هنوز مسدود است');
  });
});

describe('ماندگاری بین پروسه‌های جدا (ری‌استارت واقعی)', { skip }, () => {
  before(() => resetDb());
  after(() => cleanup());

  const script = (n) => `
    const { createRateLimiter } = require('./src/middleware/rateLimiter');
    const lim = createRateLimiter({ name: 'proc-test', windowMs: 600000, max: 3 });
    const out = [];
    for (let i = 0; i < ${n}; i++) {
      let status = 200;
      const res = { set() { return this; }, status(c) { status = c; return this; }, json() { return this; } };
      lim({ ip: '10.9.9.9', method: 'POST', baseUrl: '/api', path: '/x' }, res, () => {});
      out.push(status);
    }
    console.log(JSON.stringify(out));
    process.exit(0);`;
  const run = (n) => {
    closeDb(); // دسترسی همزمان دو اتصال لازم نیست؛ پروسه‌ی فرزند تنها نویسنده است
    const r = spawnSync(process.execPath, ['-e', script(n)], { cwd: root, env: process.env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout.trim().split('\n').pop());
  };

  test('پروسه‌ی اول ۳ مجاز، پروسه‌ی دوم (بعد از «ری‌استارت») فوراً ۴۲۹', () => {
    assert.deepEqual(run(3), [200, 200, 200]);
    assert.deepEqual(run(2), [429, 429]);
  });
});

describe('ثبت ۴۲۹ در audit_log (throttle‌شده)', { skip }, () => {
  beforeEach(() => resetDb());
  after(() => cleanup());

  test('برخورد به ۴۲۹ یک رکورد audit با IP و جزئیات بدون query string ثبت می‌کند', () => {
    const lim = createRateLimiter({ name: 't-audit', windowMs: 60_000, max: 1 });
    call(lim, { ip: '10.1.1.1', path: '/admin/auth/token' });
    const r = call(lim, { ip: '10.1.1.1', path: '/admin/auth/token' });
    assert.equal(r.status, 429);
    const rows = auditRows().filter((x) => x.ip_address === '10.1.1.1');
    assert.equal(rows.length, 1);
    const d = JSON.parse(rows[0].details);
    assert.equal(d.limiter, 't-audit');
    assert.equal(d.path, '/api/admin/auth/token');
    assert.equal(d.method, 'POST');
    assert.ok(d.count >= 2);
  });

  test('تکرار ۴۲۹ برای همان کلید در همان پنجره فقط یک بار ثبت می‌شود', () => {
    const lim = createRateLimiter({ name: 't-throttle', windowMs: 60_000, max: 1 });
    for (let i = 0; i < 25; i += 1) call(lim, { ip: '10.2.2.2' });
    assert.equal(auditRows().filter((x) => x.ip_address === '10.2.2.2').length, 1);
    // کلید دیگر جداگانه ثبت می‌شود
    for (let i = 0; i < 3; i += 1) call(lim, { ip: '10.2.2.3' });
    assert.equal(auditRows().filter((x) => x.ip_address === '10.2.2.3').length, 1);
  });

  test('audit:false (مثل csp-report) چیزی ثبت نمی‌کند', () => {
    const lim = createRateLimiter({ name: 't-noaudit', windowMs: 60_000, max: 1, audit: false });
    call(lim, { ip: '10.3.3.3' });
    assert.equal(call(lim, { ip: '10.3.3.3' }).status, 429);
    assert.equal(auditRows().filter((x) => x.ip_address === '10.3.3.3').length, 0);
  });

  test('سقف سراسری: حمله با IPهای زیاد لاگ را پر نمی‌کند (در پروسه‌ی جدا)', () => {
    closeDb();
    const code = `
      const { createRateLimiter } = require('./src/middleware/rateLimiter');
      const audit = require('./src/repositories/auditRepository');
      const lim = createRateLimiter({ name: 'flood', windowMs: 600000, max: 1 });
      for (let i = 0; i < 200; i++) {
        const res = { set() { return this; }, status() { return this; }, json() { return this; } };
        const req = { ip: '10.7.' + Math.floor(i / 250) + '.' + (i % 250), method: 'POST', baseUrl: '/api', path: '/x' };
        lim(req, res, () => {}); lim(req, res, () => {});
      }
      console.log(audit.search({ action: 'rate_limit_exceeded', limit: 1000 }).length);
      process.exit(0);`;
    const r = spawnSync(process.execPath, ['-e', code], { cwd: root, env: process.env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const n = Number(r.stdout.trim().split('\n').pop());
    assert.ok(n > 0 && n <= 30, `باید حداکثر ۳۰ رکورد باشد، شد ${n}`);
  });
});

describe('خطای دیتابیس → fallback به حافظه (نه بازگذاشتن کامل محدودیت)', { skip }, () => {
  before(() => resetDb());
  after(() => cleanup());

  test('اگر repository خطا بدهد، limiter همچنان محدود می‌کند و سرور نمی‌افتد', () => {
    const original = rateLimitRepository.hit;
    const origError = console.error;
    const logged = [];
    console.error = (m) => logged.push(m);
    rateLimitRepository.hit = () => { throw new Error('database is locked'); };
    try {
      const lim = createRateLimiter({ name: 't-fallback', windowMs: 60_000, max: 2, audit: false });
      assert.equal(call(lim).passed, true);
      assert.equal(call(lim).passed, true);
      assert.equal(call(lim).status, 429, 'محدودیت با شمارنده‌ی حافظه ادامه دارد');
    } finally {
      rateLimitRepository.hit = original;
      console.error = origError;
    }
    assert.ok(logged.some((m) => /rate-limit/.test(String(m))), 'خطا لاگ می‌شود');
  });
});

describe('HTTP واقعی: لاگین پنل بعد از ۱۰ تلاش ۴۲۹ و بعد از «ری‌استارت اپ» هنوز ۴۲۹', { skip }, () => {
  let server;
  let base;
  const CSRF = { 'x-requested-with': 'AttendancePanel', 'content-type': 'application/json' };
  const post = (b) => fetch(`${base}/api/admin/auth/code`, { method: 'POST', headers: CSRF, body: JSON.stringify({ code: b }) });
  const start = async () => {
    const { createApp } = require('../src/server');
    server = createApp().listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
  };

  before(async () => { resetDb(); await start(); });
  after(() => { if (server) server.close(); cleanup(); });

  test('۱۰ تلاش ناموفق = ۴۰۱ و تلاش یازدهم = ۴۲۹ + audit؛ بعد از بستن/باز کردن دیتابیس هنوز ۴۲۹', async () => {
    for (let i = 0; i < 10; i += 1) assert.equal((await post('00000000')).status, 401);
    const blocked = await post('00000000');
    assert.equal(blocked.status, 429);
    assert.ok(blocked.headers.get('retry-after'));
    assert.equal(auditRows().length, 1);

    // «ری‌استارت»: سرور و اتصال دیتابیس بسته و دوباره ساخته می‌شوند (فایل دیتابیس همان است)
    await new Promise((r) => server.close(r));
    closeDb();
    await start();
    assert.equal((await post('00000000')).status, 429, 'شمارنده بعد از ری‌استارت صفر نشده');
    assert.equal((await post('00000000')).status, 429);
    assert.equal(auditRows().length, 1, 'ری‌استارت نباید رکورد audit تکراریِ همان پنجره بسازد');
  });
});

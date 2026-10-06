// بخش ۲-الف: هدرهای امنیتی/CSP، کوکی نشست، CSRF و باطل‌کردن نشست‌ها (روی اپ واقعی با پورت تصادفی).
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

let hasDeps = true;
try { require.resolve('express'); } catch (_) { hasDeps = false; }
const skip = hasDeps ? false : 'express نصب نیست (npm install)';

const config = require('../src/config');
const { buildFullCsp, buildBaselineCsp, classifyPath } = require('../src/middleware/securityHeaders');
const { buildSessionCookie, buildClearCookie, SESSION_COOKIE_NAME } = require('../src/utils/sessionCookie');
const { verifySessionToken } = require('../src/utils/session');

describe('CSP — ساخت سیاست (تابع خالص)', () => {
  test('مسیرها درست دسته‌بندی می‌شوند', () => {
    assert.equal(classifyPath('/api/health'), 'api');
    assert.equal(classifyPath('/api'), 'api');
    assert.equal(classifyPath('/admin/'), 'panel');
    assert.equal(classifyPath('/admin/js/core.js'), 'panel');
    assert.equal(classifyPath('/'), 'miniapp');
    assert.equal(classifyPath('/js/app.js'), 'miniapp');
    assert.equal(classifyPath('/administrator'), 'miniapp', 'پیشوند مشابه نباید panel حساب شود');
  });

  test('اسکریپت فقط self و telegram.org؛ بدون unsafe-inline/unsafe-eval به‌صورت پیش‌فرض', () => {
    for (const kind of ['panel', 'miniapp']) {
      const csp = buildFullCsp(kind);
      const script = csp.split('; ').find((d) => d.startsWith('script-src '));
      assert.equal(script, "script-src 'self' https://telegram.org", kind);
      assert.ok(!csp.includes("'unsafe-eval'"));
      assert.ok(csp.includes("object-src 'none'"));
      assert.ok(csp.includes("base-uri 'self'"));
      assert.ok(csp.includes('report-uri /api/csp-report'));
    }
  });

  test('unsafe-eval فقط برای پنل و فقط با پرچم صریح', () => {
    assert.ok(buildFullCsp('panel', { unsafeEval: true }).includes("script-src 'self' https://telegram.org 'unsafe-eval'"));
    assert.ok(!buildFullCsp('miniapp', { unsafeEval: true }).includes('unsafe-eval'));
  });

  test('ویجت تلگرام فقط در پنل frame-src دارد؛ Mini App هیچ iframe ندارد', () => {
    assert.ok(buildFullCsp('panel').includes('frame-src https://oauth.telegram.org'));
    assert.ok(buildFullCsp('miniapp').includes("frame-src 'none'"));
  });

  test('frame-ancestors: تلگرام برای پنل/Mini App مجاز، برای API ممنوع', () => {
    for (const kind of ['panel', 'miniapp']) {
      const fa = buildBaselineCsp(kind);
      assert.ok(fa.includes('https://web.telegram.org') && fa.includes("'self'"), kind);
    }
    assert.ok(buildBaselineCsp('api').includes("frame-ancestors 'none'"));
  });
});

describe('سازگاری فایل‌های استاتیک با CSP (جلوگیری از بازگشت اسکریپت/استایل درون‌خطی)', () => {
  const root = path.join(__dirname, '..');
  const htmlFiles = ['public/index.html', 'public-admin/index.html'];

  test('HTMLها اسکریپت درون‌خطی، تگ <style> و رویداد inline ندارند', () => {
    for (const f of htmlFiles) {
      const html = fs.readFileSync(path.join(root, f), 'utf8');
      const inlineScripts = html.match(/<script\b(?![^>]*\bsrc=)[^>]*>/gi) || [];
      assert.deepEqual(inlineScripts, [], `${f}: اسکریپت درون‌خطی`);
      assert.ok(!/<style\b/i.test(html), `${f}: تگ <style>`);
      assert.ok(!/\son[a-z]+\s*=\s*["']/i.test(html), `${f}: رویداد inline`);
      assert.ok(!/href\s*=\s*["']javascript:/i.test(html), `${f}: javascript: URL`);
    }
  });

  test('جاوااسکریپت‌ها رویداد inline (onclick=...) در HTML تولیدی ندارند و eval/new Function استفاده نمی‌کنند', () => {
    for (const dir of ['public/js', 'public-admin/js']) {
      for (const f of fs.readdirSync(path.join(root, dir))) {
        if (!f.endsWith('.js')) continue;
        const src = fs.readFileSync(path.join(root, dir, f), 'utf8');
        assert.ok(!/\son(click|change|submit|input|load|error)\s*=\s*["'\\`]/i.test(src), `${dir}/${f}: handler inline`);
        assert.ok(!/\beval\s*\(|new Function\s*\(/.test(src), `${dir}/${f}: eval/new Function`);
      }
    }
  });

  test('boot.js وجود دارد و در index پنل بارگذاری می‌شود', () => {
    assert.ok(fs.existsSync(path.join(root, 'public-admin/js/boot.js')));
    assert.ok(fs.readFileSync(path.join(root, 'public-admin/index.html'), 'utf8').includes('/admin/js/boot.js'));
  });
});

describe('کوکی نشست', () => {
  test('ویژگی‌ها: HttpOnly، Path=/، SameSite=Strict، Max-Age', () => {
    const c = buildSessionCookie('tok.en', 3600, { secure: false });
    assert.match(c, new RegExp(`^${SESSION_COOKIE_NAME}=tok\\.en; `));
    for (const part of ['HttpOnly', 'Path=/', 'SameSite=Strict', 'Max-Age=3600']) assert.ok(c.includes(part), part);
  });

  test('Secure روی اتصال TLS یا production؛ در http ساده‌ی توسعه نه', () => {
    assert.ok(!buildSessionCookie('t', 10, { secure: false }).includes('Secure'));
    assert.ok(buildSessionCookie('t', 10, { secure: true }).includes('Secure'));
    const prev = config.nodeEnv;
    config.nodeEnv = 'production';
    try { assert.ok(buildSessionCookie('t', 10, { secure: false }).includes('Secure')); } finally { config.nodeEnv = prev; }
  });

  test('ADMIN_COOKIE_SAMESITE=lax بازگشت اضطراری را ممکن می‌کند', () => {
    const prev = config.adminCookieSameSite;
    config.adminCookieSameSite = 'lax';
    try {
      assert.ok(buildSessionCookie('t', 10, {}).includes('SameSite=Lax'));
      assert.ok(buildClearCookie({}).includes('SameSite=Lax'));
    } finally { config.adminCookieSameSite = prev; }
  });

  test('کوکی پاک‌کردن همان ویژگی‌ها را با Max-Age=0 دارد', () => {
    const c = buildClearCookie({ secure: true });
    for (const part of ['HttpOnly', 'Path=/', 'SameSite=Strict', 'Secure', 'Max-Age=0']) assert.ok(c.includes(part), part);
    assert.match(c, new RegExp(`^${SESSION_COOKIE_NAME}=;`));
  });
});

describe('اپ واقعی: هدرها، CSRF، ابطال نشست', { skip }, () => {
  let server, base, admin, mgr, emp, emp2;
  const { CSRF_HEADERS } = require('./helpers/factories');
  let F; // factories
  let usersRepository, auditRepository, settingsRepository, issueCode;

  before(async () => {
    resetDb();
    F = require('./helpers/factories');
    usersRepository = require('../src/repositories/usersRepository');
    auditRepository = require('../src/repositories/auditRepository');
    settingsRepository = require('../src/repositories/settingsRepository');
    ({ issueCode } = require('../src/utils/panelLoginCodes'));
    admin = F.makeUser({ role: 'admin' });
    mgr = F.makeUser({ role: 'manager' });
    emp = F.makeUser({ role: 'employee', managerId: mgr.id });
    emp2 = F.makeUser({ role: 'employee', managerId: mgr.id });
    const { createApp } = require('../src/server');
    server = createApp().listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => { if (server) server.close(); cleanup(); });

  const req = (method, url, { cookie, headers = {}, body, csrf = true } = {}) =>
    fetch(base + url, {
      method,
      headers: { 'content-type': 'application/json', ...(csrf ? CSRF_HEADERS : {}), ...(cookie ? { cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const json = async (res) => { try { return await res.json(); } catch (_) { return null; } };
  // ورود واقعی با کد یک‌بارمصرف بات؛ کوکی برگشتی را برمی‌گرداند
  async function login(user) {
    const res = await req('POST', '/api/admin/auth/code', { body: { code: issueCode(user.id).code } });
    assert.equal(res.status, 200);
    const raw = res.headers.getSetCookie()[0];
    return { raw, cookie: raw.split(';')[0] };
  }

  // نشست معتبر بدون عبور از rate limit ورود (ده تلاش در ۱۵ دقیقه): توکن با نسخه‌ی فعلی کاربر و epoch فعلی
  function sess(user) {
    const fresh = usersRepository.findById(user.id);
    const cookie = F.sessionCookie(user.id, { sessionVersion: fresh.session_version, globalEpoch: settingsRepository.getGlobalSessionEpoch() });
    return { cookie };
  }

  describe('هدرها', () => {
    test('API: nosniff، no-store، X-Frame-Options، CSP بسته، بدون X-Powered-By و بدون HSTS روی http', async () => {
      const res = await req('GET', '/api/health');
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(res.headers.get('cache-control'), 'no-store');
      assert.equal(res.headers.get('x-frame-options'), 'DENY');
      assert.match(res.headers.get('content-security-policy'), /default-src 'none'.*frame-ancestors 'none'/);
      assert.equal(res.headers.get('x-powered-by'), null);
      assert.equal(res.headers.get('strict-transport-security'), null);
      assert.equal(res.headers.get('referrer-policy'), 'strict-origin');
      assert.match(res.headers.get('permissions-policy'), /geolocation=\(\)/);
    });

    test('پیش‌فرض report-only: سیاست کامل فقط گزارش می‌شود و پایه‌ی frame-ancestors اجباری است', async () => {
      for (const url of ['/', '/admin/']) {
        const res = await fetch(base + url);
        assert.equal(res.status, 200, url);
        const enforced = res.headers.get('content-security-policy');
        const reportOnly = res.headers.get('content-security-policy-report-only');
        assert.match(enforced, /frame-ancestors 'self' https:\/\/web\.telegram\.org/, url);
        assert.ok(!enforced.includes('script-src'), `${url}: سیاست اجباری نباید script-src داشته باشد`);
        assert.match(reportOnly, /script-src 'self' https:\/\/telegram\.org/, url);
        assert.match(reportOnly, /report-uri \/api\/csp-report/);
        assert.equal(res.headers.get('x-frame-options'), null, 'XFO نباید iframe تلگرام وب را ببندد');
      }
    });

    test('CSP_MODE=enforce: سیاست کامل اجباری و بدون Report-Only', async () => {
      const prev = config.cspMode;
      config.cspMode = 'enforce';
      try {
        const res = await fetch(base + '/admin/');
        assert.match(res.headers.get('content-security-policy'), /script-src 'self' https:\/\/telegram\.org/);
        assert.equal(res.headers.get('content-security-policy-report-only'), null);
      } finally { config.cspMode = prev; }
    });

    test('CSP_MODE=off: فقط سیاست پایه', async () => {
      const prev = config.cspMode;
      config.cspMode = 'off';
      try {
        const res = await fetch(base + '/');
        assert.ok(!res.headers.get('content-security-policy').includes('script-src'));
        assert.equal(res.headers.get('content-security-policy-report-only'), null);
      } finally { config.cspMode = prev; }
    });

    test('گزارش CSP: بدون احراز ۲۰۴؛ قالب‌های report-uri و Reporting API؛ ورودی خراب بی‌خطر', async () => {
      const post = (type, body) => fetch(base + '/api/csp-report', { method: 'POST', headers: { 'content-type': type }, body: JSON.stringify(body) });
      assert.equal((await post('application/csp-report', { 'csp-report': { 'violated-directive': 'script-src', 'blocked-uri': 'https://x.test/a.js' } })).status, 204);
      assert.equal((await post('application/reports+json', [{ type: 'csp-violation', body: { effectiveDirective: 'img-src', blockedURL: 'https://y.test/i.png' } }])).status, 204);
      assert.equal((await post('application/csp-report', { random: 1 })).status, 204);
    });
  });

  describe('کوکی ورود واقعی', () => {
    test('ورود: کوکی HttpOnly + SameSite=Strict و توکن حاوی sv و ge', async () => {
      const { raw, cookie } = await login(emp);
      assert.ok(raw.includes('HttpOnly') && raw.includes('SameSite=Strict') && raw.includes('Path=/'));
      const token = decodeURIComponent(cookie.slice(SESSION_COOKIE_NAME.length + 1));
      const payload = verifySessionToken(token, config.adminSessionSecret);
      assert.equal(payload.userId, emp.id);
      assert.equal(payload.sv, 0);
      assert.equal(payload.ge, settingsRepository.getGlobalSessionEpoch());
      assert.equal((await req('GET', '/api/admin/me', { cookie })).status, 200);
    });
  });

  describe('CSRF', () => {
    let cookie;
    before(async () => { cookie = F.sessionCookie(admin.id); });
    const writeCall = (opts) => req('POST', '/api/admin/broadcast', { cookie, body: { scope: 'bad', text: 'x' }, ...opts });
    // scope نامعتبر ← اگر CSRF رد نکند، به ۴۰۰ منطق route می‌رسد (نه ۴۰۳)

    test('بدون هدر سفارشی ← ۴۰۳ CSRF (حتی با سشن معتبر)', async () => {
      const res = await writeCall({ csrf: false });
      assert.equal(res.status, 403);
      assert.equal((await json(res)).code, 'CSRF');
    });

    test('هدر درست + Origin هم‌میزبان ← عبور از CSRF', async () => {
      const res = await writeCall({ headers: { origin: base } });
      assert.equal(res.status, 400);
    });

    test('Origin بیگانه، null یا نامعتبر ← ۴۰۳', async () => {
      for (const origin of ['https://evil.example', 'null', 'not a url', 'http://127.0.0.1:1']) {
        const res = await writeCall({ headers: { origin } });
        assert.equal(res.status, 403, origin);
        assert.equal((await json(res)).code, 'CSRF');
      }
    });

    test('بدون Origin: Referer بیگانه ← ۴۰۳؛ Referer هم‌میزبان یا هیچ‌کدام ← عبور', async () => {
      assert.equal((await writeCall({ headers: { referer: 'https://evil.example/page' } })).status, 403);
      assert.equal((await writeCall({ headers: { referer: `${base}/admin/` } })).status, 400);
      assert.equal((await writeCall({})).status, 400);
    });

    test('CSRF_EXTRA_ORIGINS: Origin فهرست‌شده مجاز می‌شود', async () => {
      config.csrfExtraOrigins.push('https://panel.example.test');
      try {
        assert.equal((await writeCall({ headers: { origin: 'https://panel.example.test' } })).status, 400);
      } finally { config.csrfExtraOrigins.pop(); }
    });

    test('درخواست‌های خواندنی (GET) هدر نمی‌خواهند', async () => {
      assert.equal((await req('GET', '/api/admin/me', { cookie, csrf: false })).status, 200);
    });

    test('PUT/PATCH/DELETE هم محافظت می‌شوند', async () => {
      for (const m of ['PATCH', 'DELETE', 'PUT']) {
        const res = await req(m, `/api/admin/users/${emp2.id}`, { cookie, csrf: false });
        assert.equal(res.status, 403, m);
        assert.equal((await json(res)).code, 'CSRF');
      }
    });

    test('مسیرهای ورود/خروج هم CSRF دارند؛ Mini App (کوکی‌محور نیست) مشمول نیست', async () => {
      const login403 = await req('POST', '/api/admin/auth/code', { csrf: false, body: { code: '00000000' } });
      assert.equal(login403.status, 403);
      assert.equal((await req('POST', '/api/admin/auth/logout', { cookie, csrf: false })).status, 403);
      const mini = await req('POST', '/api/miniapp/check-in', { csrf: false });
      assert.notEqual((await json(mini))?.code, 'CSRF');
    });
  });

  describe('باطل‌کردن نشست', () => {
    test('توکن قدیمی بدون sv/ge تا قبل از اولین ابطال معتبر است (سازگاری با نشست‌های موجود)', async () => {
      const u = F.makeUser({ role: 'employee', managerId: mgr.id });
      assert.equal((await req('GET', '/api/admin/me', { cookie: F.sessionCookie(u.id) })).status, 200);
    });

    test('غیرفعال‌شدن کاربر ← درخواست بعدی ۴۰۱ + پاک‌شدن کوکی؛ فعال‌سازی دوباره نشست قدیمی را زنده نمی‌کند', async () => {
      const u = F.makeUser({ role: 'employee', managerId: mgr.id });
      const { cookie } = sess(u);
      assert.equal((await req('GET', '/api/admin/me', { cookie })).status, 200);

      const adminCookie = F.sessionCookie(admin.id);
      const off = await req('PATCH', `/api/admin/users/${u.id}`, { cookie: adminCookie, body: { isActive: false } });
      assert.equal(off.status, 200);

      const after = await req('GET', '/api/admin/me', { cookie });
      assert.equal(after.status, 401);
      assert.equal((await json(after)).code, 'SESSION_REVOKED');
      assert.match(after.headers.getSetCookie()[0], /Max-Age=0/);

      await req('PATCH', `/api/admin/users/${u.id}`, { cookie: adminCookie, body: { isActive: true } });
      assert.equal((await req('GET', '/api/admin/me', { cookie })).status, 401, 'کوکی قدیمی بعد از فعال‌سازی هم باطل می‌ماند');
      const fresh = await login(u);
      assert.equal((await req('GET', '/api/admin/me', { cookie: fresh.cookie })).status, 200);
    });

    test('تغییر نقش و تغییر آیدی تلگرام ← نشست باطل؛ تغییر نام/دپارتمان/سرپرست ← نشست سالم', async () => {
      const adminCookie = F.sessionCookie(admin.id);
      const u = F.makeUser({ role: 'employee', managerId: mgr.id });
      const { cookie } = sess(u);

      for (const patch of [{ fullName: 'نام جدید' }, { department: 'واحد دیگر' }, { managerId: null }, { personnelCode: `PC${u.id}x` }]) {
        assert.equal((await req('PATCH', `/api/admin/users/${u.id}`, { cookie: adminCookie, body: patch })).status, 200);
        assert.equal((await req('GET', '/api/admin/me', { cookie })).status, 200, JSON.stringify(patch));
      }
      await req('PATCH', `/api/admin/users/${u.id}`, { cookie: adminCookie, body: { role: 'manager' } });
      assert.equal((await req('GET', '/api/admin/me', { cookie })).status, 401, 'تغییر نقش');

      const u2 = F.makeUser({ role: 'employee', managerId: mgr.id });
      const l2 = sess(u2);
      await req('PATCH', `/api/admin/users/${u2.id}`, { cookie: adminCookie, body: { telegramUserId: '5550001' } });
      assert.equal((await req('GET', '/api/admin/me', { cookie: l2.cookie })).status, 401, 'تغییر telegram_user_id');
    });

    test('ارسال مقدار یکسان (بدون تغییر واقعی) نشست را باطل نمی‌کند', async () => {
      const adminCookie = F.sessionCookie(admin.id);
      const u = F.makeUser({ role: 'employee', managerId: mgr.id });
      const { cookie } = sess(u);
      const same = usersRepository.findById(u.id);
      await req('PATCH', `/api/admin/users/${u.id}`, { cookie: adminCookie, body: { isActive: true, role: same.role, telegramUserId: same.telegram_user_id } });
      assert.equal((await req('GET', '/api/admin/me', { cookie })).status, 200);
    });

    test('revoke-sessions: فقط ادمین، دلیل اجباری، audit، و کاربر هدف ۴۰۱ می‌شود', async () => {
      const u = F.makeUser({ role: 'employee', managerId: mgr.id });
      const { cookie } = sess(u);
      const adminCookie = F.sessionCookie(admin.id);
      const url = `/api/admin/users/${u.id}/revoke-sessions`;

      assert.equal((await req('POST', url, { cookie: F.sessionCookie(mgr.id), body: { reason: 'x' } })).status, 403, 'سرپرست');
      assert.equal((await req('POST', url, { cookie, body: { reason: 'x' } })).status, 403, 'کارمند');
      assert.equal((await req('POST', url, { body: { reason: 'x' } })).status, 401, 'بدون سشن');
      assert.equal((await req('POST', url, { cookie: adminCookie, body: {} })).status, 400, 'بدون دلیل');
      assert.equal((await req('POST', '/api/admin/users/999999/revoke-sessions', { cookie: adminCookie, body: { reason: 'x' } })).status, 404);
      assert.equal((await req('GET', '/api/admin/me', { cookie })).status, 200, 'تا اینجا هنوز سالم');

      const ok = await req('POST', url, { cookie: adminCookie, body: { reason: 'گوشی گم شد' } });
      assert.equal(ok.status, 200);
      assert.equal((await json(ok)).selfLoggedOut, false);
      assert.equal((await req('GET', '/api/admin/me', { cookie })).status, 401);
      assert.equal((await req('GET', '/api/admin/me', { cookie: adminCookie })).status, 200, 'ادمین اجراکننده سالم می‌ماند');

      const row = auditRepository.search({ action: 'user_sessions_revoked', limit: 5 })[0];
      assert.ok(row, 'audit ثبت شود');
      const d = JSON.parse(row.details);
      assert.equal(d.targetUserId, u.id);
      assert.equal(d.reason, 'گوشی گم شد');
      assert.equal(row.user_id, admin.id);
    });

    test('revoke-sessions روی خود ادمین: خودش هم خارج می‌شود و کوکی پاک می‌شود', async () => {
      const a2 = F.makeUser({ role: 'admin' });
      const { cookie } = sess(a2);
      const res = await req('POST', `/api/admin/users/${a2.id}/revoke-sessions`, { cookie, body: { reason: 'تست' } });
      assert.equal(res.status, 200);
      assert.equal((await json(res)).selfLoggedOut, true);
      assert.match(res.headers.getSetCookie()[0], /Max-Age=0/);
      assert.equal((await req('GET', '/api/admin/me', { cookie })).status, 401);
    });

    test('revoke-all-sessions: دلیل اجباری، فقط ادمین؛ همه ۴۰۱ جز ادمین اجراکننده که کوکی تازه می‌گیرد', async () => {
      const a2 = F.makeUser({ role: 'admin' });
      const u = F.makeUser({ role: 'employee', managerId: mgr.id });
      const m = F.makeUser({ role: 'manager' });
      const lu = sess(u);
      const lm = sess(m);
      const la = sess(a2);

      assert.equal((await req('POST', '/api/admin/system/revoke-all-sessions', { cookie: lm.cookie, body: { reason: 'x' } })).status, 403);
      assert.equal((await req('POST', '/api/admin/system/revoke-all-sessions', { cookie: la.cookie, body: {} })).status, 400);

      const before = settingsRepository.getGlobalSessionEpoch();
      const res = await req('POST', '/api/admin/system/revoke-all-sessions', { cookie: la.cookie, body: { reason: 'چرخش راز' } });
      assert.equal(res.status, 200);
      assert.equal(settingsRepository.getGlobalSessionEpoch(), before + 1);

      assert.equal((await req('GET', '/api/admin/me', { cookie: lu.cookie })).status, 401);
      assert.equal((await req('GET', '/api/admin/me', { cookie: lm.cookie })).status, 401);
      assert.equal((await req('GET', '/api/admin/me', { cookie: la.cookie })).status, 401, 'کوکی قدیمی ادمین هم باطل است');
      const renewed = res.headers.getSetCookie()[0].split(';')[0];
      assert.equal((await req('GET', '/api/admin/me', { cookie: renewed })).status, 200, 'کوکی تازه‌ی ادمین کار می‌کند');
      assert.ok(auditRepository.search({ action: 'all_sessions_revoked', limit: 1 }).length === 1);

      const lu2 = await login(u); // ورود واقعی دوباره بعد از ابطال کار می‌کند
      assert.equal((await req('GET', '/api/admin/me', { cookie: lu2.cookie })).status, 200);
    });

    test('revoke-all-sessions با includeSelf=true ادمین را هم خارج می‌کند', async () => {
      const a3 = F.makeUser({ role: 'admin' });
      const { cookie } = sess(a3);
      const res = await req('POST', '/api/admin/system/revoke-all-sessions', { cookie, body: { reason: 'تست', includeSelf: true } });
      assert.equal(res.status, 200);
      assert.match(res.headers.getSetCookie()[0], /Max-Age=0/);
      assert.equal((await req('GET', '/api/admin/me', { cookie })).status, 401);
    });

    test('epoch سراسری از صفحه‌ی تنظیمات قابل خواندن/نوشتن نیست', async () => {
      const res = await req('GET', '/api/admin/settings', { cookie: sess(admin).cookie }); // epoch قبلاً بالا رفته؛ توکن تازه لازم است
      assert.equal(res.status, 200);
      assert.ok(!JSON.stringify(await json(res)).includes('session_epoch'));
    });
  });
});

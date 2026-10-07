// S4-6a: UI زنگوله‌ی اعلان (public-admin/js/bell.js).
// core.js و views-*.js و bell.js واقعی داخل vm اجرا می‌شوند (DOM ساختگی ساده) و با سرور واقعی (createApp) حرف می‌زنند؛
// پس شمارنده، فهرست، علامت خوانده‌شدن، لینک عمیق و اسکوپ «فقط اعلان‌های خودش» با هم تست می‌شوند.
// تست دستی مرورگر (ظاهر پنل کشویی، RTL، موبایل، توقف polling در تب پنهان) در گزارش S4-6a آمده است.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let hasDeps = true;
try { require.resolve('express'); } catch (_) { hasDeps = false; }

const JS_DIR = path.join(__dirname, '..', 'public-admin', 'js');
const PANEL_FILES = ['jalali.js', 'core.js', 'views-main.js', 'views-ops.js', 'views-admin.js', 'views-shifts.js', 'bell.js']; // boot.js عمداً نه

function makeEl() {
  const cls = new Set();
  const attrs = {};
  const handlers = {};
  return {
    innerHTML: '', textContent: '', value: '', disabled: false, style: {},
    classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c), toggle: (c, f) => { if (f === undefined ? !cls.has(c) : f) cls.add(c); else cls.delete(c); } },
    setAttribute(k, v) { attrs[k] = String(v); },
    getAttribute(k) { return k in attrs ? attrs[k] : null; },
    removeAttribute(k) { delete attrs[k]; },
    addEventListener(t, f) { (handlers[t] = handlers[t] || []).push(f); },
    fire(t, ev = {}) { (handlers[t] || []).forEach((f) => f(ev)); },
    appendChild() {}, remove() {}, focus() {},
    querySelector: () => null, querySelectorAll: () => [],
  };
}

// پنل واقعی بدون مرورگر؛ fetch قابل تعویض (سرور واقعی یا stub)
function loadPanel(fetchImpl) {
  const els = new Map();
  const $ = (sel) => { if (!els.has(sel)) els.set(sel, makeEl()); return els.get(sel); };
  const docHandlers = {};
  const unref = (t) => { if (t && t.unref) t.unref(); return t; }; // polling واقعی جلوی خروج پروسه‌ی تست را نگیرد
  const sandbox = {
    document: {
      hidden: false,
      querySelector: $, querySelectorAll: () => [], createElement: makeEl,
      addEventListener(t, f) { (docHandlers[t] = docHandlers[t] || []).push(f); },
    },
    console, URL, URLSearchParams,
    setTimeout: (f, ms) => unref(setTimeout(f, ms)), clearTimeout,
    location: { href: 'http://x.test/admin/', hash: '', reload() {} },
    history: { replaceState() {} },
    scrollTo() {},
    addEventListener() {},
    fetch: fetchImpl,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const f of PANEL_FILES) vm.runInContext(fs.readFileSync(path.join(JS_DIR, f), 'utf8'), sandbox, { filename: f });
  return { AP: sandbox.AP, win: sandbox, doc: sandbox.document, docHandlers, $ };
}

async function waitFor(cond, label) {
  for (let i = 0; i < 400; i += 1) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`زمان انتظار تمام شد: ${label}`);
}
const flush = () => new Promise((r) => setImmediate(r));

describe('توابع خالص زنگوله (S4-6a)', () => {
  const { AP } = loadPanel(() => { throw new Error('fetch نباید صدا زده شود'); });

  test('parseLink فقط hash-route داخلی را می‌پذیرد (javascript:، آدرس خارجی و مسیرهای مشکوک ردّ)؛ formatCount ارقام فارسی و سقف «۹۹+»', () => {
    const p = AP.bell.parseLink;
    assert.deepEqual({ ...p('#/leave') }, { id: 'leave', param: null });
    assert.deepEqual({ ...p('#/profile/12') }, { id: 'profile', param: '12' });
    assert.deepEqual({ ...p('/admin/#/disputes') }, { id: 'disputes', param: null });
    assert.deepEqual({ ...p('  #/leave  ') }, { id: 'leave', param: null });
    for (const bad of [
      'javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'https://evil.test/#/leave', '//evil.test/#/leave', 'http://x.test/admin/#/leave',
      '#/Leave', '#/leave/../system', '#/leave/a/b', '#/leave/<script>', '#/', '#', '', '/leave', '#/leave?x=1', '#/1leave',
      null, undefined, 42, {}, ['#/leave'],
    ]) assert.equal(p(bad), null, `باید رد شود: ${JSON.stringify(bad)}`);

    // formatCount: ارقام فارسی، صفر/نامعتبر ⇒ ۰، بیش از ۹۹ ⇒ «۹۹+»
    const f = AP.bell.formatCount;
    assert.equal(f(0), '۰');
    assert.equal(f(7), '۷');
    assert.equal(f(99), '۹۹');
    assert.equal(f(100), '۹۹+');
    assert.equal(f(5000), '۹۹+');
    for (const bad of [-3, NaN, undefined, null, 'x']) assert.equal(f(bad), '۰');
  });

  test('polling: ۳۰ تا ۶۰ ثانیه؛ بدون هم‌پوشانی؛ با تب پنهان قطع و با برگشتن فوراً ادامه؛ stop همه‌چیز را قطع می‌کند', async () => {
    assert.ok(AP.bell.POLL_MS >= 30000 && AP.bell.POLL_MS <= 60000, 'بازه‌ی مجاز ۳۰ تا ۶۰ ثانیه');
    const timers = [];
    const setTimer = (f, ms) => { const t = { f, ms, cleared: false }; timers.push(t); return t; };
    const clearTimer = (t) => { t.cleared = true; };
    const live = () => timers.filter((t) => !t.cleared && !t.fired);
    let hidden = false;
    let ticks = 0;
    const fire = async (t) => { t.fired = true; await t.f(); };

    const p = AP.bell.createPoller({ tick: async () => { ticks += 1; }, isHidden: () => hidden, setTimer, clearTimer });
    p.start();
    await flush();
    assert.equal(ticks, 1, 'اولین tick فوری است');
    assert.equal(live().length, 1);
    assert.equal(live()[0].ms, AP.bell.POLL_MS);
    p.start(); // start دوباره بی‌اثر
    await flush();
    assert.equal(ticks, 1);

    await fire(live()[0]);
    assert.equal(ticks, 2);
    assert.equal(live().length, 1, 'دور بعد چیده شد');

    hidden = true;
    p.visibilityChanged();
    assert.equal(live().length, 0, 'تب پنهان ⇒ زمان‌بند قطع');
    assert.equal(p.isScheduled(), false);
    assert.equal(ticks, 2, 'در تب پنهان هیچ درخواستی نمی‌رود');

    hidden = false;
    p.visibilityChanged();
    await flush();
    assert.equal(ticks, 3, 'برگشتن به تب ⇒ فوراً یک tick');
    assert.equal(live().length, 1);

    p.stop();
    assert.equal(live().length, 0);
    hidden = true; hidden = false;
    p.visibilityChanged();
    await flush();
    assert.equal(ticks, 3, 'بعد از stop هیچ‌چیز دوباره راه نمی‌افتد');

    // tick کند + پنهان/نمایان شدن وسط آن ⇒ tick دوم هم‌زمان اجرا نشود
    let release;
    let slowTicks = 0;
    const before = timers.length;
    const slow = AP.bell.createPoller({ tick: () => { slowTicks += 1; return new Promise((r) => { release = r; }); }, isHidden: () => hidden, setTimer, clearTimer });
    slow.start();
    await flush();
    assert.equal(slowTicks, 1);
    hidden = true; slow.visibilityChanged();
    hidden = false; slow.visibilityChanged();
    await flush();
    assert.equal(slowTicks, 1, 'تا پایان tick قبلی tick جدیدی شروع نمی‌شود');
    assert.equal(timers.length, before, 'و هنوز دوری چیده نشده');
    release();
    await flush(); await flush();
    assert.equal(timers.length, before + 1, 'پس از پایان tick دقیقاً یک دور چیده می‌شود');
    slow.stop();

    // tick خطادار polling را نمی‌کشد
    const errPoller = AP.bell.createPoller({ tick: async () => { throw new Error('شبکه'); }, isHidden: () => false, setTimer, clearTimer });
    const n0 = live().length;
    errPoller.start();
    await flush(); await flush();
    assert.equal(live().length, n0 + 1, 'با وجود خطا دور بعد چیده شد');
    errPoller.stop();
  });
});

describe('زنگوله‌ی پنل با سرور واقعی (S4-6a)', { skip: hasDeps ? false : 'express نصب نیست (npm install)' }, () => {
  let server; let base; let cookies; let users; let notify; let db;
  const panels = [];

  before(async () => {
    db = resetDb();
    const f = require('./helpers/factories');
    ({ notify } = require('../src/services/notificationService'));
    const { createApp } = require('../src/server');
    const mgr = f.makeUser({ role: 'manager' });
    users = { employee: f.makeUser({ role: 'employee', managerId: mgr.id }), other: f.makeUser({ role: 'employee' }), manager: mgr };
    cookies = Object.fromEntries(Object.entries(users).map(([k, u]) => [k, f.sessionCookie(u.id)]));
    server = createApp().listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => { panels.forEach((p) => p.AP.bell.stop()); if (server) server.close(); cleanup(); });

  function panelFor(role) {
    const p = loadPanel((u, o = {}) => fetch(base + u, { ...o, headers: { ...(o.headers || {}), cookie: cookies[role] } }));
    panels.push(p);
    return p;
  }
  async function bootPanel(role) {
    const p = panelFor(role);
    await p.AP.boot();
    await waitFor(() => p.$('#side-nav').innerHTML && !p.$('#page').innerHTML.includes('spinner'), 'بالا آمدن پنل');
    return p;
  }
  const unreadInDb = (u) => db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(u.id).n;
  const add = (u, title, extra = {}) => notify(u.id, { type: 'system_alert', title, ...extra }).then((r) => r.notification);

  test('شمارنده با ارقام فارسی، پنل کشویی با فهرست «فقط خودش»، escape کامل متن؛ بدون اعلان ⇒ حالت خالی', async () => {
    const xss = await add(users.employee, '<img src=x onerror=alert(1)>', { body: '<script>alert(2)</script>', link: '#/leave' });
    await add(users.employee, 'لینک خطرناک', { link: 'javascript:alert(1)' });
    await add(users.employee, 'صفحه‌ی بی‌مجوز', { link: '#/system' });
    await add(users.employee, 'بدون لینک');
    await add(users.other, 'اعلان محرمانه‌ی دیگری');
    assert.ok(xss.id);

    const { AP, $ } = await bootPanel('employee');
    assert.equal($('#bell-btn').classList.contains('hidden'), false, 'زنگوله برای کاربر دارای مجوز نمایان است');
    await waitFor(() => $('#bell-count').textContent === '۴' && !$('#bell-count').classList.contains('hidden'), 'شمارنده‌ی اولیه');
    assert.match($('#bell-btn').getAttribute('aria-label'), /۴ خوانده‌نشده/);

    assert.equal($('#bell-drawer').classList.contains('open'), false);
    AP.bell.open();
    assert.equal($('#bell-drawer').classList.contains('open'), true);
    assert.equal($('#bell-btn').getAttribute('aria-expanded'), 'true');
    assert.equal($('#bell-drawer').getAttribute('aria-hidden'), 'false');
    await waitFor(() => AP.bell.state.items.length === 4, 'فهرست');

    const html = $('#bell-list').innerHTML;
    assert.doesNotMatch(html, /<img/i, 'تگ HTML از عنوان نباید خام وارد شود');
    assert.doesNotMatch(html, /<script/i);
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.doesNotMatch(html, /محرمانه/, 'اعلان دیگران هرگز دیده نمی‌شود');
    assert.equal((html.match(/data-act="read"/g) || []).length, 4, 'برای هر اعلان خوانده‌نشده دکمه‌ی علامت');
    assert.doesNotMatch(html, /<[^>]*\son[a-z]+\s*=/i, 'handler درون‌خطی داخل تگ‌ها ندارد (متن escapeشده‌ی عنوان مستثناست)');

    AP.bell.close();
    assert.equal($('#bell-drawer').classList.contains('open'), false);
    assert.equal($('#bell-btn').getAttribute('aria-expanded'), 'false');

    // کاربر بدون اعلان: حالت خالی و شمارنده‌ی پنهان
    const empty = await bootPanel('manager');
    await waitFor(() => empty.AP.bell.state.unread === 0 && empty.$('#bell-count').textContent === '۰', 'شمارنده‌ی صفر');
    assert.equal(empty.$('#bell-count').classList.contains('hidden'), true);
    empty.AP.bell.open();
    await waitFor(() => /اعلانی ندارید/.test(empty.$('#bell-list').innerHTML), 'حالت خالی');
    assert.equal(empty.$('#bell-more').classList.contains('hidden'), true);
  });

  test('کلیک اعلان: خوانده می‌شود؛ لینک معتبر و مجاز ⇒ ناوبری؛ لینک نامعتبر/بی‌مجوز ⇒ توست و بدون ناوبری؛ علامت‌زدن همه', async () => {
    const { AP, win, $ } = await bootPanel('employee');
    await waitFor(() => AP.bell.state.unread === 4, 'شمارنده');
    AP.bell.open();
    await waitFor(() => AP.bell.state.items.length === 4, 'فهرست');
    const byTitle = (t) => AP.bell.state.items.find((n) => n.title === t);
    const hashBefore = win.location.hash;

    // لینک javascript: ⇒ ردّ، ولی اعلان خوانده شده حساب می‌شود
    const bad = byTitle('لینک خطرناک');
    assert.equal(AP.bell.openItem(bad.id), false);
    assert.match($('#toast').textContent, /نامعتبر/);
    assert.equal(win.location.hash, hashBefore, 'ناوبری انجام نشد');
    await waitFor(() => AP.bell.state.unread === 3 && bad.isRead, 'خواندن اعلان با لینک خراب');
    assert.equal($('#bell-count').textContent, '۳');

    // صفحه‌ی مجاز نیست (کارمند system ندارد)
    const denied = byTitle('صفحه‌ی بی‌مجوز');
    assert.equal(AP.viewAllowed(AP.views.system), false);
    assert.equal(AP.bell.openItem(denied.id), false);
    assert.match($('#toast').textContent, /دسترسی ندارید/);
    assert.equal(win.location.hash, hashBefore);
    await waitFor(() => AP.bell.state.unread === 2, 'خواندن اعلان بی‌مجوز');

    // لینک معتبر ⇒ پنل بسته و رفتن به صفحه
    const ok = byTitle('<img src=x onerror=alert(1)>');
    assert.equal(AP.bell.openItem(ok.id), true);
    assert.equal(win.location.hash, '#/leave');
    assert.equal($('#bell-drawer').classList.contains('open'), false, 'بعد از ناوبری پنل بسته می‌شود');
    await waitFor(() => AP.bell.state.unread === 1, 'خواندن اعلان لینک‌دار');
    assert.equal(unreadInDb(users.employee), 1, 'وضعیت در دیتابیس هم ثبت شده');

    // علامت‌زدن همه
    AP.bell.open();
    await waitFor(() => !AP.bell.state.loading, 'بارگذاری مجدد');
    assert.equal(await AP.bell.markAll(), true);
    assert.equal(AP.bell.state.unread, 0);
    assert.equal($('#bell-count').classList.contains('hidden'), true);
    assert.equal(unreadInDb(users.employee), 0);
    assert.equal(AP.bell.state.items.every((n) => n.isRead), true);
    assert.equal($('#bell-mark-all').disabled, true, 'با صفر خوانده‌نشده دکمه‌ی «خواندن همه» غیرفعال است');
    assert.equal(unreadInDb(users.other), 1, 'اعلان کاربر دیگر دست‌نخورده می‌ماند');
  });

  test('polling واقعی: اعلان تازه با دور بعد شمارنده را بالا می‌برد و پنل بازِ باز فهرست را تازه می‌کند؛ بدون مجوز هیچ درخواستی نمی‌رود', async () => {
    const { AP, $ } = await bootPanel('employee');
    await waitFor(() => AP.bell.state.unread === 0 && $('#bell-count').textContent === '۰', 'شمارنده‌ی اولیه');
    AP.bell.open();
    await waitFor(() => !AP.bell.state.loading, 'بارگذاری');
    await add(users.employee, 'اعلان تازه از polling');
    await AP.bell.refresh(); // معادل یک دور polling
    assert.equal(AP.bell.state.unread, 1);
    assert.equal($('#bell-count').textContent, '۱');
    await waitFor(() => AP.bell.state.items.some((n) => n.title === 'اعلان تازه از polling'), 'تازه‌شدن فهرست باز');
    assert.match($('#bell-list').innerHTML, /اعلان تازه از polling/);

    // بدون مجوز notifications.read: init بی‌اثر است و هیچ fetchی نمی‌رود
    let calls = 0;
    const p = loadPanel(() => { calls += 1; return Promise.reject(new Error('نباید صدا زده شود')); });
    panels.push(p);
    p.AP.state.perms = new Set(['dashboard.read']);
    p.AP.bell.init();
    p.$('#bell-btn').fire('click');
    await flush();
    assert.equal(calls, 0);
    assert.equal(p.AP.bell.state.open, false);
  });
});

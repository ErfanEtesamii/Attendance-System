// R4 (فاز ۱۴): رابط Mini App دورکاری — دیالوگ، view-remote، بنر ثابت، نوار پایین، OUT_OF_NETWORK و اجرای واقعی boot با DOM ساختگی.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const S = require('../public/js/states.js');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');
const html = read('public/index.html');
const app = read('public/js/app.js');
const css = read('public/css/style.css');
const BANNER = 'این ساعت‌ها تا زمانی که سرپرست بررسی و لحاظ نکند، تأیید نمی‌شوند و در گزارش و حقوق شما حساب نخواهند شد.';
const MSG = 'شما در فرازهنر حضور ندارید. می‌توانید ساعت خود را به‌عنوان دورکار ثبت کنید و پس از بررسی سرپرست مربوطه، در آخر هفته ساعتتان لحاظ می‌شود.';

const remoteBlock = () => app.slice(app.indexOf('// ---------- دورکاری (R4، فاز ۱۴) ----------'), app.indexOf('// ---------- پروفایل و اعتراض ----------'));

describe('نشانه‌گذاری (R4)', () => {
  test('نمای دورکاری و تاریخچه: aria-labelledby، عنوان قابل‌فوکوس، فهرست‌ها و کنترل‌های اقدام', () => {
    assert.match(html, /<section id="view-remote" class="view hidden" aria-labelledby="remote-title">/);
    assert.match(html, /id="remote-title" tabindex="-1"/);
    assert.match(html, /id="remote-actions"/);
    assert.match(html, /<section id="view-remote-history" class="view hidden" aria-labelledby="remote-history-title">/);
    assert.match(html, /id="remote-history-list"/);
  });
  test('بنر ثابت: متن دقیق، role=note، بدون دکمه‌ی بستن و بدون style/on* درون‌خطی', () => {
    const m = html.match(/<div class="card remote-banner" id="remote-banner" role="note">([\s\S]*?)<\/div>/);
    assert.ok(m, 'بنر نیست');
    assert.ok(m[1].includes(BANNER));
    assert.doesNotMatch(m[1], /<button|\sstyle=|\son[a-z]+=/i);
  });
  test('نوار پایین: دو آیتم مخصوص دورکاری با data-scope؛ صفحه‌ی ساده‌ی خارج از شبکه', () => {
    assert.match(html, /<button class="nav-btn" data-view="remote" data-scope="remote">/);
    assert.match(html, /<button class="nav-btn" data-view="remote-history" data-scope="remote">/);
    assert.match(html, /id="out-of-network"[\s\S]*?برای ثبت تردد باید داخل شبکه شرکت باشید/);
  });
  test('CSS: بنر و آیتم‌های دورکاری فقط با #app.remote-mode دیده می‌شوند و بقیه‌ی آیتم‌ها در آن حالت پنهان‌اند', () => {
    assert.match(css, /\.remote-banner \{ display: none;/);
    assert.match(css, /#app\.remote-mode \.remote-banner \{ display: block; \}/);
    assert.match(css, /\.nav-btn\[data-scope="remote"\] \{ display: none; \}/);
    assert.match(css, /#app\.remote-mode \.nav-btn\[data-scope="remote"\] \{ display: flex; \}/);
    assert.match(css, /#app\.remote-mode \.nav-btn:not\(\[data-scope="remote"\]\) \{ display: none; \}/);
  });
});

describe('کد app.js (R4)', () => {
  const mod = remoteBlock();
  test('بلوک دورکاری پیدا می‌شود و متن پیام دقیقاً همان متن پرامپت است', () => {
    assert.ok(mod.length > 500);
    assert.ok(mod.includes(MSG));
  });
  test('دیالوگ: role=dialog، aria-modal، aria-labelledby/describedby، تله‌ی فوکوس، Esc برابر «خروج»، دو دکمه‌ی «تأیید» و «خروج»', () => {
    assert.match(mod, /setAttribute\('role', 'dialog'\)/);
    assert.match(mod, /setAttribute\('aria-modal', 'true'\)/);
    assert.match(mod, /setAttribute\('aria-labelledby', 'remote-dialog-title'\)/);
    assert.match(mod, /setAttribute\('aria-describedby', 'remote-dialog-text'\)/);
    assert.match(mod, /ev\.key === 'Escape'[^\n]*exitRemoteFlow\(\)/);
    assert.match(mod, /ev\.key !== 'Tab'/);
    assert.match(mod, /rEl\('button', 'btn primary', 'تأیید'\)/);
    assert.match(mod, /rEl\('button', 'btn secondary', 'خروج'\)/);
    assert.match(mod, /tg\.close\(\)/);
  });
  test('بدون alert/confirm/prompt، بدون inline style/on*؛ innerHTML فقط برای پاک‌کردن و کاشی با رشته‌های ثابت', () => {
    assert.doesNotMatch(mod, /(^|[^\w.])(alert|confirm|prompt)\s*\(|window\.(alert|confirm|prompt)/m);
    assert.doesNotMatch(mod, /\.style\b|\son(click|change|submit)\s*=/);
    const assigns = [...mod.matchAll(/innerHTML\s*=/g)].length;
    assert.equal(assigns, 4, 'فقط کاشی (رشته‌های ثابت) و سه پاک‌سازی: اقدام‌ها، فهرست امروز، فهرست تاریخچه');
    assert.equal((mod.match(/innerHTML = '';/g) || []).length, 3);
  });
  test('متن‌های سرور (یادداشت سرپرست) با textContent درج می‌شوند و کدهای REMOTE_NOT_ALLOWED/OUT_OF_NETWORK از حالت دورکاری بیرون می‌آورند', () => {
    assert.match(mod, /rEl\('div', 'remote-note', `دلیل رد: \$\{s\.review_note\}`\)/);
    assert.match(mod, /REMOTE_NOT_ALLOWED/);
    assert.match(mod, /leaveRemoteMode\(err\.message\)/);
  });
  test('doAction: OUT_OF_NETWORK چهار مسیر تردد دیالوگ را نشان می‌دهد (قبل از توست خطا)', () => {
    assert.match(mod, /OUT_OF_NETWORK_PATHS = \['\/check-in', '\/check-out', '\/break\/start', '\/break\/end'\]/);
    const i = app.indexOf('async function doAction(');
    const body = app.slice(i, app.indexOf('\n  function setStatus', i));
    assert.ok(body.indexOf("code === 'OUT_OF_NETWORK'") > -1);
    assert.ok(body.indexOf("code === 'OUT_OF_NETWORK'") < body.indexOf('showToast(err.message, true);'));
    assert.match(body, /handleOutOfNetwork\(err\.message\)/);
  });
  test('boot: network-state قبل از loadToday گرفته می‌شود؛ switchView در حالت دورکاری فقط نماهای دورکاری را باز می‌کند', () => {
    const b = app.slice(app.indexOf('async function boot()'));
    assert.ok(b.indexOf('fetchNetworkState()') > -1 && b.indexOf('fetchNetworkState()') < b.indexOf('loadToday()'));
    assert.match(app, /remoteUi\.active && !REMOTE_VIEWS\.includes\(name\)\) name = 'remote'/);
    assert.match(app, /!remoteUi\.active && REMOTE_VIEWS\.includes\(name\)\) return;/);
  });
});

// اجرای واقعی app.js با تلگرام/DOM/fetch ساختگی
function runApp(netState) {
  const noop = () => {};
  const els = new Map(); const log = []; const docHandlers = {};
  const makeEl = (sel) => {
    const classes = new Set(); const attrs = {}; const handlers = {};
    const el = {
      sel, children: [], attrs, handlers, dataset: {}, style: {}, innerHTML: '', textContent: '', className: '', id: '', parentNode: null,
      classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), toggle: noop, contains: (c) => classes.has(c) },
      addEventListener(t, f) { (handlers[t] = handlers[t] || []).push(f); },
      appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
      removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; },
      setAttribute(k, v) { attrs[k] = v; }, removeAttribute(k) { delete attrs[k]; }, querySelector: () => null,
      querySelectorAll() { const out = []; const walk = (n) => n.children.forEach((c) => { if (c.tag === 'button') out.push(c); walk(c); }); walk(el); return out; },
      contains: () => true, focus: noop, firstChild: { textContent: '' }, click() { (handlers.click || []).forEach((f) => f()); },
    };
    return el;
  };
  const $ = (sel) => { if (!els.has(sel)) els.set(sel, makeEl(sel)); return els.get(sel); };
  const body = makeEl('body');
  const document = {
    body, querySelector: $, querySelectorAll: () => [], createElement: (t) => { const e = makeEl('new'); e.tag = t; return e; },
    createTextNode: (t) => ({ textContent: t }), addEventListener: (t, f) => { docHandlers[t] = f; }, removeEventListener: (t) => { delete docHandlers[t]; },
  };
  let closed = false;
  const tg = { initData: 'signed', initDataUnsafe: {}, ready: noop, expand: noop, close: () => { closed = true; } };
  const ok = (j) => ({ ok: true, status: 200, json: async () => j });
  const fetchStub = async (url) => {
    const p = url.replace('/api/miniapp', ''); log.push(p);
    if (p === '/me') return ok({ fullName: 'علی' });
    if (p === '/network-state') return ok(netState);
    if (p === '/today') return ok({ record: null, breaks: [], openBreak: null });
    if (p === '/remote/today') return ok({ workDate: '2026-10-16', openSession: null, openBreak: null, sessions: [] });
    return ok([]);
  };
  const win = { Telegram: { WebApp: tg }, UiStates: S, localStorage: { getItem: () => 'dev', setItem: noop } };
  vm.runInNewContext(app, { window: win, document, fetch: fetchStub, console, setTimeout, clearTimeout, setInterval, clearInterval, Date, Intl, JSON, Promise, Error, URLSearchParams }); // خودش boot() را صدا می‌زند
  return { log, $, body, docHandlers, closed: () => closed };
}
const wait = () => new Promise((r) => setTimeout(r, 40));

describe('اجرای واقعی app.js (boot دورکاری)', () => {
  test('بیرون از شبکه و remoteAllowed ⇒ دیالوگ، بدون درخواست /today؛ «تأیید» نمای دورکاری را می‌گیرد', async () => {
    const r = runApp({ inNetwork: false, viaMission: false, remoteAllowed: true });
    await wait();
    assert.ok(r.log.includes('/network-state'));
    assert.equal(r.log.includes('/today'), false, r.log.join(','));
    const dialog = r.body.children[0].children[0];
    assert.equal(dialog.attrs.role, 'dialog');
    assert.equal(dialog.children[1].textContent, MSG);
    assert.deepEqual(dialog.children[2].children.map((b) => b.textContent), ['تأیید', 'خروج']);
    dialog.children[2].children[0].click();
    await wait();
    assert.equal(r.body.children.length, 0, 'دیالوگ بسته می‌شود');
    assert.ok(r.log.includes('/remote/today'));
    assert.equal(r.log.includes('/today'), false);
  });
  test('Esc برابر «خروج»: tg.close و صفحه‌ی ساده‌ی خارج از شبکه', async () => {
    const r = runApp({ inNetwork: false, viaMission: false, remoteAllowed: true });
    await wait();
    r.docHandlers.keydown({ key: 'Escape', preventDefault() {}, stopPropagation() {} });
    assert.equal(r.closed(), true);
    assert.equal(r.body.children.length, 0);
  });
  test('داخل شبکه، ماموریت، یا خطای network-state ⇒ رفتار فعلی بدون دیالوگ', async () => {
    for (const net of [{ inNetwork: true, viaMission: false, remoteAllowed: false }, { inNetwork: false, viaMission: true, remoteAllowed: false }, []]) {
      const r = runApp(net);
      await wait();
      assert.equal(r.body.children.length, 0);
      assert.ok(r.log.includes('/today'), JSON.stringify(net));
      assert.equal(r.log.includes('/remote/today'), false);
    }
  });
});

// S5-9c: skeleton نمای «امروز» Mini App هنگام اولین بارگذاری — ماژول، نشانه‌گذاری، CSS و اجرای واقعی app.js با fetch ساختگی.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const S = require('../public/js/states.js');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');
const appSrc = read('public/js/app.js');

describe('skeleton «امروز»', () => {
  test('ماژول: نوع today با کارت وضعیت، دو دکمه و سه ردیف؛ aria-busy و برچسب مخصوص خوانشگر؛ بدون style/on*', () => {
    const h = S.skeletonHtml('today', { label: 'در حال بارگذاری وضعیت امروز…' });
    assert.match(h, /role="status" aria-busy="true"/);
    assert.match(h, /<span class="sr-only">در حال بارگذاری وضعیت امروز…<\/span>/);
    assert.equal((h.match(/class="sk-card"/g) || []).length, 2);
    assert.match(h, /sk-grid two/);
    assert.match(h, /sk-line w50 tall/);
    assert.doesNotMatch(h, /<[^>]*\s(on[a-z]+|style)\s*=|<script|https?:\/\//i);
  });
  test('نشانه‌گذاری و CSS: ظرف مخفی در ابتدای نما؛ حین بارگذاری فقط skeleton دیده می‌شود', () => {
    const html = read('public/index.html');
    assert.match(html, /<section id="view-today" class="view">\s*<div id="today-skeleton" class="hidden"><\/div>/);
    const css = read('public/css/style.css');
    assert.match(css, /\.view\.is-loading > :not\(#today-skeleton\) \{ display: none; \}/);
    assert.match(css, /\.sk-line\.w100 \{ width: 100%; \}/);
    assert.match(css, /\.sk-grid\.two \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/);
  });
});

// اجرای واقعی app.js با تلگرام/DOM/fetch ساختگی: ترتیب «skeleton روشن ⇒ درخواست‌ها ⇒ skeleton خاموش»
function runApp({ todayBehavior }) {
  const noop = () => {};
  const els = new Map();
  const log = [];
  const makeEl = (sel) => {
    const handlers = {}; const classes = new Set(sel === '#today-skeleton' ? ['hidden'] : []);
    const el = {
      sel, innerHTML: '', textContent: '', className: '', style: {}, dataset: {}, children: [], handlers, hidden: false, value: '',
      classList: {
        add: (c) => { classes.add(c); if (sel === '#view-today' || sel === '#today-skeleton') log.push(`${sel}+${c}`); },
        remove: (c) => { classes.delete(c); if (sel === '#view-today' || sel === '#today-skeleton') log.push(`${sel}-${c}`); },
        toggle: noop, contains: (c) => classes.has(c),
      },
      addEventListener(type, fn) { (handlers[type] = handlers[type] || []).push(fn); },
      appendChild(c) { this.children.push(c); return c; }, querySelector: () => null, querySelectorAll: () => [],
      setAttribute(k, v) { if (sel === '#view-today') log.push(`view@${k}=${v}`); }, removeAttribute(k) { if (sel === '#view-today') log.push(`view@-${k}`); },
      firstChild: { textContent: '' },
    };
    return el;
  };
  const $ = (sel) => { if (!els.has(sel)) els.set(sel, makeEl(sel)); return els.get(sel); };
  const document = { querySelector: $, querySelectorAll: () => [], createElement: () => makeEl('new'), addEventListener: noop };
  const tg = { initData: 'signed', initDataUnsafe: {}, ready: noop, expand: noop };
  const fetchStub = async (url) => {
    log.push(`fetch ${url.replace('/api/miniapp', '')}`);
    if (url.endsWith('/me')) return { ok: true, status: 200, json: async () => ({ fullName: 'علی', role: 'employee' }) };
    if (url.endsWith('/today')) return todayBehavior();
    return { ok: true, status: 200, json: async () => [] };
  };
  const win = { Telegram: { WebApp: tg }, UiStates: S, localStorage: { getItem: () => 'dev', setItem: noop } };
  vm.runInNewContext(appSrc, { window: win, document, fetch: fetchStub, console, setTimeout, clearTimeout, setInterval, clearInterval, Date, Intl, JSON, Promise, Error }); // خودش boot() را صدا می‌زند
  return { log, $ };
}
const wait = () => new Promise((r) => setTimeout(r, 40));
const todayOk = async () => ({ ok: true, status: 200, json: async () => ({ record: null, breaks: [], openBreak: null }) });
const todayFail = async () => ({ ok: false, status: 500, json: async () => ({ error: 'خطای سرور' }) });

describe('اجرای واقعی app.js (boot)', () => {
  test('موفق: skeleton قبل از درخواست /today روشن و بعد از آن خاموش می‌شود', async () => {
    const { log } = runApp({ todayBehavior: todayOk });
    await wait();
    const on = log.indexOf('#today-skeleton-hidden'); const fetchToday = log.indexOf('fetch /today'); const off = log.indexOf('#today-skeleton+hidden');
    assert.ok(on > -1 && fetchToday > -1 && off > -1, log.join(' | '));
    assert.ok(on < fetchToday && fetchToday < off, log.join(' | '));
    assert.ok(log.includes('#view-today+is-loading') && log.includes('#view-today-is-loading'));
    assert.ok(log.indexOf('#view-today+is-loading') < log.indexOf('#view-today-is-loading'));
    assert.ok(log.includes('view@aria-busy=true') && log.includes('view@-aria-busy'));
  });
  test('ناموفق: skeleton حتماً برداشته می‌شود (finally) و کارت خطا با «تلاش دوباره» دیده می‌شود', async () => {
    const { log, $ } = runApp({ todayBehavior: todayFail });
    await wait();
    assert.ok(log.includes('#today-skeleton+hidden'), log.join(' | '));
    assert.ok(log.includes('#view-today-is-loading'));
    assert.match($('#app-error').innerHTML, /id="retry-boot">تلاش دوباره</);
    assert.equal($('#app-error-msg').textContent, 'خطای سرور');
  });
});

// فاز ۱۶ · T3: ریل ناوبری شناور آیکنی — قرص فعال با نوچ، حالت بازشده (adminRail)، تولتیپ فارسی، aria-label/title، هدف لمسی.
// core.js واقعی داخل vm با DOM ساختگی اجرا می‌شود (بدون سرور)؛ CSS/HTML ایستا بررسی می‌شود.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');
const CSS = read('public-admin/css/style.css');
const HTML = read('public-admin/index.html');

// ---------- DOM ساختگی ----------
function makeEl(extra = {}) {
  const cls = new Set();
  const attrs = new Map();
  const listeners = {};
  const el = {
    innerHTML: '', textContent: '', value: '', style: {}, dataset: {},
    classList: {
      add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c),
      toggle: (c, f) => { const on = f === undefined ? !cls.has(c) : !!f; if (on) cls.add(c); else cls.delete(c); return on; },
    },
    setAttribute: (k, v) => attrs.set(k, String(v)),
    getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
    hasAttribute: (k) => attrs.has(k),
    removeAttribute: (k) => attrs.delete(k),
    addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
    fire: (type, ev = {}) => (listeners[type] || []).forEach((fn) => fn(ev)),
    getBoundingClientRect: () => ({ left: 1000, top: 100, height: 48, width: 76 }),
    offsetWidth: 80, offsetHeight: 30,
    appendChild() {}, remove() {}, focus() {},
    querySelector: () => null, querySelectorAll: () => [],
    _cls: cls, _attrs: attrs,
    ...extra,
  };
  return el;
}

function loadCore({ localStorage, matchMedia = () => ({ matches: true }), navButtons = [] } = {}) {
  const els = new Map();
  const $ = (sel) => { if (!els.has(sel)) els.set(sel, makeEl()); return els.get(sel); };
  const docListeners = {};
  const sandbox = {
    document: {
      querySelector: (sel) => (sel === '.nav-item.active' ? (navButtons.find((b) => b._cls.has('active')) || null) : $(sel)),
      querySelectorAll: (sel) => (sel === '.nav-item' ? navButtons : []),
      addEventListener: (t, fn) => { (docListeners[t] = docListeners[t] || []).push(fn); }, createElement: makeEl,
    },
    console, URL, URLSearchParams, setTimeout, clearTimeout,
    location: { href: '/admin/', hash: '', reload() {} }, history: { replaceState() {} },
    scrollTo() {}, addEventListener() {}, fetch: async () => ({ ok: true, json: async () => ({}) }),
    matchMedia,
  };
  if (localStorage !== undefined) sandbox.localStorage = localStorage;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const f of ['jalali.js', 'core.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, 'public-admin', 'js', f), 'utf8'), sandbox, { filename: f });
  }
  return { AP: sandbox.AP, $, els, docListeners };
}

const navBtn = (view) => makeEl({
  dataset: { view },
  scrolled: null,
  scrollIntoView(o) { this.scrolled = o; },
});

describe('T3 · آیتم‌های ریل (core.js)', () => {
  test('هر آیتم aria-label و title (برچسب فارسی) دارد و برچسب escape می‌شود؛ شمارنده فقط با counter', () => {
    const { AP } = loadCore();
    const withCount = AP.navItemHtml({ id: 'leave', icon: 'leave', label: 'مرخصی‌ها', counter: true, group: 'x' });
    assert.match(withCount, /aria-label="مرخصی‌ها"/);
    assert.match(withCount, /title="مرخصی‌ها"/);
    assert.match(withCount, /data-view="leave"/);
    assert.match(withCount, /<span class="nav-label">مرخصی‌ها<\/span>/);
    assert.match(withCount, /<span class="nav-count hidden"><\/span>/);
    const plain = AP.navItemHtml({ id: 'live', icon: 'live', label: 'تابلو <b>', group: 'x', param: 7 });
    assert.doesNotMatch(plain, /nav-count/);
    assert.match(plain, /data-param="7"/);
    assert.match(plain, /aria-label="تابلو &lt;b&gt;"/);
    assert.doesNotMatch(plain, /<b>/);
  });

  test('setActiveNav: فقط یک آیتم aria-current="page" دارد، با جابه‌جایی منتقل می‌شود و آیتم فعال در دید می‌آید', () => {
    const btns = [navBtn('dashboard'), navBtn('live'), navBtn('leave')];
    const { AP } = loadCore({ navButtons: btns });
    AP.setActiveNav('live');
    const current = () => btns.filter((b) => b.getAttribute('aria-current') === 'page').map((b) => b.dataset.view);
    assert.deepEqual(current(), ['live']);
    assert.ok(btns[1]._cls.has('active'));
    assert.ok(!btns[0]._cls.has('active') && !btns[2]._cls.has('active'));
    assert.equal(btns[1].scrolled.block, 'nearest');
    AP.setActiveNav('leave');
    assert.deepEqual(current(), ['leave']);
    assert.equal(btns[2].scrolled.block, 'nearest');
    AP.setActiveNav('nope');
    assert.deepEqual(current(), []);
  });
});

describe('T3 · حالت ریل/بازشده', () => {
  const memStorage = () => { const m = new Map(); return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };

  test('پیش‌فرض rail؛ apply/toggle کلاس rail-expanded، aria-expanded دکمه و localStorage(adminRail) را هماهنگ می‌کنند', () => {
    const ls = memStorage();
    const { AP, $ } = loadCore({ localStorage: ls });
    assert.equal(AP.rail.read(), 'rail');
    assert.equal(AP.rail.apply('expanded', true), 'expanded');
    assert.ok($('#app-shell')._cls.has('rail-expanded'));
    assert.equal($('#rail-toggle').getAttribute('aria-expanded'), 'true');
    assert.equal(ls.m.get('adminRail'), 'expanded');
    assert.equal(AP.rail.read(), 'expanded');
    assert.equal(AP.rail.toggle(), 'rail');
    assert.ok(!$('#app-shell')._cls.has('rail-expanded'));
    assert.equal($('#rail-toggle').getAttribute('aria-expanded'), 'false');
    assert.equal(ls.m.get('adminRail'), 'rail');
    assert.equal(AP.rail.toggle(), 'expanded');
  });

  test('apply(..., false) چیزی ذخیره نمی‌کند؛ مقدار ناشناخته در localStorage ⇒ rail', () => {
    const ls = memStorage();
    ls.m.set('adminRail', 'weird');
    const { AP } = loadCore({ localStorage: ls });
    assert.equal(AP.rail.read(), 'rail');
    AP.rail.apply('expanded', false);
    assert.equal(ls.m.get('adminRail'), 'weird');
  });

  test('localStorage مسدود/ناقص/غایب نمی‌ترکد', () => {
    const throwing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
    for (const ls of [throwing, {}, undefined]) {
      const { AP, $ } = loadCore({ localStorage: ls });
      assert.equal(AP.rail.read(), 'rail');
      assert.doesNotThrow(() => AP.rail.apply('expanded', true));
      assert.ok($('#app-shell')._cls.has('rail-expanded'));
      assert.doesNotThrow(() => AP.rail.toggle());
    }
  });
});

describe('T3 · تولتیپ فارسی ریل', () => {
  function setup({ expanded = false, desktop = true } = {}) {
    const { AP, $ } = loadCore({ matchMedia: () => ({ matches: desktop }) });
    if (expanded) $('#app-shell').classList.add('rail-expanded');
    AP.setupRailTip();
    const item = makeEl({ closest: () => item, matches: () => true, contains: (x) => x === item });
    item.setAttribute('aria-label', 'مرخصی‌ها (۱۲ مورد)');
    item.setAttribute('title', 'مرخصی‌ها (۱۲ مورد)');
    return { sidebar: $('#sidebar'), tip: $('#rail-tip'), item };
  }

  test('hover روی آیتم: متن aria-label در تولتیپ، سمت چپ ریل؛ title بومی موقتاً برداشته و با خروج برمی‌گردد', () => {
    const { sidebar, tip, item } = setup();
    sidebar.fire('mouseover', { target: item });
    assert.equal(tip.textContent, 'مرخصی‌ها (۱۲ مورد)');
    assert.ok(tip._cls.has('show'));
    assert.equal(item.getAttribute('title'), null);
    assert.equal(tip.style.left, `${1000 - 10 - 80}px`);
    assert.equal(tip.style.top, `${100 + (48 - 30) / 2}px`);
    sidebar.fire('mouseout', { target: item, relatedTarget: null });
    assert.ok(!tip._cls.has('show'));
    assert.equal(item.getAttribute('title'), 'مرخصی‌ها (۱۲ مورد)');
  });

  test('فوکوس کیبورد (focus-visible) نشان می‌دهد؛ فوکوس با ماوس نه؛ Escape می‌بندد', () => {
    const a = setup();
    a.item.matches = () => false;
    a.sidebar.fire('focusin', { target: a.item });
    assert.ok(!a.tip._cls.has('show'));
    a.item.matches = () => true;
    a.sidebar.fire('focusin', { target: a.item });
    assert.ok(a.tip._cls.has('show'));
    a.sidebar.fire('focusout', {});
    assert.ok(!a.tip._cls.has('show'));
  });

  test('در حالت بازشده یا موبایل/تبلت تولتیپ نمایش داده نمی‌شود', () => {
    const e = setup({ expanded: true });
    e.sidebar.fire('mouseover', { target: e.item });
    assert.ok(!e.tip._cls.has('show'));
    const m = setup({ desktop: false });
    m.sidebar.fire('mouseover', { target: m.item });
    assert.ok(!m.tip._cls.has('show'));
  });
});

// ---------- CSS/HTML ایستا ----------
function block(css, header) {
  const i = css.indexOf(header);
  assert.ok(i >= 0, `بلاک ${header} نیست`);
  let depth = 0;
  for (let j = css.indexOf('{', i); j < css.length; j += 1) {
    if (css[j] === '{') depth += 1;
    else if (css[j] === '}') { depth -= 1; if (depth === 0) return css.slice(i, j + 1); }
  }
  throw new Error('بلاک ناتمام');
}
const rule = (css, sel) => { const m = css.match(new RegExp(`(^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`)); assert.ok(m, `قاعده‌ی ${sel} نیست`); return m[2]; };

describe('T3 · CSS ریل', () => {
  test('--sidebar-w در هر دو حالت تعریف شده و .content متناظر margin می‌گیرد', () => {
    assert.match(CSS, /\.app-shell \{[^}]*--sidebar-w: 88px;/);
    assert.match(CSS, /\.app-shell\.rail-expanded \{ --sidebar-w: 256px; \}/);
    assert.match(rule(CSS, '.content'), /margin-right: calc\(var\(--sidebar-w\) \+ 16px\)/);
    assert.match(block(CSS, '@media (max-width: 900px) {\n  .sidebar { transform'), /\.content \{ margin-right: 0; \}/);
  });

  test('ریل شناور سرمه‌ای: fixed با فاصله‌ی ۱۶px، گوشه‌ی --radius، پس‌زمینه‌ی --rail، سایه؛ بدون سبز برند', () => {
    const r = rule(CSS, '.sidebar');
    assert.match(r, /position: fixed;/);
    assert.match(r, /top: 16px; bottom: 16px; right: 16px;/);
    assert.match(r, /width: var\(--sidebar-w\);/);
    assert.match(r, /background: var\(--rail\);/);
    assert.match(r, /border-radius: var\(--radius\);/);
    assert.match(r, /box-shadow: var\(--shadow\);/);
    assert.match(r, /overflow: hidden;/); // فقط لیست #side-nav اسکرول می‌شود
    assert.match(rule(CSS, '.side-nav'), /overflow-y: auto;/);
    const seg = CSS.slice(CSS.indexOf('.app-shell { display: flex'), CSS.indexOf('\n.avatar {'));
    assert.doesNotMatch(seg, /var\(--green/);
    assert.doesNotMatch(seg, /var\(--sidebar\)/);
    assert.doesNotMatch(seg, /#7be495|#14a878|#25d9a0|#16b886/);
    assert.doesNotMatch(seg, /rgba\(255, ?255, ?255/);
  });

  test('آیتم فعال: قرص --bg، رنگ --rail-active-text، تا لبه‌ی چپِ ریل، نوچ مقعر بالا و پایین با radial-gradient', () => {
    assert.match(rule(CSS, '.nav-item.active'), /background: var\(--bg\);[^}]*color: var\(--rail-active-text\);/);
    const m = block(CSS, '@media (min-width: 901px) {\n  /* قرص فعال');
    assert.match(m, /\.nav-item\.active \{ margin-inline-end: 0; border-radius: 0 24px 24px 0; \}/);
    assert.match(m, /left: 0; width: 20px; height: 20px;/);
    assert.match(m, /::before \{ top: -20px; background: radial-gradient\(circle at 100% 0, transparent 20px, var\(--bg\) 20\.5px\); \}/);
    assert.match(m, /::after \{ bottom: -20px; background: radial-gradient\(circle at 100% 100%, transparent 20px, var\(--bg\) 20\.5px\); \}/);
    assert.doesNotMatch(CSS, /\.nav-item\.active::before \{[^}]*var\(--green/);
  });

  test('هدف لمسی آیتم ≥ ۴۴px (۴۸px) و دکمه‌ی تغییر عرض/خروج ≥ ۴۴px', () => {
    const h = Number(rule(CSS, '.nav-item').match(/min-height: (\d+)px;/)[1]);
    assert.ok(h >= 44, `min-height آیتم ${h}`);
    assert.ok(Number(rule(CSS, '.rail-toggle').match(/min-height: (\d+)px;/)[1]) >= 44);
    assert.match(CSS, /@media \(pointer: coarse\), \(max-width: 900px\) \{[^]*\.icon-btn \{ width: 44px; height: 44px; \}/);
  });

  test('حالت ریل: برچسب فقط برای صفحه‌خوان، گروه ⇒ خط جداکننده، شمارنده ⇒ نشان گوشه‌ی آیکن', () => {
    const m = block(CSS, '@media (min-width: 901px) {\n  /* قرص فعال');
    assert.match(m, /\.app-shell:not\(\.rail-expanded\) \.nav-label,[^{]*\{[^}]*clip-path: inset\(50%\);/);
    assert.match(m, /\.app-shell:not\(\.rail-expanded\) \.nav-group \{[^}]*height: 1px;[^}]*font-size: 0;/);
    assert.match(m, /\.nav-item \.nav-count \{[^}]*position: absolute;/);
  });

  test('موبایل/تبلت: کشو از لبه‌ی صفحه با گوشه‌های گرد سمت محتوا؛ دکمه‌ی عرض و تولتیپ پنهان؛ قرص بدون نوچ (نوچ فقط ≥۹۰۱px)', () => {
    const m = block(CSS, '@media (max-width: 900px) {\n  .sidebar { top: 0;');
    assert.match(m, /width: min\(280px, 86vw\); border-radius: var\(--radius\) 0 0 var\(--radius\);/);
    assert.match(m, /\.rail-toggle, \.rail-tip \{ display: none; \}/);
    const before = CSS.slice(0, CSS.indexOf('@media (min-width: 901px) {\n  /* قرص فعال'));
    assert.doesNotMatch(before, /\.nav-item\.active::(before|after)/);
  });

  test('تولتیپ: fixed، بدون رویداد ماوس (pointer-events: none)، رنگ‌ها از توکن', () => {
    const r = rule(CSS, '.rail-tip');
    assert.match(r, /position: fixed;/);
    assert.match(r, /pointer-events: none;/);
    assert.match(r, /background: var\(--rail\); color: var\(--rail-text\);/);
  });
});

describe('T3 · index.html', () => {
  test('دکمه‌ی تغییر عرض: aria-controls/aria-expanded/aria-label؛ تولتیپ role=tooltip؛ بدون style درون‌خطی جدید', () => {
    const btn = HTML.match(/<button id="rail-toggle"[^>]*>/)[0];
    assert.match(btn, /aria-controls="sidebar"/);
    assert.match(btn, /aria-expanded="false"/);
    assert.match(btn, /aria-label="[^"]+"/);
    assert.match(HTML, /<div id="rail-tip" class="rail-tip" role="tooltip" aria-hidden="true"><\/div>/);
    assert.doesNotMatch(HTML, /\sstyle="/);
    assert.match(HTML, /<nav class="side-nav" id="side-nav" aria-label="منوی اصلی">/);
  });
});

// ---------- کنتراست (AA) ----------
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lum = (c) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const vars = (header) => { const i = CSS.indexOf(header); const seg = CSS.slice(i, CSS.indexOf('\n}', i)); return Object.fromEntries([...seg.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6});/gi)].map((m) => [m[1], hex(m[2])])); };
const THEMES = { روشن: vars(':root[data-theme="light"] {'), تیره: vars(':root,\n:root[data-theme="dark"] {') };
const mix = (fg, bg, p) => fg.map((v, i) => v * p + bg[i] * (1 - p));

describe('T3 · کنتراست ریل', () => {
  for (const [name, t] of Object.entries(THEMES)) {
    test(`تم ${name}: متن آیتم روی ریل و روی hover (۱۴٪ ترکیب) ≥ ۴٫۵؛ حلقه‌ی فوکوس روی ریل ≥ ۳؛ فوکوس قرص فعال (--brand روی --bg) ≥ ۳`, () => {
      const hover = mix(t['rail-text'], t.rail, 0.14);
      assert.ok(ratio(t['rail-text'], t.rail) >= 4.5, 'rail-text/rail');
      assert.ok(ratio(t['rail-text'], hover) >= 4.5, `rail-text/hover ${ratio(t['rail-text'], hover).toFixed(2)}`);
      assert.ok(ratio(t['rail-text'], t.rail) >= 3, 'focus ring');
      assert.ok(ratio(t['rail-active-text'], t.bg) >= 4.5, 'rail-active-text/bg');
      assert.ok(ratio(t.brand, t.bg) >= 3, 'brand/bg (focus on active pill)');
      assert.ok(ratio(t.rail, t['rail-text']) >= 4.5, 'avatar/brand-mark: rail on rail-text');
    });
  }
});

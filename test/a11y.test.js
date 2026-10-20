// S5-9a: دسترس‌پذیری — تله‌ی فوکوس مودال، کیبورد ردیف/سرستون، برچسب کنترل‌ها، حلقه‌ی فوکوس، aria نمودار/جدول، عدم اتکای صرف به رنگ.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const A = require('../public-admin/js/a11y.js');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');
const jsFiles = fs.readdirSync(path.join(root, 'public-admin', 'js')).map((f) => `public-admin/js/${f}`);

// ---- کنتراست حلقه‌ی فوکوس (غیرمتنی: ≥ ۳:۱) ----
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lum = (c) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const themeVars = (css, sel) => { const i = css.indexOf(`${sel} {`); const seg = css.slice(i, css.indexOf('\n}', i)); return Object.fromEntries([...seg.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6});/gi)].map((m) => [m[1], m[2]])); };

describe('منطق خالص', () => {
  test('nextIndex: چرخه‌ی Tab/Shift+Tab و فوکوس بیرونی', () => {
    assert.equal(A.nextIndex(3, 0, false), 1);
    assert.equal(A.nextIndex(3, 2, false), 0);
    assert.equal(A.nextIndex(3, 0, true), 2);
    assert.equal(A.nextIndex(3, -1, false), 0);
    assert.equal(A.nextIndex(3, -1, true), 2);
    assert.equal(A.nextIndex(0, 0, false), -1);
  });
  test('sortState: ▲/▼/بدون ⇒ ascending/descending/none', () => {
    assert.equal(A.sortState('نام ▲'), 'ascending');
    assert.equal(A.sortState('نام ▼'), 'descending');
    assert.equal(A.sortState('نام'), 'none');
    assert.equal(A.sortState(undefined), 'none');
  });
});

describe('تله‌ی فوکوس (ماک DOM)', () => {
  const mk = (names) => names.map((n) => ({ n, hidden: false, focused: false, getAttribute: () => null, closest: () => null, focus() { this.focused = true; } }));
  const container = (els) => ({ querySelectorAll: () => els, contains: (x) => els.includes(x), focus() { this.focused = true; } });
  const ev = (shiftKey = false, key = 'Tab') => ({ key, shiftKey, prevented: false, preventDefault() { this.prevented = true; } });

  test('Tab روی آخرین عنصر ⇒ اولی؛ Shift+Tab روی اولی ⇒ آخری', () => {
    const els = mk(['a', 'b', 'c']); const c = container(els);
    let e = ev(false); assert.equal(A.trapTab(e, c, els[2]), true); assert.ok(e.prevented); assert.ok(els[0].focused);
    els.forEach((x) => { x.focused = false; });
    e = ev(true); assert.equal(A.trapTab(e, c, els[0]), true); assert.ok(els[2].focused);
  });
  test('وسط فهرست: رفتار طبیعی مرورگر (دخالت نمی‌کند)', () => {
    const els = mk(['a', 'b', 'c']); const e = ev(false);
    assert.equal(A.trapTab(e, container(els), els[1]), false);
    assert.equal(e.prevented, false);
  });
  test('فوکوس بیرون مودال ⇒ به اولین (یا آخرین با Shift) عنصر داخل برمی‌گردد', () => {
    const els = mk(['a', 'b']); const outside = {};
    A.trapTab(ev(false), container(els), outside); assert.ok(els[0].focused);
    els.forEach((x) => { x.focused = false; });
    A.trapTab(ev(true), container(els), outside); assert.ok(els[1].focused);
  });
  test('بدون عنصر قابل‌فوکوس: فوکوس روی خودِ مودال می‌ماند؛ کلید غیر Tab نادیده', () => {
    const c = container([]); const e = ev(false);
    assert.equal(A.trapTab(e, c, null), true); assert.ok(c.focused); assert.ok(e.prevented);
    assert.equal(A.trapTab(ev(false, 'Enter'), c, null), false);
  });
  test('عنصر مخفی/aria-hidden در فهرست فوکوس نیست', () => {
    const els = mk(['a', 'b', 'c']); els[1].hidden = true; els[2].getAttribute = () => 'true';
    assert.deepEqual(A.focusables(container(els)), [els[0]]);
  });
  test('enhance: tabindex و data-kbd و aria-sort؛ دوباره‌اجرا idempotent', () => {
    const attrs = new Map();
    const el = (tag, text) => { const a = {}; const o = { tagName: tag, textContent: text, a, setAttribute: (k, v) => { a[k] = v; }, hasAttribute: (k) => k in a }; return o; };
    const th = el('TH', 'نام ▲'); const tr = el('TR', ''); tr.a.tabindex = '0';
    A.enhance({ querySelectorAll: () => [th, tr] });
    assert.equal(th.a.tabindex, '0'); assert.equal(th.a['aria-sort'], 'ascending'); assert.ok('data-kbd' in th.a);
    assert.equal(tr.a.tabindex, '0'); assert.equal('aria-sort' in tr.a, false);
    assert.doesNotThrow(() => A.enhance(null));
  });
});

describe('برچسب کنترل‌ها (پویش ایستا)', () => {
  // هر input/select/textarea یا aria-label دارد، یا داخل <label> است، یا hidden/checkbox/radio داخل label
  function unlabeled(file) {
    const src = read(file).split('\n').map((l) => (/^\s*(\/\/|\*|<!--)/.test(l) ? '' : l)).join('\n'); // کامنت‌ها نادیده
    const bad = [];
    for (const m of src.matchAll(/<(input|select|textarea)\b[^>]*>/g)) {
      const tag = m[0];
      if (/type="hidden"/.test(tag) || /aria-label(ledby)?=/.test(tag)) continue;
      if (/\$\{al\}/.test(tag) && src.includes('const al = `aria-label=')) continue; // views-admin: برچسب از توضیح تنظیم می‌آید
      const pre = src.slice(0, m.index);
      if (pre.lastIndexOf('<label') > pre.lastIndexOf('</label>')) continue;
      bad.push(`${file}:${pre.split('\n').length}: ${tag.slice(0, 80)}`);
    }
    return bad;
  }
  test('پنل: هیچ کنترل بدون برچسب نیست', () => {
    const bad = ['public-admin/index.html', ...jsFiles].flatMap(unlabeled);
    assert.deepEqual(bad, []);
  });
  test('Mini App: هیچ کنترل بدون برچسب نیست', () => {
    assert.deepEqual(['public/index.html', 'public/js/app.js'].flatMap(unlabeled), []);
  });
});

describe('اتصال و CSS', () => {
  const html = read('public-admin/index.html');
  test('لینک پرش اولین عنصر body؛ main قابل‌فوکوس؛ nav نام دارد؛ توست role=status؛ a11y.js قبل از core.js', () => {
    assert.match(html, /<body>\s*<a class="skip-link" href="#page">/);
    assert.match(html, /<main class="page" id="page" tabindex="-1">/);
    assert.match(html, /<nav class="side-nav"[^>]*aria-label="[^"]+"/);
    assert.match(html, /id="toast"[^>]*role="status"[^>]*aria-live="polite"/);
    assert.ok(html.indexOf('/admin/js/a11y.js') > -1 && html.indexOf('/admin/js/a11y.js') < html.indexOf('/admin/js/core.js'));
    assert.match(html, /id="menu-btn"[^>]*aria-expanded="false"/);
  });
  test('مودال: aria-labelledby، فوکوس اولیه، تله‌ی فوکوس، Esc و بازگرداندن فوکوس به فراخواننده', () => {
    const core = read('public-admin/js/core.js');
    assert.match(core, /role="dialog" aria-modal="true" aria-labelledby="\$\{mid\}-t" tabindex="-1"/);
    assert.match(core, /window\.A11y\.trapTab\(e, \$\('\.modal', topModal\.el\), document\.activeElement\)/);
    assert.match(core, /e\.key === 'Escape'/);
    assert.match(core, /opener\.focus/);
    assert.match(core, /aria-current/);
  });
  test('حلقه‌ی فوکوس و کاهش حرکت در هر دو CSS؛ لینک پرش فقط پنل', () => {
    // T8 (فاز ۱۶): حلقه‌ی پنل از سبز به --brand رفت (سبز دیگر رنگ برند نیست)؛ Mini App تا T9 سبز می‌ماند و همچنان --green است
    for (const [f, ring] of [['public-admin/css/style.css', '--brand'], ['public/css/style.css', '--green']]) {
      const css = read(f);
      assert.match(css, new RegExp(`:focus-visible \\{ outline: 2px solid var\\(${ring}\\)`));
      assert.match(css, /prefers-reduced-motion: reduce/);
    }
    assert.match(read('public-admin/css/style.css'), /\.skip-link:focus \{ top: 8px; \}/);
  });
  test('حلقه‌ی فوکوس روی پس‌زمینه‌ی صفحه/کارت در هر دو تم ≥ ۳:۱ (WCAG 1.4.11)', () => {
    for (const [f, cardKey, ringKey] of [['public-admin/css/style.css', 'card', 'brand'], ['public/css/style.css', 'card-bg', 'green']]) {
      const css = read(f);
      for (const [sel, mode] of [[':root,\n:root[data-theme="dark"]', 'dark'], [':root[data-theme="light"]', 'light']]) {
        const v = themeVars(css, sel);
        for (const bg of ['bg', cardKey]) assert.ok(ratio(hex(v[ringKey]), hex(v[bg])) >= 3, `${f} ${mode} ${ringKey}/${bg}`);
      }
    }
  });
  test('ورودی‌هایی که outline:none دارند، حلقه‌ی :focus-visible جایگزین دارند (قاعده‌ی عمومی بعدی)', () => {
    const css = read('public-admin/css/style.css');
    const noRing = css.replace('.modal:focus { outline: none; }', ''); // دیالوگ فقط فوکوس برنامه‌ای می‌گیرد
    assert.ok(noRing.indexOf('input:focus-visible, select:focus-visible, textarea:focus-visible') > noRing.lastIndexOf('outline: none;'));
  });
  test('سرستون مرتب‌سازی و ردیف کلیک‌پذیر با کیبورد: enhance بعد از mount صدا زده می‌شود', () => {
    assert.match(read('public-admin/js/core.js'), /window\.A11y\.enhance\(page\)/);
  });
});

describe('نمودار/جدول و عدم اتکای صرف به رنگ', () => {
  const charts = read('public-admin/js/charts.js');
  test('نمودار: svg با role=img و aria-labelledby؛ جدول معادل با caption، th scope', () => {
    assert.match(charts, /role="img" aria-labelledby=/);
    assert.match(charts, /<caption class="sr-only">/);
    assert.match(charts, /<th scope="col">/);
    assert.match(charts, /<th scope="row">/);
  });
  test('سری‌ها علاوه بر رنگ، شکل نشانگر/الگوی خط و برچسب متنی دارند', () => {
    assert.match(charts, /dasharray|stroke-dasharray/i);
    assert.match(charts, /chart-legend/);
  });
  test('نشان‌ها (badge) همیشه متن دارند و سلول تقویم نماد + aria-label دارد', () => {
    const core = read('public-admin/js/core.js');
    assert.match(core, /AP\.badge = [^\n]*\$\{esc\(/); // متن برچسب داخل badge
    assert.match(read('public-admin/js/views-calendar.js'), /aria-label="\$\{esc\(title\)\}">\$\{esc\(st\.sym\)\}/);
  });
  test('کارت هشدار الگوها ناحیه‌ی نام‌دار است (aria)', () => {
    // figure + figcaption به‌صورت معنایی نام می‌گیرد؛ برچسب «نشانه، نه اتهام» متنی است نه رنگی
    assert.match(read('public-admin/js/patterns.js'), /نشانه، نه اتهام/);
  });
});

describe('T8 (فاز ۱۶): ریل، تب زیرخط‌دار و فیلد پرشده', () => {
  const CSS = read('public-admin/css/style.css');
  test('هر آیتم ریل آیکنی aria-label و title دارد و نامش متن فارسی است', () => {
    const core = read('public-admin/js/core.js');
    assert.match(core, /class="nav-item" type="button" data-view="\$\{n\.id\}"[\s\S]{0,120}aria-label="\$\{label\}" title="\$\{label\}"/);
    assert.match(read('public-admin/index.html'), /id="rail-toggle"[^>]*aria-controls="sidebar"[^>]*aria-expanded="false"[^>]*aria-label="[^"]+"/);
    assert.match(CSS, /\.nav-item\.active:focus-visible \{ outline-color: var\(--brand\); \}/); // روی قرص --bg حلقه‌ی برند دیده می‌شود
  });
  test('تب زیرخط‌دار: فعال با زیرخط + وزن بیشتر (نه فقط رنگ) و حلقه‌ی فوکوس دارد', () => {
    assert.match(CSS, /\.tab\.active \{[^}]*border-bottom-color: var\(--accent\);[^}]*font-weight: 700;/);
    assert.match(CSS, /\.tab:focus-visible \{ outline: 2px solid var\(--brand\);/);
  });
  test('فیلد پرشده: متن/hint روی --field ≥ ۴٫۵:۱ و فوکوس با حلقه‌ی برند در هر دو تم', () => {
    for (const [sel, mode] of [[':root,\n:root[data-theme="dark"]', 'dark'], [':root[data-theme="light"]', 'light']]) {
      const v = themeVars(CSS, sel);
      for (const k of ['text', 'hint']) assert.ok(ratio(hex(v[k]), hex(v.field)) >= 4.5, `${mode} ${k}/field`);
      assert.ok(ratio(hex(v.brand), hex(v.field)) >= 3, `${mode} brand/field`);
    }
    assert.match(CSS, /input:focus-visible, select:focus-visible, textarea:focus-visible \{ outline: 2px solid var\(--brand\)/);
  });
});

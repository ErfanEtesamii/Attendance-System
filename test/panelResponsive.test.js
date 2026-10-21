// فاز ۱۶ / T8: ریسپانسیو، RTL، چاپ، forced-colors، کاهش حرکت، حلقه‌ی فوکوس و تم با localStorage خالی/مسدود — بررسی ایستا از روی CSS واقعی + منطق theme.js با DOM ساختگی.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const CSS = read('public-admin/css/style.css');
const TOKENS = read('public/css/tokens.css');
const HTML = read('public-admin/index.html');

// ---------- ابزار ----------
const parseColor = (v) => {
  v = v.trim();
  let m = v.match(/^#([0-9a-f]{6})$/i);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)).concat(1);
  m = v.match(/^rgba?\(([^)]+)\)$/);
  if (m) { const p = m[1].split(',').map((x) => parseFloat(x)); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; }
  throw new Error(`رنگ نامعتبر: ${v}`);
};
const over = (fg, bg) => { const a = fg[3]; return [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a)).concat(1); };
const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
function block(css, selector) {
  const i = css.indexOf(`${selector} {`);
  assert.ok(i >= 0, `بلاک ${selector} نیست`);
  return css.slice(i + selector.length + 2, css.indexOf('\n}', i));
}
function mediaBlocks(css, header) { // همه‌ی بلوک‌هایی که با header شروع می‌شوند (تا آکولاد متناظر)
  const out = []; let from = 0;
  for (;;) {
    const i = css.indexOf(header, from); if (i < 0) break;
    let depth = 0; let j = css.indexOf('{', i);
    for (; j < css.length; j += 1) { if (css[j] === '{') depth += 1; else if (css[j] === '}') { depth -= 1; if (depth === 0) break; } }
    out.push(css.slice(i, j + 1)); from = j + 1;
  }
  assert.ok(out.length, `بلاک ${header} نیست`);
  return out;
}
const varsOf = (txt) => Object.fromEntries([...txt.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const THEMES = { dark: varsOf(block(TOKENS, ':root,\n:root[data-theme="dark"]')), light: varsOf(block(TOKENS, ':root[data-theme="light"]')) };

// ---------- ۱) حلقه‌ی فوکوس ----------
describe('T8: حلقه‌ی فوکوس', () => {
  test('حلقه‌ی سراسری و تقویم از --brand می‌آید (سبز دیگر برند نیست)', () => {
    assert.match(CSS, /\n:focus-visible \{ outline: 2px solid var\(--brand\); outline-offset: 2px; \}/);
    assert.match(CSS, /\.cal-cell:focus-visible \{ outline: 2px solid var\(--brand\)/);
    assert.doesNotMatch(CSS.replace(/\/\*[\s\S]*?\*\//g, ''), /:focus-visible[^{]*\{[^}]*var\(--green\)/);
  });
  for (const mode of ['dark', 'light']) {
    test(`[${mode}] حلقه‌ی --brand روی bg/card/card-2/field/brand-soft ≥ ۳:۱ و حلقه‌ی ریل (--rail-text) روی ریل ≥ ۳:۱`, () => {
      const v = THEMES[mode]; const brand = parseColor(v.brand); const card = parseColor(v.card);
      for (const s of ['bg', 'card', 'card-2', 'field']) assert.ok(ratio(brand, parseColor(v[s])) >= 3, `brand/${s}`);
      assert.ok(ratio(brand, over(parseColor(v['brand-soft']), card)) >= 3, 'brand/brand-soft');
      assert.ok(ratio(parseColor(v['rail-text']), parseColor(v.rail)) >= 3, 'rail-text/rail');
      assert.ok(ratio(brand, parseColor(v.bg)) >= 3, 'حلقه‌ی آیتم فعال ریل (قرص --bg)');
    });
  }
});

// ---------- ۲) کاهش حرکت ----------
describe('T8: prefers-reduced-motion', () => {
  const RM = mediaBlocks(CSS, '@media (prefers-reduced-motion: reduce)').join('\n');
  test('قاعده‌ی سراسری حفظ شده و ریل/کشو/تب/سوییچ هم صریحاً بی‌حرکت‌اند', () => {
    assert.match(RM, /\*, \*::before, \*::after \{ animation-duration: 0\.01ms !important;/);
    for (const sel of ['.sidebar', '.content', '.nav-item', '.rail-tip', '.bell-drawer', '.tab', '.st-track', '.st-track::after']) assert.ok(RM.includes(sel), sel);
    assert.match(RM, /transition: none !important;/);
  });
  test('انتقال تب فقط با no-preference فعال می‌شود', () => {
    assert.match(CSS, /@media \(prefers-reduced-motion: no-preference\) \{ \.tab \{ transition:/);
  });
});

// ---------- ۳) forced-colors ----------
describe('T8: forced-colors', () => {
  const FC = mediaBlocks(CSS, '@media (forced-colors: active)').join('\n');
  test('ریل، قرص فعال، تب فعال، دکمه‌ی اصلی، سوییچ، چیپ و روز امروز با سیستم‌رنگ‌ها قابل تشخیص‌اند', () => {
    assert.match(FC, /\.sidebar \{ border: 1px solid CanvasText; \}/);
    assert.match(FC, /\.nav-item\.active \{ border-color: Highlight; \}/);
    assert.match(FC, /\.nav-item\.active::before, \.nav-item\.active::after \{ display: none; \}/);
    assert.match(FC, /\.tab\.active \{ border-bottom-color: Highlight; \}/);
    assert.match(FC, /\.btn\.primary \{ border-width: 2px; \}/);
    assert.match(FC, /\.st-switch:checked \+ \.st-track \{ border: 2px solid Highlight; \}/);
    assert.match(FC, /\.chip\.active, \.st-pill input:checked \+ span \{ border: 2px solid Highlight; \}/);
    assert.match(FC, /\.day-card\.is-today > summary \{ outline: 2px solid Highlight;/);
    assert.match(FC, /:focus-visible \{ outline-color: Highlight; \}/);
  });
  test('نمودار: میله‌ها با CanvasText و الگوی راه‌راه (بدون اتکا به رنگ)', () => {
    assert.match(FC, /\.chart \.bar-a, \.chart \.pat-bg \{ fill: CanvasText; \}/);
    assert.match(FC, /\.chart \.pat-ln \{ stroke: Canvas; \}/);
    assert.match(FC, /\.legend \.lg-b \{ background: repeating-linear-gradient\(45deg, CanvasText/);
  });
  test('بلوک forced-colors فقط از سیستم‌رنگ‌ها استفاده می‌کند (بدون هگز/توکن رنگی)', () => {
    assert.doesNotMatch(FC, /#[0-9a-fA-F]{3,8}\b|rgba?\(/);
    assert.doesNotMatch(FC.replace(/outline-offset[^;]*;/g, ''), /var\(--(?:green|brand|accent|orange|red)\b/);
  });
});

// ---------- ۴) چاپ ----------
describe('T8: چاپ', () => {
  const PRINT = mediaBlocks(CSS, '@media print').join('\n');
  test('ریل، نوار بالا، کشو، تولتیپ و دکمه‌ها در چاپ پنهان؛ محتوا بدون حاشیه‌ی ریل', () => {
    assert.match(PRINT, /\.skeleton, \.sidebar, \.topbar, \.sidebar-backdrop, \.bell-drawer[^}]*display: none !important;/);
    assert.match(PRINT, /\.rail-tip, #rail-tip \{ display: none !important; \}/);
    assert.match(PRINT, /\.content \{ margin: 0 !important; \}/);
  });
  test('پالت روشن اجباری، جدول با خط، سرستون تکرارشونده و نمای هفته کم‌جوهر', () => {
    assert.match(PRINT, /--bg: #fff;[^}]*--rail: #fff;[^}]*--rail-text: #000;/);
    assert.match(PRINT, /th, td \{ border: 1px solid #999 !important;/);
    assert.match(PRINT, /thead \{ display: table-header-group; \}/);
    assert.match(PRINT, /\.day-card\.is-today > summary \{ box-shadow: none; \}/);
  });
});

// ---------- ۵) ریسپانسیو (۳۲۰ / ۷۶۸ / ۱۴۴۰) ----------
describe('T8: ریسپانسیو و بدون اسکرول افقیِ صفحه', () => {
  test('viewport بدون قفل zoom و safe-area', () => {
    assert.match(HTML, /<meta name="viewport" content="[^"]*width=device-width[^"]*"/);
    assert.doesNotMatch(HTML, /user-scalable=no|maximum-scale=1(?![\d.])/);
  });
  test('تب‌ها و جدول‌ها در کانتینر خودشان اسکرول می‌کنند', () => {
    assert.match(block(CSS, '.tabs'), /overflow-x: auto;/);
    assert.match(CSS, /\.table-wrap \{ overflow-x: auto; \}/);
    assert.match(CSS, /\.st-nav nav \{[^}]*overflow-x: auto;/);
  });
  test('≤ ۹۰۰px: محتوا بدون حاشیه‌ی ریل و ریل به کشو تبدیل می‌شود؛ ≥ ۹۰۱px نوچ فقط دسکتاپ', () => {
    const m900 = mediaBlocks(CSS, '@media (max-width: 900px)').join('\n');
    assert.match(m900, /\.content \{ margin-right: 0; \}/);
    assert.match(m900, /\.sidebar \{[^}]*transform: translateX\(100%\)/);
    const m901 = mediaBlocks(CSS, '@media (min-width: 901px)').join('\n');
    assert.match(m901, /\.nav-item\.active::before/);
    assert.doesNotMatch(m900, /\.nav-item\.active::before/);
  });
  test('شبکه‌ی آمار و فیلدها در موبایل تک/دو‌ستونه می‌شوند (۳۲۰px بدون سرریز)', () => {
    assert.match(CSS, /\.stat-grid \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
    assert.match(CSS, /\.form-grid \{ grid-template-columns: 1fr; \}/);
    assert.match(CSS, /@media \(max-width: 980px\) \{ \.week-grid \{ grid-template-columns: 1fr; \} \}/);
  });
});

// ---------- ۶) RTL ----------
describe('T8: RTL', () => {
  test('ریل سمت راست؛ قرص فعال و نوچ برای قرارگیری سمت چپِ ریل (سمت محتوا) آینه‌اند', () => {
    assert.match(block(CSS, '.sidebar'), /right: 16px;/);
    assert.match(CSS, /\.nav-item\.active \{ margin-inline-end: 0; border-radius: 0 24px 24px 0; \}/);
    assert.match(CSS, /\.nav-item\.active::before,\n\s+\.nav-item\.active::after \{ content: ""; position: absolute; left: 0;/);
    assert.match(CSS, /radial-gradient\(circle at 100% 0, transparent 20px, var\(--bg\) 20\.5px\)/);
  });
  test('عدد/ساعت/شمارنده‌ها و تاریخ‌ها ایزوله‌ی بیدی دارند', () => {
    const m = CSS.match(/\n(\.ltr, \.num[^{]*)\{ unicode-bidi: isolate; \}/);
    assert.ok(m, 'قاعده‌ی ایزوله');
    for (const sel of ['time', '.nav-count', '.bell-count', '.st-count', '.stat-value', '.cal-day .cal-d', '.sch-d', '.day-card-date']) assert.ok(m[1].includes(sel), sel);
  });
  test('آیکن جهت‌دار (فلش/شورون) در پنل نیست؛ ناوبری قبلی/بعدی با متن فارسی است', () => {
    const icons = read('public-admin/js/core.js');
    assert.doesNotMatch(icons, /icon\('(?:chevron|arrow)[^']*'|chevron-(?:left|right)|arrow-(?:left|right)/);
    assert.match(read('public-admin/js/views-weekly.js'), /◀ هفته‌ی قبل[\s\S]*هفته‌ی بعد ▶/); // فلش‌ها نویسه‌ی متنی‌اند و جهتشان در test/rtlMobile.test.js بررسی می‌شود
  });
});

// ---------- ۷) تم: localStorage خالی / مسدود ----------
describe('T8: theme.js با localStorage خالی و مسدود', () => {
  const SRC = read('public/js/theme.js');
  function load({ storage, dark, metas = { 'default-theme': 'light', 'theme-bg-dark': '#17143a', 'theme-bg-light': '#ffffff' } }) {
    const attrs = {}; const themeMeta = {}; const store = {};
    const doc = {
      documentElement: { setAttribute: (k, v) => { attrs[k] = v; } },
      querySelector: (sel) => {
        const m = sel.match(/meta\[name="([^"]+)"\]/);
        if (!m) return null;
        if (m[1] === 'theme-color') return { setAttribute: (k, v) => { themeMeta[k] = v; } };
        return metas[m[1]] ? { getAttribute: () => metas[m[1]] } : null;
      },
      querySelectorAll: () => [], addEventListener() {},
    };
    const win = { document: doc, Telegram: undefined };
    if (storage === 'blocked') Object.defineProperty(win, 'localStorage', { get() { throw new Error('SecurityError'); } });
    else win.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
    if (dark !== undefined) win.matchMedia = () => ({ matches: dark, addEventListener() {} });
    const ctx = vm.createContext({ window: win, module: { exports: {} } });
    vm.runInContext(SRC, ctx);
    return { Theme: win.Theme, attrs, themeMeta, store };
  }
  test('localStorage خالی + سیستم نامعلوم ⇒ روشن (default-theme=light) و meta theme-color سفید', () => {
    const { Theme, attrs, themeMeta } = load({ storage: 'empty' });
    assert.equal(Theme.get(), 'auto');
    assert.equal(attrs['data-theme'], 'light');
    assert.equal(themeMeta.content, '#ffffff');
  });
  test('localStorage خالی + سیستم تیره + حالت خودکار ⇒ تیره؛ انتخاب کاربر بر سیستم می‌چربد', () => {
    const a = load({ storage: 'empty', dark: true });
    assert.equal(a.attrs['data-theme'], 'dark');
    assert.equal(a.themeMeta.content, '#17143a');
    assert.equal(a.Theme.set('light'), 'light');
    assert.equal(a.store.theme, 'light');
    assert.equal(a.Theme.set('auto'), 'dark');
    assert.equal('theme' in a.store, false);
  });
  test('localStorage مسدود (حالت خصوصی/SecurityError): نه می‌ترکد نه تم را از دست می‌دهد', () => {
    const { Theme, attrs } = load({ storage: 'blocked', dark: false });
    assert.equal(Theme.get(), 'auto');
    assert.equal(attrs['data-theme'], 'light');
    assert.doesNotThrow(() => Theme.set('dark'));
    assert.equal(attrs['data-theme'], 'dark');
    assert.doesNotThrow(() => Theme.cycle());
  });
  test('مقدار خراب در localStorage نادیده گرفته می‌شود', () => {
    const win = load({ storage: 'empty' });
    assert.equal(win.Theme.normalize('purple'), 'auto');
  });
});

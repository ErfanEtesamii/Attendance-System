// فاز ۱۶ / T6 بخش ۳: تاریخ‌گزین و toast — بررسی ایستا از روی CSS واقعی + کنتراست AA.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const CSS = read('public-admin/css/style.css');
const DP = read('public-admin/css/datepicker.css');
const HTML = read('public-admin/index.html');

const parseColor = (v) => {
  v = v.trim();
  let m = v.match(/^#([0-9a-f]{6})$/i);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)).concat(1);
  m = v.match(/^rgba?\(([^)]+)\)$/);
  if (m) { const p = m[1].split(',').map((x) => parseFloat(x)); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; }
  throw new Error(`رنگ نامعتبر: ${v}`);
};
const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
function block(css, selector) {
  const i = css.indexOf(`${selector} {`);
  assert.ok(i >= 0, `بلاک ${selector} نیست`);
  return css.slice(i + selector.length + 2, css.indexOf('\n}', i));
}
const varsOf = (txt) => Object.fromEntries([...txt.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const THEMES = { dark: varsOf(block(CSS, ':root,\n:root[data-theme="dark"]')), light: varsOf(block(CSS, ':root[data-theme="light"]')) };

const STRIPPED = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
const ruleList = [...STRIPPED.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sels: m[1].split(/,(?![^(]*\))/).map((x) => x.trim()), body: m[2].trim() }));
const SCREEN = ruleList.filter((r) => !/!important/.test(r.body));
function bodies(sel) {
  const out = SCREEN.filter((r) => r.sels.includes(sel)).map((r) => r.body);
  assert.ok(out.length, `قاعده‌ی ${sel} نیست`);
  return out.join(' ');
}

for (const mode of ['dark', 'light']) {
  const v = THEMES[mode];
  const c = (k) => parseColor(v[k]);
  describe(`T6-3 / ${mode}: کنتراست`, () => {
    test('تاریخ‌گزین روی --card: متن --text، عنوان/لینک --brand، روز هفته --hint، جمعه --red ≥ ۴٫۵:۱', () => {
      assert.ok(ratio(c('text'), c('card')) >= 4.5, 'text/card');
      assert.ok(ratio(c('brand'), c('card')) >= 4.5, 'brand/card');
      assert.ok(ratio(c('hint'), c('card')) >= 4.5, 'hint/card');
      assert.ok(ratio(c('red'), c('card')) >= 4.5, `red/card ${ratio(c('red'), c('card')).toFixed(2)}`);
    });
    test('هاور روز/دکمه (--card-2): --text، --brand، --red ≥ ۴٫۵:۱', () => {
      assert.ok(ratio(c('text'), c('card-2')) >= 4.5, 'text/card-2');
      assert.ok(ratio(c('brand'), c('card-2')) >= 4.5, 'brand/card-2');
      assert.ok(ratio(c('red'), c('card-2')) >= 4.5, `red/card-2 ${ratio(c('red'), c('card-2')).toFixed(2)}`);
      assert.ok(ratio(c('hint'), c('card-2')) >= 4.5, 'hint/card-2');
    });
    test('روز انتخاب‌شده: --on-brand روی --brand ≥ ۴٫۵:۱؛ حلقه‌ی «امروز» (--brand) روی --card ≥ ۳:۱ و حلقه‌ی --on-brand روی --brand ≥ ۳:۱', () => {
      assert.ok(ratio(c('on-brand'), c('brand')) >= 4.5, `on-brand/brand ${ratio(c('on-brand'), c('brand')).toFixed(2)}`);
      assert.ok(ratio(c('brand'), c('card')) >= 3, 'ring brand/card');
      assert.ok(ratio(c('brand'), c('card-2')) >= 3, 'ring brand/card-2');
    });
    test('toast عادی: --on-brand روی --brand ≥ ۴٫۵:۱؛ toast خطا: سفید روی --red-solid ≥ ۴٫۵:۱', () => {
      assert.ok(ratio(c('on-brand'), c('brand')) >= 4.5, 'on-brand/brand');
      assert.ok(ratio([255, 255, 255, 1], c('red-solid')) >= 4.5, `white/red-solid ${ratio([255, 255, 255, 1], c('red-solid')).toFixed(2)}`);
    });
    test('متن روی --card-2 (سراسری): --text و --hint ≥ ۴٫۵:۱', () => {
      assert.ok(ratio(c('text'), c('card-2')) >= 4.5, 'text/card-2');
      assert.ok(ratio(c('hint'), c('card-2')) >= 4.5, 'hint/card-2');
    });
  });
}

describe('T6-3: ساختار CSS — تاریخ‌گزین', () => {
  test('سطح --card، بدون border، گوشه‌ی گرد، سایه‌ی توکنی + حلقه‌ی --border', () => {
    const b = bodies('.jdp-pop');
    assert.match(b, /background:\s*var\(--card\)/);
    assert.match(b, /border:\s*0/);
    assert.match(b, /border-radius:\s*16px/);
    assert.match(b, /box-shadow:\s*var\(--shadow\),\s*0 0 0 1px var\(--border\)/);
  });
  test('عنوان و لینک --brand (نه --green)؛ روز هفته --hint؛ جمعه --red', () => {
    assert.match(bodies('.jdp-title'), /color:\s*var\(--brand\)/);
    assert.match(bodies('.jdp-link'), /color:\s*var\(--brand\)/);
    assert.match(bodies('.jdp-wd'), /color:\s*var\(--hint\)/);
    assert.match(bodies('.jdp-fri'), /color:\s*var\(--red\)/);
  });
  test('هاور روز/ناوبری/لینک = --card-2؛ فوکوس کیبورد حلقه‌ی ۲px --brand', () => {
    const hov = SCREEN.find((r) => r.sels.includes('.jdp-day:hover:not(:disabled)'));
    assert.ok(hov && /background:\s*var\(--card-2\)/.test(hov.body));
    assert.ok(hov.sels.includes('.jdp-nav:hover:not(:disabled)') && hov.sels.includes('.jdp-link:hover:not(:disabled)'));
    const foc = SCREEN.find((r) => r.sels.includes('.jdp-day:focus-visible'));
    assert.ok(foc && /outline:\s*2px solid var\(--brand\)/.test(foc.body));
  });
  test('امروز: حلقه‌ی ۲px --brand؛ انتخاب‌شده: --brand با --on-brand (حتی هنگام هاور)؛ امروزِ انتخاب‌شده حلقه‌ی --on-brand', () => {
    assert.match(bodies('.jdp-today'), /box-shadow:\s*inset 0 0 0 2px var\(--brand\)/);
    const sel = SCREEN.find((r) => r.sels.includes('.jdp-selected:hover:not(:disabled)'));
    assert.ok(sel && /background:\s*var\(--brand\)/.test(sel.body) && /color:\s*var\(--on-brand\)/.test(sel.body));
    assert.match(bodies('.jdp-selected.jdp-today'), /inset 0 0 0 2px var\(--on-brand\)/);
  });
  test('ترتیب قاعده‌ها: .jdp-fri پیش از .jdp-selected (روز انتخاب‌شده‌ی جمعه سفید/on-brand بماند)', () => {
    assert.ok(CSS.indexOf('.jdp-fri {') < CSS.indexOf('.jdp-selected, .jdp-selected:hover'));
  });
  test('هیچ hex و هیچ rgba سفید و هیچ --green/--blue در قاعده‌های تاریخ‌گزینِ پنل', () => {
    const sels = SCREEN.filter((r) => r.sels.some((x) => /^\.jdp-/.test(x)) && !/^\s*$/.test(r.body));
    // فقط قاعده‌های بلوک T6-3 (بعد از کامنتِ آن)؛ قاعده‌ی لمسیِ ریسپانسیو هم رنگی ندارد
    assert.ok(sels.length >= 8);
    for (const r of sels) {
      assert.doesNotMatch(r.body, /#[0-9a-fA-F]{3,8}\b/, `${r.sels[0]}: hex`);
      assert.doesNotMatch(r.body, /rgba\(255/, `${r.sels[0]}: rgba سفید`);
      assert.doesNotMatch(r.body, /var\(--(green|blue)/, `${r.sels[0]}: رنگ قدیمی`);
    }
  });
  test('هدف لمسی تاریخ‌گزین در موبایل ≥ ۴۰px (قاعده‌ی ریسپانسیو حفظ شده)', () => {
    assert.match(CSS, /\.jdp-day, \.jdp-nav, \.jdp-link \{ min-height: 40px; min-width: 40px; \}/);
  });
});

describe('T6-3: datepicker.css مشترک با Mini App دست‌نخورده می‌ماند', () => {
  test('مقادیر پیش‌فرض Mini App (var(--card, #2a2b40) …) هنوز هستند؛ بدون @import/url', () => {
    assert.match(DP, /\.jdp-pop \{[^}]*var\(--card, #2a2b40\)/);
    assert.match(DP, /\.jdp-selected, \.jdp-selected:hover:not\(:disabled\) \{ background: var\(--green, #1fcf95\)/);
    assert.doesNotMatch(DP, /@import|url\(/);
  });
  test('Mini App: datepicker.css پیش از style.css آن لینک شده و از توکن‌های پنل استفاده نمی‌کند', () => {
    const mini = read('public/index.html');
    assert.ok(mini.indexOf('/admin/css/datepicker.css') < mini.indexOf('/css/style.css'));
    assert.doesNotMatch(read('public/css/style.css'), /--brand-soft|--on-brand/);
  });
  test('پنل: datepicker.css پیش از style.css لینک شده تا override توکنی غلبه کند', () => {
    assert.ok(HTML.indexOf('/admin/css/datepicker.css') > 0);
    assert.ok(HTML.indexOf('/admin/css/datepicker.css') < HTML.indexOf('/admin/css/style.css'));
    assert.ok(HTML.indexOf('/admin/css/style.css') < HTML.indexOf('/admin/css/notebook.css'));
  });
  test('قاعده‌های خطای فیلد (border-color قرمز) در datepicker.css سر جایشان (T5)', () => {
    assert.match(DP, /\.jdp-input\[aria-invalid="true"\] \{ border-color: var\(--red/);
    assert.match(DP, /\.time-err \{[^}]*color: var\(--red/);
  });
});

describe('T6-3: ساختار CSS — toast', () => {
  test('سطح معکوس --brand با متن --on-brand، بدون border، سایه‌ی توکنی، موقعیت و z-index حفظ', () => {
    const b = bodies('.toast');
    assert.match(b, /background:\s*var\(--brand\)/);
    assert.match(b, /color:\s*var\(--on-brand\)/);
    assert.match(b, /box-shadow:\s*var\(--shadow\)/);
    assert.doesNotMatch(b, /border:\s*1px/);
    assert.match(b, /position:\s*fixed/);
    assert.match(b, /bottom:\s*26px/);
    assert.match(b, /z-index:\s*200/);
    assert.match(b, /max-width:\s*calc\(100vw - 32px\)/);
  });
  test('toast خطا: --red-solid با متن سفید و آیکن «!»؛ toast عادی آیکن «✓» (نوع پیام فقط با رنگ نیست)', () => {
    const e = bodies('.toast.err');
    assert.match(e, /background:\s*var\(--red-solid\)/);
    assert.match(e, /color:\s*#fff/);
    assert.doesNotMatch(e, /border/);
    assert.match(bodies('.toast::before'), /content:\s*"\\2713"/);
    assert.match(bodies('.toast.err::before'), /content:\s*"!"/);
  });
  test('JS دست‌نخورده: AP.toast همان کلاس err، نقش alert/status و textContent (نه innerHTML) را می‌گذارد', () => {
    const core = read('public-admin/js/core.js');
    const fn = core.slice(core.indexOf('AP.toast = function toast'), core.indexOf('// ---------- API'));
    assert.match(fn, /el\.textContent = msg/);
    assert.match(fn, /classList\.toggle\('err', !!isErr\)/);
    assert.match(fn, /setAttribute\('role', isErr \? 'alert' : 'status'\)/);
    assert.doesNotMatch(fn, /innerHTML/);
    assert.match(HTML, /id="toast"[^>]*role="status"[^>]*aria-live="polite"/);
  });
  test('بلوک چاپ: toast مخفی', () => {
    assert.match(CSS, /\.toast-wrap[^{}]*\{\s*display:\s*none\s*!important/);
  });
});

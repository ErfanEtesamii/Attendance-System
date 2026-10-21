// فاز ۱۶ / T6 بخش ۱: جدول‌ها، اسکلت بارگذاری و حالت خالی/خطا — بررسی ایستا از روی CSS واقعی + کنتراست AA.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const CSS = read('public-admin/css/style.css');
const TOKENS = read('public/css/tokens.css');

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
const varsOf = (txt) => Object.fromEntries([...txt.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const THEMES = { dark: varsOf(block(TOKENS, ':root,\n:root[data-theme="dark"]')), light: varsOf(block(TOKENS, ':root[data-theme="light"]')) };

const STRIPPED = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
const ruleList = [...STRIPPED.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sels: m[1].split(/,(?![^(]*\))/).map((x) => x.trim()), body: m[2].trim() }));
// بلوک @media print (پالت روشنِ اجباری، با !important) عمداً جداست و دست‌نخورده می‌ماند
const SCREEN = ruleList.filter((r) => !/!important/.test(r.body));
function bodies(sel) {
  const out = SCREEN.filter((r) => r.sels.includes(sel)).map((r) => r.body);
  assert.ok(out.length, `قاعده‌ی ${sel} نیست`);
  return out.join(' ');
}

for (const mode of ['dark', 'light']) {
  const v = THEMES[mode];
  const c = (k) => parseColor(v[k]);
  describe(`T6-1 / ${mode}: کنتراست`, () => {
    test('سرستون: --hint و --text روی --card-2 ≥ ۴٫۵:۱', () => {
      assert.ok(ratio(c('hint'), c('card-2')) >= 4.5, `hint/card-2 ${ratio(c('hint'), c('card-2')).toFixed(2)}`);
      assert.ok(ratio(c('text'), c('card-2')) >= 4.5, 'text/card-2 (hover و مرتب‌سازی فعال)');
    });
    test('hover ردیف (--ov-04): text و hint روی card و bg و card-2', () => {
      for (const s of ['card', 'bg', 'card-2']) {
        const base = over(c('ov-04'), c(s));
        assert.ok(ratio(c('text'), base) >= 4.5, `${mode} text روی ${s}+ov-04`);
        assert.ok(ratio(c('hint'), base) >= 4.5, `${mode} hint روی ${s}+ov-04`);
      }
    });
    test('حالت خالی: آیکن brand روی brand-soft و حالت خطا: red روی red-soft ≥ ۳:۱ (روی card و bg)', () => {
      for (const s of ['card', 'bg']) {
        assert.ok(ratio(c('brand'), over(c('brand-soft'), c(s))) >= 3, `${mode} brand/brand-soft روی ${s}`);
        assert.ok(ratio(c('red'), over(c('red-soft'), c(s))) >= 3, `${mode} red/red-soft روی ${s}`);
        assert.ok(ratio(c('hint'), c(s)) >= 4.5, `${mode} متن خالی hint روی ${s}`);
        assert.ok(ratio(c('text'), c(s)) >= 4.5, `${mode} متن خطا text روی ${s}`);
      }
    });
    test('اسکلت: خط --card-2 روی --bg و --card قابل‌تشخیص و شیمر (card-2 → card) بدون سفیدِ خام', () => {
      assert.ok(ratio(c('card-2'), c('bg')) >= 1.1, `${mode} card-2/bg`);
      assert.notEqual(v['card-2'], v.card);
    });
  });
}

describe('T6-1: ساختار CSS', () => {
  test('سرستون: تخت --card-2 با متن --hint؛ بدون گرادیان/سبز/on-green', () => {
    const b = bodies('thead th');
    assert.match(b, /background:\s*var\(--card-2\)/);
    assert.match(b, /color:\s*var\(--hint\)/);
    assert.match(b, /position:\s*sticky/);
    assert.doesNotMatch(b, /gradient|--green|--on-green|#[0-9a-f]{3,6}/i);
    assert.doesNotMatch(bodies('thead th.sortable:hover'), /gradient|--green|background:/);
  });
  test('هاور سرستون مرتب‌پذیر: رنگ --text + زیرخط نارنجی (مات می‌ماند)', () => {
    const b = bodies('thead th.sortable:hover');
    assert.match(b, /color:\s*var\(--text\)/);
    assert.match(b, /var\(--accent\)/);
  });
  test('ردیف‌ها: فقط خط افقی نازک؛ هاور --ov-04؛ بدون خط عمودی', () => {
    assert.match(bodies('tbody td'), /border-bottom:\s*1px solid var\(--border\)/);
    assert.doesNotMatch(bodies('tbody td'), /border-(left|right|inline)/);
    assert.match(bodies('tbody tr:hover'), /background:\s*var\(--ov-04\)/);
    assert.match(bodies('.cal-table tbody tr:hover'), /background:\s*none/);
  });
  test('.table-wrap: اسکرول افقی و گوشه‌ی گرد حفظ شد؛ چاپ دست‌نخورده', () => {
    assert.match(CSS, /\.table-wrap \{ overflow-x: auto; \}/);
    assert.match(bodies('.table-wrap'), /border-radius:\s*var\(--radius-sm\)/);
    assert.match(CSS, /th, td \{ border: 1px solid #999 !important/);
    assert.match(CSS, /thead th \{ background: #e6e6e6 !important/);
  });
  test('هدر تقویم (.cal-name) از توکن؛ هیچ #14a878 یا گرادیان سبزی در جدول‌ها نمانده', () => {
    assert.match(bodies('.cal-table thead th.cal-name'), /background:\s*var\(--card-2\)/);
    const noTokens = STRIPPED.split('\n').filter((l) => !/^\s*--[a-z0-9-]+:/.test(l)).join('\n');
    assert.doesNotMatch(noTokens, /#14a878|#25d9a0|#2ee6ab|#17b583/i);
  });
  test('حالت خالی/خطا: آیکن گرد brand-soft؛ خطا red-soft؛ متن خطا --text؛ بدون opacity کم', () => {
    assert.match(bodies('.empty svg'), /background:\s*var\(--brand-soft\)/);
    assert.match(bodies('.empty svg'), /color:\s*var\(--brand\)/);
    assert.doesNotMatch(bodies('.empty svg'), /opacity/);
    assert.match(bodies('.empty[role="alert"] svg'), /background:\s*var\(--red-soft\)/);
    assert.match(bodies('.empty[role="alert"] svg'), /color:\s*var\(--red\)/);
    assert.match(bodies('.empty[role="alert"]'), /color:\s*var\(--text\)/);
  });
  test('اسکلت: خط --card-2، شیمر card-2 ← card، بدون حاشیه و بدون ov-*؛ reduced-motion حفظ', () => {
    assert.match(bodies('.sk-line'), /background:\s*var\(--card-2\)/);
    const sh = bodies('.sk-line::after');
    assert.match(sh, /linear-gradient\(90deg,\s*var\(--card-2\),\s*var\(--card\),\s*var\(--card-2\)\)/);
    assert.doesNotMatch(sh, /--ov-|rgba\(255/);
    assert.match(bodies('.sk-box'), /border:\s*0/);
    assert.match(CSS, /@media \(prefers-reduced-motion: reduce\) \{ \.sk-line::after \{ animation: none; \} \}/);
  });
  test('جدول موبایلِ تخت (data-stack): بدون حاشیه و سایه', () => {
    const rules = ruleList.filter((r) => r.sels.includes('table[data-stack] tr')).map((r) => r.body).join(' ');
    assert.match(rules, /border:\s*0/);
    assert.doesNotMatch(rules, /box-shadow:\s*var\(--shadow\)/);
  });
});

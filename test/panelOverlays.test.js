// فاز ۱۶ / T6 بخش ۲: مودال، کشوی زنگوله و منوی نتایج جستجو — بررسی ایستا از روی CSS واقعی + کنتراست AA.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const CSS = read('public-admin/css/style.css');

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
  describe(`T6-2 / ${mode}: کنتراست`, () => {
    test('مودال و کشو (سطح --card): عنوان --brand، متن --text و --hint ≥ ۴٫۵:۱', () => {
      assert.ok(ratio(c('brand'), c('card')) >= 4.5, `brand/card ${ratio(c('brand'), c('card')).toFixed(2)}`);
      assert.ok(ratio(c('text'), c('card')) >= 4.5, 'text/card');
      assert.ok(ratio(c('hint'), c('card')) >= 4.5, 'hint/card');
    });
    test('دکمه‌ی بستن: آیکن --hint (عادی) و --text (hover) روی --card-2 (+ ov-08) ≥ ۳:۱', () => {
      assert.ok(ratio(c('hint'), c('card-2')) >= 3, 'hint/card-2');
      assert.ok(ratio(c('text'), over(c('ov-08'), c('card-2'))) >= 4.5, 'text/card-2+ov-08');
    });
    test('اعلان خوانده‌نشده (--brand-soft روی --card): متن --text/--hint ≥ ۴٫۵:۱، نقطه‌ی --brand ≥ ۳:۱', () => {
      const base = over(c('brand-soft'), c('card'));
      assert.ok(ratio(c('text'), base) >= 4.5, `text روی unread ${ratio(c('text'), base).toFixed(2)}`);
      assert.ok(ratio(c('hint'), base) >= 4.5, `hint روی unread ${ratio(c('hint'), base).toFixed(2)}`);
      assert.ok(ratio(c('brand'), base) >= 3, 'نقطه‌ی brand روی unread');
    });
    test('هاور اعلان‌دارای‌لینک (--ov-04) روی card و روی unread: --text ≥ ۴٫۵:۱ (متن فرعی هنگام هاور --text می‌شود)؛ --hint فقط روی card', () => {
      for (const base0 of [c('card'), over(c('brand-soft'), c('card'))]) {
        assert.ok(ratio(c('text'), over(c('ov-04'), base0)) >= 4.5, 'text');
      }
      assert.ok(ratio(c('hint'), over(c('ov-04'), c('card'))) >= 4.5, 'hint روی card+ov-04');
    });
    test('منوی جستجو: متن --text و --hint روی --card و روی هاور --brand-soft ≥ ۴٫۵:۱', () => {
      for (const base of [c('card'), over(c('brand-soft'), c('card'))]) {
        assert.ok(ratio(c('text'), base) >= 4.5, `text ${ratio(c('text'), base).toFixed(2)}`);
        assert.ok(ratio(c('hint'), base) >= 4.5, `hint ${ratio(c('hint'), base).toFixed(2)}`);
      }
    });
    test('حلقه‌ی فوکوس --brand روی --card و روی --brand-soft ≥ ۳:۱', () => {
      assert.ok(ratio(c('brand'), c('card')) >= 3, 'brand/card');
      assert.ok(ratio(c('brand'), over(c('brand-soft'), c('card'))) >= 3, 'brand/brand-soft');
    });
    test('نشان شمارنده‌ی زنگوله: سفید روی --red-solid ≥ ۴٫۵:۱', () => {
      assert.ok(ratio([255, 255, 255, 1], c('red-solid')) >= 4.5, 'white/red-solid');
    });
  });
}

describe('T6-2: ساختار CSS — مودال', () => {
  test('سطح --card، گوشه‌ی --radius، بدون حاشیه، سایه‌ی ملایم توکنی (نه 0.55 سخت‌کد)', () => {
    const b = bodies('.modal');
    assert.match(b, /background:\s*var\(--card\)/);
    assert.match(b, /border-radius:\s*var\(--radius\)/);
    assert.match(b, /box-shadow:\s*var\(--shadow\)/);
    assert.doesNotMatch(b, /\bborder:\s*1px/);
    assert.doesNotMatch(b, /rgba\(0,\s*0,\s*0/);
  });
  test('backdrop: rgba تیره (نه سفید) با blur حفظ‌شده', () => {
    const b = bodies('.modal-backdrop');
    assert.match(b, /background:\s*rgba\(23,\s*20,\s*58/);
    assert.match(b, /backdrop-filter:\s*blur/);
    assert.doesNotMatch(b, /rgba\(255/);
  });
  test('عنوان مودال --brand؛ دکمه‌ی بستن روی --card-2 با hover لایه‌ی --ov-08', () => {
    assert.match(bodies('.modal-head h3'), /color:\s*var\(--brand\)/);
    assert.match(bodies('.modal .icon-btn'), /background:\s*var\(--card-2\)/);
    assert.match(bodies('.modal .icon-btn:hover'), /linear-gradient\(var\(--ov-08\)/);
  });
  test('ریسپانسیو ≤ ۹۰۰px: padding کمتر ولی گوشه‌ی گرد حفظ شود؛ فیلد داخل مودال همچنان --card-2 (T5)', () => {
    assert.match(CSS, /\.modal \{ padding: 20px; border-radius: 24px; \}/);
    assert.match(CSS, /\.modal :where\([^)]*\)[^{]*\{ background: var\(--card-2\); \}/s);
  });
  test('ارتفاع/اسکرول و --kb مودال دست‌نخورده (ایجاد نشکند)', () => {
    const b = bodies('.modal');
    assert.match(b, /max-height:\s*calc\(100vh - 32px - var\(--kb, 0px\)\)/);
    assert.match(b, /overflow-y:\s*auto/);
  });
});

describe('T6-2: ساختار CSS — کشوی زنگوله', () => {
  test('سطح --card، لبه‌ی چسبیده صاف و سمت محتوا --radius، بدون border-right', () => {
    const b = bodies('.bell-drawer');
    assert.match(b, /background:\s*var\(--card\)/);
    assert.match(b, /border-radius:\s*0 var\(--radius\) var\(--radius\) 0/);
    assert.doesNotMatch(b, /border-right/);
  });
  test('سایه‌ی بازشده توکنی؛ مکانیزم visibility/transform و reduced-motion حفظ', () => {
    assert.match(bodies('.bell-drawer.open'), /box-shadow:\s*var\(--shadow\)/);
    assert.match(bodies('.bell-drawer'), /visibility:\s*hidden/);
    assert.match(CSS, /prefers-reduced-motion: reduce\) \{\s*\.bell-drawer, \.bell-drawer\.open \{ transition: none; \}/);
  });
  test('backdrop زنگوله rgba تیره؛ در موبایل تمام‌عرض و بدون گوشه‌ی گرد', () => {
    assert.match(bodies('.bell-backdrop.open'), /rgba\(23,\s*20,\s*58/);
    assert.match(CSS, /\.bell-drawer \{ width: 100vw; border-radius: 0; \}/);
  });
  test('عنوان --brand؛ unread و نقطه از --brand-soft/--brand (نه purple)؛ فوکوس --brand', () => {
    assert.match(bodies('.bell-head h3'), /color:\s*var\(--brand\)/);
    assert.match(bodies('.bell-item.unread'), /var\(--brand-soft\)/);
    assert.match(bodies('.bell-item.unread .bell-dot'), /var\(--brand\)/);
    assert.doesNotMatch(bodies('.bell-item.unread') + bodies('.bell-item.unread .bell-dot'), /purple/);
    assert.match(bodies('.bell-main:focus-visible'), /outline:\s*2px solid var\(--brand\)/);
    assert.match(CSS, /\.bell-item\.has-link \.bell-main:hover \.bell-body, \.bell-item\.has-link \.bell-main:hover \.bell-time \{ color: var\(--text\); \}/);
  });
  test('نشان عدد: سفید روی --red-solid و حلقه‌ی --bg (دست‌نخورده)', () => {
    const b = bodies('.bell-count');
    assert.match(b, /background:\s*var\(--red-solid\)/);
    assert.match(b, /border:\s*2px solid var\(--bg\)/);
  });
});

describe('T6-2: ساختار CSS — منوی نتایج جستجو', () => {
  test('--card، بدون حاشیه، سایه‌ی شناور، گوشه‌ی گرد', () => {
    const b = bodies('.search-results');
    assert.match(b, /background:\s*var\(--card\)/);
    assert.match(b, /box-shadow:\s*var\(--shadow\)/);
    assert.match(b, /border-radius:\s*16px/);
    assert.doesNotMatch(b, /border:\s*1px/);
  });
  test('hover و فوکوس کیبورد آیتم = --brand-soft (و حلقه‌ی --brand)', () => {
    assert.match(bodies('.search-item:hover'), /background:\s*var\(--brand-soft\)/);
    const f = bodies('.search-item:focus-visible');
    assert.match(f, /background:\s*var\(--brand-soft\)/);
    assert.match(f, /outline:\s*2px solid var\(--brand\)/);
  });
});

describe('T6-2: قواعد عمومی', () => {
  const scope = ['.modal', '.modal-backdrop', '.modal-head h3', '.bell-drawer', '.bell-drawer.open', '.bell-backdrop.open', '.bell-head', '.bell-head h3', '.bell-item.unread', '.search-results', '.search-item:hover'];
  test('هیچ hex/rgba سفیدِ سخت‌کد و هیچ --green/--purple در قاعده‌های این بخش', () => {
    for (const sel of scope) {
      const b = bodies(sel);
      assert.doesNotMatch(b, /rgba\(255/, `${sel}: rgba سفید`);
      assert.doesNotMatch(b, /#[0-9a-fA-F]{3,8}\b/, `${sel}: hex سخت‌کد`);
      assert.doesNotMatch(b, /var\(--(green|purple)/, `${sel}: رنگ برندِ قدیمی`);
    }
  });
  test('بلوک چاپ: کشوی زنگوله همچنان مخفی', () => {
    assert.match(CSS, /\.bell-drawer[^{}]*\{\s*display:\s*none\s*!important/);
  });
  test('idها و کلاس‌های وابسته‌ی JS در index.html/core.js/bell.js سر جایشان (دست‌نخورده)', () => {
    const html = read('public-admin/index.html');
    for (const id of ['bell-drawer', 'bell-backdrop', 'bell-close', 'bell-mark-all', 'bell-list', 'bell-more', 'modal-root', 'search-results']) {
      assert.ok(html.includes(`id="${id}"`), `id=${id}`);
    }
    assert.ok(read('public-admin/js/core.js').includes('class="modal ${wide'), 'مارکاپ مودال');
  });
});

// فاز ۱۶ / T4: تب‌ها، چیپ‌ها، نشان‌ها، دکمه‌ها، آیکن‌های آمار و نوار پیشرفت — بررسی ایستا از روی CSS واقعی + کنتراست AA.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const CSS = read('public-admin/css/style.css');
const TOKENS = read('public/css/tokens.css');

// ---- ابزار رنگ (هم‌شکل theme.test.js) ----
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

// ---- ابزار CSS: همه‌ی بدنه‌های قاعده‌هایی که انتخابگرشان (دقیقاً) در فهرست انتخابگرها هست ----
const STRIPPED = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
function bodies(sel) {
  const out = [];
  for (const m of STRIPPED.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].split(',').map((x) => x.trim()).includes(sel)) out.push(m[2].trim());
  }
  assert.ok(out.length, `قاعده‌ی ${sel} نیست`);
  return out.join(' ');
}
const OLD_GREEN = /#7be495|#14a878|#25d9a0|#16b886|#2ee6ab|#3b3c5c|rgba\(\s*31,\s*207,\s*149/i;

const SURFACES = ['bg', 'card', 'card-2'];
for (const mode of ['dark', 'light']) {
  const v = THEMES[mode];
  const c = (k) => parseColor(v[k]);
  // رنگ نهایی یک لایه‌ی (نیمه‌شفاف) روی سطح
  const onSurface = (layer, surf) => over(c(layer), c(surf));

  describe(`T4 / ${mode}: کنتراست AA`, () => {
    test('نشان‌ها (badge): متن وضعیت روی پس‌زمینه‌ی نرمش، روی هر سه سطح', () => {
      const pairs = [['green', 'green-soft'], ['yellow', 'yellow-soft'], ['orange', 'orange-soft'], ['red-text', 'red-soft'], ['purple-text', 'purple-soft'], ['blue', 'blue-soft'], ['text', 'ov-08']];
      for (const [fg, soft] of pairs) {
        for (const s of SURFACES) {
          const bgc = onSurface(soft, s);
          const r = ratio(c(fg), bgc);
          assert.ok(r >= 4.5, `${mode} badge ${fg} روی ${soft}/${s}: ${r.toFixed(2)}`);
        }
      }
    });
    test('دکمه‌ها: primary (on-accent روی accent و hover=accent-dark)', () => {
      assert.ok(ratio(c('on-accent'), c('accent')) >= 4.5);
      assert.ok(ratio(c('on-accent'), c('accent-dark')) >= 4.5);
    });
    test('دکمه‌ها: ghost/danger/success در حالت عادی (و hover ghost) روی هر سه سطح', () => {
      for (const s of SURFACES) {
        const cases = [
          ['text', c('card-2'), 'ghost'],
          ['red-text', onSurface('red-soft', s), 'danger'],
          ['green', onSurface('green-soft', s), 'success'],
        ];
        for (const [fg, base, name] of cases) {
          assert.ok(ratio(c(fg), base) >= 4.5, `${mode} ${name}/${s}: ${ratio(c(fg), base).toFixed(2)}`);
          if (name === 'ghost') { // فقط ghost با لایه‌ی --ov-08 روشن/تیره می‌شود؛ danger/success با حلقه‌ی درونی (کنتراست متن ثابت)
            const hov = over(c('ov-08'), base);
            assert.ok(ratio(c(fg), hov) >= 4.5, `${mode} ghost:hover/${s}: ${ratio(c(fg), hov).toFixed(2)}`);
          }
        }
      }
    });
    test('چیپ: عادی (hint روی card)، hover (text روی card-2)، فعال (brand روی brand-soft)، شمارنده (text/brand روی bg)', () => {
      assert.ok(ratio(c('hint'), c('card')) >= 4.5);
      assert.ok(ratio(c('text'), c('card-2')) >= 4.5);
      for (const s of ['bg', 'card']) {
        const bgc = onSurface('brand-soft', s);
        assert.ok(ratio(c('brand'), bgc) >= 4.5, `${mode} chip.active روی ${s}: ${ratio(c('brand'), bgc).toFixed(2)}`);
      }
      assert.ok(ratio(c('text'), c('bg')) >= 4.5);
      assert.ok(ratio(c('brand'), c('bg')) >= 4.5);
    });
    test('تب: غیرفعال (hint) و hover (text) و فعال (teal-text) روی bg؛ فیروزه‌ای روی card هم AA', () => {
      assert.ok(ratio(c('hint'), c('bg')) >= 4.5);
      assert.ok(ratio(c('text'), c('bg')) >= 4.5);
      assert.ok(ratio(c('teal-text'), c('bg')) >= 4.5);
      assert.ok(ratio(c('teal-text'), c('card')) >= 4.5);
    });
    test('آیکن‌های آمار: آیکن (≥ ۳:۱ برای گرافیک) روی پس‌زمینه‌ی تخت', () => {
      const cases = [
        ['green', onSurface('green-soft', 'card')], ['red', onSurface('red-soft', 'card')], ['blue', onSurface('blue-soft', 'card')],
        ['orange', onSurface('orange-soft', 'card')], ['purple-text', onSurface('purple-soft', 'card')], ['hint', c('card-2')],
      ];
      for (const [fg, bgc] of cases) assert.ok(ratio(c(fg), bgc) >= 3, `${mode} stat-icon ${fg}: ${ratio(c(fg), bgc).toFixed(2)}`);
    });
    test('عدد بزرگ آمار با رنگ وضعیت (green/red-text/orange) روی کارت و کاشی hover AA', () => {
      for (const k of ['green', 'red-text', 'orange']) {
        assert.ok(ratio(c(k), c('card')) >= 4.5, `${mode} stat-value ${k} روی card: ${ratio(c(k), c('card')).toFixed(2)}`);
        assert.ok(ratio(c(k), c('card-2')) >= 4.5, `${mode} stat-value ${k} روی card-2: ${ratio(c(k), c('card-2')).toFixed(2)}`);
      }
      assert.ok(ratio(c('brand'), c('card')) >= 4.5);
      assert.ok(ratio(c('brand'), c('card-2')) >= 4.5);
    });
  });
}

describe('T4: ساختار CSS', () => {
  test('دکمه‌ها: primary نارنجی تخت با متن on-accent؛ بدون گرادیان/سایه‌ی رنگی/رنگ سخت‌کد', () => {
    const r = bodies('.btn.primary');
    assert.match(r, /background:\s*var\(--accent\)/);
    assert.match(r, /color:\s*var\(--on-accent\)/);
    assert.doesNotMatch(r, /gradient|box-shadow/);
    assert.match(bodies('.btn.primary:hover'), /background:\s*var\(--accent-dark\)/);
    assert.match(bodies('.btn'), /border-radius:\s*var\(--r-md\)/);
    for (const sel of ['.btn', '.btn.primary', '.btn.primary:hover', '.btn.ghost', '.btn.ghost:hover', '.btn.danger', '.btn.danger:hover', '.btn.success', '.btn.success:hover', '.btn.small']) {
      assert.doesNotMatch(bodies(sel), OLD_GREEN, `${sel}: رنگ سبز/سخت‌کد قدیمی`);
      assert.doesNotMatch(bodies(sel), /var\(--green-dark|var\(--on-green/, `${sel}: --on-green فقط برای سطوح سبز`);
    }
    assert.match(bodies('.btn.ghost'), /background:\s*var\(--card-2\)/);
    assert.doesNotMatch(bodies('.btn.ghost'), /border-color/);
    assert.match(bodies('.btn.small'), /border-radius:\s*var\(--r-sm\)/);
  });
  test('دکمه‌ها: disabled و loading (aria-busy) و فوکوس و کاهش حرکت', () => {
    assert.match(bodies('.btn:disabled'), /opacity:\s*\.5/);
    assert.match(bodies('.btn:disabled'), /cursor:\s*not-allowed/);
    assert.match(bodies('.btn[aria-busy="true"]'), /cursor:\s*progress/);
    assert.match(bodies('.btn[aria-busy="true"]::before'), /animation:\s*spin/);
    assert.match(bodies('.btn:focus-visible'), /outline:\s*2px solid var\(--brand\)/);
    assert.match(CSS, /@media \(prefers-reduced-motion: reduce\) \{ \.btn, \.btn:active \{ transition: none; transform: none; \} \.btn\[aria-busy="true"\]::before \{ animation: none/);
    assert.match(CSS, /@keyframes spin/);
  });
  test('تب‌ها: زیرخط‌دار — کانتینر با خط نازک، فعال با متن فیروزه‌ای و زیرخط نارنجی ۳px', () => {
    const tabs = bodies('.tabs');
    assert.match(tabs, /border-bottom:\s*1px solid var\(--border\)/);
    assert.match(tabs, /overflow-x:\s*auto/);
    assert.doesNotMatch(tabs, /background|border-radius|padding/, 'کپسول قدیمی نباید بماند');
    const tab = bodies('.tab');
    assert.match(tab, /border-bottom:\s*3px solid transparent/);
    assert.match(tab, /background:\s*transparent/);
    assert.match(tab, /color:\s*var\(--hint\)/);
    assert.match(tab, /min-height:\s*44px/);
    const act = bodies('.tab.active');
    assert.match(act, /color:\s*var\(--teal-text\)/);
    assert.match(act, /border-bottom-color:\s*var\(--accent\)/);
    assert.doesNotMatch(act, /gradient|on-green/);
    assert.match(bodies('.tab:hover'), /color:\s*var\(--text\)/);
    assert.match(bodies('.tab:focus-visible'), /outline:\s*2px solid var\(--brand\)/);
  });
  test('تب‌ها: هدف لمسی ۴۴px در قاعده‌ی موبایل/لمسی هم حفظ شده', () => {
    assert.match(CSS, /\.btn, \.icon-btn, \.nav-item, \.tab \{ min-height: 44px; \}/);
  });
  test('چیپ‌ها: قرص خاکستری؛ فعال برند نرم + حاشیه‌ی برند؛ شمارنده گرد روی --bg؛ هدف لمسی ۴۴px', () => {
    const chip = bodies('.chip');
    assert.match(chip, /background:\s*var\(--card\)/);
    assert.match(chip, /border-radius:\s*999px/);
    const act = bodies('.chip.active');
    assert.match(act, /background:\s*var\(--brand-soft\)/);
    assert.match(act, /border-color:\s*var\(--brand\)/);
    assert.match(act, /color:\s*var\(--brand\)/);
    assert.doesNotMatch(act, /green|rgba\(31/);
    const b = bodies('.chip b');
    assert.match(b, /border-radius:\s*999px/);
    assert.match(b, /background:\s*var\(--bg\)/);
    assert.match(b, /unicode-bidi:\s*isolate/);
    assert.match(bodies('.chip:focus-visible'), /outline:\s*2px solid var\(--brand\)/);
    assert.match(CSS, /\n\s+\.chip \{ min-height: 44px; \}/);
    assert.doesNotMatch(CSS, /\.chip \{[^}]*min-height:\s*36px/, 'ارتفاع ۳۶px قدیمی نباید بماند');
  });
  test('نشان‌ها: همه‌ی وضعیت‌ها هنوز پس‌زمینه‌ی نرم + رنگ متن توکنی دارند (متن/نقطه، نه فقط رنگ)', () => {
    for (const sel of ['.badge.green', '.badge.present', '.badge.late', '.badge.on_break', '.badge.absent', '.badge.leave', '.badge.mission', '.badge.holiday', '.badge.red', '.badge.blue', '.badge.purple']) {
      const r = bodies(sel);
      assert.match(r, /background:\s*var\(--(green|yellow|orange|red|purple|blue|ov)-?[a-z0-9]*\)/, sel);
      assert.match(r, /color:\s*var\(--[a-z-]+\)/, sel);
      assert.doesNotMatch(r, /#[0-9a-f]{3,6}\b|rgba?\(/i, `${sel}: رنگ سخت‌کد`);
    }
    assert.match(bodies('.badge.dot::before'), /background:\s*currentColor/);
  });
  test('آیکن‌های آمار: تخت، آیکن currentColor؛ کاشی با عمق ظریف؛ عدد برند', () => {
    for (const g of ['g-green', 'g-orange', 'g-red', 'g-purple', 'g-blue', 'g-gray']) {
      const r = bodies(`.stat-icon.${g}`);
      assert.doesNotMatch(r, /gradient|box-shadow|#[0-9a-f]{3,6}\b|rgba?\(/i, `${g}: گرادیان/سایه/رنگ سخت‌کد`);
      assert.match(r, /background:\s*var\(--/);
      assert.match(r, /color:\s*var\(--/);
    }
    assert.match(bodies('.stat-icon.g-orange'), /background:\s*var\(--orange-soft\)[\s\S]*color:\s*var\(--orange\)/); // بخش ۳: آیکن نرم و یکدست
    assert.match(bodies('.stat-icon.g-purple'), /background:\s*var\(--purple-soft\)[\s\S]*color:\s*var\(--purple-text\)/);
    assert.match(bodies('.stat-icon svg'), /stroke:\s*currentColor/);
    assert.doesNotMatch(bodies('.stat-icon svg'), /#fff/);
    const stat = bodies('.stat');
    assert.match(stat, /border:\s*1px solid var\(--border\)/);
    assert.match(stat, /box-shadow:\s*var\(--shadow\)/); // سایه‌ی دو لایه‌ی توکن
    assert.match(bodies('.stat-value'), /color:\s*var\(--brand\)/);
    assert.match(bodies('.stat-value'), /unicode-bidi:\s*isolate/);
  });
  test('نوار پیشرفت (.rv-progress-fill, .hbar-fill): نارنجی تخت', () => {
    for (const sel of ['.day-task .rv-progress-fill', '.hbar-fill']) {
      const r = bodies(sel);
      assert.match(r, /background:\s*var\(--accent\)/, sel);
      assert.doesNotMatch(r, /gradient/, sel);
    }
  });
  test('هیچ گرادیان/رنگ سبز قدیمی در قاعده‌های دکمه، تب، چیپ، نشان، آمار و پیشرفت نمانده', () => {
    const sels = new Set();
    for (const m of STRIPPED.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const list = m[1].split(',').map((x) => x.trim());
      if (!list.some((x) => /^\.(btn|tab|tabs|chip|chips|badge|stat|stat-icon|hbar-fill)\b|rv-progress-fill/.test(x))) continue;
      list.forEach((x) => sels.add(x));
      assert.doesNotMatch(m[2], OLD_GREEN, `${list.join(', ')}: رنگ سبز/سخت‌کد قدیمی`);
      if (/^\.(tab|tabs|chip|chips)\b|^\.btn\.primary|^\.stat-icon\.g-(orange|purple)/.test(list[0])) {
        assert.doesNotMatch(m[2], /var\(--green\)/, `${list[0]}: --green رنگ برند نیست`);
      }
    }
    assert.ok(sels.size > 30);
  });
});

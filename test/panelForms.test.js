// فاز ۱۶ / T5: فیلدها، برچسب‌ها، فرم دو‌ستونه، کارت کناری و سوییچ‌های صفحه‌ی تنظیمات — بررسی ایستا از روی CSS/JS واقعی + کنتراست AA.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const CSS = read('public-admin/css/style.css');
const TOKENS = read('public/css/tokens.css');
const DP = read('public-admin/css/datepicker.css');
const ADMIN_JS = read('public-admin/js/views-admin.js');

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
function bodies(sel) {
  const out = ruleList.filter((r) => r.sels.includes(sel)).map((r) => r.body);
  assert.ok(out.length, `قاعده‌ی ${sel} نیست`);
  return out.join(' ');
}
const FIELD_INNER = 'input:not([type="checkbox"], [type="radio"], [type="hidden"], [type="range"], [type="file"], [type="color"]), select, textarea';
const FIELD = `:where(${FIELD_INNER})`;

for (const mode of ['dark', 'light']) {
  const v = THEMES[mode];
  const c = (k) => parseColor(v[k]);
  describe(`T5 / ${mode}: کنتراست`, () => {
    test('متن و placeholder (--hint) روی فیلد و روی --card-2 (فیلد داخل کارت/مودال)', () => {
      for (const s of ['field', 'card-2']) {
        assert.ok(ratio(c('text'), c(s)) >= 4.5, `text/${s}`);
        assert.ok(ratio(c('hint'), c(s)) >= 4.5, `hint/${s}`);
      }
    });
    test('حلقه‌ی فوکوس (--brand) و حاشیه‌ی خطا (--red) ≥ ۳:۱ با فیلد، --card-2 و --bg', () => {
      for (const s of ['field', 'card-2', 'bg']) {
        assert.ok(ratio(c('brand'), c(s)) >= 3, `${mode} brand/${s}: ${ratio(c('brand'), c(s)).toFixed(2)}`);
        assert.ok(ratio(c('red'), c(s)) >= 3, `${mode} red/${s}: ${ratio(c('red'), c(s)).toFixed(2)}`);
      }
    });
    test('برچسب (--hint ۱۳px) روی کارت، --bg و --card-2', () => {
      for (const s of ['card', 'bg', 'card-2']) assert.ok(ratio(c('hint'), c(s)) >= 4.5, `hint/${s}`);
    });
    test('کارت کناری: آیتم فعال (brand روی brand-soft)، نشان عددی (text روی bg)، آیکن گرد (brand روی brand-soft)', () => {
      for (const s of ['card', 'bg']) {
        const bgc = over(c('brand-soft'), c(s));
        assert.ok(ratio(c('brand'), bgc) >= 4.5, `${mode} brand روی brand-soft/${s}`);
      }
      assert.ok(ratio(c('text'), c('bg')) >= 4.5);
      assert.ok(ratio(c('brand'), c('card')) >= 4.5, 'عدد آمار');
    });
    test('سوییچ: حاشیه‌ی خاموش (hint) و دایره‌ی خاموش روی مسیر --card-2 و روشن (on-brand روی brand) ≥ ۳:۱', () => {
      assert.ok(ratio(c('hint'), c('card')) >= 3, 'حاشیه‌ی مسیر خاموش روی کارت');
      assert.ok(ratio(c('hint'), c('card-2')) >= 3, 'دایره‌ی خاموش روی مسیر');
      assert.ok(ratio(c('on-brand'), c('brand')) >= 3, 'دایره‌ی روشن روی مسیر');
      assert.ok(ratio(c('brand'), c('card')) >= 3, 'مسیر روشن روی کارت');
    });
    test('چیپ روز هفته: فعال brand روی brand-soft، غیرفعال text روی card-2', () => {
      assert.ok(ratio(c('text'), c('card-2')) >= 4.5);
      assert.ok(ratio(c('brand'), over(c('brand-soft'), c('card'))) >= 4.5);
    });
  });
}

describe('T5: فیلدها', () => {
  test('قاعده‌ی سراسری با :where — پُرشده، بدون حاشیه‌ی دیدنی، radius ۸px، ارتفاع ≥ ۴۴px، بدون color-scheme اجباری', () => {
    const r = bodies(FIELD);
    assert.match(r, /background:\s*var\(--field\)/);
    assert.match(r, /border:\s*1px solid transparent/);
    assert.match(r, /border-radius:\s*var\(--r-sm\)/);
    assert.match(r, /min-height:\s*44px/);
    assert.match(r, /padding:\s*0 var\(--space-3\)/); // فاز ۲۰ / بخش ۱: ۱۲px ← --space-3
    assert.doesNotMatch(r, /color-scheme/, 'color-scheme: dark اجباری در تم روشن ویجت‌های بومی را تیره می‌کرد');
  });
  test('روی کارت/مودال/کشوی اعلان از --card-2', () => {
    for (const root of ['.card', '.modal', '.bell-drawer']) {
      const sel = `${root} ${FIELD}`;
      assert.match(bodies(sel), /background:\s*var\(--card-2\)/, root);
    }
  });
  test('placeholder AA، حالت خطا (aria-invalid) با border-color قرمز، فوکوس‌ویژیبل ۲px برند', () => {
    assert.match(bodies('::placeholder'), /color:\s*var\(--hint\)/);
    assert.match(bodies('::placeholder'), /opacity:\s*1/);
    assert.match(bodies('input[aria-invalid="true"]'), /border-color:\s*var\(--red\)/);
    assert.match(bodies('input:focus-visible'), /outline:\s*2px solid var\(--brand\)/);
    assert.match(bodies('textarea'), /min-height:\s*88px/);
    assert.match(bodies('input[type="checkbox"]'), /accent-color:\s*var\(--brand\)/);
    assert.doesNotMatch(CSS, /input:focus, select:focus, textarea:focus \{ border-color: var\(--green\)/);
  });
  test('حاشیه‌ی شفاف ⇒ قاعده‌های border-color خطا در datepicker.css هنوز اثر دارند', () => {
    assert.match(DP, /\.jdp-input\[aria-invalid="true"\] \{ border-color: var\(--red/);
    assert.match(DP, /\.dt-pair \[aria-invalid="true"\] \{ border-color: var\(--red/);
    assert.match(DP, /\.time-in\[aria-invalid="true"\] \{ border-color: var\(--red/);
  });
  test('برچسب بالای فیلد: خاکستری ۱۳px با فاصله‌ی ۶px؛ فرم‌ها دو‌ستونه با فاصله‌ی ۲۴px و تک‌ستونه در ≤ ۷۶۰px', () => {
    const f = bodies('.field');
    assert.match(f, /flex-direction:\s*column/);
    assert.match(f, /gap:\s*6px/);
    assert.match(f, /font-size:\s*var\(--fs-sm\)/); // فاز ۲۰ / بخش ۱: مقیاس تایپوگرافی (۱۳px ← ۱۴px)
    assert.match(f, /color:\s*var\(--hint\)/);
    assert.match(bodies('.st-label'), /color:\s*var\(--hint\)/);
    assert.match(bodies('.st-fields'), /repeat\(2, minmax\(0, 1fr\)\)/);
    assert.match(bodies('.st-fields'), /gap:\s*var\(--space-5\)/); // ۲۴px
    assert.match(bodies('.form-grid'), /gap:\s*var\(--space-4\) var\(--space-5\)/); // ۱۶px ۲۴px
    assert.match(CSS, /@media \(max-width: 760px\) \{ \.st-fields \{ grid-template-columns: minmax\(0, 1fr\); \} \}/);
  });
  test('فیلدهای تنظیمات از قاعده‌ی سراسری می‌گیرند (بدون پس‌زمینه/حاشیه‌ی اختصاصی)', () => {
    const r = bodies('.st-ctl input:not([type="checkbox"])');
    assert.doesNotMatch(r, /background|border/);
    assert.doesNotMatch(bodies('.st-ctl select'), /background|border/);
    assert.match(bodies('.st-pill input'), /min-height:\s*0/); // چیپ ورودی مخفی، ارتفاع ۴۴px نمی‌گیرد
  });
});

describe('T5: کارت کناری تنظیمات', () => {
  test('آیکن گرد brand-soft/brand؛ تیتر برند؛ آیتم فعال brand-soft؛ نشان عددی گرد روی --bg', () => {
    assert.match(bodies('.st-nav-ico'), /background:\s*var\(--brand-soft\)[\s\S]*color:\s*var\(--brand\)/);
    assert.match(bodies('.st-nav-ico'), /border-radius:\s*50%/);
    assert.match(bodies('.st-nav-head h3'), /color:\s*var\(--brand\)/);
    assert.match(bodies('.st-nav-item[aria-current="true"]'), /background:\s*var\(--brand-soft\)/);
    assert.match(bodies('.st-nav-item[aria-current="true"]'), /color:\s*var\(--brand\)/);
    const cnt = bodies('.st-count');
    assert.match(cnt, /min-width:\s*24px/);
    assert.match(cnt, /background:\s*var\(--bg\)/);
    assert.match(cnt, /unicode-bidi:\s*isolate/);
    assert.match(bodies('.st-stats dd'), /color:\s*var\(--brand\)/);
  });
  test('نشان عددی همان <span class="badge st-count"> است و دکمه‌ی بی‌کاربرد ساخته نشده (فقط «گزارش رویدادها» با اکشن واقعی)', () => {
    assert.match(ADMIN_JS, /<span class="badge st-count" data-count=/);
    assert.equal((ADMIN_JS.match(/class="[^"]*\bst-audit\b/g) || []).length, 1);
    assert.doesNotMatch(ADMIN_JS, /ذخیره‌ی همه/);
  });
  test('نوار ذخیره: ذخیره = .btn.primary (نارنجی در T4)، انصراف = ghost', () => {
    assert.match(ADMIN_JS, /class="btn ghost" data-discard=/);
    assert.match(ADMIN_JS, /class="btn primary" data-save=/);
  });
});

describe('T5: سوییچ‌ها و چیپ‌ها', () => {
  test('ساختار span جدا (input + span.st-track + ::after) حفظ شده؛ روشن = --brand، دایره‌ی روشن --on-brand؛ خاموش = --card-2 با حاشیه‌ی --hint', () => {
    assert.match(ADMIN_JS, /class="st-switch"[^>]*\/><span class="st-track" aria-hidden="true"><\/span>/);
    const t = bodies('.st-track');
    assert.match(t, /background:\s*var\(--card-2\)/);
    assert.match(t, /border:\s*1px solid var\(--hint\)/);
    assert.match(bodies('.st-track::after'), /background:\s*var\(--hint\)/);
    assert.match(bodies('.st-switch:checked + .st-track'), /background:\s*var\(--brand\)/);
    assert.match(bodies('.st-switch:checked + .st-track::after'), /background:\s*var\(--on-brand\)/);
    assert.match(bodies('.st-switch:focus-visible + .st-track'), /outline:\s*2px solid var\(--brand\)/);
    assert.match(CSS, /@media \(prefers-reduced-motion: reduce\) \{ \.st-track, \.st-track::after \{ transition: none; \} \}/);
  });
  test('چیپ روز هفته: غیرفعال --card-2 بدون حاشیه، فعال brand-soft + حاشیه‌ی brand', () => {
    assert.match(bodies('.st-pill span'), /background:\s*var\(--card-2\)/);
    assert.match(bodies('.st-pill span'), /border:\s*1px solid transparent/);
    const on = bodies('.st-pill input:checked + span');
    assert.match(on, /background:\s*var\(--brand-soft\)/);
    assert.match(on, /border-color:\s*var\(--brand\)/);
  });
  test('هیچ --green (رنگ برند قدیمی) در قاعده‌های st-* و فیلدها نمانده', () => {
    for (const r of ruleList) {
      if (!r.sels.some((s) => /\.st-|input|select|textarea|::placeholder|\.field\b/.test(s))) continue;
      if (r.sels.every((s) => /^\.leave-item\.st-/.test(s))) continue; // رنگ معنایی وضعیت مرخصی (تأییدشده = سبز)، نه رنگ برند
      assert.doesNotMatch(r.body, /var\(--green|#1fcf95|#7be495|#14a878/, `${r.sels.join(', ')}`);
    }
  });
});

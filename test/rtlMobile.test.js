// S5-9b: RTL و موبایل — ایزوله‌ی بیدی اعداد/ساعت، جهت فلش‌ها، منوی جمع‌شونده، جدول با اسکرول افقی، اندازه‌ی لمس، zoom آزاد، safe-area.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const A = require('../public-admin/js/a11y.js');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');
const PANEL = read('public-admin/css/style.css');
const MINI = read('public/css/style.css');
const jsFiles = fs.readdirSync(path.join(root, 'public-admin', 'js')).map((f) => `public-admin/js/${f}`);

// متن داخل @media مشخص (تا آکولاد متناظر)
function mediaBlock(css, header) {
  const i = css.indexOf(header);
  assert.ok(i >= 0, `بلاک ${header} نیست`);
  let depth = 0;
  for (let j = css.indexOf('{', i); j < css.length; j += 1) {
    if (css[j] === '{') depth += 1;
    else if (css[j] === '}') { depth -= 1; if (depth === 0) return css.slice(i, j + 1); }
  }
  throw new Error('بلاک ناتمام');
}

describe('RTL', () => {
  test('اعداد/ساعت/کد: unicode-bidi: isolate (ایزوله‌ی بیدی) در هر دو CSS و .ltr', () => {
    for (const css of [PANEL, MINI]) assert.match(css, /\.ltr, \.num[^{]*\{ unicode-bidi: isolate; \}/);
    assert.match(PANEL, /\.ltr \{ direction: ltr; unicode-bidi: isolate;/);
    assert.doesNotMatch(PANEL, /unicode-bidi: embed/);
  });
  test('datepicker: در صفحه‌ی RTL «قبل» سمت راست است ⇒ فلش‌های قبل به راست (› و »)، بعد به چپ (‹ و «)', () => {
    const js = read('public-admin/js/datepicker.js');
    assert.match(js, /data-act="prev-year" aria-label="سال قبل">»</);
    assert.match(js, /data-act="prev-month"[^>]*>›</);
    assert.match(js, /data-act="next-month"[^>]*>‹</);
    assert.match(js, /data-act="next-year" aria-label="سال بعد">«</);
  });
  test('فلش‌های متن UI با جهت RTL هم‌خوان‌اند: «→» فقط برای «بازگشت» (به راست)، ترتیب/تغییر با «←» (به چپ)', () => {
    for (const f of [...jsFiles, 'public/js/app.js', 'public-admin/index.html', 'public/index.html']) {
      const src = read(f).replace(/\/\/.*$/gm, ''); // کامنت‌های توسعه‌دهنده متن UI نیستند
      for (const m of src.matchAll(/→/g)) {
        const ctx = src.slice(Math.max(0, m.index - 80), m.index + 24);
        assert.match(ctx, /data-go="[^"]+">→ بازگشت|>→ بازگشت/, `${f}: «→» خارج از دکمه‌ی بازگشت: ${ctx.replace(/\n/g, ' ')}`);
      }
    }
  });
  test('منوی جمع‌شده سمت راست (RTL) و محتوا با margin-right؛ بیرون صفحه با translateX(100%)', () => {
    const m = mediaBlock(PANEL, '@media (max-width: 900px) {\n  .sidebar { transform');
    assert.match(m, /\.sidebar \{ transform: translateX\(100%\)/);
    assert.match(m, /\.content \{ margin-right: 0; \}/);
  });
});

describe('موبایل', () => {
  test('منوی بسته با Tab در دسترس نیست (visibility: hidden) و باز شدنش فوری است', () => {
    const m = mediaBlock(PANEL, '@media (max-width: 900px) {\n  /* منوی جمع‌شده');
    assert.match(m, /\.sidebar \{ visibility: hidden;/);
    assert.match(m, /\.sidebar\.open \{ visibility: visible;/);
  });
  test('Esc منوی موبایل را می‌بندد و فوکوس را به دکمه‌ی منو می‌دهد؛ aria-expanded همگام است', () => {
    const core = read('public-admin/js/core.js');
    assert.match(core, /Escape' && \$\('#sidebar'\)\.classList\.contains\('open'\)\) \{ closeSidebar\(\); const mb = \$\('#menu-btn'\); if \(mb\) mb\.focus\(\)/);
    assert.match(core, /setAttribute\('aria-expanded', 'true'\)/);
    assert.match(core, /setAttribute\('aria-expanded', 'false'\)/);
  });
  test('جدول‌ها: همه‌ی <table> داخل .table-wrap با overflow-x:auto؛ ناحیه‌ی سرریزدار با کیبورد قابل‌اسکرول', () => {
    assert.match(PANEL, /\.table-wrap \{ overflow-x: auto; \}/);
    const bad = [];
    for (const f of jsFiles) {
      const s = read(f);
      for (const m of s.matchAll(/<table\b/g)) if (!s.slice(Math.max(0, m.index - 260), m.index).includes('table-wrap')) bad.push(`${f}:${s.slice(0, m.index).split('\n').length}`);
    }
    assert.deepEqual(bad, []);
    const mk = (over) => { const a = {}; return { scrollWidth: over ? 900 : 300, clientWidth: 400, a, hasAttribute: (k) => k in a, setAttribute: (k, v) => { a[k] = v; } }; };
    const wide = mk(true); const narrow = mk(false);
    const scope = { querySelectorAll: (sel) => (sel === '.table-wrap' ? [wide, narrow] : []) };
    A.enhance(scope);
    assert.equal(wide.a.tabindex, '0');
    assert.equal('tabindex' in narrow.a, false);
  });
  test('اندازه‌ی لمس ≥ ۴۴px برای دکمه/منو/ورودی در pointer: coarse یا عرض ≤ ۹۰۰', () => {
    const m = mediaBlock(PANEL, '@media (pointer: coarse), (max-width: 900px)');
    assert.match(m, /\.btn, \.icon-btn, \.nav-item, \.tab \{ min-height: 44px; \}/);
    assert.match(m, /\.icon-btn \{ width: 44px; height: 44px; \}/);
    assert.match(m, /select \{ min-height: 44px; \}/);
    assert.match(m, /\.cal-cell \{ width: 34px; height: 34px; \}/); // ≥ ۲۴px (WCAG 2.5.8)
    assert.match(mediaBlock(MINI, '@media (pointer: coarse), (max-width: 900px)'), /min-height: 44px/);
  });
  test('zoom کاربر آزاد است؛ viewport درست؛ Mini App با safe-area', () => {
    for (const f of ['public-admin/index.html', 'public/index.html']) {
      const h = read(f);
      const vp = h.match(/<meta name="viewport" content="([^"]+)"/);
      assert.ok(vp, f);
      assert.match(vp[1], /width=device-width/);
      assert.doesNotMatch(vp[1], /user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1(\.0)?(,|$)/, `${f}: zoom نباید بسته شود`);
    }
    assert.match(read('public/index.html'), /viewport-fit=cover/);
    assert.match(MINI, /env\(safe-area-inset-bottom/);
    assert.match(MINI, /env\(safe-area-inset-top/);
  });
  test('بدون تأخیر/زوم دابل‌تپ روی کنترل‌ها (touch-action: manipulation) و اندازه‌ی متن ثابت', () => {
    for (const css of [PANEL, MINI]) {
      assert.match(css, /touch-action: manipulation/);
      assert.match(css, /text-size-adjust: 100%/);
    }
  });
  test('نمودارها و کارت‌ها در موبایل سرریز نمی‌کنند: شبکه‌ی نمودار تک‌ستونه زیر ۹۸۰px', () => {
    assert.match(PANEL, /@media \(max-width: 980px\) \{ \.chart-grid \{ grid-template-columns: 1fr; \} \}/);
    assert.match(PANEL, /\.chart-slot \{ min-width: 0; \}/);
  });
});

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const css = read('public-admin/css/style.css');
const html = read('public-admin/index.html');
const core = read('public-admin/js/core.js');
const charts = read('public-admin/js/charts.js');

describe('فاز ۱۹ — P1 تا P5 پنل', () => {
  test('P1: مقیاس شعاع، عمق کارت و تیتر واکنش‌گرا', () => {
    for (const token of ['--r-xl: 28px', '--r-lg: 20px', '--r-md: 12px', '--r-sm: 8px']) assert.match(css, new RegExp(token.replace(/[-]/g, '\\-')));
    assert.match(css, /\.card \{[\s\S]*?border: 1px solid var\(--border\)[\s\S]*?box-shadow:/);
    assert.match(css, /\.view-header h2 \{[^}]*clamp\(22px, 4vw, 32px\)[^}]*font-weight: 750/);
  });

  test('P2: تراکم، ستون sticky موبایل، bottom-sheet و skeleton', () => {
    assert.match(html, /id="density-btn"/);
    assert.match(core, /adminDensity/);
    assert.match(css, /body\[data-density="compact"\]/);
    assert.match(css, /table:not\(\[data-stack\]\) th:first-child[\s\S]*?position: sticky/);
    assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.modal-backdrop \{ place-items: end center/);
    assert.match(read('public-admin/js/views-analytics.js'), /UiStates\.skeletonHtml/);
  });

  test('P3: روند واقعی داشبورد و تعامل دسترس‌پذیر نمودار', () => {
    const main = read('public-admin/js/views-main.js');
    assert.match(main, /statTrendHtml\(d\.trend, trendField\)/);
    assert.match(main, /نسبت به دیروز/);
    assert.match(charts, /data-chart-series=/);
    assert.match(charts, /aria-pressed="true"/);
    assert.match(charts, /tabindex="0" role="img" aria-label=/);
    assert.match(charts, /mountInteractiveCharts/);
    assert.match(css, /@keyframes chart-enter/);
  });

  test('P4: صف توست، Ctrl+K/combobox، ورود دوپنله و empty action', () => {
    assert.match(core, /const toastQueue = \[\]/);
    assert.match(core, /toastQueue\.push/);
    assert.match(core, /e\.ctrlKey \|\| e\.metaKey/);
    assert.match(core, /aria-autocomplete/);
    assert.match(core, /data-action=/);
    assert.match(html, /login-brand-panel/);
    assert.match(html, /login-form-panel/);
    assert.match(read('public-admin/js/views-shifts.js'), /data-empty-add/);
  });

  test('P5: templateهای پنل style درون‌خطی ندارند و تصمیم lazy-load مستند است', () => {
    const files = fs.readdirSync(path.join(root, 'public-admin/js')).filter((x) => x.endsWith('.js'));
    for (const file of files) assert.doesNotMatch(read(`public-admin/js/${file}`), /style="/i, file);
    assert.match(core, /data-progress/);
    assert.match(read('docs/DOCUMENTATION.md'), /lazy-load فایل‌های view عمداً در این بسته انجام نشد/);
  });
});

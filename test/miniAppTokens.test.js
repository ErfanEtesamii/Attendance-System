// فاز ۱۶ / T9: هم‌خوانی توکن‌های رنگی Mini App (public/css/style.css و planner.css) با خانواده‌ی برند سرمه‌ای — فقط مقدار توکن‌ها؛ چیدمان/منطق/theme.js (جز ثابت BG.dark) بدون تغییر.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Theme = require('../public/js/theme.js');
const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const MINI = read('public/css/style.css');
const TOKENS = read('public/css/tokens.css');
const PLAN = read('public/css/planner.css');
const PANEL = read('public-admin/css/style.css');

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
const resolved = (vars) => Object.fromEntries(Object.entries(vars).map(([key, value]) => {
  const alias = /^var\(--([a-z0-9-]+)\)$/.exec(value);
  return [key, alias ? vars[alias[1]] : value];
}));
const SEL = { dark: ':root,\n:root[data-theme="dark"]', light: ':root[data-theme="light"]' };
const FALLBACK = '@media (prefers-color-scheme: light) {\n  :root:not([data-theme])';
const fallbackVars = (css) => { const i = css.indexOf(FALLBACK); assert.ok(i >= 0); return varsOf(css.slice(i, css.indexOf('\n  }', i))); };
const rawMini = { dark: varsOf(block(TOKENS, SEL.dark)), light: varsOf(block(TOKENS, SEL.light)) };
const mini = { dark: resolved(rawMini.dark), light: resolved(rawMini.light) };
const strip = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k.replace(/^pl-/, ''), v])); // --pl-ink ⇒ ink
const plan = { dark: strip(varsOf(block(PLAN, SEL.dark))), light: strip(varsOf(block(PLAN, SEL.light))) };
const panel = { dark: resolved(rawMini.dark), light: resolved(rawMini.light) };

describe('T9: توکن‌های Mini App هم‌خانواده‌ی برند پنل', () => {
  test('تیره: bg/bg-2/card/card-2/text/hint دقیقاً هم‌مقدار پنل‌اند (سرمه‌ای)', () => {
    for (const [mk, pk] of [['bg', 'bg'], ['bg-2', 'bg-2'], ['card-bg', 'card'], ['card-bg-2', 'card-2'], ['text', 'text'], ['hint', 'hint']]) assert.equal(mini.dark[mk], panel.dark[pk], mk);
  });
  test('روشن: متن/hint/border/shadow/ov از پایه‌ی سرمه‌ای (۴۳,۳۷,۹۶)؛ متن همان سرمه‌ای پنل', () => {
    assert.equal(mini.light.text, panel.light.text);
    assert.equal(mini.light.hint, panel.light.hint);
    for (const k of ['border', 'shadow', 'ov-08']) assert.match(mini.light[k], /43, 37, 96/, k);
    assert.doesNotMatch(block(TOKENS, SEL.light), /27, 28, 44/);
  });
  test('روشنِ صریح و fallback مدیا هم‌مقدارند (Mini App و planner)', () => {
    assert.deepEqual(fallbackVars(TOKENS), rawMini.light);
    assert.deepEqual(strip(fallbackVars(PLAN)), plan.light);
  });
  for (const mode of ['dark', 'light']) {
    test(`[${mode}] متن/hint روی bg، bg-2، card-bg، card-bg-2 ≥ ۴٫۵:۱`, () => {
      const v = mini[mode];
      for (const s of ['bg', 'bg-2', 'card-bg', 'card-bg-2']) {
        for (const k of ['text', 'hint']) assert.ok(ratio(parseColor(v[k]), over(parseColor(v[s]), parseColor(v.bg))) >= 4.5, `${k}/${s}`);
      }
    });
  }
});

describe('T9: Theme.BG و رنگ نوار تلگرام با --bg هم‌خوان', () => {
  test('Theme.BG هر تم = --bg همان تم در Mini App', () => {
    assert.equal(Theme.BG.dark.toLowerCase(), mini.dark.bg.toLowerCase());
    assert.equal(Theme.BG.light.toLowerCase(), mini.light.bg.toLowerCase());
  });
  test('تیره‌ی Mini App = BG تیره‌ی پنل (--bg پنل و theme-bg-dark)', () => {
    assert.equal(Theme.BG.dark.toLowerCase(), panel.dark.bg.toLowerCase());
    assert.match(read('public-admin/index.html'), new RegExp(`name="theme-bg-dark" content="${Theme.BG.dark}"`, 'i'));
  });
  test('پشتیبان‌های ثابت (meta theme-color در public/index.html و app.js بدون theme.js) با BG تیره یکی‌اند', () => {
    assert.match(read('public/index.html'), new RegExp(`<meta name="theme-color" content="${Theme.BG.light}"`, 'i'));
    const app = read('public/js/app.js');
    assert.equal((app.match(new RegExp(`'${Theme.BG.light}'`, 'gi')) || []).length, 3);
    assert.doesNotMatch(app, /#1b1c2c/i);
    assert.match(app, /window\.Theme && window\.Theme\.apply/);
  });
});

describe('T9: planner.css (برنامه‌ی هفتگی و «امروزِ من»)', () => {
  test('--pl-cutout = --bg همان تم؛ سطح‌ها = کارت‌های Mini App در تم تیره', () => {
    for (const mode of ['dark', 'light']) assert.equal(plan[mode].cutout.toLowerCase(), mini[mode].bg.toLowerCase(), `cutout ${mode}`);
    assert.equal(plan.dark.surface, mini.dark['card-bg']);
    assert.equal(plan.dark['surface-2'], mini.dark['card-bg-2']);
  });
  test('سرمه‌ای: --pl-accent = رنگ برند پنل (تیره: لاوندر روشن، روشن: سرمه‌ای)', () => {
    assert.equal(plan.dark.accent, panel.dark.brand);
    assert.equal(plan.light.accent, panel.light.brand);
    assert.doesNotMatch(block(PLAN, SEL.dark) + block(PLAN, SEL.light), /#8b7cf6|#5a49d6|139, 124, 246|90, 73, 214/i);
  });
  for (const mode of ['dark', 'light']) {
    test(`[${mode}] جفت‌های planner: ink≥۷، muted≥۴٫۵، accent روی سطح/cutout ≥ ۳:۱ (حلقه‌ی فوکوس ۳px و آیکن)، متن روی accent ≥ ۴٫۵:۱، چیپ‌ها ≥ ۴٫۵:۱`, () => {
      const v = plan[mode]; const c = (k) => parseColor(v[k]);
      for (const s of ['surface', 'surface-2']) {
        assert.ok(ratio(c('ink'), c(s)) >= 7, `ink/${s}`);
        assert.ok(ratio(c('muted'), c(s)) >= 4.5, `muted/${s}`);
        assert.ok(ratio(c('accent'), c(s)) >= 3, `accent/${s}`);
      }
      assert.ok(ratio(c('accent'), c('cutout')) >= 3, 'accent/cutout');
      assert.ok(ratio(c('done-ink'), c('accent')) >= 4.5, 'متن دکمه‌ی اصلی روی accent');
      assert.ok(ratio(c('done-ink'), c('done')) >= 4.5, 'متن روی done');
      assert.ok(ratio(c('chip-ink'), over(c('chip-bg'), c('surface'))) >= 4.5, 'chip');
      assert.ok(ratio(c('manager-ink'), over(c('manager-bg'), c('surface'))) >= 4.5, 'manager');
      assert.ok(ratio(c('urgent-ink'), over(c('urgent-bg'), c('surface'))) >= 4.5, 'urgent');
    });
  }
  test('رنگ‌های تزئینیِ هویت (عنوان صورتی و رنگ‌های روزها) دست‌نخورده‌اند', () => {
    assert.equal(plan.dark.title, '#ff8fc8');
    assert.equal(plan.light.title, '#a8246f');
    assert.equal(plan.dark['day-1'], '#ffa94d');
    assert.equal(plan.light['day-7'], '#3f4fb8');
  });
});

describe('T9: دامنه — چیدمان و منطق دست‌نخورده', () => {
  test('theme.js فقط ثابت BG.dark را عوض کرده؛ API و منطق همان است', () => {
    for (const k of ['KEY', 'BG', 'LABEL', 'NEXT', 'normalize', 'resolveTheme']) assert.ok(k in Theme, k);
    assert.deepEqual(Object.keys(Theme.BG), ['dark', 'light']);
  });
  test('کنش‌های اصلی Mini App در قواعد اصلی خودشان از accent استفاده می‌کنند', () => {
    const primary = block(MINI, '.btn.primary');
    assert.match(primary, /background: var\(--accent\);/);
    assert.match(primary, /color: var\(--on-accent\);/);
    assert.match(block(MINI, '.tab-btn.active'), /border-bottom-color: var\(--brand\)/);
    assert.match(block(MINI, '.nav-btn.active'), /color: var\(--rail-text\)/);
    assert.doesNotMatch(MINI, /\.report-head/);
    assert.match(TOKENS, /--on-accent: #17143a;/);
    assert.match(TOKENS, /:root\[data-theme="light"\][\s\S]*--on-accent: #2b2560;/);
  });
});

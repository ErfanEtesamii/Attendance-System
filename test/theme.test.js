// S5-8a: تم روشن/تیره — کنتراست AA از روی خودِ CSS، منطق theme.js (DOM/Telegram ساختگی)، هماهنگی پالت‌ها، چاپ و اتصال به صفحه‌ها.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Theme = require('../public/js/theme.js');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const PANEL = read('public-admin/css/style.css');
const MINI = read('public/css/style.css');

// ---- ابزار رنگ ----
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

// متغیرهای یک بلاک (انتخابگر دقیق ⇒ متن بین { و } اولین تطابق)
function block(css, selector) {
  const i = css.indexOf(`${selector} {`);
  assert.ok(i >= 0, `بلاک ${selector} نیست`);
  const j = css.indexOf('\n}', i);
  return css.slice(i + selector.length + 2, j);
}
const varsOf = (txt) => Object.fromEntries([...txt.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const THEMES = (css) => ({ dark: varsOf(block(css, ':root,\n:root[data-theme="dark"]')), light: varsOf(block(css, ':root[data-theme="light"]')) });

const PAIRS_PANEL = [
  ['text', 'bg'], ['text', 'card'], ['text', 'card-2'], ['hint', 'bg'], ['hint', 'card'], ['hint', 'card-2'], ['hint', 'sidebar'], ['text', 'sidebar'],
  ['green', 'card'], ['red', 'card'], ['orange', 'card'], ['yellow', 'card'], ['blue', 'card'], ['green', 'bg'],
];
const SOFT = [['green', 'green-soft'], ['orange', 'orange-soft'], ['red', 'red-soft'], ['yellow', 'yellow-soft'], ['blue', 'blue-soft'], ['purple-text', 'purple-soft']];

describe('کنتراست AA (۴٫۵:۱) از روی CSS واقعی', () => {
  for (const [name, css, cardKey] of [['پنل', PANEL, 'card'], ['Mini App', MINI, 'card-bg']]) {
    const T = THEMES(css);
    for (const mode of ['dark', 'light']) {
      const v = T[mode];
      const get = (k) => parseColor(v[k]);
      const alias = (k) => (k === 'card' ? cardKey : k === 'card-2' ? (cardKey === 'card' ? 'card-2' : 'card-bg-2') : k);
      test(`${name} / ${mode}: جفت‌های متن/پس‌زمینه`, () => {
        for (const [fg, bg] of PAIRS_PANEL) {
          const fk = alias(fg); const bk = alias(bg);
          if (!(fk in v) || !(bk in v)) continue; // Mini App همه‌ی کلیدهای پنل را ندارد
          const r = ratio(over(get(fk), get(bk)), get(bk));
          assert.ok(r >= 4.5, `${name}/${mode} ${fk} روی ${bk}: ${r.toFixed(2)}`);
        }
      });
      test(`${name} / ${mode}: متن روی دکمه/تب/آواتار سبز (--on-accent) و نشان‌های نرم`, () => {
        for (const bg of ['#25d9a0', '#14a878', '#7be495', '#16b886']) {
          const r = ratio(get('on-accent'), parseColor(bg));
          assert.ok(r >= 4.5, `${name}/${mode} on-accent روی ${bg}: ${r.toFixed(2)}`);
        }
        const card = get(cardKey);
        for (const [fg, soft] of SOFT) {
          if (!(fg in v) || !(soft in v)) continue;
          const bgc = over(get(soft), card);
          const r = ratio(get(fg), bgc);
          assert.ok(r >= 4.5, `${name}/${mode} ${fg} روی ${soft}: ${r.toFixed(2)}`);
        }
        const rs = ratio(parseColor('#ffffff'), get('red-solid'));
        assert.ok(rs >= 4.5, `${name}/${mode} سفید روی red-solid: ${rs.toFixed(2)}`);
      });
    }
  }
});

describe('پالت‌ها و CSS', () => {
  test('کلیدهای دو تم یکی‌اند و رنگ نوار تلگرام (BG) با --bg هر تم برابر است', () => {
    for (const css of [PANEL, MINI]) {
      const T = THEMES(css);
      const keys = (o) => Object.keys(o).filter((k) => !['radius', 'radius-sm', 'sidebar-w'].includes(k)).sort();
      for (const k of keys(T.light)) assert.ok(k in T.dark, `کلید ${k} فقط در روشن است`);
      for (const k of keys(T.dark)) if (!/^var\(/.test(T.dark[k])) assert.ok(k in T.light, `کلید ${k} فقط در تیره است`); // نام‌های مستعار var(--x) در :root مشترک می‌مانند
      assert.equal(T.dark.bg.toLowerCase(), Theme.BG.dark);
      assert.equal(T.light.bg.toLowerCase(), Theme.BG.light);
    }
  });
  test('پشتیبان بدون JS: prefers-color-scheme: light ⇒ همان مقادیر بلاک روشن', () => {
    for (const css of [PANEL, MINI]) {
      const i = css.indexOf('@media (prefers-color-scheme: light)');
      assert.ok(i > 0);
      const seg = css.slice(i, css.indexOf('\n}\n', i + 40));
      const fb = varsOf(seg);
      assert.deepEqual(fb, THEMES(css).light);
      assert.match(seg, /:root:not\(\[data-theme\]\)/);
    }
  });
  test('رنگ سفید-شفاف ثابت (rgba(255,255,255,…)) فقط در تعریف متغیر تیره/چاپ مانده؛ بقیه با --ov-*', () => {
    for (const css of [PANEL, MINI]) {
      const bad = css.split('\n').filter((l) => /rgba\(255,\s*255,\s*255/.test(l) && !/^\s*--(ov-\d+|border):/.test(l));
      assert.deepEqual(bad, []);
    }
  });
  test('چاپ: پالت روشن اجباری و جدول با خط، مستقل از data-theme', () => {
    const i = PANEL.indexOf('@media print {\n  /* S5-8a');
    assert.ok(i > 0);
    const seg = PANEL.slice(i, PANEL.indexOf('\n}\n', i));
    assert.match(seg, /:root\[data-theme="dark"\]/);
    assert.match(seg, /--bg: #fff/);
    assert.match(seg, /color-scheme: light/);
    assert.match(seg, /th, td \{ border: 1px solid #999/);
    assert.match(seg, /thead \{ display: table-header-group/);
  });
});

describe('theme.js: منطق', () => {
  const { resolveTheme } = Theme;
  test('اولویت: انتخاب کاربر ⇒ تلگرام ⇒ سیستم ⇒ تیره', () => {
    assert.equal(resolveTheme({ stored: 'light', prefersDark: true, tgScheme: 'dark' }), 'light');
    assert.equal(resolveTheme({ stored: 'dark', prefersDark: false, tgScheme: 'light' }), 'dark');
    assert.equal(resolveTheme({ stored: 'auto', prefersDark: false, tgScheme: 'dark' }), 'dark');
    assert.equal(resolveTheme({ stored: null, prefersDark: false }), 'light');
    assert.equal(resolveTheme({ stored: 'zzz', prefersDark: true }), 'dark');
    assert.equal(resolveTheme({}), 'dark');
    assert.equal(resolveTheme(), 'dark');
  });

  function boot({ stored, prefersDark = true, tgScheme } = {}) {
    const store = stored ? { theme: stored } : {};
    const attrs = {}; const meta = { v: '#1b1c2c', setAttribute(k, v) { if (k === 'content') this.v = v; } };
    const btn = { a: {}, setAttribute(k, v) { this.a[k] = v; } };
    const listeners = {}; const tgCalls = []; let tgHandler = null; let mqHandler = null;
    const tg = tgScheme ? { colorScheme: tgScheme, setHeaderColor: (c) => tgCalls.push(['h', c]), setBackgroundColor: (c) => tgCalls.push(['b', c]), setBottomBarColor: (c) => tgCalls.push(['n', c]), onEvent: (e, f) => { if (e === 'themeChanged') tgHandler = f; } } : null;
    const win = {
      document: {
        documentElement: { setAttribute: (k, v) => { attrs[k] = v; } },
        querySelector: (s) => (s.includes('theme-color') ? meta : null),
        querySelectorAll: (s) => (s.includes('data-theme-toggle') ? [btn] : []),
        addEventListener: (e, f) => { listeners[e] = f; },
      },
      localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; }, removeItem: (k) => { delete store[k]; } },
      matchMedia: () => ({ get matches() { return prefersDark; }, addEventListener: (e, f) => { mqHandler = f; } }),
      Telegram: tg ? { WebApp: tg } : undefined,
    };
    const ctx = vm.createContext({ window: win, module: { exports: {} } });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public/js/theme.js'), 'utf8'), ctx);
    return { T: win.Theme, attrs, meta, btn, store, tgCalls, fire: () => tgHandler && tgHandler(), media: (dark) => { prefersDark = dark; mqHandler && mqHandler(); }, win };
  }

  test('بدون ذخیره: از prefers-color-scheme؛ data-theme و theme-color هم‌خوان', () => {
    let e = boot({ prefersDark: false });
    assert.equal(e.attrs['data-theme'], 'light');
    assert.equal(e.meta.v, Theme.BG.light);
    e = boot({ prefersDark: true });
    assert.equal(e.attrs['data-theme'], 'dark');
    assert.equal(e.meta.v, Theme.BG.dark);
  });
  test('چرخه‌ی دکمه: auto ⇒ light ⇒ dark ⇒ auto؛ ذخیره/پاک‌سازی در localStorage؛ برچسب دسترس‌پذیر', () => {
    const e = boot({ prefersDark: true });
    assert.equal(e.T.get(), 'auto');
    assert.equal(e.T.cycle(), 'light'); assert.equal(e.store.theme, 'light');
    assert.equal(e.attrs['data-theme'], 'light'); assert.match(e.btn.a['aria-label'], /روشن/);
    assert.equal(e.T.cycle(), 'dark'); assert.equal(e.store.theme, 'dark');
    assert.equal(e.T.cycle(), 'dark'); assert.equal('theme' in e.store, false); // auto ⇒ با سیستم (تیره)
    assert.equal(e.btn.a['data-state'], 'auto'); assert.match(e.btn.a.title, /خودکار/);
  });
  test('انتخاب ذخیره‌شده بر سیستم و تلگرام غلبه دارد؛ مقدار خراب ⇒ auto', () => {
    assert.equal(boot({ stored: 'light', prefersDark: true, tgScheme: 'dark' }).attrs['data-theme'], 'light');
    assert.equal(boot({ stored: 'bogus', prefersDark: false }).T.get(), 'auto');
  });
  test('تلگرام: auto ⇒ colorScheme تلگرام؛ رنگ هدر/پس‌زمینه/نوار پایین هماهنگ؛ themeChanged بازاعمال می‌کند', () => {
    const e = boot({ prefersDark: true, tgScheme: 'light' });
    assert.equal(e.attrs['data-theme'], 'light');
    assert.deepEqual(e.tgCalls.slice(0, 3), [['h', Theme.BG.light], ['b', Theme.BG.light], ['n', Theme.BG.light]]);
    e.win.Telegram.WebApp.colorScheme = 'dark'; e.fire();
    assert.equal(e.attrs['data-theme'], 'dark');
    assert.equal(e.tgCalls.at(-1)[1], Theme.BG.dark);
    e.T.set('light'); e.win.Telegram.WebApp.colorScheme = 'dark'; e.fire(); // انتخاب کاربر پابرجاست
    assert.equal(e.attrs['data-theme'], 'light');
  });
  test('تغییر تم سیستم فقط در حالت auto اثر دارد', () => {
    const e = boot({ prefersDark: true });
    e.media(false); assert.equal(e.attrs['data-theme'], 'light');
    e.T.set('dark'); e.media(false); assert.equal(e.attrs['data-theme'], 'dark');
  });
  test('localStorage مسدود/خراب ⇒ خطا نمی‌دهد', () => {
    const e = boot({ prefersDark: true });
    e.win.localStorage.setItem = () => { throw new Error('blocked'); };
    assert.doesNotThrow(() => e.T.set('light'));
    assert.equal(e.attrs['data-theme'], 'light');
  });
});

describe('اتصال به صفحه‌ها', () => {
  test('theme.js همگام در <head> قبل از stylesheetها، self-hosted؛ بدون اسکریپت inline', () => {
    for (const f of ['public-admin/index.html', 'public/index.html']) {
      const h = read(f);
      const head = h.slice(0, h.indexOf('</head>'));
      assert.ok(head.includes('<script src="/js/theme.js"></script>'), f);
      assert.ok(head.indexOf('/js/theme.js') < head.indexOf('rel="stylesheet"'), `${f}: theme.js باید قبل از CSS بیاید`);
      assert.doesNotMatch(h, /<script(?![^>]*\ssrc=)[^>]*>/, `${f}: اسکریپت inline ممنوع (CSP)`);
    }
  });
  test('دکمه‌ی تم در نوار بالای پنل با aria-label و data-theme-toggle', () => {
    const h = read('public-admin/index.html');
    assert.match(h, /<button id="theme-btn"[^>]*data-theme-toggle[^>]*aria-label=/);
  });
  test('Mini App: رنگ نوار تلگرام دیگر ثابت #1b1c2c نیست مگر پشتیبان بدون theme.js', () => {
    const a = read('public/js/app.js');
    assert.match(a, /window\.Theme && window\.Theme\.apply/);
  });
});

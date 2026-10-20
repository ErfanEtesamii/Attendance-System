// C1 (فاز ۱۳): تست ایستا برای سیستم طراحی دفترچه — اسکوپ .nb، دو تم، کنتراست AA، نبودن وابستگی خارجی، ریسپانسیو/فوکوس/کاهش حرکت.
// مرورگر واقعی اجرا نمی‌شود؛ مرور دستی دو تم/RTL/۳۲۰px/فوکوس کیبورد در nb-demo.html لازم است.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');
const css = read('public-admin/css/notebook.css');
const js = read('public-admin/js/notebook.js');
const demoHtml = read('public-admin/nb-demo.html');
const demoJs = read('public-admin/js/nb-demo.js');
const indexHtml = read('public-admin/index.html');

// پارس ساده‌ی CSS: [{ sel, body, at }] (قواعد داخل @media هم با at = متن @media)
function parseRules(src, at = '') {
  const text = src.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{', i);
    if (open === -1) break;
    let depth = 1; let j = open + 1;
    while (j < text.length && depth) { if (text[j] === '{') depth += 1; else if (text[j] === '}') depth -= 1; j += 1; }
    const head = text.slice(i, open).trim();
    const body = text.slice(open + 1, j - 1);
    if (head.startsWith('@')) out.push(...parseRules(body, head)); else out.push({ sel: head, body, at });
    i = j;
  }
  return out;
}
const rules = parseRules(css);
const vars = (body) => Object.fromEntries([...body.matchAll(/(--nb-[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const findTheme = (re) => rules.find((r) => re.test(r.sel));

const SCOPED = /^(:root(\[data-theme="(dark|light)"\]|:not\(\[data-theme\]\)|:is\(\[data-theme\], :not\(\[data-theme\]\)\))? )?\.nb(\b|$)/;

describe('اسکوپ و ساختار', () => {
  test('همه‌ی انتخابگرها زیر .nb اسکوپ شده‌اند (بقیه‌ی پنل تغییر نمی‌کند)', () => {
    assert.ok(rules.length > 30);
    for (const r of rules) for (const s of r.sel.split(',').map((x) => x.trim())) assert.match(s, SCOPED, `انتخابگر بیرون از .nb: ${s}`);
  });

  test('کامپوننت‌های لازم تعریف شده‌اند', () => {
    for (const c of ['nb-spread', 'nb-page', 'nb-card', 'nb-tape', 'nb-lines', 'nb-chip', 'nb-btn', 'nb-spring', 'nb-pager']) assert.match(css, new RegExp(`\\.nb \\.${c}\\b`), c);
    assert.match(css, /radial-gradient/); // فنر
    assert.match(css, /repeating-linear-gradient/); // خطوط
    assert.match(css, /data:image\/svg\+xml/); // گل کمرنگ SVG درون‌خطی
    for (const t of ['rose', 'sage', 'sand', 'lilac', 'sky']) assert.match(css, new RegExp(`\\.nb-tape--${t}\\b`));
    for (const t of ['work', 'half', 'off', 'holiday', 'leave', 'mission', 'warn', 'urgent', 'locked']) assert.match(css, new RegExp(`\\.nb-chip--${t}\\b`));
  });

  test('رنگ‌ها فقط با متغیر: خارج از بلوک‌های توکن، هیچ رنگ hex خامی در قواعد نیست (جز سایه/ماسک/گرادیان فنر)', () => {
    const tokenSel = /(^|,)\s*(\.nb|:root\[data-theme="(dark|light)"\] \.nb|:root:not\(\[data-theme\]\) \.nb)\s*(,|$)/;
    for (const r of rules) {
      if (tokenSel.test(r.sel) && /--nb-paper:/.test(r.body)) continue;
      const body = r.body.replace(/url\("data:[^"]*"\)/g, '');
      assert.doesNotMatch(body, /#[0-9a-fA-F]{3,8}\b/, `رنگ hex خام در ${r.sel}`);
    }
  });
});

describe('دو تم', () => {
  const dark = findTheme(/^\.nb,\s*:root\[data-theme="dark"\] \.nb$/);
  const light = findTheme(/^:root\[data-theme="light"\] \.nb$/);
  const auto = rules.find((r) => /:root:not\(\[data-theme\]\) \.nb/.test(r.sel) && /prefers-color-scheme: light/.test(r.at));

  test('تیره (پیش‌فرض)، روشن و خودکار-روشن هر سه موجودند و مجموعه‌ی متغیر یکسان دارند', () => {
    assert.ok(dark && light && auto, 'بلوک‌های تم');
    const names = Object.keys(vars(dark.body)).sort();
    assert.ok(names.length >= 38);
    assert.deepEqual(Object.keys(vars(light.body)).sort(), names);
    assert.deepEqual(Object.keys(vars(auto.body)).sort(), names);
    assert.deepEqual(vars(auto.body), vars(light.body)); // تم خودکارِ روشن دقیقاً همان تم روشن
  });

  test('«کاغذ شب» تیره است، نه سیاه؛ رنگ‌ها صورتی/گرم', () => {
    const v = vars(dark.body);
    assert.notEqual(v['--nb-paper'].toLowerCase(), '#000000');
    assert.match(v['--nb-paper'], /^#[2-3][0-9a-f][2-3][0-9a-f][2-3][0-9a-f]$/i);
  });

  // کنتراست WCAG
  const lum = (hex) => {
    const [r, g, b] = [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

  for (const [name, block] of [['تیره', dark], ['روشن', light]]) {
    test(`کنتراست AA در تم ${name}`, () => {
      const v = vars(block.body);
      const hex = (k) => { assert.match(v[k], /^#[0-9a-fA-F]{6}$/, k); return v[k]; };
      const check = (fg, bg, min = 4.5) => assert.ok(ratio(hex(fg), hex(bg)) >= min, `${fg} روی ${bg}: ${ratio(hex(fg), hex(bg)).toFixed(2)} < ${min}`);
      for (const bg of ['--nb-paper', '--nb-paper-2', '--nb-card']) {
        check('--nb-ink', bg); check('--nb-ink-soft', bg); check('--nb-rose-strong', bg); check('--nb-focus', bg, 3);
      }
      check('--nb-on-strong', '--nb-rose-strong'); // متن دکمه‌ی توپر
      for (const t of ['rose', 'sage', 'sand', 'lilac', 'sky']) check('--nb-tape-ink', `--nb-tape-${t}`); // متن روی نوار چسب
      for (const c of ['work', 'half', 'off', 'holiday', 'leave', 'mission', 'warn', 'urgent', 'locked']) check(`--nb-chip-${c}-fg`, `--nb-chip-${c}-bg`);
    });
  }
});

describe('بدون وابستگی خارجی، دسترس‌پذیری و ریسپانسیو', () => {
  test('CSS: بدون @import/آدرس خارجی (فقط xmlns درون SVG)؛ تصویر فقط data:', () => {
    assert.doesNotMatch(css, /@import/);
    const urls = [...css.matchAll(/url\(([^)]*)\)/g)].map((m) => m[1].replace(/^["']|["']$/g, ''));
    assert.ok(urls.length >= 1);
    for (const u of urls) assert.match(u, /^data:image\/svg\+xml/);
    assert.deepEqual([...css.matchAll(/https?:\/\/[^\s'")]+/g)].map((m) => m[0]), ['http://www.w3.org/2000/svg']);
  });

  test('JS: وابستگی/شبکه/innerHTML ندارد؛ متن با textContent/createTextNode', () => {
    assert.doesNotMatch(js, /\brequire\(|\bimport\s|innerHTML|insertAdjacentHTML|outerHTML|\bfetch\(|XMLHttpRequest|eval\(|document\.write/);
    assert.match(js, /textContent/);
    assert.match(js, /createTextNode/);
    assert.match(js, /AP\.notebook = \{/);
  });

  test('فوکوس واضح، کاهش حرکت، sr-only', () => {
    assert.match(css, /\.nb :focus-visible \{ outline: 3px solid var\(--nb-focus\)/);
    assert.match(css, /@media \(prefers-reduced-motion: no-preference\)/);
    assert.doesNotMatch(css, /@keyframes/); // هیچ انیمیشن اجباری‌ای نیست
    assert.match(css, /\.nb \.nb-sr-only/);
  });

  test('ریسپانسیو: دو صفحه روی دسکتاپ، یک صفحه + pager زیر ۹۰۰px، فنر روی موبایل پنهان؛ بدون عرض ثابت بزرگ', () => {
    assert.match(css, /grid-template-columns: minmax\(0, 1fr\) 30px minmax\(0, 1fr\)/);
    const mobile = rules.filter((r) => /max-width: 899px/.test(r.at)).map((r) => r.sel).join('\n');
    assert.match(mobile, /nb-spring/);
    assert.match(mobile, /nb-pager/);
    assert.match(mobile, /data-page="1"/);
    assert.match(mobile, /data-page="2"/);
    assert.match(css, /\.nb \.nb-pager \{ display: none; \}/);
    assert.doesNotMatch(css, /[^-]width:\s*\d{3,}px/); // عرض ثابت ≥۱۰۰px ممنوع (۳۲۰px بدون اسکرول افقی)
    assert.match(css, /overflow-wrap: anywhere/);
  });

  test('اتصال به پنل: لینک CSS در <head> و notebook.js بعد از core.js؛ دموی توسعه در index نیست', () => {
    assert.match(indexHtml, /<link rel="stylesheet" href="\/admin\/css\/notebook\.css" \/>/);
    assert.ok(indexHtml.indexOf('/admin/js/core.js') < indexHtml.indexOf('/admin/js/notebook.js'));
    assert.doesNotMatch(indexHtml, /nb-demo/);
  });

  test('صفحه‌ی دمو: CSP-سازگار (بدون <style> و رویداد inline)، noindex، تم با theme.js', () => {
    assert.doesNotMatch(demoHtml, /<style|\son[a-z]+=|javascript:/i);
    assert.match(demoHtml, /name="robots" content="noindex"/);
    assert.match(demoHtml, /\/js\/theme\.js/);
    assert.match(demoHtml, /\/admin\/js\/nb-demo\.js/);
    assert.doesNotMatch(demoJs, /fetch\(|AP\.api|innerHTML/);
  });
});

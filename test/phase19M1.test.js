// فاز ۱۹ / M1: سبک‌سازی Mini App، فوکوس واحد و کنتراست نوار پایین.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'style.css'), 'utf8').replace(/\r\n/g, '\n');
const TOKENS = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'tokens.css'), 'utf8').replace(/\r\n/g, '\n');

function block(selector, source = CSS) {
  const start = source.indexOf(`${selector} {`);
  assert.ok(start >= 0, `قاعده‌ی ${selector} پیدا نشد`);
  return source.slice(start + selector.length + 2, source.indexOf('\n}', start));
}

const varsOf = (text) => Object.fromEntries([...text.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const parseHex = (value) => {
  const hex = value.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
};
const mix = (a, b, weight) => a.map((v, i) => v * weight + b[i] * (1 - weight));
const luminance = (rgb) => rgb.reduce((sum, value, i) => {
  const c = value / 255;
  const linear = c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  return sum + linear * [0.2126, 0.7152, 0.0722][i];
}, 0);
const contrast = (a, b) => {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
};

describe('فاز ۱۹ / M1 — Mini App', () => {
  test('blur فقط برای نوار پایین باقی مانده و افکت‌های ثابت/بی‌نهایت حذف شده‌اند', () => {
    assert.match(block('.bottom-nav'), /backdrop-filter:\s*blur\(14px\)/);
    assert.doesNotMatch(CSS, /\.app-header, \.card, \.list-item\s*\{[^}]*backdrop-filter/s);
    assert.doesNotMatch(CSS, /body::before|body::after|brand-orbit/);
  });

  test('کنترل‌های بومی از color-scheme تم جاری پیروی می‌کنند', () => {
    assert.match(block('.form input, .form select, .form textarea'), /color-scheme:\s*inherit/);
  });

  test('فقط یک قاعده‌ی focus-visible با حلقه‌ی برند باقی مانده است', () => {
    assert.equal((CSS.match(/^:focus-visible\s*\{/gm) || []).length, 1);
    assert.match(CSS, /:focus-visible \{ outline: 2px solid var\(--brand\); outline-offset: 2px; \}/);
  });

  test('متن غیرفعال نوار پایین در هر دو تم حداقل ۴٫۵:۱ کنتراست دارد', () => {
    const dark = varsOf(block(':root,\n:root[data-theme="dark"]', TOKENS));
    const light = varsOf(block(':root[data-theme="light"]', TOKENS));
    for (const [name, theme] of Object.entries({ dark, light })) {
      const nav = mix(parseHex(theme.rail), parseHex(theme.card), 0.86);
      const actual = contrast(parseHex(theme['rail-text']), nav);
      assert.ok(actual >= 4.5, `${name}: ${actual.toFixed(2)}:1`);
    }
    assert.match(block('.nav-btn'), /color:\s*var\(--rail-text\)/);
  });

  test('بلوک override انتهایی حذف و قواعد نهایی در محل اصلی ادغام شده‌اند', () => {
    assert.doesNotMatch(CSS, /هم‌راستاسازی بصری با پنل مدیریت/);
    assert.match(block('.btn.primary'), /background:\s*var\(--accent\)/);
    assert.match(block('.tab-btn.active'), /border-bottom-color:\s*var\(--brand\)/);
    assert.match(block('.nav-btn.active'), /color:\s*var\(--rail-text\)/);
    assert.doesNotMatch(CSS, /\.report-head/);
  });
});

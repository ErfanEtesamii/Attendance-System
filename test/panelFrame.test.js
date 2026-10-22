// فاز ۱۶ / T2: قاب پنل (پس‌زمینه، ورود، لوگو، آواتار، نوار بالا، سرتیتر، کارت) — بررسی ایستا از روی CSS و HTML واقعی.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const CSS = read('public-admin/css/style.css');
const HTML = read('public-admin/index.html');

// متن اولین قاعده‌ای که انتخابگرش دقیقاً `sel {` است (تا } هم‌ردیف بسته‌ی همان قاعده)
function rule(sel) {
  const i = CSS.indexOf(`\n${sel} {`);
  assert.ok(i >= 0, `قاعده‌ی ${sel} نیست`);
  const j = CSS.indexOf('\n}', i);
  const k = CSS.indexOf('\n', i + 1);
  const single = CSS.slice(i + 1, k);
  return single.includes('}') ? single : CSS.slice(i, j + 2);
}
const OLD_GREEN = /#7be495|#14a878|#25d9a0|#16b886|rgba\(\s*31,\s*207,\s*149/i;

describe('T2: قاب صفحه', () => {
  test('پس‌زمینه‌ی body تخت است (بدون گرادیان سبز/بنفش)', () => {
    const r = rule('body');
    assert.match(r, /background:\s*var\(--bg\)/);
    assert.doesNotMatch(r, /gradient/);
  });
  test('قاعده‌های قاب (ورود، لوگو، آواتار، نوار بالا، کارت) سبز سخت‌کد و رنگ تیره‌ی ثابت ندارند', () => {
    for (const sel of ['.login-card', '.brand-mark', '.brand-name', '.avatar', '.avatar.lg', '.avatar.purple', '.topbar', '.topbar-date', '.search-box input', '.icon-btn', '.card', '.view-header h2']) {
      const r = rule(sel);
      assert.doesNotMatch(r, OLD_GREEN, `${sel}: رنگ سبز قدیمی`);
      assert.doesNotMatch(r, /rgba\(\s*27,\s*28,\s*44/, `${sel}: رنگ تیره‌ی سخت‌کد (در تم روشن اشتباه است)`);
      assert.doesNotMatch(r, /var\(--green/, `${sel}: --green فقط برای معنای «موفق/حاضر»`);
    }
  });
  test('کارت روشن: عمق ظریف و شعاع از مقیاس توکن', () => {
    const r = rule('.card');
    assert.match(r, /border:\s*1px solid var\(--border\)/);
    assert.match(r, /box-shadow:\s*var\(--shadow\)/);
    assert.match(r, /border-radius:\s*var\(--radius\)/);
    assert.match(CSS, /--r-xl:\s*28px/);
    assert.match(CSS, /--radius:\s*var\(--r-xl\)/);
  });
  test('نوار بالا: پس‌زمینه‌ی توکنی و بدون blur/حاشیه‌ی تیره‌ی ثابت؛ فیلد جستجو از --field', () => {
    const r = rule('.topbar');
    assert.match(r, /background:\s*var\(--bg\)/);
    assert.doesNotMatch(r, /backdrop-filter|border-bottom/);
    assert.match(rule('.search-box input'), /background:\s*var\(--field\)/);
    assert.match(CSS, /\.search-box input:focus-visible \{[^}]*box-shadow/);
  });
  test('سرتیتر صفحه: clamp واکنش‌گرا، وزن هماهنگ و رنگ --brand', () => {
    const r = rule('.view-header h2');
    assert.match(r, /font-size:\s*clamp\(22px, 4vw, 32px\)/);
    assert.match(r, /font-weight:\s*750/);
    assert.match(r, /color:\s*var\(--brand\)/);
  });
  test('لوگو/آواتار با --brand و --on-brand', () => {
    assert.match(rule('.brand-mark'), /background:\s*var\(--brand\)[\s\S]*color:\s*var\(--on-brand\)/);
    assert.match(rule('.avatar'), /background:\s*var\(--brand\)[\s\S]*color:\s*var\(--on-brand\)/);
  });
});

describe('T2: صفحه‌ی ورود', () => {
  test('بخش ورود با کد بدون style= درون‌خطی (CSP-friendly)؛ idها و aria حفظ شده‌اند', () => {
    const i = HTML.indexOf('class="code-login"');
    assert.ok(i > 0);
    const seg = HTML.slice(i, HTML.indexOf('</div>', i));
    assert.doesNotMatch(seg, /style=/);
    assert.match(seg, /id="code-input"[^>]*aria-label="کد ورود ۸ رقمی"/);
    assert.match(seg, /id="code-login-btn"/);
  });
  test('دکمه‌ی ورود با کد نارنجی و کارت ورود دوپنله با عمق', () => {
    const r = CSS.slice(CSS.indexOf('.code-login #code-login-btn {'), CSS.indexOf('}', CSS.indexOf('.code-login #code-login-btn {')));
    assert.match(r, /background:\s*var\(--accent\)/);
    assert.match(r, /color:\s*var\(--on-accent\)/);
    assert.match(rule('.login-card'), /grid-template-columns:/);
    assert.match(rule('.login-card'), /box-shadow:\s*var\(--shadow\)/);
  });
});

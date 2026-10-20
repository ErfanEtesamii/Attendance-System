// M5 («وضعیت من»): پرداخت و مستندسازی — بررسی ایستا (بدون مرورگر): CSS فقط با توکن، قابل‌شکستن، چاپ، مستندات و ترتیب اسکریپت‌ها.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');

// فقط قاعده‌های .ms-* از style.css (هر خط/بلوکی که انتخابگرش با .ms- شروع می‌شود، از جمله داخل @media)
function msRules() {
  const css = read('public-admin/css/style.css');
  return css.split('\n').filter((l) => /\.ms-/.test(l));
}

describe('«وضعیت من» M5: CSS', () => {
  test('هیچ رنگ سخت‌کد (hex/rgb/hsl) در قاعده‌های .ms-* نیست؛ هر دو تم از توکن می‌آید', () => {
    for (const l of msRules()) assert.doesNotMatch(l, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/, l);
  });
  test('هیچ white-space: nowrap و عرض ثابت بزرگ روی .ms-*؛ دکمه‌ی تسک قابل شکستن است', () => {
    const rules = msRules().join('\n');
    assert.doesNotMatch(rules, /white-space:\s*nowrap/);
    assert.match(rules, /\.ms-task-actions \.btn \{[^}]*white-space:\s*normal/);
    assert.match(rules, /\.ms-task-actions \.btn \{[^}]*max-width:\s*100%/);
  });
  test('بدون کادر تو در تو: آیتم‌های داخل کارت فقط خط جداکننده دارند (بدون background/border-radius/box-shadow)', () => {
    for (const l of msRules().filter((x) => /^\.ms-(task|row|tasks|rows)\b/.test(x))) assert.doesNotMatch(l, /background|border-radius|box-shadow/, l);
  });
  test('چاپ: دکمه‌ها/نوار اقدام پنهان و کارت‌ها بین صفحه‌ها نمی‌شکنند', () => {
    const css = read('public-admin/css/style.css');
    const m = css.match(/@media print \{\n  \.ms-top[\s\S]*?\n\}/);
    assert.ok(m, 'بلوک چاپ .ms-*');
    assert.match(m[0], /\.ms-task-actions, \.ms-actions \{ display: none !important; \}/);
    assert.match(m[0], /break-inside: avoid/);
  });
  test('عرض ۳۶۰px و کمتر: دکمه‌های تسک تمام‌عرض', () => {
    assert.match(read('public-admin/css/style.css'), /@media \(max-width: 360px\) \{[^\r\n]*\.ms-task-actions \.btn \{ flex: 1 1 100%; \}/);
  });
});

describe('«وضعیت من» M5: ترتیب اسکریپت و مستندات', () => {
  test('index.html: views-weekly قبل از views-mystatus و هر دو قبل از bell.js', () => {
    const h = read('public-admin/index.html');
    const at = (n) => h.indexOf(`/admin/js/${n}`);
    assert.ok(at('views-weekly.js') > 0 && at('views-weekly.js') < at('views-mystatus.js'));
    assert.ok(at('views-mystatus.js') < at('bell.js'));
  });
  test('PHASE17_DECISIONS.md: دلیل /admin/me/* و فهرست «عمداً انجام نشد» و ریسک‌های باز', () => {
    const d = read('docs/PHASE17_DECISIONS.md');
    assert.match(d, /team\.week_view/);
    assert.match(d, /## عمداً انجام نشد/);
    assert.match(d, /## ریسک‌های باز/);
    for (const m of ['M1', 'M2', 'M3', 'M4', 'M5']) assert.match(d, new RegExp(`## ${m} `));
  });
  test('CHANGELOG و PROJECT_STATUS و UI_STATES به M4/M5 اشاره می‌کنند', () => {
    const c = read('CHANGELOG.md');
    assert.match(c, /«وضعیت من» — M5/);
    assert.match(c, /«وضعیت من» — M4/);
    assert.match(read('PROJECT_STATUS.md'), /فاز ۱۷/);
    assert.match(read('docs/UI_STATES.md'), /mystatus.*M4\/M5/);
  });
  test('هیچ مسیر /miniapp یا userId در views-mystatus.js (اسکوپ فقط از نشست)', () => {
    const v = read('public-admin/js/views-mystatus.js');
    assert.doesNotMatch(v, /\/miniapp\/|\/admin\/users\/|userId/);
  });
});

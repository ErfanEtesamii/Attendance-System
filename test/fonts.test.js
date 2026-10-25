// S5-8b: فونت self-hosted با fallback، نبودن هیچ CDN/Google Fonts، و CSP (font-src/style-src فقط 'self').
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');
const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) walk(rel, out); else out.push(rel);
  }
  return out;
};
const STYLESHEETS = ['public-admin/css/style.css', 'public/css/style.css'];

describe('فونت self-hosted (S5-8b)', () => {
  test('@font-face: font-display swap، منبع فقط local() و همین دامنه، وزن variable', () => {
    for (const f of STYLESHEETS) {
      const css = read(f);
      const m = css.match(/@font-face\s*\{[^}]*\}/);
      assert.ok(m, `${f}: @font-face نیست`);
      assert.match(m[0], /font-family:\s*"Vazirmatn"/);
      assert.match(m[0], /font-display:\s*swap/);
      assert.match(m[0], /font-weight:\s*100 900/);
      assert.match(m[0], /src:\s*local\("Vazirmatn"\),\s*url\("\/fonts\/Vazirmatn-Variable\.woff2"\)\s*format\("woff2"\)/);
      assert.doesNotMatch(m[0], /https?:\/\//);
    }
  });
  test('fallback: Tahoma، Segoe UI و system-ui بعد از Vazirmatn/Vazir در هر دو فایل', () => {
    for (const f of STYLESHEETS) assert.match(read(f), /font-family:\s*"Vazirmatn",\s*"Vazir",\s*Tahoma,\s*"Segoe UI",\s*system-ui,\s*sans-serif;/, f);
  });
  test('هیچ وابستگی CDN/Google Fonts در html/css/js سمت کلاینت؛ فقط ویجت رسمی تلگرام مجاز است', () => {
    const files = [...walk('public'), ...walk('public-admin')].filter((f) => /\.(html|css|js)$/.test(f));
    const BAD = /fonts\.googleapis|fonts\.gstatic|cdnjs|jsdelivr|unpkg|cdn\.[a-z]|@import\s+url\(\s*['"]?https?:/i;
    for (const f of files) assert.doesNotMatch(read(f), BAD, f);
    // هر URL مطلق http(s) باید در فهرست مجاز باشد (ویجت ورود تلگرام و پیوندهای مستند داخل متن)
    const ALLOWED = [/^https:\/\/telegram\.org\//, /^https:\/\/oauth\.telegram\.org/, /^https:\/\/t\.me\//, /^https:\/\/tapi\.bale\.ai\/miniapp\.js$/, /^http:\/\/www\.w3\.org\/2000\/svg$/];
    // اسکریپت رسمی تلگرام (self-hosted، vendor) خودش URLهای تلگرام را داخل کد دارد؛ فقط از «بررسی URL مطلق» مستثنا می‌شود (بررسی CDN/فونت بالا روی آن هم اعمال می‌شود)
    const VENDOR = [path.join('public', 'js', 'telegram-web-app.js')];
    for (const f of files.filter((x) => !VENDOR.some((v) => path.normalize(x).endsWith(v)))) {
      for (const m of read(f).matchAll(/https?:\/\/[^\s"'`)<>]+/g)) assert.ok(ALLOWED.some((re) => re.test(m[0])), `${f}: ${m[0]}`);
    }
  });
  test('CSP کامل پنل و Mini App: font-src و style-src فقط self؛ هیچ میزبان فونت بیرونی', () => {
    const sh = require('../src/middleware/securityHeaders');
    const build = sh.buildFullCsp || sh._buildFullCsp;
    assert.equal(typeof build, 'function', 'buildFullCsp باید export شود');
    for (const kind of ['panel', 'miniapp']) {
      const csp = build(kind, {});
      assert.match(csp, /font-src 'self'(;|$)/, kind);
      assert.match(csp, /style-src 'self'(;|$)/, kind);
      assert.doesNotMatch(csp, /googleapis|gstatic/, kind);
    }
  });
  test('اسکریپت نصب فونت: variable را پیدا و با نام ثابت کپی می‌کند؛ نبودن فایل ⇒ خطای روشن', () => {
    const { install, TARGET_NAME } = require('../scripts/install-fonts');
    const src = fs.mkdtempSync(path.join(os.tmpdir(), 'fnt-src-')); const dst = fs.mkdtempSync(path.join(os.tmpdir(), 'fnt-dst-'));
    fs.mkdirSync(path.join(src, 'fonts', 'webfonts'), { recursive: true });
    fs.writeFileSync(path.join(src, 'fonts', 'webfonts', 'Vazirmatn-Bold.woff2'), 'x');
    assert.throws(() => install(src, dst), /پیدا نشد/);
    fs.writeFileSync(path.join(src, 'fonts', 'webfonts', 'Vazirmatn[wght].woff2'), 'FONTDATA');
    const r = install(src, dst);
    assert.equal(path.basename(r.to), TARGET_NAME);
    assert.equal(fs.readFileSync(r.to, 'utf8'), 'FONTDATA');
    assert.throws(() => install(path.join(src, 'nope'), dst), /مبدأ/);
    assert.throws(() => execFileSync(process.execPath, [path.join(root, 'scripts', 'install-fonts.js'), path.join(src, 'nope')], { stdio: 'pipe' }));
  });
  test('راهنمای فونت وجود دارد', () => {
    assert.match(read('public/fonts/README.md'), /install-fonts\.js/);
  });
});

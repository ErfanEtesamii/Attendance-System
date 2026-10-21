const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
const MINI_HTML = read('public/index.html');
const ADMIN_HTML = read('public-admin/index.html');
const CSS = read('public/css/style.css');
const TOKENS = read('public/css/tokens.css');
const APP = read('public/js/app.js');

describe('فاز ۱۹ / M2 تا M6', () => {
  test('M2: هویت اصلی سرمه‌ای/نارنجی است و گرادیان سبز قدیمی حذف شده', () => {
    assert.doesNotMatch(CSS + TOKENS + MINI_HTML, /#7be495|#16b886|#25d9a0|#14a878|g-green|g-purple|g-orange|g-red/i);
    assert.match(CSS, /\.btn\.primary \{ background: var\(--accent\)/);
    assert.match(CSS, /\.tab-btn\.active[\s\S]*border-bottom-color: var\(--brand\)/);
    assert.doesNotMatch(CSS, /\.report-head/);
    assert.match(CSS, /\.view-title::before[\s\S]*background: var\(--brand\)/);
  });

  test('M3: integration محافظت‌شده، تأیید خروج و safe-area متصل‌اند', () => {
    assert.match(MINI_HTML, /\/js\/telegramIntegration\.js/);
    assert.match(APP, /TGI\.init\(\)/);
    assert.match(APP, /confirmCheckout/);
    assert.match(APP, /TGI\.setBackHandler/);
    assert.match(CSS, /--tg-content-safe-bottom/);
  });

  test('M4: حلقه‌ی پیشرفت، بازخورد موفقیت و خلاصه‌ی سه‌ستونه/چندنوبتی وجود دارد', () => {
    assert.match(MINI_HTML, /id="today-progress"[^>]*role="progressbar"/);
    assert.match(MINI_HTML, /id="progress-bar"[^>]*pathLength="100"/);
    for (const id of ['ti-checkin', 'ti-breaks', 'ti-checkout', 'ti-segments', 'action-feedback']) assert.match(MINI_HTML, new RegExp(`id="${id}"`));
    assert.match(APP, /strokeDashoffset/);
    assert.match(APP, /segments\.length > 1/);
    assert.doesNotMatch(APP, /addSegmentsCard/);
  });

  test('M5: تقویم ۳۰روزه، جزئیات/اعتراض و نمودار میله‌ای و دونات متصل‌اند', () => {
    assert.match(APP, /for \(let offset = -29; offset <= 0/);
    assert.match(APP, /renderHistoryDetail/);
    assert.match(APP, /مغایرت رکورد/);
    assert.match(APP, /class="report-bar/);
    assert.match(APP, /class="report-ring/);
    assert.match(APP, /Promise\.all/);
  });

  test('M6: هر دو اپ یک tokens.css مشترک را قبل از CSS خود می‌خوانند و alias حفظ شده', () => {
    for (const [html, ownCss] of [[MINI_HTML, '/css/style.css'], [ADMIN_HTML, '/admin/css/style.css']]) {
      assert.ok(html.indexOf('/css/tokens.css') >= 0);
      assert.ok(html.indexOf('/css/tokens.css') < html.indexOf(ownCss));
    }
    assert.match(TOKENS, /--card-bg: var\(--card\)/);
    assert.match(TOKENS, /--card-bg-2: var\(--card-2\)/);
    assert.doesNotMatch(CSS, /(^|[\s,{])\.chip([\s.{:#>+~]|$)/m);
    assert.match(CSS, /\.icon-chip/);
  });
});

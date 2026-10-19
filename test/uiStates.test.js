// S5-9c: حالت‌های UI — skeleton، خالی با پیام، خطا با تلاش مجدد، توست به‌جای alert، تأیید قبل از عملیات مخرب، و فهرست پوشش صفحات.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const S = require('../public/js/states.js');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');
const noComments = (s) => s.replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
const viewFiles = fs.readdirSync(path.join(root, 'public-admin', 'js')).filter((f) => /^views-.*\.js$/.test(f)).map((f) => `public-admin/js/${f}`);
const SAFE = (h) => { assert.doesNotMatch(h, /<[^>]*\s(on[a-z]+|style)\s*=|<script|https?:\/\//i); assert.doesNotMatch(h, /NaN|undefined/); };

describe('ماژول حالت‌ها', () => {
  test('skeleton: هر نوع، aria-busy، متن مخصوص خوانشگر، محدودکردن ردیف‌ها، بدون style/on*', () => {
    for (const kind of ['page', 'table', 'cards', 'list', 'plan', undefined]) {
      const h = S.skeletonHtml(kind);
      SAFE(h);
      assert.match(h, /role="status" aria-busy="true"/);
      assert.match(h, /<span class="sr-only">در حال بارگذاری…<\/span>/);
      assert.match(h, /aria-hidden="true"/); // شکل‌ها از خوانشگر پنهان؛ فقط متن خوانده می‌شود
    }
    assert.equal((S.skeletonHtml('table', { rows: 999 }).match(/class="sk-row"/g) || []).length, 12);
    assert.equal((S.skeletonHtml('table', { rows: 0 }).match(/class="sk-row"/g) || []).length, 6);
    assert.match(S.skeletonHtml('table', { label: '<b>x</b>' }), /&lt;b&gt;x&lt;\/b&gt;/);
  });
  test('skeleton «settings» (U4): نقش status، aria-busy، متن خوانشگر، شبکه‌ی فیلد، بدون style/on*؛ سایر حالت‌ها بی‌تغییر', () => {
    const h = S.skeletonHtml('settings');
    SAFE(h);
    assert.match(h, /role="status" aria-busy="true"/);
    assert.match(h, /<span class="sr-only">در حال بارگذاری…<\/span>/);
    assert.match(h, /class="st-layout sk-settings"/);
    assert.equal((h.match(/class="sk-field"/g) || []).length, 6);
    assert.match(S.skeletonHtml('list'), /class="sk-box"/);
    assert.doesNotMatch(S.skeletonHtml('list'), /sk-settings/);
    assert.match(read('public-admin/js/views-admin.js'), /AP\.view\('settings', \{\s*skeleton: 'settings'/);
  });
  test('تنظیمات (U4): CSS ریسپانسیو/لمسی/چاپ برای st-', () => {
    const css = read('public-admin/css/style.css');
    assert.match(css, /@media \(max-width: 900px\) \{[^@]*\.st-nav nav \{[^}]*overflow-x: auto/);
    assert.match(css, /@media \(max-width: 480px\) \{[^@]*\.st-actionbar \.btn \{ flex: 1/);
    const touch = css.split('@media (pointer: coarse), (max-width: 900px) {')[1].split('\n}\n')[0];
    for (const k of ['.st-nav-item', '.st-pill span', '.st-switch-wrap', '.st-more']) assert.ok(touch.includes(k), k);
    assert.match(css, /#bell-drawer, \.st-nav, \.st-actionbar \{ display: none !important/);
    assert.doesNotMatch(css.split('طراحی تازه (st-)')[1].split('زنگوله‌ی اعلان')[0], /#[0-9a-fA-F]{3,6}\b|rgba?\((?!0, 0, 0)/);
  });
  test('skeleton «plan» (C3): تخته با ۳ کارت روزانه، متن مخصوص خوانشگر، بدون style/on*', () => {
    const h = S.skeletonHtml('plan');
    SAFE(h);
    assert.match(h, /<div class="pl-board sk-plan">/);
    assert.equal((h.match(/class="pl-day sk-day"/g) || []).length, 3);
    assert.match(h, /<span class="sr-only">در حال بارگذاری…<\/span>/);
  });
  test('خالی: پیام escape‌شده با آیکن اختیاری', () => {
    const h = S.emptyHtml('<i>چیزی نیست</i>', { icon: '<svg></svg>' });
    assert.match(h, /^<div class="empty"><svg><\/svg>&lt;i&gt;/);
    SAFE(h);
  });
  test('خطا: role=alert، پیام escape‌شده، دکمه‌ی «تلاش دوباره» فقط با retryId؛ پیام پیش‌فرض', () => {
    const h = S.errorHtml('<img onerror=x>', { retryId: 'retry-btn' });
    assert.match(h, /role="alert"/);
    assert.match(h, /<button type="button" class="btn ghost" id="retry-btn">تلاش دوباره<\/button>/);
    assert.doesNotMatch(h, /<img/);
    assert.doesNotMatch(S.errorHtml('x'), /<button/);
    assert.match(S.errorHtml(''), /خطای ناشناخته/);
  });
});

describe('اتصال به پنل', () => {
  const core = read('public-admin/js/core.js');
  test('روتر: skeleton هنگام بارگذاری، aria-busy تا پایان، خطا با تلاش دوباره و retry به route برمی‌گردد', () => {
    assert.match(core, /UiStates\.skeletonHtml\(def\.skeleton \|\| 'page'\)/);
    assert.match(core, /page\.setAttribute\('aria-busy', 'true'\)/);
    assert.equal((core.match(/page\.removeAttribute\('aria-busy'\)/g) || []).length, 2); // موفق و خطا
    assert.match(core, /errorHtml\(err\.message, \{ icon: AP\.icon\('alert'\), retryId: 'retry-btn', esc \}\)/);
    assert.match(core, /retry\.addEventListener\('click', route\)/);
  });
  test('توست: خطا role=alert، موفقیت role=status', () => {
    assert.match(core, /setAttribute\('role', isErr \? 'alert' : 'status'\)/);
  });
  test('index.html: states.js قبل از core.js', () => {
    const h = read('public-admin/index.html');
    assert.ok(h.indexOf('/js/states.js') > -1 && h.indexOf('/js/states.js') < h.indexOf('/admin/js/core.js'));
  });
  test('CSS: skeleton با prefers-reduced-motion بی‌حرکت؛ در چاپ پنهان', () => {
    const css = read('public-admin/css/style.css');
    assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.sk-line::after \{ animation: none; \} \}/);
    assert.match(css, /\.skeleton, \.sidebar, \.topbar/);
  });
});

describe('توست به‌جای alert/confirm و تأیید عملیات مخرب', () => {
  test('هیچ alert/confirm/prompt در پنل و Mini App نیست', () => {
    const files = [...fs.readdirSync(path.join(root, 'public-admin', 'js')).map((f) => `public-admin/js/${f}`), 'public/js/app.js', 'public-admin/index.html', 'public/index.html'];
    for (const f of files) assert.doesNotMatch(noComments(read(f)), /(^|[^\w.])(alert|confirm|prompt)\s*\(|window\.(alert|confirm|prompt)/m, f);
  });
  test('هر DELETE در صفحه‌های پنل، تأیید (confirmBox/askReason) در ۳۰ خط قبلش دارد', () => {
    const bad = [];
    for (const f of viewFiles) {
      const L = read(f).split('\n');
      L.forEach((l, i) => {
        if (/method: 'DELETE'/.test(l)) {
          const ctx = L.slice(Math.max(0, i - 30), i + 1).join('\n');
          if (!/AP\.confirmBox|AP\.askReason/.test(ctx)) bad.push(`${f}:${i + 1}`);
        }
      });
    }
    assert.deepEqual(bad, []);
  });
  test('عملیات مخرب «نشست‌ها/بازنشانی تنظیم» دلیل اجباری می‌خواهند', () => {
    for (const [f, re] of [['public-admin/js/views-admin.js', /revoke-all-sessions/], ['public-admin/js/views-admin.js', /settings\/.*\/reset/], ['public-admin/js/views-main.js', /revoke-sessions/]]) {
      const L = read(f).split('\n'); const i = L.findIndex((l) => re.test(l) && /AP\.(api|attempt)/.test(l));
      assert.ok(i > 0, `${f} ${re}`);
      assert.match(L.slice(Math.max(0, i - 30), i + 1).join('\n'), /AP\.askReason/);
    }
  });
  test('حذف کاربر دو مرحله‌ای (confirmBox اول و دوم برای force)', () => {
    const src = read('public-admin/js/views-main.js');
    assert.ok((src.match(/AP\.confirmBox\(\{/g) || []).length >= 2);
  });
});

// فهرست پوشش صفحه‌ها (همان جدول docs/UI_STATES.md): هر صفحه‌ی ثبت‌شده در AP.view باید اینجا باشد.
const PAGES = {
  // name: [فایل، حالت خالی چطور: 'inline' | 'chart' | 'helper' | 'n/a']
  reports: ['views-admin.js', 'inline'], broadcast: ['views-admin.js', 'n/a'], settings: ['views-admin.js', 'inline'], holidays: ['views-admin.js', 'inline'],
  audit: ['views-admin.js', 'inline'], system: ['views-admin.js', 'n/a'], status: ['views-admin.js', 'n/a'], analytics: ['views-analytics.js', 'chart'],
  teamCalendar: ['views-calendar.js', 'helper'], dashboard: ['views-main.js', 'inline'], live: ['views-main.js', 'inline'], employees: ['views-main.js', 'inline'],
  profile: ['views-main.js', 'inline'], attendance: ['views-ops.js', 'inline'], leave: ['views-ops.js', 'inline'], leaveQueue: ['views-ops.js', 'inline'], checkin_permissions: ['views-ops.js', 'inline'],
  disputes: ['views-ops.js', 'inline'], suspicious: ['views-ops.js', 'inline'], nightly: ['views-ops.js', 'inline'], shifts: ['views-shifts.js', 'inline'], teamreports: ['views-teamreports.js', 'inline'],
  nextplan: ['views-nextplan.js', 'helper'], // D1 (فاز ۱۳): «برنامه هفته بعد»؛ حالت خالی: «برنامه‌ای ثبت نشده» و «کارمندی انتخاب نشده»
  remote: ['views-remote.js', 'helper'], // R6 (فاز ۱۴): صف بررسی دورکاری؛ حالت خالی: «ثبت دورکاری‌ای با این فیلتر پیدا نشد»
  weekly: ['views-weekly.js', 'n/a'], // صفحه‌ی جزئیات: شبکه‌ی ۷ روزه همیشه هست و خالی‌بودنِ هر روز پیام خودش را دارد
};

describe('پوشش صفحه‌ها', () => {
  test('هر AP.view ثبت‌شده در جدول PAGES هست (و برعکس)', () => {
    const found = {};
    for (const f of viewFiles) for (const m of read(f).matchAll(/AP\.view\('(\w+)'/g)) found[m[1]] = path.basename(f);
    assert.deepEqual(Object.keys(found).sort(), Object.keys(PAGES).sort());
    for (const [k, [file]] of Object.entries(PAGES)) assert.equal(found[k], file, k);
  });
  test('صفحه‌های لیستی حالت خالی با پیام دارند (inline در بخش خودشان، یا helper/چارت)', () => {
    for (const [name, [file, kind]] of Object.entries(PAGES)) {
      const src = read(`public-admin/js/${file}`);
      if (kind === 'inline') {
        const i = src.indexOf(`AP.view('${name}'`);
        const next = [...src.matchAll(/AP\.view\('(\w+)'/g)].map((m) => m.index).filter((x) => x > i)[0] || src.length;
        assert.match(src.slice(i, next), /emptyBox\(|class="empty"/, `${name}: حالت خالی ندارد`);
      } else if (kind === 'helper') assert.match(src, /emptyBox\(/, name);
      else if (kind === 'chart') assert.match(read('public-admin/js/charts.js'), /emptyFigure/, name);
    }
  });
  test('گزارش‌ها: جدول دپارتمان و کارمند هر دو پیام خالی دارند (رفع S5-9c)', () => {
    const src = read('public-admin/js/views-admin.js');
    assert.match(src, /emptyBox\('دپارتمانی برای نمایش نیست\.'\)/);
    assert.match(src, /emptyBox\('در این بازه داده‌ای برای کارمندان نیست\.'\)/);
  });
  test('docs/UI_STATES.md همه‌ی صفحه‌ها را فهرست کرده است', () => {
    const doc = read('docs/UI_STATES.md');
    for (const name of Object.keys(PAGES)) assert.ok(doc.includes(`\`${name}\``), `${name} در docs/UI_STATES.md نیست`);
    assert.match(doc, /Mini App/);
    assert.match(doc, /انجام نشده/);
  });
});

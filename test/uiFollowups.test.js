// S5-9c (تکمیل): حالت‌های Mini App، دکمه‌ی در حال ارسال، skeleton اختصاصی هر صفحه، جدول→کارت در موبایل، حذف فایل قدیمی پنل.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const A = require('../public-admin/js/a11y.js');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');
const viewFiles = fs.readdirSync(path.join(root, 'public-admin', 'js')).filter((f) => /^views-.*\.js$/.test(f)).map((f) => `public-admin/js/${f}`);

describe('Mini App: حالت‌های UI', () => {
  const app = read('public/js/app.js');
  const html = read('public/index.html');
  test('states.js قبل از app.js بارگذاری می‌شود؛ نسخه‌ی مشترک پنل و Mini App یکی است', () => {
    assert.ok(html.indexOf('/js/states.js') > -1 && html.indexOf('/js/states.js') < html.indexOf('/js/app.js'));
    assert.match(read('public-admin/index.html'), /<script src="\/js\/states\.js"><\/script>/);
    assert.equal(fs.existsSync(path.join(root, 'public-admin', 'js', 'states.js')), false);
  });
  test('تاریخچه، مرخصی و گزارش: skeleton، پیام خالی، خطا با «تلاش دوباره» (بدون innerHTML خامِ err.message)', () => {
    for (const [fn, id] of [['loadHistory', 'retry-history'], ['loadLeaveList', 'retry-leave'], ['loadReport', 'retry-report']]) {
      const i = app.indexOf(`async function ${fn}(`);
      const body = app.slice(i, app.indexOf('\n  }\n', i));
      assert.match(body, /renderLoading\(/, fn);
      assert.match(body, new RegExp(`renderError\\(\\w+, err, [^,]+, '${id}'\\)`), fn);
      assert.doesNotMatch(body, /innerHTML = [`'"][^`'"]*\$\{err\.message\}/, `${fn}: err.message خام در innerHTML`);
    }
    assert.equal((app.match(/renderEmpty\(/g) || []).length >= 2, true);
    assert.doesNotMatch(app, /innerHTML = `<div class="list-item">\$\{err\.message\}/);
  });
  test('بوت ناموفق (غیر از ۴۰۳): کارت خطا با دکمه‌ی «تلاش دوباره» و متن با textContent', () => {
    assert.match(app, /id="retry-boot">تلاش دوباره</);
    assert.match(app, /\$\('#retry-boot'\)\.addEventListener\('click', boot\)/);
    assert.match(app, /\$\('#app-error-msg'\)\.textContent = err\.message/);
    assert.match(html, /id="app-error"[^>]*aria-live="assertive"/);
  });
  test('توست: خطا role=alert و موفقیت role=status؛ خطاهای عملیات با isErr', () => {
    assert.match(html, /id="toast"[^>]*role="status"[^>]*aria-live="polite"/);
    assert.match(app, /setAttribute\('role', isErr \? 'alert' : 'status'\)/);
    assert.match(app, /showToast\(err\.message, true\)/);
  });
  test('دکمه‌های ورود/خروج، فرم مرخصی و اعتراض حین درخواست غیرفعال می‌شوند', () => {
    assert.match(app, /async function withBusy\(btn, fn\)/);
    assert.match(app, /withBusy\(submitBtn, \(\) => api\('\/leave'/);
    assert.match(app, /withBusy\(form\.querySelector\('\[type="submit"\]'\), \(\) => api\('\/dispute'/);
    const i = app.indexOf('async function doAction(');
    assert.match(app.slice(i, i + 600), /\$all\('#today-actions button'\)[\s\S]*disabled = true/);
  });
  test('CSS Mini App: skeleton با reduced-motion، .empty، .sr-only، توست خطا', () => {
    const css = read('public/css/style.css');
    for (const re of [/\.sk-line::after/, /\.empty \{/, /\.sr-only \{/, /\.toast\.err/, /prefers-reduced-motion: reduce\) \{ \.sk-line::after \{ animation: none; \}/]) assert.match(css, re);
  });
});

describe('پنل: دکمه‌ی در حال ارسال و skeleton اختصاصی', () => {
  const core = read('public-admin/js/core.js');
  test('AP.attempt دکمه را تا پایان قفل می‌کند و در finally باز می‌کند؛ ۳ پارامتر؛ داخل مودال نادیده', () => {
    assert.match(core, /AP\.attempt = async function attempt\(fn, okMsg, btn\)/);
    assert.match(core, /!b\.closest\('\.modal'\) && !b\.hasAttribute\('data-no-busy'\)/);
    assert.match(core, /finally \{\s*if \(lock\) \{ b\.disabled = false; b\.removeAttribute\('aria-busy'\); \}/);
    assert.match(core, /lastBtn = null; \/\/ هر کلیک فقط یک‌بار مصرف/);
  });
  test('هر ۲۲ صفحه skeleton اختصاصی (page/table/cards/list) دارد', () => {
    const kinds = {};
    for (const f of viewFiles) for (const m of read(f).matchAll(/AP\.view\('(\w+)', \{\n\s+skeleton: '(page|table|cards|list)'/g)) kinds[m[1]] = m[2];
    assert.equal(Object.keys(kinds).length, 22); // +checkin_permissions (فاز ۱۲، D3)
    assert.equal(kinds.analytics, 'cards'); assert.equal(kinds.attendance, 'table'); assert.equal(kinds.leaveQueue, 'list'); assert.equal(kinds.dashboard, 'page');
    const states = require('../public/js/states.js');
    for (const k of new Set(Object.values(kinds))) assert.match(states.skeletonHtml(k), /class="skeleton"/);
  });
});

describe('جدول → کارت در موبایل', () => {
  // ماک مینیمال DOM
  const el = (tag, text, attrs = {}, kids = []) => {
    const a = { ...attrs };
    const o = { tagName: tag, textContent: text, children: kids, className: a.class || '', a, setAttribute: (k, v) => { a[k] = v; }, getAttribute: (k) => (k in a ? a[k] : null), hasAttribute: (k) => k in a };
    return o;
  };
  function table({ sortable = false, cls = '', nostack = false, colspanRow = false } = {}) {
    const ths = ['نام', 'ساعت ▲', ''].map((t) => el('TH', t, sortable ? { class: 'sortable' } : {}));
    const tds = [el('TD', 'علی'), el('TD', '08:00'), el('TD', 'x')];
    const row = el('TR', '', {}, tds);
    const empty = el('TD', 'خالی', { colspan: '3' }); const emptyRow = el('TR', '', {}, [empty]);
    const rows = colspanRow ? [emptyRow] : [row];
    const thead = el('THEAD', ''); const tbody = el('TBODY', '');
    const t = el('TABLE', '', { ...(cls ? { class: cls } : {}), ...(nostack ? { 'data-nostack': '' } : {}) });
    t.querySelectorAll = (sel) => {
      if (sel === 'th.sortable, th[data-sort]') return sortable ? ths : [];
      if (sel === 'thead th') return ths;
      if (sel === 'thead, tbody') return [thead, tbody];
      if (sel === 'th') return ths;
      if (sel === 'tr') return rows;
      return [];
    };
    return { t, ths, tds, empty, rows };
  }
  test('برچسب ستون به هر سلول، نقش‌های ARIA و علامت data-stack', () => {
    const { t, tds, ths, rows } = table();
    assert.equal(A.stackTable(t), true);
    assert.ok('data-stack' in t.a); assert.equal(t.a.role, 'table');
    assert.deepEqual(tds.slice(0, 2).map((x) => x.a['data-label']), ['نام', 'ساعت']); // ▲ از برچسب حذف می‌شود
    assert.equal('data-label' in tds[2].a, false); // سرستون خالی ⇒ بدون برچسب
    assert.ok(tds.every((x) => x.a.role === 'cell')); assert.equal(rows[0].a.role, 'row'); assert.equal(ths[0].a.role, 'columnheader');
    assert.equal(A.stackTable(t), false); // idempotent
  });
  test('جدول مرتب‌سازی، تقویم و data-nostack تبدیل نمی‌شوند', () => {
    assert.equal(A.stackTable(table({ sortable: true }).t), false);
    assert.equal(A.stackTable(table({ cls: 'cal-table' }).t), false);
    assert.equal(A.stackTable(table({ nostack: true }).t), false);
    assert.equal(A.stackTable(null), false);
  });
  test('ردیف پیام خالی (colspan) برچسب نمی‌گیرد', () => {
    const { t, empty } = table({ colspanRow: true });
    assert.equal(A.stackTable(t), true);
    assert.equal('data-label' in empty.a, false);
    assert.equal(empty.a.role, 'cell');
  });
  test('CSS: فقط زیر ۶۰۰px و فقط table[data-stack]؛ سرستون برای خوانشگر می‌ماند (نه display:none)', () => {
    const css = read('public-admin/css/style.css');
    const i = css.indexOf('@media (max-width: 600px) {\n  table[data-stack]');
    assert.ok(i > 0);
    const seg = css.slice(i, css.indexOf('\n}\n', i));
    assert.match(seg, /td::before \{ content: attr\(data-label\)/);
    assert.match(seg, /thead \{ position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect\(0, 0, 0, 0\); \}/);
    assert.doesNotMatch(seg, /thead \{[^}]*display: none/);
    assert.match(seg, /td\[colspan\] \{ display: block; text-align: center; \}/);
  });
  test('enhance جدول‌های داخل .table-wrap را پردازش می‌کند', () => {
    const { t } = table(); let seen = 0;
    A.enhance({ querySelectorAll: (sel) => { if (sel === '.table-wrap table') { seen += 1; return [t]; } return []; } });
    assert.equal(seen, 1); assert.ok('data-stack' in t.a);
  });
});

describe('برنامه‌ی هفتگی: حالت‌ها و دسترسی‌پذیری (C3)', () => {
  const app = read('public/js/app.js');
  const css = read('public/css/style.css');
  const planFn = (name) => { const i = app.indexOf(`function ${name}(`); return app.slice(i, app.indexOf('\n  }\n', i)); };

  test('بارگذاری با skeleton «plan» و خطا با «تلاش دوباره» (retry-plan)', () => {
    const body = app.slice(app.indexOf('async function openPlanWizard('), app.indexOf('function renderPlan()'));
    assert.match(body, /renderLoading\(body, 'plan'\)/);
    assert.match(body, /renderError\(body, err, \(\) => openPlanWizard\(planUi\.week\), 'retry-plan'\)/);
  });

  test('خطای ثبت role=alert؛ مرحله‌ی فعال aria-current؛ فوکوس عنوان با tabindex=-1 بعد از تغییر مرحله', () => {
    const r = planFn('renderPlan');
    assert.match(r, /role: planUi\.msg \? 'alert' : 'status'/);
    assert.match(r, /setAttribute\('aria-current', 'step'\)/);
    assert.match(r, /heading\.setAttribute\('tabindex', '-1'\)/);
    assert.match(r, /const go = \(step\) => \{[^}]*planUi\.focusTop = true/);
    assert.match(css, /\.view-title:focus \{ outline: none; \}/);
  });

  test('هر فیلد label دارد؛ فیلدهای متنی dir=auto؛ هر کارت section با aria-labelledby', () => {
    const r = app.slice(app.indexOf('function renderPlan()'), app.indexOf('const planBack'));
    assert.match(r, /class: 'day-task-title'[^)]*dir: 'auto'|dir: 'auto', class: 'day-task-title'/);
    assert.match(r, /dir: 'auto', class: 'day-add-input'/);
    assert.match(r, /dir: 'auto', rows: 2/);
    for (const re of [/`عنوان تسک \$\{where\}`/, /`حذف تسک \$\{where\}`/, /`توضیح تسک \$\{where\}`/, /`روز تسک \$\{where\}`/, /`اولویت تسک \$\{where\}`/, /`تسک جدید برای \$\{titleText\}`/]) assert.match(r, re);
    assert.equal((r.match(/setAttribute\('aria-labelledby'/g) || []).length, 1);
    assert.match(app, /setAttribute\('aria-labelledby', 'plan-ro-' \+ seq\)/);
  });

  test('هدف لمسی ≥ ۴۴px: دکمه‌ی افزودن (btn)، حذف، چیپ، گزینه‌ی اولویت، summary، چک‌باکس انتقال', () => {
    for (const re of [/\.plan-chip \{[^}]*min-height: 44px/, /\.day-task-del \{[^}]*min-height: 44px/, /\.prio-opt \{[^}]*min-height: 44px/, /\.day-task-more summary \{[^}]*min-height: 44px/, /\.plan-carry \{[^}]*min-height: 44px/]) assert.match(css, re);
  });

  test('RTL: در CSS تخته/کارت/اولویت ویژگی فیزیکی چپ/راست نیست', () => {
    const from = css.indexOf('/* C1: کارت‌های روزانه');
    const to = css.indexOf('/* بنر الزام برنامه‌ی هفتگی (D5) */');
    const block = css.slice(from, to);
    assert.ok(block.length > 2000);
    assert.doesNotMatch(block, /(^|[\s;{])(left|right)\s*:|margin-(left|right)|padding-(left|right)|border-(left|right)|text-align:\s*(left|right)|float:/);
  });

  test('skeleton «plan» و گرید کارت‌ها با reduced-motion بی‌حرکت‌اند (shimmer عمومی)', () => {
    assert.match(css, /\.sk-plan \{/);
    assert.match(css, /prefers-reduced-motion: reduce\) \{ \.sk-line::after \{ animation: none; \}/);
  });
});

describe('فایل قدیمی و مستندات', () => {
  test('public-admin/js/app.js حذف شده و هیچ‌جا ارجاع زنده ندارد', () => {
    assert.equal(fs.existsSync(path.join(root, 'public-admin', 'js', 'app.js')), false);
    assert.doesNotMatch(read('public-admin/index.html'), /admin\/js\/app\.js/);
    assert.doesNotMatch(read('docs/SECURITY.md'), /بلااستفاده‌ی `public-admin\/js\/app\.js` هم هدر را دارد/);
  });
  test('docs/UI_STATES.md: Mini App و موارد تکمیل‌شده ثبت شده؛ بخش «انجام نشده» فقط موارد واقعاً باقی‌مانده', () => {
    const doc = read('docs/UI_STATES.md');
    assert.match(doc, /Mini App/);
    assert.match(doc, /انجام نشده/);
    assert.doesNotMatch(doc, /فایل قدیمی است و در `index.html` بارگذاری نمی‌شود؛ حالت‌هایش بررسی نشد/);
  });
  test('docs/UI_STATES.md: برنامه‌ی هفتگی (C3) با بارگذاری/خطا/خالی/فقط‌خواندنی/دسترسی‌پذیری ثبت شده', () => {
    const doc = read('docs/UI_STATES.md');
    assert.match(doc, /برنامه‌ی هفتگی \(کارت‌های روزانه\)/);
    for (const w of ['retry-plan', 'skeletonHtml(\'plan\')', 'فقط‌خواندنی', 'aria-current', 'dir="auto"', 'aria-labelledby', 'tabindex=-1']) assert.ok(doc.includes(w), w);
  });
});

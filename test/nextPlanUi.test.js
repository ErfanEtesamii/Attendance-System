// D1 (فاز ۱۳): صفحه‌ی «برنامه هفته بعد» در پنل — DOM ساختگی با vm (الگوی disputePanelUi) + بررسی ایستای اتصال‌ها. مرورگر واقعی اجرا نمی‌شود.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');
const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const makeEl = (extra = {}) => {
  const listeners = {};
  return { dataset: {}, value: '', checked: false, disabled: false, innerHTML: '', children: [], listeners,
    addEventListener(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
    appendChild(c) { this.children.push(c); return c; },
    replaceChildren(...cs) { this.children = cs; },
    fire(ev) { (listeners[ev] || []).forEach((fn) => fn({ target: this })); }, ...extra };
};
const makePage = ({ single = {}, multi = {} } = {}) => ({ querySelector: (s) => single[s] || null, querySelectorAll: (s) => multi[s] || [] });

const EMPLOYEES = [
  { id: 7, fullName: 'الف <img src=x onerror=alert(1)>', department: 'فروش', role: 'employee', planStatus: 'submitted', taskCount: 3, needsAttention: false },
  { id: 8, fullName: 'ب', department: null, role: 'employee', planStatus: 'draft', taskCount: 1, needsAttention: true },
  { id: 9, fullName: 'ج', department: 'انبار', role: 'employee', planStatus: 'none', taskCount: 0, needsAttention: true },
];
const OV = (o = {}) => ({ ok: true, weekStart: '2026-09-26', weekEnd: '2026-10-02', jalaliStart: '۱۴۰۵/۰۷/۰۴', jalaliEnd: '۱۴۰۵/۰۷/۱۰', isNextWeek: true, minTasks: 1, employees: EMPLOYEES, ...o });
const PLAN = (o = {}) => ({
  ok: true, employee: { id: 7, fullName: 'الف', managerId: 2 }, weekStart: '2026-09-26',
  plan: { id: 5, status: 'submitted', editable: true, lockReason: null, ...(o.plan || {}) },
  days: [{ date: '2026-09-26', schedule: { shift: { id: 1, name: 'عصر' }, start: '15:30', end: '21:00' }, tasks: [] }],
  anyDay: [], ...o.rest,
});

function setup({ ov = OV(), plan = PLAN(), planError = null, ovError = null, perms = ['team.week_view', 'plan.edit_team'] } = {}) {
  const gos = []; const urls = []; const printed = [];
  let refreshes = 0;
  const AP = {
    views: {}, nav: [], state: { me: { id: 1, role: 'admin' } },
    can: (...p) => p.every((x) => perms.includes(x)),
    planEditor: { create: () => ({ options: () => ({ enabled: true }), reset() {}, dispose() {} }) },
    esc, icon: () => '',
    badge: (cls, text) => `<span class="badge ${esc(cls)}">${esc(text)}</span>`,
    avatar: (n) => `<span class="avatar">${esc(n)}</span>`,
    ROLE: { admin: 'ادمین', manager: 'سرپرست', employee: 'کارمند', hr: 'منابع انسانی' },
    $: (sel, r) => (r && r.querySelector ? r.querySelector(sel) : null),
    $$: (sel, r) => (r && r.querySelectorAll ? Array.from(r.querySelectorAll(sel)) : []),
    view(id, def) { AP.views[id] = def; if (def.nav) AP.nav.push({ id, ...def.nav }); },
    go: (id, p) => gos.push([id, p]),
    refresh: () => { refreshes += 1; },
    notebook: { renderWeek: (m, o) => ({ marker: 'notebook', model: m, opts: o }), fa: (v) => String(v) },
    api: async (url) => {
      urls.push(url);
      if (url.startsWith('/admin/plan-overview')) { if (ovError) throw ovError; return ov; }
      if (/^\/admin\/users\/\d+\/plan/.test(url)) { if (planError) throw planError; return typeof plan === 'function' ? plan(url) : plan; }
      throw new Error(`مسیر پیش‌بینی‌نشده: ${url}`);
    },
  };
  const window = { AP, print: () => printed.push(1), addEventListener() {}, removeEventListener() {} };
  vm.runInNewContext(read('public-admin/js/views-nextplan.js'), { window, encodeURIComponent, Date, Number, String, Array, Object }, { filename: 'views-nextplan.js' });
  return { AP, def: AP.views.nextplan, gos, urls, printed, refreshes: () => refreshes, ui: AP.nextPlan.ui };
}
const err = (status, message) => Object.assign(new Error(message), { status });

describe('ثبت صفحه و منو', () => {
  test('منوی «📓 برنامه هفته بعد»، مجوز team.week_view، skeleton دفترچه', () => {
    const { def, AP } = setup();
    assert.equal(def.perm, 'team.week_view');
    assert.equal(def.skeleton, 'notebook');
    assert.deepEqual(AP.nav[0], { id: 'nextplan', icon: 'attendance', label: '📓 برنامه هفته بعد', group: 'کارمندان و تردد' });
  });
});

describe('فهرست کارمندان (ستون کناری)', () => {
  test('فقط همان کارمندانِ پاسخ سرور؛ نام مخرب escape؛ وضعیت متنی + ⚠ برای نیازمند توجه؛ کارمند انتخاب‌شده aria-current', async () => {
    const t = setup();
    const { html } = await t.def.render('7');
    assert.doesNotMatch(html, /<img/);
    assert.match(html, /الف &lt;img src=x onerror=alert\(1\)&gt;/);
    assert.equal((html.match(/class="np-emp( is-active)?"/g) || []).length, 3);
    for (const label of ['ثبت‌شده', 'پیش‌نویس', 'ثبت نشده']) assert.ok(html.includes(label), label);
    assert.equal((html.match(/class="np-warn"/g) || []).length, 2); // ب و ج
    assert.match(html, /نیازمند توجه/); // متن مخصوص خوانشگر؛ فقط آیکون نیست
    assert.match(html, /np-emp is-active" data-np-user="7" aria-current="true"/);
    assert.match(html, /فهرست کارمندان \(3 نفر\)/);
  });

  test('فیلتر خالص: جست‌وجو در نام/دپارتمان و «فقط بدون برنامه»', async () => {
    const { AP } = setup();
    const { filterEmployees } = AP.nextPlan;
    assert.deepEqual(filterEmployees(EMPLOYEES, { search: 'انبار' }).map((e) => e.id), [9]);
    assert.deepEqual(filterEmployees(EMPLOYEES, { onlyNone: true }).map((e) => e.id), [9]);
    assert.deepEqual(filterEmployees(EMPLOYEES, { search: '  ' }).map((e) => e.id), [7, 8, 9]);
    assert.deepEqual(filterEmployees(EMPLOYEES, { search: 'فروش', onlyNone: true }), []);
  });

  test('جست‌وجو و فیلتر روی لیست اعمال می‌شود و بدون رفرش کل صفحه؛ نتیجه‌ی خالی پیام دارد', async () => {
    const t = setup();
    const { mount } = await t.def.render('7');
    const list = makeEl(); const search = makeEl(); const only = makeEl();
    mount(makePage({ single: { '#np-list': list, '#np-search': search, '#np-only-none': only } }));
    search.value = 'انبار'; search.fire('input');
    assert.match(list.innerHTML, /data-np-user="9"/);
    assert.doesNotMatch(list.innerHTML, /data-np-user="7"/);
    search.value = 'چیزی که نیست'; search.fire('input');
    assert.match(list.innerHTML, /کارمندی با این فیلتر پیدا نشد/);
    search.value = ''; search.fire('input'); only.checked = true; only.fire('change');
    assert.deepEqual([...list.innerHTML.matchAll(/data-np-user="(\d+)"/g)].map((m) => m[1]), ['9']);
    assert.equal(t.refreshes(), 0);
    assert.equal(t.ui.search, ''); assert.equal(t.ui.onlyNone, true); // در حافظه‌ی صفحه می‌ماند
  });

  test('کلیک روی کارمند ⇒ AP.go(nextplan, id)؛ انتخاب بین رفرش‌ها حفظ می‌شود', async () => {
    const t = setup();
    const { mount } = await t.def.render('8');
    const b = makeEl({ dataset: { npUser: '9' } });
    mount(makePage({ multi: { '[data-np-user]': [b] } }));
    b.fire('click');
    assert.deepEqual(t.gos, [['nextplan', '9']]);
    t.urls.length = 0;
    const again = await t.def.render(null); // بدون پارامتر مسیر ⇒ همان کارمند قبلی
    assert.ok(t.urls.some((u) => u.startsWith('/admin/users/8/plan')));
    assert.match(again.html, /data-np-user="8" aria-current="true"/);
  });

  test('بدون کارمند انتخاب‌شده: پیام راهنما و هیچ درخواست برنامه‌ای نمی‌رود', async () => {
    const t = setup();
    const { html } = await t.def.render(null);
    assert.match(html, /یک کارمند را از فهرست انتخاب کنید/);
    assert.deepEqual(t.urls, ['/admin/plan-overview']);
  });
});

describe('سربرگ، حالت‌ها و دفترچه', () => {
  test('سربرگ: نام، شیفت مؤثر، وضعیت برنامه، نشان قابل‌ویرایش/فقط‌خواندنی (دلیل قفل)', async () => {
    let t = setup();
    let { html } = await t.def.render('7');
    assert.match(html, /<h2>الف<\/h2>/);
    assert.match(html, /شیفت مؤثر: عصر \(<bdi dir="ltr">15:30–21:00<\/bdi>\)/);
    assert.match(html, /✎ قابل ویرایش/);
    assert.match(html, /هفته‌ی ۱۴۰۵\/۰۷\/۰۴ تا ۱۴۰۵\/۰۷\/۱۰ \(هفته‌ی بعد\)/);
    for (const [plan, text] of [
      [{ editable: false, lockReason: 'week_started' }, 'فقط‌خواندنی (هفته شروع شده)'],
      [{ editable: false, lockReason: 'month_closed' }, 'فقط‌خواندنی (ماه بسته)'],
      [{ editable: false, lockReason: null }, 'فقط‌خواندنی (بدون مجوز ویرایش)'], // hr
    ]) {
      t = setup({ plan: PLAN({ plan }) });
      ({ html } = await t.def.render('7'));
      assert.ok(html.includes(text), text);
      assert.doesNotMatch(html, /✎ قابل ویرایش/);
    }
  });

  test('بدون شیفت: «بدون شیفت اختصاصی»', async () => {
    const t = setup({ plan: PLAN({ rest: { days: [{ date: 'x', schedule: { shift: null }, tasks: [] }] } }) });
    assert.match((await t.def.render('7')).html, /بدون شیفت اختصاصی/);
  });

  test('حالت خالی: «برنامه‌ای ثبت نشده» + پیشنهاد افزودن فقط وقتی مجوز ویرایش هست', async () => {
    let t = setup({ plan: PLAN({ plan: { id: null, status: 'draft', editable: true } }) });
    let { html } = await t.def.render('7');
    assert.match(html, /برای این هفته برنامه‌ای ثبت نشده است\./);
    assert.match(html, /می‌توانید برای این کارمند تسک اضافه کنید/);
    t = setup({ plan: PLAN({ plan: { id: null, status: 'draft', editable: false } }) });
    ({ html } = await t.def.render('7'));
    assert.match(html, /برنامه‌ای ثبت نشده است\./);
    assert.doesNotMatch(html, /تسک اضافه کنید/);
  });

  test('خطا: ۴۰۳ ⇒ «دسترسی غیرمجاز» با پیام سرور (فهرست می‌ماند)؛ خطای دیگر ⇒ پیام + «تلاش دوباره»؛ خطای فهرست ⇒ پرتاب برای صفحه‌ی خطای روتر', async () => {
    let t = setup({ planError: err(403, 'این کارمند خارج از دامنه‌ی دسترسی شماست.') });
    let { html } = await t.def.render('7');
    assert.match(html, /role="alert"/);
    assert.match(html, /دسترسی غیرمجاز: این کارمند خارج از دامنه‌ی دسترسی شماست\./);
    assert.match(html, /np-list/);

    t = setup({ planError: err(500, 'خطای سرور') });
    const r = await t.def.render('7');
    assert.match(r.html, /خطای سرور/);
    assert.match(r.html, /id="np-retry"/);
    const retry = makeEl();
    r.mount(makePage({ single: { '#np-retry': retry } }));
    retry.fire('click');
    assert.equal(t.refreshes(), 1);

    t = setup({ ovError: err(500, 'فهرست در دسترس نیست') });
    await assert.rejects(() => t.def.render('7'), /فهرست در دسترس نیست/);
  });

  test('mount: خروجی AP.notebook.renderWeek (مدل کامل) داخل #np-notebook قرار می‌گیرد؛ چاپ ⇒ window.print؛ میان‌بر نمای هفتگی F2', async () => {
    const plan = PLAN();
    const t = setup({ plan });
    const { mount } = await t.def.render('7');
    const host = makeEl(); const print = makeEl(); const weekly = makeEl({ dataset: { goWeekly: '7' } });
    mount(makePage({ single: { '#np-notebook': host, '[data-print]': print, '[data-go-weekly]': weekly } }));
    assert.equal(host.children.length, 1);
    assert.equal(host.children[0].marker, 'notebook');
    assert.equal(host.children[0].model, plan);
    print.fire('click'); assert.equal(t.printed.length, 1);
    weekly.fire('click'); assert.deepEqual(t.gos, [['weekly', '7']]);
  });
});

describe('ناوبری هفته', () => {
  test('قبل/بعدتر از weekStart پاسخ سرور؛ «هفته‌ی بعد» به پیش‌فرض برمی‌گردد و در هفته‌ی بعد غیرفعال است', async () => {
    const t = setup({ ov: OV({ weekStart: '2026-09-26', isNextWeek: false }) });
    const { html, mount } = await t.def.render('7');
    assert.match(html, /data-week-nav="2026-09-19"/);
    assert.match(html, /data-week-nav="2026-10-03"/);
    assert.doesNotMatch(html, /data-week-nav="" disabled/);
    const next = setup(); // isNextWeek = true
    assert.match((await next.def.render('7')).html, /data-week-nav="" disabled/);

    const prev = makeEl({ dataset: { weekNav: '2026-09-19' } }); const jump = makeEl({ dataset: { weekNav: '' } });
    mount(makePage({ multi: { '[data-week-nav]': [prev, jump] } }));
    prev.fire('click');
    assert.equal(t.ui.start, '2026-09-19'); assert.equal(t.refreshes(), 1);
    jump.fire('click');
    assert.equal(t.ui.start, ''); assert.equal(t.refreshes(), 2);
  });

  test('هفته‌ی انتخاب‌شده به هر دو API می‌رود و بین رفرش‌ها می‌ماند؛ دکمه‌ی غیرفعال کار نمی‌کند', async () => {
    const t = setup();
    t.ui.start = '2026-09-19';
    await t.def.render('7');
    assert.ok(t.urls.includes('/admin/plan-overview?start=2026-09-19'));
    assert.ok(t.urls.includes('/admin/users/7/plan?start=2026-09-19'));
    const { mount } = await t.def.render('7');
    const dis = makeEl({ dataset: { weekNav: '' }, disabled: true });
    mount(makePage({ multi: { '[data-week-nav]': [dis] } }));
    dis.fire('click');
    assert.equal(t.refreshes(), 0);
  });
});

describe('اتصال‌ها (ایستا)', () => {
  test('index.html: اسکریپت صفحه بعد از notebook.js و views-weekly.js؛ میان‌بر دوطرفه با F2', () => {
    const idx = read('public-admin/index.html');
    assert.ok(idx.indexOf('/admin/js/notebook.js') < idx.indexOf('/admin/js/views-nextplan.js'));
    assert.ok(idx.indexOf('/admin/js/views-weekly.js') < idx.indexOf('/admin/js/views-nextplan.js'));
    const weekly = read('public-admin/js/views-weekly.js');
    assert.match(weekly, /data-go="nextplan"/);
    assert.match(weekly, /AP\.can\('team\.week_view'\)/);
    assert.match(read('public-admin/js/views-nextplan.js'), /AP\.go\('weekly'/);
  });

  test('skeleton «notebook» امن است (بدون style/on*)؛ چاپ: ستون کارمندان پنهان، هر دو صفحه‌ی دفترچه، فنر/سایه حذف', () => {
    const S = require('../public/js/states.js');
    const h = S.skeletonHtml('notebook');
    assert.match(h, /role="status" aria-busy="true"/);
    assert.doesNotMatch(h, /<[^>]*\s(on[a-z]+|style)\s*=|<script/i);
    assert.match(h, /class="nb-spread"/);

    const page = read('public-admin/css/style.css');
    assert.match(page, /@media print \{\s*\.np-side \{ display: none !important; \}/);
    const nb = read('public-admin/css/notebook.css');
    const printCss = nb.slice(nb.indexOf('@media print'));
    assert.match(printCss, /\.nb \.nb-spread > \.nb-page \{ display: flex !important;/);
    assert.match(printCss, /\.nb-spring, \.nb \.nb-pager, \.nb \.nb-card__toggle, \.nb \.nb-task__actions, \.nb \.nb-task__handle, \.nb \.nb-edit-slot \{ display: none !important; \}/);
    assert.match(printCss, /box-shadow: none/);
  });

  test('چاپ همیشه روشن: توکن‌های @media print دقیقاً همان توکن‌های تم روشن‌اند (حتی اگر تم تیره باشد)', () => {
    const nb = read('public-admin/css/notebook.css');
    const vars = (b) => Object.fromEntries([...b.matchAll(/(--nb-[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
    const light = nb.match(/:root\[data-theme="light"\] \.nb \{([\s\S]*?)\n\}/)[1];
    const print = nb.slice(nb.indexOf('@media print')).match(/:root\[data-theme="light"\] \.nb \{([\s\S]*?)\n  \}/)[1];
    assert.deepEqual(vars(print), vars(light));
  });
});

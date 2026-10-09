// S4-14b: UI تقویم تیم (شبکه‌ی ماهانه) در پنل (views-calendar.js، view با شناسه‌ی teamCalendar).
// بدون مرورگر و بدون سرور: views-calendar.js واقعی داخل vm با AP ساختگی اجرا می‌شود و API را با داده‌ی قالب پاسخ S4-14a می‌گیرد؛
// خود API/اسکوپ/مجوز سرور در test/calendarApi.test.js قفل است. تست دستی مرورگر در گزارش S4-14b آمده است.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const Jalali = require('../public-admin/js/jalali.js');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'public-admin', 'js', 'views-calendar.js'), 'utf8');

const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const TODAY = '2026-10-09'; // ۱۷ مهر ۱۴۰۵
const YEAR = 1405;
const MONTH = 7; // مهر؛ ۳۰ روز

// سلول به شکل خروجی GET /admin/calendar
const cell = (date, over = {}) => ({
  date, isWorkingDay: true, isHoliday: false, holidayTitle: null, kind: 'normal', leave: null, hasRecord: false, status: 'future', lateMinutes: 0, ...over,
});
const leaveOf = (over = {}) => ({ kind: 'leave', leaveTypeId: 1, requestId: 5, unit: 'day', halfDayPart: null, startTime: null, endTime: null, ...over });

// ردیف کاربر: days = 30 سلول؛ over = { [شماره‌ی روز شمسی]: بازنویسی سلول }
function row(id, name, department, over = {}, { isActive = true } = {}) {
  const days = [];
  for (let d = 1; d <= 30; d += 1) days.push(cell(Jalali.jalaliToIso(YEAR, MONTH, d), over[d] || {}));
  return { user: { id, fullName: name, personnelCode: `P-${id}`, department, isActive }, days };
}
const apiData = (users, maxConcurrent = 0) => ({ year: YEAR, month: MONTH, from: '2026-09-23', to: '2026-10-22', label: 'مهر ۱۴۰۵', maxConcurrent, users });

function setup({ data, perms = ['dashboard.read'] } = {}) {
  const calls = [];
  const toasts = [];
  const modals = [];
  const AP = {
    views: {}, nav: [],
    state: { me: { id: 1, role: 'admin' }, perms: new Set(perms) },
    $: (sel, root) => (root && root.querySelector ? root.querySelector(sel) : null),
    esc,
    fmt: {
      num: (n) => String(n), today: () => TODAY, dateFull: (d) => `F(${d})`, min: (m) => `${m}m`,
    },
    icon: () => '',
    badge: (cls, text) => `<span class="badge ${esc(cls)}">${esc(text)}</span>`,
    avatar: (name) => `<span class="avatar">${esc(name)}</span>`,
    LEAVE_TYPE: { leave: 'مرخصی', mission: 'مأموریت' },
    view(id, def) { AP.views[id] = def; if (def.nav) AP.nav.push({ id, ...def.nav }); },
    refresh: () => { AP.refreshed = (AP.refreshed || 0) + 1; return Promise.resolve(); },
    toast: (m, isErr) => toasts.push({ m, isErr: !!isErr }),
    modal: (o) => { const h = { close() { h.closed = true; } }; modals.push(o); if (o.onMount) o.onMount(makeEl(), h); return h; },
    api: async (url) => {
      calls.push(url);
      if (data instanceof Error) throw data;
      if (!url.startsWith('/admin/calendar?')) throw new Error(`مسیر پیش‌بینی‌نشده: ${url}`);
      return typeof data === 'function' ? data(url) : data;
    },
  };
  vm.runInNewContext(SRC, { window: { AP, Jalali }, console });
  return { AP, calls, toasts, modals, def: AP.views.teamCalendar };
}

function makeEl(extra = {}) {
  const listeners = {};
  return {
    dataset: {}, value: '', innerHTML: '', textContent: '', listeners,
    addEventListener(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
    querySelector: () => makeEl(),
    async fire(ev, e = {}) { for (const fn of listeners[ev] || []) await fn({ target: this, ...e }); },
    ...extra,
  };
}
// هدف رویداد با closest(selector)؛ فقط برای همان selector خودش را برمی‌گرداند
const target = (sel, dataset) => ({ dataset, closest(s) { return s === sel ? this : null; } });

function makePage() {
  const reg = new Map();
  for (const sel of ['#cal-nav', '#cal-month', '#cal-year', '#cal-dept', '#cal-user', '#cal-grid', '#cal-warn']) reg.set(sel, makeEl());
  return { reg, querySelector: (sel) => reg.get(sel) || null };
}

const count = (html, re) => (html.match(re) || []).length;

describe('UI تقویم تیم (S4-14b)', () => {
  test('ثبت صفحه: شناسه teamCalendar، منوی «تقویم تیم»، مجوز dashboard.read (مثل API)', () => {
    const { def, AP } = setup({ data: apiData([]) });
    assert.ok(def, 'AP.view("teamCalendar")');
    assert.equal(def.perm, 'dashboard.read');
    assert.ok(AP.nav.some((n) => n.id === 'teamCalendar' && n.label === 'تقویم تیم'));
  });

  test('رندر: ماه جاری شمسی از امروز خوانده می‌شود و فقط یک درخواست به API می‌رود', async () => {
    const { def, calls } = setup({ data: apiData([row(1, 'الف', 'فنی')]) });
    const { html } = await def.render();
    assert.equal(calls.length, 1);
    assert.equal(calls[0], `/admin/calendar?year=${YEAR}&month=${MONTH}`);
    assert.match(html, /مهر ۱۴۰۵/);
    assert.equal(count(html, /<th class="cal-day/g), 30, 'یک ستون برای هر روز ماه');
  });

  test('هر وضعیت «رنگ + نماد + متن» دارد؛ نیم‌روز/ساعتی با نشانگر جدا؛ روز آینده بی‌نماد', async () => {
    const over = {
      1: { status: 'present' }, 2: { status: 'late', lateMinutes: 12 }, 3: { status: 'incomplete' }, 4: { status: 'absent' },
      5: { status: 'leave', leave: leaveOf() }, 6: { status: 'mission', leave: leaveOf({ kind: 'mission' }) },
      7: { status: 'holiday', isWorkingDay: false, isHoliday: true, holidayTitle: 'تعطیل تست' }, 8: { status: 'weekend', isWorkingDay: false },
      9: { status: 'pending' },
      10: { status: 'present', leave: leaveOf({ unit: 'hour', startTime: '10:00', endTime: '12:00' }) },
    };
    const { def } = setup({ data: apiData([row(1, 'الف', 'فنی', over)]) });
    const { html } = await def.render();
    const cellOf = (cls) => new RegExp(`<button[^>]*class="cal-cell ${cls}[^"]*"[^>]*>([^<]*)</button>`).exec(html);
    assert.equal(cellOf('cal-present')[1], '✓');
    assert.equal(cellOf('cal-late')[1], 'ت');
    assert.equal(cellOf('cal-incomplete')[1], '!');
    assert.equal(cellOf('cal-absent')[1], '✕');
    assert.equal(cellOf('cal-leave')[1], 'م');
    assert.equal(cellOf('cal-mission')[1], 'ما');
    assert.equal(cellOf('cal-holiday')[1], 'ط');
    assert.equal(cellOf('cal-weekend')[1], '–');
    assert.equal(cellOf('cal-pending')[1], '…');
    assert.equal(cellOf('cal-future')[1], '', 'روز آینده بی‌نماد');
    // متن معادل برای فناوری کمکی/hover (نه فقط رنگ)
    assert.match(html, /aria-label="الف — F\(\d{4}-\d{2}-\d{2}\) — تأخیر — 12m تأخیر"/);
    assert.match(html, /title="[^"]*تعطیل تست[^"]*"/);
    // مرخصی ساعتی: وضعیت حاضر می‌ماند ولی نشانگر cal-part و متن «ساعتی» دارد
    assert.match(html, /cal-present cal-part[^>]*aria-label="[^"]*مرخصی ساعتی/);
    // راهنما همه‌ی نمادها را با متن می‌آورد
    assert.match(html, /cal-legend/);
    for (const t of ['حاضر', 'تأخیر', 'غایب', 'مرخصی', 'مأموریت', 'تعطیل', 'آخر هفته']) assert.ok(html.includes(t), t);
  });

  test('امنیت: نام/دپارتمان/عنوان تعطیلی escape می‌شوند', async () => {
    const evil = '<img src=x onerror=alert(1)>';
    const { def } = setup({ data: apiData([row(1, evil, evil, { 3: { status: 'holiday', isWorkingDay: false, holidayTitle: evil } })]) });
    const { html } = await def.render();
    assert.ok(!html.includes('<img'), 'برچسب خام نباید در خروجی بیاید');
    assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  });

  test('هشدار هم‌زمانی: فقط وقتی تعداد «بیش از» آستانه است؛ مرخصی ساعتی/نیم‌روز شمرده نمی‌شود؛ ۰ = خاموش', async () => {
    const off = (d) => ({ [d]: { status: 'leave', leave: leaveOf() } });
    const mis = (d) => ({ [d]: { status: 'mission', leave: leaveOf({ kind: 'mission' }) } });
    const users = [
      row(1, 'الف', 'فنی', { ...off(5), ...off(9) }),
      row(2, 'ب', 'فنی', { ...mis(5), ...off(9) }),
      row(3, 'ج', 'مالی', { ...off(5), 9: { status: 'present', leave: leaveOf({ unit: 'half_day', halfDayPart: 'morning' }) } }),
    ];
    // آستانه ۲: روز ۵ سه نفر (بیش از ۲ ⇒ هشدار)؛ روز ۹ دو نفر کامل + یک نیم‌روز ⇒ فقط ۲ (برابر آستانه ⇒ بدون هشدار)
    const { def } = setup({ data: apiData(users, 2) });
    const { html } = await def.render();
    assert.equal(count(html, /class="cal-warn"/g), 1);
    assert.match(html, /بیش از 2 نفر/);
    assert.match(html, /روزهای ۵\)/, 'فقط روز ۵ در فهرست هشدار');
    assert.equal(count(html, /<td class="cal-over"/g), 1);
    // آستانه ۳: روز ۵ دقیقاً ۳ نفر ⇒ بدون هشدار
    assert.equal(count((await setup({ data: apiData(users, 3) }).def.render()).html, /class="cal-warn"/g), 0);
    // آستانه ۰ ⇒ خاموش (و به کاربر گفته می‌شود چرا)
    const zero = (await setup({ data: apiData(users, 0) }).def.render()).html;
    assert.equal(count(zero, /class="cal-warn"/g), 0);
    assert.match(zero, /هشدار هم‌زمانی خاموش است/);
  });

  test('فیلتر دپارتمان/نفر سمت UI و بدون درخواست دوباره؛ هشدار روی افراد نمایش‌داده‌شده حساب می‌شود', async () => {
    const off = { 5: { status: 'leave', leave: leaveOf() } };
    const users = [row(1, 'کارمند الف', 'فنی', off), row(2, 'کارمند ب', 'فنی', off), row(3, 'کارمند ج', 'مالی', off)];
    const { def, calls } = setup({ data: apiData(users, 2) });
    const { html, mount } = await def.render();
    assert.match(html, /class="cal-warn"/, 'کل شرکت: ۳ نفر روز ۵');
    assert.match(html, /<option value="فنی"/);
    assert.match(html, /<option value="مالی"/);

    const page = makePage();
    mount(page);
    const grid = page.reg.get('#cal-grid');
    const warn = page.reg.get('#cal-warn');
    const dept = page.reg.get('#cal-dept');
    const user = page.reg.get('#cal-user');

    dept.value = 'فنی';
    await dept.fire('change');
    assert.ok(grid.innerHTML.includes('کارمند الف') && grid.innerHTML.includes('کارمند ب') && !grid.innerHTML.includes('کارمند ج'));
    assert.equal(warn.innerHTML, '', 'دپارتمان فنی فقط ۲ نفر؛ برابر آستانه ⇒ بدون هشدار');
    assert.ok(user.innerHTML.includes('کارمند الف') && !user.innerHTML.includes('کارمند ج'), 'فهرست نفر هم به دپارتمان محدود شد');

    user.value = '2';
    await user.fire('change');
    assert.equal(count(grid.innerHTML, /<tr class=/g), 1, 'فقط یک ردیف');
    assert.ok(!grid.innerHTML.includes('cal-sum'), 'برای یک نفر ردیف هم‌زمانی معنا ندارد');

    assert.equal(calls.length, 1, 'فیلتر نباید API را دوباره صدا بزند');
  });

  test('ناوبری ماه: قبل/بعد/این ماه با رد شدن از مرز سال؛ انتخاب ماه/سال؛ خارج از بازه ⇒ توست', async () => {
    const { def, calls, AP, toasts } = setup({ data: (url) => apiData([row(1, 'الف', 'فنی')]) });
    const nav = async (n) => {
      const { mount } = await def.render();
      const page = makePage();
      mount(page);
      await page.reg.get('#cal-nav').fire('click', { target: target('[data-nav]', { nav: n }) });
      return page;
    };
    await nav('1'); // ⇒ مهر + ۱ = آبان
    await def.render();
    assert.equal(calls[calls.length - 1], `/admin/calendar?year=${YEAR}&month=8`);
    assert.equal(AP.refreshed, 1);

    // اسفند ← فروردین سال بعد: ماه را روی ۱۲ ببریم و «بعد» بزنیم
    let page = makePage();
    let { mount } = await def.render(); mount(page);
    page.reg.get('#cal-month').value = '12';
    await page.reg.get('#cal-month').fire('change');
    ({ mount } = await def.render());
    page = makePage(); mount(page);
    await page.reg.get('#cal-nav').fire('click', { target: target('[data-nav]', { nav: '1' }) });
    await def.render();
    assert.equal(calls[calls.length - 1], `/admin/calendar?year=${YEAR + 1}&month=1`);

    // «این ماه»
    ({ mount } = await def.render()); page = makePage(); mount(page);
    await page.reg.get('#cal-nav').fire('click', { target: target('[data-nav]', { nav: 'today' }) });
    await def.render();
    assert.equal(calls[calls.length - 1], `/admin/calendar?year=${YEAR}&month=${MONTH}`);

    // مرز پایین سال‌های پشتیبانی‌شده: سال ۱۳۰۰ فروردین ⇒ «قبل» رد می‌شود و refresh اضافه نمی‌شود
    ({ mount } = await def.render()); page = makePage(); mount(page);
    page.reg.get('#cal-year').value = '1300';
    await page.reg.get('#cal-year').fire('change');
    ({ mount } = await def.render()); page = makePage(); mount(page);
    page.reg.get('#cal-month').value = '1';
    await page.reg.get('#cal-month').fire('change');
    ({ mount } = await def.render()); page = makePage(); mount(page);
    const before = AP.refreshed;
    await page.reg.get('#cal-nav').fire('click', { target: target('[data-nav]', { nav: '-1' }) });
    assert.equal(AP.refreshed, before, 'ماه قبل از ۱۳۰۰ فروردین نباید برود');
    assert.ok(toasts.some((t) => t.isErr));
  });

  test('کلیک روی سلول: مودال جزئیات از داده‌ی همان پاسخ (بدون درخواست اضافه) با وضعیت/تعطیلی/تأخیر/مرخصی و لینک پروفایل', async () => {
    const users = [row(7, 'کارمند الف', 'فنی', {
      4: { status: 'late', lateMinutes: 25, hasRecord: true },
      6: { status: 'holiday', isWorkingDay: false, isHoliday: true, holidayTitle: 'تعطیل تست' },
      8: { status: 'present', leave: leaveOf({ unit: 'half_day', halfDayPart: 'afternoon' }) },
    })];
    const { def, modals, calls } = setup({ data: apiData(users) });
    const { mount } = await def.render();
    const page = makePage();
    mount(page);
    const grid = page.reg.get('#cal-grid');
    const click = (i) => grid.fire('click', { target: target('[data-u]', { u: '7', i: String(i) }) });

    await click(3); // روز ۴
    assert.equal(modals.length, 1);
    assert.match(modals[0].title, /کارمند الف/);
    assert.ok(modals[0].body.includes('تأخیر') && modals[0].body.includes('25m'));
    assert.ok(modals[0].body.includes('href="#/profile/7"'));

    await click(5); // روز ۶
    assert.ok(modals[1].body.includes('تعطیل رسمی') && modals[1].body.includes('تعطیل تست'));

    await click(7); // روز ۸
    assert.ok(modals[2].body.includes('نیم‌روز عصر'));

    await grid.fire('click', { target: { dataset: {}, closest: () => null } }); // کلیک بیرون از سلول
    assert.equal(modals.length, 3);
    assert.equal(calls.length, 1, 'جزئیات بدون درخواست اضافه');
  });

  test('بدون کاربر ⇒ پیام خالی؛ خطای API به روتر می‌رسد (نه رندر ناقص)', async () => {
    const { html } = await setup({ data: apiData([]) }).def.render();
    assert.match(html, /کارمندی با این فیلتر وجود ندارد/);
    await assert.rejects(() => setup({ data: new Error('دسترسی ندارید') }).def.render(), /دسترسی ندارید/);
  });
});

// S4-13b: UI صف تأیید مرخصی/مأموریت در پنل (views-ops.js، view با شناسه‌ی leaveQueue).
// بدون مرورگر و بدون سرور: views-ops.js واقعی داخل vm با AP ساختگی اجرا می‌شود و API را با داده‌ی قالب پاسخ S4-13a می‌گیرد؛
// خود API/اسکوپ/مجوز سرور در test/leaveQueueApi.test.js قفل است. تست دستی مرورگر در گزارش S4-13b آمده است.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JS_DIR = path.join(__dirname, '..', 'public-admin', 'js');
const read = (f) => fs.readFileSync(path.join(JS_DIR, f), 'utf8');

const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const minText = (text) => ({ negative: false, days: 0, hours: 0, minutes: 0, text });

// یک آیتم به شکل خروجی GET /admin/leave-queue
function item(over = {}) {
  return {
    id: 1, kind: 'leave', leaveType: { id: 1, code: 'annual', title: 'استحقاقی' }, status: 'pending',
    startDate: '2026-10-10', endDate: '2026-10-12', unit: 'day', halfDayPart: null, startTime: null, endTime: null, durationMinutes: 1440,
    reason: 'سفر', createdAt: '2026-10-01 08:00:00',
    employee: { id: 7, fullName: 'کارمند الف', personnelCode: 'P-7', department: 'فنی', managerId: 3 },
    currentStep: 1, awaitingRole: 'manager', canDecide: true,
    chain: [{ step: 1, approverRole: 'manager', status: 'pending' }],
    attachment: null,
    balance: { tracked: true, jalaliYear: 1405, remaining: 4800, remainingAfterApproval: 3360, insufficient: false, display: { remaining: minText('۱۰ روز'), remainingAfterApproval: minText('۷ روز') } },
    ...over,
  };
}

// AP ساختگی + اجرای واقعی بخش views-ops.js
function setup({ queue, types = [{ id: 1, title: 'استحقاقی' }], users = [], perms = ['leave.approve', 'users.read'], me = { id: 1, role: 'admin' } } = {}) {
  const calls = [];
  const toasts = [];
  const modals = [];
  const answers = { reason: 'دلیل تست', confirm: true };
  const AP = {
    views: {}, nav: [],
    state: { me, perms: new Set(perms) },
    can: (...p) => p.every((x) => AP.state.perms.has(x)),
    $: (sel, root) => (root && root.querySelector ? root.querySelector(sel) : null),
    $$: (sel, root) => (root && root.querySelectorAll ? Array.from(root.querySelectorAll(sel)) : []),
    esc,
    fmt: { num: (n) => String(n), dateLong: (d) => `J(${d})`, dateTime: (d) => `T(${d})`, date: (d) => d, clock: (d) => d, min: (m) => `${m}m` },
    icon: () => '',
    badge: (cls, text) => `<span class="badge ${esc(cls)}">${esc(text)}</span>`,
    avatar: (name) => `<span class="avatar">${esc(name)}</span>`,
    LEAVE_TYPE: { leave: 'مرخصی', mission: 'مأموریت' },
    LEAVE_STATUS: { pending: 'در انتظار', approved: 'تأییدشده', rejected: 'ردشده' },
    view(id, def) { AP.views[id] = def; if (def.nav) AP.nav.push({ id, ...def.nav }); },
    loadUsers: async () => users,
    dates: { mount: () => [] },
    formData: (form) => ({ ...form.values }),
    refresh: () => { AP.refreshed = (AP.refreshed || 0) + 1; return Promise.resolve(); },
    refreshCounts: () => {},
    toast: (m, isErr) => toasts.push({ m, isErr: !!isErr }),
    askReason: async (o) => { calls.push({ askReason: o }); return answers.reason; },
    confirmBox: async (o) => { calls.push({ confirmBox: o }); return answers.confirm; },
    modal: (o) => { modals.push(o); return { close() {} }; },
    api: async (url, opts = {}) => {
      calls.push({ url, method: opts.method || 'GET', body: opts.body });
      if (url.startsWith('/admin/leave-queue/bulk')) return AP.bulkResponse(opts.body);
      if (url.startsWith('/admin/leave-queue')) return typeof queue === 'function' ? queue(url) : queue;
      if (url.startsWith('/admin/leave-types')) return types;
      throw new Error(`مسیر پیش‌بینی‌نشده: ${url}`);
    },
    bulkResponse: (body) => ({ action: body.action, results: body.ids.map((id) => ({ id, ok: true })), summary: { requested: body.ids.length, succeeded: body.ids.length, failed: 0 } }),
  };
  const sandbox = { window: { AP }, document: {}, console, URLSearchParams };
  vm.runInNewContext(read('views-ops.js'), sandbox);
  return { AP, calls, toasts, modals, answers, def: AP.views.leaveQueue };
}

// صفحه‌ی ساختگی: عنصرهایی که mount می‌گیرد؛ listenerها ثبت می‌شوند تا تست بتواند رویداد بفرستد
function makeEl(extra = {}) {
  const listeners = {};
  return {
    dataset: {}, checked: false, disabled: false, textContent: '', values: {},
    listeners,
    addEventListener(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
    querySelector: () => null, querySelectorAll: () => [],
    async fire(ev, e = {}) { for (const fn of listeners[ev] || []) await fn({ target: this, ...e }); },
    ...extra,
  };
}
function makePage(items) {
  const reg = new Map();
  const checks = items.filter((i) => i.canDecide).map((i) => makeEl({ dataset: { q: String(i.id) } }));
  const acts = [];
  items.filter((i) => i.canDecide).forEach((i) => ['approve', 'reject'].forEach((a) => acts.push(makeEl({ dataset: { act: a, id: String(i.id) } }))));
  const form = makeEl();
  for (const sel of ['#q-chips', '#q-all', '#q-count', '#q-approve', '#q-reject', '#q-prev', '#q-next']) reg.set(sel, makeEl());
  reg.set('#q-filters', form);
  return {
    reg, checks, acts, form,
    querySelector: (sel) => reg.get(sel) || null,
    querySelectorAll: (sel) => (sel === '.q-check' ? checks : sel === '[data-act]' ? acts : []),
  };
}
// اشیای ساخته‌شده داخل vm نمونه‌ی Object/Array دیگری دارند؛ برای deepEqual به شکل ساده برمی‌گردانیم
const plain = (v) => JSON.parse(JSON.stringify(v));

describe('UI صف تأیید مرخصی (S4-13b)', () => {
  test('ثبت صفحه: شناسه leaveQueue، منوی «صف تأیید»، مجوز «هرکدام از» leave.approve یا leave.approve.hr', () => {
    const { def, AP } = setup({ queue: { items: [], total: 0, limit: 50, offset: 0 } });
    assert.ok(def, 'AP.view("leaveQueue")');
    assert.deepEqual(plain(def.perm), ['leave.approve', 'leave.approve.hr']);
    assert.ok(AP.nav.some((n) => n.id === 'leaveQueue' && n.label === 'صف تأیید'));
  });

  test('viewAllowed واقعی (core.js): perm آرایه‌ای ⇒ هرکدام کافی؛ بدون هیچ‌کدام (کارمند) ⇒ بسته؛ perm رشته‌ای مثل قبل', () => {
    const makeEl2 = () => ({ innerHTML: '', style: {}, classList: { add() {}, remove() {}, contains: () => false, toggle() {} }, addEventListener() {}, setAttribute() {}, querySelector: () => null, querySelectorAll: () => [] });
    const sb = { document: { querySelector: makeEl2, querySelectorAll: () => [], addEventListener() {}, createElement: makeEl2 }, console, URL, URLSearchParams, setTimeout, clearTimeout, location: { href: '', hash: '' }, history: {}, scrollTo() {}, addEventListener() {}, fetch: async () => ({}) };
    sb.window = sb;
    vm.createContext(sb);
    for (const f of ['jalali.js', 'core.js']) vm.runInContext(read(f), sb, { filename: f });
    const { AP } = sb;
    const def = { perm: ['leave.approve', 'leave.approve.hr'] };
    AP.state.perms = new Set(['leave.approve.hr']);
    assert.equal(AP.viewAllowed(def), true, 'hr با leave.approve.hr');
    AP.state.perms = new Set(['leave.approve']);
    assert.equal(AP.viewAllowed(def), true, 'سرپرست/ادمین با leave.approve');
    AP.state.perms = new Set(['leave.read', 'leave.edit']);
    assert.equal(AP.viewAllowed(def), false, 'کارمند');
    assert.equal(AP.viewAllowed({ perm: [] }), false, 'آرایه‌ی خالی ⇒ بسته');
    assert.equal(AP.viewAllowed({ perm: 'leave.edit' }), true, 'رشته‌ای مثل قبل');
    assert.equal(AP.viewAllowed({}), false, 'بدون perm ⇒ default-deny');
  });

  test('رندر: درخواست به API صف با پیش‌فرض pending/limit می‌رود؛ چک‌باکس و دکمه فقط برای canDecide؛ مانده و هشدار کافی‌نبودن', async () => {
    const items = [
      item({ id: 1, balance: { ...item().balance, remainingAfterApproval: -480, insufficient: true, display: { remaining: minText('۱ روز'), remainingAfterApproval: minText('منفی ۱ روز') } } }),
      item({ id: 2, canDecide: false, awaitingRole: 'hr', employee: { id: 8, fullName: 'کارمند ب', personnelCode: null, department: null, managerId: 3 }, chain: [{ step: 1, approverRole: 'manager', status: 'approved' }, { step: 2, approverRole: 'hr', status: 'pending' }], balance: { tracked: false } }),
    ];
    const { def, calls } = setup({ queue: { items, total: 2, limit: 50, offset: 0 } });
    const { html } = await def.render();
    assert.match(calls[0].url, /^\/admin\/leave-queue\?/);
    const qs = new URLSearchParams(calls[0].url.split('?')[1]);
    assert.equal(qs.get('status'), 'pending');
    assert.equal(qs.get('limit'), '50');
    assert.equal(qs.get('offset'), '0');
    assert.equal(qs.get('decidable'), null, 'پیش‌فرض: همه‌ی pendingهای قابل‌دیدن');

    assert.equal((html.match(/class="q-check"/g) || []).length, 1, 'فقط درخواست قابل‌تصمیم چک‌باکس دارد');
    assert.equal((html.match(/data-act="approve"/g) || []).length, 1);
    assert.equal((html.match(/data-act="reject"/g) || []).length, 1);
    assert.match(html, /مانده کافی نیست/);
    assert.match(html, /منفی ۱ روز/);
    assert.match(html, /این نوع از مانده کسر نمی‌شود/);
    assert.match(html, /منتظر منابع انسانی/);
    assert.match(html, /سرپرست \(تأیید\) ← منابع انسانی \(در انتظار\)/, 'زنجیره‌ی دو مرحله‌ای نمایش داده می‌شود');
    assert.match(html, /id="q-all"/);
    assert.doesNotMatch(html, /id="q-prev"/, 'زیر یک صفحه ⇒ بدون صفحه‌بندی');
  });

  test('رندر: متن‌های کاربر escape می‌شوند (نام، دلیل، نام پیوست)؛ لینک پیوست امن و با rel=noopener', async () => {
    const evil = '<img src=x onerror=alert(1)>';
    const items = [item({
      employee: { id: 7, fullName: evil, personnelCode: '"><script>', department: evil, managerId: 3 },
      reason: evil,
      attachment: { url: '/api/admin/leave-requests/1/attachment', mime: 'image/png', name: evil, size: 10 },
    })];
    const { def } = setup({ queue: { items, total: 1, limit: 50, offset: 0 } });
    const { html } = await def.render();
    assert.doesNotMatch(html, /<img src=x/);
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.match(html, /href="\/api\/admin\/leave-requests\/1\/attachment" target="_blank" rel="noopener"/);
  });

  test('رندر: خالی ⇒ پیام «درخواستی با این فیلتر وجود ندارد»؛ صفحه‌بندی وقتی total > ۵۰؛ فیلتر تیم فقط برای غیر‌سرپرست', async () => {
    const mgrs = [{ id: 3, fullName: 'سرپرست', role: 'manager', isActive: true }, { id: 9, fullName: 'کارمند', role: 'employee', isActive: true }];
    let r = setup({ queue: { items: [], total: 0, limit: 50, offset: 0 }, users: mgrs });
    let { html } = await r.def.render();
    assert.match(html, /درخواستی با این فیلتر وجود ندارد/);
    assert.doesNotMatch(html, /id="q-bulk"/, 'بدون مورد قابل‌تصمیم ⇒ نوار دسته‌جمعی نیست');
    assert.match(html, /name="team"/);
    assert.match(html, /<option value="3"[^>]*>سرپرست<\/option>/);
    assert.doesNotMatch(html, /<option value="9"/, 'فقط سرپرست‌ها در فیلتر تیم');

    r = setup({ queue: { items: [], total: 0, limit: 50, offset: 0 }, users: mgrs, me: { id: 3, role: 'manager' } });
    ({ html } = await r.def.render());
    assert.doesNotMatch(html, /name="team"/, 'سرپرست فقط تیم خودش را می‌بیند؛ فیلتر تیم ندارد');

    r = setup({ queue: { items: [item()], total: 120, limit: 50, offset: 0 } });
    ({ html } = await r.def.render());
    assert.match(html, /id="q-prev"[^>]*disabled/);
    assert.match(html, /id="q-next"(?![^>]*disabled)/);
  });

  test('تصمیم دسته‌جمعی: انتخاب‌همه ⇒ رد با دلیل اجباری به endpoint bulk؛ انصراف از دلیل ⇒ هیچ درخواستی نمی‌رود', async () => {
    const items = [item({ id: 1 }), item({ id: 2 }), item({ id: 3, canDecide: false })];
    const { def, calls, answers, toasts } = setup({ queue: { items, total: 3, limit: 50, offset: 0 } });
    const { mount } = await def.render();
    const page = makePage(items);
    mount(page);

    const all = page.reg.get('#q-all');
    all.checked = true;
    await all.fire('change');
    assert.equal(page.reg.get('#q-reject').disabled, false);
    assert.equal(page.reg.get('#q-approve').disabled, false);
    assert.match(page.reg.get('#q-count').textContent, /2 مورد/);
    assert.ok(page.checks.every((c) => c.checked), 'همه‌ی چک‌باکس‌ها تیک می‌خورند');

    answers.reason = null; // انصراف
    const before = calls.length;
    await page.reg.get('#q-reject').fire('click');
    assert.equal(calls.slice(before).filter((c) => c.url).length, 0, 'بدون دلیل ⇒ هیچ تماسی با سرور');
    const ask = calls.find((c) => c.askReason).askReason;
    assert.notEqual(ask.required, false, 'دلیل رد اجباری است');

    answers.reason = 'کمبود نیرو';
    await page.reg.get('#q-reject').fire('click');
    const post = calls.filter((c) => c.url === '/admin/leave-queue/bulk');
    assert.equal(post.length, 1);
    assert.equal(post[0].method, 'POST');
    assert.deepEqual(plain(post[0].body), { action: 'reject', ids: [1, 2], note: 'کمبود نیرو' });
    assert.ok(toasts.some((t) => /2 درخواست رد شد/.test(t.m) && !t.isErr));
  });

  test('تأیید دسته‌جمعی: پیام تأیید هشدار «مانده کافی نیست» می‌دهد؛ رد تأیید ⇒ بدون درخواست؛ بدون انتخاب دکمه‌ها غیرفعال', async () => {
    const low = { ...item().balance, insufficient: true };
    const items = [item({ id: 1, balance: low }), item({ id: 2 })];
    const { def, calls, answers } = setup({ queue: { items, total: 2, limit: 50, offset: 0 } });
    const { html, mount } = await def.render();
    assert.match(html, /id="q-approve"[^>]*disabled/, 'بدون انتخاب ⇒ غیرفعال');
    const page = makePage(items);
    mount(page);
    for (const c of page.checks) { c.checked = true; await c.fire('change'); }
    assert.match(page.reg.get('#q-count').textContent, /2 مورد/);

    answers.confirm = false;
    await page.reg.get('#q-approve').fire('click');
    assert.equal(calls.filter((c) => c.url === '/admin/leave-queue/bulk').length, 0);
    assert.match(calls.find((c) => c.confirmBox).confirmBox.message, /برای 1 مورد مانده‌ی کارمند کافی نیست/);

    answers.confirm = true;
    await page.reg.get('#q-approve').fire('click');
    const post = calls.filter((c) => c.url === '/admin/leave-queue/bulk');
    assert.equal(post.length, 1);
    assert.deepEqual(plain(post[0].body), { action: 'approve', ids: [1, 2], note: '' });
  });

  test('دکمه‌ی تکی رد/تأیید همان endpoint bulk را با یک شناسه صدا می‌زند (تک‌منطق سمت سرور)', async () => {
    const items = [item({ id: 5 })];
    const { def, calls } = setup({ queue: { items, total: 1, limit: 50, offset: 0 } });
    const { mount } = await def.render();
    const page = makePage(items);
    mount(page);
    const rejectBtn = page.acts.find((b) => b.dataset.act === 'reject');
    await rejectBtn.fire('click');
    const post = calls.find((c) => c.url === '/admin/leave-queue/bulk');
    assert.deepEqual(plain(post.body), { action: 'reject', ids: [5], note: 'دلیل تست' });
  });

  test('نتیجه‌ی بخشی‌موفق: مودال فقط موارد ناموفق را با دلیلشان نشان می‌دهد؛ نام کارمند escape می‌شود؛ صفحه refresh می‌شود', async () => {
    const items = [item({ id: 1, employee: { id: 7, fullName: 'الف', department: null, managerId: 3 } }), item({ id: 2, employee: { id: 8, fullName: '<b>ب</b>', department: null, managerId: 3 } })];
    const { def, AP, modals, toasts } = setup({ queue: { items, total: 2, limit: 50, offset: 0 } });
    AP.bulkResponse = (body) => ({
      action: body.action,
      results: [{ id: 1, ok: true, status: 'rejected' }, { id: 2, ok: false, code: 'ALREADY_DECIDED', error: 'این درخواست قبلاً بررسی شده است.' }],
      summary: { requested: 2, succeeded: 1, failed: 1 },
    });
    const { mount } = await def.render();
    const page = makePage(items);
    mount(page);
    for (const c of page.checks) { c.checked = true; await c.fire('change'); }
    const refreshedBefore = AP.refreshed || 0;
    await page.reg.get('#q-reject').fire('click');
    assert.equal(modals.length, 1, 'مودال نتیجه');
    assert.match(modals[0].body, /1 مورد انجام شد و 1 مورد انجام نشد/);
    assert.match(modals[0].body, /&lt;b&gt;ب&lt;\/b&gt;/);
    assert.doesNotMatch(modals[0].body, /<b>ب<\/b>/);
    assert.match(modals[0].body, /قبلاً بررسی شده/);
    assert.doesNotMatch(modals[0].body, />الف</, 'مورد موفق در فهرست خطا نیست');
    assert.equal(toasts.length, 0, 'با خطای جزئی توست موفقیت نمی‌آید؛ مودال نتیجه را می‌گوید');
    assert.ok((AP.refreshed || 0) > refreshedBefore, 'صف پس از تصمیم تازه می‌شود');
  });

  test('خطای شبکه/سرور در تصمیم ⇒ توست خطا و بدون مودال نتیجه', async () => {
    const items = [item({ id: 1 })];
    const { def, AP, toasts, modals } = setup({ queue: { items, total: 1, limit: 50, offset: 0 } });
    AP.bulkResponse = () => { throw new Error('ذکر دلیل برای رد کردن الزامی است.'); };
    const { mount } = await def.render();
    const page = makePage(items);
    mount(page);
    await page.acts.find((b) => b.dataset.act === 'reject').fire('click');
    assert.deepEqual(toasts, [{ m: 'ذکر دلیل برای رد کردن الزامی است.', isErr: true }]);
    assert.equal(modals.length, 0);
  });

  // آخرین پرس‌وجوی صف به‌صورت شیء URLSearchParams
  const lastQuery = (calls) => new URLSearchParams(calls.filter((c) => c.url && c.url.startsWith('/admin/leave-queue?')).pop().url.split('?')[1]);

  test('فیلترها: فرم، صفحه‌ی بعد و chip وضعیت پارامترهای درست را به API می‌دهند؛ decidable فقط روی pending', async () => {
    const queue = (url) => ({ items: [item()], total: 120, limit: 50, offset: Number(new URLSearchParams(url.split('?')[1]).get('offset')) });
    const { def, calls } = setup({ queue });

    // فرم فیلتر: تغییر یک فیلد ⇒ state و refresh؛ رندر بعدی با پارامترهای جدید
    let { mount } = await def.render();
    let page = makePage([item()]);
    const filterEl = makeEl();
    page.form.querySelectorAll = () => [filterEl];
    page.form.values = { kind: 'mission', leaveTypeId: '4', team: '3', from: '2026-10-01', to: '2026-10-31', decidable: true };
    mount(page);
    await filterEl.fire('change');
    await def.render();
    let qs = lastQuery(calls);
    assert.deepEqual(
      Object.fromEntries(qs.entries()),
      { status: 'pending', limit: '50', offset: '0', kind: 'mission', leaveTypeId: '4', team: '3', from: '2026-10-01', to: '2026-10-31', decidable: '1' },
    );

    // صفحه‌ی بعد: offset ۵۰
    ({ mount } = await def.render());
    page = makePage([item()]);
    mount(page);
    await page.reg.get('#q-next').fire('click');
    await def.render();
    assert.equal(lastQuery(calls).get('offset'), '50');

    // chip «ردشده»: offset صفر و decidable دیگر فرستاده نمی‌شود (فقط در pending معنی دارد)
    ({ mount } = await def.render());
    page = makePage([item()]);
    mount(page);
    await page.reg.get('#q-chips').fire('click', { target: { closest: () => ({ dataset: { s: 'rejected' } }) } });
    await def.render();
    qs = lastQuery(calls);
    assert.equal(qs.get('status'), 'rejected');
    assert.equal(qs.get('offset'), '0');
    assert.equal(qs.get('decidable'), null);
  });

  test('بازه‌ی تاریخ وارونه ⇒ توست خطا و فیلتر اعمال نمی‌شود', async () => {
    const { def, calls, toasts } = setup({ queue: { items: [item()], total: 1, limit: 50, offset: 0 } });
    const { mount } = await def.render();
    const page = makePage([item()]);
    const el = makeEl();
    page.form.querySelectorAll = () => [el];
    page.form.values = { from: '2026-11-01', to: '2026-10-01' };
    mount(page);
    const callsBefore = calls.length;
    await el.fire('change');
    assert.ok(toasts.some((t) => t.isErr && /بعد از تاریخ پایان/.test(t.m)));
    assert.equal(calls.length, callsBefore, 'درخواستی به سرور نرفت');
  });

  test('صفحه‌ی آخر پس از تصمیم‌ها خالی شد (total>0) ⇒ یک صفحه عقب‌تر خودکار نمایش داده می‌شود', async () => {
    let shrunk = false; // پس از «تصمیم‌ها» فقط ۵۰ مورد می‌ماند ⇒ صفحه‌ی دوم (offset ۵۰) خالی است
    const queue = (url) => {
      const off = Number(new URLSearchParams(url.split('?')[1]).get('offset'));
      if (!shrunk) return { items: [item({ id: 1 })], total: 120, limit: 50, offset: off };
      return off >= 50 ? { items: [], total: 50, limit: 50, offset: off } : { items: [item({ id: 9 })], total: 50, limit: 50, offset: off };
    };
    const { def, calls } = setup({ queue });
    const first = await def.render();
    const page = makePage([item()]);
    first.mount(page);
    await page.reg.get('#q-next').fire('click'); // کاربر به صفحه‌ی دوم می‌رود (offset ۵۰)
    assert.equal((await def.render(), lastQuery(calls).get('offset')), '50');

    shrunk = true;
    const { html } = await def.render(); // صفحه‌ی ۵۰ خالی ⇒ خودش به offset ۰ برمی‌گردد
    assert.match(html, /کارمند الف/, 'به‌جای «خالی» با total>0، صفحه‌ی قبل نمایش داده شد');
    assert.doesNotMatch(html, /درخواستی با این فیلتر وجود ندارد/);
    assert.equal(lastQuery(calls).get('offset'), '0');
  });
});

// D6 (فاز ۱۱): نمای اعتراض‌ها در پنل ادمین — فهرست با فیلتر مدل جدید و نشان «منتظر پاسخ»/تعداد پیام، thread کامل در #/disputes/<id>،
// پاسخ ادمین، بستن (با پیام پایانی اختیاری) و بازگشایی. views-ops.js واقعی داخل vm با AP ساختگی اجرا می‌شود؛
// خود API/اسکوپ/مجوز سرور در test/disputeAdmin*.test.js قفل است و سرور واقعی اینجا لازم نیست.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const plain = (v) => JSON.parse(JSON.stringify(v));

// یک ردیف فهرست به شکل GET /admin/disputes
const row = (o = {}) => ({
  id: 1, userId: 7, attendanceRecordId: null, recordDate: null, message: 'خروجم ثبت نشد', status: 'open', closedBy: null, closedAt: null, reopenCount: 0,
  messageCount: 1, lastSenderRole: 'user', lastMessageAt: '2027-05-01 08:00:00', phase: 'open', awaitingAdmin: true, createdAt: '2027-05-01 08:00:00', updatedAt: '2027-05-01 08:00:00',
  employee: { id: 7, fullName: 'کارمند الف' }, record: null, ...o,
});
const COUNTS = { total: 5, open: 3, awaitingAdmin: 2, answered: 1, resolved: 2, resolvedByAdmin: 1, closedByUser: 1 };

function setup({ perms = ['disputes.read', 'disputes.resolve', 'users.read', 'records.edit'], list = [row()], counts = COUNTS, thread = null, attempt = null } = {}) {
  const calls = []; const toasts = []; const goes = [];
  const answers = { reason: 'یادداشت تست' };
  const AP = {
    views: {}, nav: [], state: { me: { id: 1, role: 'admin' }, perms: new Set(perms) },
    can: (...p) => p.every((x) => AP.state.perms.has(x)),
    selfOnly: () => !AP.can('users.read'),
    $: (sel, root) => (root && root.querySelector ? root.querySelector(sel) : null),
    $$: (sel, root) => (root && root.querySelectorAll ? Array.from(root.querySelectorAll(sel)) : []),
    esc,
    fmt: { num: (n) => String(n), dateLong: (d) => `J(${d})`, dateTime: (d) => `T(${d})`, date: (d) => d, clock: (d) => d, min: (m) => `${m}m` },
    icon: () => '',
    badge: (cls, text) => `<span class="badge ${esc(cls)}">${esc(text)}</span>`,
    avatar: (name) => `<span class="avatar">${esc(name)}</span>`,
    view(id, def) { AP.views[id] = def; if (def.nav) AP.nav.push({ id, ...def.nav }); },
    go: (id, param) => goes.push([id, param]),
    refresh: () => { AP.refreshed = (AP.refreshed || 0) + 1; return Promise.resolve(); },
    refreshCounts: () => { AP.counted = (AP.counted || 0) + 1; },
    openRecord: () => {}, openCreateRecord: () => {},
    toast: (m, isErr) => toasts.push({ m, isErr: !!isErr }),
    askReason: async (o) => { calls.push({ askReason: o }); return answers.reason; },
    attempt: attempt || (async (fn, okMsg) => { try { const r = await fn(); if (okMsg) toasts.push({ m: okMsg, isErr: false }); return r === undefined ? true : r; } catch (err) { toasts.push({ m: err.message, isErr: true }); return false; } }),
    api: async (url, opts = {}) => {
      const method = opts.method || 'GET';
      calls.push({ url, method, body: opts.body });
      if (url === '/admin/disputes/counts') { if (counts instanceof Error) throw counts; return counts; }
      if (method === 'GET' && url.startsWith('/admin/disputes?') || url === '/admin/disputes') return typeof list === 'function' ? list(url) : list;
      if (method === 'GET' && /^\/admin\/disputes\/\d+$/.test(url)) { if (thread instanceof Error) throw thread; return thread; }
      if (method === 'POST') return AP.postResult === undefined ? { ok: true } : AP.postResult;
      throw new Error(`مسیر پیش‌بینی‌نشده: ${method} ${url}`);
    },
  };
  const sandbox = { window: { AP }, document: {}, console, URLSearchParams, encodeURIComponent };
  vm.runInNewContext(read('public-admin/js/views-ops.js'), sandbox, { filename: 'views-ops.js' });
  return { AP, calls, toasts, goes, answers, def: AP.views.disputes };
}

function makeEl(extra = {}) {
  const listeners = {};
  return { dataset: {}, value: '', textContent: '', listeners, addEventListener(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); }, querySelector: () => null, querySelectorAll: () => [], async fire(ev, e = {}) { for (const fn of listeners[ev] || []) await fn({ target: this, preventDefault() {}, ...e }); }, ...extra };
}
// single: { selector: el }، multi: { selector: [el…] }
const makePage = ({ single = {}, multi = {} } = {}) => ({ querySelector: (s) => single[s] || null, querySelectorAll: (s) => multi[s] || [] });

const thr = (o = {}) => ({
  dispute: row({ id: 5, messageCount: 3, phase: 'answered', lastSenderRole: 'admin', awaitingAdmin: false, ...o.dispute }),
  messages: [
    { id: 1, senderRole: 'user', sender: { id: 7, fullName: 'کارمند الف', role: 'employee' }, message: 'سلام <b>خروج</b> ثبت نشد', createdAt: '2027-05-01 08:00:00' },
    { id: 2, senderRole: 'admin', sender: { id: 1, fullName: 'مدیر سیستم', role: 'admin' }, message: 'بررسی شد', createdAt: '2027-05-01 09:00:00' },
  ],
  employee: { id: 7, fullName: 'کارمند الف' }, record: { id: 11, date: '2027-04-30' }, ...(o.top || {}),
});

describe('D6 — فهرست اعتراض‌ها در پنل', () => {
  test('ثبت view: شناسه disputes، مجوز disputes.read، منوی «اعتراض‌ها» با شمارنده', () => {
    const { def, AP } = setup();
    assert.ok(def);
    assert.equal(def.perm, 'disputes.read');
    assert.equal(def.skeleton, 'list');
    assert.ok(AP.nav.some((n) => n.id === 'disputes' && n.label === 'اعتراض‌ها' && n.counter === true));
  });

  test('فهرست: درخواست با پیش‌فرض open + counts؛ چیپ‌های مدل جدید با شمارنده؛ «منتظر پاسخ» و تعداد پیام؛ متن escape می‌شود', async () => {
    const { def, calls } = setup({ list: [row({ id: 3, message: '<img src=x onerror=alert(1)>', messageCount: 4, reopenCount: 1, record: { id: 11, date: '2027-04-30' } }), row({ id: 4, phase: 'answered', awaitingAdmin: false, lastSenderRole: 'admin' })] });
    const { html } = await def.render(null);
    assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`).sort(), ['GET /admin/disputes/counts', 'GET /admin/disputes?status=open']);
    for (const l of ['باز', 'منتظر پاسخ', 'پاسخ داده‌شده', 'حل‌شده توسط ادمین', 'خاتمه توسط کارمند', 'همه']) assert.match(html, new RegExp(`>${l}`));
    assert.match(html, /data-s="open"/); assert.match(html, /data-s="awaiting_admin"/); assert.match(html, /data-s="resolved_by_admin"/); assert.match(html, /data-s="closed_by_user"/);
    assert.match(html, /class="chip active" data-s="open">باز <b>3<\/b>/);
    assert.match(html, /data-s="awaiting_admin">منتظر پاسخ <b>2<\/b>/);
    assert.match(html, /<span class="badge pending">منتظر پاسخ<\/span>/);
    assert.match(html, /<span class="badge blue">پاسخ داده شد<\/span>/);
    assert.match(html, /4 پیام/);
    assert.match(html, /ادامه: 1 بار/);
    assert.match(html, /رکورد مرتبط: <a href="#" data-rec="11"/);
    assert.doesNotMatch(html, /<img/);
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  });

  test('فیلتر «همه» بدون query؛ فیلتر انتخاب‌شده با encode؛ کلیک چیپ وضعیت را عوض و صفحه را تازه می‌کند', async () => {
    const { def, calls, AP } = setup();
    const chips = makeEl();
    const page = makePage({ single: { '#d-chips': chips } });
    const r = await def.render(null);
    r.mount(page);
    await chips.fire('click', { target: { closest: () => ({ dataset: { s: 'all' } }) } });
    assert.equal(AP.refreshed, 1);
    calls.length = 0;
    await def.render(null);
    assert.ok(calls.some((c) => c.url === '/admin/disputes'));
    await chips.fire('click', { target: { closest: () => ({ dataset: { s: 'awaiting_admin' } }) } });
    calls.length = 0;
    await def.render(null);
    assert.ok(calls.some((c) => c.url === '/admin/disputes?status=awaiting_admin'));
    await chips.fire('click', { target: { closest: () => null } }); // کلیک خارج از چیپ بی‌اثر
    assert.equal(AP.refreshed, 2);
  });

  test('شکست شمارنده‌ها فهرست را نمی‌اندازد (چیپ‌ها بدون عدد)', async () => {
    const { def } = setup({ counts: new Error('شمارنده خراب') });
    const { html } = await def.render(null);
    assert.match(html, /data-s="open"/);
    assert.doesNotMatch(html, /<b>/);
  });

  test('فهرست خالی: پیام خالی؛ خطای سرور به روتر می‌رسد (skeleton/خطا/تلاش دوباره با روتر)', async () => {
    const { def } = setup({ list: [] });
    assert.match((await def.render(null)).html, /اعتراضی وجود ندارد\./);
    const bad = setup({ list: () => { throw new Error('خطای سرور'); } });
    await assert.rejects(() => bad.def.render(null), /خطای سرور/);
  });

  test('دکمه‌ها بر اساس وضعیت و مجوز: باز ⇒ «بستن و پاسخ»، بسته ⇒ «بازگشایی»؛ HR فقط‌خواندنی ⇒ هیچ‌کدام؛ «گفت‌وگو» همیشه', async () => {
    const list = [row({ id: 1 }), row({ id: 2, status: 'resolved', phase: 'resolved', closedBy: 'admin', awaitingAdmin: false })];
    const full = (await setup({ list }).def.render(null)).html;
    assert.match(full, /data-open="1"/); assert.match(full, /data-open="2"/);
    assert.match(full, /data-resolve="1"/); assert.doesNotMatch(full, /data-resolve="2"/);
    assert.match(full, /data-reopen="2"/); assert.doesNotMatch(full, /data-reopen="1"/);
    const hr = (await setup({ list, perms: ['disputes.read', 'users.read'] }).def.render(null)).html;
    assert.match(hr, /data-open="1"/);
    assert.doesNotMatch(hr, /data-resolve=|data-reopen=/);
  });

  test('mount: «گفت‌وگو» به #/disputes/<id> می‌رود؛ بستن با پیام پایانیِ اختیاری و بازگشایی با پیام اختیاری', async () => {
    const { def, goes, calls, AP, toasts } = setup({ list: [row({ id: 1 }), row({ id: 2, status: 'resolved', phase: 'resolved', closedBy: 'admin', awaitingAdmin: false })] });
    const open = makeEl({ dataset: { open: '2' } });
    const resolve = makeEl({ dataset: { resolve: '1' } });
    const reopen = makeEl({ dataset: { reopen: '2' } });
    const r = await def.render(null);
    r.mount(makePage({ single: { '#d-chips': makeEl() }, multi: { '[data-open]': [open], '[data-resolve]': [resolve], '[data-reopen]': [reopen] } }));
    await open.fire('click');
    assert.deepEqual(plain(goes), [['disputes', '2']]);
    calls.length = 0;
    await resolve.fire('click');
    const ar = calls.find((c) => c.askReason).askReason;
    assert.equal(ar.required, false); assert.equal(ar.confirmText, 'بستن اعتراض');
    const post = calls.find((c) => c.method === 'POST');
    assert.equal(post.url, '/admin/disputes/1/resolve');
    assert.deepEqual(plain(post.body), { note: 'یادداشت تست' });
    assert.ok(toasts.some((t) => t.m === 'اعتراض بسته شد.'));
    calls.length = 0;
    await reopen.fire('click');
    const post2 = calls.find((c) => c.method === 'POST');
    assert.equal(post2.url, '/admin/disputes/2/reopen');
    assert.deepEqual(plain(post2.body), { note: 'یادداشت تست' });
    assert.equal(AP.refreshed, 2);
  });

  test('انصراف از پنجره‌ی یادداشت (null) ⇒ هیچ درخواستی ارسال نمی‌شود', async () => {
    const { def, calls, answers, AP } = setup();
    answers.reason = null;
    const resolve = makeEl({ dataset: { resolve: '1' } });
    const r = await def.render(null);
    r.mount(makePage({ single: { '#d-chips': makeEl() }, multi: { '[data-resolve]': [resolve] } }));
    await resolve.fire('click');
    assert.equal(calls.some((c) => c.method === 'POST'), false);
    assert.equal(AP.refreshed, undefined);
  });
});

describe('D6 — thread کامل', () => {
  test('thread: GET /admin/disputes/:id؛ حباب کارمند/ادمین با نام و زمان؛ متن escape؛ رکورد و سرآیند', async () => {
    const { def, calls } = setup({ thread: thr() });
    const { html } = await def.render('5');
    assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), ['GET /admin/disputes/5']);
    assert.match(html, /class="dsp-msg user"/); assert.match(html, /class="dsp-msg admin"/);
    assert.match(html, /<b>کارمند الف<\/b><span>T\(2027-05-01 08:00:00\)<\/span>/);
    assert.match(html, /<b>مدیر سیستم<\/b>/);
    assert.match(html, /سلام &lt;b&gt;خروج&lt;\/b&gt; ثبت نشد/);
    assert.doesNotMatch(html, /<b>خروج<\/b>/);
    assert.match(html, /role="log"/);
    assert.match(html, /<span class="badge blue">پاسخ داده شد<\/span>/);
    assert.match(html, /3 پیام/);
    assert.match(html, /رکورد مرتبط: <a href="#" data-rec="11"[^>]*>J\(2027-04-30\)/);
    assert.match(html, /data-back/);
  });

  test('اعتراض باز + مجوز: فرم پاسخ با label، سقف ۵۰۰، شمارنده، «ارسال پاسخ» و «بستن و پیام پایانی»', async () => {
    const { html } = await setup({ thread: thr() }).def.render('5');
    assert.match(html, /<form class="card form dsp-reply" id="dsp-reply">/);
    assert.match(html, /<label class="field"><span>پاسخ به کارمند<\/span><textarea name="message" rows="3" maxlength="500" dir="auto" required>/);
    assert.match(html, /id="dsp-counter">0 \/ 500</);
    assert.match(html, />ارسال پاسخ</);
    assert.match(html, /data-resolve="5"/);
    assert.doesNotMatch(html, /data-reopen=/);
  });

  test('اعتراض بسته: فرم نوشتن نیست؛ «بازگشایی اعتراض»؛ متن جدا برای بستن توسط کارمند', async () => {
    const byAdmin = (await setup({ thread: thr({ dispute: { status: 'resolved', closedBy: 'admin', phase: 'resolved' } }) }).def.render('5')).html;
    assert.doesNotMatch(byAdmin, /<form|<textarea/);
    assert.match(byAdmin, /این اعتراض بسته شده است\. برای پاسخ‌دادن ابتدا آن را بازگشایی کنید\./);
    assert.match(byAdmin, /data-reopen="5"/);
    const byUser = (await setup({ thread: thr({ dispute: { status: 'resolved', closedBy: 'user', phase: 'closed_by_user' } }) }).def.render('5')).html;
    assert.match(byUser, /توسط کارمند خاتمه یافته است/);
    assert.match(byUser, /خاتمه توسط کارمند<\/span>/);
  });

  test('بدون disputes.resolve (HR): فقط‌مشاهده؛ هیچ فرم/دکمه‌ی نوشتن', async () => {
    const { html } = await setup({ perms: ['disputes.read', 'users.read'], thread: thr() }).def.render('5');
    assert.match(html, /فقط‌مشاهده: مجوز پاسخ‌دادن به اعتراض را ندارید\./);
    assert.doesNotMatch(html, /<form|<textarea|data-resolve=|data-reopen=/);
  });

  test('بدون پیام: حالت خالی با متن؛ شناسه‌ی نامعتبر و خطای سرور (۴۰۳/۴۰۴) به روتر می‌رسد', async () => {
    const empty = await setup({ thread: { ...thr(), messages: [] } }).def.render('5');
    assert.match(empty.html, /هنوز پیامی در این گفت‌وگو نیست\./);
    await assert.rejects(() => setup({ thread: thr() }).def.render('abc'), /شناسه‌ی اعتراض نامعتبر است/);
    const denied = Object.assign(new Error('به این کارمند دسترسی ندارید.'), { status: 403 });
    await assert.rejects(() => setup({ thread: denied }).def.render('5'), /به این کارمند دسترسی ندارید\./);
  });

  function mountThread(ctx) {
    const ta = makeEl();
    const submit = makeEl();
    const form = makeEl({ querySelector: (s) => (s === 'textarea' ? ta : s === 'button[type=submit]' ? submit : null) });
    const counter = makeEl();
    const back = makeEl();
    const resolve = makeEl({ dataset: { resolve: '5' } });
    return ctx.def.render('5').then((r) => {
      r.mount(makePage({ single: { '[data-back]': back, '#dsp-reply': form, '#dsp-counter': counter }, multi: { '[data-resolve]': [resolve] } }));
      return { ta, form, counter, back, resolve, submit };
    });
  }

  test('ارسال پاسخ: POST /messages با متن؛ موفق ⇒ تازه‌سازی صفحه و شمارنده‌ها؛ شمارنده‌ی نویسه و دکمه‌ی بازگشت', async () => {
    const ctx = setup({ thread: thr() });
    const m = await mountThread(ctx);
    m.ta.value = 'پاسخ من';
    await m.ta.fire('input');
    assert.equal(m.counter.textContent, '7 / 500'); // «پاسخ من» = ۷ نویسه
    await m.form.fire('submit');
    const post = ctx.calls.find((c) => c.method === 'POST');
    assert.equal(post.url, '/admin/disputes/5/messages');
    assert.deepEqual(plain(post.body), { message: 'پاسخ من' });
    assert.ok(ctx.toasts.some((t) => t.m === 'پاسخ ارسال شد.' && !t.isErr));
    assert.equal(ctx.AP.refreshed, 1); assert.equal(ctx.AP.counted, 1);
    await m.back.fire('click');
    assert.equal(ctx.goes.length, 1);
    assert.equal(ctx.goes[0][0], 'disputes');
    assert.equal(ctx.goes[0][1], undefined); // بدون param ⇒ فهرست
  });

  test('خطای سرور هنگام ارسال: توست خطا، بدون تازه‌سازی، متن نوشته‌شده می‌ماند', async () => {
    const ctx = setup({ thread: thr() });
    ctx.AP.api = ((orig) => async (url, opts = {}) => { if ((opts.method || 'GET') === 'POST') throw new Error('این اعتراض بسته است؛ برای پاسخ ابتدا آن را بازگشایی کنید.'); return orig(url, opts); })(ctx.AP.api);
    const m = await mountThread(ctx);
    m.ta.value = 'متن مهم';
    await m.form.fire('submit');
    assert.ok(ctx.toasts.some((t) => t.isErr && /بازگشایی کنید/.test(t.m)));
    assert.equal(ctx.AP.refreshed, undefined);
    assert.equal(m.ta.value, 'متن مهم');
  });

  test('بستن از داخل thread (با پیام پایانی) و بازگشایی از thread بسته', async () => {
    const ctx = setup({ thread: thr() });
    const m = await mountThread(ctx);
    await m.resolve.fire('click');
    const post = ctx.calls.find((c) => c.method === 'POST');
    assert.equal(post.url, '/admin/disputes/5/resolve');
    assert.deepEqual(plain(post.body), { note: 'یادداشت تست' });
    const closed = setup({ thread: thr({ dispute: { status: 'resolved', closedBy: 'admin', phase: 'resolved' } }) });
    const reopen = makeEl({ dataset: { reopen: '5' } });
    const r = await closed.def.render('5');
    r.mount(makePage({ single: { '[data-back]': makeEl() }, multi: { '[data-reopen]': [reopen] } }));
    await reopen.fire('click');
    const p2 = closed.calls.find((c) => c.method === 'POST');
    assert.equal(p2.url, '/admin/disputes/5/reopen');
    assert.deepEqual(plain(p2.body), { note: 'یادداشت تست' });
    assert.equal(closed.AP.refreshed, 1);
  });
});

describe('D6 — قرارداد کد و استایل', () => {
  const ops = read('public-admin/js/views-ops.js');
  const css = read('public-admin/css/style.css');
  test('پنل: فقط AP.view(disputes) (بدون view تازه)، پوشش حالت‌ها طبق docs/UI_STATES.md، بدون alert/confirm/prompt', () => {
    assert.equal((ops.match(/AP\.view\('disputes'/g) || []).length, 1);
    const i = ops.indexOf("AP.view('disputes'");
    const next = [...ops.matchAll(/AP\.view\('(\w+)'/g)].map((m) => m.index).find((x) => x > i);
    assert.match(ops.slice(i, next), /emptyBox\(/);
    assert.match(ops, /async render\(param\) \{\s+if \(param\) return renderDisputeThread\(param\);/);
    const block = ops.slice(ops.indexOf('اعتراض‌ها و گفت‌وگو (فاز ۱۱، D6)'), next);
    assert.doesNotMatch(block, /\b(alert|confirm|prompt)\(/);
    assert.doesNotMatch(block, /style="/); // استایل درون‌خطی نه؛ فقط کلاس
  });
  test('سقف طول پیام پنل با سرور یکی است', () => {
    const svc = read('src/services/disputeService.js');
    assert.equal(Number(/const MESSAGE_MAX = (\d+);/.exec(svc)[1]), Number(/const DISP_MSG_MAX = (\d+);/.exec(ops)[1]));
  });
  test('CSS پنل: حباب‌ها، فیلد پاسخ و شمارنده؛ ویژگی‌های منطقی (بدون left/right فیزیکی)؛ وضعیت با متن', () => {
    const block = css.slice(css.indexOf('/* گفت‌وگوی اعتراض (D6)'));
    for (const re of [/\.dsp-msg\.user/, /\.dsp-msg\.admin/, /\.dsp-thread/, /\.dsp-reply textarea/, /white-space: pre-wrap/, /margin-inline-end: auto/]) assert.match(block, re);
    assert.doesNotMatch(block, /(^|[\s;{])(left|right)\s*:|margin-(left|right)|padding-(left|right)|text-align:\s*(left|right)/);
  });
});

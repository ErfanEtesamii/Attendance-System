// D5 (فاز ۱۱): «اعتراض‌های من» و گفت‌وگوی اعتراض در Mini App — فهرست با وضعیت/نشان خوانده‌نشده، thread، ارسال، ادامه، خاتمه با تأیید،
// نمایش بی‌تغییر پیام خطای سرور، حالت‌های لودینگ/خالی/خطا. DOM ساختگی (بدون مرورگر) و fetch ساختگی؛ سرور واقعی لازم نیست.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const appSrc = read('public/js/app.js');
const html = read('public/index.html');
const css = read('public/css/style.css');
const flush = () => new Promise((r) => setTimeout(r, 15));

class Node_ {
  constructor(tag) { this.tag = tag; this.children = []; this.handlers = {}; this._text = ''; this._html = ''; this.className = ''; this.dataset = {}; this.style = {}; this.attrs = {}; this.value = ''; this.disabled = false; this.classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } }; }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  set innerHTML(v) { this.children = []; this._text = ''; this._html = String(v); }
  get innerHTML() { return this._html; }
  get lastChild() { return this.children[this.children.length - 1] || null; }
  addEventListener(t, fn) { (this.handlers[t] = this.handlers[t] || []).push(fn); }
  appendChild(c) { this.children.push(c); return c; }
  setAttribute(k, v) { this.attrs[k] = v; }
  removeAttribute(k) { delete this.attrs[k]; }
  focus() { Node_.focused = this; }
  querySelector() { return null; }
  fire(t, ev = {}) { return Promise.all((this.handlers[t] || []).map((fn) => fn({ preventDefault() {}, target: this, ...ev }))); }
}
const walk = (n, out = []) => { out.push(n); (n.children || []).forEach((c) => walk(c, out)); return out; };
const hasClass = (n, c) => String(n.className || '').split(/\s+/).includes(c);

const D = (o = {}) => ({
  id: 1, user_id: 7, attendance_record_id: null, record_date: null, message: 'پیام اولیه', status: 'open', closed_by: null, closed_at: null,
  reopen_count: 0, max_reopens: 3, message_count: 1, last_sender_role: 'user', last_message_at: '2027-05-01 08:00:00', phase: 'open',
  can_reply: true, can_reopen: false, can_close: true, created_at: '2027-05-01 08:00:00', updated_at: '2027-05-01 08:00:00', ...o,
});
const M = (id, role, text, o = {}) => ({ id, sender_role: role, is_mine: role === 'user', message: text, created_at: '2027-05-01 08:0' + id + ':00', ...o });

// سرور ساختگی: disputes = { [id]: { dispute, messages } }؛ post(path, body) می‌تواند ‎{status, json}‎ برگرداند تا پاسخ پیش‌فرض عوض شود
function makeEnv({ disputes = {}, listError = null, post = null } = {}) {
  const els = new Map();
  const $ = (sel) => { if (!els.has(sel)) els.set(sel, new Node_(sel)); return els.get(sel); };
  const navProfile = Object.assign(new Node_('nav'), { dataset: { view: 'profile' } });
  const document = { querySelector: $, querySelectorAll: (sel) => (sel === '.nav-btn' ? [navProfile] : []), createElement: (t) => new Node_(t), createTextNode: (t) => { const n = new Node_('#text'); n._text = t; return n; } };
  const calls = [];
  const storage = new Map();
  const localStorage = { getItem: (k) => (storage.has(k) ? storage.get(k) : null), setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k) };
  const ok = (json, status = 200) => ({ ok: status < 400, status, json: async () => json });
  const fetchStub = async (url, init = {}) => {
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url, method, body });
    const p = url.replace('/api/miniapp', '');
    if (method === 'GET' && p === '/dispute') {
      if (listError) return ok({ error: listError }, 500);
      return ok(Object.values(disputes).map((x) => x.dispute));
    }
    const m = /^\/dispute\/(\d+)(?:\/(messages|reopen|close))?$/.exec(p);
    if (m) {
      const rec = disputes[m[1]];
      if (!rec) return ok({ error: 'اعتراض یافت نشد.', code: 'NOT_FOUND' }, 404);
      if (method === 'GET') return ok({ ok: true, dispute: rec.dispute, messages: rec.messages });
      if (post) { const r = post(m[2], body, rec); if (r) return ok(r.json, r.status); }
    }
    return ok({ error: 'unexpected ' + method + ' ' + p }, 500);
  };
  const window = { location: { search: '' }, Telegram: undefined, UiStates: require('../public/js/states.js'), localStorage };
  vm.runInNewContext(appSrc, { window, document, fetch: fetchStub, console, setTimeout, clearTimeout, setInterval, clearInterval, Date, Intl, JSON, Promise, Number, Object, Array, String, encodeURIComponent, URLSearchParams });
  return { $, calls, storage, disputes, openProfile: async () => { await navProfile.fire('click'); await flush(); } };
}

const items = (env) => walk(env.$('#dispute-list')).filter((n) => n.tag === 'button' && hasClass(n, 'dispute-item'));
const thread = (env) => env.$('#dispute-thread');
const btn = (env, text) => walk(thread(env)).find((n) => n.tag === 'button' && n.textContent === text);
const click = async (env, text) => { const b = btn(env, text); assert.ok(b, `دکمه‌ی «${text}» پیدا نشد`); await b.fire('click'); await flush(); };
const textarea = (env) => walk(thread(env)).find((n) => n.tag === 'textarea');
const write = (env, v) => { const t = textarea(env); assert.ok(t, 'فیلد نوشتن نیست'); t.value = v; return t.fire('input'); };
const bubbles = (env) => walk(thread(env)).filter((n) => hasClass(n, 'dsp-msg'));
const status = (env) => thread(env).children.find((n) => n.id === 'dispute-thread-msg');

describe('D5 — فهرست «اعتراض‌های من»', () => {
  test('وضعیت‌ها با متن فارسی، تعداد پیام و نشان «پیام جدید» فقط برای آخرین رویدادِ ادمین', async () => {
    const env = makeEnv({
      disputes: {
        1: { dispute: D({ id: 1, phase: 'open' }), messages: [] },
        2: { dispute: D({ id: 2, phase: 'answered', last_sender_role: 'admin', message_count: 2 }), messages: [] },
        3: { dispute: D({ id: 3, status: 'resolved', closed_by: 'admin', closed_at: '2027-05-02 09:00:00', phase: 'resolved', can_reply: false, can_close: false }), messages: [] },
        4: { dispute: D({ id: 4, status: 'resolved', closed_by: 'user', closed_at: '2027-05-02 09:00:00', phase: 'closed_by_user', last_sender_role: 'admin', can_reply: false, can_close: false }), messages: [] },
      },
    });
    await env.openProfile();
    const list = items(env);
    assert.equal(list.length, 4);
    const txt = list.map((n) => n.textContent);
    assert.match(txt[0], /باز/); assert.match(txt[1], /پاسخ داده شده/); assert.match(txt[2], /حل‌شده/); assert.match(txt[3], /خاتمه‌یافته/);
    assert.match(txt[1], /۲ پیام/);
    // اولین بار روی دستگاه: «حل‌شده» از قبل جدید حساب نمی‌شود؛ پاسخ ادمین روی اعتراض باز جدید است؛ خاتمه توسط خود کارمند هرگز جدید نیست
    assert.deepEqual(txt.map((t) => t.includes('پیام جدید')), [false, true, false, false]);
  });

  test('رکورد مرتبط با تاریخ شمسی در عنوان؛ متن کاربر فقط با textContent (بدون innerHTML)', async () => {
    const env = makeEnv({ disputes: { 1: { dispute: D({ record_date: '2027-05-01', message: '<img src=x onerror=alert(1)>' }), messages: [] } } });
    await env.openProfile();
    const [it] = items(env);
    assert.match(it.textContent, /اعتراض به رکورد /);
    assert.match(it.textContent, /<img src=x onerror=alert\(1\)>/); // به‌عنوان متن خام نمایش داده می‌شود، نه HTML
    const list = env.$('#dispute-list');
    assert.doesNotMatch(list.innerHTML, /<img/);
  });

  test('خالی، لودینگ و خطا با «تلاش دوباره»', async () => {
    const empty = makeEnv();
    await empty.openProfile();
    assert.match(empty.$('#dispute-list').innerHTML, /هنوز اعتراضی ثبت نکرده‌اید/);
    const bad = makeEnv({ listError: 'خطای سرور' });
    await bad.openProfile();
    const h = bad.$('#dispute-list').innerHTML;
    assert.match(h, /role="alert"/);
    assert.match(h, /خطای سرور/);
    assert.match(h, /id="retry-dispute-list"/);
  });
});

describe('D5 — صفحه‌ی گفت‌وگو', () => {
  const open = async (env, id = 1) => { await env.openProfile(); await items(env).find(() => true).fire('click'); await flush(); return id; };

  test('thread: حباب کارمند و ادمین، نام و زمان؛ بعد از دیدن، نشان جدید حذف می‌شود', async () => {
    const env = makeEnv({
      disputes: { 1: { dispute: D({ phase: 'answered', last_sender_role: 'admin', message_count: 2 }), messages: [M(1, 'user', 'سلام، خروجم ثبت نشده'), M(2, 'admin', 'بررسی می‌کنم')] } },
    });
    await open(env);
    assert.deepEqual(env.calls.map((c) => `${c.method} ${c.url}`), ['GET /api/miniapp/dispute', 'GET /api/miniapp/dispute/1']);
    const b = bubbles(env);
    assert.equal(b.length, 2);
    assert.ok(hasClass(b[0], 'mine')); assert.ok(hasClass(b[1], 'theirs'));
    assert.match(b[1].textContent, /ادمین/); assert.match(b[1].textContent, /بررسی می‌کنم/);
    assert.match(b[0].textContent, /شما/); // state.me در این محیط نیست ⇒ برچسب پیش‌فرض
    await env.$('#dispute-back').fire('click'); await flush();
    assert.equal(items(env)[0].textContent.includes('پیام جدید'), false);
  });

  test('ارسال پیام: POST /messages با متن، پاک شدن پیش‌نویس، حباب تازه', async () => {
    const dispute = D();
    const env = makeEnv({
      disputes: { 1: { dispute, messages: [M(1, 'user', 'اول')] } },
      post: (kind, body, rec) => {
        assert.equal(kind, 'messages');
        const messages = [...rec.messages, M(2, 'user', body.message)];
        return { status: 201, json: { ok: true, dispute: { ...rec.dispute, message_count: 2 }, messages } };
      },
    });
    await open(env);
    await write(env, 'پیام دوم من');
    await click(env, 'ارسال');
    const post = env.calls.find((c) => c.method === 'POST');
    assert.equal(post.url, '/api/miniapp/dispute/1/messages');
    assert.deepEqual(post.body, { message: 'پیام دوم من' });
    assert.equal(bubbles(env).length, 2);
    assert.equal(textarea(env).value, ''); // پیش‌فرض خالی بعد از ارسال
  });

  test('خطای سرور بی‌تغییر نمایش داده می‌شود و پیش‌نویس از دست نمی‌رود', async () => {
    const env = makeEnv({
      disputes: { 1: { dispute: D(), messages: [M(1, 'user', 'اول')] } },
      post: () => ({ status: 400, json: { error: 'متن پیام حداکثر ۵۰۰ نویسه می‌تواند باشد.', code: 'VALIDATION' } }),
    });
    await open(env);
    await write(env, 'متن بلند');
    await click(env, 'ارسال');
    assert.equal(status(env).textContent, 'متن پیام حداکثر ۵۰۰ نویسه می‌تواند باشد.');
    assert.equal(status(env).attrs.role, 'alert');
    assert.match(status(env).className, /err/);
    assert.equal(textarea(env).value, 'متن بلند');
  });

  test('اعتراض در این فاصله بسته شده (۴۰۹): thread تازه گرفته می‌شود، پیام سرور می‌ماند و فرم نوشتن برداشته می‌شود', async () => {
    const env = makeEnv({
      disputes: { 1: { dispute: D(), messages: [M(1, 'user', 'اول')] } },
      post: (kind, body, rec) => {
        rec.dispute = D({ status: 'resolved', closed_by: 'admin', phase: 'resolved', can_reply: false, can_close: false, can_reopen: true });
        return { status: 409, json: { error: 'این اعتراض بسته شده است. برای ادامه‌ی گفت‌وگو از «ادامه‌ی اعتراض» استفاده کنید.', code: 'DISPUTE_CLOSED' } };
      },
    });
    await open(env);
    await write(env, 'سلام');
    await click(env, 'ارسال');
    assert.match(status(env).textContent, /برای ادامه‌ی گفت‌وگو/);
    assert.equal(textarea(env), undefined);
    assert.ok(btn(env, 'ادامه‌ی اعتراض'));
  });

  test('خاتمه: اول تأیید می‌گیرد (بدون درخواست)، انصراف چیزی نمی‌فرستد، تأیید POST /close می‌زند', async () => {
    const env = makeEnv({
      disputes: { 1: { dispute: D(), messages: [M(1, 'user', 'اول')] } },
      post: (kind, body, rec) => {
        assert.equal(kind, 'close');
        return { status: 200, json: { ok: true, dispute: D({ status: 'resolved', closed_by: 'user', phase: 'closed_by_user', can_reply: false, can_close: false, can_reopen: true }), messages: rec.messages } };
      },
    });
    await open(env);
    await click(env, 'مشکلم حل شد، خاتمه');
    assert.equal(env.calls.some((c) => c.method === 'POST'), false);
    assert.ok(walk(thread(env)).some((n) => n.attrs && n.attrs.role === 'group' && /تأیید خاتمه/.test(n.attrs['aria-label'])));
    await click(env, 'انصراف');
    assert.equal(env.calls.some((c) => c.method === 'POST'), false);
    assert.ok(btn(env, 'مشکلم حل شد، خاتمه'));
    await click(env, 'مشکلم حل شد، خاتمه');
    await click(env, 'بله، خاتمه بده');
    assert.equal(env.calls.filter((c) => c.method === 'POST').length, 1);
    assert.equal(env.calls.find((c) => c.method === 'POST').url, '/api/miniapp/dispute/1/close');
    assert.match(thread(env).textContent, /شما این اعتراض را خاتمه داده‌اید/);
    assert.equal(btn(env, 'مشکلم حل شد، خاتمه'), undefined);
  });

  test('ادامه‌ی اعتراض: فقط وقتی can_reopen؛ پیام الزامی با دکمه‌ی «ارسال و ادامه‌ی اعتراض» به /reopen می‌رود', async () => {
    const closed = D({ status: 'resolved', closed_by: 'admin', phase: 'resolved', can_reply: false, can_close: false, can_reopen: true, reopen_count: 1 });
    const env = makeEnv({
      disputes: { 1: { dispute: closed, messages: [M(1, 'user', 'اول'), M(2, 'admin', 'بسته شد')] } },
      post: (kind, body, rec) => {
        assert.equal(kind, 'reopen');
        return { status: 200, json: { ok: true, dispute: D({ reopen_count: 2, message_count: 3 }), messages: [...rec.messages, M(3, 'user', body.message)] } };
      },
    });
    await open(env);
    assert.match(thread(env).textContent, /این اعتراض توسط ادمین بسته شده است/);
    assert.match(thread(env).textContent, /۲ بار دیگر می‌توانید/); // سقف ۳، یک بار مصرف‌شده
    assert.equal(textarea(env), undefined); // قبل از زدن «ادامه»، فیلد نیست
    await click(env, 'ادامه‌ی اعتراض');
    await write(env, 'هنوز حل نشده');
    await click(env, 'ارسال و ادامه‌ی اعتراض');
    const post = env.calls.find((c) => c.method === 'POST');
    assert.equal(post.url, '/api/miniapp/dispute/1/reopen');
    assert.deepEqual(post.body, { message: 'هنوز حل نشده' });
    assert.equal(bubbles(env).length, 3);
    assert.ok(textarea(env)); // اعتراض دوباره باز است ⇒ فیلد پیام عادی
  });

  test('سقف ادامه پر یا خاموش: دکمه‌ی ادامه نیست و دلیل نوشته می‌شود', async () => {
    const full = makeEnv({ disputes: { 1: { dispute: D({ status: 'resolved', closed_by: 'admin', phase: 'resolved', can_reply: false, can_close: false, can_reopen: false, reopen_count: 3 }), messages: [M(1, 'user', 'اول')] } } });
    await open(full);
    assert.equal(btn(full, 'ادامه‌ی اعتراض'), undefined);
    assert.match(thread(full).textContent, /سقف دفعات ادامه‌ی اعتراض \(۳ بار\) پر شده است/);
    const off = makeEnv({ disputes: { 1: { dispute: D({ status: 'resolved', closed_by: 'admin', phase: 'resolved', can_reply: false, can_close: false, can_reopen: false, max_reopens: 0 }), messages: [M(1, 'user', 'اول')] } } });
    await open(off);
    assert.match(thread(off).textContent, /ادمین بسته شده است/);
    assert.match(thread(off).textContent, /ادامه‌ی اعتراضِ بسته‌شده فعال نیست/);
  });

  test('ماه بسته (۴۰۹ MONTH_CLOSED): پیام سرور دیده می‌شود و پیش‌نویس می‌ماند', async () => {
    const env = makeEnv({
      disputes: { 1: { dispute: D(), messages: [M(1, 'user', 'اول')] } },
      post: () => ({ status: 409, json: { error: 'این اعتراض مربوط به ماهِ بسته‌شده است و فقط‌خواندنی است.', code: 'MONTH_CLOSED' } }),
    });
    await open(env);
    await write(env, 'پیگیری');
    await click(env, 'ارسال');
    assert.match(status(env).textContent, /ماهِ بسته‌شده/);
    assert.equal(textarea(env).value, 'پیگیری');
  });

  test('اعتراض ناموجود/دیگران (۴۰۴) هنگام باز کردن: پیام سرور + «تلاش دوباره»؛ لودینگ قبل از پاسخ دیده می‌شود', async () => {
    const env = makeEnv({ disputes: { 5: { dispute: D({ id: 5 }), messages: [] } } });
    await env.openProfile();
    delete env.disputes[5]; // بین فهرست و باز کردن حذف شد
    await items(env)[0].fire('click');
    assert.match(thread(env).innerHTML, /aria-busy="true"|اعتراض یافت نشد/); // اولین رندر لودینگ است و بعد خطا
    await flush();
    const h = thread(env).innerHTML;
    assert.match(h, /role="alert"/);
    assert.match(h, /اعتراض یافت نشد\./);
    assert.match(h, /id="retry-dispute-thread"/);
  });
});

describe('D5 — ساختار HTML/CSS و قرارداد کد', () => {
  test('index.html: فرم قدیمی اعتراض حفظ شده + فهرست و نمای گفت‌وگو با aria', () => {
    assert.match(html, /<form id="dispute-form"/);
    assert.match(html, /<div class="form-msg" id="dispute-msg"><\/div>/);
    assert.match(html, /id="dispute-list"[^>]*role="group"[^>]*aria-labelledby="dispute-list-title"/);
    assert.match(html, /<section id="view-dispute" class="view hidden" aria-labelledby="dispute-title">/);
    assert.match(html, /id="dispute-title" tabindex="-1"/);
    assert.match(html, /id="dispute-back"/);
    assert.match(html, /id="dispute-thread"/);
  });
  test('app.js: متن پیام‌ها فقط با textContent، خطا با renderError و شناسه‌ی retry، دکمه‌ها با withBusy', () => {
    const i = appSrc.indexOf('// ---------- «اعتراض‌های من» و گفت‌وگو (D5)');
    const j = appSrc.indexOf('// ---------- بوت‌استرپ ----------');
    assert.ok(i > 0 && j > i);
    const mod = appSrc.slice(i, j);
    assert.doesNotMatch(mod.replace(/list\.innerHTML = '';|box\.innerHTML = '';/g, ''), /innerHTML\s*=/);
    assert.match(mod, /renderError\(list, err, loadDisputeList, 'retry-dispute-list'\)/);
    assert.match(mod, /renderError\(box, err, loadDisputeThread, 'retry-dispute-thread'\)/);
    assert.equal((mod.match(/withBusy\(btn,/g) || []).length, 2); // ارسال/ادامه و خاتمه
    assert.match(mod, /ta\.maxLength = DISPUTE_MSG_MAX/);
    assert.match(mod, /setAttribute\('role', 'log'\)/);
    assert.match(mod, /label\.setAttribute\('for', 'dispute-msg-input'\)/);
    assert.doesNotMatch(mod, /\b(confirm|alert|prompt)\(/);
  });
  test('اتصال: switchView پروفایل فهرست را می‌گیرد، نمای dispute زیر «پروفایل» روشن می‌ماند، ریست دیتابیس نشان‌های دیده‌شده را پاک می‌کند', () => {
    assert.match(appSrc, /if \(name === 'profile'\) \{ loadProfile\(\); loadDisputeList\(\); \}/);
    assert.match(appSrc, /if \(name === 'dispute'\) loadDisputeThread\(\);/);
    assert.match(appSrc, /const navName = name === 'dispute' \? 'profile' : name;/);
    assert.match(appSrc, /k\.indexOf\('draft:'\) === 0 \|\| k\.indexOf\(DISPUTE_SEEN_PREFIX\) === 0/);
    assert.match(appSrc, /withBusy\(form\.querySelector\('\[type="submit"\]'\), \(\) => api\('\/dispute', \{/); // فرم ثبت دست‌نخورده
  });
  test('CSS: کلاس‌های وضعیت/حباب/نوشتن، ویژگی‌های منطقی (بدون left/right فیزیکی)، .btn.ghost', () => {
    const i = css.indexOf('/* اعتراض‌های من و گفت‌وگو (D5)');
    assert.ok(i > 0);
    const block = css.slice(i);
    for (const re of [/\.badge\.dsp-open/, /\.badge\.dsp-answered/, /\.badge\.dsp-resolved/, /\.badge\.dsp-closed/, /\.dsp-msg\.mine/, /\.dsp-msg\.theirs/, /\.dsp-unread/, /\.dsp-composer textarea/, /white-space: pre-wrap/]) assert.match(block, re);
    assert.doesNotMatch(block, /(^|[\s;{])(left|right)\s*:|margin-(left|right)|padding-(left|right)|text-align:\s*(left|right)/);
    assert.match(css, /\.btn\.ghost \{/);
  });
});

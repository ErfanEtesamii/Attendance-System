// D4: ویزارد برنامه‌ی هفتگی در Mini App — مراحل، اعتبارسنجی پیام‌های فارسی، ثبت کامل، دسترسی مستقیم، ساختار HTML.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const appSrc = read('public/js/app.js');
const html = read('public/index.html');
const flush = () => new Promise((r) => setTimeout(r, 15));

class Node_ {
  constructor(tag) { this.tag = tag; this.children = []; this.handlers = {}; this._text = ''; this.className = ''; this.dataset = {}; this.style = {}; this.hidden = false; this.value = ''; this.disabled = false; this.classList = { add() {}, remove() {}, toggle() {} }; }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  set innerHTML(v) { this.children = []; this._text = ''; }
  get innerHTML() { return ''; }
  addEventListener(t, fn) { (this.handlers[t] = this.handlers[t] || []).push(fn); }
  appendChild(c) { this.children.push(c); return c; }
  setAttribute() {} removeAttribute() {} get isConnected() { return true; }
  querySelector() { return null; }
  fire(t, ev = {}) { return Promise.all((this.handlers[t] || []).map((fn) => fn({ preventDefault() {}, target: this, ...ev }))); }
}
const walk = (n, out = []) => { out.push(n); (n.children || []).forEach((c) => walk(c, out)); return out; };

function makeEnv({ plan, search = '', startParam = '', fail = null } = {}) {
  const els = new Map();
  const $ = (sel) => { if (!els.has(sel)) els.set(sel, new Node_(sel)); return els.get(sel); };
  const nav = Object.assign(new Node_('nav'), { dataset: { view: 'plan' } });
  const document = { querySelector: $, querySelectorAll: () => [nav], createElement: (t) => new Node_(t), createTextNode: (t) => { const n = new Node_('#text'); n._text = t; return n; } };
  const calls = [];
  const data = {
    ok: true, week: 'next', weekStart: '2027-05-01', weekEnd: '2027-05-07', planDay: '2027-05-06', status: 'draft', editMode: 'free', minTasks: 1, maxTasks: 30,
    tasks: [], carryOver: [], previousWeekTasks: [], frequentTitles: [], supervisorComment: null, ...(plan || {}),
  };
  const fetchStub = async (url, init = {}) => {
    calls.push({ url, init });
    const m = init.method || 'GET';
    if (fail && m !== 'GET') return { ok: false, status: 400, json: async () => ({ error: fail }) };
    return { ok: true, status: 200, json: async () => data };
  };
  const window = { location: { search }, Telegram: undefined };
  vm.runInNewContext(appSrc, { window, document, fetch: fetchStub, console, setTimeout, clearTimeout, setInterval, clearInterval, Date, Intl, JSON, Promise, encodeURIComponent, URLSearchParams });
  return { $, nav, calls, body: () => $('#plan-body') };
}
const open = async (env) => { await env.nav.fire('click'); await flush(); };
const btn = (env, text) => walk(env.body()).find((n) => n.tag === 'button' && n.textContent === text);
const click = async (env, text) => { const b = btn(env, text); assert.ok(b, `دکمه‌ی «${text}» پیدا نشد`); await b.fire('click'); await flush(); };
const inputs = (env, tag, ph) => walk(env.body()).filter((n) => n.tag === tag && (!ph || n.placeholder === ph));
const type = (node, v) => { node.value = v; return node.fire('input', { target: node }); };

describe('ساختار (D4)', () => {
  test('HTML: بخش view-plan بدون استایل/handler درون‌خطی، دکمه‌ی بازگشت و بدنه', () => {
    const v = html.slice(html.indexOf('id="view-plan"'), html.indexOf('id="view-profile"'));
    assert.match(v, /id="plan-back"/);
    assert.match(v, /id="plan-body"/);
    assert.doesNotMatch(v, /\sstyle=|\son[a-z]+=/i);
  });
  test('کاشی «برنامه‌ی هفتگی» در هر چهار حالت امروز و دسترسی مستقیم ?view=plan', () => {
    assert.equal((appSrc.match(/addPlanTile\(\);/g) || []).length, 4);
    assert.match(appSrc, /target === 'plan'/);
    assert.match(appSrc, /start_param/);
  });
});

describe('ویزارد (D4)', () => {
  test('بدون ناتمام: مستقیم مرحله‌ی تسک‌ها؛ تسک بدون عنوان ⇒ پیام فارسی و بدون درخواست', async () => {
    const env = makeEnv();
    await open(env);
    assert.match(env.body().textContent, /هفته‌ی/);
    await click(env, '+ افزودن تسک');
    assert.equal(inputs(env, 'input', 'عنوان تسک').length, 1);
    await click(env, 'مرور');
    assert.match(env.body().textContent, /عنوان تسک 1 را بنویسید/);
    assert.equal(env.calls.filter((c) => c.init.method === 'PUT').length, 0);
  });

  test('حداقل تسک (minTasks) و عنوان بلند', async () => {
    const env = makeEnv({ plan: { minTasks: 2 } });
    await open(env);
    await click(env, '+ افزودن تسک');
    await type(inputs(env, 'input', 'عنوان تسک')[0], 'x'.repeat(121));
    await click(env, 'مرور');
    assert.match(env.body().textContent, /حداکثر ۱۲۰/);
    await type(inputs(env, 'input', 'عنوان تسک')[0], 'کار اول');
    await click(env, 'مرور');
    assert.match(env.body().textContent, /حداقل 2 تسک لازم است/);
  });

  test('ثبت کامل: افزودن ← مرور ← PUT با تسک‌ها ← POST submit؛ سپس صفحه‌ی «ثبت شده»', async () => {
    const env = makeEnv();
    await open(env);
    await click(env, '+ افزودن تسک');
    await type(inputs(env, 'input', 'عنوان تسک')[0], '  گزارش فروش ');
    await type(inputs(env, 'textarea')[0], 'توضیح کوتاه');
    await click(env, 'مرور');
    assert.match(env.body().textContent, /1 تسک برای این هفته ثبت می‌شود/);
    assert.match(env.body().textContent, /گزارش فروش/);
    await click(env, 'ثبت برنامه');
    const put = env.calls.find((c) => c.init.method === 'PUT');
    const sub = env.calls.find((c) => c.init.method === 'POST' && c.url.endsWith('/plan/submit'));
    assert.ok(put && sub);
    assert.deepEqual(JSON.parse(put.init.body), { week: 'next', tasks: [{ title: 'گزارش فروش', description: 'توضیح کوتاه', plannedDate: null, priority: 'normal' }] });
    assert.deepEqual(JSON.parse(sub.init.body), { week: 'next' });
  });

  test('خطای سرور هنگام ثبت عیناً نمایش داده می‌شود', async () => {
    const env = makeEnv({ fail: 'حداقل 1 تسک لازم است (سرور).' });
    await open(env);
    await click(env, '+ افزودن تسک');
    await type(inputs(env, 'input', 'عنوان تسک')[0], 'کار');
    await click(env, 'مرور');
    await click(env, 'ثبت برنامه');
    assert.match(env.body().textContent, /\(سرور\)/);
  });

  test('تسک‌های ناتمام: مرحله‌ی انتقال؛ فقط تیک‌خورده‌ها با carriedFromTaskId ثبت می‌شوند', async () => {
    const env = makeEnv({ plan: { carryOver: [{ id: 11, title: 'ناتمام الف', description: '', priority: 'high' }, { id: 12, title: 'ناتمام ب', description: '', priority: 'normal' }] } });
    await open(env);
    assert.match(env.body().textContent, /تسک‌های ناتمام هفته‌ی قبل/);
    const boxes = walk(env.body()).filter((n) => n.type === 'checkbox');
    assert.equal(boxes.length, 2);
    boxes[0].checked = true;
    await boxes[0].fire('change', { target: boxes[0] });
    await click(env, 'ادامه');
    assert.equal(inputs(env, 'input', 'عنوان تسک').length, 1);
    assert.equal(inputs(env, 'input', 'عنوان تسک')[0].value, 'ناتمام الف');
    await click(env, 'مرور');
    await click(env, 'ثبت برنامه');
    const put = JSON.parse(env.calls.find((c) => c.init.method === 'PUT').init.body);
    assert.deepEqual([put.tasks.length, put.tasks[0].carriedFromTaskId, put.tasks[0].priority], [1, 11, 'high']);
  });

  test('کپی از هفته‌ی قبل و پیشنهاد عنوان‌های پرتکرار', async () => {
    const env = makeEnv({ plan: { previousWeekTasks: [{ id: 1, title: 'قبلی ۱', description: '', priority: 'normal' }, { id: 2, title: 'قبلی ۲', description: '', priority: 'low' }], frequentTitles: ['جلسه‌ی هفتگی'] } });
    await open(env);
    await click(env, 'کپی از هفته‌ی قبل');
    assert.equal(inputs(env, 'input', 'عنوان تسک').length, 2);
    await click(env, '+ جلسه‌ی هفتگی');
    assert.equal(inputs(env, 'input', 'عنوان تسک').length, 3);
    await click(env, 'کپی از هفته‌ی قبل'); // دوباره: تکراری اضافه نمی‌شود
    assert.equal(inputs(env, 'input', 'عنوان تسک').length, 3);
  });

  test('برنامه‌ی ثبت‌شده: نمای فقط‌خواندنی + دکمه‌ی ویرایش؛ ماه بسته: بدون ویرایش', async () => {
    let env = makeEnv({ plan: { status: 'submitted', tasks: [{ id: 1, title: 'کار ثبت‌شده', description: '', plannedDate: null, priority: 'normal', isSystem: false }], supervisorComment: 'عالی' } });
    await open(env);
    assert.match(env.body().textContent, /ثبت شده است/);
    assert.match(env.body().textContent, /کار ثبت‌شده/);
    assert.match(env.body().textContent, /یادداشت سرپرست: عالی/);
    assert.ok(btn(env, 'ویرایش برنامه'));
    env = makeEnv({ plan: { editMode: 'readonly' } });
    await open(env);
    assert.match(env.body().textContent, /ماهِ بسته/);
    assert.equal(btn(env, 'ویرایش برنامه'), undefined);
  });
});

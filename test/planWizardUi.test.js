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
const cards = (env) => walk(env.body()).filter((n) => n.tag === 'section' && /day-card/.test(n.className));
// افزودن از فیلد کارت شماره‌ی i (۰ = «هر روز / بدون روز مشخص») با دکمه‌ی «+ افزودن» همان کارت
const addIn = async (env, i, title) => {
  const card = cards(env)[i];
  await type(walk(card).find((n) => n.tag === 'input' && n.placeholder === 'تسک جدید…'), title);
  await walk(card).find((n) => n.tag === 'button' && n.textContent === '+ افزودن').fire('click');
  await flush();
};
const WEEK = [ // ۱۴۰۶-۰۲-۱۱ (شنبه) ... : ۵ کاری، پنجشنبه نیم‌روز، جمعه آخر هفته
  ['2027-05-01', 'working'], ['2027-05-02', 'working'], ['2027-05-03', 'working'], ['2027-05-04', 'working'],
  ['2027-05-05', 'working'], ['2027-05-06', 'half'], ['2027-05-07', 'weekend'],
].map(([date, kind]) => ({ date, kind, isWorkingDay: kind !== 'weekend', holidayTitle: null }));

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
  test('بدون ناتمام: مستقیم مرحله‌ی تسک‌ها؛ افزودنِ خالی و تسک بدون عنوان ⇒ پیام فارسی و بدون درخواست', async () => {
    const env = makeEnv();
    await open(env);
    assert.match(env.body().textContent, /هفته‌ی/);
    await addIn(env, 0, '   ');
    assert.match(env.body().textContent, /عنوان تسک را بنویسید/);
    await addIn(env, 0, 'کار');
    await type(inputs(env, 'input', 'عنوان تسک')[0], '');
    await click(env, 'مرور');
    assert.match(env.body().textContent, /عنوان تسک 1 را بنویسید/);
    assert.equal(env.calls.filter((c) => c.init.method === 'PUT').length, 0);
  });

  test('حداقل تسک (minTasks) و عنوان بلند', async () => {
    const env = makeEnv({ plan: { minTasks: 2 } });
    await open(env);
    await addIn(env, 0, 'x'.repeat(121));
    assert.match(env.body().textContent, /حداکثر ۱۲۰/);
    await addIn(env, 0, 'کار اول');
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
    await addIn(env, 0, '  گزارش فروش ');
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
    await addIn(env, 0, 'کار');
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

describe('کارت‌های روزانه (C1)', () => {
  test('هر روز کاری یک کارت (+ کارت «هر روز»)؛ روز آخر هفته‌ی بدون تسک کارت ندارد؛ نیم‌روز برچسب دارد', async () => {
    const env = makeEnv({ plan: { days: WEEK } });
    await open(env);
    const cs = cards(env);
    assert.equal(cs.length, 1 + 6);
    assert.match(cs[0].textContent, /هر روز \/ بدون روز مشخص/);
    assert.equal(cs.filter((c) => /نیم‌روز/.test(c.textContent)).length, 1);
    assert.equal(cs.filter((c) => /تعطیل/.test(c.textContent)).length, 0);
    assert.equal(cs.filter((c) => walk(c).some((n) => n.tag === 'h4' && n.textContent)).length, 7); // هر کارت عنوان روز دارد
  });

  test('بدون days از سرور: همه‌ی ۷ روز کاری فرض می‌شود', async () => {
    const env = makeEnv();
    await open(env);
    assert.equal(cards(env).length, 1 + 7);
  });

  test('افزودن در کارت یک روز ⇒ plannedDate همان روز در PUT؛ در کارت «هر روز» ⇒ null', async () => {
    const env = makeEnv({ plan: { days: WEEK } });
    await open(env);
    await addIn(env, 1, 'کار شنبه');
    await addIn(env, 0, 'کار عمومی');
    assert.equal(cards(env)[1].textContent.includes('کار شنبه') || walk(cards(env)[1]).some((n) => n.value === 'کار شنبه'), true);
    await click(env, 'مرور');
    await click(env, 'ثبت برنامه');
    const put = JSON.parse(env.calls.find((c) => c.init.method === 'PUT').init.body);
    assert.deepEqual(put.tasks.map((t) => [t.title, t.plannedDate]), [['کار شنبه', '2027-05-01'], ['کار عمومی', null]]);
  });

  test('روز آخر هفته‌ای که تسک دارد کارت می‌گیرد (داده‌ی موجود پنهان نمی‌شود) با برچسب «تعطیل»', async () => {
    const env = makeEnv({ plan: { days: WEEK, tasks: [{ id: 5, title: 'کار جمعه', description: '', plannedDate: '2027-05-07', priority: 'normal', isSystem: false }] } });
    await open(env);
    const cs = cards(env);
    assert.equal(cs.length, 1 + 7);
    assert.ok(cs.some((c) => /تعطیل/.test(c.textContent) && walk(c).some((n) => n.value === 'کار جمعه')));
  });

  test('ویرایش و حذف تسک از داخل کارت', async () => {
    const env = makeEnv({ plan: { days: WEEK } });
    await open(env);
    await addIn(env, 2, 'الف');
    await addIn(env, 2, 'ب');
    assert.equal(inputs(env, 'input', 'عنوان تسک').length, 2);
    await type(inputs(env, 'input', 'عنوان تسک')[0], 'الف ویرایش‌شده');
    await click(env, 'حذف');
    await click(env, 'مرور');
    await click(env, 'ثبت برنامه');
    const put = JSON.parse(env.calls.find((c) => c.init.method === 'PUT').init.body);
    assert.deepEqual(put.tasks.map((t) => t.title), ['ب']);
  });

  test('تسک سیستمی در کارت «هر روز» و بدون دکمه‌ی حذف؛ متن نیمه‌نوشته‌ی کارت‌ها با رندر مجدد حفظ می‌شود', async () => {
    const env = makeEnv({ plan: { days: WEEK, tasks: [{ id: 9, title: 'مرور گزارش‌های تیم', description: '', plannedDate: null, priority: 'normal', isSystem: true }] } });
    await open(env);
    assert.match(cards(env)[0].textContent, /تسک خودکار: مرور گزارش‌های تیم/);
    assert.equal(walk(cards(env)[0]).filter((n) => n.tag === 'button' && n.textContent === 'حذف').length, 0);
    await type(walk(cards(env)[3]).find((n) => n.tag === 'input' && n.placeholder === 'تسک جدید…'), 'نیمه‌نوشته');
    await addIn(env, 1, 'یک تسک'); // رندر مجدد
    assert.equal(walk(cards(env)[3]).find((n) => n.tag === 'input' && n.placeholder === 'تسک جدید…').value, 'نیمه‌نوشته');
  });

  test('Enter در فیلد کارت تسک اضافه می‌کند؛ سقف maxTasks سمت UI', async () => {
    const env = makeEnv({ plan: { days: WEEK, maxTasks: 1 } });
    await open(env);
    const field = walk(cards(env)[1]).find((n) => n.tag === 'input' && n.placeholder === 'تسک جدید…');
    await type(field, 'با اینتر');
    await field.fire('keydown', { key: 'Enter' });
    await flush();
    assert.equal(inputs(env, 'input', 'عنوان تسک').length, 1);
    await addIn(env, 2, 'دومی');
    assert.match(env.body().textContent, /حداکثر 1 تسک مجاز است/);
    assert.equal(inputs(env, 'input', 'عنوان تسک').length, 1);
  });
});

describe('استایل کارت‌ها (C1)', () => {
  const css = read('public/css/style.css');
  const lum = (h) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const block = (sel) => css.slice(css.indexOf(sel), css.indexOf('}', css.indexOf(sel)));
  const tok = (b, name) => new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`).exec(b)[1];

  for (const [name, sel] of [['روشن', ':root {\n  --plan-board'], ['تیره', ':root[data-theme="dark"] {\n  --plan-board']]) {
    test(`پالت ${name}: متن، راهنما و عنوان روی کارت کرمی کنتراست ≥ 4.5`, () => {
      const b = block(sel);
      const card = tok(b, '--plan-card');
      for (const k of ['--plan-ink', '--plan-hint', '--plan-title']) assert.ok(ratio(card, tok(b, k)) >= 4.5, `${name} ${k}`);
      assert.ok(ratio(tok(b, '--plan-field'), tok(b, '--plan-ink')) >= 4.5);
    });
  }

  test('بدون اسکرول افقی روی ۳۲۰px: گرید با min(100%, …)، min-width:0 روی کارت و فیلدها', () => {
    assert.match(css, /\.plan-days \{[^}]*minmax\(min\(100%, 240px\), 1fr\)/);
    assert.match(css, /\.day-card \{[^}]*min-width: 0/);
    assert.match(css, /\.day-add-input, \.day-task-title[^{]*\{[^}]*min-width: 0/);
  });

  test('خط‌چین‌های برگه‌ی کاغذ و دکمه‌ی حذف لمس‌پسند (۴۴px)', () => {
    assert.match(css, /\.day-card-head \{[^}]*dashed/);
    assert.match(css, /\.day-task \{[^}]*dashed/);
    assert.match(css, /\.day-task-del \{[^}]*min-height: 44px/);
  });
});

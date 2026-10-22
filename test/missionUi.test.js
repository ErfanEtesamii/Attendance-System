// C2: UI ماموریت در Mini App — کاشی صفحه‌ی امروز، فرم (بدنه‌ی ارسالی/اعتبارسنجی)، فهرست و لغو. app.js با DOM ساختگی اجرا می‌شود.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');
const appSrc = read('public/js/app.js');
const html = read('public/index.html');
const flush = () => new Promise((r) => setTimeout(r, 15));

describe('ماموریت — ساختار (C2)', () => {
  test('HTML: فرم با واحدها، علت (maxlength=300)، مقصد، پیوست، هشدار و فهرست', () => {
    const v = html.slice(html.indexOf('id="view-mission"'), html.indexOf('id="view-profile"'));
    for (const id of ['mission-form', 'mission-start-row', 'mission-end-row', 'mission-part-row', 'mission-starttime-row', 'mission-endtime-row', 'mission-warning', 'mission-msg', 'mission-list', 'mission-back']) assert.ok(v.includes(`id="${id}"`), id);
    assert.match(v, /<option value="day">تمام‌روز<\/option>[\s\S]*<option value="half_day">نیم‌روز<\/option>[\s\S]*<option value="hour">ساعتی<\/option>/);
    assert.match(v, /name="reason" rows="3" maxlength="300" required/);
    assert.match(v, /name="destination" maxlength="100"/);
    assert.match(v, /accept="image\/jpeg,image\/png,application\/pdf"/);
    assert.doesNotMatch(v, /\sstyle=|\son[a-z]+=/i);
  });

  test('کاشی «ماموریت 🚗» در هر چهار حالت امروز؛ با استراحت باز غیرفعال', () => {
    assert.equal((appSrc.match(/addMissionTile\(\);/g) || []).length, 4);
    assert.match(appSrc, /title: 'ماموریت', sub: openBreak \? 'ابتدا استراحت را پایان دهید'/);
    assert.match(appSrc, /locked: !!openBreak/);
    assert.match(appSrc, /if \(locked\) \{ b\.disabled = true; b\.setAttribute\('aria-disabled', 'true'\)/);
    assert.match(appSrc, /handler: \(\) => openMissionView\(\)/);
  });
});

function makeEnv({ missions = [], day = { isWorkingDay: true, expectedStart: '08:00', expectedEnd: '16:30' }, failPost = null } = {}) {
  const noop = () => {};
  const els = new Map();
  const makeEl = (sel) => {
    const handlers = {};
    return {
      sel, innerHTML: '', textContent: '', className: '', style: {}, dataset: {}, children: [], handlers, hidden: false, value: '', disabled: false, type: '',
      classList: { add: noop, remove: noop, toggle: noop },
      addEventListener(type, fn) { (handlers[type] = handlers[type] || []).push(fn); },
      appendChild(c) { this.children.push(c); return c; },
      setAttribute: noop, removeAttribute: noop, isConnected: true,
    };
  };
  const $ = (sel) => { if (!els.has(sel)) els.set(sel, makeEl(sel)); return els.get(sel); };
  const form = $('#mission-form');
  form.unit = makeEl('select'); form.unit.value = 'day';
  form.startDate = { type: 'text', value: '2027-05-04' };
  form.endDate = { type: 'text', value: '2027-05-06' };
  form.halfDayPart = makeEl('select'); form.halfDayPart.value = 'morning';
  form.startTime = makeEl('time'); form.endTime = makeEl('time');
  form.reason = { value: 'جلسه با مشتری' };
  form.destination = { value: ' اهواز ' };
  form.attachment = { files: [] };
  form.reset = noop;
  form.querySelector = () => null;
  const navBtns = [Object.assign(makeEl('nav'), { dataset: { view: 'mission' } })];
  const document = { querySelector: $, querySelectorAll: () => navBtns, createElement: () => makeEl('new') };
  const calls = [];
  const fetchStub = async (url, init = {}) => {
    calls.push({ url, init });
    const method = init.method || 'GET';
    let status = 200; let body = {};
    if (url.includes('/mission/day')) body = day;
    else if (url.endsWith('/missions') && method === 'GET') body = missions;
    else if (url.endsWith('/mission') && method === 'POST') { if (failPost) { status = 400; body = { error: failPost }; } else body = { id: 7, status: 'pending' }; }
    else if (/\/missions\/\d+$/.test(url) && method === 'DELETE') body = { ok: true };
    else if (/\/attachment$/.test(url)) body = { id: 7 };
    return { ok: status < 400, status, json: async () => body };
  };
  vm.runInNewContext(appSrc, { window: {}, document, fetch: fetchStub, console, setTimeout, clearTimeout, setInterval, clearInterval, Date, Intl, JSON, Promise, encodeURIComponent });
  return { $, form, calls, navBtns };
}
const submit = async (env) => { for (const fn of env.form.handlers.submit) await fn({ preventDefault() {}, target: env.form }); await flush(); };
const posts = (env) => env.calls.filter((c) => c.url.endsWith('/mission') && c.init.method === 'POST');
const body = (env) => JSON.parse(posts(env)[0].init.body);

describe('ماموریت — فرم (C2)', () => {
  test('تمام‌روز: بدنه با unit/startDate/endDate/reason/destination (مقصد trim)', async () => {
    const env = makeEnv();
    await submit(env);
    assert.deepEqual(body(env), { unit: 'day', startDate: '2027-05-04', endDate: '2027-05-06', reason: 'جلسه با مشتری', destination: 'اهواز' });
    assert.match(env.$('#mission-msg').textContent, /ارسال شد/);
  });

  test('نیم‌روز و ساعتی: endDate = startDate؛ ساعت نامعتبر ارسال نمی‌شود', async () => {
    let env = makeEnv();
    env.form.unit.value = 'half_day'; env.form.halfDayPart.value = 'afternoon';
    await submit(env);
    assert.deepEqual(body(env), { unit: 'half_day', startDate: '2027-05-04', endDate: '2027-05-04', reason: 'جلسه با مشتری', destination: 'اهواز', halfDayPart: 'afternoon' });

    env = makeEnv();
    env.form.unit.value = 'hour'; env.form.startTime.value = '11:00'; env.form.endTime.value = '10:00';
    await submit(env);
    assert.equal(posts(env).length, 0);
    assert.match(env.$('#mission-msg').textContent, /ساعت/);
    env.form.endTime.value = '12:00';
    await submit(env);
    assert.deepEqual(body(env), { unit: 'hour', startDate: '2027-05-04', endDate: '2027-05-04', reason: 'جلسه با مشتری', destination: 'اهواز', startTime: '11:00', endTime: '12:00' });
  });

  test('علت کوتاه/بلند و تاریخ خالی/معکوس ⇒ پیام فارسی و بدون درخواست', async () => {
    const env = makeEnv();
    env.form.reason.value = 'abc';
    await submit(env);
    assert.match(env.$('#mission-msg').textContent, /حداقل ۵ نویسه/);
    env.form.reason.value = 'x'.repeat(301);
    await submit(env);
    assert.match(env.$('#mission-msg').textContent, /حداکثر ۳۰۰/);
    env.form.reason.value = 'علت کافی است';
    env.form.startDate.value = '';
    await submit(env);
    assert.match(env.$('#mission-msg').textContent, /تاریخ/);
    env.form.startDate.value = '2027-05-07';
    await submit(env);
    assert.match(env.$('#mission-msg').textContent, /پایان نباید قبل/);
    assert.equal(posts(env).length, 0);
  });

  test('خطای سرور (مثلاً تداخل) عیناً نمایش داده می‌شود', async () => {
    const env = makeEnv({ failPost: 'با یک درخواست دیگر تداخل دارد.' });
    await submit(env);
    assert.equal(env.$('#mission-msg').textContent, 'با یک درخواست دیگر تداخل دارد.');
  });

  test('پیوست انتخاب‌شده بعد از ثبت با Content-Type فایل ارسال می‌شود', async () => {
    const env = makeEnv();
    env.form.attachment.files = [{ name: 'a.png', type: 'image/png' }];
    await submit(env);
    const up = env.calls.find((c) => /\/missions\/7\/attachment$/.test(c.url));
    assert.ok(up);
    assert.equal(up.init.headers['Content-Type'], 'image/png');
  });
});

describe('ماموریت — هشدار ساعت کاری و فهرست (C2)', () => {
  test('ساعتی بیرون از ساعت کاری ⇒ هشدار؛ داخل ⇒ بدون هشدار؛ روز غیرکاری ⇒ هشدار', async () => {
    let env = makeEnv();
    env.form.unit.value = 'hour'; env.form.startTime.value = '07:00'; env.form.endTime.value = '09:00';
    env.form.startTime.handlers.change.forEach((fn) => fn());
    await flush();
    assert.match(env.$('#mission-warning').textContent, /ساعت کاری حساب نمی‌شود/);
    assert.equal(env.$('#mission-warning').hidden, false);
    env.form.startTime.value = '09:00'; env.form.endTime.value = '12:00';
    env.form.startTime.handlers.change.forEach((fn) => fn());
    await flush();
    assert.equal(env.$('#mission-warning').hidden, true);

    env = makeEnv({ day: { isWorkingDay: false, expectedStart: null, expectedEnd: null } });
    env.form.unit.value = 'half_day';
    env.form.unit.handlers.change.forEach((fn) => fn());
    await flush();
    assert.match(env.$('#mission-warning').textContent, /کاری نیست/);
  });

  test('فهرست: وضعیت، یادداشت سرپرست و دکمه‌ی لغو فقط برای pending؛ لغو دو مرحله‌ای (DELETE)', async () => {
    const missions = [
      { id: 5, status: 'pending', unit: 'day', startDate: '2027-05-04', endDate: '2027-05-04', reason: 'علت اول', destination: 'قم', managerNote: null },
      { id: 6, status: 'rejected', unit: 'day', startDate: '2027-05-01', endDate: '2027-05-01', reason: 'علت دوم', destination: null, managerNote: 'زمان مناسب نیست' },
    ];
    const env = makeEnv({ missions });
    env.navBtns[0].handlers.click.forEach((fn) => fn());
    await flush();
    const items = env.$('#mission-list').children;
    assert.equal(items.length, 2);
    const flat = (el) => [el.textContent, ...(el.children || []).flatMap(flat)];
    const text0 = flat(items[0]).join('|');
    const text1 = flat(items[1]).join('|');
    assert.match(text0, /ماموریت — قم/);
    assert.match(text0, /در انتظار تأیید/);
    assert.match(text1, /رد شده/);
    assert.match(text1, /یادداشت سرپرست: زمان مناسب نیست/);
    const cancelBtn = (el) => el.children.find((c) => c.className && c.className.includes('mission-cancel'));
    assert.ok(cancelBtn(items[0]));
    assert.equal(cancelBtn(items[1]), undefined, 'ردشده قابل لغو نیست');
    const b = cancelBtn(items[0]);
    b.handlers.click[0]();
    await flush();
    assert.equal(env.calls.filter((c) => c.init.method === 'DELETE').length, 0, 'کلیک اول فقط آماده‌سازی');
    assert.match(b.textContent, /مطمئنید/);
    b.handlers.click[0]();
    await flush();
    const del = env.calls.find((c) => c.init.method === 'DELETE');
    assert.ok(del && del.url.endsWith('/missions/5'));
  });
});

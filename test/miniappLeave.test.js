// S4-10c: Mini App — GET /miniapp/leave-types (انواع فعال + مانده) و POST /miniapp/leave روی leaveService (واحدها، قواعد، سازگاری قرارداد قدیمی)
// + فرم سمت کلاینت (public/js/app.js با DOM ساختگی): فقط فیلدهای لازم هر واحد ارسال می‌شود.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('Mini App مرخصی (S4-10c) — سرور', () => {
  let server; let base; let F; let emp; let admin; let annual; let mission; let typesRepo; let settingsRepo; let balanceSvc;
  const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const init = (user) => {
    const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: Number(user.telegram_user_id), first_name: 'تست' }) });
    const dcs = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
    const secret = crypto.createHmac('sha256', 'WebAppData').update(TOKEN).digest();
    params.set('hash', crypto.createHmac('sha256', secret).update(dcs).digest('hex'));
    return params.toString();
  };
  async function call(user, method, p, body) {
    const res = await fetch(`${base}/api/miniapp/${p}`, { method, headers: { 'content-type': 'application/json', 'x-telegram-init-data': init(user) }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  }

  before(async () => {
    resetDb();
    F = require('./helpers/factories');
    typesRepo = require('../src/repositories/leaveTypesRepository');
    settingsRepo = require('../src/repositories/settingsRepository');
    balanceSvc = require('../src/services/leaveBalanceService');
    const config = require('../src/config');
    config.allowedNetworkCidr = '127.0.0.0/8';
    admin = F.makeUser({ role: 'admin' });
    emp = F.makeUser();
    annual = typesRepo.findByCode('annual');
    mission = typesRepo.findByCode('mission');
    typesRepo.updateLeaveType(annual.id, { allowedUnits: ['day', 'half_day', 'hour'] });
    const { createApp } = require('../src/server');
    server = createApp().listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => { if (server) server.close(); cleanup(); });

  test('GET /leave-types: فقط انواع فعال با واحدها؛ مانده فقط برای نوع‌های دارای مانده', async () => {
    const off = typesRepo.createLeaveType({ code: 'off_m', title: 'غیرفعال', kind: 'leave', isPaid: true, requiresAttachment: false, countsAgainstBalance: false, allowedUnits: ['day'], maxConsecutiveDays: null, isActive: false });
    balanceSvc.setEntitlement({ userId: emp.id, leaveTypeId: annual.id, jalaliYear: require('../src/utils/jalali').jalaliYearOfDateString(new Date().toISOString().slice(0, 10)), entitledMinutes: 1020, actor: admin.id, reason: 'تست' });
    const r = await call(emp, 'GET', 'leave-types');
    assert.equal(r.status, 200);
    const byCode = Object.fromEntries(r.json.map((t) => [t.code, t]));
    assert.ok(!byCode.off_m && off.id);
    assert.deepEqual(byCode.annual.allowedUnits, ['day', 'half_day', 'hour']);
    assert.equal(byCode.annual.balance.remaining, 1020);
    assert.equal(byCode.annual.balance.remainingText, '2 روز');
    assert.equal(byCode.mission.balance, null);
  });

  test('قرارداد قدیمی (leaveType + startDate + endDate) هنوز ۲۰۱ می‌دهد؛ unit پیش‌فرض روزانه', async () => {
    const r = await call(emp, 'POST', 'leave', { startDate: '2027-05-03', endDate: '2027-05-03', leaveType: 'leave', reason: 'x' });
    assert.equal(r.status, 201);
    assert.deepEqual([r.json.unit, r.json.duration_minutes, r.json.status], ['day', 510, 'pending']);
    assert.ok(Array.isArray(r.json.warnings));
  });

  test('واحدهای تازه با leaveTypeId؛ endDate برای نیم‌روز/ساعتی اختیاری', async () => {
    const half = await call(emp, 'POST', 'leave', { leaveTypeId: annual.id, unit: 'half_day', halfDayPart: 'morning', startDate: '2027-05-04' });
    assert.equal(half.status, 201);
    assert.deepEqual([half.json.unit, half.json.half_day_part, half.json.duration_minutes], ['half_day', 'morning', 255]);
    const hour = await call(emp, 'POST', 'leave', { leaveTypeId: annual.id, unit: 'hour', startDate: '2027-05-05', startTime: '10:00', endTime: '12:30' });
    assert.equal(hour.status, 201);
    assert.equal(hour.json.duration_minutes, 150);
    assert.equal((await call(emp, 'POST', 'leave', { leaveTypeId: mission.id, unit: 'hour', startDate: '2027-05-06', startTime: '10:00', endTime: '11:00' })).json.code, 'UNIT_NOT_ALLOWED');
  });

  test('قواعد سرویس: تداخل، مانده در حالت block، ورودی ناقص ⇒ ۴۰۰ با پیام؛ هیچ ردیفی ساخته نمی‌شود', async () => {
    const before = (await call(emp, 'GET', 'leave')).json.length;
    const overlap = await call(emp, 'POST', 'leave', { leaveTypeId: annual.id, startDate: '2027-05-03', endDate: '2027-05-03' });
    assert.equal(overlap.status, 400);
    assert.equal(overlap.json.code, 'OVERLAP');
    assert.match(overlap.json.error, /تداخل/);
    settingsRepo.setValue('leaveBalancePolicy', 'block');
    const poor = F.makeUser();
    const blocked = await call(poor, 'POST', 'leave', { leaveTypeId: annual.id, startDate: '2027-05-09', endDate: '2027-05-09' });
    assert.equal(blocked.json.code, 'INSUFFICIENT_BALANCE');
    settingsRepo.resetValue('leaveBalancePolicy');
    assert.equal((await call(emp, 'POST', 'leave', {})).status, 400);
    assert.equal((await call(emp, 'POST', 'leave', { startDate: '2027-05-10' })).status, 400, 'روزانه بدون endDate');
    assert.equal((await call(emp, 'GET', 'leave')).json.length, before);
  });

  test('مأموریت و مرخصی چندروزه؛ هشدار LOW_BALANCE با سیاست warn در پاسخ', async () => {
    const poor = F.makeUser();
    const r = await call(poor, 'POST', 'leave', { leaveTypeId: annual.id, startDate: '2027-06-07', endDate: '2027-06-08' });
    assert.equal(r.status, 201);
    assert.deepEqual(r.json.warnings.map((w) => w.code), ['LOW_BALANCE']);
    const m = await call(poor, 'POST', 'leave', { leaveTypeId: mission.id, startDate: '2027-07-05', endDate: '2027-07-05' });
    assert.equal(m.status, 201);
    assert.deepEqual(m.json.warnings, []);
  });
});

// ---- کلاینت: app.js با DOM ساختگی ----
const root = path.join(__dirname, '..');
const appSrc = fs.readFileSync(path.join(root, 'public', 'js', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const flush = () => new Promise((r) => setTimeout(r, 15));

function makeEnv(types) {
  const noop = () => {};
  const els = new Map();
  const makeEl = (sel) => {
    const handlers = {};
    return {
      sel, innerHTML: '', textContent: '', className: '', style: {}, dataset: {}, children: [], handlers, hidden: false, value: '',
      classList: { add: noop, remove: noop, toggle: noop },
      addEventListener(type, fn) { (handlers[type] = handlers[type] || []).push(fn); },
      appendChild(c) { this.children.push(c); return c; },
      setAttribute: noop, removeAttribute: noop,
    };
  };
  const $ = (sel) => { if (!els.has(sel)) els.set(sel, makeEl(sel)); return els.get(sel); };
  const form = $('#leave-form');
  form.startDate = { type: 'text', value: '2027-05-04' };
  form.endDate = { type: 'text', value: '2027-05-06', required: true };
  form.leaveType = makeEl('select'); form.leaveType.value = 'leave';
  form.unit = makeEl('select'); form.unit.value = 'day';
  form.halfDayPart = makeEl('select'); form.halfDayPart.value = 'morning';
  form.startTime = { value: '' }; form.endTime = { value: '' };
  form.reason = { value: 'سفر' };
  form.reset = noop;
  const navBtns = ['leave'].map((v) => { const b = makeEl('nav'); b.dataset.view = v; return b; });
  const document = { querySelector: $, querySelectorAll: (s) => (s === '.nav-btn' ? navBtns : []), createElement: () => makeEl('new') };
  const calls = [];
  const fetchStub = async (url, init = {}) => {
    calls.push({ url, init });
    const body = url.endsWith('/leave-types') ? types : url.endsWith('/leave') && init.method !== 'POST' ? [] : { id: 1, warnings: [] };
    return { ok: true, status: 200, json: async () => body };
  };
  vm.runInNewContext(appSrc, { window: {}, document, fetch: fetchStub, console, setTimeout, clearTimeout, setInterval, clearInterval, Date, Intl, JSON, Promise });
  return { $, form, navBtns, calls };
}
const submit = async (env) => { for (const fn of env.form.handlers.submit) await fn({ preventDefault() {}, target: env.form }); };
const post = (env) => JSON.parse(env.calls.find((c) => c.init.method === 'POST').init.body);
const TYPES = [
  { id: 1, code: 'annual', title: 'مرخصی استحقاقی', kind: 'leave', allowedUnits: ['day', 'half_day', 'hour'], balance: { remainingText: '3 روز' } },
  { id: 2, code: 'mission', title: 'مأموریت', kind: 'mission', allowedUnits: ['day'], balance: null },
];

describe('Mini App مرخصی (S4-10c) — فرم', () => {
  test('ساختار HTML: ردیف‌های واحد/بخش/ساعت و فیلد unit وجود دارند', () => {
    for (const id of ['leave-unit-row', 'leave-part-row', 'leave-starttime-row', 'leave-endtime-row', 'leave-balance']) assert.ok(html.includes(`id="${id}"`), id);
    assert.match(html, /name="halfDayPart"/);
  });

  test('نوع‌ها از سرور پر می‌شوند؛ نوع تک‌واحدی ⇒ ردیف واحد پنهان؛ مانده نمایش داده می‌شود', async () => {
    const env = makeEnv(TYPES);
    env.navBtns[0].handlers.click.forEach((fn) => fn());
    await flush();
    assert.equal(env.form.leaveType.children.length, 2);
    assert.equal(env.form.leaveType.children[0].value, 'id:1');
    assert.equal(env.$('#leave-unit-row').hidden, false, 'annual چند واحد دارد');
    assert.equal(env.$('#leave-balance').textContent, 'مانده‌ی مرخصی شما: 3 روز');
    env.form.leaveType.value = 'id:2';
    env.form.leaveType.handlers.change.forEach((fn) => fn());
    assert.equal(env.$('#leave-unit-row').hidden, true);
    assert.equal(env.$('#leave-balance').textContent, '');
  });

  test('بدنه‌ی ارسالی: روزانه با leaveTypeId؛ نیم‌روز بدون endDate مستقل؛ ساعتی با ساعت‌ها؛ ساعت نامعتبر ارسال نمی‌شود', async () => {
    let env = makeEnv(TYPES);
    env.navBtns[0].handlers.click.forEach((fn) => fn());
    await flush();
    env.form.leaveType.value = 'id:1';
    await submit(env);
    assert.deepEqual(post(env), { startDate: '2027-05-04', endDate: '2027-05-06', reason: 'سفر', leaveTypeId: 1 });

    env = makeEnv(TYPES);
    env.navBtns[0].handlers.click.forEach((fn) => fn());
    await flush();
    env.form.leaveType.value = 'id:1';
    env.form.unit.value = 'half_day';
    env.form.halfDayPart.value = 'afternoon';
    await submit(env);
    assert.deepEqual(post(env), { startDate: '2027-05-04', endDate: '2027-05-04', reason: 'سفر', leaveTypeId: 1, unit: 'half_day', halfDayPart: 'afternoon' });

    env = makeEnv(TYPES);
    env.navBtns[0].handlers.click.forEach((fn) => fn());
    await flush();
    env.form.leaveType.value = 'id:1';
    env.form.unit.value = 'hour';
    env.form.startTime.value = '10:00';
    env.form.endTime.value = '09:00';
    await submit(env);
    assert.equal(env.calls.filter((c) => c.init.method === 'POST').length, 0);
    assert.match(env.$('#leave-msg').textContent, /ساعت/);
    env.form.endTime.value = '12:00';
    await submit(env);
    assert.deepEqual(post(env), { startDate: '2027-05-04', endDate: '2027-05-04', reason: 'سفر', leaveTypeId: 1, unit: 'hour', startTime: '10:00', endTime: '12:00' });
  });

  test('بدون /leave-types (پاسخ غیرآرایه): فرم قدیمی با leaveType متنی کار می‌کند', async () => {
    const env = makeEnv({});
    env.navBtns[0].handlers.click.forEach((fn) => fn());
    await flush();
    await submit(env);
    assert.deepEqual(post(env), { startDate: '2027-05-04', endDate: '2027-05-06', reason: 'سفر', leaveType: 'leave' });
  });
});

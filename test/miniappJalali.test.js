// S3-11d: تاریخ شمسی در Mini App کارمند. اجرای واقعی public/js/app.js با DOM ساختگی (بدون مرورگر)
// + بررسی ساختار صفحه و سرو شدن فایل‌های مشترک jalali/datepicker از /admin.
// رفتار واقعی لمسی/تقویم روی موبایل در تست دستی بررسی می‌شود (شرح در CHANGELOG).
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const J = require('../public-admin/js/jalali.js');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const appSrc = fs.readFileSync(path.join(root, 'public', 'js', 'app.js'), 'utf8');

const flush = () => new Promise((r) => setTimeout(r, 15));
const p2 = (n) => String(n).padStart(2, '0');

// محیط ساختگی: هر selector یک عنصر ثابت؛ دکمه‌های ناوبری و فرم مرخصی با فیلدهای لازم
function makeEnv({ dp = true, jalali = true, telegram = false, routes = {} } = {}) {
  const noop = () => {};
  const els = new Map();
  const makeEl = (sel) => {
    const handlers = {};
    return {
      sel, innerHTML: '', textContent: '', className: '', style: {}, dataset: {}, children: [], handlers,
      classList: { add: noop, remove: noop, toggle: noop },
      addEventListener(type, fn) { (handlers[type] = handlers[type] || []).push(fn); },
      appendChild(c) { this.children.push(c); return c; },
      setAttribute: noop, removeAttribute: noop,
    };
  };
  const $ = (sel) => { if (!els.has(sel)) els.set(sel, makeEl(sel)); return els.get(sel); };

  const form = $('#leave-form');
  form.startDate = { type: 'date', value: '' };
  form.endDate = { type: 'date', value: '' };
  form.leaveType = { value: 'leave' };
  form.reason = { value: '' };
  form.resetCalled = 0;
  form.reset = () => { form.resetCalled += 1; };

  const navBtns = ['history', 'leave'].map((v) => { const b = makeEl('nav'); b.dataset.view = v; return b; });
  const document = {
    querySelector: $,
    querySelectorAll: (sel) => (sel === '.nav-btn' ? navBtns : []),
    createElement: () => makeEl('new'),
  };

  const attached = [];
  const DPStub = {
    attach(el, opts) {
      const inst = { el, opts, val: '', getValue() { return this.val; }, setValue(v) { this.val = v; } };
      attached.push(inst);
      return inst;
    },
  };

  const calls = [];
  const fetchStub = async (url, init = {}) => {
    calls.push({ url, init });
    const key = Object.keys(routes).find((k) => url.endsWith(k));
    const body = key ? routes[key] : {};
    return { ok: true, status: 200, json: async () => body };
  };

  const win = {};
  if (jalali) win.Jalali = J;
  if (dp) win.JalaliDatepicker = DPStub;
  if (telegram) {
    win.Telegram = { WebApp: { initData: 'fake-init-data', initDataUnsafe: {}, ready: noop, expand: noop, setHeaderColor: noop, setBackgroundColor: noop } };
  }
  vm.runInNewContext(appSrc, { window: win, document, fetch: fetchStub, console, setTimeout, clearTimeout, setInterval, clearInterval, Date, Intl, JSON, Promise });
  return { $, form, navBtns, attached, calls, win };
}

const click = (btn) => btn.handlers.click.forEach((fn) => fn());
const submit = async (env, ) => {
  const ev = { preventDefault() {}, target: env.form };
  for (const fn of env.form.handlers.submit) await fn(ev);
};

describe('نمایش شمسی در Mini App (S3-11d)', () => {
  test('تاریخچه: تاریخ رکوردها شمسی است (مرز کبیسه ۳۰ اسفند ۱۴۰۳ ← ۱ فروردین ۱۴۰۴) و ISO میلادی نمایش داده نمی‌شود', async () => {
    const records = [
      { record_date: '2025-03-20', status: 'normal', check_in_time: null, check_out_time: null },
      { record_date: '2025-03-21', status: 'late', check_in_time: null, check_out_time: null },
      { record_date: '2026-10-07 00:00:00', status: 'normal', check_in_time: null, check_out_time: null },
    ];
    const env = makeEnv({ routes: { '/history?days=30': records } });
    click(env.navBtns[0]);
    await flush();
    const list = env.$('#history-list');
    const out = list.children.map((c) => c.innerHTML);
    assert.equal(out.length, 3);
    assert.match(out[0], /<span>۳۰ اسفند ۱۴۰۳<\/span>/);
    assert.match(out[1], /<span>۱ فروردین ۱۴۰۴<\/span>/);
    assert.match(out[2], /<span>۱۵ مهر ۱۴۰۵<\/span>/);
    assert.ok(!out.join('').includes('2025-03'), 'تاریخ میلادی خام نباید دیده شود');
  });

  test('فهرست مرخصی: بازه‌ی «از تا» شمسی', async () => {
    const env = makeEnv({
      routes: { '/leave': [{ kind: 'mission', leave_type: 'mission', status: 'approved', start_date: '2026-10-07', end_date: '2026-10-09' }] },
    });
    click(env.navBtns[1]);
    await flush();
    const html1 = env.$('#leave-list').children.map((c) => c.innerHTML).join('');
    assert.match(html1, /۱۵ مهر ۱۴۰۵ تا ۱۷ مهر ۱۴۰۵/);
    assert.match(html1, /مأموریت/);
  });

  test('تاریخ سربرگ: روز هفته + روز + ماه شمسی «امروز» دستگاه', async () => {
    const env = makeEnv({
      telegram: true,
      routes: {
        '/me': { fullName: 'تست', role: 'employee' },
        '/today': { record: null, openBreak: null, breaks: [], summary: null },
      },
    });
    await flush();
    await flush();
    const d = new Date();
    const iso = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
    const j = J.isoToJalali(iso);
    assert.equal(env.$('#header-date').textContent, `${J.weekdayName(iso)} ${J.toFaDigits(j.jd)} ${J.MONTH_NAMES[j.jm - 1]}`);
    assert.match(env.$('#header-date').textContent, /[۰-۹]/);
  });

  test('اگر jalali.js بارگذاری نشود نمایش خراب نمی‌شود (جایگزین ICU با تقویم شمسی صریح)', async () => {
    const env = makeEnv({ jalali: false, dp: false, routes: { '/history?days=30': [{ record_date: '2026-10-07', status: 'normal' }] } });
    click(env.navBtns[0]);
    await flush();
    const row = env.$('#history-list').children[0].innerHTML;
    assert.match(row, /[۰-۹]/, 'ارقام فارسی');
    assert.ok(!row.includes('2026-10-07'));
  });
});

describe('ورودی شمسی فرم مرخصی (S3-11d)', () => {
  test('هر دو فیلد تاریخ datepicker می‌گیرند و type=date به text تبدیل می‌شود', () => {
    const env = makeEnv();
    assert.equal(env.attached.length, 2);
    assert.equal(env.form.startDate.type, 'text');
    assert.equal(env.form.endDate.type, 'text');
    assert.equal(env.attached[0].el, env.form.startDate);
    assert.equal(env.attached[1].el, env.form.endDate);
  });

  test('ارسال: مقدار میلادی ISO به سرور می‌رود، فرم و حالت datepicker پاک می‌شود', async () => {
    const env = makeEnv({ routes: { '/leave': { id: 1 } } });
    env.attached[0].val = '2026-10-03'; // کاربر ۱۴۰۵/۰۷/۱۱ را انتخاب کرده
    env.attached[1].val = '2026-10-05';
    env.form.reason.value = 'سفر';
    await submit(env);
    const post = env.calls.find((c) => c.init.method === 'POST');
    assert.ok(post && post.url.endsWith('/api/miniapp/leave'));
    assert.deepEqual(JSON.parse(post.init.body), { leaveType: 'leave', startDate: '2026-10-03', endDate: '2026-10-05', reason: 'سفر' });
    assert.equal(env.form.resetCalled, 1);
    assert.equal(env.attached[0].val, '');
    assert.equal(env.attached[1].val, '');
    assert.equal(env.$('#leave-msg').textContent, 'درخواست با موفقیت ارسال شد.');
  });

  test('تاریخ شمسی نامعتبر/خالی (مقدار ISO خالی) یا پایان قبل از شروع ⇒ هیچ درخواستی به سرور نمی‌رود', async () => {
    const env = makeEnv({ routes: { '/leave': { id: 1 } } });
    env.attached[0].val = '';            // مثلاً ۳۰ اسفند ۱۴۰۴ تایپ شده و رد شده
    env.attached[1].val = '2026-10-05';
    await submit(env);
    assert.equal(env.calls.filter((c) => c.init.method === 'POST').length, 0);
    assert.match(env.$('#leave-msg').textContent, /معتبر/);

    env.attached[0].val = '2026-10-06';
    env.attached[1].val = '2026-10-05';
    await submit(env);
    assert.equal(env.calls.filter((c) => c.init.method === 'POST').length, 0);
    assert.match(env.$('#leave-msg').textContent, /قبل از تاریخ شروع/);

    env.attached[1].val = '2026-10-06'; // یک‌روزه مجاز است
    await submit(env);
    assert.equal(env.calls.filter((c) => c.init.method === 'POST').length, 1);
  });

  test('بدون datepicker: input بومی date می‌ماند و مقدار آن (ISO) ارسال می‌شود', async () => {
    const env = makeEnv({ dp: false, routes: { '/leave': { id: 1 } } });
    assert.equal(env.form.startDate.type, 'date');
    env.form.startDate.value = '2026-10-03';
    env.form.endDate.value = '2026-10-04';
    await submit(env);
    const post = env.calls.find((c) => c.init.method === 'POST');
    assert.equal(JSON.parse(post.init.body).startDate, '2026-10-03');
  });
});

describe('ساختار صفحه و فایل‌های مشترک (S3-11d)', () => {
  test('index.html: datepicker.css قبل از style.css (تا تنظیمات Mini App غلبه کند)؛ jalali ← datepicker ← app', () => {
    const at = (s) => html.indexOf(s);
    assert.ok(at('/admin/css/datepicker.css') > 0 && at('/admin/css/datepicker.css') < at('/css/style.css'));
    assert.ok(at('/admin/js/jalali.js') > 0);
    assert.ok(at('/admin/js/jalali.js') < at('/admin/js/datepicker.js'));
    assert.ok(at('/admin/js/datepicker.js') < at('/js/app.js'));
    assert.ok(!/https?:\/\//.test(html.replace(/xmlns="[^"]*"/g, '')), 'بدون CDN/آدرس بیرونی');
  });

  test('app.js دیگر به ICU پیش‌فرض fa-IR برای تاریخ تکیه نمی‌کند', () => {
    assert.ok(!/toLocaleDateString\('fa-IR'[,)]/.test(appSrc));
    assert.ok(!/new Date\(dateStr\)/.test(appSrc), 'تبدیل UTC نیمه‌شب حذف شده است');
  });

  describe('سرو شدن از سرور واقعی', () => {
    let server; let base;
    before(async () => {
      resetDb();
      const { createApp } = require('../src/server');
      server = createApp().listen(0);
      await new Promise((r) => server.once('listening', r));
      base = `http://127.0.0.1:${server.address().port}`;
    });
    after(() => { server.close(); cleanup(); });

    test('/ و فایل‌های مشترک /admin/js و /admin/css با نوع درست سرو می‌شوند و CSP صفحه‌ی Mini App اجازه می‌دهد (script-src self)', async () => {
      const page = await fetch(`${base}/`);
      assert.equal(page.status, 200);
      assert.match(await page.text(), /\/admin\/js\/jalali\.js/);
      for (const [p, type] of [['/admin/js/jalali.js', /javascript/], ['/admin/js/datepicker.js', /javascript/], ['/admin/css/datepicker.css', /css/]]) {
        const r = await fetch(base + p);
        assert.equal(r.status, 200, p);
        assert.match(r.headers.get('content-type'), type, p);
      }
      // CSP_MODE پیش‌فرض report-only است (سیاست کامل در هدر Report-Only)؛ در enforce همان در هدر اصلی می‌آید
      const csp = `${page.headers.get('content-security-policy') || ''}; ${page.headers.get('content-security-policy-report-only') || ''}`;
      assert.match(csp, /script-src 'self'/);
    });
  });
});

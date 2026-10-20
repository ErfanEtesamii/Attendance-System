// M2 («وضعیت من»): صفحه‌ی views-mystatus.js — DOM ساختگی با vm (الگوی nextPlanUi) + بررسی ایستای اتصال به منو/روتر/CSS. مرورگر واقعی اجرا نمی‌شود.
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
  return { dataset: {}, disabled: false, listeners, addEventListener(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); }, click() { (listeners.click || []).forEach((fn) => fn({})); }, ...extra };
};

const DATES = ['2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23'];
const day = (date, o = {}) => ({
  date, jalali: '', weekday: 0, isToday: false, isFuture: false, kind: 'working', kindLabel: 'روز کاری', holidayTitle: null, override: null, leaves: [],
  schedule: { isWorkingDay: true, start: '07:30', end: '17:00', plannedMinutes: 570, shift: null },
  attendance: null, absent: false, monthClosed: false, tasks: [], review: { reviewed: false, reviews: [] }, ...o,
});
const WEEK = (o = {}) => ({
  ok: true, self: true, readOnly: true, plan: { id: 1, status: 'submitted' },
  summary: { attendance: { usefulMinutes: 1200, expectedMinutes: 2280, usefulPercent: 53, lateDays: 2, overtimeMinutes: 45, noReportDays: 0 }, tasks: { total: 5, done: 3, partial: 1, notDone: 1, completionPercent: 60, urgent: 0, selfUrgent: 0 }, closed: { allClosed: false, partlyClosed: false } },
  user: { id: 7, fullName: 'کاربر', role: 'employee' },
  week: { start: '2026-10-17', end: '2026-10-23', jalaliStart: '۱۴۰۵/۰۷/۲۵', jalaliEnd: '۱۴۰۵/۰۸/۰۱', prevWeekStart: '2026-10-10', nextWeekStart: '2026-10-24', isCurrentWeek: true, today: '2026-10-20' },
  days: DATES.map((d) => day(d, d === '2026-10-20' ? {
    isToday: true,
    attendance: { hasCheckIn: true, isOpen: true, checkIn: '2026-10-20 04:10:00', checkOut: null, effectiveMinutes: 125, lateMinutes: 10, earlyLeaveMinutes: 0, overtimeMinutes: 0 },
    tasks: [{ id: 1, title: 'تسک <b>x</b>', status: 'done' }, { id: 2, title: 'گزارش تیم', status: 'no_answer', isSystem: true, systemKey: 'review_team_reports' }],
  } : {})),
  ...o,
});
const NEXT = { ...WEEK(), plan: { id: 2, status: 'draft' }, week: { ...WEEK().week, start: '2026-10-24' } };

function setup({ cur = WEEK(), next = NEXT, prev = null, nextFail = false, perms = ['me.read', 'team.week_view', 'schedule.manage', 'tasks.assign_urgent', 'reviews.write'] } = {}) {
  const urls = []; const gos = []; let refreshes = 0;
  const AP = {
    views: {}, nav: [], state: { me: { id: 7, role: 'employee' } },
    can: (...p) => p.every((x) => perms.includes(x)),
    esc, icon: () => '', badge: (cls, text) => `<span class="badge ${esc(cls)}">${esc(text)}</span>`, avatar: (n) => `<span>${esc(n)}</span>`,
    ROLE: { admin: 'ادمین', manager: 'سرپرست', employee: 'کارمند', hr: 'منابع انسانی' },
    fmt: { num: (n) => (n == null ? '—' : String(n)), min: (n) => `${n}د`, clock: (v) => `T:${v}`, date: (v) => `D:${v}`, dateLong: (v) => `L:${v}` },
    $: (s, r) => (r && r.querySelector ? r.querySelector(s) : null),
    $$: (s, r) => (r && r.querySelectorAll ? Array.from(r.querySelectorAll(s)) : []),
    view(id, def) { AP.views[id] = def; if (def.nav) AP.nav.push({ id, ...def.nav }); },
    go: (id, p) => gos.push([id, p]), refresh: () => { refreshes += 1; },
    attempt: async () => true, askReason: async () => null, toast() {},
    api: async (url) => {
      urls.push(url);
      if (url === '/admin/me/week') return cur;
      if (url === `/admin/me/week?start=${cur.week.nextWeekStart}`) { if (nextFail) throw new Error('boom'); return next; }
      if (url.startsWith('/admin/me/week?start=') && prev) return prev;
      throw new Error(`مسیر پیش‌بینی‌نشده: ${url}`);
    },
  };
  const window = { AP };
  const ctx = { window, encodeURIComponent, Date, Number, String, Array, Object, Promise, Math };
  vm.runInNewContext(read('public-admin/js/views-weekly.js'), ctx, { filename: 'views-weekly.js' });
  vm.runInNewContext(read('public-admin/js/views-mystatus.js'), ctx, { filename: 'views-mystatus.js' });
  return { AP, def: AP.views.mystatus, urls, gos, refreshes: () => refreshes, ui: AP.myStatus.ui };
}

describe('ثبت صفحه', () => {
  test('perm = me.read (همه‌ی نقش‌ها)، skeleton، و در M2 ورودی منوی عمومی ندارد', () => {
    const { def, AP } = setup();
    assert.equal(def.perm, 'me.read');
    assert.equal(def.skeleton, 'plan');
    assert.equal(AP.nav.length, 0);
  });
  test('فقط مسیرهای /admin/me/week؛ هیچ شناسه‌ی کاربری به API نمی‌رود', () => {
    const src = read('public-admin/js/views-mystatus.js');
    assert.doesNotMatch(src, /\/admin\/users\//);
    assert.doesNotMatch(src, /\/miniapp\//);
    assert.doesNotMatch(src, /userId/);
  });
});

describe('render', () => {
  test('هفته‌ی جاری + هفته‌ی بعد از /admin/me/week؛ KPI، امروز، نشان برنامه‌ی بعد و ۷ کارت روز', async () => {
    const { def, urls } = setup();
    const { html } = await def.render();
    assert.deepEqual(urls, ['/admin/me/week', '/admin/me/week?start=2026-10-24']);
    assert.match(html, /وضعیت من/);
    assert.match(html, /1200د/); assert.match(html, /از 2280د مورد انتظار \(53٪\)/);
    assert.match(html, /روز تأخیر/); assert.match(html, /اضافه‌کاری/); assert.match(html, /تکمیل تسک‌ها/);
    assert.match(html, /امروز · D:2026-10-20/);
    assert.match(html, /حاضر/); assert.match(html, /<bdi>07:30–17:00<\/bdi>/); assert.match(html, /125د/); assert.match(html, /هنوز خارج نشده/);
    assert.match(html, /پیش‌نویس/); // برنامه‌ی هفته‌ی بعد
    assert.equal((html.match(/class="card day-card/g) || []).length, 7);
    assert.match(html, /این هفته/);
  });
  test('فقط‌خواندنی: دکمه‌های مدیریتی کارت روز حتی با همه‌ی مجوزها ساخته نمی‌شود', async () => {
    const { def } = setup();
    const { html } = await def.render();
    assert.doesNotMatch(html, /data-act="(urgent|schedule|seen)"/);
    assert.doesNotMatch(html, /day-card-actions/);
  });
  test('عنوان تسک escape می‌شود و تسک واجب نشان 🔒 دارد', async () => {
    const { html } = await setup().def.render();
    assert.doesNotMatch(html, /<b>x<\/b>/);
    assert.match(html, /تسک &lt;b&gt;x&lt;\/b&gt;/);
    assert.match(html, /🔒 واجب/);
  });
  test('لینک دفترچه فقط با team.week_view', async () => {
    assert.match((await setup().def.render()).html, /data-go="nextplan"/);
    assert.doesNotMatch((await setup({ perms: ['me.read'] }).def.render()).html, /data-go="nextplan"/);
  });
  test('خطای هفته‌ی بعد صفحه را نمی‌شکند؛ پیام جایگزین', async () => {
    const { html } = await setup({ nextFail: true }).def.render();
    assert.match(html, /وضعیت برنامه‌ی هفته‌ی بعد در دسترس نیست/);
    assert.equal((html.match(/class="card day-card/g) || []).length, 7);
  });
  test('خطای هفته‌ی جاری به روتر پرتاب می‌شود (صفحه‌ی خطا + تلاش دوباره)', async () => {
    const { AP, def } = setup();
    AP.api = async () => { throw new Error('قطع'); };
    await assert.rejects(def.render(), /قطع/);
  });
  test('امروز غیرکاری: فقط وضعیت، بدون ساعت ورود/خروج؛ بدون تسک ⇒ پیام خالی', async () => {
    const cur = WEEK(); cur.days = cur.days.map((d) => (d.isToday ? { ...d, kind: 'holiday', holidayTitle: 'عید', schedule: { ...d.schedule, isWorkingDay: false }, attendance: null, tasks: [] } : d));
    const { html } = await setup({ cur }).def.render();
    assert.match(html, /تعطیل/); assert.match(html, /عید/);
    assert.doesNotMatch(html, /ساعت مفید تا الان/);
    assert.match(html, /برای امروز تسکی ثبت نشده است/);
  });
});

describe('ناوبری هفته', () => {
  test('هفته‌ی قبل: start به API می‌رود، عنوان «هفته‌ی قبل»، دکمه‌ی «هفته‌ی جاری» فعال', async () => {
    const prev = WEEK({ week: { ...WEEK().week, start: '2026-10-10', end: '2026-10-16', isCurrentWeek: false, prevWeekStart: '2026-10-03' } });
    const s = setup({ prev });
    s.ui.start = '2026-10-10';
    const { html } = await s.def.render();
    assert.ok(s.urls.includes('/admin/me/week?start=2026-10-10'));
    assert.match(html, /هفته‌ی قبل · /);
    assert.match(html, /data-week-nav="2026-10-20" >/); // «هفته‌ی جاری» غیرفعال نیست
    assert.match(html, /روزهای هفته‌ی قبل/);
  });
  test('کلیک ناوبری ui.start را می‌گذارد و refresh می‌کند؛ دکمه‌ی غیرفعال اثر ندارد', async () => {
    const s = setup();
    const { mount } = await s.def.render();
    const b1 = makeEl({ dataset: { weekNav: '2026-10-10' } });
    const b2 = makeEl({ dataset: { weekNav: '2026-10-20' }, disabled: true });
    const go = makeEl({ dataset: { go: 'nextplan' } });
    const rv = makeEl({ dataset: { act: 'open-reviews', date: '2026-10-19' } });
    const multi = { '[data-go]': [go], '[data-week-nav]': [b1, b2], '[data-act="open-reviews"]': [rv] };
    mount({ querySelectorAll: (q) => multi[q] || [], querySelector: () => null });
    b2.click(); assert.equal(s.refreshes(), 0);
    b1.click(); assert.equal(s.ui.start, '2026-10-10'); assert.equal(s.refreshes(), 1);
    go.click(); rv.click();
    assert.deepEqual(s.gos, [['nextplan', undefined], ['teamreports', '2026-10-19']]);
  });
});

describe('todayStatus', () => {
  const { AP } = setup();
  const st = (d) => AP.myStatus.todayStatus(d)[1];
  test('حالت‌ها', () => {
    assert.equal(st(day('x', { attendance: null })), 'هنوز ورود نزده');
    assert.equal(st(day('x', { attendance: { hasCheckIn: true, isOpen: true } })), 'حاضر');
    assert.equal(st(day('x', { attendance: { hasCheckIn: true, isOpen: false } })), 'خروج ثبت شده');
    assert.equal(st(day('x', { kind: 'leave' })), 'مرخصی');
    assert.equal(st(day('x', { kind: 'mission' })), 'مأموریت');
    assert.equal(st(day('x', { kind: 'off' })), 'غیرکاری');
    assert.equal(st(null), '—');
  });
});

describe('اتصال به پنل (ایستا)', () => {
  test('index.html: اسکریپت بعد از views-weekly و قبل از bell', () => {
    const h = read('public-admin/index.html');
    const i = (n) => h.indexOf(`/admin/js/${n}.js`);
    assert.ok(i('views-weekly') > 0 && i('views-weekly') < i('views-mystatus') && i('views-mystatus') < i('bell'));
  });
  test('core.js: برای selfOnly اولین آیتم «پنل من» و صفحه‌ی پیش‌فرض بعد از ورود', () => {
    const c = read('public-admin/js/core.js');
    assert.match(c, /AP\.selfOnly\(\) && AP\.viewAllowed\(AP\.views\.mystatus\)\) return \{ id: 'mystatus'/);
    assert.match(c, /items\.unshift\(\{ id: 'mystatus', icon: 'attendance', label: 'وضعیت من', group: 'پنل من' \}\)/);
    assert.ok(c.indexOf("id: 'mystatus', icon") > c.indexOf("label: 'پروفایل من'")); // unshift دوم ⇒ بالاتر از «پروفایل من»
  });
  test('CSS: شبکه‌ی ریسپانسیو بدون اسکرول افقی و متن قابل شکستن؛ بدون رنگ سخت‌کد', () => {
    const css = read('public-admin/css/style.css');
    const block = css.slice(css.indexOf('/* M2:'), css.indexOf('.ms-section-title'));
    assert.match(block, /\.ms-top \{[^}]*minmax\(min\(100%, 300px\), 1fr\)/);
    assert.match(block, /\.ms-row dd \{[^}]*min-width: 0; overflow-wrap: anywhere/);
    assert.match(block, /\.ms-task-title \{[^}]*overflow-wrap: anywhere/);
    assert.doesNotMatch(block, /#[0-9a-fA-F]{3,8}\b|rgba?\(/);
  });
});

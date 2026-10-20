// M2/M3 («وضعیت من»): صفحه‌ی views-mystatus.js — DOM ساختگی با vm (الگوی nextPlanUi) + بررسی ایستای اتصال به منو/روتر/CSS. مرورگر واقعی اجرا نمی‌شود.
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
// M3: خروجیِ GET /admin/me/tasks/today (taskReportService.getDailyTasks)
const DAILY = (o = {}) => ({
  ok: true, date: '2026-10-20', today: '2026-10-20', late: false, source: 'normal', mode: 'enforce', fullDayOff: false,
  progress: { done: 1, total: 3, percent: 33 },
  tasks: [
    { id: 1, title: 'تسک <b>x</b>', priority: 'normal', isSystem: false, systemKey: null, isUrgent: false, optional: false },
    { id: 2, title: 'گزارش تیم', priority: 'high', isSystem: true, systemKey: 'review_team_reports', isUrgent: false, optional: false },
    { id: 5, title: 'فوری', priority: 'high', isSystem: false, isUrgent: true, optional: false },
  ],
  answered: [
    { taskId: 3, title: 'انجام‌شده', status: 'done', note: 'یادداشت', canUndo: true, isSystem: false, answeredLate: true },
    { taskId: 4, title: 'سیستمی پاسخ‌داده', status: 'not_done', reasonCode: 'no_time', canUndo: false, isSystem: true },
  ],
  reasonCodes: ['no_time', 'needs_more_time', 'blocked_by_others', 'priority_changed', 'technical_issue', 'other'],
  ...o,
});
const BACKFILL = { ok: true, mode: 'enforce', backfillDays: 2, days: [{ date: '2026-10-19', source: 'backfill', pendingCount: 2, titles: ['الف', 'ب'] }] };

function setup({ cur = WEEK(), next = NEXT, prev = null, nextFail = false, daily = DAILY(), backfill = BACKFILL, dailyFail = false, perms = ['me.read', 'team.week_view', 'schedule.manage', 'tasks.assign_urgent', 'reviews.write'] } = {}) {
  const urls = []; const gos = []; const calls = []; const toasts = []; const modals = []; let refreshes = 0; let dailyNow = daily;
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
    attempt: async (fn) => { try { const r = await fn(); return r === undefined ? true : r; } catch (_) { return false; } },
    askReason: async () => null, toast: (m, e) => toasts.push([m, !!e]),
    formData: (f) => f.values || {}, modal: (def) => { const m = { def, closed: false, close() { m.closed = true; } }; modals.push(m); return m; },
    api: async (url, opts) => {
      urls.push(url);
      if (opts && opts.method) calls.push({ url, method: opts.method, body: opts.body });
      if (url.startsWith('/admin/me/tasks/today')) { if (dailyFail) throw new Error('قطع'); return dailyNow; }
      if (url === '/admin/me/tasks/backfill') return backfill;
      if (url.startsWith('/admin/me/tasks/') && opts && opts.method) return { ok: true };
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
  return { AP, def: AP.views.mystatus, urls, gos, calls, toasts, modals, setDaily: (d) => { dailyNow = d; }, refreshes: () => refreshes, ui: AP.myStatus.ui };
}

describe('ثبت صفحه', () => {
  test('perm = me.read (همه‌ی نقش‌ها)، skeleton، و در M2 ورودی منوی عمومی ندارد', () => {
    const { def, AP } = setup();
    assert.equal(def.perm, 'me.read');
    assert.equal(def.skeleton, 'plan');
    assert.equal(AP.nav.length, 0);
  });
  test('فقط مسیرهای /admin/me/*؛ هیچ شناسه‌ی کاربری به API نمی‌رود', () => {
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
    assert.deepEqual(urls, ['/admin/me/week', '/admin/me/week?start=2026-10-24', '/admin/me/tasks/today', '/admin/me/tasks/backfill', '/admin/me/urgent/config']);
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
    const { html } = await setup({ cur, daily: DAILY({ tasks: [], answered: [], progress: { done: 0, total: 0, percent: null } }) }).def.render();
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

// ---------- M3: تیک‌زدن تسک‌ها ----------
const countOf = (html, re) => (html.match(re) || []).length;
function fakePage(map = {}) {
  const live = { innerHTML: '', querySelectorAll: (q) => map[q] || [], querySelector: () => null };
  return { live, page: { querySelector: (q) => (q === '#ms-live' ? live : null), querySelectorAll: () => [] } };
}
const btn = (dataset) => makeEl({ dataset });
const flush = () => new Promise((r) => setImmediate(r));
const plain = (v) => JSON.parse(JSON.stringify(v)); // اشیای ساخته‌شده در vm پروتوتایپ دیگری دارند ⇒ برای deepEqual ساده‌سازی

describe('M3: فهرست تعاملی تسک‌های امروز', () => {
  test('تسک عادی و فوری سه دکمه دارند؛ تسک سیستمی/واجب بدون دکمه و با 🔒 فقط‌خواندنی', async () => {
    const { html } = await setup().def.render();
    assert.equal(countOf(html, /data-act="answer"/g), 6); // ۲ تسک عادی/فوری × ۳ دکمه
    assert.equal(countOf(html, /data-act="answer" data-status="done" data-task="1"/g), 1);
    assert.equal(countOf(html, /data-act="answer" data-status="partial" data-task="1"/g), 1);
    assert.equal(countOf(html, /data-act="answer" data-status="not_done" data-task="1"/g), 1);
    assert.doesNotMatch(html, /data-act="answer"[^>]*data-task="2"/); // تسک سیستمی
    assert.match(html, /فقط‌خواندنی؛ وضعیت این تسک از پنل قابل تغییر نیست/);
    assert.match(html, /⚡ فوری/);
    assert.match(html, /انجام شد/); assert.match(html, /ناقص/); assert.match(html, /انجام نشد/);
  });
  test('پیشرفت و فهرست پاسخ‌داده‌شده: برداشتن تیک/توضیح فقط برای غیرسیستمی؛ دیرهنگام نشان دارد', async () => {
    const { html } = await setup().def.render();
    assert.match(html, /1 از 3 \(33٪\)/);
    assert.match(html, /data-act="undo" data-task="3"/);
    assert.match(html, /data-act="note" data-task="3"[^>]*>ویرایش توضیح/);
    assert.doesNotMatch(html, /data-act="(undo|note)" data-task="4"/); // تسک سیستمی پاسخ‌داده‌شده
    assert.match(html, /پاسخ دیرهنگام/);
    assert.match(html, /علت: وقت نشد/); assert.match(html, /توضیح انجام: یادداشت/);
  });
  test('فقط «انجام‌شده» دکمه‌ی توضیح دارد؛ بدون توضیح ⇒ «افزودن توضیح»', async () => {
    const daily = DAILY({ answered: [{ taskId: 8, title: 'الف', status: 'done', canUndo: true }, { taskId: 9, title: 'ب', status: 'partial', reasonCode: 'other', reasonText: 'متن علت', canUndo: true }] });
    const { html } = await setup({ daily }).def.render();
    assert.match(html, /data-act="note" data-task="8"[^>]*>افزودن توضیح/);
    assert.doesNotMatch(html, /data-act="note" data-task="9"/);
    assert.match(html, /data-act="undo" data-task="9"/);
    assert.match(html, /علت: متن علت/);
  });
  test('مرخصی تمام‌روز: پیام مناسب و بدون پیام «تسکی ثبت نشده»', async () => {
    const { html } = await setup({ daily: DAILY({ fullDayOff: true, tasks: [], answered: [] }) }).def.render();
    assert.match(html, /مرخصی\/مأموریت تمام‌روز است/);
    assert.doesNotMatch(html, /برای امروز تسکی ثبت نشده است/);
  });
  test('خطای فهرست تعاملی صفحه را نمی‌شکند: پیام + فهرست فقط‌خواندنی از هفته', async () => {
    const { html } = await setup({ dailyFail: true }).def.render();
    assert.match(html, /ثبت وضعیت تسک‌ها اکنون در دسترس نیست: قطع/);
    assert.doesNotMatch(html, /data-act="answer"/);
    assert.match(html, /تسک &lt;b&gt;x&lt;\/b&gt;/);
    assert.equal(countOf(html, /class="card day-card/g), 7);
  });
  test('عنوان تسک و علت escape می‌شوند (XSS)', async () => {
    const daily = DAILY({ tasks: [{ id: 1, title: '<img src=x onerror=1>', isSystem: false }], answered: [{ taskId: 3, title: 'ok', status: 'not_done', reasonText: '<script>1</script>', canUndo: true }] });
    const { html } = await setup({ daily }).def.render();
    assert.doesNotMatch(html, /<img src=x|<script>1/);
    assert.match(html, /&lt;img src=x onerror=1&gt;/);
  });
});

describe('M3: گزارش دیرهنگام', () => {
  test('روزهای قابل تکمیل با دکمه؛ بدون backfill بخش نمی‌آید', async () => {
    const { html } = await setup().def.render();
    assert.match(html, /گزارش دیرهنگام/);
    assert.match(html, /data-act="late-day" data-date="2026-10-19"/);
    assert.match(html, /2 تسک بدون پاسخ/);
    assert.doesNotMatch(html, /data-act="late-back"/);
    assert.doesNotMatch((await setup({ backfill: { ok: true, days: [] } }).def.render()).html, /گزارش دیرهنگام/);
    assert.doesNotMatch((await setup({ backfill: null }).def.render()).html, /data-act="late-day"/);
  });
  test('روزِ جاریِ دیرهنگام (بعد از خروج) در فهرست backfill تکرار نمی‌شود، ولی برچسب دیرهنگام دارد', async () => {
    const backfill = { ok: true, days: [{ date: '2026-10-20', source: 'after_checkout', pendingCount: 1, titles: ['ز'] }] };
    const { html } = await setup({ daily: DAILY({ late: true, source: 'after_checkout' }), backfill }).def.render();
    assert.doesNotMatch(html, /data-act="late-day"/);
    assert.match(html, /با برچسب «پاسخ دیرهنگام» ثبت می‌شوند/);
  });
  test('حالت روزِ گذشته: عنوان با تاریخ، دکمه‌ی «بازگشت به امروز»، و درخواست با ?date=', async () => {
    const s = setup({ daily: DAILY({ date: '2026-10-19', late: true, source: 'backfill' }) });
    s.ui.taskDate = '2026-10-19';
    const { html } = await s.def.render();
    assert.ok(s.urls.includes('/admin/me/tasks/today?date=2026-10-19'));
    assert.match(html, /تسک‌های D:2026-10-19 \(گزارش دیرهنگام\)/);
    assert.match(html, /data-act="late-back"/);
    s.ui.taskDate = '';
  });
  test('مهلت روزِ گذشته تمام شده (خطا) ⇒ ui.taskDate پاک و امروز نمایش داده می‌شود', async () => {
    const s = setup();
    s.ui.taskDate = '2026-10-10';
    const orig = s.AP.api;
    s.AP.api = async (url, o) => { if (url === '/admin/me/tasks/today?date=2026-10-10') throw new Error('مهلت تمام'); return orig(url, o); };
    const { html } = await s.def.render();
    assert.equal(s.ui.taskDate, '');
    assert.match(html, /تسک‌های امروز/);
  });
});

describe('M3: اکشن‌ها (سرور فقط با نشست؛ بدنه بدون شناسه‌ی کاربر)', () => {
  async function mounted(opts) {
    const s = setup(opts);
    const { html, mount } = await s.def.render();
    const done = btn({ act: 'answer', status: 'done', task: '1' });
    const partial = btn({ act: 'answer', status: 'partial', task: '1' });
    const undo = btn({ act: 'undo', task: '3' });
    const note = btn({ act: 'note', task: '3' });
    const lateDay = btn({ act: 'late-day', date: '2026-10-19' });
    const lateBack = btn({ act: 'late-back' });
    const { live, page } = fakePage({ '[data-act="answer"]': [done, partial], '[data-act="undo"]': [undo], '[data-act="note"]': [note], '[data-act="late-day"]': [lateDay], '[data-act="late-back"]': [lateBack] });
    mount(page);
    return { s, html, live, done, partial, undo, note, lateDay, lateBack };
  }

  test('«انجام شد»: POST /answer با {taskId,status,date}؛ سپس ناحیه‌ی زنده از سرور بازسازی می‌شود', async () => {
    const { s, done, live } = await mounted();
    const before = s.urls.length;
    done.click(); await flush(); await flush();
    assert.deepEqual(plain(s.calls), [{ url: '/admin/me/tasks/answer', method: 'POST', body: { taskId: 1, status: 'done', date: '2026-10-20' } }]);
    assert.ok(s.urls.slice(before).includes('/admin/me/week'), 'KPI/هفته دوباره خوانده شد');
    assert.ok(s.urls.slice(before).includes('/admin/me/tasks/today'));
    assert.match(live.innerHTML, /وضعیت من|ساعت مفید/); // محتوای تازه جایگزین شد
    assert.equal(s.refreshes(), 0, 'بدون رفرش کامل');
  });
  test('«ناقص»: مودال علت باز می‌شود (بدون ارسال)؛ علت خالی/«سایر» کوتاه ⇒ پیام و بدون POST؛ معتبر ⇒ POST و بسته شدن', async () => {
    const { s, partial } = await mounted();
    partial.click(); await flush();
    assert.equal(s.calls.length, 0);
    assert.equal(s.modals.length, 1);
    const m = s.modals[0];
    assert.match(m.def.title, /^ناقص: /);
    assert.match(m.def.body, /<option value="no_time">وقت نشد<\/option>/);
    assert.match(m.def.body, /<option value="other">سایر<\/option>/);
    assert.match(m.def.body, /<select name="reasonCode" required>/);
    const msg = { textContent: '' }; const cancel = makeEl(); const submit = {};
    const form = { values: { reasonCode: '', reasonText: '' }, listeners: {}, addEventListener(ev, fn) { this.listeners[ev] = fn; }, querySelector: (q) => ({ '[data-cancel]': cancel, '.form-msg': msg, 'button[type=submit]': submit }[q] || null) };
    m.def.onMount({ querySelector: (q) => (q === '#ms-reason-form' ? form : null) }, m);
    await form.listeners.submit({ preventDefault() {} });
    assert.equal(msg.textContent, 'علت را انتخاب کنید.'); assert.equal(s.calls.length, 0);
    form.values = { reasonCode: 'other', reasonText: 'کم' };
    await form.listeners.submit({ preventDefault() {} });
    assert.match(msg.textContent, /حداقل ۵ نویسه/); assert.equal(s.calls.length, 0);
    form.values = { reasonCode: 'no_time', reasonText: ' زمان کم بود ' };
    await form.listeners.submit({ preventDefault() {} });
    assert.deepEqual(plain(s.calls), [{ url: '/admin/me/tasks/answer', method: 'POST', body: { taskId: 1, status: 'partial', date: '2026-10-20', reasonCode: 'no_time', reasonText: 'زمان کم بود' } }]);
    assert.equal(m.closed, true);
    cancel.click(); // دکمه‌ی انصراف مودال را می‌بندد
  });
  test('«برداشتن تیک»: POST /undo با {taskId,date}', async () => {
    const { s, undo } = await mounted();
    undo.click(); await flush(); await flush();
    assert.deepEqual(plain(s.calls), [{ url: '/admin/me/tasks/undo', method: 'POST', body: { taskId: 3, date: '2026-10-20' } }]);
  });
  test('توضیح انجام: مودال با مقدار فعلی؛ ذخیره ⇒ PATCH /note (خالی ⇒ پاک کردن)', async () => {
    const { s, note } = await mounted();
    note.click(); await flush();
    const m = s.modals[0];
    assert.match(m.def.title, /^توضیح انجام: /);
    assert.match(m.def.body, />یادداشت<\/textarea>/);
    assert.match(m.def.body, /maxlength="500"/);
    const form = { values: { note: '' }, listeners: {}, addEventListener(ev, fn) { this.listeners[ev] = fn; }, querySelector: (q) => (q === '[data-cancel]' ? makeEl() : (q === 'button[type=submit]' ? {} : null)) };
    m.def.onMount({ querySelector: (q) => (q === '#ms-note-form' ? form : null) }, m);
    await form.listeners.submit({ preventDefault() {} });
    assert.deepEqual(plain(s.calls), [{ url: '/admin/me/tasks/note', method: 'PATCH', body: { taskId: 3, date: '2026-10-20', note: '' } }]);
    assert.equal(m.closed, true);
  });
  test('خطای سرور (مثلاً ماه بسته) ⇒ ناحیه‌ی زنده بازسازی نمی‌شود و مودال باز می‌ماند', async () => {
    const { s, partial } = await mounted();
    const orig = s.AP.api;
    s.AP.api = async (url, o) => { if (o && o.method === 'POST') throw new Error('ماه بسته است'); return orig(url, o); };
    partial.click(); await flush();
    const m = s.modals[0]; const form = { values: { reasonCode: 'no_time', reasonText: '' }, listeners: {}, addEventListener(ev, fn) { this.listeners[ev] = fn; }, querySelector: (q) => (q === '[data-cancel]' ? makeEl() : (q === '.form-msg' ? { textContent: '' } : {})) };
    m.def.onMount({ querySelector: (q) => (q === '#ms-reason-form' ? form : null) }, m);
    const before = s.urls.length;
    await form.listeners.submit({ preventDefault() {} });
    assert.equal(m.closed, false);
    assert.equal(s.urls.length, before, 'بعد از خطا دوباره خوانده نمی‌شود');
  });
  test('گزارش دیرهنگام: «تکمیل گزارش» ui.taskDate را می‌گذارد و فهرست آن روز را می‌خواند؛ «بازگشت» پاک می‌کند', async () => {
    const { s, lateDay, lateBack } = await mounted();
    s.setDaily(DAILY({ date: '2026-10-19', late: true, source: 'backfill' }));
    lateDay.click(); await flush(); await flush();
    assert.equal(s.ui.taskDate, '2026-10-19');
    assert.ok(s.urls.includes('/admin/me/tasks/today?date=2026-10-19'));
    s.setDaily(DAILY());
    lateBack.click(); await flush(); await flush();
    assert.equal(s.ui.taskDate, '');
  });
  test('روی تسکِ ناموجود یا فهرست ناموفق هیچ درخواستی نمی‌رود', async () => {
    const { s, done } = await mounted({ dailyFail: true });
    done.click(); await flush();
    assert.equal(s.calls.length, 0);
  });
});

describe('M3: توابع خالص', () => {
  const { AP } = setup();
  const { answerBody, reasonError } = AP.myStatus;
  test('answerBody: done بدون علت؛ partial/not_done با علت؛ بدون هیچ فیلد کاربر', () => {
    assert.deepEqual(plain(answerBody('4', 'done', '2026-10-20', { reasonCode: 'no_time' })), { taskId: 4, status: 'done', date: '2026-10-20' });
    assert.deepEqual(plain(answerBody(4, 'not_done', '2026-10-20', { reasonCode: 'other', reasonText: '  متن  ' })), { taskId: 4, status: 'not_done', date: '2026-10-20', reasonCode: 'other', reasonText: 'متن' });
    assert.equal('reasonText' in answerBody(4, 'partial', 'd', { reasonCode: 'no_time', reasonText: '   ' }), false);
    assert.equal('userId' in answerBody(4, 'done', 'd'), false);
  });
  test('reasonError', () => {
    assert.match(reasonError('', ''), /علت را انتخاب/);
    assert.match(reasonError('other', 'abc'), /حداقل ۵/);
    assert.equal(reasonError('other', 'abcde'), '');
    assert.equal(reasonError('no_time', ''), '');
    assert.match(reasonError('no_time', 'x'.repeat(301)), /حداکثر/);
  });
  test('منبع: فقط مسیرهای /admin/me/tasks/*؛ بدون userId، /miniapp و /admin/users', () => {
    const src = read('public-admin/js/views-mystatus.js');
    assert.match(src, /\/admin\/me\/tasks\//);
    assert.doesNotMatch(src, /\/miniapp\/|\/admin\/users\/|userId/);
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
    assert.match(c, /const mine = \{ id: 'mystatus', icon: 'attendance', label: 'وضعیت من', group: 'پنل من', counter: true \}/); // M4: نشان شمارنده
    assert.match(c, /if \(AP\.selfOnly\(\)\) items\.unshift\(mine\); else items\.push\(mine\)/);
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

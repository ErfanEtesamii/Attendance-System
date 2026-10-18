// C2 (فاز ۱۵): بازطراحی «برنامه‌ی هفتگی» — کادرهای رنگی pl-day، تخته‌ی هفته‌ی جاری با تیک مستقیم (week-board + daily-report + undo)، هفته‌ی بعد بدون تیک.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const appSrc = read('public/js/app.js');
const flush = () => new Promise((r) => setTimeout(r, 15));

class Node_ {
  constructor(tag) { this.tag = tag; this.children = []; this.handlers = {}; this._text = ''; this.className = ''; this.dataset = {}; this.style = {}; this.hidden = false; this.value = ''; this.disabled = false; this.attrs = {}; this.classList = { add() {}, remove() {}, toggle() {} }; }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  set innerHTML(v) { this.children = []; this._text = ''; }
  get innerHTML() { return ''; }
  addEventListener(t, fn) { (this.handlers[t] = this.handlers[t] || []).push(fn); }
  appendChild(c) { this.children.push(c); return c; }
  setAttribute(k, v) { this.attrs[k] = v; } removeAttribute() {} get isConnected() { return true; }
  focus() { Node_.focused = this; }
  querySelector() { return null; }
  fire(t, ev = {}) { return Promise.all((this.handlers[t] || []).map((fn) => fn({ preventDefault() {}, target: this, ...ev }))); }
}
const walk = (n, out = []) => { out.push(n); (n.children || []).forEach((c) => walk(c, out)); return out; };

// هفته‌ی چهارشنبه‌محور: امروز = ۲۰۲۷-۰۵-۰۶ (پنجشنبه)
const DATES = ['2027-05-05', '2027-05-06', '2027-05-07', '2027-05-08', '2027-05-09', '2027-05-10', '2027-05-11'];
const TODAY = '2027-05-06';
const mkTask = (id, title, extra = {}) => ({ id, title, description: '', priority: 'normal', plannedDate: null, source: 'plan', isUrgent: false, managerLocked: false, isSystem: false, outOfPlan: false, status: 'pending', note: null, canUndo: false, carryCount: 0, ...extra });
function makeBoard(over = {}) {
  const days = DATES.map((date, i) => ({ date, kind: i === 2 ? 'weekend' : 'working', isWorkingDay: i !== 2, holidayTitle: null, hours: i === 2 ? null : { startTime: '08:00', endTime: '16:00' }, isToday: date === TODAY, isFuture: date > TODAY, done: 0, total: 0, tasks: [] }));
  const board = { ok: true, week: 'current', weekStart: DATES[0], weekEnd: DATES[6], today: TODAY, planStatus: 'submitted', hasPlan: true, progress: { done: 0, total: 0, percent: null }, days };
  return Object.assign(board, over);
}
const day = (b, date) => b.days.find((d) => d.date === date);

function makeEnv({ board, planOver = {}, week = 'current', post = {} } = {}) {
  const els = new Map();
  const $ = (sel) => { if (!els.has(sel)) els.set(sel, new Node_(sel)); return els.get(sel); };
  const nav = Object.assign(new Node_('nav'), { dataset: { view: 'plan' } });
  const document = { querySelector: $, querySelectorAll: () => [nav], createElement: (t) => new Node_(t), createTextNode: (t) => { const n = new Node_('#text'); n._text = t; return n; } };
  const calls = [];
  const state = { board };
  const plan = { ok: true, week, weekStart: DATES[0], weekEnd: DATES[6], planDay: null, status: 'submitted', editMode: week === 'current' ? 'readonly' : 'free', lockReason: week === 'current' ? 'week_started' : null, minTasks: 0, maxTasks: null, tasks: [], carryOver: [], previousWeekTasks: [], frequentTitles: [], supervisorComment: null, days: [], ...planOver };
  const fetchStub = async (url, init = {}) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
    const m = init.method || 'GET';
    const key = `${m} ${url.replace('/api/miniapp', '').split('?')[0]}`;
    if (post[key]) { const r = typeof post[key] === 'function' ? post[key](calls[calls.length - 1]) : post[key]; return { ok: r.ok !== false, status: r.status || 200, json: async () => r.json || {} }; }
    if (url.includes('/week-board')) return { ok: true, status: 200, json: async () => state.board };
    if (m !== 'GET') return { ok: true, status: 200, json: async () => ({ ok: true }) };
    return { ok: true, status: 200, json: async () => plan };
  };
  const window = { location: { search: '' }, Telegram: undefined, Planner: require('../public/js/planner.js') };
  const ctx = { window, document, fetch: fetchStub, console, setTimeout, clearTimeout, setInterval, clearInterval, Date, Intl, JSON, Promise, encodeURIComponent, URLSearchParams };
  vm.runInNewContext(appSrc, ctx);
  return { $, nav, calls, state, body: () => $('#plan-body'), weeks: () => $('#plan-weeks') };
}
const open = async (env, week = 'current') => { // پیش‌فرضِ برنامه «هفته‌ی بعد» است؛ برای تخته‌ی جاری از انتخابگر «این هفته» می‌رویم
  await env.nav.fire('click'); await flush();
  if (week === 'current') { await env.weeks().children[0].fire('click'); await flush(); }
};
const days = (env) => walk(env.body()).filter((n) => n.tag === 'section' && /pl-day/.test(n.className));
const checks = (node) => walk(node).filter((n) => n.attrs && n.attrs.role === 'checkbox');
const rowOf = (env, title) => walk(env.body()).find((n) => n.tag === 'li' && /pl-row/.test(n.className) && n.textContent.includes(title));

describe('تخته‌ی هفته‌ی جاری (C2)', () => {
  const board = () => {
    const b = makeBoard();
    day(b, '2027-05-05').tasks = [mkTask(1, 'گزارش دیروز', { status: 'pending' })];
    day(b, TODAY).tasks = [
      mkTask(2, 'تهیه‌ی <b>گزارش</b>', { status: 'done', note: 'با تیم هماهنگ شد', canUndo: true, priority: 'high' }),
      mkTask(3, 'پیگیری قرارداد', { status: 'pending' }),
      mkTask(4, 'تسک فوری من', { isUrgent: true, selfAssigned: true, assignedByUserId: 7, priority: 'high' }),
      mkTask(5, 'بررسی گزارش تیم', { isSystem: true, systemKey: 'review_team_reports' }),
      mkTask(6, 'منتقل‌شده', { status: 'rescheduled', rescheduleTo: '2027-05-09', carryCount: 1 }),
    ];
    day(b, '2027-05-08').tasks = [mkTask(7, 'کار آینده', { status: 'pending' })];
    for (const d of b.days) { const c = d.tasks.filter((t) => !t.isSystem); d.total = c.length; d.done = c.filter((t) => t.status === 'done').length; }
    b.progress = { done: 1, total: 6, percent: 17 };
    return b;
  };

  test('هفت کادر به ترتیب روزِ سرور (هفته‌ی غیر شنبه‌محور)، «امروز» مشخص و رنگ یکتای هر روز', async () => {
    const env = makeEnv({ board: board() });
    await open(env);
    const ds = days(env);
    assert.equal(ds.length, 7);
    assert.deepEqual(ds.map((d) => /pl-day-(\d)/.exec(d.className)[1]), ['1', '2', '3', '4', '5', '6', '7']);
    const todayIdx = ds.findIndex((d) => /is-today/.test(d.className));
    assert.equal(todayIdx, 1);
    assert.match(ds[1].textContent, /امروز/);
    assert.doesNotMatch(ds[0].textContent, /امروز/);
    assert.ok(env.calls.some((c) => /\/week-board\?week=current/.test(c.url)));
    assert.match(env.body().textContent, /۱ از ۶ انجام شد/);
    assert.match(env.body().textContent, /۱۷٪/);
  });

  test('امروز باز و بقیه جمع‌شده (دکمه‌ی جمع‌شدنی با aria-expanded)', async () => {
    const env = makeEnv({ board: board() });
    await open(env);
    const ds = days(env);
    assert.ok(!/is-collapsed/.test(ds[1].className));
    assert.ok(/is-collapsed/.test(ds[0].className));
    const tg = walk(ds[0]).find((n) => /pl-day-toggle/.test(n.className));
    assert.equal(tg.attrs['aria-expanded'], 'false');
    await tg.fire('click');
    assert.ok(!/is-collapsed/.test(ds[0].className));
    assert.equal(tg.attrs['aria-expanded'], 'true');
  });

  test('تسک انجام‌شده: ✓ و «انجام شد» متنی، توضیح انجام، چک‌باکس تیک‌خورده؛ عنوان مخرب فقط متن است', async () => {
    const env = makeEnv({ board: board() });
    await open(env);
    const r = rowOf(env, 'تهیه‌ی');
    assert.match(r.className, /is-done/);
    assert.match(r.textContent, /✓ انجام شد/);
    assert.match(r.textContent, /توضیح: با تیم هماهنگ شد/);
    assert.match(r.textContent, /<b>گزارش<\/b>/); // به‌صورت متن، نه HTML
    assert.equal(checks(r)[0].attrs['aria-checked'], 'true');
    assert.equal(checks(r)[0].disabled, false); // done + canUndo ⇒ قابل برداشتن
  });

  test('چیپ‌های متنی: فوریِ خودم، منتقل‌شده؛ تسک سیستمی واجب با چک‌باکس غیرفعال و دلیل', async () => {
    const env = makeEnv({ board: board() });
    await open(env);
    assert.match(rowOf(env, 'تسک فوری من').textContent, /⚡ فوری \(خودم\)/);
    assert.match(rowOf(env, 'منتقل‌شده').textContent, /↪ منتقل شد به/);
    const sys = rowOf(env, 'بررسی گزارش تیم');
    assert.match(sys.textContent, /🔒 واجب/);
    assert.equal(checks(sys)[0].disabled, true);
    assert.match(checks(sys)[0].attrs['aria-label'], /با مشاهده‌ی گزارش‌ها انجام می‌شود/);
  });

  test('روز آینده: چک‌باکس غیرفعال با دلیل؛ تسک منتقل‌شده/پاسخ‌داده‌ی غیر-done هم غیرفعال', async () => {
    const env = makeEnv({ board: board() });
    await open(env);
    const fut = checks(rowOf(env, 'کار آینده'))[0];
    assert.equal(fut.disabled, true);
    assert.match(fut.attrs['aria-label'], /روز آینده هنوز نرسیده است/);
    assert.equal(checks(rowOf(env, 'منتقل‌شده'))[0].disabled, true);
  });

  test('تیک امروز: POST /daily-report فقط با همان تسک و بدون date؛ سپس تخته‌ی تازه و پیام', async () => {
    const env = makeEnv({ board: board() });
    await open(env);
    env.state.board = (() => { const b = board(); day(b, TODAY).tasks.find((t) => t.id === 3).status = 'done'; b.progress = { done: 2, total: 6, percent: 33 }; return b; })();
    await checks(rowOf(env, 'پیگیری قرارداد'))[0].fire('click');
    await flush();
    const post = env.calls.find((c) => c.init.method === 'POST' && /\/daily-report$/.test(c.url));
    assert.ok(post);
    assert.deepEqual(post.body.answers, [{ taskId: 3, status: 'done' }]);
    assert.equal(post.body.date, undefined);
    assert.match(env.body().textContent, /ثبت شد: انجام شد/);
    assert.match(env.body().textContent, /۲ از ۶ انجام شد/);
    assert.equal(checks(rowOf(env, 'پیگیری قرارداد'))[0].attrs['aria-checked'], 'true');
  });

  test('تیک روز گذشته: date همان روز ارسال می‌شود', async () => {
    const env = makeEnv({ board: board() });
    await open(env);
    await checks(rowOf(env, 'گزارش دیروز'))[0].fire('click');
    await flush();
    const post = env.calls.find((c) => c.init.method === 'POST' && /\/daily-report$/.test(c.url));
    assert.equal(post.body.date, '2027-05-05');
  });

  test('برداشتن تیک: POST /daily-report/undo', async () => {
    const env = makeEnv({ board: board() });
    await open(env);
    await checks(rowOf(env, 'تهیه‌ی'))[0].fire('click');
    await flush();
    const u = env.calls.find((c) => /\/daily-report\/undo$/.test(c.url));
    assert.ok(u);
    assert.deepEqual(u.body, { taskId: 2 });
    assert.match(env.body().textContent, /تیک برداشته شد/);
  });

  test('خطای سرور: پیام سرور و بدون تغییر در تیک؛ ALREADY_ANSWERED ⇒ تازه‌سازی با پیام', async () => {
    const env = makeEnv({ board: board(), post: { 'POST /daily-report': { ok: false, status: 409, json: { error: 'این ماه بسته شده است.', code: 'MONTH_CLOSED' } } } });
    await open(env);
    await checks(rowOf(env, 'پیگیری قرارداد'))[0].fire('click');
    await flush();
    assert.match(env.body().textContent, /این ماه بسته شده است/);
    assert.equal(checks(rowOf(env, 'پیگیری قرارداد'))[0].attrs['aria-checked'], 'false');
    const live = walk(env.body()).find((n) => /pl-sheet-live/.test(n.className));
    assert.equal(live.attrs.role, 'alert');

    const env2 = makeEnv({ board: board(), post: { 'POST /daily-report': { ok: false, status: 409, json: { error: 'قبلاً پاسخ داده شده.', code: 'ALREADY_ANSWERED' } } } });
    await open(env2);
    const before = env2.calls.filter((c) => /week-board/.test(c.url)).length;
    await checks(rowOf(env2, 'پیگیری قرارداد'))[0].fire('click');
    await flush();
    assert.equal(env2.calls.filter((c) => /week-board/.test(c.url)).length, before + 1);
    assert.match(env2.body().textContent, /فهرست تازه شد/);
  });

  test('هفته‌ی بدون تسک: کادرهای خالی «تسکی ندارد» و خلاصه‌ی بدون پیشرفت', async () => {
    const env = makeEnv({ board: makeBoard({ hasPlan: false, planStatus: 'draft' }) });
    await open(env);
    assert.equal(days(env).length, 7);
    assert.match(env.body().textContent, /تسکی ندارد/);
    assert.match(env.body().textContent, /تسکی برای شمارش پیشرفت ثبت نشده/);
  });

  test('شکست week-board ⇒ نمای فقط‌خواندنیِ ساده (برنامه همچنان دیده می‌شود)', async () => {
    const env = makeEnv({ board: board(), planOver: { tasks: [{ id: 9, title: 'قدیمی', description: '', plannedDate: null, priority: 'normal', isSystem: false }] }, post: { 'GET /week-board': { ok: false, status: 500, json: { error: 'x' } } } });
    await open(env);
    assert.match(env.body().textContent, /قدیمی/);
    assert.equal(checks(env.body()).length, 0);
  });

  test('انتخابگر «این هفته / هفته‌ی بعد» بیرون از بدنه با aria-selected', async () => {
    const env = makeEnv({ board: board() });
    await open(env);
    assert.deepEqual(env.weeks().children.map((t) => t.textContent), ['این هفته', 'هفته‌ی بعد']);
    assert.deepEqual(env.weeks().children.map((t) => t.attrs['aria-selected']), ['true', 'false']);
    const before = env.calls.filter((c) => /\/plan\?week=next/.test(c.url)).length;
    await env.weeks().children[1].fire('click');
    await flush();
    assert.equal(env.calls.filter((c) => /\/plan\?week=next/.test(c.url)).length, before + 1);
    assert.deepEqual(env.weeks().children.map((t) => t.attrs['aria-selected']), ['false', 'true']);
  });
});

describe('هفته‌ی بعد (ویرایش) با ظاهر تازه (C2)', () => {
  test('کارت‌ها pl-day با رنگ‌های یکتا؛ بدون چک‌باکس تیک؛ فرم افزودن سر جایش', async () => {
    const days7 = DATES.map((date) => ({ date, kind: 'working', isWorkingDay: true, holidayTitle: null }));
    const env = makeEnv({ week: 'next', planOver: { weekStart: DATES[0], weekEnd: DATES[6], status: 'draft', editMode: 'free', days: days7 } });
    await open(env, 'next');
    const ds = days(env);
    assert.equal(ds.length, 8); // «هر روز» + هفت روز
    assert.match(ds[0].className, /pl-day-any/);
    assert.deepEqual(ds.slice(1).map((d) => /pl-day-(\d)/.exec(d.className)[1]), ['1', '2', '3', '4', '5', '6', '7']);
    assert.ok(ds.every((d) => /day-card/.test(d.className)));
    assert.equal(checks(env.body()).length, 0);
    assert.ok(walk(ds[1]).some((n) => n.tag === 'input' && n.placeholder === 'تسک جدید…'));
    assert.equal(env.calls.filter((c) => /week-board/.test(c.url)).length, 0);
  });
});

describe('ایستا (C2)', () => {
  const css = read('public/css/planner.css');
  test('app.js: بدون innerHTML خام در تخته و شیت', () => {
    const slice = appSrc.slice(appSrc.indexOf('async function refreshBoard'), appSrc.indexOf('function planPayload'));
    assert.ok(slice.length > 500);
    assert.doesNotMatch(slice, /innerHTML\s*=(?!\s*'')/);
    assert.doesNotMatch(slice, /\.style\.|style:|\son[a-z]+=/);
  });
  test('CSS: تکیه‌گاه کادر روزِ day-card، جمع‌شدن فقط موبایل، رنگ وضعیت‌ها', () => {
    assert.match(css, /\.pl-day\.day-card \{[^}]*background: var\(--plan-card\)/);
    assert.match(css, /@media \(min-width: 768px\) \{\s*\.pl-day\.is-collapsed \.pl-list \{ display: block; \}/);
    assert.match(css, /\.pl-row-status\.pl-st-done/);
    assert.match(css, /\.pl-day-any/);
  });
  test('index.html: انتخابگر هفته بیرون از #plan-body و بدون inline', () => {
    const html = read('public/index.html');
    const v = html.slice(html.indexOf('id="view-plan"'), html.indexOf('id="view-profile"'));
    assert.match(v, /id="plan-weeks"/);
    assert.ok(v.indexOf('id="plan-weeks"') < v.indexOf('id="plan-body"'));
    assert.doesNotMatch(v, /\sstyle=|\son[a-z]+=/i);
  });
});

// ---------- C3: شیت «جزئیات تسک» ----------
describe('شیت جزئیات تسک (C3)', () => {
  const sheetBody = (env) => env.$('#pl-sheet-body');
  const sbtn = (env, text) => walk(sheetBody(env)).find((n) => n.tag === 'button' && n.textContent === text);
  const rowMain = (env, title) => walk(rowOf(env, title)).find((n) => /pl-row-main/.test(n.className));
  const mk = () => {
    const b = makeBoard();
    day(b, TODAY).tasks = [
      mkTask(10, 'تسک خودم', { description: 'خط اول\nخط دوم <i>x</i>', priority: 'high' }),
      mkTask(11, 'تسک سرپرست', { managerLocked: true, priority: 'normal' }),
      mkTask(12, 'فوری مدیر', { isUrgent: true, assignedByUserId: 99, urgentNote: 'تا ظهر', urgentDeadlineTime: '12:00', priority: 'high' }),
      mkTask(13, 'فوری خودم', { isUrgent: true, selfAssigned: true, assignedByUserId: 7, priority: 'high' }),
      mkTask(14, 'بررسی گزارش تیم', { isSystem: true, systemKey: 'review_team_reports' }),
      mkTask(15, 'انجام‌شده', { status: 'done', note: 'قبلی', canUndo: true }),
      mkTask(16, 'نیمه‌کاره', { status: 'partial', reasonCode: 'no_time', canUndo: true, carryCount: 2 }),
    ];
    day(b, '2027-05-08').tasks = [mkTask(17, 'آینده')];
    return b;
  };
  const opened = async (title, env0) => { const env = env0 || makeEnv({ board: mk() }); await open(env); await rowMain(env, title).fire('click'); await flush(); return env; };

  test('کلیک ردیف: عنوان، توضیح چندخطی (متن خام)، اولویت، منبع و روز', async () => {
    const env = await opened('تسک خودم');
    const t = sheetBody(env).textContent;
    assert.match(t, /تسک خودم/);
    assert.match(t, /خط اول\nخط دوم <i>x<\/i>/);
    assert.match(t, /اولویت بالا/);
    assert.match(t, /برنامه‌ی خودم/);
    assert.match(t, /پنجشنبه/);
  });

  test('منبع و چیپ برای هر نوع: سرپرست، فوریِ مدیر (مهلت/یادداشت)، فوریِ خودم، سیستمی', async () => {
    let env = await opened('تسک سرپرست');
    assert.match(sheetBody(env).textContent, /🔒 از طرف سرپرست/);
    env = await opened('فوری مدیر');
    assert.match(sheetBody(env).textContent, /⚡ فوریِ سرپرست/);
    assert.match(sheetBody(env).textContent, /ساعت ۱۲:۰۰/);
    assert.match(sheetBody(env).textContent, /تا ظهر/);
    env = await opened('فوری خودم');
    assert.match(sheetBody(env).textContent, /⚡ فوریِ خودم/);
    env = await opened('بررسی گزارش تیم');
    assert.match(sheetBody(env).textContent, /🔒 تسک واجب/);
  });

  test('دکمه‌ها از روی فلگ‌ها: pending ⇒ انجام/انتقال؛ سیستمی ⇒ انجام غیرفعال با علت؛ بدون ویرایش/حذف برای تسک غیرِ فوریِ خودم', async () => {
    let env = await opened('تسک خودم');
    assert.equal(sbtn(env, '✓ انجام شد').disabled, false);
    assert.equal(sbtn(env, '↪ انتقال').disabled, false); // D2: انتقال فعال است (جزئیاتش در test/myDayUi.test.js)
    assert.doesNotMatch(sheetBody(env).textContent, /انتقال در مرحله‌ی بعد فعال می‌شود/);
    assert.equal(sbtn(env, '✎ ویرایش'), undefined);
    assert.equal(sbtn(env, '↩ برداشتن پاسخ'), undefined);
    env = await opened('بررسی گزارش تیم');
    assert.equal(sbtn(env, '✓ انجام شد').disabled, true);
    assert.match(sheetBody(env).textContent, /با مشاهده‌ی گزارش‌ها انجام می‌شود/);
    assert.equal(sbtn(env, '↪ انتقال'), undefined);
  });

  test('روز آینده: انجام/انتقال غیرفعال با علت', async () => {
    const env = await opened('آینده');
    assert.equal(sbtn(env, '✓ انجام شد').disabled, true);
    assert.match(sheetBody(env).textContent, /روز آینده هنوز نرسیده است/);
  });

  test('تسک پاسخ‌داده: تاریخچه‌ی انتقال، برداشتن پاسخ، توضیح انجام قابل ویرایش و ذخیره با PATCH', async () => {
    let env = await opened('نیمه‌کاره');
    assert.match(sheetBody(env).textContent, /۲ بار منتقل شده/);
    assert.match(sheetBody(env).textContent, /وقت نشد/);
    assert.equal(sbtn(env, '↩ برداشتن پاسخ').disabled, false);
    env = await opened('انجام‌شده');
    const ta = walk(sheetBody(env)).find((n) => n.tag === 'textarea');
    assert.equal(ta.value, 'قبلی');
    ta.value = 'توضیح تازه';
    await sbtn(env, 'ثبت توضیح').fire('click');
    await flush();
    const patch = env.calls.find((c) => c.init.method === 'PATCH');
    assert.match(patch.url, /\/daily-report\/note$/);
    assert.deepEqual(patch.body, { taskId: 15, note: 'توضیح تازه' });
    assert.match(sheetBody(env).textContent, /توضیح ذخیره شد/);
  });

  test('عمل‌ها: انجام شد ⇒ POST با date روز؛ برداشتن پاسخ ⇒ undo؛ پس از موفقیت شیت باز و با داده‌ی تازه', async () => {
    const env = await opened('تسک خودم');
    env.state.board = (() => { const b = mk(); day(b, TODAY).tasks[0].status = 'done'; day(b, TODAY).tasks[0].canUndo = true; return b; })();
    await sbtn(env, '✓ انجام شد').fire('click');
    await flush();
    const post = env.calls.find((c) => c.init.method === 'POST' && /\/daily-report$/.test(c.url));
    assert.deepEqual(post.body.answers, [{ taskId: 10, status: 'done' }]);
    assert.match(sheetBody(env).textContent, /ثبت شد: انجام شد/);
    assert.ok(sbtn(env, '↩ برداشتن پاسخ'));
    await sbtn(env, '↩ برداشتن پاسخ').fire('click');
    await flush();
    assert.ok(env.calls.find((c) => /\/daily-report\/undo$/.test(c.url)));
  });

  test('خطای سرور داخل شیت: پیام سرور (alert) و شیت باز می‌ماند', async () => {
    const env = makeEnv({ board: mk(), post: { 'POST /daily-report': { ok: false, status: 409, json: { error: 'ماه بسته است.', code: 'MONTH_CLOSED' } } } });
    await opened('تسک خودم', env);
    await sbtn(env, '✓ انجام شد').fire('click');
    await flush();
    assert.match(sheetBody(env).textContent, /ماه بسته است/);
    const live = walk(sheetBody(env)).find((n) => /pl-sheet-live/.test(n.className));
    assert.equal(live.attrs.role, 'alert');
  });

  test('فوریِ خودم (بدون پاسخ): ویرایش با PATCH /my-urgent، حذف دومرحله‌ای با DELETE', async () => {
    const env = await opened('فوری خودم');
    await sbtn(env, '✎ ویرایش').fire('click');
    const inputs = walk(sheetBody(env)).filter((n) => n.tag === 'input' || n.tag === 'textarea');
    inputs[0].value = 'عنوان جدید'; inputs[1].value = 'شرح';
    await sbtn(env, 'ذخیره').fire('click');
    await flush();
    const patch = env.calls.find((c) => c.init.method === 'PATCH' && /my-urgent\/13$/.test(c.url));
    assert.deepEqual(patch.body, { title: 'عنوان جدید', description: 'شرح' });
    await sbtn(env, '🗑 حذف').fire('click');
    assert.equal(env.calls.filter((c) => c.init.method === 'DELETE').length, 0);
    await sbtn(env, 'تأیید حذف').fire('click');
    await flush();
    assert.equal(env.calls.filter((c) => c.init.method === 'DELETE' && /my-urgent\/13$/.test(c.url)).length, 1);
  });

  test('فوریِ مدیر: بدون ویرایش/حذف', async () => {
    const env = await opened('فوری مدیر');
    assert.equal(sbtn(env, '✎ ویرایش'), undefined);
    assert.equal(sbtn(env, '🗑 حذف'), undefined);
  });

  test('بستن: فوکوس به همان ردیف برمی‌گردد؛ کلیک چک‌باکس شیت را باز نمی‌کند', async () => {
    const env = await opened('تسک خودم');
    await sbtn(env, 'بستن').fire('click');
    assert.equal(Node_.focused, rowMain(env, 'تسک خودم'));
    const env2 = makeEnv({ board: mk() });
    await open(env2);
    assert.equal(sheetBody(env2).children.length, 0);
    await checks(rowOf(env2, 'آینده'))[0].fire('click');
    assert.equal(sheetBody(env2).children.length, 0);
  });

  test('ایستا: index.html شیت با role=dialog/aria-modal بدون inline؛ کلاس‌های pl-sheet در CSS', () => {
    const html = read('public/index.html');
    const v = html.slice(html.indexOf('id="pl-sheet"'), html.indexOf('id="toast"'));
    assert.match(v, /role="dialog" aria-modal="true" aria-labelledby="pl-sheet-title"/);
    assert.doesNotMatch(v, /\sstyle=|\son[a-z]+=/i);
    assert.match(read('public/css/planner.css'), /\.pl-sheet \{/);
  });
});

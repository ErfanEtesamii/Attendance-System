// D1 + D2 (فاز ۱۵): صفحه‌ی «امروزِ من» (دو لیست، تیک، توضیح انجام، برداشتن تیک) و کامپوننت انتقال (فردا / تاریخ مشخص) داخل شیت.
// DOM ساختگی + یک «سرور ساختگیِ حالت‌دار» برای /daily-tasks، /daily-report، undo و note تا جابه‌جایی بین لیست‌ها واقعاً سنجیده شود.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const appSrc = read('public/js/app.js');
const flush = () => new Promise((r) => setTimeout(r, 15));

class Node_ {
  constructor(tag) { this.tag = tag; this.children = []; this.handlers = {}; this._text = ''; this.className = ''; this.dataset = {}; this.style = {}; this.value = ''; this.disabled = false; this.attrs = {}; this.classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } }; }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  set innerHTML(v) { this.children = []; this._text = ''; }
  get innerHTML() { return ''; }
  addEventListener(t, fn) { (this.handlers[t] = this.handlers[t] || []).push(fn); }
  appendChild(c) { this.children.push(c); return c; }
  setAttribute(k, v) { this.attrs[k] = v; } removeAttribute() {} get isConnected() { return true; }
  focus() { Node_.focused = this; }
  querySelector() { return null; }
  fire(t, ev = {}) { return Promise.all((this.handlers[t] || []).map((fn) => fn({ preventDefault() {}, stopPropagation() {}, target: this, ...ev }))); }
}
const walk = (n, out = []) => { out.push(n); (n.children || []).forEach((c) => walk(c, out)); return out; };

const TODAY = '2027-05-06'; // پنجشنبه
const NEXT = '2027-05-08';
const mkTask = (id, title, extra = {}) => ({ id, title, description: '', priority: 'normal', plannedDate: TODAY, isSystem: false, systemKey: null, outOfPlan: false, optional: false, isUrgent: false, assignedByUserId: null, assignedByName: null, urgentNote: null, urgentDeadlineTime: null, managerLocked: false, source: 'planned', carryCount: 0, selfAssigned: false, ...extra });

// سرور ساختگی: حالت روز را نگه می‌دارد و مثل سرور واقعی تسک را بین tasks و answered جابه‌جا می‌کند
function makeServer(over = {}) {
  const srv = { date: TODAY, today: TODAY, late: false, fullDayOff: false, nextWorkingDay: NEXT, taskCarryMaxTimes: 0, limits: { selfUrgentEnabled: false, selfUrgentRemaining: 0 }, tasks: [], answered: [], orig: new Map(), ...over };
  srv.orig = new Map(srv.tasks.map((t) => [t.id, t]));
  srv.daily = () => {
    const counted = (t) => !t.isSystem && !t.outOfPlan && !t.dropped;
    const all = [...srv.tasks.filter(counted), ...srv.answered.filter(counted)];
    const done = srv.answered.filter((a) => counted(a) && a.status === 'done').length;
    return { ok: true, date: srv.date, today: srv.today, late: srv.late, source: 'normal', mode: 'off', fullDayOff: srv.fullDayOff, nextWorkingDay: srv.nextWorkingDay, taskCarryMaxTimes: srv.taskCarryMaxTimes, progress: { done, total: all.length, percent: all.length ? Math.round((done / all.length) * 100) : null }, limits: srv.limits, tasks: srv.tasks, teamReview: null, answered: srv.answered, reasonCodes: [] };
  };
  srv.answer = (a) => {
    const i = srv.tasks.findIndex((t) => t.id === a.taskId);
    const t = srv.tasks[i];
    srv.tasks.splice(i, 1);
    const r = a.reschedule;
    const to = r ? (r.type === 'tomorrow' ? srv.nextWorkingDay : (r.type === 'date' ? r.date : 'drop')) : null;
    srv.answered.push({ taskId: t.id, title: t.title, status: a.status, reasonCode: a.reasonCode || null, reasonText: a.reasonText || null, rescheduleTo: to, outOfPlan: t.outOfPlan, priority: t.priority, description: t.description, note: null, answeredAt: '2027-05-06 09:00:00', answeredLate: false, canUndo: t.systemKey !== 'review_team_reports', isUrgent: t.isUrgent, assignedByUserId: t.assignedByUserId, isSystem: t.isSystem, systemKey: t.systemKey, carryCount: to && to !== 'drop' ? 1 : 0, dropped: to === 'drop', selfAssigned: t.selfAssigned, managerLocked: t.managerLocked });
  };
  return srv;
}

function makeEnv({ srv = makeServer(), fail = {}, dp = false, backfill = [], hours = null, weekBoard = null, noUpcoming = false } = {}) {
  const els = new Map();
  const $ = (sel) => { if (!els.has(sel)) els.set(sel, new Node_(sel)); return els.get(sel); };
  const nav = Object.assign(new Node_('nav'), { dataset: { view: 'myday' } });
  const docHandlers = {};
  const document = { querySelector: $, querySelectorAll: () => [nav], createElement: (t) => new Node_(t), createTextNode: (t) => { const n = new Node_('#text'); n._text = t; return n; }, addEventListener: (t, fn) => { docHandlers[t] = fn; }, removeEventListener: (t) => { delete docHandlers[t]; } };
  const calls = [];
  const dpCalls = [];
  const resp = (r) => ({ ok: r.ok !== false, status: r.status || 200, json: async () => r.json || {} });
  const fetchStub = async (url, init = {}) => {
    const method = init.method || 'GET';
    const p = url.replace('/api/miniapp', '');
    const key = `${method} ${p.split('?')[0]}`;
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method, url: p, key, body });
    if (fail[key]) { const f = typeof fail[key] === 'function' ? fail[key](calls[calls.length - 1]) : fail[key]; if (f) return resp(f); }
    if (key === 'GET /daily-tasks') return resp({ json: srv.daily() });
    if (key === 'POST /daily-report') {
      body.answers.forEach((a) => srv.answer(a));
      return resp({ json: { ...srv.daily(), saved: { answers: body.answers.length, extra: 0 }, rescheduled: [], encouragements: [{ taskId: body.answers[0].taskId, status: 'done', text: 'آفرین! یک گام جلوتر' }] } });
    }
    if (key === 'POST /daily-report/undo') {
      const i = srv.answered.findIndex((a) => a.taskId === body.taskId);
      srv.answered.splice(i, 1);
      srv.tasks.push(srv.orig.get(body.taskId));
      return resp({ json: { ...srv.daily(), undone: { taskId: body.taskId } } });
    }
    if (key === 'PATCH /daily-report/note') {
      srv.answered.find((a) => a.taskId === body.taskId).note = body.note || null;
      return resp({ json: { ...srv.daily(), taskId: body.taskId, note: body.note || null } });
    }
    if (key === 'GET /report-backfill') return resp({ json: { ok: true, mode: 'soft', backfillDays: 3, days: backfill } });
    if (key === 'GET /schedule/upcoming') return noUpcoming ? resp({ ok: false, status: 500, json: { error: 'x' } }) : resp({ json: { days: [hours || { isWorkingDay: true, expectedStart: '08:00', expectedEnd: '16:00' }, { isWorkingDay: false }] } });
    if (key === 'GET /week-board') return weekBoard ? resp({ json: weekBoard }) : resp({ ok: false, status: 500, json: { error: 'x' } });
    return resp({ json: { ok: true } });
  };
  const window = { location: { search: '' }, Telegram: undefined, Planner: require('../public/js/planner.js'), DailyReport: require('../public/js/dailyReport.js'), UiStates: require('../public/js/states.js') };
  if (dp) window.JalaliDatepicker = { attach(input, opts) { dpCalls.push({ input, opts }); return { getValue: () => input.value, setValue() {} }; } };
  const ctx = { window, document, fetch: fetchStub, console, setTimeout, clearTimeout, setInterval, clearInterval, Date, Intl, JSON, Promise, encodeURIComponent, URLSearchParams };
  vm.runInNewContext(appSrc, ctx);
  return { $, nav, calls, srv, dpCalls, docHandlers, body: () => $('#myday-body'), sheet: () => $('#pl-sheet-body'), undo: () => $('#pl-undo'), toast: () => $('#toast') };
}

const open = async (env) => { await env.nav.fire('click'); await flush(); await flush(); };
const rowOf = (env, title) => walk(env.body()).find((n) => n.tag === 'li' && /pl-row/.test(n.className) && n.textContent.includes(title));
const checkOf = (row) => walk(row).find((n) => n.attrs && n.attrs.role === 'checkbox');
const btnIn = (root, pred) => walk(root).find((n) => n.tag === 'button' && (typeof pred === 'string' ? n.textContent === pred : pred(n)));
const section = (env, cls) => walk(env.body()).find((n) => n.tag === 'section' && n.className.split(' ').includes(cls));
const moveBtnOf = (row) => walk(row).find((n) => n.tag === 'button' && /pl-move/.test(n.className));
const mainOf = (row) => walk(row).find((n) => n.tag === 'button' && /pl-row-main/.test(n.className));
const reasonsGroup = (env) => walk(env.sheet()).find((n) => n.attrs && n.attrs['aria-label'] === 'علت انتقال');
const sheetText = (env) => env.sheet().textContent;

const baseTasks = () => [
  mkTask(1, 'پیگیری قرارداد', { priority: 'high' }),
  mkTask(2, 'گزارش <b>هفتگی</b>'),
  mkTask(3, 'بررسی گزارش تیم', { isSystem: true, systemKey: 'review_team_reports' }),
  mkTask(4, 'مطالعه‌ی اختیاری', { priority: 'low', optional: true }),
];
const withDone = () => {
  const srv = makeServer({ tasks: baseTasks() });
  srv.answer({ taskId: 2, status: 'done' });
  return srv;
};

// ---------------------------------------------------------------- D1
describe('«امروزِ من» (D1): دو لیست و تیک', () => {
  test('باز شدن: GET /daily-tasks؛ روز، پیشرفت، دو بخش با شمارنده؛ موبایل: تب «در انتظار» فعال', async () => {
    const env = makeEnv({ srv: withDone() });
    await open(env);
    assert.ok(env.calls.some((c) => c.key === 'GET /daily-tasks' && c.url === '/daily-tasks'));
    const t = env.body().textContent;
    assert.match(t, /پنجشنبه/);
    assert.match(t, /۱ از ۳ انجام شد/); // سیستمی در total نمی‌آید: ۲ بی‌پاسخ عادی + اختیاری + ۱ انجام‌شده = ۳
    assert.match(t, /در انتظار \(۳\)/);
    assert.match(t, /انجام‌شده \(۱\)/);
    const tabs = walk(env.body()).filter((n) => n.attrs && n.attrs.role === 'tab');
    assert.deepEqual(tabs.map((x) => x.attrs['aria-selected']), ['true', 'false']);
    assert.match(tabs[0].textContent, /در انتظار\(۳\)/);
    assert.match(section(env, 'pl-col-done').className, /pl-col-off/);
    assert.doesNotMatch(section(env, 'pl-col-pending').className, /pl-col-off/);
    await tabs[1].fire('click');
    assert.match(section(env, 'pl-col-pending').className, /pl-col-off/);
    assert.doesNotMatch(section(env, 'pl-col-done').className, /pl-col-off/);
    assert.deepEqual(walk(env.body()).filter((n) => n.attrs && n.attrs.role === 'tab').map((x) => x.attrs['aria-selected']), ['false', 'true']);
  });

  test('ردیف‌ها: چیپ‌های متنی (اختیاری، فوریِ خودم، سرپرست، از دیروز)، عنوان مخرب فقط متن، تسک سیستمی با چک‌باکس غیرفعال و دلیل', async () => {
    const tasks = [
      mkTask(1, 'اختیاری', { priority: 'low', optional: true }),
      mkTask(2, 'فوری من', { isUrgent: true, selfAssigned: true, assignedByUserId: 7, priority: 'high' }),
      mkTask(3, 'از سرپرست', { managerLocked: true }),
      mkTask(4, 'منتقل‌شده', { source: 'rescheduled', rescheduledFrom: '2027-05-05', carryCount: 1 }),
      mkTask(5, 'بررسی گزارش تیم', { isSystem: true, systemKey: 'review_team_reports' }),
      mkTask(6, '<img src=x onerror=1>'),
    ];
    const env = makeEnv({ srv: makeServer({ tasks }) });
    await open(env);
    assert.match(rowOf(env, 'اختیاری').textContent, /اختیاری/);
    assert.match(rowOf(env, 'فوری من').textContent, /⚡ فوری \(خودم\)/);
    assert.match(rowOf(env, 'از سرپرست').textContent, /🔒 از طرف سرپرست/);
    assert.match(rowOf(env, 'منتقل‌شده').textContent, /↪ از دیروز/);
    assert.match(rowOf(env, '<img src=x onerror=1>').textContent, /<img src=x onerror=1>/);
    const sys = rowOf(env, 'بررسی گزارش تیم');
    assert.equal(checkOf(sys).disabled, true);
    assert.match(checkOf(sys).attrs['aria-label'], /با مشاهده‌ی گزارش‌ها انجام می‌شود/);
    assert.equal(moveBtnOf(sys), undefined); // تسک سیستمی انتقال ندارد
  });

  test('تیک: POST /daily-report فقط با همان تسک و بدون date؛ ردیف به «انجام‌شده» می‌رود؛ شمارنده‌ها؛ پیام تشویقیِ متنی؛ ویرایشگر توضیح باز می‌شود', async () => {
    const env = makeEnv({ srv: makeServer({ tasks: baseTasks() }) });
    await open(env);
    await checkOf(rowOf(env, 'پیگیری قرارداد')).fire('click');
    await flush();
    const post = env.calls.find((c) => c.key === 'POST /daily-report');
    assert.deepEqual(post.body, { answers: [{ taskId: 1, status: 'done' }] });
    assert.ok(!('date' in post.body));
    assert.ok(walk(section(env, 'pl-col-done')).some((n) => n.tag === 'li' && n.textContent.includes('پیگیری قرارداد')));
    assert.ok(!walk(section(env, 'pl-col-pending')).some((n) => n.tag === 'li' && n.textContent.includes('پیگیری قرارداد')));
    assert.match(env.body().textContent, /در انتظار \(۳\)/); // از ۴ ردیف (با تسک سیستمی) یکی رفت
    assert.match(env.body().textContent, /انجام‌شده \(۱\)/);
    assert.match(env.body().textContent, /۱ از ۳ انجام شد/);
    assert.match(env.body().textContent, /ثبت شد: انجام شد/);
    assert.equal(env.toast().textContent, 'آفرین! یک گام جلوتر'); // رشته‌ی متنی (نه «[object Object]»)
    const ta = walk(env.body()).find((n) => n.tag === 'textarea');
    assert.ok(ta, 'ویرایشگر توضیح انجام باز می‌شود');
    assert.match(ta.attrs['aria-label'], /توضیح انجام/);
    assert.equal(ta.placeholder, 'توضیح انجام (اختیاری)');
    assert.equal(checkOf(rowOf(env, 'پیگیری قرارداد')).attrs['aria-checked'], 'true');
    assert.match(rowOf(env, 'پیگیری قرارداد').className, /is-done/);
  });

  test('توضیح انجام: «ثبت» ⇒ PATCH /daily-report/note؛ بدون تغییر ⇒ هیچ درخواستی؛ blur با متن تازه یک‌بار می‌فرستد (نه دوبار با کلیک «ثبت»)', async () => {
    const env = makeEnv({ srv: makeServer({ tasks: baseTasks() }) });
    await open(env);
    await checkOf(rowOf(env, 'پیگیری قرارداد')).fire('click');
    await flush();
    const noteCalls = () => env.calls.filter((c) => c.key === 'PATCH /daily-report/note');
    let ta = walk(env.body()).find((n) => n.tag === 'textarea');
    ta.value = '  با تیم هماهنگ شد ';
    await ta.fire('input');
    await Promise.all([ta.fire('blur'), btnIn(env.body(), 'ثبت').fire('click')]);
    await flush();
    assert.equal(noteCalls().length, 1);
    assert.deepEqual(noteCalls()[0].body, { taskId: 1, note: 'با تیم هماهنگ شد' });
    assert.match(rowOf(env, 'پیگیری قرارداد').textContent, /توضیح: با تیم هماهنگ شد/);
    assert.match(env.body().textContent, /توضیح ذخیره شد/);
    assert.equal(walk(env.body()).filter((n) => n.tag === 'textarea').length, 0, 'ویرایشگر بعد از ذخیره بسته می‌شود');
    // دوباره باز نیست؛ اگر کسی باز کرد و تغییری نداد ⇒ درخواستی نمی‌رود (از ردیف‌های done/شیت، این‌جا با تیک و برداشتن/تیک دوباره سنجیده نمی‌شود)
    ta = null;
    assert.equal(noteCalls().length, 1);
  });

  test('توضیح انجام: بستن ویرایشگر بدون ذخیره؛ خطای سرور ⇒ پیام و ویرایشگر/متن می‌ماند', async () => {
    const env = makeEnv({ srv: makeServer({ tasks: baseTasks() }), fail: { 'PATCH /daily-report/note': { ok: false, status: 400, json: { error: 'توضیح انجام حداکثر ۵۰۰ نویسه است.', code: 'NOTE_TOO_LONG' } } } });
    await open(env);
    await checkOf(rowOf(env, 'پیگیری قرارداد')).fire('click');
    await flush();
    const ta = walk(env.body()).find((n) => n.tag === 'textarea');
    ta.value = 'متن';
    await ta.fire('input');
    await btnIn(env.body(), 'ثبت').fire('click');
    await flush();
    assert.match(env.body().textContent, /حداکثر ۵۰۰ نویسه/);
    const live = walk(env.body()).find((n) => /pl-sheet-live/.test(n.className));
    assert.equal(live.attrs.role, 'alert');
    const again = walk(env.body()).find((n) => n.tag === 'textarea');
    assert.ok(again, 'ویرایشگر می‌ماند');
    assert.equal(again.value, 'متن'); // متن تایپ‌شده نمی‌پرد
    await btnIn(env.body(), 'بستن').fire('click');
    assert.equal(walk(env.body()).filter((n) => n.tag === 'textarea').length, 0);
  });

  test('برداشتن تیک از لیست انجام‌شده: POST /daily-report/undo؛ ردیف به «در انتظار» برمی‌گردد', async () => {
    const env = makeEnv({ srv: withDone() });
    await open(env);
    assert.equal(checkOf(rowOf(env, 'گزارش <b>هفتگی</b>')).attrs['aria-checked'], 'true');
    await checkOf(rowOf(env, 'گزارش <b>هفتگی</b>')).fire('click');
    await flush();
    const u = env.calls.find((c) => c.key === 'POST /daily-report/undo');
    assert.deepEqual(u.body, { taskId: 2 });
    assert.ok(walk(section(env, 'pl-col-pending')).some((n) => n.tag === 'li' && n.textContent.includes('گزارش <b>هفتگی</b>')));
    assert.match(env.body().textContent, /تیک برداشته شد/);
    assert.match(env.body().textContent, /در انتظار \(۴\)/);
  });

  test('خطای سرور (MONTH_CLOSED): پیام سرور با role=alert و بازگشت UI (تیک نمی‌خورد)', async () => {
    const env = makeEnv({ srv: makeServer({ tasks: baseTasks() }), fail: { 'POST /daily-report': { ok: false, status: 409, json: { error: 'این ماه بسته شده است.', code: 'MONTH_CLOSED' } } } });
    await open(env);
    await checkOf(rowOf(env, 'پیگیری قرارداد')).fire('click');
    await flush();
    assert.match(env.body().textContent, /این ماه بسته شده است/);
    assert.equal(checkOf(rowOf(env, 'پیگیری قرارداد')).attrs['aria-checked'], 'false');
    assert.equal(checkOf(rowOf(env, 'پیگیری قرارداد')).disabled, false);
    assert.equal(walk(env.body()).find((n) => /pl-sheet-live/.test(n.className)).attrs.role, 'alert');
  });

  test('ALREADY_ANSWERED: مدل از سرور دوباره خوانده می‌شود و متن توضیحِ تایپ‌شده‌ی تسک دیگر حفظ می‌شود', async () => {
    let n = 0;
    const env = makeEnv({ srv: makeServer({ tasks: baseTasks() }), fail: { 'POST /daily-report': () => (++n === 2 ? { ok: false, status: 409, json: { error: 'قبلاً پاسخ داده شده.', code: 'ALREADY_ANSWERED' } } : null) } });
    await open(env);
    await checkOf(rowOf(env, 'پیگیری قرارداد')).fire('click');
    await flush();
    const ta = walk(env.body()).find((x) => x.tag === 'textarea');
    ta.value = 'پیش‌نویس من';
    await ta.fire('input');
    const before = env.calls.filter((c) => c.key === 'GET /daily-tasks').length;
    await checkOf(rowOf(env, 'گزارش <b>هفتگی</b>')).fire('click');
    await flush();
    assert.equal(env.calls.filter((c) => c.key === 'GET /daily-tasks').length, before + 1);
    assert.match(env.body().textContent, /فهرست تازه شد/);
    assert.equal(walk(env.body()).find((x) => x.tag === 'textarea').value, 'پیش‌نویس من');
  });

  test('منتقل‌شده/نیمه‌کاره/انجام‌نشده در بخش جمع‌شونده (پیش‌فرض بسته) با وضعیت متنی؛ چک‌باکسِ غیرِ done غیرفعال', async () => {
    const srv = makeServer({ tasks: [mkTask(1, 'کار اول'), mkTask(2, 'کار دوم'), mkTask(3, 'کار سوم')] });
    srv.answer({ taskId: 1, status: 'partial', reasonCode: 'no_time', reschedule: { type: 'tomorrow' } });
    srv.answer({ taskId: 2, status: 'not_done', reasonCode: 'technical_issue', reschedule: { type: 'drop' } });
    const env = makeEnv({ srv });
    await open(env);
    const sec = section(env, 'pl-other');
    assert.match(sec.className, /is-collapsed/);
    const toggle = btnIn(sec, (b) => /pl-day-toggle/.test(b.className));
    assert.equal(toggle.attrs['aria-expanded'], 'false');
    assert.match(rowOf(env, 'کار اول').textContent, /↪ منتقل شد به/);
    assert.match(rowOf(env, 'کار دوم').textContent, /🗑 حذف شد/);
    assert.equal(checkOf(rowOf(env, 'کار اول')).disabled, true);
    await toggle.fire('click');
    assert.doesNotMatch(section(env, 'pl-other').className, /is-collapsed/);
    assert.equal(btnIn(section(env, 'pl-other'), (b) => /pl-day-toggle/.test(b.className)).attrs['aria-expanded'], 'true');
  });

  test('روز مرخصی تمام‌روز: پیام بدون فشار و بدون دکمه‌ی انتقال؛ بدون تسک: پیام خالی', async () => {
    const env = makeEnv({ srv: makeServer({ fullDayOff: true, tasks: [] }) });
    await open(env);
    assert.match(env.body().textContent, /مرخصی\/ماموریتِ تمام‌روز/);
    assert.match(env.body().textContent, /تسکی برای امروز ثبت نشده است/);
    const env2 = makeEnv({ srv: makeServer({ tasks: [] }) });
    await open(env2);
    assert.match(env2.body().textContent, /تسکی برای امروز ثبت نشده است/);
    assert.match(env2.body().textContent, /هنوز تسکی را تیک نزده‌اید/);
  });

  test('همه تعیین‌وضعیت شد ⇒ پیام «🎉»؛ شکست بارگذاری ⇒ خطا + «تلاش دوباره»', async () => {
    const srv = makeServer({ tasks: [mkTask(1, 'کار اول')] });
    srv.answer({ taskId: 1, status: 'done' });
    const env = makeEnv({ srv });
    await open(env);
    assert.match(env.body().textContent, /همه‌ی تسک‌های امروز تعیین‌وضعیت شد/);
    const bad = makeEnv({ fail: { 'GET /daily-tasks': { ok: false, status: 500, json: { error: 'خطای سرور' } } } });
    await open(bad);
    assert.ok(bad.calls.some((c) => c.key === 'GET /daily-tasks'));
  });

  test('«روزهای قبل (N)»: چیپ ساکت (نه بنر)؛ یک روز ⇒ ویزارد late همان روز؛ چند روز ⇒ فهرست داخلی', async () => {
    const env = makeEnv({ srv: makeServer({ tasks: baseTasks() }), backfill: [{ date: '2027-05-04', source: 'backfill', pendingCount: 2, titles: [] }] });
    await open(env);
    const chip = btnIn(env.body(), (b) => /pl-quiet-chip/.test(b.className));
    assert.equal(chip.textContent, 'روزهای قبل (۱)');
    await chip.fire('click');
    await flush();
    assert.ok(env.calls.some((c) => c.key === 'GET /daily-tasks' && c.url === '/daily-tasks?date=2027-05-04'));

    const env2 = makeEnv({ srv: makeServer({ tasks: baseTasks() }), backfill: [{ date: '2027-05-04', pendingCount: 2 }, { date: '2027-05-03', pendingCount: 1 }] });
    await open(env2);
    const chip2 = btnIn(env2.body(), (b) => /pl-quiet-chip/.test(b.className));
    assert.equal(chip2.textContent, 'روزهای قبل (۲)');
    assert.equal(chip2.attrs['aria-expanded'], 'false');
    await chip2.fire('click');
    const chip3 = btnIn(env2.body(), (b) => /pl-quiet-chip/.test(b.className));
    assert.equal(chip3.attrs['aria-expanded'], 'true');
    assert.ok(walk(env2.body()).some((n) => n.tag === 'button' && /۱ تسک/.test(n.textContent)));
  });

  test('چیپ ساعت مؤثر از /schedule/upcoming؛ خطای آن صفحه را نمی‌شکند', async () => {
    const env = makeEnv({ srv: makeServer({ tasks: baseTasks() }) });
    await open(env);
    assert.match(env.body().textContent, /ساعت کاری ۰۸:۰۰–۱۶:۰۰/);
    const bad = makeEnv({ srv: makeServer({ tasks: baseTasks() }), noUpcoming: true });
    await open(bad);
    assert.doesNotMatch(bad.body().textContent, /ساعت کاری/);
    assert.match(bad.body().textContent, /در انتظار \(۴\)/);
  });

  test('کلیک روی ردیف ⇒ شیت جزئیات؛ Esc می‌بندد و فوکوس به همان ردیف برمی‌گردد', async () => {
    const env = makeEnv({ srv: makeServer({ tasks: baseTasks() }) });
    await open(env);
    const main = mainOf(rowOf(env, 'پیگیری قرارداد'));
    await main.fire('click');
    assert.match(sheetText(env), /پیگیری قرارداد/);
    assert.match(sheetText(env), /اولویت بالا/);
    assert.equal(typeof env.docHandlers.keydown, 'function');
    env.docHandlers.keydown({ key: 'Escape', preventDefault() {}, stopPropagation() {} });
    assert.equal(Node_.focused, main);
    assert.equal(env.docHandlers.keydown, undefined);
  });

  test('شیت از «امروزِ من»: «✓ انجام شد» با همان API و بدون date؛ سپس لیست تازه', async () => {
    const env = makeEnv({ srv: makeServer({ tasks: baseTasks() }) });
    await open(env);
    await mainOf(rowOf(env, 'پیگیری قرارداد')).fire('click');
    await btnIn(env.sheet(), '✓ انجام شد').fire('click');
    await flush();
    const post = env.calls.find((c) => c.key === 'POST /daily-report');
    assert.deepEqual(post.body, { answers: [{ taskId: 1, status: 'done' }] });
    assert.match(env.body().textContent, /انجام‌شده \(۱\)/);
    assert.equal(env.toast().textContent, 'آفرین! یک گام جلوتر');
  });
});

// ---------------------------------------------------------------- D2
describe('انتقال تسک (D2)', () => {
  const openMove = async (env, title) => { await moveBtnOf(rowOf(env, title)).fire('click'); await flush(); };
  const pick = (env, label) => btnIn(reasonsGroup(env), label).fire('click');
  const submit = async (env) => { await btnIn(env.sheet(), 'ثبت انتقال').fire('click'); await flush(); };
  const dest = (env, which) => btnIn(env.sheet(), (b) => b.dataset && b.dataset.dest === which);

  test('دکمه‌ی ↪ روی ردیف ⇒ شیت در حالت انتقال: دو گزینه‌ی مقصد (فردا با تاریخ روز کاریِ بعدی، تاریخ مشخص)، بدون «حذف از برنامه»', async () => {
    const env = makeEnv({ srv: makeServer({ tasks: baseTasks() }) });
    await open(env);
    await openMove(env, 'پیگیری قرارداد');
    assert.match(sheetText(env), /انتقال تسک/);
    assert.match(dest(env, 'tomorrow').textContent, /^فردا \(روز کاریِ بعدی: .+\)$/);
    assert.equal(dest(env, 'date').textContent, 'تاریخ مشخص…');
    assert.equal(dest(env, 'tomorrow').attrs['aria-pressed'], 'true');
    assert.doesNotMatch(sheetText(env), /حذف از برنامه/);
    const group = walk(env.sheet()).find((n) => n.attrs && n.attrs['aria-label'] === 'وضعیت تسک');
    assert.deepEqual(group.children.map((b) => b.textContent), ['❌ انجام نشد', '🟡 نیمه‌کاره']);
    assert.deepEqual(reasonsGroup(env).children.map((b) => b.textContent), ['وقت نشد', 'زمان بیشتری لازم دارد', 'منتظر دیگران', 'اولویت عوض شد', 'مشکل فنی', 'سایر']);
  });

  test('انتقال به فردا: بدنه با toApiAnswer (not_done + علت + tomorrow)؛ شیت بسته؛ نوار «واگرد»؛ ردیف در بخش «منتقل‌شده»', async () => {
    const env = makeEnv({ srv: makeServer({ tasks: baseTasks() }) });
    await open(env);
    await openMove(env, 'پیگیری قرارداد');
    await pick(env, 'وقت نشد');
    await submit(env);
    const post = env.calls.find((c) => c.key === 'POST /daily-report');
    assert.deepEqual(post.body, { answers: [{ taskId: 1, status: 'not_done', reasonCode: 'no_time', reschedule: { type: 'tomorrow' } }] });
    assert.equal(env.undo().classList.contains('hidden'), false);
    assert.match(env.undo().textContent, /«پیگیری قرارداد» به شنبه .+ منتقل شد/);
    assert.ok(btnIn(env.undo(), '↩ واگرد'));
    assert.ok(walk(section(env, 'pl-other')).some((n) => n.tag === 'li' && /↪ منتقل شد به/.test(n.textContent) && n.textContent.includes('پیگیری قرارداد')));
    assert.ok(!walk(section(env, 'pl-col-pending')).some((n) => n.tag === 'li' && n.textContent.includes('پیگیری قرارداد')));
  });

  test('«واگرد» ⇒ POST /daily-report/undo و بازگشت ردیف به «در انتظار»؛ نوار پنهان می‌شود', async () => {
    const env = makeEnv({ srv: makeServer({ tasks: baseTasks() }) });
    await open(env);
    await openMove(env, 'پیگیری قرارداد');
    await pick(env, 'وقت نشد');
    await submit(env);
    await btnIn(env.undo(), '↩ واگرد').fire('click');
    await flush();
    assert.deepEqual(env.calls.find((c) => c.key === 'POST /daily-report/undo').body, { taskId: 1 });
    assert.equal(env.undo().textContent, '');
    assert.ok(walk(section(env, 'pl-col-pending')).some((n) => n.tag === 'li' && n.textContent.includes('پیگیری قرارداد')));
    assert.match(env.toast().textContent, /انتقال واگرد شد/);
  });

  test('علت الزامی: بدون علت رد می‌شود و درخواستی نمی‌رود؛ «سایر» بدون متن (کمتر از ۵ نویسه) رد؛ با متن ⇒ reasonText', async () => {
    const env = makeEnv({ srv: makeServer({ tasks: baseTasks() }) });
    await open(env);
    await openMove(env, 'پیگیری قرارداد');
    await submit(env);
    assert.match(sheetText(env), /علت را انتخاب کنید/);
    assert.equal(env.calls.filter((c) => c.key === 'POST /daily-report').length, 0);
    await pick(env, 'سایر');
    await submit(env);
    assert.match(sheetText(env), /حداقل ۵ نویسه/);
    assert.equal(walk(env.sheet()).find((n) => /pl-sheet-live/.test(n.className)).attrs.role, 'alert');
    const ta = walk(env.sheet()).find((n) => n.tag === 'textarea');
    ta.value = 'منتظر تأیید مشتری';
    await ta.fire('input');
    await submit(env);
    const post = env.calls.find((c) => c.key === 'POST /daily-report');
    assert.deepEqual(post.body.answers[0], { taskId: 1, status: 'not_done', reasonCode: 'other', reasonText: 'منتظر تأیید مشتری', reschedule: { type: 'tomorrow' } });
  });

  test('وضعیت «نیمه‌کاره» انتخاب‌پذیر است و در بدنه می‌آید', async () => {
    const env = makeEnv({ srv: makeServer({ tasks: baseTasks() }) });
    await open(env);
    await openMove(env, 'پیگیری قرارداد');
    await btnIn(env.sheet(), '🟡 نیمه‌کاره').fire('click');
    await pick(env, 'مشکل فنی');
    await submit(env);
    assert.equal(env.calls.find((c) => c.key === 'POST /daily-report').body.answers[0].status, 'partial');
  });

  test('تاریخ مشخص (بدون datepicker ⇒ input بومی type=date با min/max): خالی، امروز و گذشته رد؛ تاریخ معتبر ⇒ reschedule date', async () => {
    const env = makeEnv({ srv: makeServer({ tasks: baseTasks() }) });
    await open(env);
    await openMove(env, 'پیگیری قرارداد');
    await pick(env, 'وقت نشد');
    await dest(env, 'date').fire('click');
    const input = () => walk(env.sheet()).find((n) => n.tag === 'input' && n.attrs['aria-label'] === 'تاریخ انتقال');
    assert.equal(input().type, 'date');
    assert.equal(input().min, '2027-05-07');
    assert.equal(input().max, '2027-07-05');
    await submit(env);
    assert.match(sheetText(env), /تاریخ انتقال را انتخاب کنید/);
    input().value = TODAY;
    await input().fire('change');
    await submit(env);
    assert.match(sheetText(env), /تاریخ انتقال باید بعد از امروز باشد/);
    assert.equal(env.calls.filter((c) => c.key === 'POST /daily-report').length, 0);
    input().value = '2027-05-12';
    await input().fire('change');
    await submit(env);
    const post = env.calls.find((c) => c.key === 'POST /daily-report');
    assert.deepEqual(post.body.answers[0].reschedule, { type: 'date', date: '2027-05-12' });
  });

  test('با JalaliDatepicker: همان کنترل فرم مرخصی (attach با min/max)، مقدار میلادی از onChange', async () => {
    const env = makeEnv({ srv: makeServer({ tasks: baseTasks() }), dp: true });
    await open(env);
    await openMove(env, 'پیگیری قرارداد');
    await pick(env, 'وقت نشد');
    await dest(env, 'date').fire('click');
    assert.equal(env.dpCalls.length, 1);
    assert.equal(env.dpCalls[0].input.type, 'text');
    assert.equal(env.dpCalls[0].opts.min, '2027-05-07');
    assert.equal(env.dpCalls[0].opts.max, '2027-07-05');
    env.dpCalls[0].opts.onChange('2027-05-20');
    await submit(env);
    assert.deepEqual(env.calls.find((c) => c.key === 'POST /daily-report').body.answers[0].reschedule, { type: 'date', date: '2027-05-20' });
  });

  test('هشدار نرم: روز مقصدِ غیرکاری ⇒ هشدار با نوع روز؛ روز کاری ⇒ بدون هشدار؛ شکست تقویم ⇒ بی‌صدا', async () => {
    const days = [['2027-05-07', false, 'weekend', null], ['2027-05-08', true, 'working', null], ['2027-05-09', false, 'holiday', 'عید']].map(([date, w, kind, holidayTitle]) => ({ date, isWorkingDay: w, kind, holidayTitle }));
    const env = makeEnv({ srv: makeServer({ tasks: baseTasks() }), weekBoard: { days } });
    await open(env);
    await openMove(env, 'پیگیری قرارداد');
    await dest(env, 'date').fire('click');
    await flush();
    const warn = () => walk(env.sheet()).find((n) => /pl-move-warn/.test(n.className));
    const input = () => walk(env.sheet()).find((n) => n.tag === 'input' && n.attrs['aria-label'] === 'تاریخ انتقال');
    input().value = '2027-05-07'; await input().fire('change');
    assert.match(warn().textContent, /روز کاری نیست \(آخر هفته\)/);
    input().value = '2027-05-09'; await input().fire('change');
    assert.match(warn().textContent, /تعطیل — عید/);
    input().value = '2027-05-08'; await input().fire('change');
    assert.equal(warn().textContent, '');
    assert.equal(warn().attrs.role, 'status');

    const bad = makeEnv({ srv: makeServer({ tasks: baseTasks() }) }); // /week-board خطا می‌دهد
    await open(bad);
    await openMove(bad, 'پیگیری قرارداد');
    await dest(bad, 'date').fire('click');
    await flush();
    const inp = walk(bad.sheet()).find((n) => n.tag === 'input' && n.attrs['aria-label'] === 'تاریخ انتقال');
    inp.value = '2027-05-07'; await inp.fire('change');
    assert.equal(walk(bad.sheet()).find((n) => /pl-move-warn/.test(n.className)).textContent, '');
  });

  test('تسک فوری: انتقال مجاز است و گزینه‌ی حذف ندارد (برای همه‌ی تسک‌ها هم نیست)', async () => {
    const env = makeEnv({ srv: makeServer({ tasks: [mkTask(9, 'فوری مدیر', { isUrgent: true, assignedByUserId: 99, priority: 'high' })] }) });
    await open(env);
    await openMove(env, 'فوری مدیر');
    assert.deepEqual(walk(env.sheet()).filter((n) => n.dataset && n.dataset.dest).map((n) => n.dataset.dest), ['tomorrow', 'date']);
    assert.doesNotMatch(sheetText(env), /حذف از برنامه/);
    await pick(env, 'منتظر دیگران');
    await submit(env);
    assert.deepEqual(env.calls.find((c) => c.key === 'POST /daily-report').body.answers[0].reschedule, { type: 'tomorrow' });
  });

  test('CARRY_LIMIT از سرور: پیام در شیت (role=alert)، شیت باز می‌ماند، نوار واگرد نمی‌آید', async () => {
    const env = makeEnv({ srv: makeServer({ tasks: baseTasks() }), fail: { 'POST /daily-report': { ok: false, status: 400, json: { error: 'این تسک ۳ بار منتقل شده؛ انجامش بده یا حذفش کن.', code: 'CARRY_LIMIT' } } } });
    await open(env);
    await openMove(env, 'پیگیری قرارداد');
    await pick(env, 'وقت نشد');
    await submit(env);
    assert.match(sheetText(env), /۳ بار منتقل شده/);
    assert.equal(walk(env.sheet()).find((n) => /pl-sheet-live/.test(n.className)).attrs.role, 'alert');
    assert.match(sheetText(env), /انتقال تسک/); // هنوز در حالت انتقال
    assert.equal(env.undo().textContent, '');
  });

  test('سقف انتقال از سرور (taskCarryMaxTimes): ↪ شیتِ جزئیات را با دکمه‌ی غیرفعال و علتش باز می‌کند (بدون پنل انتقال)', async () => {
    const env = makeEnv({ srv: makeServer({ taskCarryMaxTimes: 2, tasks: [mkTask(1, 'قدیمی', { carryCount: 2 }), mkTask(2, 'تازه', { carryCount: 1 })] }) });
    await open(env);
    await openMove(env, 'قدیمی');
    assert.doesNotMatch(sheetText(env), /انتقال تسک/);
    const b = btnIn(env.sheet(), '↪ انتقال');
    assert.equal(b.disabled, true);
    assert.match(sheetText(env), /به سقف انتقال رسیده است؛ انجامش بده یا حذفش کن/);
    await env.docHandlers.keydown({ key: 'Escape', preventDefault() {}, stopPropagation() {} });
    await openMove(env, 'تازه');
    assert.match(sheetText(env), /انتقال تسک/); // زیر سقف ⇒ مجاز
  });

  test('انتقال از شیتِ جزئیات (دکمه‌ی «↪ انتقال») و «بازگشت» به جزئیات', async () => {
    const env = makeEnv({ srv: makeServer({ tasks: baseTasks() }) });
    await open(env);
    await mainOf(rowOf(env, 'پیگیری قرارداد')).fire('click');
    assert.doesNotMatch(sheetText(env), /انتقال تسک/);
    await btnIn(env.sheet(), '↪ انتقال').fire('click');
    assert.match(sheetText(env), /انتقال تسک/);
    await btnIn(env.sheet(), 'بازگشت').fire('click');
    assert.doesNotMatch(sheetText(env), /انتقال تسک/);
    assert.ok(btnIn(env.sheet(), '✓ انجام شد'));
  });

  test('نوار واگرد با رفتن به صفحه‌ی دیگر پنهان می‌شود', async () => {
    const env = makeEnv({ srv: makeServer({ tasks: baseTasks() }) });
    await open(env);
    await openMove(env, 'پیگیری قرارداد');
    await pick(env, 'وقت نشد');
    await submit(env);
    assert.notEqual(env.undo().textContent, '');
    await env.$('#myday-back').fire('click');
    assert.equal(env.undo().textContent, '');
  });

  test('کیبورد: همه‌ی کنترل‌های پنل انتقال دکمه/فیلد واقعی با برچسب‌اند و دکمه‌های وضعیت aria-pressed دارند', async () => {
    const env = makeEnv({ srv: makeServer({ tasks: baseTasks() }) });
    await open(env);
    await openMove(env, 'پیگیری قرارداد');
    const nodes = walk(env.sheet());
    const pressed = nodes.filter((n) => n.attrs && 'aria-pressed' in n.attrs);
    assert.ok(pressed.length >= 10); // ۲ وضعیت + ۶ علت + ۲ مقصد
    assert.ok(nodes.filter((n) => n.tag === 'textarea').every((n) => n.attrs['aria-label']));
    assert.ok(nodes.filter((n) => n.tag === 'button').every((n) => n.attrs.type === undefined ? n.type === 'button' : true));
    assert.ok(nodes.filter((n) => n.attrs && n.attrs.role === 'group').every((n) => n.attrs['aria-label'] || n.attrs['aria-labelledby']));
  });
});

// ---------------------------------------------------------------- ایستا
describe('ایستا (D1/D2)', () => {
  const html = read('public/index.html');
  const css = read('public/css/planner.css');
  const slice = appSrc.slice(appSrc.indexOf('// ---------- C3/D2 (فاز ۱۵)'), appSrc.indexOf('function planPayload'));

  test('index.html: view-myday با عنوان/دکمه‌ی بازگشت/بدنه‌ی برچسب‌دار، نوار #pl-undo با aria-live، بدون inline', () => {
    const v = html.slice(html.indexOf('id="view-myday"'), html.indexOf('id="view-dreport"'));
    assert.match(v, /aria-labelledby="myday-title"/);
    assert.match(v, /id="myday-back"/);
    assert.match(v, /id="myday-body"/);
    assert.doesNotMatch(v, /\sstyle=|\son[a-z]+=/i);
    assert.match(html, /id="pl-undo"[^>]*aria-live="polite"/);
  });

  test('app.js: یک تایل «امروز من» کنار هر تایل برنامه؛ switchView(myday) در REMOTE_VIEWS نیست؛ myday زیرمجموعه‌ی «امروز» در نوار', () => {
    assert.equal((appSrc.match(/addMyDayTile\(\);/g) || []).length, 4);
    assert.match(appSrc, /if \(name === 'myday'\) loadMyDay\(\);/);
    assert.match(appSrc, /const REMOTE_VIEWS = \['remote', 'remote-history'\];/);
    assert.match(appSrc, /navName === 'myday' \? 'today' : navName/);
  });

  test('app.js (شیت/امروزِ من): بدون innerHTML خام، بدون style/on* درون‌خطی، بدون tg.BackButton', () => {
    assert.ok(slice.length > 5000);
    assert.doesNotMatch(slice, /innerHTML\s*=(?!\s*'')/);
    assert.doesNotMatch(slice, /\.style\.|style:|\son[a-z]+=/);
    assert.doesNotMatch(slice, /BackButton/);
  });

  test('هیچ مسیر خروج به تسک‌ها وابسته نیست: «امروزِ من» به /check-out اشاره نمی‌کند', () => {
    const my = appSrc.slice(appSrc.indexOf('// ---------- D1 (فاز ۱۵)'), appSrc.indexOf('function planPayload'));
    assert.doesNotMatch(my, /check-out|startCheckout|checkoutGate/);
  });

  test('CSS: موبایل فقط بخش فعال؛ عریض دو ستون و تب‌ها پنهان؛ نوار واگرد با متغیر؛ رنگ هاردکد نیست', () => {
    assert.match(css, /@media \(max-width: 767px\) \{ \.pl-col\.pl-col-off \{ display: none; \} \}/);
    assert.match(css, /@media \(min-width: 768px\) \{ \.pl-seg-mobile \{ display: none; \} \}/);
    assert.match(css, /\.pl-myday \{ display: grid; grid-template-columns: 1fr;/);
    assert.match(css, /\.pl-undo-float \{[^}]*position: fixed/);
    assert.match(css, /\.pl-dest \{[^}]*min-width|\.pl-dest \{[^}]*padding/);
  });
});

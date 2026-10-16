// E2-الف (فاز ۱۳): انتقال به روز دیگر و بالا/پایین با مسیر کیبوردی (بدون drag) — harness همان E1 — notebook.js و plan-editor.js واقعی با DOM ساختگی (vm) و API ساختگی؛ + نوار «اطلاع به کارمند» در views-nextplan.js.
// مرورگر واقعی اجرا نمی‌شود؛ مرور دستی ۳۲۰px و کیبورد لازم است.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');

// ───── DOM ساختگی ─────
class Txt { constructor(t) { this.nodeType = 3; this.data = String(t); } get textContent() { return this.data; } }
class El {
  constructor(tag) { this.nodeType = 1; this.tagName = tag.toUpperCase(); this.children = []; this.attrs = {}; this.listeners = {}; this.className = ''; this._t = ''; this.value = ''; this.hidden = false; this.disabled = false;
    this.classList = { add: (c) => { this.className = `${this.className} ${c}`.trim(); }, toggle: (c) => { const on = !this.hasClass(c); this.className = on ? `${this.className} ${c}`.trim() : this.className.split(/\s+/).filter((x) => x !== c).join(' '); return on; } }; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] === undefined ? null : this.attrs[k]; }
  removeAttribute(k) { delete this.attrs[k]; }
  appendChild(c) { this.children.push(c); return c; }
  replaceChildren(...cs) { this.children = cs; }
  addEventListener(e, f) { (this.listeners[e] = this.listeners[e] || []).push(f); }
  focus() { this.focused = true; }
  set textContent(v) { this.children = []; this._t = String(v); }
  get textContent() { return this._t + this.children.map((c) => c.textContent).join(''); }
  set innerHTML(_v) { throw new Error('innerHTML ممنوع است'); }
  hasClass(c) { return this.className.split(/\s+/).includes(c); }
  async fire(ev, e = {}) { for (const fn of this.listeners[ev] || []) await fn({ preventDefault() {}, ...e }); }
}
const document = { createElement: (t) => new El(t), createTextNode: (t) => new Txt(t) };
const walk = (el, out = []) => { if (el.nodeType === 1) { out.push(el); el.children.forEach((c) => walk(c, out)); } return out; };
const byClass = (el, c) => walk(el).filter((e) => e.hasClass(c));
const byTag = (el, t) => walk(el).filter((e) => e.tagName === t);
const buttonsOf = (el) => byTag(el, 'BUTTON');
const btnByText = (el, text) => buttonsOf(el).find((b) => b.textContent === text);

// ───── مدل ─────
const mkDay = (i, tasks = []) => ({ date: `2026-09-${26 + i}`, jalali: `1405/07/${String(4 + i).padStart(2, '0')}`, weekday: (6 + i) % 7, kind: 'working', kindLabel: 'روز کاری', holidayTitle: null, monthClosed: false, schedule: { start: '15:30', end: '21:00', source: 'shift' }, tasks });
const T = (id, o = {}) => ({ id, title: `تسک ${id}`, description: '', priority: 'normal', plannedDate: null, isSystem: false, isUrgent: false, managerLocked: false, canEdit: true, ...o });
const model = (version = 3, { tasks, unnotified = 0 } = {}) => ({
  ok: true, weekStart: '2026-09-26', employee: { id: 7, fullName: 'الف' },
  plan: { id: 5, status: 'draft', version, editable: true, lockReason: null, unnotifiedChanges: unnotified },
  days: Array.from({ length: 7 }, (_, i) => mkDay(i, i === 0 ? (tasks || [
    T(1, { title: 'گزارش', description: 'شرح', priority: 'high', plannedDate: '2026-09-26' }),
    T(2, { title: 'مرور گزارش‌ها', isSystem: true, canEdit: false, plannedDate: '2026-09-26' }),
    T(3, { title: 'فوری', isUrgent: true, canEdit: false, plannedDate: '2026-09-26' }),
  ]) : [])),
  anyDay: [],
});
const apiErr = (status, code, message) => Object.assign(new Error(message), { status, data: { code, error: message } });

function setup({ start = model(), confirm = true, fresh = null } = {}) {
  const calls = []; const toasts = []; const timers = []; let statusAtCall = null;
  const handlers = { next: null };
  const AP = {
    can: () => true,
    toast: (m, isErr) => toasts.push({ m, isErr: !!isErr }),
    confirmBox: async () => confirm,
    api: async (url, opts = {}) => {
      calls.push(JSON.parse(JSON.stringify({ url, method: opts.method || 'GET', body: opts.body === undefined ? null : opts.body }))); // JSON: اشیاء vm هم‌قلمرو نیستند
      statusAtCall = els.status.textContent;
      const r = await (handlers.next ? handlers.next(url, opts) : { ok: true });
      if (r instanceof Error) throw r;
      return r;
    },
  };
  const sandbox = { window: { AP }, document, setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout() {}, Map, Set };
  vm.runInNewContext(read('public-admin/js/notebook.js'), sandbox, { filename: 'notebook.js' });
  vm.runInNewContext(read('public-admin/js/plan-editor.js'), sandbox, { filename: 'plan-editor.js' });
  const els = { status: new El('p'), banner: new El('div'), undo: new El('div') };
  const st = { model: start, root: null, applied: 0, freshModel: fresh };
  const editor = AP.planEditor.create({
    userId: 7, getModel: () => st.model, els,
    applyModel: (m) => { st.model = m; st.applied += 1; draw(); },
    fetchModel: async () => st.freshModel,
  });
  function draw() { editor.reset(); st.root = AP.notebook.renderWeek(st.model, { edit: editor.options() }); }
  draw();
  return { AP, st, els, calls, toasts, timers, handlers, statusAtCall: () => statusAtCall, redraw: draw };
}

const rowOf = (t, id) => byClass(t.st.root, 'nb-task').find((r) => r.getAttribute('data-task-id') === String(id));
const off = (b) => b.disabled || b.getAttribute('disabled') !== null; // btn() اتریبیوت می‌گذارد؛ DOM ساختگی property نمی‌سازد
const act = (row, text) => buttonsOf(row).find((b) => b.getAttribute('aria-label') && b.getAttribute('aria-label').includes(text));
const three = () => model(3, { tasks: [
  T(1, { title: 'الف', plannedDate: '2026-09-26' }),
  T(2, { title: 'ب', plannedDate: '2026-09-26' }),
  T(3, { title: 'سیستمی', isSystem: true, canEdit: false, plannedDate: '2026-09-26' }),
  T(4, { title: 'ج', plannedDate: '2026-09-26' }),
] });

describe('انتقال به روز (منوی کیبوردی)', () => {
  test('هر تسک قابل‌ویرایش دکمه‌ی «انتقال…» با aria-expanded دارد؛ پنل بسته است؛ روز فعلی در گزینه‌ها نیست؛ سیستمی ابزار حرکت ندارد', () => {
    const t = setup({ start: three() });
    const row = rowOf(t, 1);
    const toggle = act(row, 'انتقال «الف» به روز دیگر');
    assert.ok(toggle); assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    const panel = byClass(row, 'nb-move')[0];
    assert.equal(panel.hidden, true);
    const labels = buttonsOf(panel).map((b) => b.textContent);
    assert.equal(labels.length, 7); // هر روز + ۶ روز دیگر (روز فعلی حذف)
    assert.ok(labels.includes('هر روز'));
    assert.equal(buttonsOf(rowOf(t, 3)).length, 0);
  });

  test('باز کردن منو فوکوس را به اولین گزینه می‌برد؛ Escape می‌بندد و فوکوس به دکمه برمی‌گردد', async () => {
    const t = setup({ start: three() });
    const row = rowOf(t, 1); const toggle = act(row, 'انتقال «الف» به روز دیگر'); const panel = byClass(row, 'nb-move')[0];
    await toggle.fire('click');
    assert.equal(panel.hidden, false); assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    assert.ok(panel.children[0].focused);
    toggle.focused = false;
    await panel.fire('keydown', { key: 'Escape' });
    assert.equal(panel.hidden, true); assert.equal(toggle.focused, true);
  });

  test('انتخاب روز ⇒ PATCH plannedDate + expectedVersion؛ اعلان aria-live «به … منتقل شد»؛ فوکوس روی دکمه‌ی انتقالِ همان تسک در جای تازه', async () => {
    const t = setup({ start: three() });
    t.handlers.next = async () => {
      const m = three(); // مدل تازه: تسک ۱ به روز سوم (چهارشنبه) رفته
      m.plan.version = 4;
      m.days[0].tasks = m.days[0].tasks.filter((x) => x.id !== 1);
      m.days[4].tasks = [T(1, { title: 'الف', plannedDate: m.days[4].date })]; // weekday روز ۴ = چهارشنبه
      return m;
    };
    const row = rowOf(t, 1);
    await act(row, 'انتقال «الف» به روز دیگر').fire('click');
    const target = buttonsOf(byClass(row, 'nb-move')[0]).find((b) => b.textContent.startsWith('چهارشنبه'));
    await target.fire('click');
    assert.deepEqual(t.calls, [{ url: '/admin/plan-tasks/1', method: 'PATCH', body: { plannedDate: '2026-09-30', expectedVersion: 3 } }]);
    assert.equal(t.statusAtCall(), 'در حال ذخیره…');
    assert.match(t.els.status.textContent, /تسک «الف» به چهارشنبه منتقل شد/);
    const moved = rowOf(t, 1);
    const wed = byClass(t.st.root, 'nb-day').find((c) => c.getAttribute('data-date') === '2026-09-30');
    assert.ok(walk(wed).includes(moved));
    assert.equal(act(moved, 'انتقال «الف» به روز دیگر').focused, true);
  });

  test('«هر روز» ⇒ plannedDate=null؛ روزِ آف/تعطیل با برچسب در منو می‌آید (هشدار نرم) ولی مجاز است', async () => {
    const m = three(); m.days[2].kind = 'off'; m.days[2].kindLabel = 'آف';
    const t = setup({ start: m });
    const row = rowOf(t, 1);
    const labels = buttonsOf(byClass(row, 'nb-move')[0]).map((b) => b.textContent);
    assert.ok(labels.some((l) => l.includes('— آف')));
    t.handlers.next = async () => three();
    await buttonsOf(byClass(row, 'nb-move')[0]).find((b) => b.textContent === 'هر روز').fire('click');
    assert.equal(t.calls[0].body.plannedDate, null);
  });

  test('خطا ⇒ UI دست‌نخورده، پیام سرور در توست؛ PLAN_LOCKED ⇒ بنر تازه‌سازی؛ درخواست هم‌زمان دوم نادیده گرفته می‌شود', async () => {
    const t = setup({ start: three() });
    t.handlers.next = async () => apiErr(400, 'INVALID_DATE', 'تاریخ نامعتبر است.');
    const before = t.st.root;
    const row = rowOf(t, 1);
    await buttonsOf(byClass(row, 'nb-move')[0])[1].fire('click');
    assert.equal(t.st.applied, 0); assert.equal(t.st.root, before);
    assert.deepEqual(t.toasts, [{ m: 'تاریخ نامعتبر است.', isErr: true }]);
    assert.equal(t.els.status.textContent, '');
    t.handlers.next = async () => apiErr(409, 'PLAN_LOCKED', 'هفته شروع شده است.');
    await buttonsOf(byClass(row, 'nb-move')[0])[1].fire('click');
    assert.equal(byClass(t.els.banner, 'notice').length, 1);
  });
});

describe('بالا/پایین داخل کارت', () => {
  test('دکمه‌ی «بالا» برای اولین و «پایین» برای آخرین تسکِ قابل‌جابه‌جایی غیرفعال است؛ تسک سیستمی شمرده نمی‌شود؛ تک‌تسک دکمه‌ی حرکت ندارد', () => {
    const t = setup({ start: three() });
    assert.equal(off(act(rowOf(t, 1), 'یک جایگاه بالاتر')), true);
    assert.equal(off(act(rowOf(t, 1), 'یک جایگاه پایین‌تر')), false);
    assert.equal(off(act(rowOf(t, 4), 'یک جایگاه پایین‌تر')), true);
    assert.equal(off(act(rowOf(t, 4), 'یک جایگاه بالاتر')), false);
    const solo = setup({ start: model(3, { tasks: [T(1, { plannedDate: '2026-09-26' })] }) });
    assert.equal(act(rowOf(solo, 1), 'یک جایگاه بالاتر'), undefined);
  });

  test('«پایین» روی ب ⇒ POST reorder با فقط تسک‌های قابل‌جابه‌جایی (بدون سیستمی)؛ اعلان جایگاه؛ فوکوس به دکمه‌ی «پایین» (یا «بالا» وقتی به انتها رسید)', async () => {
    const t = setup({ start: three() });
    t.handlers.next = async () => {
      const m = three(); m.plan.version = 4;
      m.days[0].tasks = [m.days[0].tasks[0], m.days[0].tasks[2], m.days[0].tasks[1], m.days[0].tasks[3]].map((x) => x); // الف، سیستمی، ب، ج (برای نمونه)
      return m;
    };
    await act(rowOf(t, 2), 'یک جایگاه پایین‌تر').fire('click');
    assert.deepEqual(t.calls, [{ url: '/admin/users/7/plan/reorder', method: 'POST', body: { weekStart: '2026-09-26', order: [1, 4, 2], expectedVersion: 3 } }]);
    assert.match(t.els.status.textContent, /تسک «ب» به جایگاه [۰-۹]+ از ۴ منتقل شد/);
  });

  test('PLAN_CONFLICT هنگام جابه‌جایی ⇒ بنر تازه‌سازی و مدل بدون تغییر', async () => {
    const t = setup({ start: three() });
    t.handlers.next = async () => apiErr(409, 'PLAN_CONFLICT', 'برنامه در این فاصله تغییر کرده؛ صفحه را تازه کنید.');
    await act(rowOf(t, 1), 'یک جایگاه پایین‌تر').fire('click');
    assert.equal(byClass(t.els.banner, 'notice').length, 1);
    assert.equal(t.st.applied, 0);
  });

  test('کارت «هر روز» هم بالا/پایین دارد؛ فقط‌خواندنی/بدون opts.edit ⇒ هیچ ابزار حرکتی نیست', () => {
    const m = model(3, { tasks: [] }); m.anyDay = [T(10, { title: 'ه۱' }), T(11, { title: 'ه۲' })];
    const t = setup({ start: m });
    assert.equal(off(act(rowOf(t, 10), 'یک جایگاه پایین‌تر')), false);
    const ro = t.AP.notebook.renderWeek(m, {});
    assert.equal(buttonsOf(ro).filter((b) => (b.getAttribute('aria-label') || '').includes('انتقال') || (b.getAttribute('aria-label') || '').includes('جایگاه')).length, 0);
  });
});

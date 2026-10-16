// E2-ج (فاز ۱۳): drag لمسی با pointer events (دستگیره‌ی ⠿) با DOM ساختگی — harness همان E1 — notebook.js و plan-editor.js واقعی با DOM ساختگی (vm) و API ساختگی؛ + نوار «اطلاع به کارمند» در views-nextplan.js.
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
    this.classList = { add: (c) => { if (!this.hasClass(c)) this.className = `${this.className} ${c}`.trim(); }, remove: (c) => { this.className = this.className.split(/\s+/).filter((x) => x !== c).join(' '); }, toggle: (c) => { const on = !this.hasClass(c); this.className = on ? `${this.className} ${c}`.trim() : this.className.split(/\s+/).filter((x) => x !== c).join(' '); return on; } }; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] === undefined ? null : this.attrs[k]; }
  removeAttribute(k) { delete this.attrs[k]; }
  appendChild(c) { this.children.push(c); c.parent = this; return c; }
  closest(sel) { const m = /^\[([a-z-]+)\]$/.exec(sel); for (let n = this; n; n = n.parent) if (m && n.attrs && n.attrs[m[1]] !== undefined) return n; return null; }
  replaceChildren(...cs) { this.children = cs; cs.forEach((c) => { c.parent = this; }); }
  addEventListener(e, f) { (this.listeners[e] = this.listeners[e] || []).push(f); }
  focus() { this.focused = true; }
  set textContent(v) { this.children = []; this._t = String(v); }
  get textContent() { return this._t + this.children.map((c) => c.textContent).join(''); }
  set innerHTML(_v) { throw new Error('innerHTML ممنوع است'); }
  hasClass(c) { return this.className.split(/\s+/).includes(c); }
  async fire(ev, e = {}) { for (const fn of this.listeners[ev] || []) await fn({ preventDefault() {}, ...e }); }
}
const scrolls = [];
const document = {
  createElement: (t) => new El(t), createTextNode: (t) => new Txt(t), hit: null, listeners: {},
  addEventListener(e, f) { (this.listeners[e] = this.listeners[e] || []).push(f); },
  removeEventListener(e, f) { this.listeners[e] = (this.listeners[e] || []).filter((x) => x !== f); },
  elementFromPoint() { return this.hit; },
  async fire(e, ev = {}) { for (const f of [...(this.listeners[e] || [])]) await f({ preventDefault() {}, ...ev }); },
  count: () => Object.values(document.listeners).reduce((n, a) => n + a.length, 0),
};
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
  const sandbox = { window: { AP, scrollBy: (x, y) => scrolls.push(y), innerHeight: 800 }, document, setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout() {}, Map, Set };
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
const cardOf = (t, date) => byClass(t.st.root, 'nb-day').find((c) => c.getAttribute('data-date') === date);
const handleOf = (t, id) => byClass(rowOf(t, id), 'nb-task__handle')[0];
const three = () => model(3, { tasks: [
  T(1, { title: 'الف', plannedDate: '2026-09-26' }), T(2, { title: 'ب', plannedDate: '2026-09-26' }),
  T(3, { title: 'سیستمی', isSystem: true, canEdit: false, plannedDate: '2026-09-26' }), T(4, { title: 'ج', plannedDate: '2026-09-26' }),
] });
const touch = (t, id, o = {}) => handleOf(t, id).fire('pointerdown', { pointerType: 'touch', pointerId: 1, ...o });
const reset = () => { document.listeners = {}; document.hit = null; scrolls.length = 0; };

describe('دستگیره‌ی لمسی', () => {
  test('فقط تسک قابل‌ویرایش دستگیره‌ی ⠿ دارد (aria-hidden)؛ سیستمی ندارد؛ بدون opts.edit هیچ دستگیره‌ای نیست', () => {
    reset();
    const t = setup({ start: three() });
    assert.equal(handleOf(t, 1).getAttribute('aria-hidden'), 'true');
    assert.equal(byClass(rowOf(t, 3), 'nb-task__handle').length, 0);
    const ro = t.AP.notebook.renderWeek(three(), {});
    assert.equal(byClass(ro, 'nb-task__handle').length, 0);
    assert.ok(byClass(t.st.root, 'nb-day').every((c) => c.getAttribute('data-zone') !== null));
  });
  test('ماوس نادیده گرفته می‌شود (درگ بومی)؛ در حال ذخیره نیز', async () => {
    reset();
    const t = setup({ start: three() });
    await touch(t, 1, { pointerType: 'mouse' });
    assert.equal(document.count(), 0); assert.ok(!rowOf(t, 1).hasClass('is-dragging'));
  });
});

describe('کشیدن با لمس', () => {
  test('انگشت روی کارت روز دیگر: هایلایت؛ رها کردن ⇒ PATCH تاریخ؛ شنونده‌های document برداشته می‌شود', async () => {
    reset();
    const t = setup({ start: three() });
    t.handlers.next = async () => three();
    await touch(t, 1);
    assert.ok(rowOf(t, 1).hasClass('is-dragging')); assert.equal(document.count(), 3);
    document.hit = cardOf(t, '2026-09-28');
    await document.fire('pointermove', { pointerId: 1, clientX: 10, clientY: 300 });
    assert.ok(cardOf(t, '2026-09-28').hasClass('is-drop-target'));
    await document.fire('pointerup', { pointerId: 1 });
    assert.deepEqual(t.calls, [{ url: '/admin/plan-tasks/1', method: 'PATCH', body: { plannedDate: '2026-09-28', expectedVersion: 3 } }]);
    assert.equal(document.count(), 0);
  });
  test('انگشت روی ردیف دیگر همان روز ⇒ reorder (فقط تسک‌های قابل‌جابه‌جایی)', async () => {
    reset();
    const t = setup({ start: three() });
    t.handlers.next = async () => three();
    await touch(t, 1);
    document.hit = rowOf(t, 4);
    await document.fire('pointermove', { pointerId: 1, clientX: 10, clientY: 300 });
    assert.ok(rowOf(t, 4).hasClass('is-drop-row'));
    await document.fire('pointerup', { pointerId: 1 });
    assert.deepEqual(t.calls, [{ url: '/admin/users/7/plan/reorder', method: 'POST', body: { weekStart: '2026-09-26', order: [2, 4, 1], expectedVersion: 3 } }]);
  });
  test('کارت «هر روز» مقصد معتبر است؛ رها کردن بیرون از ناحیه‌ها یا pointercancel ⇒ لغو بدون درخواست و پاک شدن حالت', async () => {
    reset();
    const m = three(); m.anyDay = [T(10, { title: 'ه' })];
    const t = setup({ start: m });
    t.handlers.next = async () => three();
    await touch(t, 1); document.hit = byClass(t.st.root, 'nb-anyday')[0];
    await document.fire('pointermove', { pointerId: 1, clientX: 1, clientY: 300 }); await document.fire('pointerup', { pointerId: 1 });
    assert.equal(t.calls[0].body.plannedDate, null);
    t.calls.length = 0; reset();
    await touch(t, 1); document.hit = null;
    await document.fire('pointermove', { pointerId: 1, clientX: 1, clientY: 300 }); await document.fire('pointerup', { pointerId: 1 });
    assert.equal(t.calls.length, 0); assert.ok(!rowOf(t, 1).hasClass('is-dragging')); assert.equal(document.count(), 0);
    await touch(t, 1); document.hit = cardOf(t, '2026-09-28');
    await document.fire('pointermove', { pointerId: 1, clientX: 1, clientY: 300 }); await document.fire('pointercancel', { pointerId: 1 });
    assert.equal(t.calls.length, 0); assert.ok(!cardOf(t, '2026-09-28').hasClass('is-drop-target')); assert.equal(document.count(), 0);
  });
  test('pointerId دیگر نادیده گرفته می‌شود؛ شروع دوم هم‌زمان نادیده؛ خطای سرور ⇒ UI دست‌نخورده + بنر', async () => {
    reset();
    const t = setup({ start: three() });
    const before = t.st.root;
    t.handlers.next = async () => apiErr(409, 'PLAN_LOCKED', 'هفته شروع شده است.');
    await touch(t, 1); await touch(t, 2);
    assert.ok(!rowOf(t, 2).hasClass('is-dragging')); assert.equal(document.count(), 3);
    document.hit = cardOf(t, '2026-09-28');
    await document.fire('pointerup', { pointerId: 99 });
    assert.equal(t.calls.length, 0); assert.equal(document.count(), 3);
    await document.fire('pointermove', { pointerId: 1, clientX: 1, clientY: 300 }); await document.fire('pointerup', { pointerId: 1 });
    assert.equal(t.st.root, before); assert.equal(byClass(t.els.banner, 'notice').length, 1);
  });
  test('اسکرول خودکار: نزدیک لبه‌ی بالا/پایین نمایشگر', async () => {
    reset();
    const t = setup({ start: three() });
    await touch(t, 1);
    await document.fire('pointermove', { pointerId: 1, clientX: 1, clientY: 20 });
    await document.fire('pointermove', { pointerId: 1, clientX: 1, clientY: 790 });
    await document.fire('pointermove', { pointerId: 1, clientX: 1, clientY: 400 });
    assert.deepEqual(scrolls, [-14, 14]);
    await document.fire('pointercancel', { pointerId: 1 });
  });
});

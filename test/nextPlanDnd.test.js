// E2-ب (فاز ۱۳): drag & drop بومی (دسکتاپ) با رویدادهای ساختگی — harness همان E1 — notebook.js و plan-editor.js واقعی با DOM ساختگی (vm) و API ساختگی؛ + نوار «اطلاع به کارمند» در views-nextplan.js.
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
const cardOf = (t, date) => byClass(t.st.root, 'nb-day').find((c) => c.getAttribute('data-date') === date);
const three = () => model(3, { tasks: [
  T(1, { title: 'الف', plannedDate: '2026-09-26' }), T(2, { title: 'ب', plannedDate: '2026-09-26' }),
  T(3, { title: 'سیستمی', isSystem: true, canEdit: false, plannedDate: '2026-09-26' }), T(4, { title: 'ج', plannedDate: '2026-09-26' }),
] });
// رویداد درگ ساختگی: dataTransfer + ثبت preventDefault
const ev = () => { const e = { prevented: false, dt: { data: null }, preventDefault() { e.prevented = true; }, stopPropagation() {} }; e.dataTransfer = e.dt; e.dt.setData = (k, v) => { e.dt.data = [k, v]; }; return e; };
const dragStart = async (t, id) => { const e = ev(); await rowOf(t, id).fire('dragstart', e); return e; };

describe('شروع کشیدن', () => {
  test('فقط تسک قابل‌ویرایش draggable است؛ سیستمی/فوری نه؛ dragstart اثر move و setData می‌گذارد و ردیف is-dragging می‌گیرد', async () => {
    const t = setup({ start: three() });
    assert.equal(rowOf(t, 1).getAttribute('draggable'), 'true');
    assert.equal(rowOf(t, 3).getAttribute('draggable'), null);
    const e = await dragStart(t, 1);
    assert.equal(e.dt.effectAllowed, 'move'); assert.deepEqual(e.dt.data, ['text/plain', '1']);
    assert.ok(rowOf(t, 1).hasClass('is-dragging'));
    await rowOf(t, 1).fire('dragend');
    assert.ok(!rowOf(t, 1).hasClass('is-dragging'));
  });
  test('بدون opts.edit (فقط‌خواندنی/hr): نه draggable نه شنونده‌ی درگ', () => {
    const ro = setup({ start: three() }).AP.notebook.renderWeek(three(), {});
    assert.equal(walk(ro).filter((e) => e.getAttribute('draggable') !== null).length, 0);
    assert.equal(byClass(ro, 'nb-day').filter((c) => (c.listeners.drop || []).length).length, 0);
  });
});

describe('رها کردن روی روز دیگر', () => {
  test('dragover روی کارت روز دیگر: preventDefault + هایلایت is-drop-target؛ روی همان روزِ بدون ردیف هدف: بی‌اثر؛ کشیدن بیرونی نادیده', async () => {
    const t = setup({ start: three() });
    const outside = ev(); await cardOf(t, '2026-09-27').fire('dragover', outside);
    assert.equal(outside.prevented, false); // درگ ما در جریان نیست
    await dragStart(t, 1);
    const e = ev(); await cardOf(t, '2026-09-28').fire('dragover', e);
    assert.equal(e.prevented, true); assert.equal(e.dt.dropEffect, 'move');
    assert.ok(cardOf(t, '2026-09-28').hasClass('is-drop-target'));
    const e2 = ev(); await cardOf(t, '2026-09-29').fire('dragover', e2);
    assert.ok(!cardOf(t, '2026-09-28').hasClass('is-drop-target')); assert.ok(cardOf(t, '2026-09-29').hasClass('is-drop-target'));
    const same = ev(); await cardOf(t, '2026-09-26').fire('dragover', same);
    assert.equal(same.prevented, false); assert.ok(!cardOf(t, '2026-09-29').hasClass('is-drop-target'));
  });

  test('drop روی روز دیگر ⇒ PATCH plannedDate؛ روی روز آف ⇒ مجاز با یادآوری نرم در اعلان؛ هایلایت پاک می‌شود', async () => {
    const m = three(); m.days[2].kind = 'off'; m.days[2].kindLabel = 'آف';
    const t = setup({ start: m });
    t.handlers.next = async () => three();
    await dragStart(t, 1);
    await cardOf(t, '2026-09-28').fire('dragover', ev());
    await cardOf(t, '2026-09-28').fire('drop', ev());
    assert.deepEqual(t.calls, [{ url: '/admin/plan-tasks/1', method: 'PATCH', body: { plannedDate: '2026-09-28', expectedVersion: 3 } }]);
    assert.match(t.els.status.textContent, /منتقل شد\. توجه: این روز آف است\./);
  });

  test('کارت «هر روز» ناحیه‌ی رها کردن است ⇒ plannedDate=null', async () => {
    const m = three(); m.anyDay = [T(10, { title: 'ه' })];
    const t = setup({ start: m });
    t.handlers.next = async () => three();
    await dragStart(t, 1);
    await byClass(t.st.root, 'nb-anyday')[0].fire('drop', ev());
    assert.equal(t.calls[0].body.plannedDate, null);
  });

  test('خطای سرور (مثلاً PLAN_LOCKED در همین فاصله) ⇒ UI دست‌نخورده + بنر؛ خطای دیگر ⇒ توست', async () => {
    const t = setup({ start: three() });
    const before = t.st.root;
    t.handlers.next = async () => apiErr(409, 'PLAN_LOCKED', 'هفته شروع شده است.');
    await dragStart(t, 1); await cardOf(t, '2026-09-28').fire('drop', ev());
    assert.equal(t.st.root, before); assert.equal(byClass(t.els.banner, 'notice').length, 1);
    t.handlers.next = async () => apiErr(400, 'INVALID_DATE', 'تاریخ نامعتبر است.');
    await dragStart(t, 1); await cardOf(t, '2026-09-28').fire('drop', ev());
    assert.deepEqual(t.toasts, [{ m: 'تاریخ نامعتبر است.', isErr: true }]);
  });
});

describe('ترتیب داخل یک کارت', () => {
  test('کشیدن «الف» روی ردیف «ج» ⇒ reorder با فقط تسک‌های قابل‌جابه‌جایی؛ هایلایت is-drop-row؛ stopPropagation مانع انتقال دوباره', async () => {
    const t = setup({ start: three() });
    t.handlers.next = async () => three();
    await dragStart(t, 1);
    await rowOf(t, 4).fire('dragover', ev());
    assert.ok(rowOf(t, 4).hasClass('is-drop-row'));
    await rowOf(t, 4).fire('drop', ev());
    assert.deepEqual(t.calls, [{ url: '/admin/users/7/plan/reorder', method: 'POST', body: { weekStart: '2026-09-26', order: [2, 4, 1], expectedVersion: 3 } }]);
    assert.match(t.els.status.textContent, /منتقل شد/);
  });
  test('رها کردن روی خودش، روی تسک سیستمی یا روی فضای خالی همان کارت ⇒ هیچ درخواستی', async () => {
    const t = setup({ start: three() });
    await dragStart(t, 1); await rowOf(t, 1).fire('drop', ev());
    await dragStart(t, 1); const e = ev(); await rowOf(t, 3).fire('dragover', e); assert.equal(e.prevented, false); await rowOf(t, 3).fire('drop', ev());
    await dragStart(t, 1); await cardOf(t, '2026-09-26').fire('drop', ev());
    assert.equal(t.calls.length, 0);
  });
  test('رها کردن ردیفِ روز A روی ردیفِ روز B ⇒ فقط انتقال به روز B (یک درخواست)', async () => {
    const m = three(); m.days[1].tasks = [T(8, { title: 'د', plannedDate: m.days[1].date })];
    const t = setup({ start: m });
    t.handlers.next = async () => three();
    await dragStart(t, 1); await rowOf(t, 8).fire('drop', ev());
    assert.equal(t.calls.length, 1); assert.equal(t.calls[0].url, '/admin/plan-tasks/1'); assert.equal(t.calls[0].body.plannedDate, m.days[1].date);
  });
  test('در حال ذخیره (busy) ⇒ شروع کشیدن لغو می‌شود', async () => {
    const t = setup({ start: three() });
    let release; t.handlers.next = () => new Promise((r) => { release = () => r(three()); });
    const pending = rowOf(t, 2).listeners; // رسم دوباره بعد از موفقیت؛ اینجا فقط busy را فعال می‌کنیم
    const btn = buttonsOf(rowOf(t, 1)).find((b) => (b.getAttribute('aria-label') || '').includes('پایین‌تر'));
    const p = btn.fire('click');
    const e = ev(); await rowOf(t, 2).fire('dragstart', e);
    assert.equal(e.prevented, true);
    release(); await p;
  });
});

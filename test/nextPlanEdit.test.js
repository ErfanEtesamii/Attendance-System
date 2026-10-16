// E1 (فاز ۱۳): ویرایش درجا — notebook.js و plan-editor.js واقعی با DOM ساختگی (vm) و API ساختگی؛ + نوار «اطلاع به کارمند» در views-nextplan.js.
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
const slotOf = (t, i) => byClass(t.st.root, 'nb-edit-slot')[i];
const rowOf = (t, id) => byClass(t.st.root, 'nb-task').find((r) => r.attrs['data-task-id'] === String(id));
const formIn = (el) => byTag(el, 'FORM')[0];
const fieldsOf = (form) => { const [title, description, priority, day] = [...byTag(form, 'INPUT'), ...byTag(form, 'TEXTAREA'), ...byTag(form, 'SELECT')]; return { title, description, priority, day }; };
const submit = (form) => form.fire('submit');

describe('ابزار ویرایش روی دفترچه', () => {
  test('تسک قابل‌ویرایش: دکمه‌های «ویرایش/حذف» با برچسب ARIA؛ سیستمی/فوری: بدون ابزار + برچسب دلیل؛ هر کارت روز «＋ افزودن تسک» دارد', () => {
    const t = setup();
    const r1 = rowOf(t, 1);
    assert.deepEqual(buttonsOf(byClass(r1, 'nb-task__actions')[0]).map((b) => b.textContent), ['انتقال…', 'ویرایش', 'حذف']); // E2-الف: «انتقال…» اضافه شد (▲▼ فقط وقتی بیش از یک تسک قابل‌جابه‌جایی در کارت هست)
    assert.equal(btnByText(r1, 'ویرایش').attrs['aria-label'], 'ویرایش تسک «گزارش»');
    assert.equal(btnByText(r1, 'حذف').attrs['aria-label'], 'حذف تسک «گزارش»');
    assert.equal(buttonsOf(rowOf(t, 2)).length, 0);
    assert.equal(buttonsOf(rowOf(t, 3)).length, 0);
    assert.equal(byClass(rowOf(t, 2), 'nb-why')[0].textContent, 'سیستمی؛ قابل ویرایش نیست');
    assert.equal(byClass(rowOf(t, 3), 'nb-why')[0].textContent, 'فوری؛ فقط از مسیر تسک فوری');
    assert.equal(byClass(t.st.root, 'nb-edit-slot').length, 7);
    assert.ok(buttonsOf(slotOf(t, 0))[0].textContent.includes('افزودن تسک'));
  });

  test('بدون opts.edit (hr / بدون مجوز / فقط‌خواندنی): هیچ ابزار ویرایشی ساخته نمی‌شود', () => {
    const t = setup();
    const root = t.AP.notebook.renderWeek(t.st.model);
    assert.equal(byClass(root, 'nb-edit-slot').length, 0);
    assert.equal(byClass(root, 'nb-task__actions').length, 0);
    assert.equal(byClass(root, 'nb-why').length, 0);
    const root2 = t.AP.notebook.renderWeek(t.st.model, { edit: { enabled: false } });
    assert.equal(byClass(root2, 'nb-edit-slot').length, 0);
  });
});

describe('افزودن', () => {
  test('فرم درجا در همان روز باز می‌شود؛ ذخیره با API granular + expectedVersion؛ نشانگر «در حال ذخیره…» و توست موفقیت؛ مدل جایگزین می‌شود', async () => {
    const t = setup();
    await btnByText(slotOf(t, 1), '＋ افزودن تسک').fire('click');
    const form = formIn(slotOf(t, 1));
    assert.ok(form);
    const f = fieldsOf(form);
    assert.equal(f.day.value, '2026-09-27'); // روز همان کارت
    f.title.value = 'تسک تازه'; f.description.value = 'توضیح'; f.priority.value = 'high';
    t.handlers.next = async () => ({ ...model(4), changed: true });
    await submit(form);
    assert.deepEqual(t.calls, [{ url: '/admin/users/7/plan/tasks', method: 'POST', body: { weekStart: '2026-09-26', title: 'تسک تازه', description: 'توضیح', plannedDate: '2026-09-27', priority: 'high', expectedVersion: 3 } }]);
    assert.equal(t.statusAtCall(), 'در حال ذخیره…');
    assert.equal(t.els.status.textContent, '');
    assert.equal(t.st.model.plan.version, 4);
    assert.equal(t.st.applied, 1);
    assert.deepEqual(t.toasts, [{ m: 'تسک اضافه شد.', isErr: false }]);
  });

  test('«هر روز» ⇒ plannedDate=null؛ عنوان خالی سمت کلاینت رد می‌شود (بدون درخواست)', async () => {
    const t = setup();
    await btnByText(slotOf(t, 0), '＋ افزودن تسک').fire('click');
    const form = formIn(slotOf(t, 0));
    const f = fieldsOf(form);
    f.title.value = '   ';
    await submit(form);
    assert.equal(t.calls.length, 0);
    assert.equal(byClass(form, 'nb-field-error')[0].textContent, 'عنوان تسک الزامی است.');
    assert.equal(f.title.attrs['aria-invalid'], 'true');
    f.title.value = 'x'; f.day.value = '';
    t.handlers.next = async () => model(4);
    await submit(form);
    assert.equal(t.calls[0].body.plannedDate, null);
  });

  test('خطای اعتبارسنجی سرور کنار فیلد نمایش داده می‌شود؛ فرم باز می‌ماند؛ مدل عوض نمی‌شود', async () => {
    const t = setup();
    await btnByText(slotOf(t, 2), '＋ افزودن تسک').fire('click');
    const form = formIn(slotOf(t, 2));
    const f = fieldsOf(form);
    f.title.value = 'طولانی';
    t.handlers.next = async () => apiErr(400, 'TITLE_TOO_LONG', 'عنوان تسک حداکثر ۱۲۰ نویسه است.');
    await submit(form);
    assert.equal(byClass(form, 'nb-field-error')[0].textContent, 'عنوان تسک حداکثر ۱۲۰ نویسه است.');
    assert.equal(byClass(form, 'nb-field-error')[0].attrs.role, 'alert');
    assert.equal(formIn(slotOf(t, 2)), form); // هنوز باز
    assert.equal(t.st.applied, 0);
    t.handlers.next = async () => apiErr(400, 'DATE_OUT_OF_WEEK', 'تاریخ باید داخل همین هفته باشد.');
    await submit(form);
    assert.equal(byClass(form, 'nb-field-error')[3].textContent, 'تاریخ باید داخل همین هفته باشد.'); // فیلد «روز»
  });

  test('ارسال هم‌زمان دوباره نادیده گرفته می‌شود؛ هم‌زمان فقط یک فرم باز است؛ انصراف جای افزودن را برمی‌گرداند', async () => {
    const t = setup();
    await btnByText(slotOf(t, 0), '＋ افزودن تسک').fire('click');
    const form = formIn(slotOf(t, 0));
    fieldsOf(form).title.value = 'الف';
    let release; t.handlers.next = () => new Promise((res) => { release = () => res(model(4)); });
    const p1 = submit(form); const p2 = submit(form);
    release(); await Promise.all([p1, p2]);
    assert.equal(t.calls.length, 1);

    const t2 = setup();
    await btnByText(slotOf(t2, 0), '＋ افزودن تسک').fire('click');
    await btnByText(slotOf(t2, 1), '＋ افزودن تسک').fire('click');
    assert.equal(formIn(slotOf(t2, 0)), undefined); // اولی بسته و دکمه برگشته
    assert.ok(btnByText(slotOf(t2, 0), '＋ افزودن تسک'));
    const form2 = formIn(slotOf(t2, 1));
    await btnByText(form2, 'انصراف').fire('click');
    assert.equal(formIn(slotOf(t2, 1)), undefined);
    assert.ok(btnByText(slotOf(t2, 1), '＋ افزودن تسک'));
  });
});

describe('ویرایش', () => {
  test('فرم با مقدارهای فعلی پر می‌شود؛ PATCH با expectedVersion؛ تغییرنکرده ⇒ پیام «تغییری برای ذخیره نبود»؛ انصراف ردیف را برمی‌گرداند', async () => {
    const t = setup();
    const row = rowOf(t, 1);
    const origCount = row.children.length;
    await btnByText(row, 'ویرایش').fire('click');
    const form = formIn(row);
    const f = fieldsOf(form);
    assert.deepEqual([f.title.value, f.description.value, f.priority.value, f.day.value], ['گزارش', 'شرح', 'high', '2026-09-26']);
    await btnByText(form, 'انصراف').fire('click');
    assert.equal(row.children.length, origCount);
    assert.ok(btnByText(row, 'ویرایش'));

    await btnByText(row, 'ویرایش').fire('click');
    const form2 = formIn(row);
    const f2 = fieldsOf(form2);
    f2.title.value = 'گزارش نهایی'; f2.day.value = '';
    t.handlers.next = async () => ({ ...model(4), changed: true });
    await submit(form2);
    assert.deepEqual(t.calls[0], { url: '/admin/plan-tasks/1', method: 'PATCH', body: { title: 'گزارش نهایی', description: 'شرح', plannedDate: null, priority: 'high', expectedVersion: 3 } });
    assert.deepEqual(t.toasts[0], { m: 'تغییر ذخیره شد.', isErr: false });

    const t3 = setup();
    await btnByText(rowOf(t3, 1), 'ویرایش').fire('click');
    t3.handlers.next = async () => ({ ...model(3), changed: false });
    await submit(formIn(rowOf(t3, 1)));
    assert.equal(t3.toasts[0].m, 'تغییری برای ذخیره نبود.');
  });
});

describe('حذف و واگرد', () => {
  test('بدون تأیید ⇒ بدون درخواست؛ با تأیید ⇒ DELETE با expectedVersion، ردیف هنگام درخواست پنهان؛ بعد نوار «واگرد»', async () => {
    let t = setup({ confirm: false });
    await btnByText(rowOf(t, 1), 'حذف').fire('click');
    assert.equal(t.calls.length, 0);

    t = setup();
    const row = rowOf(t, 1);
    let hiddenAtCall = null;
    t.handlers.next = async () => { hiddenAtCall = row.hidden; return model(4, { tasks: [] }); };
    await btnByText(row, 'حذف').fire('click');
    assert.deepEqual(t.calls[0], { url: '/admin/plan-tasks/1', method: 'DELETE', body: { expectedVersion: 3 } });
    assert.equal(hiddenAtCall, true);
    assert.deepEqual(t.toasts[0], { m: 'تسک حذف شد.', isErr: false });
    assert.ok(t.els.undo.textContent.includes('«گزارش» حذف شد.'));
    assert.ok(btnByText(t.els.undo, 'واگرد'));
  });

  test('واگرد = افزودن دوباره با همان داده و نسخه‌ی تازه؛ نوار بعد از مهلت خودبه‌خود پاک می‌شود', async () => {
    const t = setup();
    t.handlers.next = async () => model(4, { tasks: [] });
    await btnByText(rowOf(t, 1), 'حذف').fire('click');
    t.handlers.next = async () => model(5);
    await btnByText(t.els.undo, 'واگرد').fire('click');
    assert.deepEqual(t.calls[1], { url: '/admin/users/7/plan/tasks', method: 'POST', body: { weekStart: '2026-09-26', title: 'گزارش', description: 'شرح', plannedDate: '2026-09-26', priority: 'high', expectedVersion: 4 } });
    assert.equal(t.toasts.at(-1).m, 'تسک بازگردانی شد.');
    assert.equal(t.els.undo.children.length, 0);

    const t2 = setup();
    t2.handlers.next = async () => model(4, { tasks: [] });
    await btnByText(rowOf(t2, 1), 'حذف').fire('click');
    assert.ok(t2.els.undo.children.length > 0);
    t2.timers.at(-1)(); // مهلت واگرد تمام شد
    assert.equal(t2.els.undo.children.length, 0);
  });

  test('خطای حذف ⇒ ردیف برمی‌گردد و پیام سرور در توست؛ تسکِ ناموجود ⇒ بنر تازه‌سازی', async () => {
    let t = setup();
    let row = rowOf(t, 1);
    t.handlers.next = async () => apiErr(500, 'INTERNAL', 'خطای سرور');
    await btnByText(row, 'حذف').fire('click');
    assert.equal(row.hidden, false);
    assert.deepEqual(t.toasts[0], { m: 'خطای سرور', isErr: true });
    assert.equal(t.st.applied, 0);

    t = setup(); row = rowOf(t, 1);
    t.handlers.next = async () => apiErr(404, 'TASK_NOT_FOUND', 'تسک در برنامه‌ی این کارمند یافت نشد.');
    await btnByText(row, 'حذف').fire('click');
    assert.equal(row.hidden, false);
    assert.ok(btnByText(t.els.banner, 'تازه‌سازی'));
    assert.ok(t.els.banner.textContent.includes('یافت نشد'));
  });
});

describe('PLAN_CONFLICT', () => {
  test('بنر «برنامه تغییر کرده» + تازه‌سازی؛ فرم باز می‌ماند؛ بعد از تازه‌سازی با همان داده دوباره باز می‌شود', async () => {
    const fresh = { ...model(9), plan: { ...model(9).plan } };
    const t = setup({ fresh });
    await btnByText(slotOf(t, 3), '＋ افزودن تسک').fire('click');
    const form = formIn(slotOf(t, 3));
    const f = fieldsOf(form);
    f.title.value = 'نیمه‌کاره'; f.description.value = 'یادداشت من'; f.priority.value = 'low';
    t.handlers.next = async () => apiErr(409, 'PLAN_CONFLICT', 'برنامه در این فاصله تغییر کرده؛ صفحه را تازه کنید.');
    await submit(form);
    assert.ok(t.els.banner.textContent.includes('برنامه در این فاصله تغییر کرده'));
    assert.equal(formIn(slotOf(t, 3)), form); // فرم و داده‌اش دست‌نخورده
    assert.equal(f.title.value, 'نیمه‌کاره');

    await btnByText(t.els.banner, 'تازه‌سازی').fire('click');
    assert.equal(t.st.model.plan.version, 9);
    assert.equal(t.els.banner.children.length, 0);
    const reopened = formIn(slotOf(t, 3)); // در DOM تازه، همان روز
    assert.ok(reopened && reopened !== form);
    const g = fieldsOf(reopened);
    assert.deepEqual([g.title.value, g.description.value, g.priority.value, g.day.value], ['نیمه‌کاره', 'یادداشت من', 'low', '2026-09-29']);
    // ذخیره‌ی مجدد با نسخه‌ی تازه
    t.handlers.next = async () => model(10);
    await submit(reopened);
    assert.equal(t.calls.at(-1).body.expectedVersion, 9);
  });

  test('ویرایشِ تسکی که در این فاصله حذف شده: فرم به‌عنوان «افزودن» با توضیح و داده‌ی حفظ‌شده باز می‌شود', async () => {
    const fresh = model(9, { tasks: [] });
    const t = setup({ fresh });
    await btnByText(rowOf(t, 1), 'ویرایش').fire('click');
    const form = formIn(rowOf(t, 1));
    fieldsOf(form).title.value = 'ویرایش من';
    t.handlers.next = async () => apiErr(409, 'PLAN_CONFLICT', 'برنامه در این فاصله تغییر کرده؛ صفحه را تازه کنید.');
    await submit(form);
    await btnByText(t.els.banner, 'تازه‌سازی').fire('click');
    const reopened = formIn(slotOf(t, 0)); // روز تسک (۲۶) ⇒ slot اول
    assert.ok(reopened);
    assert.equal(fieldsOf(reopened).title.value, 'ویرایش من');
    assert.ok(byClass(reopened, 'nb-form-error')[0].textContent.includes('تسک اصلی دیگر وجود ندارد'));
  });
});

describe('نوار «تغییر اطلاع‌داده‌نشده» و اطلاع به کارمند (views-nextplan)', () => {
  function viewSetup({ perms = ['team.week_view', 'plan.edit_team'], plan = model(3, { unnotified: 2 }), notifyResult = null } = {}) {
    const calls = []; const toasts = []; const listeners = []; const removed = [];
    const AP = {
      views: {}, nav: [], state: { me: { id: 1, role: 'admin' } },
      can: (...p) => p.every((x) => perms.includes(x)),
      esc: (v) => String(v), icon: () => '', badge: (c, t) => `<b>${t}</b>`, avatar: () => '', ROLE: {},
      $: (s, r) => r.querySelector(s), $$: (s, r) => r.querySelectorAll(s),
      view(id, def) { AP.views[id] = def; }, go() {}, refresh() {},
      toast: (m, isErr) => toasts.push({ m, isErr: !!isErr }),
      confirmBox: async () => true,
      api: async (url, opts = {}) => {
        calls.push(JSON.parse(JSON.stringify({ url, method: opts.method || 'GET', body: opts.body === undefined ? null : opts.body })));
        if (url.startsWith('/admin/plan-overview')) return { ok: true, weekStart: '2026-09-26', weekEnd: '2026-10-02', jalaliStart: 'a', jalaliEnd: 'b', isNextWeek: true, minTasks: 1, employees: [{ id: 7, fullName: 'الف', department: null, role: 'employee', planStatus: 'draft', taskCount: 1, needsAttention: true }] };
        if (url.includes('/plan/notify')) { if (notifyResult instanceof Error) throw notifyResult; return notifyResult || { ...model(4, { unnotified: 0 }), notified: true }; }
        if (/\/plan(\?|$)/.test(url)) return plan;
        throw new Error(`پیش‌بینی‌نشده ${url}`);
      },
    };
    const window = { AP, print() {}, addEventListener: (ev, fn) => listeners.push([ev, fn]), removeEventListener: (ev, fn) => removed.push([ev, fn]) };
    const sandbox = { window, document, setTimeout: () => 1, clearTimeout() {}, Map, Set, encodeURIComponent };
    for (const f of ['notebook.js', 'plan-editor.js', 'views-nextplan.js']) vm.runInNewContext(read(`public-admin/js/${f}`), sandbox, { filename: f });
    const els = { '#np-notebook': new El('div'), '#np-status': new El('p'), '#np-banner': new El('div'), '#np-undo': new El('div'), '#np-unnotified': new El('div') };
    const page = { querySelector: (s) => els[s] || null, querySelectorAll: () => [] };
    return { AP, calls, toasts, listeners, removed, els, page };
  }

  test('نوار «۲ تغییر هنوز اطلاع داده نشده» + دکمه؛ اطلاع ⇒ POST notify و نوار صفرشده؛ beforeunload فقط با تغییر اطلاع‌داده‌نشده', async () => {
    const v = viewSetup();
    const { mount } = await v.AP.views.nextplan.render('7');
    mount(v.page);
    const bar = v.els['#np-unnotified'];
    assert.ok(bar.textContent.includes('۲ تغییر هنوز به کارمند اطلاع داده نشده است.'));
    assert.deepEqual(v.listeners.map((l) => l[0]), ['beforeunload']);
    const guard = v.listeners[0][1];
    let prevented = 0; const ev = { preventDefault: () => { prevented += 1; }, returnValue: undefined };
    guard(ev); assert.equal(prevented, 1);

    await btnByText(bar, '📣 اطلاع به کارمند').fire('click');
    assert.deepEqual(v.calls.at(-1), { url: '/admin/users/7/plan/notify', method: 'POST', body: { weekStart: '2026-09-26' } });
    assert.equal(bar.children.length, 0);
    assert.deepEqual(v.toasts.at(-1), { m: 'اعلان برای کارمند ارسال شد.', isErr: false });
    guard(ev); assert.equal(prevented, 1); // دیگر هشدار نمی‌دهد
  });

  test('ترک صفحه با تغییر اطلاع‌داده‌نشده: شنونده برداشته می‌شود و یادآوری توست می‌آید', async () => {
    const v = viewSetup();
    const { mount } = await v.AP.views.nextplan.render('7');
    mount(v.page);
    v.AP.onLeave();
    assert.deepEqual(v.removed.map((l) => l[0]), ['beforeunload']);
    assert.deepEqual(v.toasts.at(-1), { m: '۲ تغییر هنوز به کارمند اطلاع داده نشده است.', isErr: true });
  });

  test('NOTHING_TO_NOTIFY (دیگری قبلاً اطلاع داده): خطا در توست و نوار با وضعیت تازه به‌روز می‌شود', async () => {
    const v = viewSetup({ notifyResult: apiErr(409, 'NOTHING_TO_NOTIFY', 'تغییری برای اطلاع‌رسانی نیست.') });
    const { mount } = await v.AP.views.nextplan.render('7');
    mount(v.page);
    await btnByText(v.els['#np-unnotified'], '📣 اطلاع به کارمند').fire('click');
    assert.equal(v.toasts.at(-1).isErr, true);
    assert.ok(v.calls.some((c) => c.method === 'GET' && /\/plan\?start=2026-09-26/.test(c.url)));
  });

  test('بدون مجوز plan.edit_team (hr): نه نوار، نه ابزار ویرایش، نه شنونده‌ی ترک صفحه', async () => {
    const v = viewSetup({ perms: ['team.week_view'] });
    const { html, mount } = await v.AP.views.nextplan.render('7');
    assert.doesNotMatch(html, /np-unnotified|np-banner|np-undo/);
    mount(v.page);
    assert.equal(byClass(v.els['#np-notebook'], 'nb-edit-slot').length, 0);
    assert.equal(byClass(v.els['#np-notebook'], 'nb-task__actions').length, 0);
    assert.equal(v.listeners.length, 0);
  });

  test('هفته‌ی غیرقابل‌ویرایش (editable=false) با مجوز: ابزار ویرایش و نوار پنهان', async () => {
    const plan = model(3, { unnotified: 2 }); plan.plan.editable = false; plan.plan.lockReason = 'week_started';
    const v = viewSetup({ plan });
    const { mount } = await v.AP.views.nextplan.render('7');
    mount(v.page);
    assert.equal(byClass(v.els['#np-notebook'], 'nb-edit-slot').length, 0);
    assert.equal(v.els['#np-unnotified'].children.length, 0);
  });
});

describe('اتصال (ایستا)', () => {
  test('index.html: plan-editor.js بعد از notebook.js و قبل از views-nextplan.js؛ DELETE فقط با تأیید (confirmBox)', () => {
    const idx = read('public-admin/index.html');
    assert.ok(idx.indexOf('/admin/js/notebook.js') < idx.indexOf('/admin/js/plan-editor.js'));
    assert.ok(idx.indexOf('/admin/js/plan-editor.js') < idx.indexOf('/admin/js/views-nextplan.js'));
    const ed = read('public-admin/js/plan-editor.js');
    const i = ed.indexOf("method: 'DELETE'");
    assert.ok(i > 0 && /AP\.confirmBox/.test(ed.slice(Math.max(0, i - 1200), i)));
    assert.doesNotMatch(ed, /innerHTML|insertAdjacentHTML|\bconfirm\(|\balert\(|\bprompt\(/);
  });
});

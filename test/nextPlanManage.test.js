// E3 (فاز ۱۳): ساعت کاری روز، تسک فوری و یادداشت سرپرست از صفحه‌ی «برنامه هفته بعد» — notebook.js و plan-manage.js واقعی با DOM ساختگی (vm) و API ساختگی.
// مرورگر واقعی اجرا نمی‌شود؛ مرور دستی لازم است.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');

// ───── DOM ساختگی (همان الگوی nextPlanEdit.test.js) ─────
class Txt { constructor(t) { this.nodeType = 3; this.data = String(t); } get textContent() { return this.data; } }
class El {
  constructor(tag) {
    this.nodeType = 1; this.tagName = tag.toUpperCase(); this.children = []; this.attrs = {}; this.listeners = {}; this.className = ''; this._t = ''; this.value = ''; this.hidden = false; this.disabled = false;
    this.classList = { add: (c) => { this.className = `${this.className} ${c}`.trim(); }, toggle: (c) => { const on = !this.hasClass(c); this.className = on ? `${this.className} ${c}`.trim() : this.className.split(/\s+/).filter((x) => x !== c).join(' '); return on; } };
  }
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
const btnByText = (el, text) => byTag(el, 'BUTTON').find((b) => b.textContent === text);

const mkDay = (i, o = {}) => ({ date: `2026-09-${26 + i}`, jalali: `1405/07/${String(4 + i).padStart(2, '0')}`, weekday: (6 + i) % 7, kind: 'working', kindLabel: 'روز کاری', holidayTitle: null, monthClosed: false, schedule: { start: '15:30', end: '21:00', source: 'shift' }, tasks: [], ...o });
const model = ({ comment = null, editable = true, closedIndex = -1, version = 3 } = {}) => ({
  ok: true, weekStart: '2026-09-26', employee: { id: 7, fullName: 'الف' },
  plan: { id: 5, status: 'draft', version, editable, lockReason: editable ? null : 'week_started', supervisorComment: comment, unnotifiedChanges: 0 },
  days: Array.from({ length: 7 }, (_, i) => mkDay(i, i === closedIndex ? { monthClosed: true } : {})), anyDay: [],
});

function load(can = () => true) {
  const calls = []; const toasts = []; const urgentCalls = []; const modalCalls = [];
  const handlers = { next: null };
  const AP = {
    can, state: { me: { id: 1 } },
    toast: (m, isErr) => toasts.push({ m, isErr: !!isErr }),
    api: async (url, opts = {}) => {
      calls.push(JSON.parse(JSON.stringify({ url, method: opts.method || 'GET', body: opts.body === undefined ? null : opts.body })));
      const r = await (handlers.next ? handlers.next(url, opts) : { ok: true });
      if (r instanceof Error) throw r;
      return r;
    },
    openUrgentTaskForm: (...a) => urgentCalls.push(a),
    scheduleTab: { editModal: (...a) => modalCalls.push(a) },
  };
  const sandbox = { window: { AP }, document, setTimeout, clearTimeout, Map, Set, Math };
  vm.runInNewContext(read('public-admin/js/notebook.js'), sandbox, { filename: 'notebook.js' });
  vm.runInNewContext(read('public-admin/js/plan-manage.js'), sandbox, { filename: 'plan-manage.js' });
  return { AP, calls, toasts, urgentCalls, modalCalls, handlers };
}

describe('دفترچه: دکمه‌های روز و کارت یادداشت (notebook.js)', () => {
  test('بدون manage: هیچ دکمه‌ی روز؛ یادداشتِ موجود فقط‌خواندنی؛ بدون یادداشت ⇒ کارت نیست', () => {
    const t = load();
    const a = t.AP.notebook.renderWeek(model());
    assert.equal(byClass(a, 'nb-day-actions').length, 0);
    assert.equal(byClass(a, 'nb-note').length, 0);
    const b = t.AP.notebook.renderWeek(model({ comment: 'برنامه را کامل کن' }));
    assert.equal(byClass(b, 'nb-note__text')[0].textContent, 'برنامه را کامل کن');
    assert.equal(byTag(byClass(b, 'nb-note')[0], 'BUTTON').filter((x) => x.hasClass('nb-btn')).length, 0);
  });

  test('با manage: روی هر روز «ویرایش ساعت کاری» و «⚡ تسک فوری» با برچسب ARIA؛ حتی در هفته‌ی فقط‌خواندنی؛ روز ماه‌بسته بدون دکمه', async () => {
    const t = load();
    const hours = []; const urgent = [];
    const manage = { onHours: (d) => hours.push(d.date), onUrgent: (d) => urgent.push(d.date) };
    const root = t.AP.notebook.renderWeek(model({ editable: false, closedIndex: 2 }), { manage }); // edit ندارد (فقط‌خواندنی)
    const bars = byClass(root, 'nb-day-actions');
    assert.equal(bars.length, 6);
    assert.equal(byClass(root, 'nb-edit-slot').length, 0);
    const first = bars[0];
    assert.match(btnByText(first, '🕒 ویرایش ساعت کاری این روز').attrs['aria-label'], /^ویرایش ساعت کاری /);
    assert.match(btnByText(first, '⚡ تسک فوری').attrs['aria-label'], /^ثبت تسک فوری برای /);
    await btnByText(first, '🕒 ویرایش ساعت کاری این روز').fire('click');
    await btnByText(first, '⚡ تسک فوری').fire('click');
    assert.deepEqual(hours, ['2026-09-26']);
    assert.deepEqual(urgent, ['2026-09-26']);
    // فقط یک مجوز ⇒ فقط همان دکمه
    const only = t.AP.notebook.renderWeek(model(), { manage: { onUrgent: () => {} } });
    assert.equal(byTag(byClass(only, 'nb-day-actions')[0], 'BUTTON').length, 1);
  });

  test('کارت یادداشت قابل‌ویرایش: فرم درجا، ذخیره با متن، خطای سرور کنار فرم و باز ماندن فرم، انصراف', async () => {
    const t = load();
    const saved = [];
    let fail = true;
    const manage = { comment: { onSave: async (text) => { saved.push(text); if (fail) throw new Error('یادداشت حداکثر ۵۰۰ نویسه است.'); } } };
    const root = t.AP.notebook.renderWeek(model(), { manage });
    const card = byClass(root, 'nb-note')[0];
    assert.ok(card, 'بدون یادداشت هم برای مدیر کارت هست');
    assert.equal(byClass(card, 'nb-note__text')[0].textContent, 'یادداشتی ثبت نشده است.');
    await btnByText(card, '＋ افزودن یادداشت').fire('click');
    const form = byTag(card, 'FORM')[0];
    const ta = byTag(form, 'TEXTAREA')[0];
    assert.equal(ta.attrs.maxlength, '500');
    ta.value = 'لطفاً تسک‌ها را کامل کن';
    await form.fire('submit');
    assert.deepEqual(saved, ['لطفاً تسک‌ها را کامل کن']);
    assert.equal(byClass(card, 'nb-field-error')[0].textContent, 'یادداشت حداکثر ۵۰۰ نویسه است.');
    assert.ok(byTag(card, 'FORM')[0], 'فرم باز می‌ماند');
    assert.equal(btnByText(form, 'ذخیره').disabled, false);
    fail = false;
    await form.fire('submit');
    assert.equal(saved.length, 2);
    // انصراف ⇒ برگشت به نما
    await btnByText(form, 'انصراف').fire('click');
    assert.equal(byTag(card, 'FORM').length, 0);
    assert.ok(btnByText(card, '＋ افزودن یادداشت'));
  });

  test('یادداشت موجود: دکمه‌ی «ویرایش یادداشت»؛ فرم با متن فعلی پر می‌شود؛ متن مخرب HTML نمی‌شود', async () => {
    const t = load();
    const evil = '<img src=x onerror=alert(1)>';
    const root = t.AP.notebook.renderWeek(model({ comment: evil }), { manage: { comment: { onSave: async () => {} } } });
    const card = byClass(root, 'nb-note')[0];
    assert.equal(byClass(card, 'nb-note__text')[0].textContent, evil);
    await btnByText(card, 'ویرایش یادداشت').fire('click');
    assert.equal(byTag(card, 'TEXTAREA')[0].value, evil);
  });
});

describe('plan-manage.js: مجوزها و اتصال به مسیرهای موجود', () => {
  const mk = (t, st, can) => {
    if (can) t.AP.can = can;
    return t.AP.planManage.create({ userId: 7, userName: 'الف', getModel: () => st.model, applyModel: (m) => { st.model = m; st.applied += 1; }, fetchModel: async () => st.fresh });
  };

  test('options() فقط کلیدهای مجاز را می‌سازد؛ hr (بدون هر سه مجوز) ⇒ null؛ ردیف خودِ کاربر بدون فوری/یادداشت', () => {
    const t = load();
    const st = { model: model(), applied: 0 };
    assert.deepEqual(Object.keys(mk(t, st).options()).sort(), ['comment', 'onHours', 'onUrgent']);
    assert.equal(mk(t, st, () => false).options(), null);
    assert.deepEqual(Object.keys(mk(t, st, (p) => p === 'schedule.manage').options()), ['onHours']);
    t.AP.state.me.id = 7; // خودِ کارمند
    assert.deepEqual(Object.keys(mk(t, st, () => true).options()), ['onHours']);
  });

  test('ذخیره‌ی یادداشت: PUT با weekStart و متن؛ مدل جایگزین و توست؛ خطا پرتاب می‌شود (فرم باز می‌ماند)', async () => {
    const t = load();
    const st = { model: model(), applied: 0 };
    const mg = mk(t, st);
    t.handlers.next = async () => ({ ...model({ comment: 'سلام', version: 4 }), changed: true });
    await mg.saveComment('سلام');
    assert.deepEqual(t.calls, [{ url: '/admin/users/7/plan/supervisor-comment', method: 'PUT', body: { weekStart: '2026-09-26', comment: 'سلام' } }]);
    assert.equal(st.applied, 1);
    assert.equal(st.model.plan.version, 4);
    assert.deepEqual(t.toasts.map((x) => x.m), ['یادداشت ذخیره شد.']);
    t.handlers.next = async () => ({ ...model({ version: 5 }), changed: true });
    await mg.saveComment('  ');
    assert.equal(t.toasts[1].m, 'یادداشت پاک شد.');
    t.handlers.next = async () => Object.assign(new Error('این کارمند در تیم شما نیست.'), { status: 403 });
    await assert.rejects(() => mg.saveComment('x'), /در تیم شما نیست/);
    assert.equal(st.applied, 2);
  });

  test('تسک فوری: فرم موجود با تاریخ همان روز؛ بعد از ثبت مدل تازه خوانده می‌شود', async () => {
    const t = load();
    const st = { model: model({ editable: false }), applied: 0, fresh: model({ editable: false, version: 9 }) };
    const mg = mk(t, st);
    mg.options().onUrgent({ date: '2026-09-28' });
    const [uid, name, onDone, date] = t.urgentCalls[0];
    assert.deepEqual([uid, name, date], [7, 'الف', '2026-09-28']);
    await onDone();
    assert.equal(st.model.plan.version, 9);
  });

  test('ساعت روز: برنامه‌ی همان یک روز از API B2 خوانده و مودال B2 با کارمند باز می‌شود؛ بعد از ذخیره مدل تازه خوانده می‌شود', async () => {
    const t = load();
    const st = { model: model(), applied: 0, fresh: model({ version: 7 }) };
    const mg = mk(t, st);
    const day = { date: '2026-09-27', effective: { isWorkingDay: true, expectedStart: '15:30', expectedEnd: '21:00' }, schedule: null };
    t.handlers.next = async () => ({ days: [day] });
    await mg.options().onHours({ date: '2026-09-27' });
    assert.equal(t.calls[0].url, '/admin/users/7/schedule?from=2026-09-27&to=2026-09-27');
    const [user, d, done] = t.modalCalls[0];
    assert.deepEqual([user.id, user.fullName, d.date], [7, 'الف', '2026-09-27']);
    await done();
    assert.equal(st.model.plan.version, 7);
    // روز یافت نشد ⇒ توست خطا و مودال باز نمی‌شود
    t.handlers.next = async () => ({ days: [] });
    await mg.openHours({ date: '2026-09-28' });
    assert.equal(t.modalCalls.length, 1);
    assert.equal(t.toasts.at(-1).isErr, true);
  });
});

describe('ساختار فایل‌ها', () => {
  test('index.html: plan-manage.js بعد از plan-editor.js و قبل از views-nextplan.js؛ views-nextplan.js از AP.planManage فقط با گارد استفاده می‌کند', () => {
    const idx = read('public-admin/index.html');
    assert.ok(idx.indexOf('/admin/js/plan-editor.js') < idx.indexOf('/admin/js/plan-manage.js'));
    assert.ok(idx.indexOf('/admin/js/plan-manage.js') < idx.indexOf('/admin/js/views-nextplan.js'));
    assert.match(read('public-admin/js/views-nextplan.js'), /if \(AP\.planManage\) manage = AP\.planManage\.create/);
    assert.ok(!/innerHTML/.test(read('public-admin/js/plan-manage.js').replace(/\/\/.*$/gm, '')), 'بدون innerHTML');
  });
});

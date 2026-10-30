// C2 (فاز ۱۳): AP.notebook.renderWeek با DOM ساختگی (الگوی uiStates/disputePanelUi: vm + sandbox). مرورگر واقعی اجرا نمی‌شود.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'public-admin/js/notebook.js'), 'utf8');

// ───── DOM ساختگیِ کمینه ─────
class Txt { constructor(t) { this.nodeType = 3; this.data = String(t); } get textContent() { return this.data; } }
class El {
  constructor(tag) { this.nodeType = 1; this.tagName = tag.toUpperCase(); this.children = []; this.attrs = {}; this.listeners = {}; this.className = ''; this._t = ''; this.classList = { add: (c) => { this.className = `${this.className} ${c}`.trim(); }, toggle: (c) => { const on = !this.hasClass(c); this.className = on ? `${this.className} ${c}`.trim() : this.className.split(/\s+/).filter((x) => x !== c).join(' '); return on; } }; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] === undefined ? null : this.attrs[k]; }
  appendChild(c) { this.children.push(c); return c; }
  replaceChildren(...cs) { this.children = cs; }
  addEventListener(e, f) { (this.listeners[e] = this.listeners[e] || []).push(f); }
  set textContent(v) { this.children = []; this._t = String(v); }
  get textContent() { return this._t + this.children.map((c) => c.textContent).join(''); }
  set innerHTML(_v) { throw new Error('innerHTML ممنوع است'); }
  hasClass(c) { return this.className.split(/\s+/).includes(c); }
}
const document = { createElement: (t) => new El(t), createTextNode: (t) => new Txt(t) };
const window = {};
vm.runInNewContext(src, { window, document }, { filename: 'notebook.js' });
const nb = window.AP.notebook;

// ───── کمک‌تابع‌های پیمایش ─────
const walk = (el, out = []) => { if (el.nodeType === 1) { out.push(el); el.children.forEach((c) => walk(c, out)); } return out; };
const byClass = (el, c) => walk(el).filter((e) => e.hasClass(c));
const pages = (root) => byClass(root, 'nb-page');
const titleOf = (card) => byClass(card, 'nb-card__title')[0].textContent;
const cardsIn = (page) => page.children.filter((c) => c.hasClass && c.hasClass('nb-card'));

// ───── مدل (شکل خروجی GET /admin/users/:id/plan) ─────
const KINDS = ['working', 'off', 'holiday', 'leave', 'mission', 'working', 'off'];
const LABELS = { working: 'روز کاری', off: 'غیرکاری', holiday: 'تعطیل', leave: 'مرخصی', mission: 'مأموریت', half: 'نیم‌روز' };
const mkDay = (i, o = {}) => {
  const kind = o.kind || KINDS[i % 7];
  return {
    date: `2026-09-${26 + i}`, jalali: `1405/07/${String(4 + i).padStart(2, '0')}`, weekday: ((6 + i) % 7), kind, kindLabel: LABELS[kind],
    holidayTitle: kind === 'holiday' ? 'تعطیل تست' : null, monthClosed: false,
    schedule: { isWorkingDay: kind === 'working', start: kind === 'working' ? '15:30' : null, end: kind === 'working' ? '21:00' : null, plannedMinutes: 330, source: 'shift' },
    tasks: [], ...o,
  };
};
const mkTask = (o = {}) => ({ id: 1, title: 'گزارش', priority: 'normal', isUrgent: false, isSystem: false, managerLocked: false, plannedDate: '2026-09-26', ...o });
const week = (o = {}) => ({ days: Array.from({ length: 7 }, (_, i) => mkDay(i)), anyDay: [], ...o });

describe('renderWeek: چیدمان دو صفحه', () => {
  test('۷ کارت روز با ترتیب مدل؛ ۴ روز اول صفحه‌ی راست (اول) و ۳ روز آخر صفحه‌ی چپ', () => {
    const root = nb.renderWeek(week());
    assert.ok(root.hasClass('nb'));
    const [right, left] = pages(root);
    assert.equal(right.attrs['data-nb-page'], '1');
    assert.equal(left.attrs['data-nb-page'], '2');
    const dayCards = byClass(root, 'nb-day');
    assert.equal(dayCards.length, 7);
    assert.deepEqual(dayCards.map((c) => c.attrs['data-date']), Array.from({ length: 7 }, (_, i) => `2026-09-${26 + i}`));
    assert.equal(byClass(right, 'nb-day').length, 4);
    assert.equal(byClass(left, 'nb-day').length, 3);
    assert.equal(titleOf(dayCards[0]), 'شنبه ۱۴۰۵/۰۷/۰۴'); // نام روز + تاریخ شمسی با ارقام فارسی
    assert.equal(titleOf(dayCards[1]), 'یکشنبه ۱۴۰۵/۰۷/۰۵');
  });

  test('نوار چسب هر نوع روز: آیکون + متن (نه فقط رنگ)؛ رنگ‌ها جدا؛ چیپ ساعت مؤثر', () => {
    const root = nb.renderWeek(week());
    const tapes = byClass(root, 'nb-tape').map((t) => t.textContent);
    assert.deepEqual(tapes.slice(0, 5), ['✔ روز کاری', '☾ غیرکاری', '🎉 تعطیل', '🌴 مرخصی', '🧳 مأموریت']);
    const tones = byClass(root, 'nb-day').slice(0, 5).map((c) => byClass(c, 'nb-tape')[0].className.match(/nb-tape--(\w+)/)[1]);
    assert.deepEqual(tones, ['sage', 'sand', 'rose', 'sky', 'lilac']);
    const first = byClass(root, 'nb-day')[0];
    assert.ok(byClass(first, 'nb-chip').some((c) => c.textContent.includes('۱۵:۳۰ تا ۲۱:۰۰') && c.hasClass('nb-chip--work')));
    assert.ok(byClass(byClass(root, 'nb-day')[2], 'nb-chip').some((c) => c.textContent === 'تعطیل تست'));
  });

  test('تسک‌ها: روی nb-lines؛ نشان اولویت (متن sr-only)، «⚡ فوری»، «🔒 سیستمی/از طرف سرپرست»', () => {
    const d0 = mkDay(0, { tasks: [mkTask({ title: 'الف', priority: 'high' }), mkTask({ title: 'ب', isUrgent: true }), mkTask({ title: 'ج', isSystem: true }), mkTask({ title: 'د', managerLocked: true, priority: 'low' })] });
    const root = nb.renderWeek(week({ days: [d0, ...Array.from({ length: 6 }, (_, i) => mkDay(i + 1))] }));
    const card0 = byClass(root, 'nb-day')[0];
    assert.equal(byClass(card0, 'nb-lines').length, 3); // کادر سرپرست + عادی + سیستمی (کادر روتین خالی لیست ندارد)
    assert.equal(byClass(card0, 'nb-box--mgr').length, 1);
    const rows = byClass(card0, 'nb-task');
    assert.deepEqual(rows.map((r) => byClass(r, 'nb-task__title')[0].textContent), ['د', 'الف', 'ب', 'ج']); // ترتیب نمایش: سرپرست، عادی، سیستمی
    assert.ok(byClass(rows[1], 'nb-sr-only')[0].textContent === 'اولویت بالا');
    assert.ok(byClass(rows[2], 'nb-chip--urgent')[0].textContent.includes('⚡') && byClass(rows[2], 'nb-chip--urgent')[0].textContent.includes('فوری'));
    assert.ok(byClass(rows[3], 'nb-chip--locked')[0].textContent.includes('سیستمی'));
    assert.ok(byClass(byClass(card0, 'nb-box--mgr')[0], 'nb-task').length === 1 && byClass(rows[0], 'nb-chip--locked').length === 0); // داخل کادر سرپرست؛ برچسب تکرار نمی‌شود
    assert.equal(byClass(rows[0], 'nb-sr-only')[0].textContent, 'اولویت کم');
  });

  test('حالت بدون تسک: پیام «تسکی ثبت نشده» برای هر روز', () => {
    const root = nb.renderWeek(week());
    const empties = byClass(root, 'nb-lines--empty');
    assert.equal(empties.length, 7);
    assert.ok(empties.every((e) => e.textContent === 'تسکی ثبت نشده'));
  });
});

describe('renderWeek: کارت‌های جانبی فقط در حضور داده', () => {
  test('بدون summary/یادداشت/هشدار/anyDay و بدون مرخصی/تعطیلی/فوری: فقط کارت‌های روز', () => {
    const days = Array.from({ length: 7 }, (_, i) => mkDay(i, { kind: 'working' }));
    const root = nb.renderWeek({ days, anyDay: [] });
    assert.equal(byClass(root, 'nb-card').length, 7);
    for (const c of ['nb-summary', 'nb-highlights', 'nb-note', 'nb-warnings', 'nb-anyday']) assert.equal(byClass(root, c).length, 0, c);
  });

  test('با داده: خلاصه، مهم‌ها (تعطیل/مرخصی/مأموریت/فوری)، یادداشت، هشدار، هر روز — همه روی صفحه‌ی چپ', () => {
    const days = week().days;
    days[0].tasks = [mkTask({ title: 'فوری‌ترین', isUrgent: true })];
    const root = nb.renderWeek({
      days, anyDay: [mkTask({ id: 9, title: 'تسک بدون تاریخ', plannedDate: null })],
      summary: { workingDays: 3, plannedMinutes: 990, plannedHours: 16.5, tasks: { total: 2, ordinary: 1, urgent: 1, system: 0, undated: 1 }, days: {} },
      warnings: [{ code: 'WORKDAY_WITHOUT_TASK', message: 'برای روز کاری شنبه هیچ تسکی ثبت نشده است.' }],
      plan: { supervisorComment: 'لطفاً گزارش را نهایی کنید.' },
    });
    const [right, left] = pages(root);
    for (const c of ['nb-summary', 'nb-highlights', 'nb-note', 'nb-warnings', 'nb-anyday']) { assert.equal(byClass(right, c).length, 0, `${c} روی صفحه‌ی راست نباید باشد`); assert.equal(byClass(left, c).length, 1, c); }
    assert.ok(byClass(left, 'nb-summary')[0].textContent.includes('۱۶٫۵ ساعت'));
    assert.ok(byClass(left, 'nb-summary')[0].textContent.includes('۳ روز کاری'));
    const hl = byClass(left, 'nb-highlights')[0].textContent;
    for (const s of ['تعطیل (تعطیل تست)', 'مرخصی', 'مأموریت', 'فوری‌ترین']) assert.ok(hl.includes(s), s);
    assert.equal(byClass(left, 'nb-note__text')[0].textContent, 'لطفاً گزارش را نهایی کنید.');
    assert.ok(byClass(left, 'nb-warnings')[0].textContent.includes('هیچ تسکی ثبت نشده'));
    assert.ok(byClass(left, 'nb-anyday')[0].textContent.includes('تسک بدون تاریخ'));
  });
});

describe('renderWeek: هفته‌ی غیر استاندارد و امنیت', () => {
  test('هفته‌ی ۷ روزه با شروع غیر شنبه (دوشنبه): ترتیب مدل حفظ و تقسیم ۴/۳ بدون خرابی', () => {
    const days = Array.from({ length: 7 }, (_, i) => mkDay(i, { weekday: (1 + i) % 7, kind: 'working' }));
    const root = nb.renderWeek({ days, anyDay: [] });
    assert.deepEqual(byClass(root, 'nb-day').map((c) => titleOf(c).split(' ')[0]), ['دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه', 'یکشنبه']);
    const [right, left] = pages(root);
    assert.deepEqual([byClass(right, 'nb-day').length, byClass(left, 'nb-day').length], [4, 3]);
  });

  test('هفته‌ی کوتاه (۵ روز) و بلند (۸ روز) و بدون روز: خطا نمی‌دهد و کارتی گم نمی‌شود', () => {
    for (const n of [1, 4, 5, 8]) {
      const days = Array.from({ length: n }, (_, i) => mkDay(i, { kind: 'working' }));
      assert.equal(byClass(nb.renderWeek({ days, anyDay: [] }), 'nb-day').length, n, `n=${n}`);
    }
    const none = nb.renderWeek({ days: [], anyDay: [] });
    assert.ok(none.textContent.includes('اطلاعات این هفته در دسترس نیست'));
    assert.ok(nb.renderWeek(null).hasClass('nb'));
  });

  test('عنوان/یادداشت/هشدار مخرب فقط متن می‌شوند (هیچ عنصر تزریق‌شده‌ای نیست؛ innerHTML صدا زده نمی‌شود)', () => {
    const evil = '<img src=x onerror=alert(1)>';
    const days = week().days; days[0].tasks = [mkTask({ title: evil })]; days[1].holidayTitle = evil;
    const root = nb.renderWeek({ days, anyDay: [mkTask({ title: evil, plannedDate: null })], warnings: [{ message: evil }], plan: { supervisorComment: evil }, summary: null });
    const tags = new Set(walk(root).map((e) => e.tagName));
    assert.deepEqual([...tags].filter((t) => !['DIV', 'SECTION', 'H2', 'H3', 'P', 'UL', 'LI', 'SPAN', 'BUTTON'].includes(t)), []);
    assert.ok(byClass(root, 'nb-task__title').some((e) => e.textContent === evil));
    assert.equal(byClass(root, 'nb-note__text')[0].textContent, evil);
  });

  test('دکمه‌های صفحه‌ی قبل/بعد (موبایل) و فنر aria-hidden؛ صفحه‌ی اول فعال', () => {
    const root = nb.renderWeek(week());
    const spread = byClass(root, 'nb-spread')[0];
    assert.equal(spread.attrs['data-page'], '1');
    assert.equal(byClass(root, 'nb-spring')[0].attrs['aria-hidden'], 'true');
    const [prev, next] = byClass(root, 'nb-btn');
    assert.deepEqual([prev.textContent, next.textContent], ['صفحه‌ی قبل', 'صفحه‌ی بعد']);
    next.listeners.click[0]();
    assert.equal(spread.attrs['data-page'], '2');
    assert.equal(byClass(root, 'nb-pager__label')[0].textContent, 'صفحه‌ی دوم از ۲');
    prev.listeners.click[0]();
    assert.equal(spread.attrs['data-page'], '1');
  });
});

describe('renderWeek: جمع‌شدن کارت‌ها (موبایل)', () => {
  test('هر کارت دکمه‌ی جمع/باز با aria-expanded دارد؛ کلیک وضعیت را عوض می‌کند؛ collapsible=false آن را حذف می‌کند', () => {
    const root = nb.renderWeek(week());
    const card0 = byClass(root, 'nb-day')[0];
    const toggle = byClass(card0, 'nb-card__toggle')[0];
    assert.equal(toggle.attrs['aria-expanded'], 'true');
    assert.match(toggle.attrs['aria-label'], /جمع\/باز کردن کارت شنبه/);
    toggle.listeners.click[0]();
    assert.ok(card0.hasClass('is-collapsed'));
    assert.equal(toggle.attrs['aria-expanded'], 'false');
    toggle.listeners.click[0]();
    assert.ok(!card0.hasClass('is-collapsed'));
    assert.equal(toggle.attrs['aria-expanded'], 'true');
    assert.equal(byClass(nb.renderWeek(week(), { collapsible: false }), 'nb-card__toggle').length, 0);
  });
});

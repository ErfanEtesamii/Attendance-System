// H4 (پنل): ورودی ساعت قابل‌تایپ — منطق خالص (parse/mask/ارقام) + اتصال به AP.dates.mount و AP.formData با DOM ساختگی.
// رفتار واقعی کیبورد گوشی (visualViewport/scrollIntoView) فقط در مرورگر/گوشی قابل‌بررسی است؛ در این فایل فقط وجودش ایستا چک می‌شود.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const TI = require('../public-admin/js/timeinput.js');
const botTI = require('../src/utils/timeInput.js');

const dir = path.join(__dirname, '..', 'public-admin');
const read = (...p) => fs.readFileSync(path.join(dir, ...p), 'utf8');

describe('TimeInput.toLatinDigits / parse (H4)', () => {
  test('ارقام فارسی و عربی ⇒ لاتین؛ نویسه‌های دیگر دست‌نخورده', () => {
    assert.equal(TI.toLatinDigits('۱۵:۳۰'), '15:30');
    assert.equal(TI.toLatinDigits('١٥:٣٠'), '15:30');
    assert.equal(TI.toLatinDigits('ab۰۹'), 'ab09');
    assert.equal(TI.toLatinDigits(null), '');
    assert.equal(TI.toLatinDigits(undefined), '');
  });

  test('قالب‌های پذیرفته‌شده: 15:30، 1530، 15.30، 15:3، 930، ارقام فارسی/عربی، فاصله و نویسه‌ی جهت‌نما', () => {
    const ok = {
      '15:30': '15:30', '1530': '15:30', '15.30': '15:30', '15:3': '15:03', '930': '09:30', '9:30': '09:30',
      '۱۵:۳۰': '15:30', '۱۵۳۰': '15:30', '١٥:٣٠': '15:30', '۱۵.۳۰': '15:30', '15٫30': '15:30',
      ' 08:05 ': '08:05', '\u200e15:30\u200f': '15:30', '9': '09:00', '15': '15:00', '0000': '00:00', '2359': '23:59',
    };
    for (const [raw, want] of Object.entries(ok)) assert.deepEqual(TI.parse(raw), { ok: true, value: want }, raw);
  });

  test('مرزها: ساعت ۰–۲۳ و دقیقه ۰–۵۹؛ 24:00 و 23:60 نامعتبر با پیام فارسی', () => {
    assert.equal(TI.parse('23:59').ok, true);
    assert.equal(TI.parse('00:00').ok, true);
    const h = TI.parse('24:00');
    assert.equal(h.ok, false);
    assert.equal(h.error, TI.MESSAGES.hour);
    assert.equal(TI.parse('2400').error, TI.MESSAGES.hour);
    assert.equal(TI.parse('99:00').error, TI.MESSAGES.hour);
    const m = TI.parse('23:60');
    assert.equal(m.ok, false);
    assert.equal(m.error, TI.MESSAGES.minute);
    assert.equal(TI.parse('1599').error, TI.MESSAGES.minute);
    assert.match(TI.MESSAGES.hour, /[۰-۹]/);
    assert.match(TI.MESSAGES.minute, /[۰-۹]/);
  });

  test('مقدار نامعتبر ⇒ پیام قالب؛ خالی ⇒ empty (نه خطا)', () => {
    for (const bad of ['abc', '15:30:00', '1:2:3', '12345', '15-30', '15 30 1', '--', ':', '۱۵:۳۰:۱۰']) {
      const r = TI.parse(bad);
      assert.equal(r.ok, false, bad);
      assert.equal(r.error, TI.MESSAGES.format, bad);
    }
    assert.deepEqual(TI.parse(''), { ok: false, empty: true, error: '' });
    assert.deepEqual(TI.parse('   '), { ok: false, empty: true, error: '' });
    assert.deepEqual(TI.parse(null), { ok: false, empty: true, error: '' });
  });
});

describe('TimeInput.mask (H4)', () => {
  test('بعد از دو رقم «:» خودکار؛ حداکثر ۵ نویسه؛ نویسه‌ی غیرمجاز حذف؛ ارقام فارسی ⇒ لاتین', () => {
    const m = TI.mask;
    assert.equal(m(''), '');
    assert.equal(m('1'), '1');
    assert.equal(m('15'), '15');
    assert.equal(m('153'), '15:3');
    assert.equal(m('1530'), '15:30');
    assert.equal(m('15301'), '15:30', 'ارقام اضافه بریده می‌شود');
    assert.equal(m('15:30'), '15:30');
    assert.equal(m('15.30'), '15:30');
    assert.equal(m('۱۵۳۰'), '15:30');
    assert.equal(m('1a5b3c0'), '15:30');
    assert.equal(m('9:5'), '9:5', 'ساعت تک‌رقمی با «:» دست‌نخورده تا blur');
    assert.equal(m('930'), '9:30', 'سه رقم و دو رقم اول > ۲۳ ⇒ ساعت تک‌رقمی');
    assert.equal(m('2500'), '25:00', 'چهار رقم ⇒ همیشه HH:MM؛ ساعت ۲۵ خطا می‌دهد نه ۰۲:۵۰ بی‌صدا');
    assert.equal(m('15::30'), '15:30');
    assert.ok(m('123456789').length <= 5);
  });

  test('ماسک و parse هماهنگ‌اند: parse(mask(x)) همان parse(x) است', () => {
    for (const raw of ['1530', '۱۵۳۰', '15.30', '930', '0805', '2359']) {
      assert.deepEqual(TI.parse(TI.mask(raw)), TI.parse(raw), raw);
    }
  });
});

describe('بات و پنل یک منطق دارند (src/utils/timeInput.js)', () => {
  test('parse/normalizeTime/toLatinDigits همان خروجی TimeInput پنل را می‌دهند', () => {
    for (const raw of ['1530', '۱۵:۳۰', '15.30', '15:3', '25:00', '', 'abc']) {
      assert.deepEqual(botTI.parse(raw), TI.parse(raw), raw);
    }
    assert.equal(botTI.normalizeTime('۰۸۳۰'), '08:30');
    assert.equal(botTI.normalizeTime('2460'), null);
    assert.equal(botTI.toLatinDigits('۲۰۲۷-۰۱-۰۴'), '2027-01-04');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// DOM ساختگی حداقلی: فقط آنچه TimeInput.attach و AP.dates.mount لازم دارند.
// ---------------------------------------------------------------------------------------------------------------------
class FakeEl {
  constructor(doc) {
    this.ownerDocument = doc; this.attrs = {}; this.listeners = {}; this.value = ''; this.type = 'text'; this.hidden = false;
    this.required = false; this.textContent = ''; this.id = ''; this.className = ''; this.validity = '';
    const set = new Set();
    this.classList = { add: (c) => set.add(c), remove: (c) => set.delete(c), contains: (c) => set.has(c) };
    this.after = (n) => { this.next = n; };
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  setCustomValidity(m) { this.validity = m; }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  dispatchEvent(e) { (this.listeners[e.type] || []).forEach((fn) => fn(e)); return true; }
  fire(type) { this.dispatchEvent({ type, stopPropagation() {}, stopImmediatePropagation() {}, target: this }); }
  /** شبیه‌سازی تایپ کاربر: مقدار خام + رویداد input */
  type_(raw) { this.value = raw; this.fire('input'); }
}

function loadCore() {
  const noop = () => {};
  const stub = new FakeEl(null);
  const doc = { activeElement: null, defaultView: {}, addEventListener: noop, querySelector: () => stub, querySelectorAll: () => [] };
  doc.createElement = (tag) => {
    const e = new FakeEl(doc);
    if (tag === 'span') {
      Object.defineProperty(e, 'innerHTML', {
        set() { e.firstChild = new FakeEl(doc); e.lastChild = new FakeEl(doc); },
      });
    }
    return e;
  };
  // JalaliDatepicker ساختگی: فقط getValue و onChange
  const dps = [];
  const DP = {
    attach(el, o) {
      const dp = { value: (o && o.value) || '', getValue() { return dp.value; }, pick(iso) { dp.value = iso; if (o.onChange) o.onChange(); } };
      dps.push(dp);
      return dp;
    },
  };
  const win = { Jalali: {}, JalaliDatepicker: DP, TimeInput: TI, addEventListener: noop };
  const root = { list: [], querySelectorAll(sel) { return this.list.filter((e) => e.__sel === sel); } };
  vm.runInNewContext(read('js', 'core.js'), {
    window: win, document: doc, location: { hash: '', href: 'http://localhost/' }, history: { replaceState: noop },
    URL, URLSearchParams, Intl, Event, fetch: noop, console, setTimeout, clearTimeout,
  });
  return { AP: win.AP, doc, root, dps };
}

describe('AP.dates.mount: ساعت قابل‌تایپ و همگام‌سازی با ISO پنهان (H4)', () => {
  function mountDt(initial = '') {
    const ctx = loadCore();
    const hidden = new FakeEl(ctx.doc);
    hidden.type = 'datetime-local';
    hidden.value = initial;
    hidden.__sel = 'input[type="datetime-local"]';
    let changes = 0;
    hidden.addEventListener('change', () => { changes += 1; });
    ctx.root.list.push(hidden);
    ctx.AP.dates.mount(ctx.root);
    // wrap همان span ساختگی است که mount ساخته؛ فرزندانش را از after() نمی‌توان گرفت، پس از dpها و hidden.next می‌گیریم
    const wrap = hidden.next;
    return { ...ctx, hidden, timeEl: wrap.lastChild, dateEl: wrap.firstChild, dp: ctx.dps[0], changes: () => changes };
  }

  test('مقدار اولیه‌ی ISO ⇒ ساعت در فیلد متنی، type=text با inputmode=numeric و ویژگی‌های ورودی', () => {
    const { hidden, timeEl } = mountDt('2027-01-04T08:05');
    assert.equal(hidden.type, 'hidden');
    assert.equal(timeEl.value, '08:05');
    assert.equal(timeEl.type, 'text');
    assert.equal(timeEl.getAttribute('inputmode'), 'numeric');
    assert.equal(timeEl.getAttribute('pattern'), '[0-9]{2}:[0-9]{2}');
    assert.equal(timeEl.getAttribute('maxlength'), '5');
    assert.equal(timeEl.getAttribute('dir'), 'ltr');
    assert.equal(timeEl.getAttribute('placeholder'), 'HH:MM');
    assert.equal(timeEl.getAttribute('autocomplete'), 'off');
  });

  test('تایپ 1530 / ارقام فارسی ⇒ ماسک 15:30 و ISO پنهان بلافاصله «YYYY-MM-DDT15:30» (بدون انتظار برای blur)', () => {
    const { hidden, timeEl } = mountDt('2027-01-04T08:05');
    timeEl.type_('1530');
    assert.equal(timeEl.value, '15:30');
    assert.equal(hidden.value, '2027-01-04T15:30');
    timeEl.type_('۲۰۴۵');
    assert.equal(timeEl.value, '20:45');
    assert.equal(hidden.value, '2027-01-04T20:45');
  });

  test('«15:3» ⇒ ISO با 15:03؛ بعد از blur متن هم به 15:03 نرمال می‌شود', () => {
    const { hidden, timeEl } = mountDt('2027-01-04T08:05');
    timeEl.type_('15:3');
    assert.equal(hidden.value, '2027-01-04T15:03');
    timeEl.fire('blur');
    assert.equal(timeEl.value, '15:03');
  });

  test('مقدار نامعتبر ⇒ ISO خالی (بی‌صدا ذخیره نمی‌شود)، پیام خطای فارسی، aria-invalid؛ اصلاح ⇒ خطا پاک می‌شود', () => {
    const { hidden, timeEl, doc } = mountDt('2027-01-04T08:05');
    timeEl.type_('2500');
    assert.equal(hidden.value, '', 'ساعت ۲۵ ⇒ ISO خالی');
    timeEl.fire('blur');
    assert.equal(timeEl.getAttribute('aria-invalid'), 'true');
    assert.equal(timeEl.validity, TI.MESSAGES.hour);
    const err = timeEl.next;
    assert.equal(err.hidden, false);
    assert.equal(err.textContent, TI.MESSAGES.hour);
    assert.equal(err.getAttribute('role'), 'alert');
    assert.equal(timeEl.getAttribute('aria-describedby'), err.id);

    timeEl.type_('1959');
    timeEl.fire('blur');
    assert.equal(timeEl.getAttribute('aria-invalid'), null);
    assert.equal(timeEl.validity, '');
    assert.equal(err.hidden, true);
    assert.equal(hidden.value, '2027-01-04T19:59');
    assert.ok(doc);
  });

  test('خالی‌کردن ساعت ⇒ ISO خالی و بدون پیام خطا؛ تغییر تاریخ شمسی ISO را با همان ساعت می‌سازد', () => {
    const { hidden, timeEl, dp } = mountDt('2027-01-04T08:05');
    timeEl.type_('');
    timeEl.fire('blur');
    assert.equal(hidden.value, '');
    assert.equal(timeEl.next.hidden, true);
    timeEl.type_('1000');
    dp.pick('2027-01-05');
    assert.equal(hidden.value, '2027-01-05T10:00');
  });

  test('رویداد change فقط وقتی مقدار ISO واقعاً عوض شده می‌رسد (تایپ ناقص change اضافه نمی‌سازد)', () => {
    const { timeEl, changes } = mountDt('2027-01-04T08:05');
    const base = changes();
    timeEl.type_('1'); // ISO نامعتبر/خالی ⇒ یک بار تغییر (۰۸:۰۵ ⇒ ۰۱:۰۰ معتبر است: «1» ⇒ ساعت تمام)
    const afterFirst = changes();
    timeEl.type_('15'); // ۱۵:۰۰
    timeEl.type_('153'); // ۱۵:۰۳ (ماسک «15:3»)
    timeEl.type_('1530');
    assert.ok(changes() > base);
    const settled = changes();
    timeEl.fire('blur'); // مقدار همان است ⇒ change اضافه نه
    assert.equal(changes(), settled);
    assert.ok(afterFirst >= base);
  });

  test('ورودی تکیِ type=time (مثل شروع شیفت) هم متنیِ قابل‌تایپ می‌شود', () => {
    const ctx = loadCore();
    const el = new FakeEl(ctx.doc);
    el.type = 'time'; el.value = '15:30:00'; el.__sel = 'input[type="time"]';
    ctx.root.list.push(el);
    ctx.AP.dates.mount(ctx.root);
    assert.equal(el.type, 'text');
    assert.equal(el.value, '15:30', 'ثانیه حذف می‌شود');
    assert.equal(el.getAttribute('inputmode'), 'numeric');
    el.type_('۲۱۰۰');
    assert.equal(el.value, '21:00');
  });
});

describe('AP.formData: ساعت تایپی همیشه HH:MM می‌رود (H4)', () => {
  test('«1:30» و «15:3» نرمال، نامعتبر همان متن خام (تا اعتبارسنجی سرور رد کند)، فیلد عادی دست‌نخورده', () => {
    const { AP, doc } = loadCore();
    const mk = (name, value, isTime) => { const e = new FakeEl(doc); e.name = name; e.value = value; if (isTime) e.classList.add('time-in'); return e; };
    const form = { querySelectorAll: () => [mk('a', '1:30', true), mk('b', '15:3', true), mk('c', '99:99', true), mk('d', '1:30', false), mk('e', '', true)] };
    assert.deepEqual({ ...AP.formData(form) }, { a: '01:30', b: '15:03', c: '99:99', d: '1:30', e: '' });
  });
});

describe('اتصال ایستا (H4)', () => {
  test('index.html: timeinput.js قبل از core.js؛ CSS ورودی ساعت و --kb مودال؛ visualViewport/scrollIntoView در TimeInput', () => {
    const html = read('index.html');
    assert.ok(html.indexOf('/admin/js/timeinput.js') > 0);
    assert.ok(html.indexOf('/admin/js/timeinput.js') < html.indexOf('/admin/js/core.js'));
    assert.match(read('css', 'datepicker.css'), /\.time-in\b/);
    assert.match(read('css', 'datepicker.css'), /\.time-err\b/);
    assert.match(read('css', 'style.css'), /var\(--kb, 0px\)/);
    const src = read('js', 'timeinput.js');
    assert.match(src, /visualViewport/);
    assert.match(src, /scrollIntoView/);
    assert.doesNotMatch(src, /fetch\(|XMLHttpRequest|https?:\/\//, 'بدون شبکه/CDN');
  });

  test('فرم‌های ساعت‌دار پنل AP.dates.mount را صدا می‌زنند (اصلاح رکورد/استراحت، شیفت، برنامه‌ی روز، تنظیمات، تسک فوری)', () => {
    for (const f of ['views-ops.js', 'views-shifts.js', 'views-schedule.js', 'views-admin.js', 'views-teamreports.js']) {
      assert.match(read('js', f), /AP\.dates\.mount\(/, f);
    }
  });
});

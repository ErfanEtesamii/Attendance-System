// S3-11: شمسی در پنل. اجرای واقعی core.js با window ساختگی (بدون مرورگر) + بررسی ساختار صفحه‌ها.
// رفتار DOM (datepicker روی فیلتر/فرم، جفت تاریخ+ساعت، ارسال ISO به API) در مرورگر واقعی تست شد؛ شرح در CHANGELOG.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const J = require('../public-admin/js/jalali.js');
const DP = require('../public-admin/js/datepicker.js');

const dir = path.join(__dirname, '..', 'public-admin');
const read = (...p) => fs.readFileSync(path.join(dir, ...p), 'utf8');

function loadCore() {
  const noop = () => {};
  const el = { addEventListener: noop, classList: { add: noop, remove: noop, toggle: noop }, style: {} };
  const document = { querySelector: () => el, querySelectorAll: () => [], addEventListener: noop, createElement: () => el };
  const win = { Jalali: J, JalaliDatepicker: DP, addEventListener: noop };
  vm.runInNewContext(read('js', 'core.js'), {
    window: win, document, location: { hash: '', href: 'http://localhost/' }, history: { replaceState: noop },
    URL, URLSearchParams, Intl, fetch: noop, console, setTimeout, clearTimeout,
  });
  return win.AP;
}

const p2 = (n) => String(n).padStart(2, '0');
const localIso = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;

describe('قالب‌بندی شمسی در پنل (S3-11a)', () => {
  const { fmt } = loadCore();

  test('dateLong / dateFull: مرز کبیسه (۳۰ اسفند ۱۴۰۳ ← ۱ فروردین ۱۴۰۴)، ورودی با ساعت، نامعتبر و خالی', () => {
    assert.equal(fmt.dateLong('2025-03-20'), '۳۰ اسفند ۱۴۰۳');
    assert.equal(fmt.dateLong('2025-03-21'), '۱ فروردین ۱۴۰۴');
    assert.equal(fmt.dateLong('2026-10-07'), '۱۵ مهر ۱۴۰۵');
    assert.equal(fmt.dateLong('2026-10-07 12:30:00'), '۱۵ مهر ۱۴۰۵', 'datetime دیتابیس: فقط بخش تاریخ');
    assert.equal(fmt.dateFull('2026-10-07'), 'چهارشنبه، ۱۵ مهر ۱۴۰۵');
    assert.equal(fmt.dateLong('not-a-date'), 'not-a-date');
    assert.equal(fmt.dateLong('2026-02-31'), '2026-02-31', 'میلادی نامعتبر');
    for (const f of [fmt.date, fmt.dateLong, fmt.dateFull]) { assert.equal(f(''), '—'); assert.equal(f(null), '—'); }
  });

  test('date: روز هفته + روز + ماه؛ سال فقط وقتی با سال شمسی جاری فرق دارد', () => {
    assert.equal(fmt.date('2020-03-20'), 'جمعه، ۱ فروردین ۱۳۹۹');
    const cur = J.isoToJalali(localIso(new Date()));
    const sameYear = J.jalaliToIso(cur.jy, 1, 1);
    assert.equal(fmt.date(sameYear), `${J.weekdayName(sameYear)}، ۱ فروردین`, 'بدون سال');
  });

  test('dateTime: لحظه‌ی UTC دیتابیس ⇒ تاریخ شمسی + ساعت محلی HH:MM با ارقام فارسی', () => {
    const d = new Date('2026-10-07T10:30:00Z');
    const expected = `${J.formatIso(localIso(d))} ${J.toFaDigits(`${p2(d.getHours())}:${p2(d.getMinutes())}`)}`;
    assert.equal(fmt.dateTime('2026-10-07 10:30:00'), expected);
    assert.equal(fmt.dateTime('2026-10-07T10:30:00Z'), expected);
    assert.match(fmt.dateTime('2026-10-07 10:30:00'), /^[۰-۹]{4}\/[۰-۹]{2}\/[۰-۹]{2} [۰-۹]{2}:[۰-۹]{2}$/);
    assert.equal(fmt.dateTime(''), '—');
    assert.equal(fmt.dateTime('garbage'), '—');
  });

  test('today/daysAgo: به وقت محلی (نه UTC)', () => {
    assert.equal(fmt.today(), localIso(new Date()));
    assert.equal(fmt.daysAgo(0), fmt.today());
    const d = new Date(); d.setDate(d.getDate() - 6);
    assert.equal(fmt.daysAgo(6), localIso(d));
  });
});

describe('AP.dates (S3-11a)', () => {
  const { dates } = loadCore();

  test('combine/split: قالب «YYYY-MM-DDTHH:MM»؛ نیمه‌کاره ⇒ خالی', () => {
    assert.equal(dates.combine('2026-10-07', '09:05'), '2026-10-07T09:05');
    assert.equal(dates.combine('', '09:05'), '');
    assert.equal(dates.combine('2026-10-07', ''), '');
    assert.equal(dates.combine('2026-10-07', '9:5'), '');
    assert.deepEqual({ ...dates.split('2026-10-07T09:05') }, { date: '2026-10-07', time: '09:05' });
    assert.deepEqual({ ...dates.split('') }, { date: '', time: '' });
    assert.deepEqual({ ...dates.split(null) }, { date: '', time: '' });
  });
});

describe('اتصال شمسی به صفحه‌ها (S3-11a)', () => {
  test('index.html: datepicker.css و jalali.js/datepicker.js قبل از core.js', () => {
    const html = read('index.html');
    assert.match(html, /href="\/admin\/css\/datepicker\.css"/);
    const at = (s) => html.indexOf(`/admin/js/${s}`);
    assert.ok(at('jalali.js') > 0 && at('jalali.js') < at('datepicker.js') && at('datepicker.js') < at('core.js'));
  });

  test('تردد: فیلتر، مودال اصلاح و ثبت دستی همه AP.dates.mount را صدا می‌زنند؛ هیچ toLocaleDateString/toLocaleString در فایل‌های این گروه نیست', () => {
    const ops = read('js', 'views-ops.js');
    assert.equal((ops.match(/AP\.dates\.mount\(/g) || []).length >= 3, true);
    assert.match(ops, /AP\.dates\.mount\(form\)[^\n]*\n\s*const apply/, 'قبل از بستن listenerهای فیلتر');
    for (const f of ['core.js', 'views-main.js']) assert.doesNotMatch(read('js', f), /toLocale(Date)?String\(/, f);
    assert.doesNotMatch(ops.replace(/toLocaleTimeString/g, ''), /toLocale(Date)?String\(/);
  });
});

describe('اتصال شمسی به بقیه‌ی صفحه‌ها (S3-11b)', () => {
  test('هر input[type=date] در views-ops/views-admin در همان فایل AP.dates.mount دارد؛ فیلترها قبل از listenerها mount می‌شوند', () => {
    for (const f of ['views-ops.js', 'views-admin.js']) {
      const src = read('js', f);
      assert.ok(/type="date"/.test(src) && /AP\.dates\.mount\(/.test(src), f);
    }
    const adm = read('js', 'views-admin.js');
    assert.match(adm, /AP\.dates\.mount\(form\)[^\n]*\n\s*(let t;|\$\$\('input, select', form\))/);
    assert.equal((adm.match(/AP\.dates\.mount\(/g) || []).length, 3, 'گزارش‌ها، تعطیلات، audit');
    const ops = read('js', 'views-ops.js');
    assert.match(ops, /name="ntDate"/);
    assert.match(ops, /input\[name="ntDate"\][^\n]*addEventListener\('change'/, 'مرور شبانه ISO را از input مخفی می‌خواند');
  });

  test('همه‌ی input[type=time] قالبی (تنظیمات، تعطیلات، شیفت‌ها) dir=ltr دارند؛ بدون toLocaleDateString در فایل‌های پنل', () => {
    for (const f of ['views-admin.js', 'views-shifts.js']) {
      for (const m of read('js', f).match(/<input type="time"[^>]*>/g) || []) assert.match(m, /dir="ltr"/, `${f}: ${m}`);
    }
    for (const f of ['core.js', 'views-main.js', 'views-ops.js', 'views-admin.js', 'views-shifts.js']) {
      assert.doesNotMatch(read('js', f), /toLocale(Date)?String\(/, f);
    }
    assert.doesNotMatch(read('js', 'views-admin.js'), /تاریخ \(میلادی\)/);
  });
});

// نوار بازه‌ی مشترک پنل (range-bar.js): چیپ‌های آماده، تشخیص چیپ فعال، خلاصه‌ی شمسی، اعتبارسنجی و سیم‌کشی صفحه‌ها.
// منطق خالص با window ساختگی + Jalali واقعی؛ DOM لازم نیست (bind در مرورگر).
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const dir = path.join(__dirname, '..', 'public-admin');
const read = (...p) => fs.readFileSync(path.join(dir, ...p), 'utf8');

function load(today = '2026-11-04') {
  const J = require('../public-admin/js/jalali.js');
  const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const addDays = (iso, n) => { const g = J.parseIso(iso); const d = new Date(Date.UTC(g.gy, g.gm - 1, g.gd + n)); return d.toISOString().slice(0, 10); };
  const AP = {
    esc, icon: () => '<svg></svg>',
    fmt: { today: () => today, daysAgo: (n) => addDays(today, -n), dateLong: (iso) => J.formatIso(iso, { long: true }) },
    toast() {},
  };
  const win = { AP, Jalali: J };
  vm.runInNewContext(read('js', 'range-bar.js'), { window: win, document: {}, Event: class {} });
  return { AP, J };
}

describe('نوار بازه (range-bar.js)', () => {
  test('چیپ‌های آماده بازه‌ی درست می‌دهند (امروز، ۷/۳۰ روز، این ماه، ماه قبل)', () => {
    const { AP } = load('2026-11-04'); // ۱۳ آبان ۱۴۰۵
    const P = AP.rangeBar.PRESETS;
    const R = (k) => JSON.parse(JSON.stringify(P[k].range())); // objectهای vm هم‌دنیای تست نیستند
    assert.deepEqual(R('today'), { from: '2026-11-04', to: '2026-11-04' });
    assert.deepEqual(R('7'), { from: '2026-10-29', to: '2026-11-04' });
    assert.deepEqual(R('30'), { from: '2026-10-06', to: '2026-11-04' }); // ۱۴ مهر تا ۱۳ آبان؛ همان بازه‌ی اسکرین‌شات
    assert.deepEqual(R('month'), { from: '2026-10-23', to: '2026-11-04' }); // ۱ آبان
    assert.deepEqual(R('lastMonth'), { from: '2026-09-23', to: '2026-10-22' }); // مهر کامل (۳۰ روز)
  });

  test('چیپ فعال خودکار تشخیص داده می‌شود؛ بازه‌ی دلخواه هیچ چیپی را فعال نمی‌کند', () => {
    const { AP } = load();
    const on = (h) => (h.match(/rb-chip is-active" data-rb-preset="([^"]+)"/) || [])[1];
    assert.equal(on(AP.rangeBar.html({ from: '2026-10-06', to: '2026-11-04' })), '30');
    assert.equal(on(AP.rangeBar.html({ from: '2026-10-07', to: '2026-11-04' })), undefined);
    assert.equal(on(AP.rangeBar.html({ from: '2026-11-04', to: '2026-11-04', presets: ['7', 'today'] })), 'today');
  });

  test('خلاصه: تاریخ شمسی + تعداد روز؛ نامعتبر و خالی پیام فارسی', () => {
    const { AP } = load();
    const s = AP.rangeBar.summaryHtml('2026-10-06', '2026-11-04');
    assert.match(s, /۱۴ مهر ۱۴۰۵/);
    assert.match(s, /۱۳ آبان ۱۴۰۵/);
    assert.match(s, /۳۰<\/strong> روز/);
    assert.match(AP.rangeBar.summaryHtml('2026-11-04', '2026-10-01'), /بعد از تاریخ پایان/);
    assert.match(AP.rangeBar.summaryHtml('', ''), /انتخاب نشده/);
    assert.match(AP.rangeBar.summaryHtml('2026-11-04', '2026-11-04'), /۱<\/strong> روز/);
  });

  test('html: ورودی‌های from/to برای فرم‌های قدیمی، منوی ماه کامل اختیاری، بدون استایل درون‌خطی', () => {
    const { AP } = load();
    const h = AP.rangeBar.html({ from: '2026-10-06', to: '2026-11-04', months: 12 });
    assert.match(h, /name="from"[^>]*value="2026-10-06"/);
    assert.match(h, /name="to"[^>]*value="2026-11-04"/);
    assert.equal((h.match(/<option value="\d{4}-\d{2}-\d{2}"/g) || []).length, 12);
    assert.doesNotMatch(h, /\sstyle=/);
    assert.doesNotMatch(AP.rangeBar.html({ from: '', to: '', fields: false }), /name="from"/);
  });

  test('سیم‌کشی: همه‌ی صفحه‌های دارای بازه از نوار مشترک استفاده می‌کنند و دکمه‌های data-range قدیمی نمانده‌اند', () => {
    for (const f of ['views-ops.js', 'views-admin.js', 'views-teamreports.js']) assert.match(read('js', f), /AP\.rangeBar\.html\(/, f);
    assert.match(read('js', 'views-main.js'), /AP\.rangeBar\.html\([^)]*months/, 'پرونده‌ی کارمند: ماه کامل');
    assert.match(read('js', 'views-performance.js'), /rb-chip pf-range/);
    for (const f of ['views-ops.js', 'views-admin.js']) assert.doesNotMatch(read('js', f), /data-range="\d+">/, f);
    for (const f of ['views-admin.js', 'views-analytics.js', 'views-performance.js']) assert.match(read('js', f), /AP\.monthStepper\(/, f);
    const idx = read('index.html');
    assert.ok(idx.indexOf('range-bar.js') > idx.indexOf('/admin/js/core.js'), 'range-bar.js بعد از core.js');
    assert.match(idx, /41-range-bar\.css/);
  });

  test('CSS: بدون رنگ سخت‌کد', () => {
    assert.doesNotMatch(read('css', 'polish', '41-range-bar.css'), /#[0-9a-f]{3,8}\b/i);
  });
});

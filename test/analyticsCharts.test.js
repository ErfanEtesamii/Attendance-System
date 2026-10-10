// S5-7a: نمودارهای SVG سبک — ساختار SVG، جدول معادل، null/خالی، escape، بدون on*/style/CDN، آداپتورها (با payload هم‌شکل APIهای S5-6).
// این فایل به دیتابیس نیاز ندارد؛ تطبیق با «پاسخ واقعی» API در analyticsChartsApi.test.js است.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const C = require('../public-admin/js/charts.js');

const panel = (f) => fs.readFileSync(path.join(__dirname, '..', 'public-admin', f), 'utf8');
const strip = (html) => html.replace(/<[^>]*>/g, '');
const NO_NAN = (html) => assert.doesNotMatch(html, /NaN|undefined|Infinity/);
const SAFE = (html) => {
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i, 'on* درون‌خطی ممنوع (CSP)');
  assert.doesNotMatch(html, /\sstyle\s*=/i, 'style درون‌خطی لازم نیست');
  assert.doesNotMatch(html, /https?:\/\//i, 'هیچ منبع بیرونی/CDN');
  assert.doesNotMatch(html, /<script/i);
};

describe('نمودار خطی', () => {
  const spec = { title: 'روند <b>x</b>', labels: ['الف', 'ب', 'ج', 'د'], series: [{ name: 'کل', values: [10, null, 30, 20] }, { name: 'فنی', values: [5, 8, 8, 0] }] };

  test('ساختار: svg با role/title/desc، دو خط، نشانگرها، جدول معادل با همه‌ی اعداد', () => {
    const h = C.lineChartHtml(spec);
    NO_NAN(h); SAFE(h);
    assert.match(h, /<svg class="chart chart-line"[^>]*role="img"[^>]*aria-labelledby="(ch\d+)-t \1-d"/);
    assert.match(h, /<title id="ch\d+-t">/);
    assert.match(h, /<desc id="ch\d+-d">/);
    assert.match(h, /<details class="chart-data">/);
    // شکاف: سری اول [۱۰، null، ۳۰، ۲۰] ⇒ نقطه‌ی تنها خط ندارد، قطعه‌ی (۳۰، ۲۰) یک خط؛ سری دوم کامل یک خط
    assert.equal((h.match(/<polyline/g) || []).length, 2);
    const svgOnly = h.match(/<svg class="chart chart-line".*?<\/svg>/)[0]; // راهنما هم نشانگر دارد؛ فقط خود نمودار
    assert.equal((svgOnly.match(/class="mk s0"/g) || []).length, 3, 'null نشانگر ندارد');
    assert.equal((svgOnly.match(/class="mk s1"/g) || []).length, 4, 'صفر واقعی نشانگر دارد');
    const rows = h.match(/<tbody>.*<\/tbody>/)[0];
    assert.equal((rows.match(/<tr>/g) || []).length, 4);
    assert.match(rows, /<th scope="row">ب<\/th><td>—<\/td><td>8<\/td>/, 'null در جدول «—» است نه صفر');
  });

  test('عنوان/برچسب‌ها escape می‌شوند و سری‌ها شکل نشانگر و الگوی خط متفاوت دارند (نه فقط رنگ)', () => {
    const h = C.lineChartHtml(spec);
    assert.doesNotMatch(h, /<b>x<\/b>/);
    assert.match(h, /&lt;b&gt;x&lt;\/b&gt;/);
    assert.match(h, /<circle class="mk s0"/);
    assert.match(h, /<rect class="mk s1"/);
    assert.match(h, /stroke-dasharray="6 3"/);
    assert.match(h, /<ul class="chart-legend">/);
  });

  test('اولین سطل سمت راست (RTL): x نقطه‌ی اول > x نقطه‌ی آخر', () => {
    const h = C.lineChartHtml({ title: 't', labels: ['a', 'b', 'c'], series: [{ name: 's', values: [1, 2, 3] }] });
    const xs = [...h.matchAll(/<circle class="mk s0" cx="([\d.]+)"/g)].map((m) => Number(m[1]));
    assert.equal(xs.length, 3);
    assert.ok(xs[0] > xs[1] && xs[1] > xs[2]);
  });

  test('خالی / همه null ⇒ پیام «داده‌ای نیست» و هیچ svg ای نه', () => {
    for (const s of [{ title: 't', labels: [], series: [] }, { title: 't', labels: ['a'], series: [{ name: 's', values: [null] }] }]) {
      const h = C.lineChartHtml(s);
      assert.doesNotMatch(h, /<svg/);
      assert.match(h, /class="empty"/);
    }
  });

  test('تک‌نقطه‌ای، همه صفر، و بیش از ۶ سری: بدون NaN؛ سری‌های اضافه فقط در جدول', () => {
    NO_NAN(C.lineChartHtml({ title: 't', labels: ['a'], series: [{ name: 's', values: [4] }] }));
    NO_NAN(C.lineChartHtml({ title: 't', labels: ['a', 'b'], series: [{ name: 's', values: [0, 0] }] }));
    const many = Array.from({ length: 9 }, (_, i) => ({ name: `س${i}`, values: [i, i + 1] }));
    const h = C.lineChartHtml({ title: 't', labels: ['a', 'b'], series: many });
    assert.equal((h.match(/<polyline/g) || []).length, C.MAX_SERIES);
    assert.match(h, /فقط .* سری اول رسم شده/);
    assert.equal((h.match(/<th scope="col">/g) || []).length, 1 + 9, 'جدول همه‌ی سری‌ها را دارد');
  });

  test('niceScale: بالای محور همیشه ≥ بیشینه و «گرد»', () => {
    for (const m of [0, 0.3, 1, 7, 13, 99, 100, 4321]) {
      const s = C.niceScale(m);
      assert.ok(s.max >= m && Number.isFinite(s.step) && s.step > 0, String(m));
    }
    assert.equal(C.niceScale(100).max, 100);
    assert.equal(C.niceScale(100, 4, true).step, 25);
    assert.equal(C.niceScale(13).max, 20);
  });
});

describe('نمودار میله‌ای', () => {
  test('افقی: برای هر دسته یک میله، برچسب بلند کوتاه ولی کامل در title، جدول معادل', () => {
    const long = 'یک نام بسیار بسیار بلند برای کارمند آزمایشی';
    const h = C.barChartHtml({ title: 'رتبه', categories: ['الف', long], series: [{ name: 'م', values: [60, 30] }] });
    NO_NAN(h); SAFE(h);
    assert.equal((h.match(/<rect class="bar s0"/g) || []).length, 2);
    assert.match(h, /…/);
    assert.match(h, new RegExp(`<title>${long}</title>`));
    assert.match(h, /<th scope="row">الف<\/th><td>60<\/td>/);
  });

  test('افقی: میله‌ی بزرگ‌تر بلندتر و از سمت راست رشد می‌کند؛ مقدار صفر میله ندارد ولی در جدول هست', () => {
    const h = C.barChartHtml({ title: 't', categories: ['a', 'b', 'c'], series: [{ name: 's', values: [80, 40, 0] }] });
    const bars = [...h.matchAll(/<rect class="bar s0" x="([\d.]+)" y="[\d.]+" width="([\d.]+)"/g)].map((m) => ({ x: Number(m[1]), w: Number(m[2]) }));
    assert.equal(bars.length, 3);
    assert.ok(bars[0].w > bars[1].w);
    assert.equal(bars[2].w, 0);
    assert.equal(Math.round((bars[0].x + bars[0].w) * 10), Math.round((bars[1].x + bars[1].w) * 10), 'خط پایه‌ی مشترک (راست)');
    assert.match(h, /<th scope="row">c<\/th><td>0<\/td>/);
  });

  test('گروهی (دو سری) و null: میله‌ی null رسم نمی‌شود، سری‌ها کلاس جدا دارند', () => {
    const h = C.barChartHtml({ title: 't', categories: ['a', 'b'], series: [{ name: 'قبل', values: [10, null] }, { name: 'جاری', values: [20, 5] }] });
    assert.equal((h.match(/class="bar s0"/g) || []).length, 1);
    assert.equal((h.match(/class="bar s1"/g) || []).length, 2);
    assert.match(h, /<td>—<\/td><td>5<\/td>/);
  });

  test('عمودی (هیستوگرام): یک ستون به‌ازای هر سطل، اولین سطل سمت راست، ارتفاع متناسب', () => {
    const h = C.barChartHtml({ title: 't', orientation: 'vertical', categories: ['a', 'b', 'c'], series: [{ name: 'n', values: [2, 8, 4] }] });
    NO_NAN(h);
    const bars = [...h.matchAll(/<rect class="bar s0" x="([\d.]+)" y="[\d.]+" width="[\d.]+" height="([\d.]+)"/g)].map((m) => ({ x: Number(m[1]), h: Number(m[2]) }));
    assert.equal(bars.length, 3);
    assert.ok(bars[0].x > bars[1].x && bars[1].x > bars[2].x);
    assert.ok(bars[1].h > bars[2].h && bars[2].h > bars[0].h);
  });

  test('yMax ثابت (۱۰۰٪) محور را ثابت نگه می‌دارد', () => {
    const h = C.barChartHtml({ title: 't', yMax: 100, categories: ['a'], series: [{ name: 's', values: [10] }], tickFormat: (v) => `${v}٪` });
    assert.match(h, />100٪</);
    assert.doesNotMatch(h, />200٪</);
  });

  test('خالی ⇒ پیام، نه svg', () => {
    const h = C.barChartHtml({ title: 't', categories: [], series: [{ name: 's', values: [] }] });
    assert.doesNotMatch(h, /<svg/);
    assert.match(h, /class="empty"/);
  });
});

describe('آداپتورها (payload هم‌شکل APIهای S5-6)', () => {
  const dep = { num: (v) => String(Math.round(v * 100) / 100), min: (m) => `${m}m`, fa: (s) => s };
  const pt = (c, p, m = c * 10) => ({ bucket: 'b', presentDays: p, lateCount: c, lateMinutes: m, lateRate: p ? c / p : null });

  test('late-trend: نرخ بر حسب درصد، null برای هفته‌ی بدون حضور، جدول با تعداد و دقیقه', () => {
    const d = { granularity: 'week', buckets: [{ key: 'a', label: 'هفته‌ی 1405/06/01' }, { key: 'b', label: 'هفته‌ی 1405/06/08' }], series: [{ key: 'all', label: 'همه', points: [pt(1, 4), pt(0, 0)], total: pt(1, 4) }] };
    const spec = C.fromLateTrend(d, dep);
    assert.deepEqual(spec.series[0].values, [25, null]);
    assert.equal(spec.tickLabels[0], '06/01');
    const h = C.lineChartHtml(spec, dep);
    NO_NAN(h); SAFE(h);
    assert.match(h, /25٪ \(1 از 4 روز؛ 10m\)/);
    assert.match(h, /حضوری ثبت نشده/);
    assert.match(h, /روند هفتگی نرخ تأخیر/);
  });

  test('late-compare: ماه ناتمام علامت می‌خورد؛ ماه قبل بدون تأخیر ⇒ درصد تغییر «نامعلوم»', () => {
    const cur = { label: 'شهریور 1405', partial: true, ...pt(2, 10) };
    const prev = { label: 'مرداد 1405', ...pt(0, 10) };
    const d = { groupBy: 'none', groups: [], current: cur, previous: prev, delta: { lateCountPercent: null } };
    const spec = C.fromLateCompare(d, dep);
    assert.deepEqual(spec.categories, ['همه']);
    assert.match(spec.series[1].name, /ناتمام/);
    const h = C.barChartHtml(spec, dep);
    NO_NAN(h);
    assert.match(h, /نامعلوم/);
    assert.match(h, /هنوز تمام نشده/);
  });

  test('rankings: برچسب «رتبه. نام»، مقدار دقیقه‌ی همان API، جدول اضافه‌کاری با خام/معلق', () => {
    const d = { metric: 'overtime', definition: 'تعریف', rows: [{ rank: 1, user: { id: 1, fullName: 'الف', department: 'فنی' }, payableMinutes: 120, rawMinutes: 150, pendingMinutes: 30, clippedMinutes: 0 }, { rank: 1, user: { id: 2, fullName: 'ب', department: null }, payableMinutes: 120, rawMinutes: 120, pendingMinutes: 0, clippedMinutes: 0 }] };
    const spec = C.fromRankings(d, dep);
    assert.deepEqual(spec.series[0].values, [120, 120]);
    assert.deepEqual(spec.categories, ['1. الف', '1. ب']);
    const h = C.barChartHtml(spec, dep);
    assert.match(h, /<td>150m<\/td><td>30m<\/td>/);
    assert.match(h, /<td>—<\/td>/, 'بدون دپارتمان ⇒ «—»');
  });

  test('rankings کسری: نسبت null ⇒ «—»؛ attendance-rate بدون groups ⇒ یک ستون «همه»؛ نرخ null ⇒ بدون میله', () => {
    const sf = C.fromRankings({ metric: 'shortfall', rows: [{ rank: 1, user: { id: 1, fullName: 'الف' }, shortfallMinutes: 60, expectedMinutes: 0, shortfallRatio: null, incompleteDays: 1 }] }, dep);
    assert.match(C.barChartHtml(sf, dep), /<td>—<\/td><td>1<\/td>/);
    const total = { presentDays: 0, absentDays: 0, lateDays: 0, rate: null };
    const spec = C.fromAttendanceRate({ groups: [], total }, dep);
    assert.deepEqual(spec.categories, ['همه']);
    assert.doesNotMatch(C.barChartHtml(spec, dep), /<svg/, 'همه null ⇒ پیام خالی');
  });

  test('leave-by-type و checkin-distribution', () => {
    const lv = C.fromLeaveByType({ types: [{ title: 'استحقاقی', days: 3, minutes: 90, employees: 2 }] }, dep);
    const lh = C.barChartHtml(lv, dep);
    assert.match(lh, /<td>3<\/td><td>90m<\/td><td>2<\/td>/);
    const ds = C.fromCheckinDistribution({ count: 5, earliest: '07:50', median: '08:10', latest: '09:05', bins: [{ from: '07:30', to: '08:00', count: 1 }, { from: '08:00', to: '08:30', count: 3 }, { from: '08:30', to: '09:00', count: 0 }, { from: '09:00', to: '09:30', count: 1 }] }, dep);
    assert.equal(ds.series[0].values.reduce((s, x) => s + x, 0), 5);
    const dh = C.barChartHtml(ds, dep);
    assert.match(dh, /chart-bar/);
    assert.match(dh, /زودترین 07:50/);
    assert.match(C.barChartHtml(C.fromCheckinDistribution({ count: 0, bins: [] }, dep), dep), /class="empty"/);
  });

  test('نام کارمند/دپارتمان مخرب در همه‌ی نمودارها escape می‌شود', () => {
    const evil = '<img src=x onerror=alert(1)>';
    const d = { metric: 'overtime', rows: [{ rank: 1, user: { id: 1, fullName: evil, department: evil }, payableMinutes: 5, rawMinutes: 5, pendingMinutes: 0, clippedMinutes: 0 }] };
    const h = C.barChartHtml(C.fromRankings(d, dep), dep);
    assert.doesNotMatch(h, /<img/);
    assert.match(h, /&lt;img/);
  });
});

describe('اتصال به پنل', () => {
  test('index.html: charts.js قبل از views-analytics.js، هر دو self-hosted؛ صفحه فقط با مجوز analytics.read (کارمند ندارد)', () => {
    const html = panel('index.html');
    assert.ok(html.indexOf('/admin/js/charts.js') > -1 && html.indexOf('/admin/js/charts.js') < html.indexOf('/admin/js/views-analytics.js'));
    assert.doesNotMatch(html, /<script[^>]+src="https?:\/\/(?!telegram\.org)/);
    const view = panel('js/views-analytics.js');
    assert.match(view, /perm: 'analytics\.read'/);
    assert.doesNotMatch(view, /\.innerHTML\s*=\s*[^;]*\+\s*(err|e)\.message/); // پیام خطا فقط با esc
    const { PERMISSIONS_BY_ROLE } = (() => { try { return require('../src/middleware/permissions'); } catch (_) { return {}; } })();
    if (PERMISSIONS_BY_ROLE) assert.ok(!(PERMISSIONS_BY_ROLE.employee || []).includes('analytics.read'));
  });

  test('همه‌ی ۷ نمودار با آدرس‌های API درست فراخوانی می‌شوند و هر کدام خطای مستقل دارند', () => {
    const view = panel('js/views-analytics.js');
    for (const p of ['late-trend', 'late-compare', 'metric: \'overtime\'', 'metric: \'shortfall\'', 'attendance-rate', 'leave-by-type', 'checkin-distribution']) assert.ok(view.includes(p), p);
    assert.match(view, /catch \(err\) \{ out = cardError/);
  });
});

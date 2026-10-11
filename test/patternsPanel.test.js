// S5-7c: UI هشدار الگوها — متن «نشانه/الگو» نه «اتهام»، escape، خالی، قاعده‌ی خاموش، اتصال به صفحه‌ی تحلیل (مجوز analytics.read ⇒ کارمند ندارد).
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const P = require('../public-admin/js/patterns.js');

const panel = (f) => fs.readFileSync(path.join(__dirname, '..', 'public-admin', f), 'utf8');
const report = {
  disclaimer: 'این‌ها «نشانه/الگو»ی آماری هستند، نه اتهام یا حکم؛ …',
  summary: { usersAnalyzed: 7, usersWithFindings: 1, findings: 2 },
  rules: [{ id: 'consecutive_late', title: 'تأخیر پشت‌سرهم', enabled: true }, { id: 'identical_times', title: 'ساعت‌های دقیقاً یکسان', enabled: false }],
  users: [{ user: { id: 1, fullName: '<img src=x onerror=alert(1)>', department: 'فنی' }, findings: [
    { rule: 'consecutive_late', title: 'تأخیر پشت‌سرهم', reason: '3 روز پشت‌سرهم <b>تأخیر</b>' },
    { rule: 'weekend_adjacent_absence', title: 'غیبت چسبیده', reason: '۴ از ۴ غیبت' },
  ] }],
};

describe('هشدار الگوها در پنل (S5-7c)', () => {
  test('نمایش: دلیل هر مورد، شمارش‌ها، قاعده‌ی خاموش و برچسب «نشانه، نه اتهام»', () => {
    const h = P.patternsHtml(report, { fa: (s) => s });
    assert.match(h, /نشانه، نه اتهام/);
    assert.match(h, /3 روز پشت‌سرهم/);
    assert.match(h, /7 نفر بررسی شد؛ 1 نفر دارای 2 نشانه/);
    assert.match(h, /قاعده‌های خاموش \(در تنظیمات\): ساعت‌های دقیقاً یکسان/);
    assert.equal((h.match(/class="pattern-item"/g) || []).length, 2);
  });
  test('امنیت: escape کامل؛ بدون on*/style/اسکریپت/منبع بیرونی', () => {
    const h = P.patternsHtml(report);
    assert.doesNotMatch(h, /<img|<b>/);
    assert.doesNotMatch(h, /<[^>]*\s(on[a-z]+|style)\s*=|<script|https?:\/\//i); // فقط داخل تگ‌ها؛ متن escape‌شده‌ی «onerror=» بی‌خطر است
    assert.match(h, /&lt;img/);
  });
  test('بدون نشانه ⇒ پیام خالی؛ ورودی تهی خطا نمی‌دهد؛ هرگز NaN/undefined', () => {
    for (const r of [{ summary: { usersAnalyzed: 3, usersWithFindings: 0, findings: 0 }, users: [] }, null, {}]) {
      const h = P.patternsHtml(r);
      assert.match(h, /هیچ نشانه‌ای/);
      assert.doesNotMatch(h, /NaN|undefined|null/);
    }
  });
  test('واژگان: «اتهام» فقط در عبارت نفی «نه اتهام»؛ «تخلف/مقصر/متهم» هرگز', () => {
    const src = panel('js/patterns.js') + panel('js/views-analytics.js');
    assert.doesNotMatch(src, /تخلف|مقصر|متهم|گناه/);
    for (const m of (src + P.patternsHtml(report)).matchAll(/.{0,6}اتهام/g)) assert.match(m[0], /نه اتهام|«اتهام»|اتهام»/, m[0]);
  });
  test('اتصال: patterns.js self-hosted و قبل از views-analytics.js؛ آدرس API؛ خطای مستقل کارت', () => {
    const html = panel('index.html');
    assert.ok(html.indexOf('/admin/js/patterns.js') > -1 && html.indexOf('/admin/js/patterns.js') < html.indexOf('/admin/js/views-analytics.js'));
    const view = panel('js/views-analytics.js');
    assert.ok(view.includes('/admin/analytics/patterns?'));
    assert.match(view, /perm: 'analytics\.read'/);
    assert.match(view, /catch \(err\) \{ out = cardError/);
  });
});

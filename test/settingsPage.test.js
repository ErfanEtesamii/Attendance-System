// S3-9a/S3-9b: صفحه‌های «تنظیمات» (گروه‌بندی‌شده) و «تعطیلات» در پنل. اجرای واقعی views-admin.js با AP ساختگی (بدون مرورگر).
// تست دستی مرورگر (ذخیره با دلیل، reset، فرم تعطیلی) در گزارش S3-9a/9b آمده است.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('صفحه‌های تنظیمات و تعطیلات پنل (S3-9a/9b)', () => {
  let items, groups;
  before(() => {
    resetDb();
    const settingsRepository = require('../src/repositories/settingsRepository');
    const registry = require('../src/utils/settingsRegistry');
    items = settingsRepository.getItems();
    groups = registry.GROUP_LABELS;
  });
  after(() => cleanup());

  function loadViews(apiImpl, users = []) {
    const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const AP = {
      views: {}, nav: [], state: { isAdmin: true },
      $: () => null, $$: () => [], esc,
      fmt: { num: (n) => String(n), dateLong: (d) => d, dateTime: (d) => d, date: (d) => d, clock: (d) => d, min: (m) => `${m}m` },
      icon: () => '', badge: (cls, text) => `<span class="badge ${cls}">${esc(text)}</span>`,
      view(id, def) { AP.views[id] = def; if (def.nav) AP.nav.push({ id, ...def.nav }); },
      api: apiImpl, loadUsers: async () => users,
    };
    const src = fs.readFileSync(path.join(__dirname, '..', 'public-admin', 'js', 'views-admin.js'), 'utf8');
    vm.runInNewContext(src, { window: { AP }, document: {}, console, CSS: { escape: (s) => s } });
    return AP;
  }

  test('تنظیمات: همه‌ی کلیدها در گروه خودشان، توضیح فارسی، پیش‌فرض، هشدار اثر روی گزارش‌های گذشته فقط برای گروه‌های محاسباتی', async () => {
    const calls = [];
    const AP = loadViews(async (p) => { calls.push(p); return { items, groups }; });
    const def = AP.views.settings;
    assert.ok(def && def.admin, 'فقط ادمین');
    const { html } = await def.render();
    assert.deepEqual(calls, ['/admin/settings/items'], 'فقط API متادیتا خوانده می‌شود (API قدیمی بدون تغییر)');

    for (const g of Object.keys(groups)) assert.match(html, new RegExp(`<details class="card set-group" data-group="${g}"`), `گروه ${g}`);
    for (const it of items) {
      assert.ok(html.includes(`data-row="${it.key}"`), `ردیف ${it.key}`);
      assert.ok(html.includes(`data-key="${it.key}"`), `ورودی ${it.key}`);
    }
    // هر گروه فقط ردیف‌های خودش را دارد
    const section = (g) => html.split(`data-group="${g}"`)[1].split('</details>')[0];
    assert.match(section('workHours'), /data-row="workDayStart"/);
    assert.doesNotMatch(section('workHours'), /data-row="overtimeEnabled"/);
    // هشدار اثر روی گذشته
    for (const g of ['workHours', 'calendar', 'overtime']) assert.match(section(g), /ماه‌های گذشته/, g);
    for (const g of ['reminders', 'security', 'retention', 'schedule']) assert.doesNotMatch(section(g), /ماه‌های گذشته/, g);
    assert.match(section('schedule'), /بدون ری‌استارت/);
    // نوع‌ها: انتخاب روز هفته، ساعت، cron، بازگشت‌ناپذیر نبودن مقدار پیش‌فرض
    assert.match(section('calendar'), /class="chk-row" data-key="weekendDays"/);
    assert.match(section('workHours'), /type="time" name="workDayStart"/);
    assert.match(section('schedule'), /type="text" name="cronDailyReport"[^>]*dir="ltr"/);
    assert.match(section('overtime'), /<select name="overtimeRounding"/);
    assert.match(html, /پیش‌فرض: ۱۶:۳۰|پیش‌فرض: 16:30/);
    // هیچ فرم/لیست تعطیلات در صفحه‌ی تنظیمات نیست
    assert.doesNotMatch(html, /hol-form|تقویم تعطیلات رسمی/);
    // دکمه‌ی ذخیره در ابتدا غیرفعال است و برچسب گمراه‌کننده‌ی قبلی نیست
    assert.match(html, /data-save="workHours" disabled/);
    assert.doesNotMatch(html, /مهلت مجاز تأخیر \(دقیقه\)/);
  });

  test('تنظیمات: مقدار تغییر‌یافته با نشان و دکمه‌ی بازگشت به پیش‌فرض؛ پیش‌فرض‌ها بدون دکمه', async () => {
    const changed = items.map((i) => (i.key === 'workDayStart' ? { ...i, value: '07:30', isDefault: false } : i));
    const AP = loadViews(async () => ({ items: changed, groups }));
    const { html } = await AP.views.settings.render();
    assert.equal((html.match(/data-reset="/g) || []).length, 1);
    assert.match(html, /data-reset="workDayStart"/);
    assert.match(html, /value="07:30"/);
  });

  test('تنظیمات: متن‌های سرور escape می‌شوند', async () => {
    const evil = items.map((i) => (i.key === 'timezone' ? { ...i, description: '<img src=x onerror=alert(1)>', value: '"><script>1</script>' } : i));
    const AP = loadViews(async () => ({ items: evil, groups }));
    const { html } = await AP.views.settings.render();
    assert.doesNotMatch(html, /<img src=x|<script>1/);
    assert.match(html, /&lt;img src=x/);
  });

  test('تعطیلات: ناوبری مستقل، لیست با نوع/دامنه، فیلتر آینده/گذشته، escape، دکمه‌های ویرایش و حذف', async () => {
    const mk = (id, date, o = {}) => ({ id, holiday_date: date, title: `تعطیلی ${id}`, kind: 'full', half_end_time: null, scope: 'all', department: '', ...o });
    const rows = [
      mk(1, '2000-01-01'),
      mk(2, '2999-05-01', { kind: 'half', half_end_time: '12:00' }),
      mk(3, '2999-06-01', { scope: 'department', department: 'مالی', title: '<b>x</b>' }),
    ];
    const AP = loadViews(async () => rows, [{ department: 'مالی' }, { department: ' مالی ' }, { department: 'فنی' }]);
    const def = AP.views.holidays;
    assert.ok(def && def.admin, 'فقط ادمین');
    assert.ok(AP.nav.some((n) => n.id === 'holidays' && n.admin), 'آیتم ناوبری «تعطیلات»');
    const { html } = await def.render(); // پیش‌فرض: از امروز به بعد
    assert.doesNotMatch(html, /data-edit="1"/, 'تعطیلی گذشته در نمای «آینده» نیست');
    assert.match(html, /data-edit="2"/);
    assert.match(html, /نیم‌روز تا 12:00/);
    assert.match(html, /دپارتمان «مالی»/);
    assert.match(html, /data-del="3"/);
    assert.doesNotMatch(html, /<b>x<\/b>/);
    assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/);
    assert.match(html, /id="hol-add"/);
    assert.match(html, /id="hol-import"/, 'دکمه‌ی ورود گروهی (S3-9d)');
  });

  test('تعطیلات: حالت خالی', async () => {
    const AP = loadViews(async () => []);
    const { html } = await AP.views.holidays.render();
    assert.match(html, /تعطیلی ثبت نشده است/);
  });
});

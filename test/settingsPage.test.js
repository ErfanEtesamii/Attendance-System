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

  function loadViews(apiImpl, users = [], extra = {}) {
    const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const AP = {
      views: {}, nav: [], state: { perms: new Set(['settings.edit']) },
      $: () => null, $$: () => [], esc,
      fmt: { num: (n) => String(n), dateLong: (d) => d, dateTime: (d) => d, date: (d) => d, clock: (d) => d, min: (m) => `${m}m` },
      icon: () => '', badge: (cls, text) => `<span class="badge ${cls}">${esc(text)}</span>`,
      view(id, def) { AP.views[id] = def; if (def.nav) AP.nav.push({ id, ...def.nav }); },
      api: apiImpl, loadUsers: async () => users,
      ...extra,
    };
    if (extra.$) AP.$ = extra.$;
    const src = fs.readFileSync(path.join(__dirname, '..', 'public-admin', 'js', 'views-admin.js'), 'utf8');
    vm.runInNewContext(src, { window: { AP }, document: {}, console, CSS: { escape: (s) => s } });
    return AP;
  }

  test('تنظیمات: همه‌ی کلیدها در گروه خودشان، توضیح فارسی، پیش‌فرض، هشدار اثر روی گزارش‌های گذشته فقط برای گروه‌های محاسباتی', async () => {
    const calls = [];
    const AP = loadViews(async (p) => { calls.push(p); return { items, groups }; });
    const def = AP.views.settings;
    assert.ok(def && def.perm === 'settings.edit', 'فقط با مجوز settings.edit (S4-4b؛ قبلاً admin:true)');
    const { html } = await def.render();
    assert.deepEqual(calls, ['/admin/settings/items'], 'فقط API متادیتا خوانده می‌شود (API قدیمی بدون تغییر)');

    // U1: برای هر گروه یک پنل (فقط اولی نمایان)؛ دکمه‌ی ناوبری هر گروه؛ بدون <details>
    const groupKeys = Object.keys(groups);
    assert.equal(groupKeys.length, 13);
    for (const g of groupKeys) {
      assert.match(html, new RegExp(`<section class="card st-panel" data-group="${g}"`), `گروه ${g}`);
      assert.match(html, new RegExp(`class="st-nav-item" data-go="${g}"`), `ناوبری ${g}`);
    }
    assert.doesNotMatch(html, /<details|set-group/);
    const panelTags = html.match(/<section class="card st-panel"[^>]*>/g);
    assert.equal(panelTags.length, groupKeys.length);
    assert.equal(panelTags.filter((t) => !/\shidden(\s|>|=)/.test(t)).length, 1, 'فقط یک پنل نمایان');
    assert.doesNotMatch(panelTags[0], /hidden/, 'پنل اولیه = اولین گروه');
    for (const it of items) {
      assert.ok(html.includes(`data-row="${it.key}"`), `ردیف ${it.key}`);
      assert.ok(html.includes(`data-key="${it.key}"`), `ورودی ${it.key}`);
    }
    // هر گروه فقط ردیف‌های خودش را دارد
    const section = (g) => html.split(`data-group="${g}"`)[1].split('</section>')[0];
    assert.match(section('workHours'), /data-row="workDayStart"/);
    assert.doesNotMatch(section('workHours'), /data-row="overtimeEnabled"/);
    for (const it of items) assert.equal(html.split(`data-row="${it.key}"`).length - 1, 1, `${it.key} فقط یک بار`);
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

  // DOM ساختگی کوچک برای اجرای mount() (منطق تعویض گروه و draftها)
  function fakeDom(groupKeys, items) {
    const mk = (o = {}) => {
      const el = { dataset: {}, hidden: false, attrs: {}, cls: new Set(), listeners: {}, innerHTML: '', value: '', ...o };
      el.classList = {
        toggle: (c, f) => { const on = f === undefined ? !el.cls.has(c) : f; if (on) el.cls.add(c); else el.cls.delete(c); },
        add: (c) => el.cls.add(c), remove: (c) => el.cls.delete(c), contains: (c) => el.cls.has(c),
      };
      el.setAttribute = (k, v) => { el.attrs[k] = String(v); };
      el.removeAttribute = (k) => { delete el.attrs[k]; };
      el.addEventListener = (t, f) => { (el.listeners[t] = el.listeners[t] || []).push(f); };
      el.fire = (t) => (el.listeners[t] || []).forEach((f) => f());
      el.focus = () => { dom.focused = el; };
      return el;
    };
    const dom = { focused: null, panels: {}, navs: {}, dots: {}, saves: {}, rows: {}, inputs: {}, msgs: {} };
    dom.q = mk({ id: 'set-q' });
    dom.none = mk({ id: 'set-none' });
    dom.page = mk({ id: 'page' });
    for (const g of groupKeys) {
      dom.panels[g] = mk({ dataset: { group: g }, hidden: g !== groupKeys[0] });
      dom.navs[g] = mk({ dataset: { go: g } });
      dom.dots[g] = mk({ dataset: { dot: g }, hidden: true });
      dom.saves[g] = mk({ dataset: { save: g }, disabled: true });
      dom.msgs[g] = mk();
      dom.rows[g] = items.filter((i) => i.group === g).map((i) => {
        const input = mk({ value: String(i.value) });
        const row = mk({ dataset: { row: i.key } });
        dom.inputs[i.key] = input; row.input = input;
        return row;
      });
    }
    const unq = (sel, re) => (sel.match(re) || [])[1];
    dom.$ = (sel, root) => {
      if (sel === '#set-q') return dom.q;
      if (sel === '#set-none') return dom.none;
      if (sel === '.topbar') return null;
      let g = unq(sel, /^\[data-save="(.+)"\]$/); if (g) return dom.saves[g];
      g = unq(sel, /^\[data-dot="(.+)"\]$/); if (g) return dom.dots[g];
      g = unq(sel, /^\.st-panel\[data-group="(.+)"\] \[data-msg\]$/); if (g) return dom.msgs[g];
      g = unq(sel, /^\.st-panel\[data-group="(.+)"\]$/); if (g) return dom.panels[g];
      g = unq(sel, /^#st-h-(.+)$/); if (g) return dom.panels[g];
      const k = unq(sel, /^\[data-key="(.+)"\]$/); if (k && root && root.input) return root.input;
      return null;
    };
    dom.$$ = (sel, root) => {
      if (sel === '.st-panel') return groupKeys.map((g) => dom.panels[g]);
      if (sel === '[data-go]') return groupKeys.map((g) => dom.navs[g]);
      if (sel === '.set-row') { const g = groupKeys.find((x) => dom.panels[x] === root); return g ? dom.rows[g] : []; }
      if (sel === 'input, select') return root && root.input ? [root.input] : [];
      return [];
    };
    return dom;
  }

  test('تنظیمات (U1): تعویض گروه فقط hidden/aria-current را جابه‌جا می‌کند و draftها دست‌نخورده می‌مانند', async () => {
    const gk = Object.keys(groups).filter((g) => items.some((i) => i.group === g));
    const dom = fakeDom(gk, items);
    const AP = loadViews(async () => ({ items, groups }), [], { $: dom.$, $$: dom.$$, dates: { mount() {} } });
    const out = await AP.views.settings.render();
    out.mount(dom.page);
    const [g1, g2] = ['workHours', 'overtime'];
    assert.equal(dom.panels[g1].hidden, false);
    assert.equal(dom.panels[g2].hidden, true);

    // تغییر یک مقدار در گروه اول ⇒ draft، دکمه‌ی ذخیره فعال، نقطه‌ی «ذخیره‌نشده» در ناوبری
    dom.inputs.workDayStart.value = '05:11';
    dom.inputs.workDayStart.fire('input');
    assert.equal(dom.saves[g1].disabled, false);
    assert.equal(dom.dots[g1].hidden, false);
    assert.match(dom.dots[g1].innerHTML, /تغییر ذخیره‌نشده/);

    // رفتن به گروه دیگر
    dom.navs[g2].fire('click');
    assert.equal(dom.panels[g1].hidden, true);
    assert.equal(dom.panels[g2].hidden, false);
    assert.equal(dom.navs[g2].attrs['aria-current'], 'true');
    assert.equal('aria-current' in dom.navs[g1].attrs, false);
    assert.equal(dom.focused, dom.panels[g2], 'فوکوس به عنوان پنل گروه جدید');
    // draft پاک نشده و برای گروه اول هنوز «ذخیره‌نشده» است
    assert.equal(dom.saves[g1].disabled, false);
    assert.equal(dom.dots[g1].hidden, false);
    assert.equal(dom.saves[g2].disabled, true);

    // برگشت: همان پنل، همان مقدار
    dom.navs[g1].fire('click');
    assert.equal(dom.panels[g1].hidden, false);
    assert.equal(dom.panels[g2].hidden, true);
    assert.equal(dom.inputs.workDayStart.value, '05:11');
  });

  test('تنظیمات (U1): جستجو همچنان کار می‌کند (پنل‌های دارای نتیجه نمایان، بی‌نتیجه ⇒ set-none)', async () => {
    const gk = Object.keys(groups).filter((g) => items.some((i) => i.group === g));
    const dom = fakeDom(gk, items);
    const AP = loadViews(async () => ({ items, groups }), [], { $: dom.$, $$: dom.$$, dates: { mount() {} } });
    (await AP.views.settings.render()).mount(dom.page);
    dom.q.value = 'workDayStart';
    dom.q.fire('input');
    assert.equal(dom.panels.workHours.hidden, false);
    assert.equal(dom.panels.overtime.hidden, true);
    assert.equal(dom.none.classList.contains('hidden'), true);
    dom.q.value = 'zzz-no-such-setting';
    dom.q.fire('input');
    assert.equal(dom.none.classList.contains('hidden'), false);
    dom.q.value = '';
    dom.q.fire('input');
    assert.equal(dom.panels.workHours.hidden, false, 'برگشت به گروه فعال');
    assert.equal(dom.panels.overtime.hidden, true);
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
    assert.ok(def && def.perm === 'settings.edit', 'فقط با مجوز settings.edit (S4-4b؛ قبلاً admin:true)');
    assert.ok(AP.nav.some((n) => n.id === 'holidays'), 'آیتم ناوبری «تعطیلات»');
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

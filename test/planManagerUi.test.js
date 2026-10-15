// A3-۳ب (فاز ۱۳): UI Mini App برای تسک مدیر — برچسب «🔒 از طرف سرپرست»، بنر «سرپرست برنامه را تغییر داده»، فقط‌خواندنی بودن؛ و داده‌ی بنر از سرور.
// الگوی uiStates/uiFollowups: تست ایستا روی سورس + (برای داده‌ی بنر) سرویس واقعی با دیتابیس موقت. مرورگر واقعی اجرا نمی‌شود.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const F = require('./helpers/factories');
const { zonedTimeToUtc } = require('../src/utils/time');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');
const fnBody = (src, sig) => {
  const i = src.indexOf(sig);
  assert.ok(i > -1, `${sig} پیدا نشد`);
  return src.slice(i, src.indexOf('\n  }\n', i));
};

describe('Mini App: برچسب و ردیف تسک مدیر (A3-۲)', () => {
  const app = read('public/js/app.js');
  const css = read('public/css/style.css');

  test('برچسب «🔒 از طرف سرپرست» متن + آیکون است و فقط به رنگ متکی نیست', () => {
    assert.match(app, /const MANAGER_LABEL = '🔒 از طرف سرپرست';/);
    const row = fnBody(app, 'function managerRow(');
    assert.match(row, /class: 'manager-badge', text: MANAGER_LABEL/);
    assert.match(row, /class: 'sr-only', text: 'فقط‌خواندنی؛ توسط سرپرست ثبت شده'/);
  });

  test('ردیف تسک مدیر فقط‌خواندنی است: بدون input/textarea/select/button و عنوان با text (نه innerHTML)', () => {
    const row = fnBody(app, 'function managerRow(');
    assert.match(row, /day-task-ro day-task-manager/);
    assert.doesNotMatch(row, /'(input|textarea|select|button)'/);
    assert.doesNotMatch(row, /innerHTML/);
    assert.match(row, /class: 'day-task-text', text: t\.title/);
  });

  test('تسک مدیر فقط وقتی managerLocked است و فوری/سیستمی نیست', () => {
    assert.match(app, /const isManagerTask = \(t\) => !!t\.managerLocked && !t\.isUrgent && !t\.isSystem;/);
  });

  test('فرم ویرایش: تسک مدیر در فهرست قابل‌ویرایش و بدنه‌ی ذخیره نیست؛ ولی در سقف حساب می‌شود', () => {
    // بدنه‌ی saveDraft کلاینت
    assert.match(app, /planUi\.tasks\.filter\(\(t\) => !t\.isSystem && !t\.isUrgent && !t\.managerLocked\)\.map\(/);
    // فهرست قابل‌ویرایش (mine) و شمارش سقف
    assert.match(app, /const mine = \(\) => planUi\.tasks\.filter\(\(t\) => !t\.isSystem && !t\.isUrgent && !t\.managerLocked\);/);
    assert.match(app, /const lockedCount = \(\) => planUi\.tasks\.filter\(isManagerTask\)\.length;/);
    assert.match(app, /mine\(\)\.length \+ lockedCount\(\) >= data\.maxTasks/);
    // هر روز: تسک مدیر بالای کارت، فقط‌خواندنی
    assert.match(app, /planUi\.tasks\.filter\(\(t\) => isManagerTask\(t\) && matches\(t\)\)\.map\(managerRow\)/);
  });

  test('یادداشت فقط‌خواندنی بودن در فرم ویرایش (role=note) وقتی تسک مدیر هست', () => {
    assert.match(app, /if \(lockedCount\(\)\) body\.appendChild\(planEl\('div', \{ class: 'plan-note', role: 'note', text: `\$\{MANAGER_LABEL\}: تسک‌های سرپرست فقط‌خواندنی‌اند/);
  });

  test('نمای فقط‌خواندنی (rows): تسک مدیر با managerRow نمایش داده می‌شود', () => {
    assert.match(app, /t\.isUrgent \? urgentRow\(t\) : isManagerTask\(t\) \? managerRow\(t\) :/);
  });

  test('CSS: .manager-badge/.day-task-manager/.manager-banner تعریف شده؛ دکمه‌ی بنر ≥ ۴۴px', () => {
    for (const re of [/\.manager-badge \{/, /\.day-task-manager \{/, /\.manager-banner \{/, /\.manager-banner \.btn \{[^}]*min-height: 44px/]) assert.match(css, re);
    assert.match(css, /\.day-task-manager \{[^}]*border-inline-start/); // نشانگر غیررنگی/ساختاری (لبه) کنار رنگ
  });
});

describe('Mini App: بنر «سرپرست برنامه را تغییر داده» (A3-۲)', () => {
  const app = read('public/js/app.js');

  test('متن بنر و role=status؛ فقط وقتی managerChange.changed', () => {
    assert.match(app, /const MANAGER_CHANGED_MSG = 'سرپرست برنامه‌ی این هفته را تغییر داده است\.';/);
    const b = fnBody(app, 'function managerBanner(');
    assert.match(b, /if \(!mc \|\| !mc\.changed\) return null;/);
    assert.match(b, /role: 'status'/);
    assert.match(b, /text: '🔔 ' \+ MANAGER_CHANGED_MSG/); // آیکون + متن
    assert.doesNotMatch(b, /innerHTML/);
  });

  test('«متوجه شدم»: POST /plan/seen با withBusy، خاموش‌شدن بنر در حافظه، خطا بدون innerHTML', () => {
    const b = fnBody(app, 'function managerBanner(');
    assert.match(b, /text: 'متوجه شدم'/);
    assert.match(b, /withBusy\(btn, \(\) => api\('\/plan\/seen', \{ method: 'POST', body: \{ week: planUi\.week \} \}\)\)/);
    assert.match(b, /data\.managerChange = \{ changed: false, count: 0,/);
    assert.match(b, /catch \(err\) \{ planUi\.msg = err\.message; renderPlan\(\); \}/);
  });

  test('بنر در بالای بدنه‌ی صفحه‌ی برنامه افزوده می‌شود', () => {
    assert.match(app, /const mBanner = managerBanner\(data\);\s*if \(mBanner\) body\.appendChild\(mBanner\);/);
  });

  test('route سرور: POST /miniapp/plan/seen به markSeen وصل است', () => {
    const r = read('src/api/routes/miniapp.js');
    assert.match(r, /router\.post\('\/miniapp\/plan\/seen'/);
    assert.match(r, /weeklyPlanService\.markSeen\(req\.miniAppUser, b\.week \|\| 'next'\)/);
  });
});

describe('داده‌ی بنر از سرور (managerChange / markSeen)', () => {
  let db; let svc; let mgr; let boss; let u;
  const SUN = zonedTimeToUtc('2026-08-02', '10:00', 'Asia/Tehran');
  const NEXT = '2026-08-08';
  const reset = () => db.exec('DELETE FROM task_daily_logs; DELETE FROM plan_tasks; DELETE FROM weekly_plans; DELETE FROM notifications; DELETE FROM month_closures;');

  before(() => {
    db = resetDb();
    svc = require('../src/services/weeklyPlanService');
    mgr = require('../src/services/weeklyPlanAdminService');
    boss = F.makeUser({ role: 'manager' });
    u = F.makeUser({ managerId: boss.id });
  });
  after(cleanup);

  test('بدون تغییر مدیر: changed=false؛ بعد از افزودن/حذف مدیر: changed و count', () => {
    reset();
    svc.saveDraft(u, 'next', [{ title: 'خودم' }], { now: SUN });
    assert.equal(svc.getPlan(u, 'next', { now: SUN }).managerChange.changed, false);
    const a = mgr.addTask(boss, u.id, NEXT, { title: 'م۱' }, { now: SUN }).task;
    mgr.addTask(boss, u.id, NEXT, { title: 'م۲' }, { now: SUN });
    let mc = svc.getPlan(u, 'next', { now: SUN }).managerChange;
    assert.deepEqual([mc.changed, mc.count], [true, 2]);
    mgr.removeTask(boss, u.id, a.id, { now: SUN }); // حذف هم تغییر حساب می‌شود
    mc = svc.getPlan(u, 'next', { now: SUN }).managerChange;
    assert.equal(mc.changed, true);
  });

  test('markSeen بنر را خاموش می‌کند و version را زیاد نمی‌کند (مدیرِ در حال ویرایش PLAN_CONFLICT نمی‌گیرد)', () => {
    reset();
    const added = mgr.addTask(boss, u.id, NEXT, { title: 'م' }, { now: SUN });
    assert.equal(added.ok, true);
    const v = db.prepare('SELECT version FROM weekly_plans WHERE id = ?').get(added.plan.id).version;
    const r = svc.markSeen(u, 'next', { now: SUN });
    assert.equal(r.ok, true);
    assert.equal(r.managerChange.changed, false);
    assert.equal(svc.getPlan(u, 'next', { now: SUN }).managerChange.changed, false);
    const again = mgr.addTask(boss, u.id, NEXT, { title: 'م۲' }, { now: SUN, expectedVersion: v });
    assert.equal(again.ok, true, again.message);
  });

  test('markSeen بدون برنامه: بدون خطا و بدون ساختن برنامه؛ هفته‌ی نامعتبر INVALID_WEEK', () => {
    reset();
    const r = svc.markSeen(u, 'next', { now: SUN });
    assert.deepEqual([r.ok, r.managerChange.changed], [true, false]);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM weekly_plans').get().n, 0);
    assert.equal(svc.markSeen(u, 'foo', { now: SUN }).code, 'INVALID_WEEK');
  });
});

// M4 («وضعیت من»): منو و مسیردهی + نشان «تسک‌های بی‌پاسخِ امروز».
//   • GET /api/admin/me/tasks/pending-count (همه‌ی نقش‌ها؛ فقط خودِ کاربر؛ سیستمی/اختیاری شمرده نمی‌شود)
//   • core.js واقعی در vm: آیتم «وضعیت من» برای هر نقش، صفحه‌ی اول، و نشان عددی روی آیتم منو
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const F = require('./helpers/factories');

let hasDeps = true;
try { require.resolve('express'); } catch (_) { hasDeps = false; }

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');

describe('وضعیت من (M4): سرویس pendingCount', () => {
  let db; let svc; let plans; let cal; let settings; let TODAY; let u; let other;
  const mk = (user, title, extra = {}) => plans.addTask(plans.getOrCreate(user.id, cal.weekStartOf(TODAY, settings.getAll().weekStartDay)).id, { title, plannedDate: TODAY, ...extra });
  before(() => {
    db = resetDb();
    svc = require('../src/services/panelTasksService');
    plans = require('../src/repositories/weeklyPlanRepository');
    cal = require('../src/engine/calendarService');
    settings = require('../src/repositories/settingsRepository');
    TODAY = require('../src/utils/serverTime').todayDateString();
    u = F.makeUser();
    other = F.makeUser();
  });
  after(cleanup);
  const reset = () => db.exec('DELETE FROM task_daily_logs; DELETE FROM plan_tasks; DELETE FROM weekly_plans; DELETE FROM attendance_records; DELETE FROM leave_approvals; DELETE FROM leave_requests; DELETE FROM month_closures;');

  test('بدون تسک ⇒ ۰؛ فقط تسک‌های خودِ کاربر شمرده می‌شود', () => {
    reset();
    assert.equal(svc.pendingCount(u).pending, 0);
    mk(u, 'مال من'); mk(other, 'مال دیگری'); mk(other, 'مال دیگری ۲');
    assert.equal(svc.pendingCount(u).pending, 1);
    assert.equal(svc.pendingCount(other).pending, 2);
  });

  test('تسک سیستمی/واجب و اختیاری (low) شمرده نمی‌شود؛ فوری شمرده می‌شود', () => {
    reset();
    mk(u, 'عادی'); mk(u, 'اختیاری', { priority: 'low' });
    mk(u, 'سیستمی', { isSystem: true, systemKey: 'some_system_task', priority: 'high' });
    mk(u, 'فوری', { isUrgent: true, assignedByUserId: u.id, priority: 'high' });
    assert.equal(svc.pendingCount(u).pending, 2);
  });

  test('پاسخ‌دادن/برداشتن تیک عدد را کم/زیاد می‌کند (هم‌خوان با getToday)', () => {
    reset();
    const a = mk(u, 'الف'); mk(u, 'ب');
    assert.equal(svc.pendingCount(u).pending, 2);
    assert.equal(svc.answer(u, { taskId: a.id, status: 'done', date: TODAY }).ok, true);
    assert.equal(svc.pendingCount(u).pending, 1);
    assert.equal(svc.pendingCount(u).pending, svc.getToday(u, {}).tasks.filter((t) => !t.isSystem && !t.optional).length);
    assert.equal(svc.undo(u, { taskId: a.id, date: TODAY }).ok, true);
    assert.equal(svc.pendingCount(u).pending, 2);
  });

  test('خروجی فقط عدد و تاریخ است (بدون عنوان تسک)؛ هیچ ورودی کلاینتی ندارد', () => {
    reset();
    mk(u, 'محرمانه');
    const r = svc.pendingCount(u);
    assert.deepEqual(Object.keys(r).sort(), ['date', 'ok', 'pending']);
    assert.equal(svc.pendingCount.length, 1);
  });

  test('خطای تاریخ/ماه بسته/روز غیرمجاز (ok:false از getDailyTasks) ⇒ خطا نمی‌دهد؛ pending ۰', () => {
    reset();
    mk(u, 'الف');
    const report = require('../src/services/taskReportService');
    const orig = report.getDailyTasks;
    try {
      for (const code of ['MONTH_CLOSED', 'INVALID_DATE', 'FUTURE_DATE']) {
        report.getDailyTasks = () => ({ ok: false, code, error: 'x' });
        assert.deepEqual(svc.pendingCount(u), { ok: true, pending: 0 }, code);
      }
    } finally { report.getDailyTasks = orig; }
  });
});

describe('وضعیت من (M4): API /api/admin/me/tasks/pending-count', { skip: hasDeps ? false : 'express نصب نیست (npm install)' }, () => {
  const { startServer } = require('./helpers/miniappClient');
  let S; let plans; let cal; let settings; let TODAY; let users; let cookies; let emp; let mgr;
  const mk = (user, title, extra = {}) => plans.addTask(plans.getOrCreate(user.id, cal.weekStartOf(TODAY, settings.getAll().weekStartDay)).id, { title, plannedDate: TODAY, ...extra });
  const get = (role, qs = '', headers = {}) => fetch(`${S.base}/api/admin/me/tasks/pending-count${qs}`, { headers: { cookie: cookies[role], ...headers } })
    .then(async (res) => ({ status: res.status, json: await res.json().catch(() => ({})) }));

  before(async () => {
    resetDb();
    plans = require('../src/repositories/weeklyPlanRepository');
    cal = require('../src/engine/calendarService');
    settings = require('../src/repositories/settingsRepository');
    TODAY = require('../src/utils/serverTime').todayDateString();
    mgr = F.makeUser({ role: 'manager' });
    emp = F.makeUser({ role: 'employee', managerId: mgr.id });
    users = { employee: emp, manager: mgr, hr: F.makeUser({ role: 'hr' }), admin: F.makeUser({ role: 'admin' }) };
    cookies = Object.fromEntries(Object.entries(users).map(([k, v]) => [k, F.sessionCookie(v.id)]));
    S = await startServer();
  });
  after(() => { if (S) S.close(); cleanup(); });

  test('همه‌ی نقش‌ها ۲۰۰؛ هرکس فقط تسک‌های خودش؛ userId در query بی‌اثر است', async () => {
    mk(emp, 'کارمند ۱'); mk(emp, 'کارمند ۲'); mk(mgr, 'سرپرست ۱');
    for (const role of ['employee', 'manager', 'hr', 'admin']) assert.equal((await get(role)).status, 200, role);
    assert.equal((await get('employee')).json.pending, 2);
    assert.equal((await get('manager')).json.pending, 1);
    assert.equal((await get('hr')).json.pending, 0);
    assert.equal((await get('employee', `?userId=${mgr.id}&id=${mgr.id}&date=2020-01-01`)).json.pending, 2);
  });

  test('بدون نشست ۴۰۱؛ کارمند فقط GET دارد (POST/DELETE ⇒ ۴۰۳)', async () => {
    assert.equal((await fetch(`${S.base}/api/admin/me/tasks/pending-count`)).status, 401);
    for (const method of ['POST', 'DELETE', 'PATCH']) {
      const res = await fetch(`${S.base}/api/admin/me/tasks/pending-count`, { method, headers: { cookie: cookies.employee, 'x-requested-with': 'AttendancePanel' } });
      assert.ok([403, 404, 405].includes(res.status), `${method} ⇒ ${res.status}`);
    }
  });

  test('لیست سفید کارمند: pending-count فقط با GET و دقیقاً همین مسیر', () => {
    const { EMPLOYEE_ALLOWED } = require('../src/middleware/adminAuth');
    const ok = (m, p) => EMPLOYEE_ALLOWED.some(([mm, re]) => mm === m && re.test(p));
    assert.equal(ok('GET', '/admin/me/tasks/pending-count'), true);
    for (const [m, p] of [['POST', '/admin/me/tasks/pending-count'], ['GET', '/admin/me/tasks/pending-count/1'], ['GET', '/admin/me/tasks/pending'], ['GET', '/admin/me/tasks']]) assert.equal(ok(m, p), false, `${m} ${p}`);
  });
});

// ---- core.js واقعی در vm با DOM ساختگیِ ساده ----
function makeEl() {
  const cls = new Set(); const attrs = {};
  return {
    innerHTML: '', textContent: '', value: '', style: {}, attrs,
    classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c), toggle: (c, f) => { if (f === undefined ? !cls.has(c) : f) cls.add(c); else cls.delete(c); } },
    addEventListener() {}, setAttribute(k, v) { attrs[k] = v; }, removeAttribute(k) { delete attrs[k]; }, appendChild() {}, remove() {}, focus() {},
    querySelector: () => null, querySelectorAll: () => [],
  };
}
const PANEL_FILES = ['jalali.js', 'core.js', 'views-main.js', 'views-weekly.js', 'views-mystatus.js'];

function loadPanel({ role, perms, pending = 0, pendingFail = false }) {
  const els = new Map(); const calls = [];
  const $ = (sel) => { if (!els.has(sel)) els.set(sel, makeEl()); return els.get(sel); };
  const sandbox = {
    document: { querySelector: $, querySelectorAll: () => [], addEventListener() {}, createElement: makeEl },
    console, URL, URLSearchParams, setTimeout, clearTimeout,
    location: { href: 'http://x/admin/', hash: '', reload() {} }, history: { replaceState() {} }, scrollTo() {}, addEventListener() {},
    fetch: async (u) => {
      calls.push(u);
      const json = (o, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => o, text: async () => JSON.stringify(o) });
      if (u === '/api/admin/me') return json({ id: 7, fullName: 'کاربر', role, department: null });
      if (u === '/api/admin/me/permissions') return json({ role, permissions: perms });
      if (u === '/api/admin/me/tasks/pending-count') return pendingFail ? json({ error: 'x' }, 500) : json({ ok: true, pending });
      return json({ error: 'نامشخص' }, 404);
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const f of PANEL_FILES) vm.runInContext(fs.readFileSync(path.join(root, 'public-admin', 'js', f), 'utf8'), sandbox, { filename: f });
  return { AP: sandbox.AP, $, calls };
}
const settle = async (ms = 60) => { for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, ms / 5)); };
const navIds = ($) => [...$('#side-nav').innerHTML.matchAll(/data-view="(\w+)"/g)].map((m) => m[1]);
const groups = ($) => [...$('#side-nav').innerHTML.matchAll(/<div class="nav-group">([^<]*)<\/div>/g)].map((m) => m[1]);

const EMP_PERMS = ['me.read', 'attendance.read', 'users.details.read', 'taskreports.read'];
const MGR_PERMS = [...EMP_PERMS, 'users.read', 'leave.read'];

describe('وضعیت من (M4): منو و مسیردهی (core.js واقعی)', () => {
  test('کارمند: «وضعیت من» اولین آیتم منو (بالاتر از پروفایل من) با نشان شمارنده؛ صفحه‌ی اول همان', async () => {
    const { AP, $ } = loadPanel({ role: 'employee', perms: EMP_PERMS, pending: 3 });
    await AP.boot(); await settle();
    const ids = navIds($);
    assert.equal(ids[0], 'mystatus');
    assert.equal(ids[1], 'profile');
    assert.deepEqual(groups($), ['پنل من']);
    assert.match($('#side-nav').innerHTML, /data-view="mystatus"[^>]*>.*?<span class="nav-count hidden"><\/span>/s);
    assert.equal(AP.currentRoute.id, 'mystatus');
  });

  test('سرپرست/منابع انسانی/ادمین: یک آیتم «وضعیت من» در گروه «پنل من» انتهای منو؛ صفحه‌ی اول همچنان داشبورد', async () => {
    for (const role of ['manager', 'hr', 'admin']) {
      const { AP, $ } = loadPanel({ role, perms: [...MGR_PERMS, 'dashboard.read', 'stats.read'] });
      await AP.boot(); await settle();
      const ids = navIds($);
      assert.equal(ids.filter((x) => x === 'mystatus').length, 1, role);
      assert.equal(ids[ids.length - 1], 'mystatus', role);
      assert.equal(groups($)[groups($).length - 1], 'پنل من', role);
      assert.equal(ids.includes('profile') && ids.indexOf('profile') > ids.indexOf('mystatus'), false);
      assert.notEqual(AP.currentRoute.id, 'mystatus', `${role}: صفحه‌ی اول عوض نشده`);
    }
  });

  test('بدون me.read آیتم ساخته نمی‌شود (default-deny)', async () => {
    const { AP, $ } = loadPanel({ role: 'manager', perms: ['users.read', 'attendance.read'] });
    await AP.boot(); await settle();
    assert.equal(navIds($).includes('mystatus'), false);
  });

  test('نشان: عدد از /admin/me/tasks/pending-count؛ بیش از ۹ ⇒ «۹+»؛ ۰ ⇒ پنهان؛ aria-label با تعداد', async () => {
    const { AP, $ } = loadPanel({ role: 'employee', perms: EMP_PERMS, pending: 3 });
    await AP.boot(); await settle();
    const badge = $('.nav-item[data-view="mystatus"] .nav-count');
    assert.equal(AP.state.counts.mystatus, 3);
    assert.equal(badge.textContent, AP.fmt.num(3));
    assert.equal(badge.classList.contains('hidden'), false);

    const big = loadPanel({ role: 'employee', perms: EMP_PERMS, pending: 25 });
    await big.AP.boot(); await settle();
    assert.equal(big.$('.nav-item[data-view="mystatus"] .nav-count').textContent, `${big.AP.fmt.num(9)}+`);

    const none = loadPanel({ role: 'employee', perms: EMP_PERMS, pending: 0 });
    await none.AP.boot(); await settle();
    assert.equal(none.$('.nav-item[data-view="mystatus"] .nav-count').classList.contains('hidden'), true);
  });

  test('refreshMyTasksCount: بعد از تغییر عدد به‌روز می‌شود؛ خطای سرور ⇒ ۰ و بدون پرتاب خطا', async () => {
    const { AP, $ } = loadPanel({ role: 'employee', perms: EMP_PERMS, pending: 2 });
    await AP.boot(); await settle();
    assert.equal(AP.state.counts.mystatus, 2);
    const failing = loadPanel({ role: 'employee', perms: EMP_PERMS, pendingFail: true });
    await failing.AP.boot(); await settle();
    await assert.doesNotReject(() => failing.AP.refreshMyTasksCount());
    assert.equal(failing.AP.state.counts.mystatus, 0);
    assert.equal(failing.$('.nav-item[data-view="mystatus"] .nav-count').classList.contains('hidden'), true);
  });

  test('refreshCounts بقیه‌ی شمارنده‌ها را خراب نمی‌کند و mystatus را حفظ می‌کند', async () => {
    const { AP } = loadPanel({ role: 'manager', perms: MGR_PERMS, pending: 4 });
    await AP.boot(); await settle();
    await AP.refreshCounts(); await settle();
    assert.equal(AP.state.counts.mystatus, 4);
    assert.equal(typeof AP.state.counts.leave, 'number');
  });
});

describe('وضعیت من (M4): اتصال ایستا', () => {
  test('صفحه بعد از هر تیک نشان منو را تازه می‌کند؛ بدون userId/miniapp', () => {
    const view = read('public-admin/js/views-mystatus.js');
    assert.match(view, /AP\.refreshMyTasksCount\(\)/);
    assert.doesNotMatch(view, /\/miniapp\/|\/admin\/users\//);
    const core = read('public-admin/js/core.js');
    assert.match(core, /\/admin\/me\/tasks\/pending-count/);
    assert.match(core, /counter: true/);
  });
  test('مسیر pending-count با me.read و بدون userId از کلاینت', () => {
    const route = read('src/api/routes/admin/myTasks.js');
    assert.match(route, /router\.get\('\/admin\/me\/tasks\/pending-count', requirePermission\('me\.read'\)/);
    assert.doesNotMatch(route, /req\.(body|query|params)\.(userId|user_id|id)\b/);
  });
});

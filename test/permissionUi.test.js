// S4-4b: UI پنل بر پایه‌ی مجوزهای کاربر (endpoint /api/admin/me/permissions).
// core.js و views-*.js واقعی داخل vm اجرا می‌شوند (DOM ساختگی ساده) و با سرور واقعی (createApp) حرف می‌زنند؛
// پس هم نگاشت نقش→منو/دکمه و هم endpoint جدید با هم تست می‌شوند. تست دستی مرورگر در گزارش S4-4b آمده است.
// یادآوری: پنهان‌بودن دکمه امنیت نیست؛ امنیت واقعی در test/permissionRoutes.test.js (گارد سرور) قفل است.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let hasDeps = true;
try { require.resolve('express'); } catch (_) { hasDeps = false; }

const JS_DIR = path.join(__dirname, '..', 'public-admin', 'js');
const PANEL_FILES = ['jalali.js', 'core.js', 'views-main.js', 'views-ops.js', 'views-calendar.js', 'views-admin.js', 'views-shifts.js']; // boot.js عمداً نه: خودش AP.boot() را صدا می‌زند

// منوی هر نقش پیش از S4-4b (admin: همه؛ manager: همه‌ی غیر‌ادمینی؛ employee: صفحه‌های employee:true + پروفایل من) + hr جدید.
const NAV = {
  admin: ['attendance', 'audit', 'broadcast', 'dashboard', 'disputes', 'employees', 'holidays', 'leave', 'leaveQueue', 'live', 'nightly', 'reports', 'settings', 'shifts', 'status', 'suspicious', 'system', 'teamCalendar'],
  manager: ['attendance', 'dashboard', 'disputes', 'employees', 'leave', 'leaveQueue', 'live', 'nightly', 'reports', 'suspicious', 'teamCalendar'],
  employee: ['attendance', 'disputes', 'leave', 'profile', 'reports'],
  hr: ['attendance', 'dashboard', 'disputes', 'employees', 'leave', 'leaveQueue', 'live', 'nightly', 'reports', 'teamCalendar'],
};

function makeEl() {
  const cls = new Set();
  return {
    innerHTML: '', textContent: '', value: '', style: {},
    classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c), toggle: (c, f) => { if (f === undefined ? !cls.has(c) : f) cls.add(c); else cls.delete(c); } },
    addEventListener() {}, setAttribute() {}, removeAttribute() {}, appendChild() {}, remove() {}, focus() {},
    querySelector: () => null, querySelectorAll: () => [],
  };
}

// پنل واقعی (بدون مرورگر) که با fetch به سرور تست و کوکی نقش مورد نظر کار می‌کند
function loadPanel(base, cookie) {
  const els = new Map();
  const $ = (sel) => { if (!els.has(sel)) els.set(sel, makeEl()); return els.get(sel); };
  const sandbox = {
    document: { querySelector: $, querySelectorAll: () => [], addEventListener() {}, createElement: makeEl },
    console, URL, URLSearchParams, setTimeout, clearTimeout,
    location: { href: `${base}/admin/`, hash: '', reload() {} },
    history: { replaceState() {} },
    scrollTo() {},
    addEventListener() {}, // window.addEventListener('hashchange') در core.js
    fetch: (u, o = {}) => fetch(base + u, { ...o, headers: { ...(o.headers || {}), cookie } }),
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const f of PANEL_FILES) vm.runInContext(fs.readFileSync(path.join(JS_DIR, f), 'utf8'), sandbox, { filename: f });
  return { AP: sandbox.AP, win: sandbox, $ };
}

async function settle($) {
  for (let i = 0; i < 300; i += 1) {
    await new Promise((r) => setTimeout(r, 10));
    if ($('#side-nav').innerHTML && !$('#page').innerHTML.includes('spinner')) return;
  }
  throw new Error('پنل در زمان مقرر آماده نشد');
}
const navIds = ($) => [...$('#side-nav').innerHTML.matchAll(/data-view="(\w+)"/g)].map((m) => m[1]).sort();

describe('UI پنل بر پایه‌ی مجوز (S4-4b)', { skip: hasDeps ? false : 'express نصب نیست (npm install)' }, () => {
  let server, base, cookies, users, permissionsFor, PERMISSIONS;

  before(async () => {
    resetDb();
    const f = require('./helpers/factories');
    const leaveRepository = require('../src/repositories/leaveRepository');
    ({ permissionsFor, PERMISSIONS } = require('../src/middleware/permissions'));
    const { createApp } = require('../src/server');
    const admin = f.makeUser({ role: 'admin' });
    const hr = f.makeUser({ role: 'hr' });
    const mgr = f.makeUser({ role: 'manager' });
    const emp = f.makeUser({ role: 'employee', managerId: mgr.id });
    users = { admin, hr, manager: mgr, employee: emp };
    leaveRepository.createLeaveRequest({ userId: emp.id, startDate: '2026-09-20', endDate: '2026-09-20', leaveType: 'leave', reason: 'تست' });
    cookies = Object.fromEntries(Object.entries(users).map(([role, u]) => [role, f.sessionCookie(u.id)]));
    server = createApp().listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => { if (server) server.close(); cleanup(); });

  test('GET /api/admin/me/permissions: فهرست دقیق مجوزهای نقش؛ بدون سشن ۴۰۱؛ فقط GET؛ hr بدون هیچ مجوز نوشتن', async () => {
    for (const role of ['admin', 'manager', 'employee', 'hr']) {
      const res = await fetch(`${base}/api/admin/me/permissions`, { headers: { cookie: cookies[role] } });
      assert.equal(res.status, 200, role); // از جمله کارمند: در لیست سفید است
      const json = await res.json();
      assert.equal(json.role, role);
      assert.deepEqual(json.permissions, permissionsFor(role));
    }
    assert.deepEqual((await (await fetch(`${base}/api/admin/me/permissions`, { headers: { cookie: cookies.admin } })).json()).permissions, [...PERMISSIONS]);
    assert.equal((await fetch(`${base}/api/admin/me/permissions`)).status, 401);
    const post = await fetch(`${base}/api/admin/me/permissions`, { method: 'POST', headers: { cookie: cookies.employee, 'x-requested-with': 'AttendancePanel' } });
    assert.equal(post.status, 403, 'کارمند فقط GET این مسیر را دارد');
    const hrPerms = permissionsFor('hr');
    for (const p of hrPerms) assert.doesNotMatch(p, /\.(edit|write|approve|resolve|manage|review)$/, `hr فقط‌خواندنی است: ${p}`);
  });

  test('منو و صفحه‌ی اول هر نقش (admin/manager/employee مثل قبل، hr جدید) و رد صفحه‌ی غیرمجاز با hash', async () => {
    for (const role of ['admin', 'manager', 'employee', 'hr']) {
      const { AP, win, $ } = loadPanel(base, cookies[role]);
      await AP.boot();
      await settle($);
      assert.deepEqual(navIds($), NAV[role].slice().sort(), `منوی ${role}`);
      const home = role === 'employee' ? 'profile' : 'dashboard';
      assert.equal(AP.currentRoute.id, home, `صفحه‌ی اول ${role}`);
      if (role === 'employee') assert.equal(AP.currentRoute.param, users.employee.id);
      assert.equal(AP.state.perms.size, permissionsFor(role).length);

      // آدرس صفحه‌ی بدون مجوز ⇒ برگشت به صفحه‌ی اول
      for (const id of ['system', 'audit', 'suspicious', 'settings']) {
        const allowed = AP.viewAllowed(AP.views[id]);
        win.location.hash = `#/${id}`;
        await AP.refresh();
        assert.equal(AP.currentRoute.id, allowed ? id : home, `${role} → #/${id}`);
      }
    }
    // کارمند با پروفایل دیگران: همیشه خودش
    const { AP, win, $ } = loadPanel(base, cookies.employee);
    await AP.boot();
    await settle($);
    win.location.hash = `#/profile/${users.manager.id}`;
    await AP.refresh();
    assert.deepEqual([AP.currentRoute.id, AP.currentRoute.param], ['profile', users.employee.id]);
  });

  test('دکمه‌ها و اکشن‌ها فقط با مجوزشان ظاهر می‌شوند (کارمندان، پرونده‌ی کارمند، مرخصی، تردد، مرور شبانه)', async () => {
    const want = {
      // [add-emp, att-new, lv-new, approve/edit مرخصی در صفحه‌ی مرخصی, approve در مرور شبانه, pf-msg, pf-rec, pf-leave, pf-revoke, pf-del]
      // (دکمه‌های ردیف‌های تابلوی زنده/مرور شبانه در mount با DOM واقعی ساخته می‌شوند؛ تست دستی)
      admin: [true, true, true, true, true, true, true, true, true, true],
      manager: [false, true, true, true, true, true, true, true, false, false],
      hr: [false, false, false, false, false, false, false, false, false, false],
    };
    const has = (html, re) => re.test(html);
    for (const role of ['admin', 'manager', 'hr']) {
      const { AP } = loadPanel(base, cookies[role]);
      AP.state.me = await AP.api('/admin/me');
      assert.equal(await AP.loadPermissions(), true);
      const page = async (id, param) => (await AP.views[id].render(param)).html;
      const emp = await page('employees');
      const att = await page('attendance');
      const lv = await page('leave');
      const night = await page('nightly');
      const pf = await page('profile', users.employee.id);
      const got = [
        has(emp, /id="add-emp"/), has(att, /id="att-new"/), has(lv, /id="lv-new"/),
        has(lv, /data-act="approve"/) && has(lv, /data-edit=/),
        has(night, /data-act="approve"/),
        has(pf, /id="pf-msg"/), has(pf, /id="pf-rec"/), has(pf, /id="pf-leave"/), has(pf, /id="pf-revoke"/), has(pf, /id="pf-del"/),
      ];
      assert.deepEqual(got, want[role], `دکمه‌های ${role}`);
      assert.match(lv, /ثبت‌شده|مرخصی|درخواست/, 'صفحه‌ی مرخصی برای همه‌ی این نقش‌ها خوانا رندر می‌شود');
    }
    // کارمند: فقط‌خواندنی روی داده‌ی خودش
    const { AP } = loadPanel(base, cookies.employee);
    AP.state.me = await AP.api('/admin/me');
    await AP.loadPermissions();
    const lv = (await AP.views.leave.render()).html;
    const pf = (await AP.views.profile.render(users.employee.id)).html;
    assert.doesNotMatch(lv, /data-act=|data-edit=|id="lv-new"/);
    assert.doesNotMatch(pf, /id="pf-(msg|rec|leave|revoke|del)"/);
    assert.doesNotMatch(pf, /data-go="employees"/, 'کارمند «بازگشت به کارمندان» ندارد');
    assert.equal(AP.selfOnly(), true);
  });

  test('default-deny: AP.can بدون مجوز false، شکست بارگذاری مجوزها ⇒ هیچ منو/صفحه‌ای، هر view دارای perm معتبر و هیچ بررسی نقشِ خام در UI نیست', async () => {
    const { AP, win, $ } = loadPanel(base, 'asp_session=invalid'); // سشن نامعتبر ⇒ /me/permissions ۴۰۱
    assert.equal(AP.can(), false);
    assert.equal(AP.can('me.read'), false, 'قبل از بارگذاری هیچ مجوزی نیست');
    AP.state.perms = new Set(['a.read', 'b.read']);
    assert.deepEqual([AP.can('a.read'), AP.can('a.read', 'b.read'), AP.can('a.read', 'c.read'), AP.can(42), AP.can('toString')], [true, true, false, false, false]);
    AP.state.perms = new Set();
    AP.state.me = { id: 1, fullName: 'x', role: 'admin', department: '' }; // حتی با ادعای نقش admin در کلاینت، بدون مجوز سرور هیچ باز نمی‌شود
    assert.equal(await AP.loadPermissions(), false);
    assert.equal(AP.state.perms.size, 0);
    win.location.hash = '#/dashboard';
    await AP.refresh();
    assert.match($('#page').innerHTML, /هیچ بخشی/);
    assert.equal(AP.homeRoute(), null);

    const perms = new Set(PERMISSIONS);
    for (const [id, def] of Object.entries(AP.views)) {
      // perm رشته‌ی تکی یا آرایه‌ی غیرخالی (هرکدام کافی؛ مثل صف تأیید S4-13b) — در هر دو حالت همه‌ی مجوزهای ذکرشده باید معتبر باشند
      const list = Array.isArray(def.perm) ? def.perm : [def.perm];
      assert.ok(list.length > 0 && list.every((p) => perms.has(p)), `view «${id}» باید perm معتبر داشته باشد (الان: ${def.perm})`);
      assert.equal(def.admin, undefined, `${id}: admin:true حذف شده`);
      assert.equal(def.employee, undefined, `${id}: employee:true حذف شده`);
    }
    // هیچ‌کدام از فایل‌های بارگذاری‌شده در index.html نباید دوباره به پرچم‌های نقش (isAdmin/isStaff/isEmployee) تکیه کنند
    const html = fs.readFileSync(path.join(__dirname, '..', 'public-admin', 'index.html'), 'utf8');
    const loaded = [...html.matchAll(/src="\/admin\/js\/([\w.-]+\.js)"/g)].map((m) => m[1]);
    assert.ok(loaded.includes('core.js') && loaded.includes('views-ops.js'));
    for (const f of loaded) {
      assert.doesNotMatch(fs.readFileSync(path.join(JS_DIR, f), 'utf8'), /\b(isAdmin|isStaff|isEmployee)\b/, `${f} هنوز به پرچم نقش تکیه دارد`);
    }
  });
});

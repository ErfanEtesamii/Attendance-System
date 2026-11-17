// فاز B (بخش سرپرست‌ها): ماتریس قابلیت‌های سرپرست — تنظیم supervisorEnabledCapabilities (نوع multiselect)،
// مجوزهای پویا، سرویس‌ها، منوی بات و API. بخش API فقط با express نصب‌شده اجرا می‌شود.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

let hasDeps = true;
try { require.resolve('express'); } catch (_) { hasDeps = false; }

const KEY = 'supervisorEnabledCapabilities';
const registry = require('../src/utils/settingsRegistry');
const settingsRepository = require('../src/repositories/settingsRepository');
const permissions = require('../src/middleware/permissions');
const { SUPERVISOR_TOGGLEABLE_CAPABILITIES: TOGGLEABLE } = require('../src/utils/supervisorCapabilities');

const { hasPermission, permissionsFor, ROLE_PERMISSIONS, PERMISSIONS } = permissions;
const without = (...off) => TOGGLEABLE.filter((c) => !off.includes(c));
const baseline = (role) => [...ROLE_PERMISSIONS[role]].sort();

describe('supervisorEnabledCapabilities — رجیستری و نوع multiselect', () => {
  before(() => { resetDb(); });
  after(() => cleanup());
  beforeEach(() => { settingsRepository.resetValue(KEY); });

  test('تعریف: گروه supervisors، پیش‌فرض = همه‌ی ۱۶ قابلیت (رفتار فعلی)، selfCheck سالم', () => {
    assert.deepEqual(registry.selfCheck(), []);
    const d = registry.getDef(KEY);
    assert.equal(d.type, 'multiselect');
    assert.equal(d.group, 'supervisors');
    assert.ok(registry.TYPES.includes('multiselect'));
    assert.equal(TOGGLEABLE.length, 16);
    assert.deepEqual(registry.defaultOf(KEY), [...TOGGLEABLE]);
    assert.deepEqual(settingsRepository.getAll()[KEY], [...TOGGLEABLE]);
    assert.deepEqual(settingsRepository.getItem(KEY).values, [...TOGGLEABLE]);
    assert.equal(settingsRepository.getItem(KEY).isDefault, true);
  });

  test('هر قابلیت خاموش‌شدنی مجوز واقعیِ سرپرست است و مجوزهای پایه در فهرست نیستند', () => {
    for (const c of TOGGLEABLE) {
      assert.ok(PERMISSIONS.includes(c), `ناشناخته: ${c}`);
      assert.ok(ROLE_PERMISSIONS.manager.has(c), `سرپرست ندارد: ${c}`);
    }
    for (const base of ['me.read', 'notifications.read', 'notifications.mark', 'attendance.read', 'users.read', 'reviews.read', 'team.week_view', 'dashboard.read', 'leave.read', 'settings.read']) {
      assert.ok(!TOGGLEABLE.includes(base), `پایه نباید خاموش‌شدنی باشد: ${base}`);
    }
  });

  test('اعتبارسنجی: آرایه یا متن کاما‌جدا، یکتا و به ترتیب values؛ ناشناخته/نوع نادرست ⇒ خطا؛ خالی مجاز', () => {
    assert.deepEqual(registry.validate(KEY, ['records.edit', 'leave.approve', 'records.edit']), { ok: true, value: ['leave.approve', 'records.edit'] });
    assert.deepEqual(registry.validate(KEY, 'records.edit, leave.approve').value, ['leave.approve', 'records.edit']);
    assert.deepEqual(registry.validate(KEY, []), { ok: true, value: [] });
    assert.equal(registry.validate(KEY, ['nope']).ok, false);
    assert.equal(registry.validate(KEY, ['users.read']).ok, false, 'مجوز پایه پذیرفته نمی‌شود');
    assert.equal(registry.validate(KEY, 7).ok, false);
    assert.equal(registry.validate(KEY, { a: 1 }).ok, false);
    assert.equal(registry.validate(KEY, [1]).ok, false);
  });

  test('ذخیره/خواندن: serialize با کاما، خالی ماندگار است، مقدار خراب ⇒ پیش‌فرض کامل (نه خالی)', () => {
    settingsRepository.setValue(KEY, ['records.edit', 'leave.approve']);
    assert.deepEqual(settingsRepository.getAll()[KEY], ['leave.approve', 'records.edit']);
    assert.equal(settingsRepository.getItem(KEY).isDefault, false);
    settingsRepository.setValue(KEY, []);
    assert.deepEqual(settingsRepository.getAll()[KEY], []);
    assert.equal(settingsRepository.getSupervisorEnabledCapabilities().length, 0);
    assert.equal(registry.serialize(KEY, ['leave.approve', 'records.edit']), 'leave.approve,records.edit');
    assert.equal(registry.deserialize(KEY, 'garbage,leave.approve').length, TOGGLEABLE.length);
    assert.equal(registry.sameValue(['a', 'b'], ['a', 'b']), true);
    assert.equal(registry.sameValue(['a'], ['a', 'b']), false);
    settingsRepository.resetValue(KEY);
    assert.deepEqual(settingsRepository.getAll()[KEY], [...TOGGLEABLE]);
  });

  test('update (PATCH قدیمی) مقدار نامعتبر را نادیده می‌گیرد', () => {
    settingsRepository.update({ [KEY]: ['nope'] });
    assert.deepEqual(settingsRepository.getAll()[KEY], [...TOGGLEABLE]);
    settingsRepository.update({ [KEY]: ['plans.exempt'] });
    assert.deepEqual(settingsRepository.getAll()[KEY], ['plans.exempt']);
  });
});

describe('مجوزهای پویای سرپرست (permissions.js)', () => {
  before(() => { resetDb(); });
  after(() => cleanup());
  beforeEach(() => { settingsRepository.resetValue(KEY); });

  test('پیش‌فرض: مجوز مؤثر سرپرست دقیقاً مثل قبل است', () => {
    assert.deepEqual([...permissionsFor('manager')].sort(), baseline('manager'));
    for (const p of PERMISSIONS) assert.equal(hasPermission('manager', p), ROLE_PERMISSIONS.manager.has(p), p);
    assert.deepEqual(permissions.permissionsForRole('manager'), permissionsFor('manager'));
  });

  for (const cap of TOGGLEABLE) {
    test(`خاموش‌کردن ${cap}: فقط همان از سرپرست گرفته می‌شود؛ بقیه‌ی نقش‌ها بدون تغییر`, () => {
      const before = { employee: permissionsFor('employee'), hr: permissionsFor('hr'), admin: permissionsFor('admin'), owner: permissionsFor('owner') };
      settingsRepository.setValue(KEY, without(cap)); // ابطال کش همان لحظه (بدون انتظار TTL)
      assert.equal(hasPermission('manager', cap), false);
      assert.ok(!permissionsFor('manager').includes(cap));
      assert.deepEqual([...permissionsFor('manager')].sort(), baseline('manager').filter((p) => p !== cap));
      for (const [role, list] of Object.entries(before)) assert.deepEqual(permissionsFor(role), list, role);
      assert.equal(hasPermission('admin', cap), true);
      assert.equal(hasPermission('owner', cap), true);
    });
  }

  test('همه‌ی قابلیت‌ها خاموش (لیست خالی): فقط مجوزهای پایه می‌ماند؛ برگشتن به پیش‌فرض فوراً اثر دارد', () => {
    settingsRepository.setValue(KEY, []);
    const now = permissionsFor('manager');
    for (const c of TOGGLEABLE) assert.ok(!now.includes(c), c);
    for (const base of ['me.read', 'users.read', 'reviews.read', 'team.week_view', 'dashboard.read', 'leave.read']) assert.ok(now.includes(base), base);
    settingsRepository.resetValue(KEY);
    assert.deepEqual([...permissionsFor('manager')].sort(), baseline('manager'));
  });

  test('default-deny و ورودی نامعتبر مثل قبل', () => {
    assert.equal(hasPermission('manager', 'no.such'), false);
    assert.equal(hasPermission('boss', 'me.read'), false);
    assert.equal(hasPermission(undefined, 'me.read'), false);
    assert.equal(hasPermission('manager', undefined), false);
    assert.deepEqual(permissionsFor('boss'), []);
  });

  test('خطای خواندن تنظیم ⇒ لیست کامل پیش‌فرض (نه لیست خالی)', () => {
    settingsRepository.setValue(KEY, []);
    assert.equal(hasPermission('manager', 'records.edit'), false);
    const orig = settingsRepository.getSupervisorEnabledCapabilities;
    permissions.invalidateManagerPermissionsCache();
    settingsRepository.getSupervisorEnabledCapabilities = () => { throw new Error('db down'); };
    try {
      assert.equal(hasPermission('manager', 'records.edit'), true);
      assert.deepEqual([...permissionsFor('manager')].sort(), baseline('manager'));
    } finally {
      settingsRepository.getSupervisorEnabledCapabilities = orig;
      permissions.invalidateManagerPermissionsCache();
    }
  });

  test('requirePermission: سرپرست با قابلیت خاموش ⇒ ۴۰۳؛ با قابلیت روشن ⇒ next', () => {
    const F = require('./helpers/factories');
    const mgr = F.makeUser({ role: 'manager' });
    const run = () => { let status = null; let called = false; permissions.requirePermission('records.edit')({ adminUser: mgr }, { status(s) { status = s; return { json() {} }; } }, () => { called = true; }); return { status, called }; };
    assert.deepEqual(run(), { status: null, called: true });
    settingsRepository.setValue(KEY, without('records.edit'));
    assert.deepEqual(run(), { status: 403, called: false });
  });
});

describe('سرویس‌ها: تبدیل چک نقش به مجوز با حفظ اسکوپ تیم', () => {
  let F, leaveApproval, leaveRepository, mgr, mgr2, emp, orphan, admin, hr;
  before(() => {
    resetDb();
    F = require('./helpers/factories');
    leaveApproval = require('../src/services/leaveApprovalService');
    leaveRepository = require('../src/repositories/leaveRepository');
    mgr = F.makeUser({ role: 'manager' });
    mgr2 = F.makeUser({ role: 'manager' });
    emp = F.makeUser({ role: 'employee', managerId: mgr.id });
    orphan = F.makeUser({ role: 'employee' });
    admin = F.makeUser({ role: 'admin' });
    hr = F.makeUser({ role: 'hr' });
  });
  after(() => cleanup());
  beforeEach(() => { settingsRepository.resetValue(KEY); });

  const newLeave = (userId) => leaveRepository.createLeaveRequest({ userId, startDate: '2026-11-21', endDate: '2026-11-21', leaveType: 'leave', reason: 'تست' });

  test('leave.approve: پیش‌فرض رفتار قبلی؛ خاموش ⇒ سرپرست نمی‌تواند و درخواست فقط ادمین است', () => {
    const r = newLeave(emp.id);
    assert.equal(leaveApproval.canDecide(mgr, r), true);
    assert.equal(leaveApproval.canDecide(mgr2, r), false, 'سرپرستِ غیرمستقیم همچنان رد');
    assert.equal(leaveApproval.canDecide(hr, r), false);
    assert.equal(leaveApproval.awaitingRole(r), 'manager');
    assert.equal(leaveApproval.decidingSupervisorOf(emp).id, mgr.id);

    settingsRepository.setValue(KEY, without('leave.approve'));
    assert.equal(leaveApproval.canDecide(mgr, r), false);
    assert.equal(leaveApproval.canDecide(admin, r), true);
    assert.equal(leaveApproval.awaitingRole(r), 'admin', 'مثل «بدون سرپرست»');
    assert.equal(leaveApproval.decidingSupervisorOf(emp), null);
    const d = leaveApproval.decide({ requestId: r.id, actor: mgr, decision: 'approve' });
    assert.equal(d.ok, false);
    assert.equal(d.code, 'FORBIDDEN');
    assert.match(d.error, /فقط با ادمین/);
  });

  test('کارمندِ بدون سرپرست و «نه برای خود» دست‌نخورده', () => {
    const r = newLeave(orphan.id);
    assert.equal(leaveApproval.awaitingRole(r), 'admin');
    assert.equal(leaveApproval.canDecide(mgr, r), false);
    assert.equal(leaveApproval.decidingSupervisorOf(orphan), null);
    const own = newLeave(mgr.id);
    assert.equal(leaveApproval.canDecide(mgr, own), false, 'سرپرست زیردست خودش نیست');
  });

  test('tasks.assign_urgent: خاموش ⇒ FORBIDDEN؛ روشن ⇒ فقط تیم خودش', () => {
    const urgent = require('../src/services/urgentTaskService');
    assert.equal(urgent.scopeFailure(mgr, emp), null);
    assert.equal(urgent.scopeFailure(mgr, orphan).code, 'NOT_IN_SCOPE');
    assert.equal(urgent.scopeFailure(mgr, mgr).code, 'SELF_NOT_ALLOWED');
    settingsRepository.setValue(KEY, without('tasks.assign_urgent'));
    assert.equal(urgent.scopeFailure(mgr, emp).code, 'FORBIDDEN');
    assert.equal(urgent.scopeFailure(admin, emp), null);
  });

  test('reviews.write: خاموش ⇒ isReviewer=false ولی خواندنِ تیم (reviews.read) می‌ماند', () => {
    const tr = require('../src/services/teamReviewService');
    assert.equal(tr.isReviewer(mgr), true);
    assert.equal(tr.teamOf(mgr).some((u) => u.id === emp.id), true);
    settingsRepository.setValue(KEY, without('reviews.write'));
    assert.equal(tr.isReviewer(mgr), false);
    assert.equal(tr.isReviewer(admin), true);
    assert.equal(tr.teamOf(mgr).some((u) => u.id === emp.id), true, 'سرپرست همچنان تیم را می‌بیند');
    assert.equal(tr.markReviewed(mgr, { userId: emp.id, date: '2026-11-15' }).code, 'FORBIDDEN');
  });

  test('checkin_permissions.decide: خاموش ⇒ canDecide سرپرست false؛ ادمین همیشه', () => {
    const late = require('../src/services/lateLimitService');
    assert.equal(late.canDecide(mgr, emp), true);
    assert.equal(late.canDecide(mgr2, emp), false);
    settingsRepository.setValue(KEY, without('checkin_permissions.decide'));
    assert.equal(late.canDecide(mgr, emp), false);
    assert.equal(late.canDecide(admin, emp), true);
  });

  test('plan.edit_team و remote_work.review: خاموش ⇒ FORBIDDEN؛ اسکوپ تیم برقرار', () => {
    const wp = require('../src/services/weeklyPlanAdminService');
    const rw = require('../src/services/remoteWorkAdminService');
    assert.equal(wp.scopeFailure(mgr, emp), null);
    assert.equal(wp.scopeFailure(mgr, orphan).code, 'NOT_IN_SCOPE');
    assert.equal(rw.reviewScopeFailure(mgr, emp), null);
    assert.equal(rw.reviewScopeFailure(mgr, orphan).code, 'NOT_IN_SCOPE');
    settingsRepository.setValue(KEY, without('plan.edit_team', 'remote_work.review'));
    assert.equal(wp.scopeFailure(mgr, emp).code, 'FORBIDDEN');
    assert.equal(rw.reviewScopeFailure(mgr, emp).code, 'FORBIDDEN');
    assert.equal(rw.readScopeFailure(mgr, emp), null, 'خواندن دورکاری (remote_work.read) پایه است');
  });
});

describe('بات: منو و راهنما بر پایه‌ی مجوز', () => {
  let F, menu, mgr, admin, emp;
  before(() => {
    resetDb();
    F = require('./helpers/factories');
    menu = require('../src/bot/menu/menuRouter');
    mgr = F.makeUser({ role: 'manager' });
    admin = F.makeUser({ role: 'admin' });
    emp = F.makeUser({ role: 'employee' });
  });
  after(() => cleanup());
  beforeEach(() => { settingsRepository.resetValue(KEY); });

  const labelsOf = (user) => (menu.buildMenuInline(user) || { inline_keyboard: [] }).inline_keyboard.flat().map((b) => b.text).join('|');
  const has = (user, label) => labelsOf(user).includes(label);

  test('پیش‌فرض: دکمه‌های سرپرستی مثل قبل', () => {
    for (const l of ['درخواست‌های منتظر', 'گزارش تیم', 'تسک فوری', 'اعتراض‌ها', 'لیست اعضا']) assert.equal(has(mgr, l), true, l);
    assert.equal(has(emp, 'تسک فوری'), false);
  });

  test('خاموش‌کردن هر قابلیت ⇒ دکمه‌ی مربوط پنهان؛ ادمین بدون تغییر', () => {
    settingsRepository.setValue(KEY, without('tasks.assign_urgent'));
    assert.equal(has(mgr, 'تسک فوری'), false);
    assert.equal(has(mgr, 'گزارش تیم'), true);
    assert.equal(has(admin, 'تسک فوری'), true);
    settingsRepository.setValue(KEY, without('disputes.resolve'));
    assert.equal(has(mgr, 'اعتراض‌ها'), false);
    assert.equal(has(mgr, 'تسک فوری'), true);
    // «درخواست‌های منتظر» تا وقتی یکی از leave.approve/remote_work.review روشن است می‌ماند
    settingsRepository.setValue(KEY, without('leave.approve'));
    assert.equal(has(mgr, 'درخواست‌های منتظر'), true);
    settingsRepository.setValue(KEY, without('leave.approve', 'remote_work.review'));
    assert.equal(has(mgr, 'درخواست‌های منتظر'), false);
    assert.equal(has(admin, 'درخواست‌های منتظر'), true);
  });

  test('راهنما فقط دکمه‌های مجاز را می‌گوید', async () => {
    const { handleHelp } = require('../src/bot/commands/help');
    const say = async (u) => { let text = ''; await handleHelp({ sendMessage: async (_c, t) => { text = t; } }, { chat: { id: 1 }, from: { id: u.telegram_user_id } }); return text; };
    assert.match(await say(mgr), /تسک فوری/);
    settingsRepository.setValue(KEY, without('tasks.assign_urgent', 'disputes.resolve'));
    const t = await say(mgr);
    assert.doesNotMatch(t, /تسک فوری/);
    assert.doesNotMatch(t, /اعتراض‌ها/);
    assert.match(t, /گزارش تیم/);
    assert.match(await say(admin), /تسک فوری/);
  });

  test('اجرای دکمه‌ی پنهان سمت سرور هم رد می‌شود', async () => {
    settingsRepository.setValue(KEY, without('tasks.assign_urgent'));
    const sent = [];
    let ran = false;
    const bot = { sendMessage: async (_c, t) => { sent.push(t); }, answerCallbackQuery: async (_id, o) => { sent.push(o && o.text); } };
    await menu.handleMenuCallback(bot, { id: 'q', data: 'mn:urgent_task', from: { id: mgr.telegram_user_id }, message: { chat: { id: 9, type: 'private' } } }, { urgentTask: async () => { ran = true; } });
    assert.equal(ran, false);
    assert.equal(sent.length >= 1, true, 'پاسخ رد به کاربر داده می‌شود');
  });
});

describe('API: ماتریس قابلیت‌ها', { skip: hasDeps ? false : 'express نصب نیست (npm install)' }, () => {
  let server, base, db, F, mgr, emp, other, admin, hr, owner, cookies;

  before(async () => {
    db = resetDb();
    F = require('./helpers/factories');
    const { createApp } = require('../src/server');
    mgr = F.makeUser({ role: 'manager' });
    emp = F.makeUser({ role: 'employee', managerId: mgr.id });
    other = F.makeUser({ role: 'employee' });
    admin = F.makeUser({ role: 'admin' });
    hr = F.makeUser({ role: 'hr' });
    owner = F.makeUser({ role: 'owner' });
    cookies = { mgr: F.sessionCookie(mgr.id), emp: F.sessionCookie(emp.id), admin: F.sessionCookie(admin.id), hr: F.sessionCookie(hr.id), owner: F.sessionCookie(owner.id) };
    server = createApp().listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => { if (server) server.close(); cleanup(); });
  beforeEach(() => { settingsRepository.resetValue(KEY); settingsRepository.resetValue('supervisorRecordEditMonthlyLimit'); });

  async function hit(cookie, method, url, body) {
    const res = await fetch(base + url, {
      method,
      headers: { 'content-type': 'application/json', 'x-requested-with': 'AttendancePanel', cookie },
      body: body && method !== 'GET' ? JSON.stringify(body) : undefined,
    });
    let json = null; try { json = await res.json(); } catch (_) { /* خالی */ }
    return { status: res.status, json };
  }
  const put = (cookie, value, reason = 'تست ماتریس') => hit(cookie, 'PUT', `/api/admin/settings/${KEY}`, { value, reason });

  test('GET items: کلید با نوع multiselect و values کامل در گروه سرپرست‌ها', async () => {
    const r = await hit(cookies.admin, 'GET', '/api/admin/settings/items');
    assert.equal(r.status, 200);
    const it = r.json.items.find((x) => x.key === KEY);
    assert.equal(it.type, 'multiselect');
    assert.equal(it.group, 'supervisors');
    assert.deepEqual(it.values, [...TOGGLEABLE]);
    assert.deepEqual(it.value, [...TOGGLEABLE]);
  });

  test('PUT: دلیل اجباری، مقدار نامعتبر ۴۰۰، فقط ادمین/مالک؛ audit ثبت می‌شود', async () => {
    assert.equal((await hit(cookies.admin, 'PUT', `/api/admin/settings/${KEY}`, { value: [] })).status, 400, 'بدون دلیل');
    assert.equal((await put(cookies.admin, ['nope'])).status, 400);
    for (const who of ['mgr', 'hr', 'emp']) assert.equal((await put(cookies[who], [])).status, 403, who);
    const ok = await put(cookies.owner, without('records.edit'));
    assert.equal(ok.status, 200);
    assert.equal(ok.json.changed, true);
    const row = db.prepare("SELECT details FROM audit_log WHERE action = 'settings_updated' ORDER BY id DESC LIMIT 1").get();
    assert.match(row.details, /supervisorEnabledCapabilities/);
    assert.equal((await put(cookies.owner, without('records.edit'))).json.changed, false);
  });

  test('خاموش‌کردن records.edit ⇒ منوی مجوزها عوض می‌شود و route سرپرست ۴۰۳ می‌دهد؛ ادمین و hr/کارمند بدون تغییر', async () => {
    const date = F.workdayDate(1);
    const body = { userId: emp.id, date, checkInTime: `${date}T04:30:00.000Z`, checkOutTime: `${date}T13:00:00.000Z`, status: 'normal', reason: 'تست' };
    assert.equal((await hit(cookies.mgr, 'GET', '/api/admin/me/permissions')).json.permissions.includes('records.edit'), true);
    assert.equal((await put(cookies.admin, without('records.edit'))).status, 200);
    const perms = (await hit(cookies.mgr, 'GET', '/api/admin/me/permissions')).json.permissions;
    assert.equal(perms.includes('records.edit'), false);
    assert.equal(perms.includes('users.read'), true);
    assert.equal((await hit(cookies.mgr, 'POST', '/api/admin/attendance-records', body)).status, 403);
    assert.equal((await hit(cookies.mgr, 'GET', '/api/admin/me/record-edit-quota')).status, 403);
    assert.equal((await hit(cookies.admin, 'POST', '/api/admin/attendance-records', body)).status, 201);
    assert.deepEqual((await hit(cookies.admin, 'GET', '/api/admin/me/permissions')).json.permissions, permissionsFor('admin'));
    assert.equal((await hit(cookies.hr, 'POST', '/api/admin/attendance-records', body)).status, 403);
    // بازگشت به پیش‌فرض
    assert.equal((await hit(cookies.admin, 'POST', `/api/admin/settings/${KEY}/reset`, { reason: 'تست' })).status, 200);
    assert.equal((await hit(cookies.mgr, 'GET', '/api/admin/me/record-edit-quota')).status, 200);
  });

  test('ترتیب: خاموش‌بودن records.edit قبل از سقف ماهانه اثر می‌کند (۴۰۳ نه ۴۰۹)', async () => {
    settingsRepository.setValue('supervisorRecordEditMonthlyLimit', 1);
    const date = (n) => F.workdayDate(n);
    const make = (n) => hit(cookies.mgr, 'POST', '/api/admin/attendance-records', { userId: emp.id, date: date(n), checkInTime: `${date(n)}T04:30:00.000Z`, checkOutTime: `${date(n)}T13:00:00.000Z`, status: 'normal', reason: 'تست' });
    assert.equal((await make(10)).status, 201);
    assert.equal((await make(11)).status, 409, 'سقف تمام شد');
    await put(cookies.admin, without('records.edit'));
    assert.equal((await make(12)).status, 403, 'مجوز اول چک می‌شود');
  });

  test('leave.approve خاموش ⇒ سرپرست تصمیم نمی‌گیرد، درخواست فقط برای ادمین است؛ اینباکس سرپرست خالی', async () => {
    const leaveRepository = require('../src/repositories/leaveRepository');
    const r1 = leaveRepository.createLeaveRequest({ userId: emp.id, startDate: '2026-11-22', endDate: '2026-11-22', leaveType: 'leave', reason: 'تست' });
    const inbox = async (c) => (await hit(c, 'GET', '/api/admin/inbox')).json;
    assert.equal((await inbox(cookies.mgr)).leave.count >= 1, true);
    await put(cookies.admin, without('leave.approve'));
    assert.equal((await hit(cookies.mgr, 'POST', `/api/admin/leave-requests/${r1.id}/approve`, { note: 'x' })).status, 403);
    assert.equal((await inbox(cookies.mgr)).leave.count, 0);
    assert.equal((await inbox(cookies.admin)).leave.count >= 1, true);
    const list = (await hit(cookies.admin, 'GET', '/api/admin/leave-requests')).json;
    const row = (list.items || list).find((x) => x.id === r1.id);
    if (row && 'awaitingRole' in row) assert.equal(row.awaitingRole, 'admin');
    assert.equal((await hit(cookies.admin, 'POST', `/api/admin/leave-requests/${r1.id}/approve`, { note: 'ok' })).status, 200);
  });

  test('tasks.assign_urgent خاموش ⇒ ۴۰۳ برای سرپرست؛ اسکوپ تیم برای حالت روشن', async () => {
    const date = F.workdayDate(3);
    const body = { date, title: 'تسک', description: 'تست' };
    const own = await hit(cookies.mgr, 'POST', `/api/admin/users/${emp.id}/urgent-tasks`, body);
    assert.notEqual(own.status, 403, 'تیم خودش مجاز است');
    const out = await hit(cookies.mgr, 'POST', `/api/admin/users/${other.id}/urgent-tasks`, body);
    assert.equal(out.status, 403, 'خارج از تیم');
    await put(cookies.admin, without('tasks.assign_urgent'));
    assert.equal((await hit(cookies.mgr, 'POST', `/api/admin/users/${emp.id}/urgent-tasks`, body)).status, 403);
    assert.equal((await hit(cookies.mgr, 'GET', '/api/admin/urgent-tasks')).status, 403);
    assert.notEqual((await hit(cookies.admin, 'POST', `/api/admin/users/${emp.id}/urgent-tasks`, body)).status, 403);
  });
});

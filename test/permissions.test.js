// S4-3a: تست واحد نگاشت نقش → مجوز و requirePermission (بدون DB و بدون سرور).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  PERMISSIONS, ROLE_PERMISSIONS, hasPermission, permissionsFor, requirePermission,
} = require('../src/middleware/permissions');
const { requireStaff, requireFullAdmin } = require('../src/middleware/adminAuth');

// اجرای یک middleware با نقش داده‌شده؛ خروجی: 'next' یا کد وضعیت.
function run(mw, role) {
  let out = null;
  const res = { status(c) { out = c; return this; }, json() { return this; } };
  mw(role === undefined ? {} : { adminUser: { role } }, res, () => { out = 'next'; });
  return out;
}

test('نگاشت سازگار است: هر مجوز نقش‌ها در فهرست کامل است و admin همه را دارد', () => {
  assert.equal(new Set(PERMISSIONS).size, PERMISSIONS.length, 'مجوز تکراری');
  for (const [role, set] of Object.entries(ROLE_PERMISSIONS)) {
    for (const p of set) assert.ok(PERMISSIONS.includes(p), `${role}: مجوز ناشناخته ${p}`);
  }
  assert.deepEqual(permissionsFor('admin'), [...PERMISSIONS]);
  assert.ok(Object.isFrozen(ROLE_PERMISSIONS));
});

test('محدوده‌ی هر نقش: کارمند فقط خواندنی خود، سرپرست عملیات تیم بدون تنظیمات/لاگ/کاربران', () => {
  for (const p of ['attendance.read', 'reports.read', 'leave.read', 'users.details.read']) {
    assert.equal(hasPermission('employee', p), true, `employee ${p}`);
  }
  for (const p of ['records.edit', 'leave.approve', 'users.read', 'settings.read', 'audit.read']) {
    assert.equal(hasPermission('employee', p), false, `employee ${p}`);
  }
  for (const p of ['records.edit', 'leave.approve', 'users.read', 'reports.read', 'settings.read']) {
    assert.equal(hasPermission('manager', p), true, `manager ${p}`);
  }
  for (const p of ['users.write', 'settings.edit', 'audit.read', 'system.manage', 'shifts.edit']) {
    assert.equal(hasPermission('manager', p), false, `manager ${p}`);
    assert.equal(hasPermission('admin', p), true, `admin ${p}`);
  }
});

test('hr: فقط‌خواندنی روی کاربران/گزارش/خروجی/مرخصی؛ هیچ نوشتن/تنظیمات/ممیزی/سیستمی ندارد', () => {
  for (const p of ['users.read', 'users.details.read', 'attendance.read', 'reports.read', 'leave.read', 'disputes.read', 'dashboard.read']) {
    assert.equal(hasPermission('hr', p), true, `hr ${p}`);
  }
  const forbidden = PERMISSIONS.filter((p) => !['me.read', 'dashboard.read', 'attendance.read', 'leave.read', 'disputes.read', 'reports.read', 'users.read', 'users.details.read', 'notifications.read', 'notifications.mark', 'leave.balance.read', 'leave.approve.hr'].includes(p));
  for (const p of forbidden) assert.equal(hasPermission('hr', p), false, `hr ${p}`);
  // تنها استثنا: notifications.mark (S4-5b) — علامت خوانده‌شدنِ اعلان‌های «خودِ» کاربر؛ روی هیچ داده‌ی دیگری اثر ندارد
  assert.ok(permissionsFor('hr').every((p) => p.endsWith('.read') || p === 'notifications.mark' || p === 'leave.approve.hr'), 'همه‌ی مجوزهای hr باید .read باشند (به‌جز notifications.mark)');
});

test('default-deny: نقش/مجوز ناشناخته یا ورودی نامعتبر همیشه رد است', () => {
  assert.equal(hasPermission('boss', 'reports.read'), false);
  assert.equal(hasPermission('admin', 'no.such.permission'), false);
  assert.equal(hasPermission(undefined, 'reports.read'), false);
  assert.equal(hasPermission('__proto__', 'reports.read'), false);
  assert.equal(hasPermission('admin', null), false);
  assert.deepEqual(permissionsFor('boss'), []);
  assert.equal(run(requirePermission('reports.read'), undefined), 403);
  assert.equal(run(requirePermission('reports.read'), 'boss'), 403);
  assert.throws(() => requirePermission('typo.here'), /ناشناخته/);
  assert.throws(() => requirePermission(), /حداقل/);
});

test('requirePermission با requireStaff / requireFullAdmin فعلی برای هر نقش هم‌ارز است', () => {
  const roles = ['employee', 'manager', 'admin', undefined];
  const staffPerms = ['records.edit', 'leave.approve', 'leave.edit', 'disputes.resolve', 'overtime.approve',
    'shifts.read', 'suspicious.read', 'suspicious.review'];
  const adminPerms = ['users.write', 'shifts.edit', 'settings.edit', 'audit.read', 'system.read', 'system.manage'];
  for (const role of roles) {
    for (const p of staffPerms) assert.equal(run(requirePermission(p), role), run(requireStaff, role), `${role} ${p}`);
    for (const p of adminPerms) assert.equal(run(requirePermission(p), role), run(requireFullAdmin, role), `${role} ${p}`);
  }
  // چند مجوز هم‌زمان = همه لازم است
  assert.equal(run(requirePermission('records.edit', 'settings.edit'), 'manager'), 403);
  assert.equal(run(requirePermission('records.edit', 'settings.edit'), 'admin'), 'next');
});

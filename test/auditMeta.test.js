// S4-1b: گزینه‌ی meta در logChange/buildChangeDetails — فیلدهای کمکی کنار diff، پاک‌سازی‌شده و بدون امکان بازنویسی کلیدهای رزروشده.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildChangeDetails } = require('../src/utils/auditDiff');
const { userView, attendanceRecordView, pick } = require('../src/utils/auditViews');

test('meta: کنار diff می‌آید، حساس‌ها حذف، رشته‌ها پاک‌سازی، undefined نادیده؛ کلیدهای رزروشده بازنویسی نمی‌شوند', () => {
  const d = buildChangeDetails({
    entityType: 'user', entityId: 7, before: { role: 'employee' }, after: { role: 'manager' }, reason: 'ارتقا',
    meta: { source: 'admin_panel', targetUserId: 7, apiToken: 'x', note: undefined, entityType: 'HACK', changes: { a: 1 }, reason: 'جعلی' },
  });
  assert.deepEqual(d, {
    source: 'admin_panel', targetUserId: 7,
    entityType: 'user', entityId: 7,
    changes: { role: { before: 'employee', after: 'manager' } },
    reason: 'ارتقا',
  });
  assert.throws(() => buildChangeDetails({ entityType: 'user', meta: 'str' }), TypeError);
});

test('بدون meta خروجی همان S4-1a است', () => {
  assert.deepEqual(buildChangeDetails({ entityType: 'x', entityId: 1, before: null, after: { a: 1 } }), { entityType: 'x', entityId: 1, changes: { a: { before: null, after: 1 } } });
});

test('نماها: null ⇒ null، ستون‌های سیستمی/حساس نیستند، ستون غایب ⇒ null', () => {
  assert.equal(userView(null), null);
  const v = userView({ id: 1, full_name: 'ع', role: 'admin', session_version: 4, created_at: 'x', secret_hash: 'h' });
  assert.deepEqual(Object.keys(v).sort(), ['department', 'full_name', 'is_active', 'manager_id', 'personnel_code', 'role', 'telegram_user_id']);
  assert.equal(v.department, null);
  assert.deepEqual(attendanceRecordView({ id: 3, record_date: '2026-08-01', status: 'normal' }), { record_date: '2026-08-01', check_in_time: null, check_out_time: null, status: 'normal' });
  assert.deepEqual(pick({ a: 1 }, ['a', 'b']), { a: 1, b: null });
});

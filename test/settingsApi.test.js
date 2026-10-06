// S3-1b: API تنظیمات با متادیتا (GET /admin/settings/items، PUT /admin/settings/:key، POST /admin/settings/:key/reset)
// روی اپ واقعی. نیاز به express نصب‌شده؛ در غیر این صورت skip می‌شود.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

let hasDeps = true;
try { require.resolve('express'); } catch (_) { hasDeps = false; }

describe('API تنظیمات (S3-1b)', { skip: hasDeps ? false : 'express نصب نیست (npm install)' }, () => {
  let server, base, db, cookies;

  before(async () => {
    db = resetDb();
    const { makeUser, sessionCookie } = require('./helpers/factories');
    const { createApp } = require('../src/server');
    const admin = makeUser({ role: 'admin' });
    const manager = makeUser({ role: 'manager' });
    const employee = makeUser({ role: 'employee' });
    cookies = { admin: sessionCookie(admin.id), manager: sessionCookie(manager.id), employee: sessionCookie(employee.id) };
    server = createApp().listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => {
    if (server) server.close();
    cleanup();
  });

  async function hit(role, method, url, body, { csrf = true } = {}) {
    const headers = { 'content-type': 'application/json' };
    if (csrf) headers['x-requested-with'] = 'AttendancePanel';
    if (cookies[role]) headers.cookie = cookies[role];
    const res = await fetch(base + url, { method, headers, body: body && method !== 'GET' ? JSON.stringify(body) : undefined });
    let json = null;
    try { json = await res.json(); } catch (_) { /* بدنه خالی */ }
    return { status: res.status, json };
  }
  const stored = (k) => (db.prepare('SELECT value FROM settings WHERE key = ?').get(k) || {}).value;
  const auditRows = (action) => db.prepare('SELECT * FROM audit_log WHERE action = ? ORDER BY id').all(action);

  test('لیست با متادیتا: همه‌ی کلیدها با نوع، گروه، توضیح، بازه، پیش‌فرض و مقدار؛ GET قدیمی بدون تغییر', async () => {
    const r = await hit('manager', 'GET', '/api/admin/settings/items');
    assert.equal(r.status, 200);
    assert.equal(r.json.items.length, 28);
    const item = (k) => r.json.items.find((i) => i.key === k);
    assert.deepEqual(
      { ...item('lateCheckinGraceMinutes'), updatedAt: null },
      {
        key: 'lateCheckinGraceMinutes', type: 'number', group: 'reminders', groupLabel: r.json.groups.reminders,
        description: item('lateCheckinGraceMinutes').description, value: 15, default: 15, isDefault: true, updatedAt: null, min: 0, max: 720,
      },
    );
    assert.equal(item('workDayStart').type, 'time');
    assert.equal(item('blockOnSharedDevice').default, false);
    r.json.items.forEach((i) => assert.ok(i.description && i.groupLabel && 'value' in i && 'default' in i, i.key));

    const flat = await hit('admin', 'GET', '/api/admin/settings');
    assert.equal(flat.status, 200);
    assert.equal(flat.json.workDayEnd, '16:30'); // شکل قبلی (آبجکت تخت) که UI فعلی می‌خواند
    assert.equal(flat.json.items, undefined);
  });

  test('ذخیره: دلیل اجباری، نامعتبر ⇒ ۴۰۰ بدون هیچ تغییر، معتبر ⇒ ذخیره + audit با قبل/بعد/دلیل، بدون تغییر ⇒ no-op', async () => {
    const url = '/api/admin/settings/lateCheckinGraceMinutes';
    const noReason = await hit('admin', 'PUT', url, { value: 20 });
    assert.equal(noReason.status, 400);
    assert.equal((await hit('admin', 'PUT', url, { value: 20, reason: '   ' })).status, 400);
    for (const value of ['abc', 1.5, -1, 721, '', null, undefined]) {
      const r = await hit('admin', 'PUT', url, { value, reason: 'تست نامعتبر' });
      assert.equal(r.status, 400, `value=${JSON.stringify(value)}`);
      assert.match(r.json.error, /[\u0600-\u06FF]/);
    }
    assert.equal((await hit('admin', 'PUT', '/api/admin/settings/workDayStart', { value: '25:00', reason: 'x' })).status, 400);
    assert.equal(stored('late_checkin_grace_minutes'), undefined, 'ردشده‌ها چیزی ذخیره نکرده‌اند');
    assert.equal(auditRows('settings_updated').length, 0);

    const ok = await hit('admin', 'PUT', url, { value: '20', reason: 'شرکت مهلت ۲۰ دقیقه‌ای را تصویب کرد' });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.changed, true);
    assert.equal(ok.json.item.value, 20);
    assert.equal(ok.json.item.isDefault, false);
    assert.ok(ok.json.item.updatedAt);
    assert.equal(stored('late_checkin_grace_minutes'), '20');
    assert.equal((await hit('admin', 'GET', '/api/admin/settings')).json.lateCheckinGraceMinutes, 20, 'GET قدیمی هم همان را می‌بیند');

    const rows = auditRows('settings_updated');
    assert.equal(rows.length, 1);
    const d = JSON.parse(rows[0].details);
    assert.equal(d.source, 'admin_panel');
    assert.deepEqual(d.fields, ['lateCheckinGraceMinutes']);
    assert.deepEqual(d.changes, { lateCheckinGraceMinutes: { before: 15, after: 20 } });
    assert.equal(d.reason, 'شرکت مهلت ۲۰ دقیقه‌ای را تصویب کرد');

    const same = await hit('admin', 'PUT', url, { value: 20, reason: 'همان مقدار' });
    assert.equal(same.status, 200);
    assert.equal(same.json.changed, false);
    assert.equal(auditRows('settings_updated').length, 1, 'بدون تغییر audit نمی‌سازد');

    // time نرمال می‌شود و بولی با رشته پذیرفته می‌شود
    assert.equal((await hit('admin', 'PUT', '/api/admin/settings/workDayStart', { value: '7:30', reason: 'ساعت جدید' })).json.item.value, '07:30');
    assert.equal((await hit('admin', 'PUT', '/api/admin/settings/blockOnSharedDevice', { value: 'true', reason: 'فعال‌سازی' })).json.item.value, true);
    assert.equal(stored('block_on_shared_device'), '1');
  });

  test('reset: یک کلید به پیش‌فرض برمی‌گردد (ردیف حذف می‌شود)، audit قبل/بعد، دوباره reset ⇒ no-op، دیگر کلیدها دست‌نخورده', async () => {
    const url = '/api/admin/settings/lateCheckinGraceMinutes/reset';
    assert.equal((await hit('admin', 'POST', url, {})).status, 400, 'دلیل اجباری');
    assert.equal(stored('late_checkin_grace_minutes'), '20');

    const r = await hit('admin', 'POST', url, { reason: 'بازگشت به سیاست قبلی' });
    assert.equal(r.status, 200);
    assert.equal(r.json.changed, true);
    assert.equal(r.json.item.value, 15);
    assert.equal(r.json.item.isDefault, true);
    assert.equal(r.json.item.updatedAt, null);
    assert.equal(stored('late_checkin_grace_minutes'), undefined);
    assert.equal(stored('work_day_start'), '07:30', 'کلید دیگر دست‌نخورده');

    const rows = auditRows('settings_reset');
    assert.equal(rows.length, 1);
    const d = JSON.parse(rows[0].details);
    assert.deepEqual(d.changes, { lateCheckinGraceMinutes: { before: 20, after: 15 } });
    assert.equal(d.reason, 'بازگشت به سیاست قبلی');

    const again = await hit('admin', 'POST', url, { reason: 'دوباره' });
    assert.equal(again.status, 200);
    assert.equal(again.json.changed, false);
    assert.equal(auditRows('settings_reset').length, 1);
  });

  test('دسترسی و خطاها: کلید ناشناخته ۴۰۴، سرپرست فقط خواندن، کارمند ۴۰۳، بدون سشن ۴۰۱، بدون CSRF ۴۰۳؛ PATCH قدیمی هم قبل/بعد ثبت می‌کند', async () => {
    assert.equal((await hit('admin', 'PUT', '/api/admin/settings/nope', { value: 1, reason: 'x' })).status, 404);
    assert.equal((await hit('admin', 'POST', '/api/admin/settings/nope/reset', { reason: 'x' })).status, 404);
    assert.equal((await hit('admin', 'PUT', '/api/admin/settings/constructor', { value: 1, reason: 'x' })).status, 404);

    const put = ['PUT', '/api/admin/settings/workDayEnd', { value: '17:00', reason: 'x' }];
    const reset = ['POST', '/api/admin/settings/workDayEnd/reset', { reason: 'x' }];
    for (const [m, u, b] of [put, reset]) {
      assert.equal((await hit('manager', m, u, b)).status, 403, `manager ${m}`);
      assert.equal((await hit('employee', m, u, b)).status, 403, `employee ${m}`);
      assert.equal((await hit('none', m, u, b)).status, 401, `none ${m}`);
      assert.equal((await hit('admin', m, u, b, { csrf: false })).status, 403, `csrf ${m}`);
    }
    assert.equal((await hit('employee', 'GET', '/api/admin/settings/items')).status, 403);
    assert.equal((await hit('none', 'GET', '/api/admin/settings/items')).status, 401);
    assert.equal(stored('work_day_end'), undefined, 'هیچ‌کدام از ردشده‌ها چیزی عوض نکرد');

    // PATCH قدیمی (که UI فعلی می‌زند) همچنان کار می‌کند، بدون دلیل، و قبل/بعد را هم در details می‌گذارد
    const p = await hit('admin', 'PATCH', '/api/admin/settings', { workDayEnd: '17:30', repeatedLatenessThreshold: 'bad' });
    assert.equal(p.status, 200);
    assert.equal(p.json.workDayEnd, '17:30');
    assert.equal(p.json.repeatedLatenessThreshold, 3);
    const last = JSON.parse(auditRows('settings_updated').pop().details);
    assert.deepEqual(last.fields, ['workDayEnd', 'repeatedLatenessThreshold']);
    assert.deepEqual(last.changes, { workDayEnd: { before: '16:30', after: '17:30' } });
  });
});

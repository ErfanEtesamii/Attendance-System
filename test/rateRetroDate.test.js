// تغییر نرخ با تاریخ اعمال صریح: حتی اگر نرخ فعلی همان مقدار باشد (قبلاً از ماه جاری عوض شده)، ماه‌های قبل با تاریخ صریح اصلاح می‌شوند.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

let hasDeps = true;
try { require.resolve('express'); } catch (_) { hasDeps = false; }

describe('نرخ ساعتی با تاریخ اعمال صریح', { skip: hasDeps ? false : 'express نصب نیست' }, () => {
  let server, base, admin, cookie, F, users;
  before(async () => {
    resetDb();
    F = require('./helpers/factories'); users = require('../src/repositories/usersRepository');
    const { createApp } = require('../src/server');
    admin = F.makeUser({ role: 'owner' });
    cookie = F.sessionCookie(admin.id);
    server = createApp().listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => { if (server) server.close(); cleanup(); });
  const patch = (id, body) => fetch(`${base}/api/admin/users/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json', 'x-requested-with': 'AttendancePanel', cookie }, body: JSON.stringify(body) });

  test('نرخ ۱۵۰ از ماه جاری ثبت شده؛ دوباره با تاریخ قدیمی‌تر ⇒ ماه‌های قبل هم ۱۵۰', async () => {
    const u = F.makeUser();
    users.setHourlyRateKt(u.id, 155);
    users.setHourlyRateKt(u.id, 150, { effectiveFrom: '2026-11-22' }); // مثل ویرایش قدیمی پنل: فقط از ابتدای ماه جاری
    assert.equal(users.getHourlyRateKt(u.id, '2026-11-01'), 155);
    const r = await patch(u.id, { hourlyRateKt: '150', rateEffectiveFrom: '2026-10-23' });
    assert.equal(r.status, 200);
    assert.equal(users.getHourlyRateKt(u.id, '2026-11-01'), 150);
    assert.equal(users.getHourlyRateKt(u.id, '2026-11-30'), 150);
    assert.equal(users.getHourlyRateKt(u.id), 150);
  });
});

// C1: routeهای Mini App ماموریت (نیاز به express؛ وگرنه skip).
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

let hasDeps = true;
try { require.resolve('express'); } catch (_) { hasDeps = false; }

describe('Mini App ماموریت (C1) — سرور', { skip: hasDeps ? false : 'express نصب نیست (npm install)' }, () => {
  let S; let F; let emp; let mgr;
  const day = (n) => { const d = new Date(Date.now() + n * 86400000); return d.toISOString().slice(0, 10); };
  before(async () => {
    resetDb();
    F = require('./helpers/factories');
    mgr = F.makeUser({ role: 'manager' });
    emp = F.makeUser({ managerId: mgr.id });
    S = await require('./helpers/miniappClient').startServer();
  });
  after(() => { if (S) S.close(); cleanup(); });

  test('ثبت ⇒ ۲۰۱ pending؛ علت کوتاه ⇒ ۴۰۰ با code؛ لیست و لغو', async () => {
    const bad = await S.call(emp, 'POST', 'mission', { startDate: day(1), reason: 'ab' });
    assert.equal(bad.status, 400);
    assert.equal(bad.json.code, 'REASON_TOO_SHORT');
    // روز کاری بعدی را پیدا می‌کنیم (جمعه/تعطیل ⇒ مدت صفر خطا می‌دهد)
    let created = null;
    for (let i = 1; i <= 7 && !created; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const r = await S.call(emp, 'POST', 'mission', { startDate: day(i), reason: 'جلسه‌ی بیرونی', destination: 'تهران' });
      if (r.status === 201) created = r.json;
    }
    assert.ok(created, 'حداقل یک روز کاری باید پذیرفته شود');
    assert.equal(created.status, 'pending');
    assert.equal(created.destination, 'تهران');
    const list = await S.call(emp, 'GET', 'missions');
    assert.equal(list.json.length, 1);
    assert.equal((await S.call(F.makeUser(), 'DELETE', `missions/${created.id}`)).status, 404);
    assert.equal((await S.call(emp, 'POST', `missions/${created.id}/cancel`)).status, 200);
    assert.equal((await S.call(emp, 'GET', 'missions')).json.length, 0);
    assert.equal((await S.call(emp, 'DELETE', `missions/${created.id}`)).status, 404);
  });
});

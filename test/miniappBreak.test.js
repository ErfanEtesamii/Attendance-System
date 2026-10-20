// A2: API ثبت استراحت — سه نوع (ناهار/نماز/کوتاه)، پایان استراحت و مسدودی خروج با استراحت باز.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers/miniappClient');

let hasDeps = true;
try { require.resolve('express'); } catch (_) { hasDeps = false; }

describe('Mini App ثبت استراحت (A2) — سرور', { skip: hasDeps ? false : 'express نصب نیست (npm install)' }, () => {
  let S; let F; let breakRepo;
  before(async () => {
    resetDb();
    F = require('./helpers/factories');
    breakRepo = require('../src/repositories/breakRepository');
    S = await startServer();
  });
  after(() => { if (S) S.close(); cleanup(); });

  async function checkedIn() {
    const u = F.makeUser();
    const r = await S.call(u, 'POST', 'check-in', {});
    assert.equal(r.status, 201, JSON.stringify(r.json));
    return { u, recordId: r.json.id };
  }

  test('سه گزینه: ناهار ⇒ lunch؛ نماز و استراحت کوتاه ⇒ short_break؛ پایان استراحت و شروع دوباره', async () => {
    const { u, recordId } = await checkedIn();
    for (const [sent, stored] of [['lunch', 'lunch'], ['short_break', 'short_break'], ['short_break', 'short_break']]) {
      const s = await S.call(u, 'POST', 'break/start', { breakType: sent });
      assert.equal(s.status, 201);
      assert.equal(s.json.break_type, stored);
      const e = await S.call(u, 'POST', 'break/end', {});
      assert.equal(e.status, 200);
      assert.ok(e.json.end_time);
    }
    assert.equal(breakRepo.listByAttendanceRecord(recordId).length, 3);
  });

  test('نوع ناشناخته به ناهار برمی‌گردد (پیش‌فرض امن)', async () => {
    const { u } = await checkedIn();
    const s = await S.call(u, 'POST', 'break/start', { breakType: 'hack' });
    assert.equal(s.json.break_type, 'lunch');
  });

  test('خروج با استراحت باز مسدود است و بعد از پایان استراحت مجاز', async () => {
    const { u } = await checkedIn();
    await S.call(u, 'POST', 'break/start', { breakType: 'short_break' });
    const blocked = await S.call(u, 'POST', 'check-out', {});
    assert.equal(blocked.status, 400);
    assert.match(blocked.json.error, /استراحت باز/);
    await S.call(u, 'POST', 'break/end', {});
    assert.equal((await S.call(u, 'POST', 'check-out', {})).status, 200);
  });

  test('شروع دوم هنگام استراحت باز ⇒ ۴۰۰؛ بدون ورود ⇒ ۴۰۰', async () => {
    const { u } = await checkedIn();
    await S.call(u, 'POST', 'break/start', { breakType: 'lunch' });
    assert.equal((await S.call(u, 'POST', 'break/start', { breakType: 'short_break' })).status, 400);
    const other = F.makeUser();
    assert.equal((await S.call(other, 'POST', 'break/start', { breakType: 'lunch' })).status, 400);
  });

  test('ورود مجدد: پس از خروج مجاز است، نوبت دوم را می‌بندد و سقف پیش‌فرض را رعایت می‌کند', async () => {
    const { u } = await checkedIn();
    assert.equal((await S.call(u, 'POST', 'check-out', {})).status, 200);
    const again = await S.call(u, 'POST', 're-check-in', {});
    assert.equal(again.status, 201, JSON.stringify(again.json));
    assert.equal((await S.call(u, 'POST', 'check-out', {})).status, 200);
    const today = await S.call(u, 'GET', 'today');
    assert.equal(today.json.segments.length, 2);
    assert.equal(today.json.canReEnter, false);
  });
});

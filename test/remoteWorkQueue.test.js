// R5-۳ (فاز ۱۴): صف بررسی دورکاری — GET /api/admin/remote-work: پیش‌فرض‌ها، فیلترها، اسکوپ نقش‌ها، هم‌پوشانی با حضور حضوری و اعتبارسنجی.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

describe('API صف بررسی دورکاری (R5-3)', () => {
  let server; let base; let cookies; let U; let db; let S; let D;

  before(async () => {
    db = resetDb();
    const F = require('./helpers/factories');
    const remoteRepo = require('../src/repositories/remoteWorkRepository');
    const weeklyPlan = require('../src/services/weeklyPlanService');
    const { addDays } = require('../src/utils/shiftDay');
    const { createApp } = require('../src/server');

    const m1 = F.makeUser({ role: 'manager', name: 'سرپرست ۱' });
    const m2 = F.makeUser({ role: 'manager', name: 'سرپرست ۲' });
    U = {
      admin: F.makeUser({ role: 'admin' }), hr: F.makeUser({ role: 'hr' }), m1, m2,
      e1: F.makeUser({ managerId: m1.id, name: 'کارمند ۱' }), e1b: F.makeUser({ managerId: m1.id, name: 'کارمند ۱ب' }),
      e2: F.makeUser({ managerId: m2.id, name: 'کارمند ۲' }),
    };
    cookies = Object.fromEntries(Object.entries(U).map(([k, u]) => [k, F.sessionCookie(u.id)]));

    const thisWeek = weeklyPlan.context().thisWeek;
    D = { thisWeek, prev: addDays(thisWeek, -7), old: addDays(thisWeek, -21), thisWeekDay3: addDays(thisWeek, 2) };

    // هر نشست بسته می‌شود (حداکثر یک نشست باز برای هر کاربر)
    const make = (user, date, { status = 'pending', end = '13:00:00', breakRange } = {}) => {
      const s = remoteRepo.insertSession({ userId: user.id, workDate: date, startAt: `${date}T05:00:00.000Z`, ip: '203.0.113.9' });
      remoteRepo.closeSession(s.id, `${date}T${end}.000Z`);
      if (breakRange) {
        const b = remoteRepo.insertBreak(s.id, `${date}T${breakRange[0]}.000Z`);
        remoteRepo.closeBreak(b.id, `${date}T${breakRange[1]}.000Z`);
      }
      if (status !== 'pending') db.prepare('UPDATE remote_work_sessions SET status = ? WHERE id = ?').run(status, s.id);
      return s.id;
    };
    S = {
      e1This: make(U.e1, D.thisWeek, { breakRange: ['07:00:00', '08:00:00'] }), // ۸ ساعت − ۱ ساعت استراحت = ۴۲۰ دقیقه
      e1bPrev: make(U.e1b, D.prev),
      e2This: make(U.e2, D.thisWeek),
      e1Old: make(U.e1, D.old),
      e1Approved: make(U.e1, D.thisWeekDay3, { status: 'approved' }),
      e2Rejected: make(U.e2, D.prev, { status: 'rejected' }),
    };
    // رکورد رسمیِ حضوری برای e1 در روز نشست S.e1This ⇒ هم‌پوشانی؛ رکورد via_remote=1 برای e1b در روز نشستش ⇒ هم‌پوشانی نیست
    db.prepare("INSERT INTO attendance_records (user_id, record_date, check_in_time, check_out_time, status, via_remote) VALUES (?, ?, ?, ?, 'normal', 0)")
      .run(U.e1.id, D.thisWeek, `${D.thisWeek}T04:30:00.000Z`, `${D.thisWeek}T12:00:00.000Z`);
    db.prepare("INSERT INTO attendance_records (user_id, record_date, check_in_time, status, via_remote) VALUES (?, ?, ?, 'normal', 1)")
      .run(U.e1b.id, D.prev, `${D.prev}T05:00:00.000Z`);

    server = createApp().listen(0);
    await new Promise((res) => server.once('listening', res));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => { if (server) server.close(); cleanup(); });

  async function get(role, qs = '') {
    const headers = { 'x-requested-with': 'AttendancePanel' };
    if (cookies[role]) headers.cookie = cookies[role];
    const res = await fetch(`${base}/api/admin/remote-work${qs}`, { headers });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  }
  const idsOf = (r) => r.json.items.map((i) => i.id).sort((a, b) => a - b);
  const sorted = (...ids) => [...ids].sort((a, b) => a - b);

  test('بدون ورود به پنل ⇒ ۴۰۱؛ کارمند ⇒ ۴۰۳', async () => {
    assert.equal((await get('nobody')).status, 401);
    assert.equal((await get('e1')).status, 403);
  });

  test('پیش‌فرض: pending هفته‌ی جاری و قبل؛ قدیمی‌تر و غیر pending نمی‌آید', async () => {
    const r = await get('admin');
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.status, 'pending');
    assert.equal(r.json.window, 'recent');
    assert.equal(r.json.weekStart, D.prev);
    assert.deepEqual(idsOf(r), sorted(S.e1This, S.e1bPrev, S.e2This));
    assert.equal(r.json.total, 3);
    // قدیمی‌ترین روز اول
    assert.equal(r.json.items[0].workDate, D.prev);
  });

  test('فیلتر وضعیت: approved / rejected / all', async () => {
    assert.deepEqual(idsOf(await get('admin', '?status=approved')), [S.e1Approved]);
    assert.deepEqual(idsOf(await get('admin', '?status=rejected')), [S.e2Rejected]);
    assert.deepEqual(idsOf(await get('admin', '?status=all')), sorted(S.e1This, S.e1bPrev, S.e2This, S.e1Approved, S.e2Rejected));
  });

  test('فیلتر هفته: هر تاریخ داخل هفته نرمال می‌شود؛ week=all قدیمی‌ها را هم می‌آورد', async () => {
    const wk = await get('admin', `?week=${D.thisWeekDay3}`);
    assert.equal(wk.json.window, 'week');
    assert.equal(wk.json.weekStart, D.thisWeek);
    assert.deepEqual(idsOf(wk), sorted(S.e1This, S.e2This));
    const all = await get('admin', '?week=all');
    assert.equal(all.json.window, 'all');
    assert.equal(all.json.weekStart, null);
    assert.deepEqual(idsOf(all), sorted(S.e1This, S.e1bPrev, S.e2This, S.e1Old));
  });

  test('فیلتر کارمند', async () => {
    assert.deepEqual(idsOf(await get('admin', `?userId=${U.e1.id}&week=all`)), sorted(S.e1This, S.e1Old));
    assert.deepEqual(idsOf(await get('admin', `?userId=${U.e2.id}&status=all`)), sorted(S.e2This, S.e2Rejected));
  });

  test('اسکوپ: سرپرست فقط تیم خودش؛ hr و admin همه', async () => {
    assert.deepEqual(idsOf(await get('m1')), sorted(S.e1This, S.e1bPrev));
    assert.deepEqual(idsOf(await get('m2')), [S.e2This]);
    assert.equal((await get('hr')).json.total, 3);
    const out = await get('m1', `?userId=${U.e2.id}`);
    assert.equal(out.status, 403);
    assert.equal(out.json.code, 'NOT_IN_SCOPE');
    const missing = await get('admin', '?userId=999999');
    assert.equal(missing.status, 404);
    assert.equal(missing.json.code, 'USER_NOT_FOUND');
  });

  test('canReview: admin و سرپرستِ مستقیم true؛ hr false؛ غیر pending false', async () => {
    const byId = (r, id) => r.json.items.find((i) => i.id === id);
    assert.equal(byId(await get('admin'), S.e1This).canReview, true);
    assert.equal(byId(await get('m1'), S.e1This).canReview, true);
    assert.equal(byId(await get('hr'), S.e1This).canReview, false);
    assert.equal(byId(await get('admin', '?status=approved'), S.e1Approved).canReview, false);
  });

  test('هم‌پوشانی با حضور حضوری: فقط رکورد رسمیِ حضوری (via_remote=0 با ورود) علامت می‌خورد', async () => {
    const r = await get('admin');
    const byId = (id) => r.json.items.find((i) => i.id === id);
    assert.equal(byId(S.e1This).overlapsOnsite, true);
    assert.equal(byId(S.e1This).onsiteRecord.checkInTime, `${D.thisWeek}T04:30:00.000Z`);
    assert.equal(byId(S.e1bPrev).overlapsOnsite, false, 'via_remote=1 هم‌پوشانی نیست');
    assert.equal(byId(S.e1bPrev).onsiteRecord, null);
    assert.equal(byId(S.e2This).overlapsOnsite, false);
  });

  test('ساعت‌ها: استراحت‌ها و ساعت کار خالص؛ ip_address نشت نمی‌کند', async () => {
    const item = (await get('admin')).json.items.find((i) => i.id === S.e1This);
    assert.equal(item.breaks.length, 1);
    assert.equal(item.breakMinutes, 60);
    assert.equal(item.workedMinutes, 420);
    assert.equal(item.isOpen, false);
    assert.equal(item.jalaliDate.length > 0, true);
    assert.equal(JSON.stringify(item).includes('203.0.113.9'), false);
    assert.equal('ip_address' in item, false);
  });

  test('صفحه‌بندی', async () => {
    const r = await get('admin', '?limit=2');
    assert.equal(r.json.items.length, 2);
    assert.equal(r.json.total, 3);
    assert.equal((await get('admin', '?limit=2&offset=2')).json.items.length, 1);
  });

  test('ورودی نامعتبر ⇒ ۴۰۰ با کد روشن', async () => {
    for (const [qs, code] of [['?status=bogus', 'INVALID_STATUS'], ['?week=2026-13-45', 'INVALID_WEEK'], ['?week=abc', 'INVALID_WEEK'],
      ['?userId=abc', 'INVALID_USER'], ['?userId=0', 'INVALID_USER'], ['?limit=0', 'INVALID_PAGING'], ['?limit=101', 'INVALID_PAGING'], ['?offset=x', 'INVALID_PAGING']]) {
      const r = await get('admin', qs);
      assert.equal(r.status, 400, qs);
      assert.equal(r.json.code, code, qs);
    }
  });

  test('سرپرست بدون زیرمجموعه ⇒ صف خالی (نه خطا)', async () => {
    const F = require('./helpers/factories');
    const lonely = F.makeUser({ role: 'manager', name: 'سرپرست بدون تیم' });
    cookies.lonely = F.sessionCookie(lonely.id);
    const r = await get('lonely');
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.items, []);
    assert.equal(r.json.total, 0);
  });
});

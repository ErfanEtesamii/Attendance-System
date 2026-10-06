// S2-5a: API موارد مشکوک (GET /admin/suspicious و POST /admin/suspicious/:id/review) روی اپ واقعی.
// نیاز به express نصب‌شده؛ در غیر این صورت skip می‌شود.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

let hasDeps = true;
try { require.resolve('express'); } catch (_) { hasDeps = false; }

describe('API موارد مشکوک (S2-5a)', { skip: hasDeps ? false : 'express نصب نیست (npm install)' }, () => {
  let server, base, db, cookies;
  let admin, mgrA, mgrB, empA1, empA2, empB1;
  let ev; // رویدادهای ساخته‌شده

  before(async () => {
    db = resetDb();
    const { makeUser, sessionCookie } = require('./helpers/factories');
    const repo = require('../src/repositories/suspiciousRepository');
    const { createApp } = require('../src/server');
    admin = makeUser({ role: 'admin' });
    mgrA = makeUser({ role: 'manager' });
    mgrB = makeUser({ role: 'manager' });
    empA1 = makeUser({ role: 'employee', managerId: mgrA.id });
    empA2 = makeUser({ role: 'employee', managerId: mgrA.id });
    empB1 = makeUser({ role: 'employee', managerId: mgrB.id });
    const mk = (eventType, userIds, eventDate, details) => repo.create({ eventType, userIds, eventDate, details }).event;
    ev = {
      aOnly: mk('device_change', [empA1.id], '2026-10-01', { rule: 'C' }),
      aPair: mk('shared_device', [empA1.id, empA2.id], '2026-10-02', { rule: 'A' }),
      cross: mk('shared_device', [empA1.id, empB1.id], '2026-10-03', { rule: 'A' }),
      bOnly: mk('device_change', [empB1.id], '2026-10-04', { rule: 'C' }),
    };
    cookies = {
      employee: sessionCookie(empA1.id),
      managerA: sessionCookie(mgrA.id),
      managerB: sessionCookie(mgrB.id),
      admin: sessionCookie(admin.id),
    };
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
  const ids = (r) => r.json.map((e) => e.id).sort((a, b) => a - b);

  test('فهرست: ادمین همه را می‌بیند؛ سرپرست فقط مواردی که همه‌ی کاربرانشان در تیمش‌اند؛ فیلترها و ورودی نامعتبر', async () => {
    const all = await hit('admin', 'GET', '/api/admin/suspicious');
    assert.equal(all.status, 200);
    assert.deepEqual(ids(all), [ev.aOnly.id, ev.aPair.id, ev.cross.id, ev.bOnly.id].sort((a, b) => a - b));
    assert.equal(all.json[0].id, ev.bOnly.id, 'جدیدترین تاریخ اول');
    const first = all.json.find((e) => e.id === ev.aPair.id);
    assert.equal(first.eventType, 'shared_device');
    assert.equal(first.status, 'open');
    assert.deepEqual(first.users.map((u) => u.id).sort(), [empA1.id, empA2.id].sort());
    assert.equal(first.users[0].fullName.length > 0, true);
    assert.deepEqual(first.details, { rule: 'A' });

    const a = await hit('managerA', 'GET', '/api/admin/suspicious');
    assert.deepEqual(ids(a), [ev.aOnly.id, ev.aPair.id].sort((x, y) => x - y), 'مورد مشترک با تیم دیگر دیده نمی‌شود');
    const b = await hit('managerB', 'GET', '/api/admin/suspicious');
    assert.deepEqual(ids(b), [ev.bOnly.id]);

    assert.deepEqual(ids(await hit('admin', 'GET', '/api/admin/suspicious?from=2026-10-02&to=2026-10-03')), [ev.aPair.id, ev.cross.id].sort((x, y) => x - y));
    assert.equal((await hit('admin', 'GET', '/api/admin/suspicious?status=reviewed')).json.length, 0);
    assert.deepEqual(ids(await hit('admin', 'GET', '/api/admin/suspicious?status=open&limit=2')).length, 2);

    for (const q of ['status=bogus', 'from=1405/07/01', 'to=2026-13']) {
      assert.equal((await hit('admin', 'GET', `/api/admin/suspicious?${q}`)).status, 400, q);
    }
  });

  test('ثبت بررسی: دلیل اجباری، وضعیت و audit، تغییر به ignored، و تکراری ⇒ ۴۰۹', async () => {
    const url = `/api/admin/suspicious/${ev.aOnly.id}/review`;
    assert.equal((await hit('managerA', 'POST', url, {})).status, 400, 'بدون دلیل');
    assert.equal((await hit('managerA', 'POST', url, { reason: '   ' })).status, 400, 'دلیل خالی');
    assert.equal((await hit('managerA', 'POST', url, { reason: 'x', status: 'open' })).status, 400, 'وضعیت نامعتبر');
    assert.equal(db.prepare('SELECT status FROM suspicious_events WHERE id = ?').get(ev.aOnly.id).status, 'open', 'ردشده‌ها چیزی تغییر نداده‌اند');
    const auditBefore = db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action = 'suspicious_reviewed'").get().n;
    assert.equal(auditBefore, 0);

    const ok = await hit('managerA', 'POST', url, { reason: 'گوشی جدید خریده؛ با خودش صحبت شد' });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.status, 'reviewed');
    assert.equal(ok.json.reviewedBy.id, mgrA.id);
    assert.match(ok.json.reviewedAt, /^\d{4}-\d{2}-\d{2}T/);

    const row = db.prepare("SELECT * FROM audit_log WHERE action = 'suspicious_reviewed'").get();
    assert.equal(row.user_id, mgrA.id);
    const d = JSON.parse(row.details);
    assert.equal(d.eventId, ev.aOnly.id);
    assert.equal(d.previousStatus, 'open');
    assert.equal(d.newStatus, 'reviewed');
    assert.equal(d.reason, 'گوشی جدید خریده؛ با خودش صحبت شد');
    assert.deepEqual(d.targetUserIds, [empA1.id]);

    assert.equal((await hit('managerA', 'POST', url, { reason: 'دوباره' })).status, 409, 'همان وضعیت');
    const ign = await hit('admin', 'POST', url, { reason: 'پس از بررسی بیشتر بی‌اهمیت بود', status: 'ignored' });
    assert.equal(ign.status, 200);
    assert.equal(ign.json.status, 'ignored');
    assert.equal(ign.json.reviewedBy.id, admin.id);
    assert.equal((await hit('admin', 'GET', '/api/admin/suspicious?status=ignored')).json.length, 1);
  });

  test('اسکوپ ثبت بررسی: سرپرست روی تیم دیگر/مورد مشترک ⇒ ۴۰۳؛ ناموجود ⇒ ۴۰۴؛ شناسه‌ی خراب ⇒ ۴۰۰', async () => {
    const body = { reason: 'تست اسکوپ' };
    assert.equal((await hit('managerA', 'POST', `/api/admin/suspicious/${ev.bOnly.id}/review`, body)).status, 403);
    assert.equal((await hit('managerA', 'POST', `/api/admin/suspicious/${ev.cross.id}/review`, body)).status, 403, 'مورد مشترک بین دو تیم');
    assert.equal((await hit('managerB', 'POST', `/api/admin/suspicious/${ev.cross.id}/review`, body)).status, 403);
    assert.equal((await hit('managerA', 'POST', '/api/admin/suspicious/99999/review', body)).status, 404);
    assert.equal((await hit('admin', 'POST', '/api/admin/suspicious/abc/review', body)).status, 400);
    for (const id of [ev.bOnly.id, ev.cross.id]) {
      assert.equal(db.prepare('SELECT status FROM suspicious_events WHERE id = ?').get(id).status, 'open');
    }
    assert.equal((await hit('admin', 'POST', `/api/admin/suspicious/${ev.cross.id}/review`, body)).status, 200, 'ادمین روی مورد مشترک');
  });

  test('ماتریس: کارمند ۴۰۳، بدون سشن ۴۰۱، بدون هدر CSRF روی POST ۴۰۳', async () => {
    for (const [m, u] of [['GET', '/api/admin/suspicious'], ['POST', `/api/admin/suspicious/${ev.aPair.id}/review`]]) {
      assert.equal((await hit('employee', m, u, { reason: 'x' })).status, 403, `employee ${m} ${u}`);
      assert.equal((await hit('none', m, u, { reason: 'x' })).status, 401, `none ${m} ${u}`);
    }
    const noCsrf = await hit('managerA', 'POST', `/api/admin/suspicious/${ev.aPair.id}/review`, { reason: 'x' }, { csrf: false });
    assert.equal(noCsrf.status, 403);
    assert.equal(db.prepare('SELECT status FROM suspicious_events WHERE id = ?').get(ev.aPair.id).status, 'open');
  });
});

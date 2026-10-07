// S4-5b: API اعلان‌های «خود کاربر» (لیست، شمارنده، علامت خوانده، علامت همه) + پاک‌سازی اعلان‌های خوانده‌شده‌ی قدیمی (S2-7a).
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

let hasDeps = true;
try { require.resolve('express'); } catch (_) { hasDeps = false; }

describe('API اعلان‌ها (S4-5b)', { skip: hasDeps ? false : 'express نصب نیست (npm install)' }, () => {
  let db; let server; let base; let cookies; let users; let notify; let runCleanup;

  before(async () => {
    db = resetDb();
    const { makeUser, sessionCookie } = require('./helpers/factories');
    ({ notify } = require('../src/services/notificationService'));
    ({ runCleanup } = require('../src/utils/dataCleanup'));
    const { createApp } = require('../src/server');
    users = {
      admin: makeUser({ role: 'admin' }), hr: makeUser({ role: 'hr' }),
      manager: makeUser({ role: 'manager' }), employee: makeUser({ role: 'employee' }), other: makeUser({ role: 'employee' }),
    };
    cookies = Object.fromEntries(Object.entries(users).map(([k, u]) => [k, sessionCookie(u.id)]));
    server = createApp().listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => { if (server) server.close(); cleanup(); });

  async function hit(role, method, url, { csrf = true, body } = {}) {
    const headers = { 'content-type': 'application/json' };
    if (cookies[role]) headers.cookie = cookies[role];
    if (csrf) headers['x-requested-with'] = 'AttendancePanel';
    const res = await fetch(base + url, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(body || {}) });
    let json = null;
    try { json = await res.json(); } catch (_) { /* بدنه‌ی غیر JSON */ }
    return { status: res.status, json };
  }
  const add = (user, title, extra = {}) => notify(user.id, { type: 'system_alert', title, ...extra }).then((r) => r.notification);
  const unreadOf = (user) => db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(user.id).n;

  test('لیست و شمارنده فقط اعلان‌های خودِ کاربرند؛ unread، صفحه‌بندی، ورودی نامعتبر ⇒ ۴۰۰؛ userId در query/body نادیده گرفته می‌شود', async () => {
    const mine = [];
    for (let i = 1; i <= 5; i += 1) mine.push(await add(users.employee, `اعلان ${i}`, { link: '#/leave', data: { n: i } }));
    await add(users.other, 'اعلان دیگری');
    await hit('employee', 'POST', `/api/admin/notifications/${mine[0].id}/read`);

    const all = await hit('employee', 'GET', '/api/admin/notifications');
    assert.equal(all.status, 200);
    assert.deepEqual(all.json.items.map((i) => i.title), ['اعلان 5', 'اعلان 4', 'اعلان 3', 'اعلان 2', 'اعلان 1'], 'جدیدترین اول و بدون اعلان کاربر دیگر');
    assert.deepEqual(Object.keys(all.json.items[0]).sort(), ['body', 'createdAt', 'data', 'id', 'isRead', 'link', 'readAt', 'title', 'type']);
    assert.deepEqual(all.json.items[0].data, { n: 5 });
    assert.equal(all.json.nextBefore, null);

    const unread = await hit('employee', 'GET', '/api/admin/notifications?unread=1');
    assert.equal(unread.json.items.length, 4);
    assert.ok(unread.json.items.every((i) => i.isRead === false && i.readAt === null));
    assert.deepEqual((await hit('employee', 'GET', '/api/admin/notifications/unread-count')).json, { unread: 4 });
    assert.deepEqual((await hit('other', 'GET', '/api/admin/notifications/unread-count')).json, { unread: 1 });

    const p1 = await hit('employee', 'GET', '/api/admin/notifications?limit=2');
    assert.deepEqual(p1.json.items.map((i) => i.title), ['اعلان 5', 'اعلان 4']);
    assert.equal(p1.json.nextBefore, p1.json.items[1].id);
    const p2 = await hit('employee', 'GET', `/api/admin/notifications?limit=2&before=${p1.json.nextBefore}`);
    assert.deepEqual(p2.json.items.map((i) => i.title), ['اعلان 3', 'اعلان 2']);

    // تلاش برای دیدن اعلان کاربر دیگر با پارامتر userId: نادیده گرفته می‌شود
    const spoof = await hit('employee', 'GET', `/api/admin/notifications?userId=${users.other.id}`);
    assert.equal(spoof.status, 200);
    assert.ok(spoof.json.items.every((i) => i.title.startsWith('اعلان ') && i.title !== 'اعلان دیگری'));

    for (const bad of ['limit=0', 'limit=101', 'limit=abc', 'limit=1&limit=2', 'before=0', 'before=x', 'unread=maybe', 'unread=1&unread=0']) {
      assert.equal((await hit('manager', 'GET', `/api/admin/notifications?${bad}`)).status, 400, bad);
    }
  });

  test('علامت خوانده: idempotent با حفظ زمان اول؛ اعلان دیگران/ناموجود ⇒ ۴۰۴ بدون تغییر؛ شناسه نامعتبر ⇒ ۴۰۰؛ «همه» فقط برای خودش', async () => {
    const mine = await add(users.manager, 'مال سرپرست');
    const theirs = await add(users.other, 'مال دیگری');
    const first = await hit('manager', 'POST', `/api/admin/notifications/${mine.id}/read`);
    assert.equal(first.status, 200);
    assert.equal(first.json.notification.isRead, true);
    const readAt = first.json.notification.readAt;
    assert.ok(readAt);
    const again = await hit('manager', 'POST', `/api/admin/notifications/${mine.id}/read`);
    assert.equal(again.status, 200);
    assert.equal(again.json.notification.readAt, readAt, 'زمان خواندنِ اول حفظ می‌شود');

    for (const id of [theirs.id, 999999]) {
      const r = await hit('manager', 'POST', `/api/admin/notifications/${id}/read`);
      assert.equal(r.status, 404, `id=${id}`);
      assert.equal(r.json.error, 'اعلان پیدا نشد.', 'پیام یکسان؛ وجود اعلان دیگران فاش نمی‌شود');
    }
    assert.equal(db.prepare('SELECT read_at FROM notifications WHERE id = ?').get(theirs.id).read_at, null, 'اعلان دیگری دست‌نخورده');
    assert.equal((await hit('manager', 'POST', '/api/admin/notifications/abc/read')).status, 400);

    // علامت همه: فقط اعلان‌های خودِ کاربر
    await add(users.manager, 'دوم'); await add(users.manager, 'سوم');
    const beforeOther = unreadOf(users.other);
    assert.ok(unreadOf(users.manager) >= 2 && beforeOther >= 2);
    const all = await hit('manager', 'POST', '/api/admin/notifications/read-all', { body: { userId: users.other.id } });
    assert.equal(all.status, 200);
    assert.equal(all.json.updated, 2);
    assert.equal(unreadOf(users.manager), 0);
    assert.equal(unreadOf(users.other), beforeOther, 'اعلان‌های کاربر دیگر (حتی با userId در body) دست‌نخورده');
    assert.equal((await hit('manager', 'POST', '/api/admin/notifications/read-all')).json.updated, 0, 'تکرار ⇒ بی‌اثر');
  });

  test('دسترسی: هر ۴ نقش (از جمله hr و کارمند) به اعلان‌های خودشان؛ بدون سشن ۴۰۱؛ نوشتن بدون هدر CSRF ۴۰۳', async () => {
    for (const role of ['employee', 'manager', 'admin', 'hr']) {
      const n = await add(users[role], `برای ${role}`);
      assert.equal((await hit(role, 'GET', '/api/admin/notifications')).status, 200, `${role} list`);
      assert.equal((await hit(role, 'GET', '/api/admin/notifications/unread-count')).status, 200, `${role} count`);
      assert.equal((await hit(role, 'POST', `/api/admin/notifications/${n.id}/read`)).status, 200, `${role} mark`);
      assert.equal((await hit(role, 'POST', '/api/admin/notifications/read-all')).status, 200, `${role} read-all`);
    }
    assert.equal((await hit('nobody', 'GET', '/api/admin/notifications')).status, 401);
    const n = await add(users.hr, 'CSRF');
    assert.equal((await hit('hr', 'POST', `/api/admin/notifications/${n.id}/read`, { csrf: false })).status, 403);
    assert.equal(unreadOf(users.hr), 1, 'بدون هدر CSRF چیزی تغییر نمی‌کند');
    // مسیر ساخته‌نشده برای کارمند همچنان بسته است
    assert.equal((await hit('employee', 'DELETE', '/api/admin/notifications/1')).status, 403);
  });

  test('پاک‌سازی (S2-7a): فقط خوانده‌شده‌ی قدیمی حذف می‌شود؛ خوانده‌نشده‌ی قدیمی و خوانده‌شده‌ی تازه می‌مانند؛ dry-run چیزی حذف نمی‌کند؛ داده‌ی کاربری دست‌نخورده', async () => {
    db.exec('DELETE FROM notifications');
    const NOW = new Date('2026-10-06T12:00:00.000Z');
    const daysAgo = (d) => new Date(NOW.getTime() - d * 86400000).toISOString();
    const mk = async (title, ageDays, read) => {
      const n = await add(users.employee, title);
      db.prepare('UPDATE notifications SET created_at = ?, read_at = ? WHERE id = ?').run(daysAgo(ageDays), read ? daysAgo(ageDays) : null, n.id);
    };
    await mk('خوانده قدیمی', 100, true);
    await mk('خوانده قدیمی ۲', 91, true);
    await mk('خوانده تازه', 10, true);
    await mk('خوانده‌نشده قدیمی', 400, false);
    await mk('خوانده‌نشده تازه', 1, false);
    const RET = { jobRunsDays: 180, monitorAlertsDays: 180, rateLimitDays: 7, notificationsDays: 90 };
    const usersBefore = db.prepare('SELECT COUNT(*) n FROM users').get().n;

    const dry = runCleanup({ now: NOW, retention: RET, log: () => {} });
    assert.equal(dry.tables.notifications.candidates, 2);
    assert.equal(dry.tables.notifications.deleted, 0);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM notifications').get().n, 5);

    const real = runCleanup({ now: NOW, retention: RET, dryRun: false, log: () => {} });
    assert.equal(real.tables.notifications.deleted, 2);
    assert.deepEqual(db.prepare('SELECT title FROM notifications ORDER BY id').all().map((r) => r.title), ['خوانده تازه', 'خوانده‌نشده قدیمی', 'خوانده‌نشده تازه']);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n, usersBefore);
  });
});

// R3 (فاز ۱۴): سرویس و API دورکاری — ورود/خروج/استراحت، قواعد، گیت شبکه، audit، بستن نشست‌های باز و جدا بودن از داده‌ی رسمی.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const remoteWorkService = require('../src/services/remoteWorkService');
const auditRepository = require('../src/repositories/auditRepository');
const { todayDateString } = require('../src/utils/serverTime');
const { makeUser, makeApprovedMission } = require('./helpers/factories');

let hasDeps = true;
try { require.resolve('express'); } catch (_) { hasDeps = false; }

after(cleanup);
beforeEach(() => resetDb());

const db = () => require('../src/db/connection').getDb();
const setSetting = (key, value) => db().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
const actions = () => auditRepository.listRecent().map((r) => r.action).reverse();
const at = (iso) => new Date(iso);
const T0 = '2026-10-17T05:00:00.000Z';
const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000);

describe('سرویس دورکاری — جریان و قواعد (R3)', () => {
  test('ورود ← خروج: ثبت در انتظار با زمان سرور، IP و audit؛ امروز وضعیت را نشان می‌دهد', () => {
    const u = makeUser();
    const s = remoteWorkService.start(u, { ip: '5.6.7.8', now: at(T0) });
    assert.equal(s.ok, true);
    assert.equal(s.session.status, 'pending');
    assert.equal(s.session.start_at, T0);
    assert.equal(s.session.end_at, null);
    assert.equal(s.session.work_date, todayDateString());
    assert.deepEqual(s.session.breaks, []);
    assert.equal('ip_address' in s.session, false, 'IP به کارمند نشان داده نمی‌شود');

    const today = remoteWorkService.getToday(u.id);
    assert.equal(today.openSession.id, s.session.id);
    assert.equal(today.openBreak, null);
    assert.equal(today.sessions.length, 1);
    assert.equal(today.maxOpenHours, 16);

    const e = remoteWorkService.end(u, { ip: '5.6.7.8', now: at('2026-10-17T13:00:00.000Z') });
    assert.equal(e.ok, true);
    assert.equal(e.session.end_at, '2026-10-17T13:00:00.000Z');
    assert.equal(e.session.status, 'pending');
    assert.equal(remoteWorkService.getToday(u.id).openSession, null);

    assert.deepEqual(actions(), ['remote_work_start', 'remote_work_end']);
    const log = auditRepository.listRecent();
    assert.ok(log.every((r) => r.user_id === u.id && r.ip_address === '5.6.7.8'));
    assert.equal(db().prepare('SELECT ip_address FROM remote_work_sessions WHERE id = ?').get(s.session.id).ip_address, '5.6.7.8');
  });

  test('قواعد: ورود دوم بدون خروج، خروج بدون ورود، استراحت بدون نشست یا دوتایی، پایان استراحتِ ناموجود', () => {
    const u = makeUser();
    const code = (r) => [r.ok, r.status, r.code];
    assert.deepEqual(code(remoteWorkService.end(u)), [false, 400, 'REMOTE_NOT_STARTED']);
    assert.deepEqual(code(remoteWorkService.breakStart(u)), [false, 400, 'REMOTE_NOT_STARTED']);
    assert.deepEqual(code(remoteWorkService.breakEnd(u)), [false, 400, 'REMOTE_NOT_STARTED']);

    assert.equal(remoteWorkService.start(u, { now: at(T0) }).ok, true);
    assert.deepEqual(code(remoteWorkService.start(u, { now: at('2026-10-17T05:05:00.000Z') })), [false, 400, 'REMOTE_ALREADY_OPEN']);
    assert.deepEqual(code(remoteWorkService.breakEnd(u)), [false, 400, 'REMOTE_NO_OPEN_BREAK']);

    assert.equal(remoteWorkService.breakStart(u, { now: at('2026-10-17T08:00:00.000Z') }).ok, true);
    assert.deepEqual(code(remoteWorkService.breakStart(u, { now: at('2026-10-17T08:01:00.000Z') })), [false, 400, 'REMOTE_BREAK_ALREADY_OPEN']);
    assert.equal(remoteWorkService.breakEnd(u, { now: at('2026-10-17T08:30:00.000Z') }).ok, true);
    assert.equal(remoteWorkService.breakStart(u, { now: at('2026-10-17T10:00:00.000Z') }).ok, true, 'بعد از بستن، استراحت تازه مجاز است');

    assert.equal(remoteWorkService.end(u, { now: at('2026-10-17T12:00:00.000Z') }).ok, true);
    assert.deepEqual(code(remoteWorkService.breakStart(u)), [false, 400, 'REMOTE_NOT_STARTED'], 'بعد از خروج استراحتی نیست');
    assert.equal(db().prepare('SELECT COUNT(*) AS n FROM remote_work_sessions WHERE user_id = ?').get(u.id).n, 1, 'ردشده‌ها چیزی نمی‌سازند');
  });

  test('خروج با استراحت باز: استراحت در همان لحظه بسته می‌شود و در audit با autoClosedByEnd می‌آید', () => {
    const u = makeUser();
    remoteWorkService.start(u, { now: at(T0) });
    const b = remoteWorkService.breakStart(u, { now: at('2026-10-17T09:00:00.000Z') });
    const e = remoteWorkService.end(u, { now: at('2026-10-17T10:00:00.000Z') });
    assert.equal(e.ok, true);
    assert.equal(e.autoClosedBreak.id, b.break.id);
    assert.equal(e.autoClosedBreak.end_at, '2026-10-17T10:00:00.000Z');
    assert.equal(e.session.end_at, '2026-10-17T10:00:00.000Z');
    assert.equal(e.session.breaks.length, 1);
    const ev = auditRepository.listRecent().find((r) => r.action === 'remote_break_end');
    assert.equal(JSON.parse(ev.details).autoClosedByEnd, true);
    assert.deepEqual(actions(), ['remote_work_start', 'remote_break_start', 'remote_break_end', 'remote_work_end']);
  });

  test('بعد از خروج می‌شود نشست تازه‌ای شروع کرد؛ امروز هر دو را با وضعیت در انتظار نشان می‌دهد', () => {
    const u = makeUser();
    remoteWorkService.start(u, { now: at('2026-10-17T05:00:00.000Z') });
    remoteWorkService.end(u, { now: at('2026-10-17T07:00:00.000Z') });
    assert.equal(remoteWorkService.start(u, { now: at('2026-10-17T09:00:00.000Z') }).ok, true);
    const t = remoteWorkService.getToday(u.id);
    assert.equal(t.sessions.length, 2);
    assert.deepEqual(t.sessions.map((s) => s.status), ['pending', 'pending']);
    assert.equal(t.openSession.start_at, '2026-10-17T09:00:00.000Z');
  });

  test('کاربرها از هم جدایند: هر کدام نشست باز خودش را دارد و دیگری را نمی‌بیند', () => {
    const a = makeUser();
    const b = makeUser();
    assert.equal(remoteWorkService.start(a, { now: at(T0) }).ok, true);
    assert.equal(remoteWorkService.start(b, { now: at(T0) }).ok, true);
    assert.equal(remoteWorkService.getToday(a.id).sessions.length, 1);
    assert.notEqual(remoteWorkService.getToday(a.id).openSession.id, remoteWorkService.getToday(b.id).openSession.id);
    assert.equal(remoteWorkService.end(a, { now: at('2026-10-17T06:00:00.000Z') }).ok, true);
    assert.notEqual(remoteWorkService.getToday(b.id).openSession, null);
  });

  test('جدا از داده‌ی رسمی: هیچ رکورد حضور/استراحت رسمی و audit تردد ساخته نمی‌شود', () => {
    const u = makeUser();
    remoteWorkService.start(u, { now: at(T0) });
    remoteWorkService.breakStart(u, { now: at('2026-10-17T08:00:00.000Z') });
    remoteWorkService.breakEnd(u, { now: at('2026-10-17T08:20:00.000Z') });
    remoteWorkService.end(u, { now: at('2026-10-17T12:00:00.000Z') });
    assert.equal(db().prepare('SELECT COUNT(*) AS n FROM attendance_records').get().n, 0);
    assert.equal(db().prepare('SELECT COUNT(*) AS n FROM break_records').get().n, 0);
    assert.ok(actions().every((a) => a.startsWith('remote_')), actions().join());
  });
});

describe('سرویس دورکاری — بستن نشست‌های باز (R3)', () => {
  test('نشست بازِ قدیمی‌تر از سقف بسته می‌شود: پایان = شروع + سقف، auto_closed، pending، استراحت باز هم بسته؛ نشست تازه دست‌نخورده', () => {
    const old = makeUser();
    const fresh = makeUser();
    const start = hoursAgo(20);
    remoteWorkService.start(old, { now: start });
    remoteWorkService.breakStart(old, { now: new Date(start.getTime() + 3600 * 1000) });
    remoteWorkService.start(fresh, { now: hoursAgo(2) });

    assert.equal(remoteWorkService.autoCloseStale(), 1);
    const s = db().prepare('SELECT * FROM remote_work_sessions WHERE user_id = ?').get(old.id);
    assert.equal(s.end_at, new Date(start.getTime() + 16 * 3600 * 1000).toISOString());
    assert.equal(s.auto_closed, 1);
    assert.equal(s.status, 'pending');
    assert.equal(db().prepare('SELECT end_at FROM remote_work_breaks WHERE session_id = ?').get(s.id).end_at, s.end_at);
    assert.equal(db().prepare('SELECT end_at FROM remote_work_sessions WHERE user_id = ?').get(fresh.id).end_at, null);
    const ev = auditRepository.listRecent().find((r) => r.action === 'remote_work_auto_closed');
    assert.equal(ev.user_id, old.id);
    assert.equal(JSON.parse(ev.details).sessionId, s.id);

    assert.equal(remoteWorkService.autoCloseStale(), 0, 'اجرای دوم کاری ندارد');
    assert.equal(remoteWorkService.start(old, { now: new Date() }).ok, true, 'بعد از بسته‌شدن می‌شود نشست تازه شروع کرد');
  });

  test('سقف از تنظیم remoteWorkMaxOpenHours خوانده می‌شود', () => {
    const u = makeUser();
    remoteWorkService.start(u, { now: hoursAgo(20) });
    setSetting('remote_work_max_open_hours', '24');
    assert.equal(remoteWorkService.autoCloseStale(), 0);
    setSetting('remote_work_max_open_hours', '12');
    assert.equal(remoteWorkService.autoCloseStale(), 1);
  });

  test('Job شبانه‌ی autoCloseIncomplete نشست‌های باز دورکاری را هم می‌بندد (نتیجه‌ی قبلی job بدون تغییر)', async () => {
    const u = makeUser();
    remoteWorkService.start(u, { now: hoursAgo(30) });
    const { autoCloseIncompleteRecords } = require('../src/bot/scheduler/autoCloseIncomplete');
    assert.equal(await autoCloseIncompleteRecords(), 0, 'تعداد رکوردهای ناقص حضور فقط به رکوردهای رسمی وابسته است');
    const s = db().prepare('SELECT end_at, auto_closed FROM remote_work_sessions WHERE user_id = ?').get(u.id);
    assert.ok(s.end_at);
    assert.equal(s.auto_closed, 1);
  });
});

describe('API دورکاری — /api/miniapp/remote/* (R3)', { skip: hasDeps ? false : 'express نصب نیست (npm install)' }, () => {
  const config = require('../src/config');
  let ctx;
  beforeEach(async () => {
    resetDb();
    const { startServer } = require('./helpers/miniappClient');
    ctx = await startServer();
  });
  const stop = () => { if (ctx) ctx.close(); config.allowedNetworkCidr = '127.0.0.0/8'; };
  const outside = () => { config.allowedNetworkCidr = '10.99.0.0/16'; }; // IP تست (۱۲۷.۰.۰.۱) بیرون از رنج می‌افتد
  const ENDPOINTS = [['GET', 'remote/today'], ['POST', 'remote/start'], ['POST', 'remote/end'], ['POST', 'remote/break/start'], ['POST', 'remote/break/end']];

  test('داخل شبکه: همه‌ی مسیرها ۴۰۳ REMOTE_NOT_ALLOWED، چیزی ثبت نمی‌شود و رد در audit می‌آید', async () => {
    try {
      const u = makeUser();
      for (const [m, p] of ENDPOINTS) {
        const r = await ctx.call(u, m, p);
        assert.equal(r.status, 403, `${m} ${p}`);
        assert.equal(r.json.code, 'REMOTE_NOT_ALLOWED');
        assert.match(r.json.error, /دورکاری/);
      }
      assert.equal(db().prepare('SELECT COUNT(*) AS n FROM remote_work_sessions').get().n, 0);
      assert.ok(actions().every((a) => a === 'remote_work_rejected'));
    } finally { stop(); }
  });

  test('بیرون از شبکه: جریان کامل ورود ← استراحت ← خروج و وضعیت امروز', async () => {
    try {
      outside();
      const u = makeUser();
      const s = await ctx.call(u, 'POST', 'remote/start');
      assert.equal(s.status, 201);
      assert.equal(s.json.status, 'pending');
      assert.equal(s.json.user_id, u.id);
      assert.equal((await ctx.call(u, 'POST', 'remote/start')).json.code, 'REMOTE_ALREADY_OPEN');

      const b = await ctx.call(u, 'POST', 'remote/break/start');
      assert.equal(b.status, 201);
      assert.equal((await ctx.call(u, 'POST', 'remote/break/start')).status, 400);
      assert.equal((await ctx.call(u, 'POST', 'remote/break/end')).status, 200);
      await ctx.call(u, 'POST', 'remote/break/start');

      const t = await ctx.call(u, 'GET', 'remote/today');
      assert.equal(t.status, 200);
      assert.equal(t.json.openSession.id, s.json.id);
      assert.equal(t.json.sessions[0].breaks.length, 2);
      assert.ok(t.json.openBreak);

      const e = await ctx.call(u, 'POST', 'remote/end');
      assert.equal(e.status, 200);
      assert.ok(e.json.end_at);
      assert.ok(e.json.autoClosedBreak);
      assert.equal((await ctx.call(u, 'POST', 'remote/end')).json.code, 'REMOTE_NOT_STARTED');
      assert.equal(db().prepare('SELECT COUNT(*) AS n FROM attendance_records').get().n, 0);
    } finally { stop(); }
  });

  test('زمان، تاریخ و کاربرِ ارسالی کلاینت نادیده گرفته می‌شود', async () => {
    try {
      outside();
      const u = makeUser();
      const other = makeUser();
      const r = await ctx.call(u, 'POST', 'remote/start', { startAt: '1999-01-01T00:00:00.000Z', workDate: '1999-01-01', userId: other.id, status: 'approved', ip: '192.168.10.5' });
      assert.equal(r.status, 201);
      assert.equal(r.json.user_id, u.id);
      assert.equal(r.json.work_date, todayDateString());
      assert.equal(r.json.status, 'pending');
      assert.ok(Date.now() - new Date(r.json.start_at).getTime() < 60000, 'start_at ساعت سرور است');
      assert.equal(db().prepare('SELECT ip_address FROM remote_work_sessions WHERE id = ?').get(r.json.id).ip_address.replace('::ffff:', ''), '127.0.0.1');
      assert.equal(db().prepare('SELECT COUNT(*) AS n FROM remote_work_sessions WHERE user_id = ?').get(other.id).n, 0);
    } finally { stop(); }
  });

  test('تنظیم remoteWorkEnabled خاموش یا ماموریت تأییدشده ⇒ ۴۰۳؛ بدون initData ⇒ ۴۰۱', async () => {
    try {
      outside();
      const u = makeUser();
      setSetting('remote_work_enabled', 'false');
      assert.equal((await ctx.call(u, 'POST', 'remote/start')).status, 403);
      setSetting('remote_work_enabled', 'true');
      assert.equal((await ctx.call(u, 'POST', 'remote/start')).status, 201);
      const m = makeUser();
      makeApprovedMission(m.id, todayDateString());
      assert.equal((await ctx.call(m, 'POST', 'remote/start')).status, 403);
      assert.equal((await fetch(`${ctx.base}/api/miniapp/remote/today`)).status, 401);
    } finally { stop(); }
  });
});

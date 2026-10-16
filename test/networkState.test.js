// R2 (فاز ۱۴): تشخیص شبکه برای کلاینت — getNetworkState/isRemoteAllowed، کد OUT_OF_NETWORK و GET /api/miniapp/network-state.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { networkRestriction, getNetworkState, isRemoteAllowed, getRemoteAccess } = require('../src/middleware/networkRestriction');
const auditRepository = require('../src/repositories/auditRepository');
const leaveRepository = require('../src/repositories/leaveRepository');
const { todayDateString } = require('../src/utils/serverTime');
const { makeUser, makeApprovedMission, fakeReq, runMiddleware } = require('./helpers/factories');

let hasDeps = true;
try { require.resolve('express'); } catch (_) { hasDeps = false; }

after(cleanup);
beforeEach(() => resetDb());

const OUT = '5.6.7.8';
const IN = '192.168.10.50';
function reqFor(user, ip = OUT, extra = {}) {
  const r = fakeReq({ ip, ...extra });
  r.miniAppUser = user;
  return r;
}
const setSetting = (key, value) => require('../src/db/connection').getDb().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
const clearSetting = (key) => require('../src/db/connection').getDb().prepare('DELETE FROM settings WHERE key = ?').run(key);

describe('getNetworkState / isRemoteAllowed (R2)', () => {
  test('داخل شبکه: inNetwork=true و دورکاری هرگز مجاز نیست', () => {
    const u = makeUser();
    assert.deepEqual(getRemoteAccess(reqFor(u, IN)), { inNetwork: true, viaMission: false, remoteAllowed: false });
    assert.deepEqual(getRemoteAccess(reqFor(u, `::ffff:${IN}`)), { inNetwork: true, viaMission: false, remoteAllowed: false });
  });

  test('بیرون از شبکه بدون ماموریت: remoteAllowed=true', () => {
    const u = makeUser();
    assert.deepEqual(getNetworkState(reqFor(u)), { inNetwork: false, viaMission: false });
    assert.deepEqual(getRemoteAccess(reqFor(u)), { inNetwork: false, viaMission: false, remoteAllowed: true });
  });

  test('ماموریت تأییدشده‌ی امروز: viaMission=true و remoteAllowed=false (اولویت با ماموریت)', () => {
    const u = makeUser();
    makeApprovedMission(u.id, todayDateString());
    assert.deepEqual(getRemoteAccess(reqFor(u)), { inNetwork: false, viaMission: true, remoteAllowed: false });
  });

  test('ماموریتِ در انتظار: با تنظیم allowCheckinWithPendingMission روشن viaMission=true؛ با تنظیم خاموش دورکاری باز می‌شود', () => {
    const u = makeUser();
    leaveRepository.createLeaveRequest({ userId: u.id, startDate: todayDateString(), endDate: todayDateString(), leaveType: 'mission' });
    assert.deepEqual(getRemoteAccess(reqFor(u)), { inNetwork: false, viaMission: true, remoteAllowed: false });
    setSetting('allow_checkin_with_pending_mission', 'false');
    assert.deepEqual(getRemoteAccess(reqFor(u)), { inNetwork: false, viaMission: false, remoteAllowed: true });
    clearSetting('allow_checkin_with_pending_mission');
  });

  test('ماموریت روز دیگر یا مرخصی تأییدشده اثری ندارد', () => {
    const u = makeUser();
    makeApprovedMission(u.id, '2000-01-01');
    const l = leaveRepository.createLeaveRequest({ userId: u.id, startDate: todayDateString(), endDate: todayDateString(), leaveType: 'leave' });
    leaveRepository.setStatus(l.id, 'approved', null);
    assert.equal(getRemoteAccess(reqFor(u)).remoteAllowed, true);
  });

  test('داخل شبکه با ماموریت: viaMission=false (ماموریت فقط بیرون از شبکه بررسی می‌شود)', () => {
    const u = makeUser();
    makeApprovedMission(u.id, todayDateString());
    assert.deepEqual(getNetworkState(reqFor(u, IN)), { inNetwork: true, viaMission: false });
  });

  test('تنظیم remoteWorkEnabled: پیش‌فرض روشن؛ خاموش ⇒ remoteAllowed=false', () => {
    const u = makeUser();
    assert.equal(isRemoteAllowed(reqFor(u)), true);
    setSetting('remote_work_enabled', 'false');
    assert.equal(isRemoteAllowed(reqFor(u)), false);
    assert.deepEqual(getNetworkState(reqFor(u)), { inNetwork: false, viaMission: false }, 'تشخیص شبکه به تنظیم وابسته نیست');
    clearSetting('remote_work_enabled');
  });

  test('کاربر غیرفعال یا بدون هویت امضاشده: remoteAllowed=false (fail-closed)', () => {
    assert.equal(isRemoteAllowed(reqFor(makeUser({ active: false }))), false);
    assert.equal(isRemoteAllowed(reqFor(undefined)), false);
    assert.equal(isRemoteAllowed(reqFor({})), false);
  });

  test('پرچم‌های کلاینت (هدر X-Forwarded-For، query و body) در تصمیم نقشی ندارند؛ فقط req.ip', () => {
    const u = makeUser();
    const spoof = reqFor(u, OUT, {
      headers: { 'x-forwarded-for': IN, 'x-real-ip': IN, 'x-in-network': 'true' },
      query: { inNetwork: 'true', remoteAllowed: 'false', ip: IN },
      body: { inNetwork: true, ip: IN },
    });
    assert.deepEqual(getRemoteAccess(spoof), { inNetwork: false, viaMission: false, remoteAllowed: true });
    const inside = reqFor(u, IN, { query: { remoteAllowed: 'true' }, headers: { 'x-forwarded-for': OUT } });
    assert.equal(getRemoteAccess(inside).remoteAllowed, false);
  });

  test('بدون اثر جانبی: هیچ audit ثبت نمی‌شود و req دست نمی‌خورد', () => {
    const u = makeUser();
    makeApprovedMission(u.id, todayDateString());
    const r = reqFor(u);
    getRemoteAccess(r);
    getRemoteAccess(reqFor(makeUser(), IN));
    assert.equal(auditRepository.listRecent().length, 0);
    assert.equal(r.viaPendingMission, undefined);
  });
});

describe('middleware networkRestriction — کد OUT_OF_NETWORK و رفتار قبلی (R2)', () => {
  test('۴۰۳ بیرون از شبکه: متن فارسی قبلی + code=OUT_OF_NETWORK + audit مثل قبل', () => {
    const u = makeUser();
    const r = runMiddleware(networkRestriction, reqFor(u, OUT, { method: 'POST', url: '/api/miniapp/check-in' }));
    assert.equal(r.nextCalled, false);
    assert.equal(r.status, 403);
    assert.deepEqual(r.body, { error: 'این عملیات فقط از داخل شبکه شرکت قابل انجام است.', code: 'OUT_OF_NETWORK' });
    const log = auditRepository.listRecent();
    assert.equal(log.length, 1);
    assert.equal(log[0].action, 'attendance_rejected_ip');
  });

  test('داخل شبکه، ماموریت تأییدشده و ماموریتِ در انتظار: عبور مثل قبل (پرچم و audit دست‌نخورده)', () => {
    const u = makeUser();
    assert.equal(runMiddleware(networkRestriction, reqFor(u, IN)).nextCalled, true);
    assert.equal(auditRepository.listRecent().length, 0);

    makeApprovedMission(u.id, todayDateString());
    assert.equal(runMiddleware(networkRestriction, reqFor(u)).nextCalled, true);
    assert.equal(auditRepository.listRecent()[0].action, 'attendance_allowed_via_mission');

    const p = makeUser();
    const pending = leaveRepository.createLeaveRequest({ userId: p.id, startDate: todayDateString(), endDate: todayDateString(), leaveType: 'mission' });
    const req = reqFor(p);
    assert.equal(runMiddleware(networkRestriction, req).nextCalled, true);
    assert.equal(req.viaPendingMission, pending.id);
  });
});

describe('GET /api/miniapp/network-state (R2)', { skip: hasDeps ? false : 'express نصب نیست (npm install)' }, () => {
  const config = require('../src/config');
  let ctx;
  beforeEach(async () => {
    resetDb();
    const { startServer } = require('./helpers/miniappClient');
    ctx = await startServer();
  });
  const stop = () => { if (ctx) ctx.close(); config.allowedNetworkCidr = '127.0.0.0/8'; };

  test('داخل شبکه: فقط سه فیلد، remoteAllowed=false', async () => {
    try {
      const u = makeUser();
      const r = await ctx.call(u, 'GET', 'network-state');
      assert.equal(r.status, 200);
      assert.deepEqual(r.json, { inNetwork: true, viaMission: false, remoteAllowed: false });
    } finally { stop(); }
  });

  test('خارج شبکه: remoteAllowed=true؛ ورودی‌های query تأثیری ندارند؛ تنظیم خاموش ⇒ false', async () => {
    try {
      config.allowedNetworkCidr = '10.99.0.0/16'; // IP تست (۱۲۷.۰.۰.۱) بیرون از رنج می‌افتد
      const u = makeUser();
      const r = await ctx.call(u, 'GET', 'network-state?inNetwork=true&remoteAllowed=false');
      assert.deepEqual(r.json, { inNetwork: false, viaMission: false, remoteAllowed: true });
      setSetting('remote_work_enabled', 'false');
      assert.equal((await ctx.call(u, 'GET', 'network-state')).json.remoteAllowed, false);
    } finally { stop(); }
  });

  test('خارج شبکه با ماموریت تأییدشده: viaMission=true و remoteAllowed=false', async () => {
    try {
      config.allowedNetworkCidr = '10.99.0.0/16';
      const u = makeUser();
      makeApprovedMission(u.id, todayDateString());
      assert.deepEqual((await ctx.call(u, 'GET', 'network-state')).json, { inNetwork: false, viaMission: true, remoteAllowed: false });
    } finally { stop(); }
  });

  test('بدون initData معتبر ⇒ ۴۰۱؛ و مسیر تردد بیرون از شبکه کد OUT_OF_NETWORK می‌دهد', async () => {
    try {
      const raw = await fetch(`${ctx.base}/api/miniapp/network-state`);
      assert.equal(raw.status, 401);
      config.allowedNetworkCidr = '10.99.0.0/16';
      const u = makeUser();
      const r = await ctx.call(u, 'POST', 'check-in', {});
      assert.equal(r.status, 403);
      assert.equal(r.json.code, 'OUT_OF_NETWORK');
    } finally { stop(); }
  });
});

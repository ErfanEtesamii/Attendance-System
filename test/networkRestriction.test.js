const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { networkRestriction, isIpInCidr, normalizeIp } = require('../src/middleware/networkRestriction');
const auditRepository = require('../src/repositories/auditRepository');
const { todayDateString } = require('../src/utils/serverTime');
const { makeUser, makeApprovedMission, fakeReq, runMiddleware } = require('./helpers/factories');

after(cleanup);
beforeEach(() => resetDb());

// درخواست خارج از رنج شبکه با هویت احرازشده‌ی Mini App (همان چیزی که telegramAuth در مسیرهای واقعی می‌گذارد)
function reqFor(user, extra = {}) {
  const r = fakeReq({ ip: '5.6.7.8', ...extra });
  r.miniAppUser = user;
  return r;
}

describe('isIpInCidr / normalizeIp', () => {
  test('مرزهای /24', () => {
    for (const ip of ['192.168.10.0', '192.168.10.2', '192.168.10.255']) assert.equal(isIpInCidr(ip, '192.168.10.0/24'), true, ip);
    for (const ip of ['192.168.9.255', '192.168.11.0', '10.0.0.1', '8.8.8.8']) assert.equal(isIpInCidr(ip, '192.168.10.0/24'), false, ip);
  });
  test('/32، /0، IPv6 و فرمت نامعتبر', () => {
    assert.equal(isIpInCidr('1.2.3.4', '1.2.3.4/32'), true);
    assert.equal(isIpInCidr('1.2.3.5', '1.2.3.4/32'), false);
    assert.equal(isIpInCidr('9.9.9.9', '0.0.0.0/0'), true);
    assert.equal(isIpInCidr('::1', '192.168.10.0/24'), false);
    assert.equal(isIpInCidr('192.168.10.300', '192.168.10.0/24'), false);
    assert.equal(isIpInCidr('', '192.168.10.0/24'), false);
    assert.throws(() => isIpInCidr('1.1.1.1', 'garbage'), /نامعتبر/);
  });
  test('پیشوند IPv6-mapped حذف می‌شود', () => {
    assert.equal(normalizeIp('::ffff:192.168.10.5'), '192.168.10.5');
    assert.equal(isIpInCidr(normalizeIp('::ffff:192.168.10.5'), '192.168.10.0/24'), true);
  });
});

describe('middleware networkRestriction', () => {
  test('IP داخل رنج: عبور می‌کند و چیزی در audit ثبت نمی‌شود', () => {
    const r = runMiddleware(networkRestriction, fakeReq({ ip: '192.168.10.50', method: 'POST', url: '/api/miniapp/check-in' }));
    assert.equal(r.nextCalled, true);
    assert.equal(auditRepository.listRecent().length, 0);
  });

  test('IPv6-mapped داخل رنج هم عبور می‌کند', () => {
    assert.equal(runMiddleware(networkRestriction, fakeReq({ ip: '::ffff:192.168.10.7' })).nextCalled, true);
  });

  test('IP خارج رنج و بدون مأموریت: ۴۰۳ و ثبت attendance_rejected_ip', () => {
    const u = makeUser();
    const r = runMiddleware(networkRestriction, reqFor(u, { method: 'POST', url: '/api/miniapp/check-in' }));
    assert.equal(r.nextCalled, false);
    assert.equal(r.status, 403);
    const log = auditRepository.listRecent();
    assert.equal(log.length, 1);
    assert.equal(log[0].action, 'attendance_rejected_ip');
    assert.equal(log[0].ip_address, '5.6.7.8');
    assert.equal(log[0].user_id, u.id);
  });

  test('خارج رنج ولی مأموریت تأییدشده برای امروز: عبور + ثبت attendance_allowed_via_mission', () => {
    const u = makeUser();
    makeApprovedMission(u.id, todayDateString());
    const r = runMiddleware(networkRestriction, reqFor(u));
    assert.equal(r.nextCalled, true);
    assert.equal(auditRepository.listRecent()[0].action, 'attendance_allowed_via_mission');
  });

  test('مأموریت برای روز دیگر یا هنوز تأییدنشده کافی نیست', () => {
    const u = makeUser();
    makeApprovedMission(u.id, '2000-01-01');
    assert.equal(runMiddleware(networkRestriction, reqFor(u)).status, 403);

    const leaveRepository = require('../src/repositories/leaveRepository');
    leaveRepository.createLeaveRequest({ userId: u.id, startDate: todayDateString(), endDate: todayDateString(), leaveType: 'mission' }); // pending
    assert.equal(runMiddleware(networkRestriction, reqFor(u)).status, 403);
  });

  test('مرخصی (نه مأموریت) تأییدشده، چک IP را دور نمی‌زند', () => {
    const u = makeUser();
    const leaveRepository = require('../src/repositories/leaveRepository');
    const l = leaveRepository.createLeaveRequest({ userId: u.id, startDate: todayDateString(), endDate: todayDateString(), leaveType: 'leave' });
    leaveRepository.setStatus(l.id, 'approved', null);
    assert.equal(runMiddleware(networkRestriction, reqFor(u)).status, 403);
  });

  test('userId خام body/query هرگز پذیرفته نمی‌شود (فقط req.miniAppUser امضاشده)', () => {
    const victim = makeUser();
    makeApprovedMission(victim.id, todayDateString()); // مأموریت قربانی
    // بدون miniAppUser (مثلاً مسیر قدیمی /api/attendance که در بخش ۱-ب حذف شد) نباید با userId جعلی عبور کرد
    const r = runMiddleware(networkRestriction, fakeReq({ ip: '5.6.7.8', body: { userId: victim.id }, query: { userId: victim.id } }));
    assert.equal(r.nextCalled, false);
    assert.equal(r.status, 403);
    const log = auditRepository.listRecent();
    assert.equal(log[0].action, 'attendance_rejected_ip');
    assert.equal(log[0].user_id, null);
  });

  test('req.miniAppUser: مأموریتِ خودِ کاربر معتبر است، مأموریت دیگری نه', () => {
    const real = makeUser();
    const victim = makeUser();
    makeApprovedMission(victim.id, todayDateString());
    const req = reqFor(real, { body: { userId: victim.id } }); // body جعلی نادیده گرفته می‌شود
    assert.equal(runMiddleware(networkRestriction, req).status, 403);
    assert.equal(runMiddleware(networkRestriction, reqFor(victim)).nextCalled, true);
  });
});

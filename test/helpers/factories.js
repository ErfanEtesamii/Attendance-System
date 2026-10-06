// ساخت داده نمونه برای تست‌ها از طریق همان repositoryهای پروژه.
const usersRepository = require('../../src/repositories/usersRepository');
const leaveRepository = require('../../src/repositories/leaveRepository');
const config = require('../../src/config');
const { createSessionToken } = require('../../src/utils/session');
const { SESSION_COOKIE_NAME } = require('../../src/middleware/adminAuth');

let seq = 0;

function makeUser({ role = 'employee', managerId = null, department = 'تست', active = true, name } = {}) {
  seq += 1;
  const user = usersRepository.createUser({
    telegramUserId: String(900000 + seq),
    fullName: name || `کاربر ${role} ${seq}`,
    personnelCode: `T${seq}`,
    department,
    role,
    managerId,
  });
  return active ? user : usersRepository.updateUser(user.id, { is_active: 0 });
}

function makeApprovedMission(userId, date) {
  const req = leaveRepository.createLeaveRequest({ userId, startDate: date, endDate: date, leaveType: 'mission', reason: 'تست' });
  return leaveRepository.setStatus(req.id, 'approved', null);
}

// مقدار هدر Cookie برای یک سشن معتبر پنل
function sessionCookie(userId, { maxAgeSeconds = 3600, secret = config.adminSessionSecret } = {}) {
  const token = createSessionToken({ userId }, secret, maxAgeSeconds);
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`;
}

// درخواست/پاسخ ساختگی Express برای تست middlewareها بدون بالا آوردن سرور
function fakeReq({ method = 'GET', url = '/api/admin/me', ip = '192.168.10.5', cookie, body, query = {}, headers = {} } = {}) {
  const h = { ...headers };
  if (cookie) h.cookie = cookie;
  return { method, originalUrl: url, ip, headers: h, body, query, get: (n) => h[String(n).toLowerCase()] };
}

function fakeRes() {
  const res = {
    statusCode: 200,
    body: undefined,
    status(code) { res.statusCode = code; return res; },
    json(payload) { res.body = payload; return res; },
    set() { return res; },
    setHeader() { return res; },
  };
  return res;
}

// اجرای یک middleware و برگرداندن نتیجه: { nextCalled, status, body }
function runMiddleware(mw, req) {
  const res = fakeRes();
  let nextCalled = false;
  mw(req, res, () => { nextCalled = true; });
  return { nextCalled, status: nextCalled ? 200 : res.statusCode, body: res.body };
}

module.exports = { makeUser, makeApprovedMission, sessionCookie, fakeReq, fakeRes, runMiddleware };

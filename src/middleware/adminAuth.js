// middleware احراز هویت پنل وب (فاز ۸ + دسترسی سه‌سطحی).
// برخلاف Mini App (که هر بار initData تلگرام را تأیید می‌کند)، اینجا فقط لحظه‌ی لاگین تأیید می‌شود
// (adminAuth.js route) و بعد از آن یک کوکی session امضاشده هویت را برای درخواست‌های بعدی نگه می‌دارد.
//
// سه سطح دسترسی:
//   admin    — همه‌چیز
//   manager  — «سرپرست»: فقط تیم خودش (اسکوپ با manager_id در هر route)
//   employee — فقط خودش، و فقط از طریق «لیست سفید» پایین. هر مسیری که اینجا نیامده باشد
//              برای کارمند ۴۰۳ است (امن‌به‌صورت‌پیش‌فرض: route جدیدی که بعداً اضافه شود، بسته می‌ماند).

const config = require('../config');
const usersRepository = require('../repositories/usersRepository');
const { verifySessionToken } = require('../utils/session');
const { parseCookies } = require('../utils/cookies');
const settingsRepository = require('../repositories/settingsRepository');
const { SESSION_COOKIE_NAME, buildClearCookie } = require('../utils/sessionCookie');
const { ROLES } = require('./permissions');

// فقط خواندنِ داده‌های خود کارمند. (اسکوپ «فقط خودش» در scopedUserIds هر route اعمال می‌شود.)
const EMPLOYEE_ALLOWED = [
  ['GET', /^\/admin\/me$/],
  ['GET', /^\/admin\/me\/permissions$/], // S4-4b: مجوزهای خود کاربر (برای ساخت منوی پنل)
  ['GET', /^\/admin\/attendance$/],
  ['GET', /^\/admin\/attendance\/export$/],
  ['GET', /^\/admin\/attendance-records\/\d+$/],
  ['GET', /^\/admin\/users\/\d+\/details$/],
  ['GET', /^\/admin\/leave-requests$/],
  ['GET', /^\/admin\/leave-balances$/], // S4-9c: مانده‌ی خود کارمند (اسکوپ در route)
  ['GET', /^\/admin\/leave-balances\/\d+\/adjustments$/],
  ['GET', /^\/admin\/disputes$/],
  ['GET', /^\/admin\/reports\/summary$/],
  ['GET', /^\/admin\/notifications$/], // S4-5b: اعلان‌های خود کاربر (اسکوپ در route؛ بدون پارامتر کاربر)
  ['GET', /^\/admin\/notifications\/unread-count$/],
  ['POST', /^\/admin\/notifications\/\d+\/read$/],
  ['POST', /^\/admin\/notifications\/read-all$/],
  ['POST', /^\/admin\/auth\/logout$/],
];

function requestPath(req) {
  return req.originalUrl.split('?')[0].replace(/^\/api(?=\/)/, '').replace(/\/+$/, '');
}

function employeeMayAccess(req) {
  const p = requestPath(req);
  return EMPLOYEE_ALLOWED.some(([method, re]) => method === req.method && re.test(p));
}

function requireAdminAuth(req, res, next) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE_NAME];
  const session = verifySessionToken(token, config.adminSessionSecret);

  if (!session || !session.userId) {
    return res.status(401).json({ error: 'وارد نشده‌اید.' });
  }

  const user = usersRepository.findById(session.userId);

  // بخش ۲-الف: ابطال نشست. توکن‌های قدیمی بدون sv/ge به‌صورت ۰ حساب می‌شوند (سازگاری با نشست‌های موجود).
  if (user) {
    const tokenSv = Number.isInteger(session.sv) ? session.sv : 0;
    const tokenGe = Number.isInteger(session.ge) ? session.ge : 0;
    if (tokenSv !== (user.session_version || 0) || tokenGe !== settingsRepository.getGlobalSessionEpoch()) {
      res.setHeader('Set-Cookie', buildClearCookie(req));
      return res.status(401).json({ error: 'نشست شما باطل شده است؛ دوباره وارد شوید.', code: 'SESSION_REVOKED' });
    }
  }

  if (!user || !user.is_active || !ROLES.includes(user.role)) {
    return res.status(403).json({ error: 'دسترسی به پنل ندارید.' });
  }

  if (user.role === 'employee' && !employeeMayAccess(req)) {
    return res.status(403).json({ error: 'این بخش برای کارمندان در دسترس نیست.' });
  }

  req.adminUser = user;
  next();
}

// برای اکشن‌های مدیریتی: سرپرست (فقط روی تیم خودش؛ اسکوپ را خود route چک می‌کند) و ادمین
function requireStaff(req, res, next) {
  if (!req.adminUser || !['manager', 'admin'].includes(req.adminUser.role)) {
    return res.status(403).json({ error: 'این عملیات فقط برای سرپرست یا ادمین مجاز است.' });
  }
  next();
}

// برای اکشن‌هایی که فقط ادمین کل مجاز است (مدیریت کاربران، تنظیمات، لاگ، سیستم، ارسال همگانی)
function requireFullAdmin(req, res, next) {
  if (!req.adminUser || req.adminUser.role !== 'admin') {
    return res.status(403).json({ error: 'این عملیات فقط برای ادمین کل مجاز است.' });
  }
  next();
}

module.exports = { requireAdminAuth, requireStaff, requireFullAdmin, SESSION_COOKIE_NAME, EMPLOYEE_ALLOWED };

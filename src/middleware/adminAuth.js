// middleware احراز هویت پنل مدیریتی وب (فاز ۸).
// برخلاف Mini App (که هر بار initData تلگرام را تأیید می‌کند)، اینجا فقط لحظه‌ی لاگین
// از طریق Telegram Login Widget تأیید می‌شود (adminAuth.js route) و بعد از آن یک
// کوکی session امضاشده (src/utils/session.js) هویت را برای درخواست‌های بعدی نگه می‌دارد.

const config = require('../config');
const usersRepository = require('../repositories/usersRepository');
const { verifySessionToken } = require('../utils/session');
const { parseCookies } = require('../utils/cookies');

const SESSION_COOKIE_NAME = 'attendance_admin_session';

function requireAdminAuth(req, res, next) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE_NAME];
  const session = verifySessionToken(token, config.adminSessionSecret);

  if (!session || !session.userId) {
    return res.status(401).json({ error: 'وارد نشده‌اید.' });
  }

  const user = usersRepository.findById(session.userId);
  if (!user || !user.is_active || !['manager', 'admin'].includes(user.role)) {
    return res.status(403).json({ error: 'دسترسی به پنل مدیریتی ندارید.' });
  }

  req.adminUser = user;
  next();
}

// برای اکشن‌هایی که فقط ادمین کل مجاز است (نه مدیر دپارتمان)، مثل افزودن/ویرایش کارمند
function requireFullAdmin(req, res, next) {
  if (!req.adminUser || req.adminUser.role !== 'admin') {
    return res.status(403).json({ error: 'این عملیات فقط برای ادمین کل مجاز است.' });
  }
  next();
}

module.exports = { requireAdminAuth, requireFullAdmin, SESSION_COOKIE_NAME };

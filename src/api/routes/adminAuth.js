// مسیرهای ورود/خروج پنل وب. چهار راه ورود، همه برای هر سه نقش (ادمین/سرپرست/کارمند):
//   1) webapp  — دکمه‌ی «پنل» داخل بات (Telegram Web App؛ امضای initData تأیید می‌شود)
//   2) token   — لینک یک‌بارمصرف «باز کردن در مرورگر» از بات
//   3) code    — کد ۸ رقمی یک‌بارمصرف از بات (دستور /panel)
//   4) telegram — Telegram Login Widget (روی شبکه‌های فیلتر ممکن است لود نشود)

const express = require('express');
const router = express.Router();

const config = require('../../config');
const usersRepository = require('../../repositories/usersRepository');
const auditRepository = require('../../repositories/auditRepository');
const { verifyLoginWidgetData } = require('../../utils/telegramLoginAuth');
const { verifyInitData } = require('../../utils/telegramInitData');
const { createSessionToken } = require('../../utils/session');
const { consumeCode, consumeLinkToken } = require('../../utils/panelLoginCodes');
const { requireAdminAuth } = require('../../middleware/adminAuth');
const settingsRepository = require('../../repositories/settingsRepository');
const { buildSessionCookie, buildClearCookie } = require('../../utils/sessionCookie');
const { adminLoginLimiter, panelAutoLoginLimiter } = require('../../middleware/rateLimiter');

// sv = نسخه‌ی نشست کاربر، ge = epoch سراسری (بخش ۲-الف: امکان باطل‌کردن نشست‌ها)
function startSession(req, res, user) {
  const maxAgeSeconds = config.adminSessionMaxAgeDays * 24 * 60 * 60;
  const token = createSessionToken(
    { userId: user.id, sv: user.session_version || 0, ge: settingsRepository.getGlobalSessionEpoch() },
    config.adminSessionSecret,
    maxAgeSeconds
  );
  res.setHeader('Set-Cookie', buildSessionCookie(token, maxAgeSeconds, req));
}

function finishLogin(req, res, user, source) {
  startSession(req, res, user);
  auditRepository.logEvent({
    userId: user.id,
    action: 'admin_panel_login',
    ipAddress: req.ip,
    details: { source, role: user.role },
  });
  res.json({
    ok: true,
    user: { id: user.id, fullName: user.full_name, role: user.role, department: user.department },
  });
}

function usableUser(user) {
  return !!user && !!user.is_active && ['employee', 'manager', 'admin'].includes(user.role);
}

// ورود با دکمه‌ی «پنل» داخل بات (Web App)
router.post('/admin/auth/webapp', panelAutoLoginLimiter, (req, res) => {
  if (!config.telegramBotToken) {
    return res.status(500).json({ error: 'TELEGRAM_BOT_TOKEN روی سرور تنظیم نشده است.' });
  }
  const verified = verifyInitData(req.body && req.body.initData, config.telegramBotToken);
  if (!verified) {
    return res.status(401).json({ error: 'اطلاعات ورود تلگرام نامعتبر یا منقضی‌شده است. دکمه‌ی «پنل» را دوباره بزنید.' });
  }
  const telegramUserId = String(verified.telegramUser.id);
  const user = usersRepository.findByTelegramId(telegramUserId);
  if (!usableUser(user)) {
    return res.status(403).json({ error: 'این حساب تلگرام در سیستم ثبت نیست.', telegramUserId });
  }
  finishLogin(req, res, user, 'telegram_web_app');
});

// ورود با لینک یک‌بارمصرف بات (باز کردن در مرورگر)
router.post('/admin/auth/token', panelAutoLoginLimiter, (req, res) => {
  const userId = consumeLinkToken(req.body && req.body.token);
  const user = userId ? usersRepository.findById(userId) : null;
  if (!usableUser(user)) {
    return res.status(401).json({ error: 'لینک نامعتبر یا منقضی شده است. در بات دوباره /panel بزنید.' });
  }
  finishLogin(req, res, user, 'bot_one_time_link');
});

// ورود با کد ۸ رقمی (دستور /panel)
router.post('/admin/auth/code', adminLoginLimiter, (req, res) => {
  const userId = consumeCode(req.body && req.body.code);
  const user = userId ? usersRepository.findById(userId) : null;
  if (!usableUser(user)) {
    return res.status(401).json({ error: 'کد نامعتبر یا منقضی شده است. در بات دوباره /panel بزنید.' });
  }
  finishLogin(req, res, user, 'bot_one_time_code');
});

router.get('/admin/public-config', (req, res) => {
  res.json({ botUsername: config.telegramBotUsername });
});

// فاز ۹: rate limiting روی لاگین (ضد brute-force)
router.post('/admin/auth/telegram', adminLoginLimiter, (req, res) => {
  if (!config.telegramBotToken) {
    return res.status(500).json({ error: 'TELEGRAM_BOT_TOKEN روی سرور تنظیم نشده است.' });
  }
  const verified = verifyLoginWidgetData(req.body, config.telegramBotToken);
  if (!verified) {
    return res.status(401).json({ error: 'اطلاعات ورود تلگرام نامعتبر یا منقضی‌شده است.' });
  }
  const telegramUserId = String(verified.id);
  const user = usersRepository.findByTelegramId(telegramUserId);
  if (!usableUser(user)) {
    return res.status(403).json({ error: 'این حساب تلگرام در سیستم ثبت نیست.', telegramUserId });
  }
  finishLogin(req, res, user, 'telegram_login_widget');
});

router.post('/admin/auth/logout', requireAdminAuth, (req, res) => {
  auditRepository.logEvent({ userId: req.adminUser.id, action: 'admin_panel_logout' });
  res.setHeader('Set-Cookie', buildClearCookie(req));
  res.json({ ok: true });
});

// استفاده‌ی مجدد در routeهای ابطال نشست (صدور کوکی تازه برای ادمینی که خودش نشست‌ها را باطل می‌کند)
router.startSession = startSession;

module.exports = router;

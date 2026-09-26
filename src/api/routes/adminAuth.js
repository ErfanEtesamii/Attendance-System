// مسیرهای ورود/خروج پنل مدیریتی وب از طریق Telegram Login Widget (فاز ۸).

const express = require('express');
const router = express.Router();

const config = require('../../config');
const usersRepository = require('../../repositories/usersRepository');
const auditRepository = require('../../repositories/auditRepository');
const { verifyLoginWidgetData } = require('../../utils/telegramLoginAuth');
const { createSessionToken } = require('../../utils/session');
const { SESSION_COOKIE_NAME, requireAdminAuth } = require('../../middleware/adminAuth');

router.get('/admin/public-config', (req, res) => {
  res.json({ botUsername: config.telegramBotUsername });
});

router.post('/admin/auth/telegram', (req, res) => {
  if (!config.telegramBotToken) {
    return res.status(500).json({ error: 'TELEGRAM_BOT_TOKEN روی سرور تنظیم نشده است.' });
  }

  const verified = verifyLoginWidgetData(req.body, config.telegramBotToken);
  if (!verified) {
    return res.status(401).json({ error: 'اطلاعات ورود تلگرام نامعتبر یا منقضی‌شده است.' });
  }

  const telegramUserId = String(verified.id);
  const user = usersRepository.findByTelegramId(telegramUserId);

  if (!user || !user.is_active) {
    return res.status(403).json({ error: 'این حساب تلگرام در سیستم ثبت نیست.', telegramUserId });
  }
  if (!['manager', 'admin'].includes(user.role)) {
    return res
      .status(403)
      .json({ error: 'شما نقش مدیر یا ادمین ندارید و دسترسی به این پنل ندارید.' });
  }

  const maxAgeSeconds = config.adminSessionMaxAgeDays * 24 * 60 * 60;
  const token = createSessionToken({ userId: user.id }, config.adminSessionSecret, maxAgeSeconds);

  const cookieParts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (config.nodeEnv === 'production') cookieParts.push('Secure');
  res.setHeader('Set-Cookie', cookieParts.join('; '));

  auditRepository.logEvent({
    userId: user.id,
    action: 'admin_panel_login',
    ipAddress: req.ip,
    details: { source: 'telegram_login_widget' },
  });

  res.json({ ok: true, user: { id: user.id, fullName: user.full_name, role: user.role } });
});

router.post('/admin/auth/logout', requireAdminAuth, (req, res) => {
  auditRepository.logEvent({ userId: req.adminUser.id, action: 'admin_panel_logout' });
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`
  );
  res.json({ ok: true });
});

module.exports = router;

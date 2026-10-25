// احراز هویت Mini App بله: لینک یک‌بارمصرف از داخل بازو به نشست امضاشده تبدیل می‌شود.
const config = require('../config');
const usersRepository = require('../repositories/usersRepository');
const { verifySessionToken } = require('../utils/session');

function miniAppAuth(req, res, next) {
  const token = req.get('x-miniapp-session');
  const payload = verifySessionToken(token, config.adminSessionSecret);
  if (!payload || payload.kind !== 'bale_miniapp' || !Number.isInteger(payload.userId)) {
    return res.status(401).json({ error: 'نشست مینی‌اپ نامعتبر یا منقضی شده است. از بات بله دوباره وارد شوید.' });
  }
  const user = usersRepository.findById(payload.userId);
  if (!user || !user.is_active) return res.status(403).json({ error: 'حساب شما در سیستم فعال نیست.' });
  req.miniAppUser = user;
  req.telegramUser = { id: user.telegram_user_id }; // سازگاری محدود با کدهای فعلی
  next();
}

module.exports = { miniAppAuth };

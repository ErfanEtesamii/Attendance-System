const config = require('../config');
const usersRepository = require('../repositories/usersRepository');
const { verifyBaleInitData } = require('../utils/baleInitData');

function baleMiniAppAuth(req, res, next) {
  const initData = req.get('x-bale-init-data');
  const verified = verifyBaleInitData(initData, config.baleBotToken);
  if (!verified) return res.status(401).json({ error: 'اطلاعات ورود مینی‌اپ بله نامعتبر یا منقضی شده است.' });
  const user = usersRepository.findByTelegramId(String(verified.baleUser.id)); // نام ستون برای سازگاری با دیتابیس قدیمی است.
  if (!user || !user.is_active) return res.status(403).json({ error: 'این حساب بله در سیستم ثبت نیست.', baleUserId: String(verified.baleUser.id) });
  req.miniAppUser = user;
  req.baleUser = verified.baleUser;
  next();
}

module.exports = { baleMiniAppAuth };

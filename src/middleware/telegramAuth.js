// middleware احراز هویت واقعی برای مسیرهای Mini App (فاز ۴).
// برخلاف مسیرهای قدیمی /api/attendance/* که userId را مستقیم از body می‌خوانند (بدون اثبات هویت)،
// این middleware با تأیید امضای initData تلگرام مطمئن می‌شود که userId واقعاً متعلق به
// همان کسی است که در تلگرام لاگین کرده - نه چیزی که کلاینت ادعا کرده.

const config = require('../config');
const usersRepository = require('../repositories/usersRepository');
const { verifyInitData } = require('../utils/telegramInitData');

const INIT_DATA_HEADER = 'x-telegram-init-data';

function telegramAuth(req, res, next) {
  const initData = req.get(INIT_DATA_HEADER) || req.body?.initData || req.query.initData;

  if (!initData) {
    return res.status(401).json({ error: 'initData تلگرام ارسال نشده است.' });
  }

  if (!config.telegramBotToken) {
    return res.status(500).json({ error: 'TELEGRAM_BOT_TOKEN روی سرور تنظیم نشده است.' });
  }

  const verified = verifyInitData(initData, config.telegramBotToken);
  if (!verified) {
    return res.status(401).json({ error: 'initData نامعتبر یا منقضی‌شده است. لطفاً Mini App را دوباره باز کنید.' });
  }

  const telegramUserId = String(verified.telegramUser.id);
  const user = usersRepository.findByTelegramId(telegramUserId);

  if (!user || !user.is_active) {
    return res.status(403).json({
      error: 'شما در سیستم ثبت نیستید. این عدد را به ادمین بدهید تا شما را ثبت کند.',
      telegramUserId,
    });
  }

  req.miniAppUser = user;
  req.telegramUser = verified.telegramUser;
  next();
}

module.exports = { telegramAuth };

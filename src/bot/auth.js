// نگاشت فرستنده پیام تلگرام به کاربر ثبت‌شده در جدول users و بررسی نقش.
// طبق سند: بات فقط به کاربرانی که telegram_user_id آن‌ها در جدول users ثبت شده پاسخ عملیاتی می‌دهد.

const usersRepository = require('../repositories/usersRepository');

const NOT_REGISTERED_MESSAGE =
  'شما در سیستم ثبت نیستید. لطفاً این عدد را به ادمین بدهید تا شما را در سیستم ثبت کند:\n\n';

function getRegisteredUser(telegramUserId) {
  const user = usersRepository.findByTelegramId(String(telegramUserId));
  if (!user || !user.is_active) return null;
  return user;
}

function notRegisteredMessage(telegramUserId) {
  return NOT_REGISTERED_MESSAGE + `\`${telegramUserId}\``;
}

function hasRole(user, roles) {
  if (!user) return false;
  return roles.includes(user.role);
}

module.exports = { getRegisteredUser, notRegisteredMessage, hasRole };

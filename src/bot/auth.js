// نگاشت فرستنده پیام تلگرام به کاربر ثبت‌شده در جدول users و بررسی نقش.
// طبق سند: بات فقط به کاربرانی که telegram_user_id آن‌ها در جدول users ثبت شده پاسخ عملیاتی می‌دهد.

const usersRepository = require('../repositories/usersRepository');
const { hasPermission } = require('../middleware/permissions');

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
  // owner همه‌ی دسترسی‌های admin را دارد (بخش‌های «فقط owner» جداگانه با isOwner چک می‌شوند)
  return roles.includes(user.role) || (user.role === 'owner' && roles.includes('admin'));
}

// فاز B: دسترسی بر پایه‌ی مجوز مؤثر (ادمین/مالک همه؛ سرپرست طبق «قابلیت‌های سرپرست»). هرکدام از مجوزها کافی است.
function hasAnyPermission(user, perms) {
  if (!user || !Array.isArray(perms)) return false;
  return perms.some((p) => hasPermission(user.role, p));
}

module.exports = { getRegisteredUser, notRegisteredMessage, hasRole, hasAnyPermission };

// اسکریپت یک‌بار مصرف برای ساخت اولین ادمین سیستم.
// چون /add_employee فقط توسط ادمین قابل اجراست، اولین ادمین باید مستقیماً از طریق همین اسکریپت
// در دیتابیس ساخته شود (مشکل «تخم‌مرغ و مرغ»).
//
// استفاده:
//   node src/scripts/createAdmin.js <telegram_user_id> "<نام و نام‌خانوادگی>"
//   یا: npm run create-admin -- <telegram_user_id> "<نام و نام‌خانوادگی>"
//
// آیدی عددی تلگرام را می‌توانید بعد از زدن /start در بات (وقتی هنوز ثبت نیست) از پیام بات ببینید،
// یا با ارسال پیام به بات‌هایی مثل @userinfobot پیدا کنید.

const usersRepository = require('../repositories/usersRepository');
const auditRepository = require('../repositories/auditRepository');

function main() {
  const [, , telegramUserId, fullName] = process.argv;

  if (!telegramUserId || !/^\d+$/.test(telegramUserId) || !fullName) {
    console.error('استفاده صحیح: node src/scripts/createAdmin.js <telegram_user_id> "<نام و نام‌خانوادگی>"');
    process.exit(1);
  }

  const existing = usersRepository.findByTelegramId(telegramUserId);
  if (existing) {
    console.error(`کاربری با این آیدی تلگرام از قبل وجود دارد (id=${existing.id}, role=${existing.role}).`);
    process.exit(1);
  }

  const admin = usersRepository.createUser({
    telegramUserId,
    fullName,
    role: 'admin',
  });

  auditRepository.logEvent({
    userId: admin.id,
    action: 'admin_bootstrapped_via_script',
    details: { by: 'createAdmin.js' },
  });

  console.log(`✅ ادمین «${admin.full_name}» با آیدی تلگرام ${admin.telegram_user_id} ساخته شد.`);
  console.log('اکنون می‌توانید در بات /start را بزنید.');
}

main();

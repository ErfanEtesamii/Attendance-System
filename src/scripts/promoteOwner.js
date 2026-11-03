// تبدیل یک حساب به owner (مالک سیستم) — بعد از دیپلوی یک‌بار اجرا کنید.
//
// استفاده:
//   node src/scripts/promoteOwner.js <telegram_user_id> ["نام و نام‌خانوادگی (فقط اگر کاربر وجود ندارد)"]
//   یا: npm run promote-owner -- <telegram_user_id>
//
// اگر کاربر با این آیدی وجود دارد (مثلاً ادمین فعلی) نقشش owner می‌شود و دیگر در فهرست کارمندان/آمار نمی‌آید.
// اگر وجود ندارد، یک حساب owner ساخته می‌شود.

const { ensureOwner } = require('../services/ownerBootstrap');

function main() {
  const [, , telegramUserId, fullName] = process.argv;
  if (!telegramUserId || !/^\d+$/.test(telegramUserId)) {
    console.error('استفاده صحیح: node src/scripts/promoteOwner.js <telegram_user_id> ["نام"]');
    process.exit(1);
  }
  const { status, user } = ensureOwner(telegramUserId, { fullName, source: 'promoteOwner.js' });
  const msg = { created: 'ساخته شد', promoted: 'به owner ارتقا یافت', unchanged: 'از قبل owner بود' }[status];
  console.log(`✅ «${user.full_name}» (آیدی تلگرام ${user.telegram_user_id}) ${msg}.`);
  console.log('اگر قبلاً وارد پنل شده بود، نشست‌هایش باطل شده؛ دوباره وارد شود.');
}

main();

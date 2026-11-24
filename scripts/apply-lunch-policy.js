// اعمال سیاست «کسر ثابت ناهار» از یک تاریخ به بعد (روزهای قبل از آن بدون تغییر می‌مانند):
//   node scripts/apply-lunch-policy.js 2026-11-18            → فقط گزارش (dry-run)
//   node scripts/apply-lunch-policy.js 2026-11-18 --apply    → اعمال
//   node scripts/apply-lunch-policy.js 2026-11-18 --apply --minutes=45
// قاعده از تاریخ داده‌شده: کسی که دست‌کم ۵ دقیقه در بازه‌ی ناهار (۱۳:۴۵ تا ۱۴:۳۰) در شرکت باشد، به اندازه‌ی حضورش در بازه (حداکثر ۴۵ دقیقه) کسر می‌شود؛ ورود دیر یا خروج زودِ وسط بازه هم همین‌طور.
// قبل از --apply از دیتابیس بک‌آپ بگیرید. کد خروج: ۰ موفق | ۱ خطا | ۲ آرگومان نادرست
const { closeDb } = require('../src/db/connection');
const settingsRepository = require('../src/repositories/settingsRepository');
const settingsHistory = require('../src/utils/settingsHistory');

function main(argv) {
  const apply = argv.includes('--apply');
  const minutesArg = argv.find((a) => a.startsWith('--minutes='));
  const minutes = minutesArg ? Number(minutesArg.split('=')[1]) : 45;
  const from = argv.find((a) => !a.startsWith('--'));
  if (!from || !settingsHistory.DATE_RE.test(from) || Number.isNaN(Date.parse(`${from}T00:00:00Z`))) { console.error('استفاده: node scripts/apply-lunch-policy.js <YYYY-MM-DD میلادی> [--apply] [--minutes=45]'); return 2; }
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 480) { console.error('--minutes باید عدد صحیح ۱ تا ۴۸۰ باشد.'); return 2; }
  const fields = {
    fixedLunchDeductMinutes: minutes, fixedLunchMode: 'present_in_window', lunchWindowStart: '13:45', lunchWindowEnd: '14:30',
    fixedLunchMinOverlapMinutes: 5, fixedLunchMinPresenceMinutes: 15, fixedLunchProRate: true,
  };
  const current = settingsRepository.getAll();
  console.log(`از ${from} به بعد (روزهای قبل از آن با مقدارهای فعلی/قبلی می‌مانند):`);
  Object.keys(fields).forEach((k) => console.log(`  ${k}: ${JSON.stringify(current[k])} ⇒ ${JSON.stringify(fields[k])}`));
  if (!apply) { console.log('dry-run: چیزی تغییر نکرد. برای اعمال --apply بدهید.'); return 0; }
  settingsRepository.update(fields, { effectiveFrom: from });
  console.log('ثبت شد.');
  return 0;
}

try { process.exitCode = main(process.argv.slice(2)); } catch (err) { console.error(err.message); process.exitCode = 1; } finally { closeDb(); }

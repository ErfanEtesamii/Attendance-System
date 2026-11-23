// ثبت دستیِ «تاریخ شروع اعمال» برای یک تنظیم محاسباتی که قبلاً (بدون تاریخ) تغییر کرده؛ مثلاً استراحت با حقوق از ۴۵ به ۲۰ دقیقه:
//   node scripts/set-setting-history.js paidBreakMinutes 45 2026-11-18            → فقط گزارش (dry-run)
//   node scripts/set-setting-history.js paidBreakMinutes 45 2026-11-18 --apply   → اعمال
// معنا: «تا قبل از تاریخ داده‌شده مقدار تنظیم <مقدار قبلی> بود؛ از آن تاریخ به بعد همان مقدار فعلیِ تنظیمات». تاریخ میلادی YYYY-MM-DD.
// روزهای قبل از تاریخ با مقدار قبلی محاسبه می‌شوند (گزارش تحلیلی، حقوق، Mini App). ماه بسته‌شده هرگز تغییر نمی‌کند.
// قبل از --apply از دیتابیس بک‌آپ بگیرید. کد خروج: ۰ موفق | ۱ خطا | ۲ آرگومان نادرست
const { closeDb } = require('../src/db/connection');
const registry = require('../src/utils/settingsRegistry');
const settingsHistory = require('../src/utils/settingsHistory');
const settingsRepository = require('../src/repositories/settingsRepository');
const historyRepo = require('../src/repositories/settingsHistoryRepository');

function main(argv) {
  const args = argv.filter((a) => !a.startsWith('--'));
  const apply = argv.includes('--apply');
  const [key, beforeRaw, from] = args;
  if (!key || beforeRaw === undefined || !from) { console.error('استفاده: node scripts/set-setting-history.js <کلید> <مقدار قبلی> <YYYY-MM-DD> [--apply]'); return 2; }
  if (!registry.getDef(key) || !settingsHistory.isTracked(key)) { console.error(`«${key}» تنظیم محاسباتیِ تاریخ‌دار نیست. کلیدهای مجاز: ${settingsHistory.TRACKED.join('، ')}`); return 2; }
  if (!settingsHistory.DATE_RE.test(from) || Number.isNaN(Date.parse(`${from}T00:00:00Z`))) { console.error('تاریخ باید میلادی و به شکل YYYY-MM-DD باشد.'); return 2; }
  const checked = registry.validate(key, beforeRaw);
  if (!checked.ok) { console.error(`مقدار قبلی نامعتبر است: ${checked.error}`); return 2; }
  const current = settingsRepository.getAll()[key];
  const beforeSer = registry.serialize(key, checked.value);
  const curSer = registry.serialize(key, current);
  console.log(`${key}: تا قبل از ${from} ⇒ ${beforeSer} | از ${from} به بعد ⇒ ${curSer} (مقدار فعلی)`);
  const existing = historyRepo.listForKey(key);
  if (existing.length) console.log(`تاریخچه‌ی فعلی: ${existing.map((e) => `${e.from}=${e.value}`).join('، ')} (جایگزین/ادغام می‌شود)`);
  if (beforeSer === curSer && !existing.length) { console.log('مقدار قبلی با فعلی یکی است؛ چیزی برای ثبت نیست.'); return 0; }
  if (!apply) { console.log('dry-run: چیزی تغییر نکرد. برای اعمال --apply بدهید.'); return 0; }
  historyRepo.recordChange(key, from, beforeSer, curSer);
  console.log('ثبت شد.');
  return 0;
}

try { process.exitCode = main(process.argv.slice(2)); } catch (err) { console.error(err.message); process.exitCode = 1; } finally { closeDb(); }

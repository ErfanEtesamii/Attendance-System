// سیاست نگهداری بک‌آپ‌ها (S2-1b).
//
// انتخاب ساده برای «ماهانه»: اولین بک‌آپ روزانه‌ی موفق هر ماه میلادی به‌صورت یک «کپی مستقل» monthly-YYYYMM.db
// ذخیره می‌شود (نه اینکه فایل روزانه را از پاک‌سازی معاف کنیم) — چون قاعده‌ی پاک‌سازی دو دسته را کاملاً جدا نگه می‌دارد:
// «N روزانه‌ی جدیدتر» و «M ماهانه‌ی جدیدتر»؛ هر دسته فقط با ترتیب نام فایل مرتب می‌شود (نه mtime)، پس قابل‌پیش‌بینی و قابل‌تست است.
//
// فقط فایل‌هایی با الگوی دقیق daily-YYYYMMDD-HHmm.db و monthly-YYYYMM.db دست‌کاری می‌شوند.
// pre-migration-*، pre-restore-*، *.suspect و هر فایل دیگری هرگز پاک نمی‌شود.

const fs = require('fs');
const path = require('path');

const DAILY_RE = /^daily-(\d{4})(\d{2})\d{2}-\d{4}\.db$/;
const MONTHLY_RE = /^monthly-\d{6}\.db$/;

function listMatching(dir, re) {
  try {
    return fs.readdirSync(dir).filter((f) => re.test(f)).sort(); // نام‌ها با تاریخ شروع می‌شوند ⇒ ترتیب الفبایی = ترتیب زمانی
  } catch (_) {
    return [];
  }
}

// اگر برای ماهِ این بک‌آپ روزانه هنوز کپی ماهانه نیست، آن را کپی می‌کند. خروجی: نام کپی جدید یا null
function ensureMonthlyCopy(dir, dailyFile) {
  const m = DAILY_RE.exec(dailyFile);
  if (!m) return null;
  const monthly = `monthly-${m[1]}${m[2]}.db`;
  const dest = path.join(dir, monthly);
  if (fs.existsSync(dest)) return null;
  const tmp = `${dest}.partial`;
  try {
    fs.copyFileSync(path.join(dir, dailyFile), tmp);
    fs.renameSync(tmp, dest);
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch (_) { /* وجود ندارد */ }
    throw err;
  }
  return monthly;
}

// فقط جدیدترین keepDaily روزانه و keepMonthly ماهانه می‌مانند. keepها باید عدد صحیح ≥ ۱ باشند (وگرنه خطا، نه پاک‌سازی همه‌چیز).
function pruneBackups(dir, { keepDaily, keepMonthly, protect = [] }) {
  for (const [k, v] of Object.entries({ keepDaily, keepMonthly })) {
    if (!Number.isInteger(v) || v < 1) throw new Error(`${k} باید عدد صحیح ≥ ۱ باشد (دریافت: ${v}).`);
  }
  const keepSet = new Set(protect);
  const removed = { daily: [], monthly: [] };
  const sweep = (re, keep, bucket) => {
    const files = listMatching(dir, re).reverse(); // جدیدترین اول
    files.forEach((f, i) => {
      if (i < keep || keepSet.has(f)) return;
      fs.unlinkSync(path.join(dir, f));
      bucket.push(f);
    });
  };
  sweep(DAILY_RE, keepDaily, removed.daily);
  sweep(MONTHLY_RE, keepMonthly, removed.monthly);
  return removed;
}

/**
 * بعد از ساخت یک بک‌آپ روزانه صدا زده می‌شود: کپی ماهانه (در صورت نیاز) + پاک‌سازی قدیمی‌ها.
 * فایلِ تازه‌ساخته همیشه محافظت می‌شود.
 */
function applyRetention(dir, { justCreated, keepDaily, keepMonthly }) {
  const monthlyCreated = ensureMonthlyCopy(dir, justCreated);
  const removed = pruneBackups(dir, { keepDaily, keepMonthly, protect: [justCreated, ...(monthlyCreated ? [monthlyCreated] : [])] });
  return { monthlyCreated, removed };
}

module.exports = { applyRetention, ensureMonthlyCopy, pruneBackups, DAILY_RE, MONTHLY_RE };

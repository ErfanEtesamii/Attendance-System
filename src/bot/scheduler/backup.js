// Job بک‌آپ روزانه‌ی دیتابیس (S2-1a).
// db.backup() (API رسمی better-sqlite3) یک اسنپ‌شات سازگار با WAL می‌سازد و سرویس را متوقف نمی‌کند.
// ابتدا در فایل موقت (*.partial) نوشته و بعد rename می‌شود تا بک‌آپ نیمه‌کاره هرگز با نام یک بک‌آپ معتبر دیده نشود
// (systemHealth فقط .db را «آخرین بک‌آپ» حساب می‌کند).
// بعد از ساخت بک‌آپ، سیاست نگهداری (کپی ماهانه + پاک‌سازی قدیمی‌ها) اجرا می‌شود (S2-1b: src/utils/backupRetention.js).
//
// تأیید سلامت (S2-1c، قسمت ۱): PRAGMA integrity_check روی همان فایل بک‌آپ، «قبل از» rename به نام نهایی اجرا می‌شود
// (تا بک‌آپ خراب هرگز نام یک بک‌آپ معتبر را نگیرد و بک‌آپ سالمِ هم‌نام را بازنویسی نکند).
// نتیجه‌ی ناموفق ⇒ فایل به daily-….db.suspect منتقل می‌شود، کپی ماهانه/پاک‌سازی اجرا نمی‌شود و Job خطا می‌دهد
// (wrapJob آن را در job_runs با status=error و متن نتیجه ثبت می‌کند). هشدار watchdog و systemHealth در S2-1c قسمت ۲؛ restore در S2-2.

const fs = require('fs');
const path = require('path');
const config = require('../../config');
const { getDb } = require('../../db/connection');
const { applyRetention } = require('../../utils/backupRetention');
const { integrityCheckFile } = require('../../repositories/monitorRepository');

const pad = (n) => String(n).padStart(2, '0');

// فایل بک‌آپ هدر WAL دارد؛ باز کردن فقط‌خواندنیِ آن (integrity_check) بعد از بستن، -wal/-shm خالی کنار فایل جا می‌گذارد.
// این‌ها فقط برای فایل موقت خودِ این Job پاک می‌شوند (نه در repository، که مسیر دلخواه می‌گیرد و نباید به sidecar دیتابیس زنده دست بزند).
function removeSidecars(file) {
  for (const suffix of ['-wal', '-shm']) {
    try { fs.rmSync(`${file}${suffix}`, { force: true }); } catch (_) { /* قفل/وجود ندارد */ }
  }
}

// YYYYMMDD-HHmm بر اساس ساعت محلی سرور (همان ساعتی که cron با آن اجرا می‌شود)
function backupStamp(d) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

/**
 * @param {{db?: object, dir?: string, now?: Date, keepDaily?: number, keepMonthly?: number}} [opts]  فقط برای تست قابل تغییرند
 * @returns {Promise<{file: string, path: string, sizeBytes: number, integrity: 'ok', monthlyCreated: string|null, removed: object}>}
 * @throws اگر integrity_check ناموفق باشد (فایل .suspect می‌شود) یا ساخت بک‌آپ خطا بدهد
 */
async function runDailyBackup({
  db = getDb(),
  dir = config.monitor.backupDir,
  now = new Date(),
  keepDaily = config.backup.keepDaily,
  keepMonthly = config.backup.keepMonthly,
} = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const file = `daily-${backupStamp(now)}.db`;
  const dest = path.join(dir, file);
  const tmp = `${dest}.partial`;

  try {
    fs.rmSync(tmp, { force: true });
    await db.backup(tmp);
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch (_) { /* وجود ندارد */ }
    throw err;
  }

  // تأیید سلامت روی خودِ فایل بک‌آپ (اتصال جدا؛ پیش از انتشار با نام نهایی)
  const check = integrityCheckFile(tmp);
  removeSidecars(tmp);
  if (!check.ok) {
    const suspect = `${dest}.suspect`;
    try {
      fs.renameSync(tmp, suspect);
    } catch (err) {
      try { fs.rmSync(tmp, { force: true }); } catch (_) { /* وجود ندارد */ }
      throw new Error(`integrity_check بک‌آپ ${file} ناموفق بود (${check.result}) و جداسازی فایل هم شکست خورد: ${err.message}`);
    }
    console.error(`[backup] ${file} سالم نیست (${check.result}) ⇒ ${file}.suspect`);
    throw new Error(`integrity_check بک‌آپ ${file} ناموفق بود (${check.result}). فایل به ${file}.suspect منتقل شد.`);
  }
  fs.renameSync(tmp, dest); // روی ویندوز هم فایل مقصد قبلی (اجرای دوباره در همان دقیقه) را جایگزین می‌کند

  const sizeBytes = fs.statSync(dest).size;
  console.log(`[backup] ${file} ساخته و integrity_check سالم بود (${Math.round(sizeBytes / 1024)} KB).`);

  // خطای نگهداری، بک‌آپ تازه را بی‌اعتبار نمی‌کند (فایل ساخته شده)، ولی Job را «خطا» می‌کند تا دیده شود
  const { monthlyCreated, removed } = applyRetention(dir, { justCreated: file, keepDaily, keepMonthly });
  const n = removed.daily.length + removed.monthly.length;
  if (monthlyCreated || n) console.log(`[backup] نگهداری: کپی ماهانه=${monthlyCreated || '-'}، پاک‌شده=${n}`);
  return { file, path: dest, sizeBytes, integrity: 'ok', monthlyCreated, removed };
}

module.exports = { runDailyBackup, backupStamp };

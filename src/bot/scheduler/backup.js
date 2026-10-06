// Job بک‌آپ روزانه‌ی دیتابیس (S2-1a).
// db.backup() (API رسمی better-sqlite3) یک اسنپ‌شات سازگار با WAL می‌سازد و سرویس را متوقف نمی‌کند.
// ابتدا در فایل موقت (*.partial) نوشته و بعد rename می‌شود تا بک‌آپ نیمه‌کاره هرگز با نام یک بک‌آپ معتبر دیده نشود
// (systemHealth فقط .db را «آخرین بک‌آپ» حساب می‌کند).
// بعد از ساخت بک‌آپ، سیاست نگهداری (کپی ماهانه + پاک‌سازی قدیمی‌ها) اجرا می‌شود (S2-1b: src/utils/backupRetention.js).
// integrity_check (S2-1c) و restore (S2-2) عمداً اینجا نیستند.

const fs = require('fs');
const path = require('path');
const config = require('../../config');
const { getDb } = require('../../db/connection');
const { applyRetention } = require('../../utils/backupRetention');

const pad = (n) => String(n).padStart(2, '0');

// YYYYMMDD-HHmm بر اساس ساعت محلی سرور (همان ساعتی که cron با آن اجرا می‌شود)
function backupStamp(d) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

/**
 * @param {{db?: object, dir?: string, now?: Date, keepDaily?: number, keepMonthly?: number}} [opts]  فقط برای تست قابل تغییرند
 * @returns {Promise<{file: string, path: string, sizeBytes: number, monthlyCreated: string|null, removed: object}>}
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
    fs.renameSync(tmp, dest); // روی ویندوز هم فایل مقصد قبلی (اجرای دوباره در همان دقیقه) را جایگزین می‌کند
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch (_) { /* وجود ندارد */ }
    throw err;
  }

  const sizeBytes = fs.statSync(dest).size;
  console.log(`[backup] ${file} ساخته شد (${Math.round(sizeBytes / 1024)} KB).`);

  // خطای نگهداری، بک‌آپ تازه را بی‌اعتبار نمی‌کند (فایل ساخته شده)، ولی Job را «خطا» می‌کند تا دیده شود
  const { monthlyCreated, removed } = applyRetention(dir, { justCreated: file, keepDaily, keepMonthly });
  const n = removed.daily.length + removed.monthly.length;
  if (monthlyCreated || n) console.log(`[backup] نگهداری: کپی ماهانه=${monthlyCreated || '-'}، پاک‌شده=${n}`);
  return { file, path: dest, sizeBytes, monthlyCreated, removed };
}

module.exports = { runDailyBackup, backupStamp };

// Job ماهانه‌ی نگهداری دیتابیس (S2-7b). ترتیب:
//   ۱) cleanup جدول‌های فرعی (S2-7a، حذف واقعی؛ نگهداری‌ها از تنظیمات) ۲) ANALYZE ۳) PRAGMA optimize ۴) VACUUM «فقط اگر فضای دیسک کافی است».
// فضای کافی: چک دیسک systemHealth.checkDisk قابل‌اندازه‌گیری باشد و فضای آزاد ≥ ۲ × (حجم دیتابیس + WAL) + MONITOR_DISK_MIN_FREE_MB.
// VACUUM نسخه‌ی کاملی از دیتابیس می‌سازد، پس کمبود فضا یعنی ریسک پر شدن دیسک سرور؛ در این حالت (یا اگر فضا سنجیدنی نیست) رد می‌شود
// و فقط لاگ می‌شود (Job خطا نمی‌دهد؛ ماه بعد دوباره تلاش می‌شود). خطای cleanup بقیه‌ی مراحل را متوقف نمی‌کند ولی در پایان Job را «error» می‌کند.

const fs = require('fs');
const config = require('../../config');
const maintenanceRepository = require('../../repositories/maintenanceRepository');
const { runCleanup } = require('../../utils/dataCleanup');
const { checkDisk } = require('../../utils/systemHealth');

const MB = 1048576;

// حجم فایل دیتابیس + WAL (بایت)
function dbSizeBytes(dbPath = config.dbPath) {
  let total = 0;
  for (const suffix of ['', '-wal']) {
    try { total += fs.statSync(`${dbPath}${suffix}`).size; } catch (_) { /* وجود ندارد */ }
  }
  return total;
}

/**
 * تصمیم VACUUM. خالص و بدون اثر جانبی (برای تست).
 * @returns {{ok: boolean, requiredMb: number|null, freeMb: number|null, reason: string}}
 */
function vacuumDecision({ disk, sizeBytes, minFreeMb }) {
  if (!disk || !disk.applicable || !Number.isFinite(disk.freeMb)) {
    return { ok: false, requiredMb: null, freeMb: null, reason: 'فضای آزاد دیسک قابل اندازه‌گیری نیست' };
  }
  const requiredMb = Math.ceil((sizeBytes * 2) / MB) + minFreeMb;
  if (disk.freeMb < requiredMb) {
    return { ok: false, requiredMb, freeMb: disk.freeMb, reason: `فضای آزاد ${disk.freeMb}MB کمتر از حداقل لازم ${requiredMb}MB است` };
  }
  return { ok: true, requiredMb, freeMb: disk.freeMb, reason: 'فضای کافی' };
}

/**
 * @param {{log?: (msg: string) => void, cleanup?: Function, disk?: Function, sizeBytes?: Function, repo?: object, minFreeMb?: number}} [opts] فقط برای تست قابل تغییرند
 * @returns {{cleanup: object|null, analyzed: boolean, optimized: boolean, vacuum: {ran: boolean, reason: string, requiredMb: number|null, freeMb: number|null}}}
 */
function runDbMaintenance({
  log = console.log,
  cleanup = () => runCleanup({ dryRun: false, log }),
  disk = checkDisk,
  sizeBytes = dbSizeBytes,
  repo = maintenanceRepository,
  minFreeMb = config.monitor.diskMinFreeMb,
} = {}) {
  let cleanupResult = null;
  let cleanupError = null;
  try {
    cleanupResult = cleanup();
  } catch (err) {
    cleanupError = err;
    log(`[db-maintenance] cleanup ناقص ماند: ${err.message}`);
  }

  repo.analyze();
  repo.optimize();
  log('[db-maintenance] ANALYZE و PRAGMA optimize انجام شد.');

  const decision = vacuumDecision({ disk: disk(), sizeBytes: sizeBytes(), minFreeMb });
  const vacuum = { ran: false, reason: decision.reason, requiredMb: decision.requiredMb, freeMb: decision.freeMb };
  if (decision.ok) {
    const before = sizeBytes();
    repo.vacuum();
    try { repo.checkpointTruncate(); } catch (_) { /* غیرحیاتی */ }
    vacuum.ran = true;
    log(`[db-maintenance] VACUUM انجام شد (فضای آزاد ${decision.freeMb}MB، حداقل لازم ${decision.requiredMb}MB؛ حجم ${Math.round(before / MB)}MB ← ${Math.round(sizeBytes() / MB)}MB).`);
  } else {
    log(`[db-maintenance] VACUUM رد شد: ${decision.reason}.`);
  }

  if (cleanupError) throw cleanupError;
  return { cleanup: cleanupResult, analyzed: true, optimized: true, vacuum };
}

module.exports = { runDbMaintenance, vacuumDecision, dbSizeBytes };

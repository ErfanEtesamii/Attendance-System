// Job ماهانه‌ی آرشیو audit — فقط حالت dry-run (S2-6b).
// رکوردهای audit_log را که قدیمی‌تر از «audit_retention_months» ماه‌اند می‌شمارد و نتیجه را لاگ می‌کند.
// ⚠️ این Job هرگز چیزی را جابه‌جا/حذف/ویرایش نمی‌کند (فقط SELECT)؛ تنظیم audit_archive_enabled هم فعلاً فقط در لاگ
// گزارش می‌شود. انتقال واقعی (تراکنش + batch) در S2-6c اضافه می‌شود.
// زمان‌ها UTC‌اند، چون audit_log.occurred_at با datetime('now') (UTC) ذخیره می‌شود.

const auditRepository = require('../../repositories/auditRepository');
const settingsRepository = require('../../repositories/settingsRepository');

const pad = (n) => String(n).padStart(2, '0');

/**
 * آستانه‌ی «قدیمی‌تر از N ماه» به قالب ذخیره‌ی audit_log (YYYY-MM-DD HH:MM:SS، UTC).
 * اگر روز در ماه مقصد وجود نداشت به آخر همان ماه می‌رود (۳۱ مارس − ۱ ماه = آخر فوریه).
 */
function cutoffFor(now, months) {
  const total = now.getUTCFullYear() * 12 + now.getUTCMonth() - months;
  const year = Math.floor(total / 12);
  const month = total % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(now.getUTCDate(), lastDay);
  return `${year}-${pad(month + 1)}-${pad(day)} ${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())}`;
}

/**
 * @param {{now?: Date, retentionMonths?: number, enabled?: boolean, log?: (msg: string) => void}} [opts] فقط برای تست قابل تغییرند
 * @returns {{mode: 'dry-run', enabled: boolean, retentionMonths: number, cutoff: string, candidates: number, oldest: string|null, newest: string|null, moved: 0}}
 */
function runAuditArchive({
  now = new Date(),
  retentionMonths = settingsRepository.getAuditRetentionMonths(),
  enabled = settingsRepository.isAuditArchiveEnabled(),
  log = console.log,
} = {}) {
  const cutoff = cutoffFor(now, retentionMonths);
  const { count, oldest, newest } = auditRepository.summarizeOlderThan(cutoff);
  log(
    `[audit-archive] dry-run: ${count} رکورد audit قدیمی‌تر از ${cutoff} UTC (نگهداری ${retentionMonths} ماه، آرشیو ${enabled ? 'روشن' : 'خاموش'}) — چیزی منتقل نشد.`
  );
  return { mode: 'dry-run', enabled, retentionMonths, cutoff, candidates: count, oldest, newest, moved: 0 };
}

module.exports = { runAuditArchive, cutoffFor };

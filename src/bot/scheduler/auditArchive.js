// Job ماهانه‌ی آرشیو audit (S2-6b dry-run، S2-6c انتقال واقعی).
// رکوردهای audit_log را که قدیمی‌تر از «audit_retention_months» ماه‌اند می‌شمارد؛ اگر «audit_archive_enabled» خاموش باشد
// فقط dry-run است (شمارش + لاگ، بدون هیچ تغییری). اگر روشن باشد همان رکوردها batch‌به‌batch (هر batch یک تراکنش) به
// audit_log_archive «منتقل» می‌شوند (کپی با همان id/زمان + حذف از اصلی)؛ هیچ رکوردی گم نمی‌شود.
// زمان‌ها UTC‌اند، چون audit_log.occurred_at با datetime('now') (UTC) ذخیره می‌شود.

const auditRepository = require('../../repositories/auditRepository');
const settingsRepository = require('../../repositories/settingsRepository');
const config = require('../../config');

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
 * @param {{now?: Date, retentionMonths?: number, enabled?: boolean, batchSize?: number, log?: (msg: string) => void}} [opts] فقط برای تست قابل تغییرند
 * @returns {{mode: 'dry-run'|'archive', enabled: boolean, retentionMonths: number, cutoff: string, candidates: number, oldest: string|null, newest: string|null, moved: number, batches: number}}
 */
function runAuditArchive({
  now = new Date(),
  retentionMonths = settingsRepository.getAuditRetentionMonths(),
  enabled = settingsRepository.isAuditArchiveEnabled(),
  batchSize = config.auditArchive.batchSize,
  log = console.log,
} = {}) {
  // آستانه یک‌بار در شروع ثابت می‌شود تا در حین اجرا جابه‌جا نشود
  const cutoff = cutoffFor(now, retentionMonths);
  const { count, oldest, newest } = auditRepository.summarizeOlderThan(cutoff);
  const base = { enabled, retentionMonths, cutoff, candidates: count, oldest, newest };

  if (!enabled) {
    log(
      `[audit-archive] dry-run: ${count} رکورد audit قدیمی‌تر از ${cutoff} UTC (نگهداری ${retentionMonths} ماه، آرشیو خاموش) — چیزی منتقل نشد.`
    );
    return { mode: 'dry-run', ...base, moved: 0, batches: 0 };
  }

  if (count === 0) {
    log(`[audit-archive] هیچ رکورد audit قدیمی‌تر از ${cutoff} UTC نیست (نگهداری ${retentionMonths} ماه) — چیزی منتقل نشد.`);
    return { mode: 'archive', ...base, moved: 0, batches: 0 };
  }

  log(`[audit-archive] شروع انتقال: ${count} رکورد audit قدیمی‌تر از ${cutoff} UTC (batch ${batchSize}).`);
  // سقف تکرار فقط محافظ حلقه‌ی بی‌پایان است؛ هر batchِ موفق دست‌کم یک رکورد را از مجموعه‌ی محدود کم می‌کند
  const maxBatches = Math.ceil(count / batchSize) + 10;
  let moved = 0;
  let batches = 0;
  try {
    for (;;) {
      const n = auditRepository.archiveBatch(cutoff, batchSize);
      if (n === 0) break;
      moved += n;
      batches += 1;
      if (batches > maxBatches) throw new Error('تعداد batchها از سقف مجاز گذشت؛ انتقال متوقف شد.');
    }
    // تأیید پایانی: هیچ رکورد قدیمی‌ای در audit_log نمانده باشد
    const left = auditRepository.summarizeOlderThan(cutoff).count;
    if (left !== 0) throw new Error(`پس از انتقال هنوز ${left} رکورد قدیمی در audit_log مانده است.`);
  } catch (err) {
    // batchهای قبلی هرکدام کامل و سالم commit شده‌اند؛ فقط گزارش پیشرفت می‌دهیم و خطا را به wrapJob می‌سپاریم
    log(`[audit-archive] خطا پس از انتقال ${moved} رکورد در ${batches} batch: ${err.message}`);
    throw err;
  }

  log(`[audit-archive] انجام شد: ${moved} رکورد در ${batches} batch به audit_log_archive منتقل شد (آستانه ${cutoff} UTC).`);
  // ثبت خودِ انتقال در audit (رکوردی تازه است، پس هرگز در همین اجرا آرشیو نمی‌شود). خطای ثبت نباید Job را «خطا» کند.
  try {
    auditRepository.logEvent({ action: 'audit_archived', details: { moved, batches, cutoff, retentionMonths, oldest, newest } });
  } catch (err) {
    log(`[audit-archive] انتقال کامل شد ولی ثبت audit_archived ناموفق بود: ${err.message}`);
  }
  return { mode: 'archive', ...base, moved, batches };
}

module.exports = { runAuditArchive, cutoffFor };

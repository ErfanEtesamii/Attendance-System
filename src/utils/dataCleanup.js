// پاک‌سازی جدول‌های فرعی (S2-7a): job_runs، monitor_alerts حل‌شده، rate_limit_hits، و (S4-5b) notifications «خوانده‌شده».
// فقط این چهار جدول؛ داده‌ی کاربری (users، attendance_records، leave_requests، audit_log و ...) هرگز لمس نمی‌شود.
// csp_reports ذخیره نمی‌شود (routes/cspReport.js فقط لاگ می‌کند)، پس سیاستی ندارد.
// پیش‌فرض dryRun=true است (محافظه‌کارانه): فقط می‌شمارد و لاگ می‌کند. حذف واقعی فقط با dryRun:false صریح (Job در S2-7b).
// نگهداری‌ها از تنظیمات خوانده می‌شود (settingsRepository.getCleanupRetention).

const settingsRepository = require('../repositories/settingsRepository');
const jobRunsRepository = require('../repositories/jobRunsRepository');
const monitorRepository = require('../repositories/monitorRepository');
const rateLimitRepository = require('../repositories/rateLimitRepository');
const notificationsRepository = require('../repositories/notificationsRepository');

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * @param {{now?: Date, dryRun?: boolean, retention?: {jobRunsDays:number, monitorAlertsDays:number, rateLimitDays:number, notificationsDays:number}, log?: (msg: string) => void}} [opts]
 * @returns {{dryRun: boolean, tables: Record<string, {retentionDays:number, cutoff:string, candidates:number, deleted:number}>}}
 * @throws اگر پاک‌سازی یک جدول خطا بدهد، بقیه اجرا می‌شوند و در پایان یک خطای تجمیعی پرتاب می‌شود
 */
function runCleanup({
  now = new Date(),
  dryRun = true,
  retention = settingsRepository.getCleanupRetention(),
  log = console.log,
} = {}) {
  const nowMs = now.getTime();
  const cutoffMs = (days) => nowMs - days * DAY_MS;
  const iso = (ms) => new Date(ms).toISOString();

  const plans = [
    {
      table: 'job_runs',
      days: retention.jobRunsDays,
      count: (ms) => jobRunsRepository.countPurgeable(iso(ms)),
      purge: (ms) => jobRunsRepository.purgeOlderThan(iso(ms)),
      cutoff: iso,
      label: 'اجراهای تمام‌شده‌ی Job (به‌جز آخرین success/error هر Job)',
    },
    {
      table: 'monitor_alerts',
      days: retention.monitorAlertsDays,
      count: (ms) => monitorRepository.countResolvedOlderThan(iso(ms)),
      purge: (ms) => monitorRepository.purgeResolvedOlderThan(iso(ms)),
      cutoff: iso,
      label: 'هشدارهای حل‌شده',
    },
    {
      table: 'rate_limit_hits',
      days: retention.rateLimitDays,
      count: (ms) => rateLimitRepository.countExpired(ms),
      purge: (ms) => rateLimitRepository.purgeExpired(ms),
      cutoff: iso,
      label: 'شمارنده‌های منقضی rate limit',
    },
    {
      table: 'notifications',
      days: retention.notificationsDays,
      count: (ms) => notificationsRepository.countPurgeable(iso(ms)),
      purge: (ms) => notificationsRepository.purgeOlderThan(iso(ms)),
      cutoff: iso,
      label: 'اعلان‌های خوانده‌شده (خوانده‌نشده‌ها هرگز حذف نمی‌شوند)',
    },
  ];

  const tables = {};
  const errors = [];
  for (const p of plans) {
    try {
      if (!Number.isInteger(p.days) || p.days < 1) throw new Error(`نگهداری نامعتبر (${p.days})`);
      const ms = cutoffMs(p.days);
      const candidates = p.count(ms);
      const deleted = dryRun ? 0 : p.purge(ms);
      tables[p.table] = { retentionDays: p.days, cutoff: p.cutoff(ms), candidates, deleted };
      log(
        dryRun
          ? `[cleanup] dry-run ${p.table}: ${candidates} ردیف (${p.label}) قدیمی‌تر از ${p.cutoff(ms)} (نگهداری ${p.days} روز) — چیزی حذف نشد.`
          : `[cleanup] ${p.table}: ${deleted} ردیف حذف شد (${p.label}، قدیمی‌تر از ${p.cutoff(ms)}، نگهداری ${p.days} روز).`
      );
    } catch (err) {
      errors.push(`${p.table}: ${err.message}`);
      log(`[cleanup] خطا در ${p.table}: ${err.message}`);
    }
  }
  if (errors.length) throw new Error(`پاک‌سازی ناقص: ${errors.join(' | ')}`);
  return { dryRun, tables };
}

module.exports = { runCleanup };

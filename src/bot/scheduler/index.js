// ثبت تمام Jobهای زمان‌بندی‌شده فاز ۳. عبارات cron از src/config.js (که خودش از .env می‌خواند) گرفته می‌شود.
// ⚠️ پیش‌فرض‌های cron را حتماً متناسب با روزهای کاری واقعی شرکت در .env بازبینی کنید
// (پیش‌فرض فعلی: شنبه تا چهارشنبه به‌عنوان روزهای کاری در نظر گرفته شده - کدهای 6,0,1,2,3 در node-cron).

const cron = require('node-cron');
const config = require('../../config');
const { checkLateCheckins, checkRepeatedLateness } = require('./lateCheckinReminder');
const { checkCheckoutReminders } = require('./checkoutReminder');
const { autoCloseIncompleteRecords } = require('./autoCloseIncomplete');
const { markNonWorkingDays } = require('./markNonWorkingDays');
const { sendDailyReport, sendWeeklyReport, sendMonthlyReport } = require('./reports');
const { sendNightlyReview } = require('./nightlyReview');
const { runWatchdog } = require('./watchdog');
const { runDailyBackup } = require('./backup');
const { runAuditArchive } = require('./auditArchive');
const { runDbMaintenance } = require('./dbMaintenance');
const { isFirstDayOfJalaliMonth } = require('../../utils/jalali');
const { wrapJob, runAll } = require('../../utils/jobRunner');
const jobRunsRepository = require('../../repositories/jobRunsRepository');

// بخش ۲-ج۱: هر Job از طریق wrapJob اجرا می‌شود تا شروع/موفقیت/خطا/مدتش در job_runs ثبت شود.
// نام Job = کلید config.cron (در صفحه‌ی «وضعیت سیستم» و پیام هشدار همین نام دیده می‌شود).
function startSchedulers(bot) {
  // اجراهای نیمه‌تمامِ پروسه‌ی قبلی (ری‌استارت/crash) «interrupted» می‌شوند، نه خطا
  try {
    const n = jobRunsRepository.markInterrupted();
    if (n) console.log(`[scheduler] ${n} اجرای نیمه‌تمام از پروسه‌ی قبلی به «interrupted» علامت خورد.`);
  } catch (err) {
    console.error('[scheduler] markInterrupted ناموفق:', err.message);
  }

  cron.schedule(
    config.cron.lateCheckinCheck,
    wrapJob('lateCheckinCheck', () => runAll(() => checkLateCheckins(bot), () => checkRepeatedLateness(bot)))
  );

  cron.schedule(config.cron.checkoutReminderCheck, wrapJob('checkoutReminderCheck', () => checkCheckoutReminders(bot)));

  cron.schedule(config.cron.dailyReport, wrapJob('dailyReport', () => sendDailyReport(bot)));

  cron.schedule(config.cron.nightlyReview, wrapJob('nightlyReview', () => sendNightlyReview(bot)));

  cron.schedule(config.cron.weeklyReport, wrapJob('weeklyReport', () => sendWeeklyReport(bot)));

  // گزارش ماهانه بر اساس تقویم شمسی: چون روز شروع ماه شمسی روی تقویم میلادی هر سال جابه‌جا می‌شود،
  // این Job هر روز اجرا می‌شود ولی فقط وقتی «امروز روز اول یک ماه شمسی است» گزارش ماه شمسی قبلی را ارسال می‌کند.
  // (روزهای دیگر هم در job_runs به‌صورت «موفق» ثبت می‌شود: یعنی Job اجرا شد و کاری لازم نبود.)
  cron.schedule(
    config.cron.monthlyReport,
    wrapJob('monthlyReport', () => {
      if (!isFirstDayOfJalaliMonth()) return undefined;
      return sendMonthlyReport(bot);
    })
  );

  cron.schedule(config.cron.autoCloseIncomplete, wrapJob('autoCloseIncomplete', () => autoCloseIncompleteRecords()));

  cron.schedule(config.cron.markNonWorkingDays, wrapJob('markNonWorkingDays', () => markNonWorkingDays()));

  // بک‌آپ روزانه (S2-1a): db.backup() به BACKUP_DIR/daily-YYYYMMDD-HHmm.db
  if (!cron.validate(config.cron.dailyBackup)) {
    console.error(`[scheduler] CRON_DAILY_BACKUP نامعتبر است («${config.cron.dailyBackup}»)؛ بک‌آپ روزانه فعال نشد.`);
  } else {
    cron.schedule(config.cron.dailyBackup, wrapJob('dailyBackup', () => runDailyBackup()));
  }

  // آرشیو ماهانه‌ی audit (S2-6b/6c): تنظیم auditArchiveEnabled خاموش ⇒ dry-run (شمارش + لاگ)، روشن ⇒ انتقال واقعی با batch
  if (!cron.validate(config.cron.auditArchive)) {
    console.error(`[scheduler] CRON_AUDIT_ARCHIVE نامعتبر است («${config.cron.auditArchive}»)؛ Job آرشیو audit فعال نشد.`);
  } else {
    cron.schedule(config.cron.auditArchive, wrapJob('auditArchive', () => runAuditArchive()));
  }

  // نگهداری ماهانه‌ی دیتابیس (S2-7b): cleanup جدول‌های فرعی ← ANALYZE/optimize ← VACUUM (فقط با فضای دیسک کافی)
  if (!cron.validate(config.cron.dbMaintenance)) {
    console.error(`[scheduler] CRON_DB_MAINTENANCE نامعتبر است («${config.cron.dbMaintenance}»)؛ Job نگهداری دیتابیس فعال نشد.`);
  } else {
    cron.schedule(config.cron.dbMaintenance, wrapJob('dbMaintenance', () => runDbMaintenance()));
  }

  // Watchdog: فقط شکست‌هایش در job_runs ثبت می‌شود (هر ۵ دقیقه، موفقیت‌ها ردیف‌های بی‌ارزش زیاد می‌ساختند)
  if (config.monitor.watchdogEnabled) {
    if (!cron.validate(config.monitor.watchdogCron)) {
      console.error(`[scheduler] CRON_WATCHDOG نامعتبر است («${config.monitor.watchdogCron}»)؛ watchdog فعال نشد.`);
    } else {
      cron.schedule(config.monitor.watchdogCron, wrapJob('watchdog', () => runWatchdog({ bot }), { recordSuccess: false }));
    }
  }

  console.log('[bot] تمام Jobهای زمان‌بندی‌شده فعال شدند.');
}

module.exports = { startSchedulers };

// ثبت تمام Jobهای زمان‌بندی‌شده فاز ۳. عبارات cron از «رجیستری تنظیمات» می‌آید (S3-8c): مقدار ذخیره‌شده‌ی پنل، وگرنه CRON_* در .env، وگرنه پیش‌فرض کد
// (src/utils/settingsRegistry.js ⇒ settingsRepository.getCronExpressions()).
// ⚠️ پیش‌فرض‌های cron را حتماً متناسب با روزهای کاری واقعی شرکت بازبینی کنید. Jobهای یادآور/گزارش/شبانه هر روز اجرا می‌شوند و روز کاری را
// برای هر کاربر از getCalendarDay می‌گیرند (S3-8a/8b).
//
// reload() (S3-8c): بعد از ذخیره‌ی تنظیمات cron صدا زده می‌شود و بدون ری‌استارت پروسه، فقط Jobهایی را که عبارتشان عوض شده دوباره می‌سازد:
// اول Job جدید ساخته می‌شود و بعد قدیمی متوقف (هیچ لحظه‌ای بدون زمان‌بندی نمی‌ماند)، Jobهای بدون تغییر دست‌نخورده می‌مانند (tick از دست نمی‌رود)،
// و عبارت نامعتبر هرگز جای زمان‌بندی فعلی را نمی‌گیرد.

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
const { runLeaveApprovalReminder } = require('./leaveApprovalReminder');
const { isFirstDayOfJalaliMonth } = require('../../utils/jalali');
const { wrapJob, runAll } = require('../../utils/jobRunner');
const jobRunsRepository = require('../../repositories/jobRunsRepository');
const settingsRepository = require('../../repositories/settingsRepository');

// فهرست Jobها. name = کلید config.cron / نام اجرا در job_runs / کلید settingsRepository.getCronExpressions().
// بخش ۲-ج۱: هر Job از طریق wrapJob اجرا می‌شود تا شروع/موفقیت/خطا/مدتش در job_runs ثبت شود.
function buildJobs(bot) {
  return [
    { name: 'lateCheckinCheck', run: () => runAll(() => checkLateCheckins(bot), () => checkRepeatedLateness(bot)) },
    { name: 'checkoutReminderCheck', run: () => checkCheckoutReminders(bot) },
    { name: 'dailyReport', run: () => sendDailyReport(bot) },
    { name: 'nightlyReview', run: () => sendNightlyReview(bot) },
    { name: 'weeklyReport', run: () => sendWeeklyReport(bot) },
    // گزارش ماهانه بر اساس تقویم شمسی: چون روز شروع ماه شمسی روی تقویم میلادی هر سال جابه‌جا می‌شود،
    // این Job هر روز اجرا می‌شود ولی فقط وقتی «امروز روز اول یک ماه شمسی است» گزارش ماه شمسی قبلی را ارسال می‌کند.
    // (روزهای دیگر هم در job_runs به‌صورت «موفق» ثبت می‌شود: یعنی Job اجرا شد و کاری لازم نبود.)
    { name: 'monthlyReport', run: () => (isFirstDayOfJalaliMonth() ? sendMonthlyReport(bot) : undefined) },
    { name: 'autoCloseIncomplete', run: () => autoCloseIncompleteRecords() },
    { name: 'markNonWorkingDays', run: () => markNonWorkingDays() },
    // بک‌آپ روزانه (S2-1a): db.backup() به BACKUP_DIR/daily-YYYYMMDD-HHmm.db
    { name: 'dailyBackup', run: () => runDailyBackup() },
    // آرشیو ماهانه‌ی audit (S2-6b/6c): تنظیم auditArchiveEnabled خاموش ⇒ dry-run (شمارش + لاگ)، روشن ⇒ انتقال واقعی با batch
    { name: 'auditArchive', run: () => runAuditArchive() },
    // یادآوری/ارجاع تأیید مرخصی (S4-11c): تنظیمات leaveApprovalReminderHours/leaveApprovalEscalateHours/leaveEscalateWhenApproverOnLeave؛ همه خاموش ⇒ بی‌اثر
    { name: 'leaveApprovalReminder', run: () => runLeaveApprovalReminder() },
    // نگهداری ماهانه‌ی دیتابیس (S2-7b): cleanup جدول‌های فرعی ← ANALYZE/optimize ← VACUUM (فقط با فضای دیسک کافی)
    { name: 'dbMaintenance', run: () => runDbMaintenance() },
    // Watchdog: فقط شکست‌هایش در job_runs ثبت می‌شود (هر ۵ دقیقه، موفقیت‌ها ردیف‌های بی‌ارزش زیاد می‌ساختند)
    { name: 'watchdog', enabled: () => config.monitor.watchdogEnabled, opts: { recordSuccess: false }, run: () => runWatchdog({ bot }) },
  ];
}

// حالت پروسه: null = هنوز startSchedulers صدا زده نشده (مثلاً فقط API یا تست). tasks: نام Job ← { expr, task }
let state = null;

function stopTask(entry) {
  try {
    entry.task.stop();
  } catch (err) {
    console.error('[scheduler] توقف زمان‌بندی ناموفق:', err.message);
  }
}

// زمان‌بندی را با عبارت‌های «مؤثر» فعلی همگام می‌کند. خروجی: { changed: [{ job, from, to }], errors: [{ job, cron, error }] }
function sync() {
  const changed = [];
  const errors = [];
  let crons;
  try {
    crons = settingsRepository.getCronExpressions();
  } catch (err) {
    // خطای DB: زمان‌بندی فعلی دست‌نخورده می‌ماند
    errors.push({ job: '*', cron: null, error: `خواندن تنظیمات ناموفق: ${err.message}` });
    console.error(`[scheduler] ${errors[0].error}`);
    return { changed, errors };
  }

  for (const job of state.jobs) {
    const existing = state.tasks.get(job.name);
    if (job.enabled && !job.enabled()) {
      if (existing) { stopTask(existing); state.tasks.delete(job.name); }
      continue;
    }
    const expr = crons[job.name];
    if (existing && existing.expr === expr) continue; // بدون تغییر
    if (typeof expr !== 'string' || !cron.validate(expr)) {
      const error = `عبارت cron نامعتبر است («${expr}»)`;
      errors.push({ job: job.name, cron: expr, error });
      console.error(`[scheduler] ${job.name}: ${error}؛ ${existing ? 'زمان‌بندی قبلی حفظ شد.' : 'Job فعال نشد.'}`);
      continue;
    }
    let task;
    try {
      task = cron.schedule(expr, wrapJob(job.name, job.run, job.opts));
    } catch (err) {
      errors.push({ job: job.name, cron: expr, error: err.message });
      console.error(`[scheduler] ${job.name}: ساخت زمان‌بندی ناموفق: ${err.message}`);
      continue;
    }
    if (existing) stopTask(existing); // اول جدید، بعد قدیمی
    state.tasks.set(job.name, { expr, task });
    changed.push({ job: job.name, from: existing ? existing.expr : null, to: expr });
  }
  return { changed, errors };
}

function startSchedulers(bot) {
  // اجراهای نیمه‌تمامِ پروسه‌ی قبلی (ری‌استارت/crash) «interrupted» می‌شوند، نه خطا
  try {
    const n = jobRunsRepository.markInterrupted();
    if (n) console.log(`[scheduler] ${n} اجرای نیمه‌تمام از پروسه‌ی قبلی به «interrupted» علامت خورد.`);
  } catch (err) {
    console.error('[scheduler] markInterrupted ناموفق:', err.message);
  }

  if (state) stopSchedulers(); // فراخوانی دوباره: زمان‌بندی‌های قبلی نباید دوبار اجرا شوند
  state = { bot, jobs: buildJobs(bot), tasks: new Map() };
  sync();
  console.log('[bot] تمام Jobهای زمان‌بندی‌شده فعال شدند.');
}

// بعد از ذخیره‌ی تنظیمات cron صدا زده می‌شود (routes/admin/settings.js). قبل از startSchedulers (مثلاً فقط API) ⇒ کاری نمی‌کند.
function reload() {
  if (!state) return { reloaded: false, reason: 'scheduler_not_started', changed: [], errors: [] };
  const { changed, errors } = sync();
  if (changed.length) console.log(`[scheduler] reload: ${changed.map((c) => `${c.job} (${c.from || '—'} → ${c.to})`).join('، ')}`);
  return { reloaded: true, changed, errors };
}

// توقف همه‌ی زمان‌بندی‌ها (تست/خاموش‌شدن تمیز)
function stopSchedulers() {
  if (!state) return;
  state.tasks.forEach(stopTask);
  state = null;
}

// نام همه‌ی Jobهای ثبت‌شده در scheduler (برای تست: «Job در scheduler هست»؛ جایگزین grep روی متن سورس)
function jobNames() {
  return buildJobs(null).map((j) => j.name);
}

// عبارت cron فعالِ هر Job در همین پروسه (برای تست/عیب‌یابی)
function activeCrons() {
  const out = {};
  if (state) state.tasks.forEach((entry, name) => { out[name] = entry.expr; });
  return out;
}

module.exports = { startSchedulers, reload, stopSchedulers, activeCrons, jobNames };

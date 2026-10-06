// S3-2c: سرویس روز کاری = «خواندن از repository» + «صدا زدن computeDay».
// computeDay (S3-2b) خالص است و به DB دسترسی ندارد؛ این فایل تنها جایی است که استراحت‌ها و تنظیمات را
// می‌خواند و به آن می‌دهد. همه‌ی مصرف‌کننده‌های محاسبه‌ی روز (API پنل، Mini App، بات، Jobها) از اینجا می‌گیرند.
//
// دو سطح خروجی:
//   computeRecordDay(record, opts)  ⇒ خروجی کامل computeDay ({ expected, workedGross, break, effective, late, ... })
//   summarizeRecord / summarizeRange ⇒ همان شکل قدیمی workHours (effectiveMinutes, lateMinutes, ...) تا قرارداد
//                                      JSON پنل/Mini App/بات و فرانت‌اند بدون تغییر بماند.
//
// timezone از تنظیمات (settings.timezone) می‌آید، نه ساعت سیستم‌عامل. now قابل تزریق است (رکورد باز تا now حساب می‌شود).

const settingsRepository = require('../repositories/settingsRepository');
const breakRepository = require('../repositories/breakRepository');
const { computeDay } = require('./computeDay');

// تنظیمات مؤثر + منطقه‌ی زمانی. برای حلقه روی چند رکورد یک‌بار بگیرید و با { context } بدهید تا هر رکورد دوباره DB نخواند.
function loadContext() {
  const settings = settingsRepository.getAll();
  return { settings, timezone: settings.timezone };
}

// خروجی کامل computeDay برای یک رکورد attendance_records (یا null).
// opts: { now, context } — now پیش‌فرض الان؛ context خروجی loadContext().
function computeRecordDay(record, opts = {}) {
  const ctx = opts.context || loadContext();
  // مثل قبل: بدون ورود، استراحتی خوانده نمی‌شود
  const breaks = record && record.check_in_time ? breakRepository.listByAttendanceRecord(record.id) : [];
  return computeDay({ record, breaks, settings: ctx.settings, now: opts.now, timezone: ctx.timezone });
}

// تبدیل خروجی computeDay به شکل قدیمی summarizeRecord (ترتیب کلیدها هم همان است ⇒ JSON یکسان)
function toLegacySummary(day) {
  return {
    effectiveMinutes: day.effective,
    lateMinutes: day.late,
    earlyLeaveMinutes: day.earlyLeave,
    overtimeMinutes: day.overtime,
    isOpen: day.isOpen,
  };
}

function emptySummary() {
  return { effectiveMinutes: null, lateMinutes: 0, earlyLeaveMinutes: 0, overtimeMinutes: 0, isOpen: false };
}

// خلاصه‌ی یک رکورد با شکل قدیمی. رکورد با زمان خراب (computeDay ⇒ RangeError) نباید کل یک route/Job را بشکند:
// لاگ می‌شود و خلاصه‌ی خالی برمی‌گردد (تحمل کامل داده‌ی خراب با پرچم‌ها در S3-4b). خطاهای دیگر پرتاب می‌شوند.
function summarizeRecord(record, opts = {}) {
  try {
    const day = computeRecordDay(record, opts);
    // S3-4b: زمان خراب دیگر exception نیست و با پرچم invalid_time می‌آید؛ مثل قبل لاگ می‌شود و خلاصه‌ی خالی/جزئی برمی‌گردد
    if (day.flags.includes('invalid_time')) console.error(`[dayService] رکورد ${record && record.id} داده‌ی زمانی نامعتبر دارد (پرچم invalid_time).`);
    return toLegacySummary(day);
  } catch (err) {
    if (!(err instanceof RangeError)) throw err;
    console.error(`[dayService] رکورد ${record && record.id} داده‌ی زمانی نامعتبر دارد؛ خلاصه‌ی خالی برگردانده شد:`, err.message);
    return emptySummary();
  }
}

// جمع‌بندی چند رکورد (معادل قبلی summarizeRange؛ برای /report و /team_report و گزارش‌ها)
function summarizeRange(records, opts = {}) {
  const context = opts.context || loadContext();
  let totalEffective = 0;
  let lateCount = 0;
  let earlyLeaveCount = 0;
  let incompleteCount = 0;

  for (const record of records) {
    const summary = summarizeRecord(record, { ...opts, context });
    if (summary.effectiveMinutes) totalEffective += summary.effectiveMinutes;
    if (summary.lateMinutes > 0) lateCount += 1;
    if (summary.earlyLeaveMinutes > 0) earlyLeaveCount += 1;
    if (record.status === 'incomplete') incompleteCount += 1;
  }

  return { totalEffective, lateCount, earlyLeaveCount, incompleteCount, dayCount: records.length };
}

module.exports = { loadContext, computeRecordDay, summarizeRecord, summarizeRange, toLegacySummary };

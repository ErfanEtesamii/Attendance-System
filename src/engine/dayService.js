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
const shiftsRepository = require('../repositories/shiftsRepository');
const overtimeApprovalRepository = require('../repositories/overtimeApprovalRepository');
const { computeDay } = require('./computeDay');

// تنظیمات مؤثر + منطقه‌ی زمانی (+ کش شیفت کاربران، S3-6b). برای حلقه روی چند رکورد یک‌بار بگیرید و با { context } بدهید
// تا هر رکورد دوباره DB نخواند. context ساخته‌شده‌ی دستی (فقط { settings, timezone }) هم معتبر است؛ فقط کش نخواهد داشت.
function loadContext() {
  const settings = settingsRepository.getAll();
  return { settings, timezone: settings.timezone, shiftCache: new Map() };
}

// شیفت کاربر رکورد (S3-6b): opts.shift صریح (null = «بدون شیفت») اولویت دارد؛ وگرنه از users.shift_id. بدون شیفت ⇒ null ⇒ تنظیمات سراسری.
function shiftForRecord(record, ctx, opts) {
  if (opts.shift !== undefined) return opts.shift;
  if (!record || record.user_id === undefined || record.user_id === null) return null;
  const cache = ctx.shiftCache;
  if (cache && cache.has(record.user_id)) return cache.get(record.user_id);
  const shift = shiftsRepository.findByUserId(record.user_id);
  if (cache) cache.set(record.user_id, shift);
  return shift;
}

// خروجی کامل computeDay برای یک رکورد attendance_records (یا null).
// opts: { now, context, shift } — now پیش‌فرض الان؛ context خروجی loadContext()؛ shift (اختیاری) شیفت صریح به‌جای شیفت منتسب به کاربر.
function computeRecordDay(record, opts = {}) {
  const ctx = opts.context || loadContext();
  // مثل قبل: بدون ورود، استراحتی خوانده نمی‌شود
  const breaks = record && record.check_in_time ? breakRepository.listByAttendanceRecord(record.id) : [];
  const shift = record && record.check_in_time ? shiftForRecord(record, ctx, opts) : null;
  return computeDay({ record, breaks, settings: ctx.settings, now: opts.now, timezone: ctx.timezone, shift });
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

// ---------- سقف ماهانه‌ی اضافه‌کاری (S3-5b) ----------
// عمداً بیرون از computeDay (تابع خالصِ «یک روز») است: سقف ماهانه به مجموع چند روز بستگی دارد.
// ورودی/خروجی هر دو «دقیقه‌ی معادل قابل‌پرداخت» (overtimePayable، پس از آستانه/گرد‌کردن/ضریب) هستند.

// برش مجموع تجمعی: payables به ترتیب زمانی (قدیمی‌ترین اول)؛ cap = سقف ماه (۰ = بدون سقف).
// هر روز min(مقدار روز، باقی‌مانده‌ی سقف) می‌گیرد؛ روزی که سقف را رد کند فقط باقی‌مانده را می‌گیرد (بدون گرد‌کردن دوباره)
// و روزهای بعد ۰ می‌شوند. مجموع دقیقاً برابر سقف ⇒ هیچ برشی نیست. ورودی تغییر نمی‌کند؛ آرایه‌ی جدید برمی‌گردد.
function capMonthlyOvertime(payables, cap) {
  if (!Array.isArray(payables)) throw new TypeError('payables باید آرایه باشد.');
  if (typeof cap !== 'number' || !Number.isFinite(cap) || cap < 0) throw new RangeError('سقف ماهانه باید عدد ≥ ۰ باشد.');
  for (const p of payables) {
    if (typeof p !== 'number' || !Number.isFinite(p) || p < 0) throw new RangeError('هر مقدار اضافه‌کاری قابل‌پرداخت باید عدد ≥ ۰ باشد.');
  }
  if (cap === 0) return payables.slice();
  let remaining = cap;
  return payables.map((p) => {
    const allowed = Math.min(p, remaining);
    remaining -= allowed;
    return allowed;
  });
}

// ---------- تأیید اضافه‌کاری (S3-5c) ----------
// وضعیت تأیید یک روز (خالص). requiresApproval از تنظیم overtimeRequiresApproval؛ payable = overtimePayable همان روز؛
// decision = ردیف overtime_approvals یا undefined.
//   not_required  تأیید لازم نیست (تنظیم خاموش) ⇒ همه‌ی payable حساب می‌شود
//   none          تأیید لازم است ولی چیزی برای تأیید نیست (payable ۰ و تصمیمی ثبت نشده)
//   pending       تأیید لازم است و هنوز تصمیمی نیست ⇒ خارج از payable
//   approved / rejected   تصمیم ثبت‌شده (ردشده خارج از payable)
function approvalStatusOf(requiresApproval, payable, decision) {
  if (!requiresApproval) return 'not_required';
  if (decision) return decision.status;
  return payable > 0 ? 'pending' : 'none';
}

// قابل‌پرداخت پس از اعمال تأیید: معلق و ردشده ۰
function eligiblePayable(payable, status) {
  return status === 'pending' || status === 'rejected' ? 0 : payable;
}

// اضافه‌کاری قابل‌پرداختِ یک ماه برای یک کاربر. records = رکوردهای attendance_records «همان کاربر و همان ماه»؛
// تعیین مرز ماه (شمسی/میلادی) با فراخواننده است (S5-2a)، نه این تابع. ترتیب ورودی مهم نیست: بر اساس record_date (سپس id) مرتب می‌شود.
// ترتیب مراحل: payable روزانه (computeDay) ⇒ حذف معلق/ردشده (S3-5c، فقط وقتی overtimeRequiresApproval روشن است) ⇒ سقف ماهانه (S3-5b).
// opts: { now, context, capMinutes } — capMinutes اگر نباشد از تنظیم overtimeMonthlyCapMinutes می‌آید.
// خروجی: { cap, requiresApproval,
//          days: [{ recordId, recordDate, overtime, overtimePayableDaily, approvalStatus, overtimePayableEligible, overtimePayable }],
//          totalOvertime, totalPayableDaily (پیش از تأیید و سقف)، pendingMinutes، rejectedMinutes (payable روزانه‌ی روزهای معلق/ردشده)،
//          totalEligible (پس از تأیید)، totalPayable (پس از سقف)، clippedMinutes = totalEligible − totalPayable }
function computeMonthOvertime(records, opts = {}) {
  const list = Array.isArray(records) ? records.filter(Boolean) : [];
  if (new Set(list.map((r) => r.user_id)).size > 1) throw new RangeError('رکوردهای یک ماه باید مال یک کاربر باشند (سقف ماهانه برای هر کاربر جدا حساب می‌شود).');
  const context = opts.context || loadContext();
  const cap = opts.capMinutes === undefined ? context.settings.overtimeMonthlyCapMinutes : opts.capMinutes;
  const requiresApproval = context.settings.overtimeRequiresApproval === true;
  const sorted = list.slice().sort((a, b) => (a.record_date < b.record_date ? -1 : a.record_date > b.record_date ? 1 : (a.id || 0) - (b.id || 0)));
  const dayResults = sorted.map((record) => computeRecordDay(record, { ...opts, context }));
  const daily = dayResults.map((d) => d.overtimePayable);
  const decisions = requiresApproval ? overtimeApprovalRepository.mapByRecordIds(sorted.map((r) => r.id)) : new Map();
  const statuses = sorted.map((record, i) => approvalStatusOf(requiresApproval, daily[i], decisions.get(record.id)));
  const eligible = daily.map((p, i) => eligiblePayable(p, statuses[i]));
  const capped = capMonthlyOvertime(eligible, cap);
  const sum = (arr) => arr.reduce((t, v) => t + v, 0);
  const totalEligible = sum(eligible);
  const totalPayable = sum(capped);
  return {
    cap,
    requiresApproval,
    days: sorted.map((record, i) => ({
      recordId: record.id,
      recordDate: record.record_date,
      overtime: dayResults[i].overtime,
      overtimePayableDaily: daily[i],
      approvalStatus: statuses[i],
      overtimePayableEligible: eligible[i],
      overtimePayable: capped[i],
    })),
    totalOvertime: sum(dayResults.map((d) => d.overtime)),
    totalPayableDaily: sum(daily),
    pendingMinutes: sum(daily.filter((_, i) => statuses[i] === 'pending')),
    rejectedMinutes: sum(daily.filter((_, i) => statuses[i] === 'rejected')),
    totalEligible,
    totalPayable,
    clippedMinutes: totalEligible - totalPayable,
  };
}

module.exports = { loadContext, computeRecordDay, summarizeRecord, summarizeRange, toLegacySummary, capMonthlyOvertime, computeMonthOvertime, approvalStatusOf, eligiblePayable };

// ledger مانده‌ی مرخصی (S4-9a): محاسبه‌ی مانده + تنظیم استحقاق/انتقالی + تعدیل دستی، همه به «دقیقه».
//   remaining = entitled + carriedOver + adjustments − used
//   used = مجموع duration_minutes درخواست‌های approved همان نوع که start_date‌شان در همان سال شمسی است (سالِ درخواست = سالِ شروع).
// هیچ عدد قانونی/تجاری hard-code نیست: استحقاق را ادمین/hr می‌دهد و سیاست‌های مانده (سقف انتقال، block|warn|allow_negative) در S4-9b است.
// S4-9b: استحقاقِ پیش‌فرض (تنظیم leaveDefaultEntitlementMinutes) فقط وقتی به‌کار می‌رود که ردیف صریح (leave_balances) برای کاربر/نوع/سال نیست؛ سقف انتقالی
// (leaveCarryOverCapMinutes) هنگام ثبت انتقالی اعمال می‌شود؛ سیاست مانده (leaveBalancePolicy) را checkRequest ارزیابی می‌کند (اعمالش در S4-10a).
// فقط نوع‌هایی که countsAgainstBalance دارند ledger دارند؛ نوعِ بدون کسر ⇒ { tracked: false }.
// مانده می‌تواند منفی باشد؛ جلوگیری از آن سیاست S4-9b/S4-10a است، نه ledger.
// تنظیم استحقاق و تعدیل «با دلیل و audit» ثبت می‌شوند (auditRepository.logChange؛ entityType = leave_balance).

const leaveBalanceRepository = require('../repositories/leaveBalanceRepository');
const leaveTypesRepository = require('../repositories/leaveTypesRepository');
const usersRepository = require('../repositories/usersRepository');
const auditRepository = require('../repositories/auditRepository');
const settingsRepository = require('../repositories/settingsRepository');
const shiftsRepository = require('../repositories/shiftsRepository');
const { jalaliYearToDateRange } = require('../utils/jalali');
const { dayLengthMinutes, formatMinutes, evaluatePolicy, FALLBACK_DAY_MINUTES } = require('../utils/leaveBalanceFormat');

const MAX_MINUTES = 100000000; // فقط محافظ داده‌ی خراب (کران فنی)، نه قاعده‌ی تجاری
const fail = (code, error) => ({ ok: false, code, error });
const isMinutes = (v, { min = 0 } = {}) => Number.isSafeInteger(v) && v >= min && v <= MAX_MINUTES;

// ورودی مشترک: کاربر، نوع (باید کسر از مانده داشته باشد) و سال ⇒ { ok, user, type } یا خطا
function resolveKey({ userId, leaveTypeId, jalaliYear }) {
  if (!Number.isInteger(jalaliYear) || jalaliYear < 1300 || jalaliYear > 1800) return fail('INVALID_YEAR', 'سال شمسی نامعتبر است.');
  const user = Number.isInteger(userId) ? usersRepository.findById(userId) : null;
  if (!user) return fail('USER_NOT_FOUND', 'کاربر پیدا نشد.');
  const type = Number.isInteger(leaveTypeId) ? leaveTypesRepository.findById(leaveTypeId) : null;
  if (!type) return fail('TYPE_NOT_FOUND', 'نوع مرخصی پیدا نشد.');
  return { ok: true, user, type };
}

function requireTracked(type) {
  return type.countsAgainstBalance ? null : fail('NOT_TRACKED', `نوع «${type.title}» از مانده کسر نمی‌شود؛ ledger ندارد.`);
}

// مانده‌ی یک (کاربر، نوع، سال). ⇒ { ok:true, tracked:false, ... } برای نوعِ بدون کسر، وگرنه { ok:true, tracked:true, entitled, carriedOver,
// adjustments, used, remaining, usedCount, missingDuration } (همه دقیقه؛ missingDuration = درخواست approved بدون duration_minutes که در used نیامده).
function getBalance(key) {
  const k = resolveKey(key);
  if (!k.ok) return k;
  const { type } = k;
  const base = { ok: true, userId: key.userId, leaveTypeId: type.id, jalaliYear: key.jalaliYear };
  if (!type.countsAgainstBalance) return { ...base, tracked: false };
  const row = leaveBalanceRepository.findBalance(key.userId, type.id, key.jalaliYear);
  const range = jalaliYearToDateRange(key.jalaliYear);
  const usage = leaveBalanceRepository.sumApprovedUsage(key.userId, type.id, range.from, range.to);
  const pendingUsage = leaveBalanceRepository.sumApprovedUsage(key.userId, type.id, range.from, range.to, 'pending');
  const entitled = row ? row.entitledMinutes : settingsRepository.getAll().leaveDefaultEntitlementMinutes;
  const carriedOver = row ? row.carriedOverMinutes : 0;
  const adjustments = leaveBalanceRepository.sumAdjustments(key.userId, type.id, key.jalaliYear);
  return {
    ...base,
    tracked: true,
    entitled,
    carriedOver,
    adjustments,
    used: usage.minutes,
    remaining: entitled + carriedOver + adjustments - usage.minutes,
    usedCount: usage.count,
    pending: pendingUsage.minutes, // S4-10a: دقیقه‌ی درخواست‌های «در انتظار» (در remaining نمی‌آید؛ checkRequest آن را رزرو می‌کند)
    missingDuration: usage.missingDuration,
  };
}

const view = (row) => (row ? { entitledMinutes: row.entitledMinutes, carriedOverMinutes: row.carriedOverMinutes } : null);

// تنظیم استحقاق و/یا انتقالی سال. حداقل یکی از دو مقدار؛ دلیل اجباری؛ audit با before/after.
// input: { userId, leaveTypeId, jalaliYear, entitledMinutes?, carriedOverMinutes?, actor, reason, ip? }
function setEntitlement(input = {}) {
  const k = resolveKey(input);
  if (!k.ok) return k;
  const untracked = requireTracked(k.type);
  if (untracked) return untracked;
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (!reason) return fail('REASON_REQUIRED', 'ذکر دلیل الزامی است.');
  const { entitledMinutes, carriedOverMinutes } = input;
  if (entitledMinutes === undefined && carriedOverMinutes === undefined) return fail('NOTHING_TO_SET', 'حداقل یکی از استحقاق یا انتقالی باید داده شود.');
  if (entitledMinutes !== undefined && !isMinutes(entitledMinutes)) return fail('INVALID_MINUTES', 'استحقاق باید عدد صحیح ≥ ۰ (دقیقه) باشد.');
  if (carriedOverMinutes !== undefined && !isMinutes(carriedOverMinutes)) return fail('INVALID_MINUTES', 'انتقالی باید عدد صحیح ≥ ۰ (دقیقه) باشد.');

  const cap = settingsRepository.getAll().leaveCarryOverCapMinutes;
  if (carriedOverMinutes !== undefined && cap > 0 && carriedOverMinutes > cap) {
    return fail('CARRY_OVER_EXCEEDS_CAP', `مقدار انتقالی از سقف مجاز (${cap} دقیقه) بیشتر است.`);
  }
  const before = leaveBalanceRepository.findBalance(input.userId, k.type.id, input.jalaliYear);
  const row = leaveBalanceRepository.upsertBalance({ userId: input.userId, leaveTypeId: k.type.id, jalaliYear: input.jalaliYear, entitledMinutes, carriedOverMinutes });
  auditRepository.logChange({
    actor: input.actor === undefined ? null : input.actor,
    action: 'leave_balance_entitlement_set',
    entityType: 'leave_balance',
    entityId: row.id,
    before: view(before),
    after: view(row),
    reason,
    ip: input.ip || null,
    meta: { targetUserId: input.userId, leaveTypeId: k.type.id, jalaliYear: input.jalaliYear },
  });
  return { ok: true, balance: row };
}

// تعدیل دستی امضادار (+ افزایش، − کاهش) با دلیل اجباری. فقط‌افزودنی؛ اصلاح = تعدیل معکوس.
// input: { userId, leaveTypeId, jalaliYear, minutes, actor, reason, ip? }
function addAdjustment(input = {}) {
  const k = resolveKey(input);
  if (!k.ok) return k;
  const untracked = requireTracked(k.type);
  if (untracked) return untracked;
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (!reason) return fail('REASON_REQUIRED', 'ذکر دلیل الزامی است.');
  if (!Number.isSafeInteger(input.minutes) || input.minutes === 0 || Math.abs(input.minutes) > MAX_MINUTES) {
    return fail('INVALID_MINUTES', 'مقدار تعدیل باید عدد صحیح غیرصفر (دقیقه؛ مثبت = افزایش، منفی = کاهش) باشد.');
  }
  const actorId = input.actor === undefined || input.actor === null ? null : typeof input.actor === 'object' ? input.actor.id : input.actor;
  const adjustment = leaveBalanceRepository.addAdjustment({ userId: input.userId, leaveTypeId: k.type.id, jalaliYear: input.jalaliYear, minutes: input.minutes, reason, actorId });
  auditRepository.logChange({
    actor: actorId,
    action: 'leave_balance_adjusted',
    entityType: 'leave_balance_adjustment',
    entityId: adjustment.id,
    before: null,
    after: { minutes: adjustment.minutes },
    reason,
    ip: input.ip || null,
    meta: { targetUserId: input.userId, leaveTypeId: k.type.id, jalaliYear: input.jalaliYear },
  });
  return { ok: true, adjustment, balance: getBalance(input) };
}

function listAdjustments(key) {
  const k = resolveKey(key);
  if (!k.ok) return k;
  return { ok: true, adjustments: leaveBalanceRepository.listAdjustments(key.userId, k.type.id, key.jalaliYear) };
}

// طول «روز کاری» کاربر (دقیقه) برای تبدیل نمایش دقیقه ⇒ روز/ساعت: شیفت منتسب به کاربر، وگرنه ساعت کاری سراسری (تنظیمات)؛ نامعتبر ⇒ ۴۸۰.
function workDayMinutesOf(user) {
  const shift = user ? shiftsRepository.findByUserId(user.id) : null;
  const settings = settingsRepository.getAll();
  const len = shift ? dayLengthMinutes(shift.startTime, shift.endTime) : dayLengthMinutes(settings.workDayStart, settings.workDayEnd);
  return len || FALLBACK_DAY_MINUTES;
}

// getBalance + نمایش خوانا (روز/ساعت/دقیقه بر پایه‌ی روز کاری همان کاربر) + سیاست جاری. فیلدهای دقیقه‌ای همان‌اند (منبع حقیقت).
function describeBalance(key) {
  const b = getBalance(key);
  if (!b.ok || !b.tracked) return b;
  const user = usersRepository.findById(key.userId);
  const dayMinutes = workDayMinutesOf(user);
  const display = {};
  for (const f of ['entitled', 'carriedOver', 'adjustments', 'used', 'remaining']) display[f] = formatMinutes(b[f], dayMinutes);
  return { ...b, dayMinutes, display, policy: settingsRepository.getAll().leaveBalancePolicy };
}

// آیا درخواستی به مدت requestedMinutes با سیاست جاری مجاز است؟ (فقط ارزیابی؛ بدون نوشتن). نوعِ بدون مانده ⇒ همیشه مجاز.
// ⇒ { ok, tracked, policy, allowed, warn, shortfall, remainingAfter, remaining }
function checkRequest(key, requestedMinutes) {
  const b = getBalance(key);
  if (!b.ok) return b;
  if (!b.tracked) return { ok: true, tracked: false, allowed: true, warn: false, shortfall: 0 };
  const policy = settingsRepository.getAll().leaveBalancePolicy;
  // درخواست‌های در انتظار همین نوع/سال رزرو حساب می‌شوند تا چند درخواست پشت‌سرهم مانده را دور نزنند
  const available = b.remaining - b.pending;
  return { ok: true, tracked: true, policy, remaining: b.remaining, pending: b.pending, available, ...evaluatePolicy(policy, available, requestedMinutes) };
}

module.exports = { getBalance, describeBalance, checkRequest, workDayMinutesOf, setEntitlement, addAdjustment, listAdjustments };

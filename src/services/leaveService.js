// leaveService (S4-10a): «تنها دروازه‌ی ثبت مرخصی/مأموریت». validate = همه‌ی قواعد بدون نوشتن؛ create = validate + ذخیره.
// هنوز هیچ کانالی (بات، Mini App، پنل) این سرویس را صدا نمی‌زند؛ اتصال در S4-10b..d است. سرویس عمداً audit/اعلان نمی‌نویسد
// (هر کانال action و اعلان خودش را دارد)؛ فقط قواعد و ذخیره.
//
// ترتیب قواعد:
//   ۱) leaveDurationService.prepare: کاربر، نوع، واحد مجاز، مدت کاری با تقویم/شیفت، «تداخل» با درخواست‌های pending/approved (S4-8a) — خطا ⇒ توقف.
//   ۲) گذشته/آینده/پیش‌اطلاع (تنظیمات leaveAllowPastRequests، leaveMaxPastDays، leaveMaxFutureDays، leaveMinNoticeHours) بر پایه‌ی تاریخ شروع و «امروز به وقت شرکت».
//   ۳) سقف روز متوالی نوع (max_consecutive_days): بر پایه‌ی «روزهای تقویمی» بازه (آخر هفته/تعطیلی وسط بازه هم شمرده می‌شود)، نه فقط روزهای کاری.
//   ۴) سیاست مانده (leaveBalancePolicy) برای نوع‌های counts_against_balance: بر پایه‌ی مانده منهای درخواست‌های در انتظار همان نوع/سال (رزرو).
//      block ⇒ خطای INSUFFICIENT_BALANCE؛ warn ⇒ مجاز با warning LOW_BALANCE؛ allow_negative ⇒ مجاز و بی‌صدا. سالِ درخواست = سال شمسیِ تاریخ شروع (مثل ledger).
// opts: { now: Date (تزریق برای تست)، skip: آرایه‌ای از 'past' | 'future' | 'notice' | 'maxConsecutive' | 'balance' (برای ثبت توسط مدیر، S4-10d) }
// ⇒ { ok, errors: [{code,error,...}], warnings: [{code,...}], value, type, durationMinutes, days, conflicts }

const settingsRepository = require('../repositories/settingsRepository');
const leaveRepository = require('../repositories/leaveRepository');
const leaveDurationService = require('./leaveDurationService');
const leaveBalanceService = require('./leaveBalanceService');
const { dayDiff } = require('../utils/shiftDay');
const { jalaliYearOfDateString } = require('../utils/jalali');
const { todayInZone, zonedTimeToUtc } = require('../utils/time');

const SKIPPABLE = ['past', 'future', 'notice', 'maxConsecutive', 'balance'];

function validate(input = {}, opts = {}) {
  const skip = new Set(opts.skip || []);
  for (const s of skip) if (!SKIPPABLE.includes(s)) throw new RangeError(`skip نامعتبر است: ${s}`);
  const now = opts.now instanceof Date ? opts.now : new Date();

  const prep = leaveDurationService.prepare(input);
  if (!prep.ok) return { ...prep, warnings: [] };

  const settings = settingsRepository.getAll();
  const errors = [];
  const warnings = [];
  const { value, type } = prep;
  const today = todayInZone(settings.timezone, now);
  const startOffsetDays = dayDiff(value.startDate, today); // منفی = گذشته

  if (startOffsetDays < 0 && !skip.has('past')) {
    if (!settings.leaveAllowPastRequests) errors.push({ code: 'PAST_NOT_ALLOWED', error: 'ثبت درخواست برای تاریخ گذشته مجاز نیست.' });
    else if (settings.leaveMaxPastDays > 0 && -startOffsetDays > settings.leaveMaxPastDays) {
      errors.push({ code: 'PAST_TOO_FAR', error: `تاریخ شروع بیش از ${settings.leaveMaxPastDays} روز در گذشته است.` });
    }
  }
  if (startOffsetDays > 0 && !skip.has('future') && settings.leaveMaxFutureDays > 0 && startOffsetDays > settings.leaveMaxFutureDays) {
    errors.push({ code: 'FUTURE_TOO_FAR', error: `تاریخ شروع بیش از ${settings.leaveMaxFutureDays} روز در آینده است.` });
  }
  if (startOffsetDays >= 0 && !skip.has('notice') && settings.leaveMinNoticeHours > 0) {
    const startAt = zonedTimeToUtc(value.startDate, value.unit === 'hour' ? value.startTime : '00:00', settings.timezone);
    const noticeHours = (startAt.getTime() - now.getTime()) / 3600000;
    if (noticeHours < settings.leaveMinNoticeHours) {
      errors.push({ code: 'INSUFFICIENT_NOTICE', error: `حداقل پیش‌اطلاع ${settings.leaveMinNoticeHours} ساعت است.` });
    }
  }

  const spanDays = dayDiff(value.endDate, value.startDate) + 1;
  if (!skip.has('maxConsecutive') && type.maxConsecutiveDays !== null && spanDays > type.maxConsecutiveDays) {
    errors.push({ code: 'MAX_CONSECUTIVE_EXCEEDED', error: `نوع «${type.title}» حداکثر ${type.maxConsecutiveDays} روز متوالی مجاز است.`, maxConsecutiveDays: type.maxConsecutiveDays, requestedDays: spanDays });
  }

  let balance = null;
  if (type.countsAgainstBalance && !skip.has('balance')) {
    const key = { userId: input.userId, leaveTypeId: type.id, jalaliYear: jalaliYearOfDateString(value.startDate) };
    const check = leaveBalanceService.checkRequest(key, prep.durationMinutes);
    if (check.ok && check.tracked) {
      balance = { policy: check.policy, remaining: check.remaining, pending: check.pending, available: check.available, shortfall: check.shortfall, remainingAfter: check.remainingAfter };
      if (!check.allowed) errors.push({ code: 'INSUFFICIENT_BALANCE', error: 'مانده‌ی مرخصی برای این درخواست کافی نیست.', shortfall: check.shortfall });
      else if (check.warn) warnings.push({ code: 'LOW_BALANCE', shortfall: check.shortfall, remainingAfter: check.remainingAfter });
    }
  }

  return { ok: errors.length === 0, errors, warnings, value, type, durationMinutes: prep.durationMinutes, days: prep.days, conflicts: [], balance };
}

// validate + ذخیره (status = pending). خطا ⇒ هیچ‌چیز نوشته نمی‌شود. input: همان validate + reason
function create(input = {}, opts = {}) {
  const result = validate(input, opts);
  if (!result.ok) return result;
  const { value, type } = result;
  const request = leaveRepository.createLeaveRequest({
    userId: input.userId,
    startDate: value.startDate,
    endDate: value.endDate,
    leaveTypeId: type.id,
    reason: input.reason,
    unit: value.unit,
    halfDayPart: value.halfDayPart,
    startTime: value.startTime,
    endTime: value.endTime,
    durationMinutes: result.durationMinutes,
  });
  return { ...result, request };
}

module.exports = { validate, create, SKIPPABLE };

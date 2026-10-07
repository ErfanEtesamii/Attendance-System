// S4-8a: سرویس «واحد و مدت مرخصی» = خواندن از repositoryها (کاربر، تقویم/شیفت/تعطیلات، نوع، درخواست‌های موجود) + منطق خالص leaveUnits.
// هنوز هیچ کانالی (بات، Mini App، پنل) این سرویس را صدا نمی‌زند؛ اتصال در S4-10a (leaveService) و S4-8b (اثر در موتور) است.
//
// prepare(input) ورودی را اعتبارسنجی می‌کند، مدت کاری را با تقویم/شیفت «همان کاربر» حساب می‌کند و تداخل با درخواست‌های pending/approved را می‌سنجد.
// هیچ‌چیزی نمی‌نویسد. نتیجه: { ok, errors:[{code,error,...}], value, durationMinutes, days, conflicts }.

const usersRepository = require('../repositories/usersRepository');
const settingsRepository = require('../repositories/settingsRepository');
const holidaysRepository = require('../repositories/holidaysRepository');
const leaveRepository = require('../repositories/leaveRepository');
const { getCalendarDay } = require('../engine/calendarService');
const { validateUnitInput, computeDuration, overlapDates } = require('../utils/leaveUnits');

// تقویم روزِ کاربر با کش در همین فراخوانی (شیفت یک‌بار خوانده می‌شود)
function makeDayResolver(user) {
  const settings = settingsRepository.getAll();
  const shift = user ? require('../repositories/shiftsRepository').findByUserId(user.id) : null;
  const cache = new Map();
  return (date) => {
    if (!cache.has(date)) cache.set(date, getCalendarDay(user, date, { settings, shift, holidays: holidaysRepository.listByDate(date) }));
    return cache.get(date);
  };
}

const rowToValue = (r) => ({
  unit: r.unit || 'day',
  startDate: r.start_date,
  endDate: r.end_date,
  halfDayPart: r.half_day_part || null,
  startTime: r.start_time || null,
  endTime: r.end_time || null,
});

// input: { userId, startDate, endDate, unit?, halfDayPart?, startTime?, endTime?, leaveTypeId? | leaveType?, excludeRequestId? }
function prepare(input = {}) {
  const user = usersRepository.findById(input.userId);
  if (!user) return { ok: false, errors: [{ code: 'USER_NOT_FOUND', error: 'کاربر پیدا نشد.' }], conflicts: [] };

  const checked = validateUnitInput(input);
  if (!checked.ok) return { ok: false, errors: checked.errors, conflicts: [] };
  const value = checked.value;

  let type;
  try {
    type = leaveRepository.resolveLeaveType({ leaveType: input.leaveType, leaveTypeId: input.leaveTypeId });
  } catch (err) {
    return { ok: false, errors: [{ code: 'INVALID_TYPE', error: err.message }], conflicts: [] };
  }
  if (!type.allowedUnits.includes(value.unit)) {
    return { ok: false, errors: [{ code: 'UNIT_NOT_ALLOWED', error: `نوع «${type.title}» این واحد را نمی‌پذیرد.` }], conflicts: [] };
  }

  const getDay = makeDayResolver(user);
  const duration = computeDuration(value, getDay);
  if (!duration.ok) return { ok: false, errors: [{ code: duration.code, error: duration.error }], conflicts: [] };

  const conflicts = [];
  for (const row of leaveRepository.listActiveInRange(user.id, value.startDate, value.endDate, { excludeId: input.excludeRequestId })) {
    const dates = overlapDates(value, rowToValue(row), getDay);
    if (dates.length) conflicts.push({ requestId: row.id, status: row.status, unit: row.unit, dates });
  }
  if (conflicts.length) {
    return {
      ok: false,
      errors: [{ code: 'OVERLAP', error: 'با یک درخواست مرخصی/مأموریت دیگرِ همین کارمند (در انتظار یا تأییدشده) تداخل دارد.' }],
      value, durationMinutes: duration.minutes, days: duration.days, conflicts,
    };
  }
  return { ok: true, errors: [], value, type, durationMinutes: duration.minutes, days: duration.days, conflicts: [] };
}

// مدت درخواست‌های ذخیره‌شده‌ای که duration_minutes ندارند (قدیمی‌ها) را با تقویم/شیفتِ «فعلی» پر می‌کند. idempotent؛ ردیفی که محاسبه‌اش
// ناممکن است (مثلاً کاربرش روز کاری ندارد) NULL می‌ماند و در skipped می‌آید. ⇒ { updated, skipped }
function backfillMissingDurations({ limit = 500 } = {}) {
  let updated = 0;
  let skipped = 0;
  const resolvers = new Map();
  for (const row of leaveRepository.listMissingDuration({ limit })) {
    const user = usersRepository.findById(row.user_id);
    const value = validateUnitInput(rowToValue(row));
    if (!user || !value.ok) { skipped += 1; continue; }
    if (!resolvers.has(user.id)) resolvers.set(user.id, makeDayResolver(user));
    const d = computeDuration(value.value, resolvers.get(user.id));
    if (!d.ok) { skipped += 1; continue; }
    leaveRepository.setDuration(row.id, d.minutes);
    updated += 1;
  }
  return { updated, skipped };
}

module.exports = { prepare, backfillMissingDurations };

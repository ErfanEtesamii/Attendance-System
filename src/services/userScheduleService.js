// B2 (فاز ۱۲): برنامه‌ی کاری روزبه‌روز هر کارمند (override روز) — قواعد کسب‌وکار: اعتبارسنجی، اسکوپ نقش، قفل ماه بسته، audit.
// route ها فقط تبدیل HTTP؛ منطق اینجاست. خروجی همیشه { ok: true, ... } یا { ok: false, status, code, error } (هرگز exception برای خطای کاربر).
//
// اولویت محاسبه‌ی روز (در موتور: calendarService/dayService): override روز ← شیفت مؤثر (B1) ← تنظیمات سراسری.
// اسکوپ: admin همه‌ی کارمندان؛ manager فقط زیرمجموعه‌ی مستقیم خودش (manager_id)؛ hr فقط خواندن (مجوز در route)؛ employee هیچ.
const userDayScheduleRepository = require('../repositories/userDayScheduleRepository');
const usersRepository = require('../repositories/usersRepository');
const shiftsRepository = require('../repositories/shiftsRepository');
const monthClosuresRepository = require('../repositories/monthClosuresRepository');
const auditRepository = require('../repositories/auditRepository');
const settingsRepository = require('../repositories/settingsRepository');
const calendarService = require('../engine/calendarService');
const { dayNumber, addDays } = require('../utils/shiftDay');
const { sanitizeText } = require('../utils/sanitize');

const MAX_BULK_DAYS = 31;
const MAX_BULK_USERS = 50;
const MAX_RANGE_DAYS = 62; // سقف بازه‌ی GET (دو ماه شمسی)
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

const fail = (status, code, error) => ({ ok: false, status, code, error });
const isDate = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && dayNumber(d) !== null;

// نمای ردیف برای API/audit
function view(row) {
  if (!row) return null;
  return { date: row.schedule_date, kind: row.kind, startTime: row.start_time, endTime: row.end_time, note: row.note };
}

function canRead(actor, user) {
  if (actor.role === 'admin' || actor.role === 'hr') return true;
  if (actor.role === 'manager') return user.manager_id === actor.id;
  return actor.role === 'employee' && user.id === actor.id;
}
function canManage(actor, user) {
  if (actor.role === 'admin') return true;
  return actor.role === 'manager' && user.manager_id === actor.id;
}

function loadUser(actor, userId, check) {
  const id = Number(userId);
  const user = Number.isInteger(id) && id > 0 ? usersRepository.findById(id) : null;
  if (!user) return { error: fail(404, 'USER_NOT_FOUND', 'کارمند یافت نشد.') };
  if (!check(actor, user)) return { error: fail(403, 'FORBIDDEN', 'این کارمند خارج از دامنه‌ی دسترسی شماست.') };
  return { user };
}

// اعتبارسنجی یک برنامه‌ی روز ⇒ { value } | { error }. work: start/end الزامی (HH:MM)؛ پایان باید بعد از شروع باشد مگر شیفتِ مؤثر آن روز «شب» باشد.
function validateDay(userId, date, input) {
  const kind = input && input.kind;
  if (kind !== 'work' && kind !== 'off') return { error: fail(400, 'INVALID_KIND', '«kind» باید work یا off باشد.') };
  let note = null;
  if (input.note !== undefined && input.note !== null && String(input.note).trim() !== '') {
    note = sanitizeText(String(input.note)).trim();
    if (note.length > 200) return { error: fail(400, 'NOTE_TOO_LONG', 'یادداشت حداکثر ۲۰۰ نویسه است.') };
  }
  if (kind === 'off') return { value: { kind, startTime: null, endTime: null, note } };
  const { startTime, endTime } = input;
  if (typeof startTime !== 'string' || typeof endTime !== 'string' || !HHMM.test(startTime) || !HHMM.test(endTime)) {
    return { error: fail(400, 'INVALID_TIME', 'ساعت شروع و پایان الزامی و به شکل HH:MM است.') };
  }
  const s = toMin(startTime);
  const e = toMin(endTime);
  if (e === s) return { error: fail(400, 'INVALID_TIME', 'ساعت پایان نباید با شروع برابر باشد.') };
  if (e < s) {
    const base = shiftsRepository.shiftOn(userId, date);
    if (!(base && base.overnight)) return { error: fail(400, 'INVALID_TIME', 'ساعت پایان باید بعد از شروع باشد (فقط برای شیفت شب می‌تواند پس از نیمه‌شب باشد).') };
  }
  return { value: { kind, startTime, endTime, note } };
}

// قفل ماه بسته: روز داخل ماهِ بسته‌شده ⇒ ۴۰۹
function closedGuard(date) {
  return monthClosuresRepository.findClosedOverlapping(date, date).length > 0
    ? fail(409, 'MONTH_CLOSED', `روز ${date} در ماهِ بسته‌شده است؛ تغییر برنامه‌ی آن ممکن نیست.`)
    : null;
}

function logChange(actor, action, user, date, before, after, ip) {
  auditRepository.logEvent({
    userId: actor.id,
    action,
    ipAddress: ip,
    details: { source: 'admin_panel', targetUserId: user.id, date, changes: { schedule: { before: view(before), after: view(after) } } },
  });
}

function sameView(a, b) {
  return JSON.stringify(view(a)) === JSON.stringify(view(b));
}

// ثبت/ویرایش برنامه‌ی یک روز ⇒ { ok, changed, schedule }
function setDay(actor, userId, date, input, { ip } = {}) {
  if (!isDate(date)) return fail(400, 'INVALID_DATE', 'تاریخ باید YYYY-MM-DD معتبر باشد.');
  const { user, error } = loadUser(actor, userId, canManage);
  if (error) return error;
  const v = validateDay(user.id, date, input || {});
  if (v.error) return v.error;
  const locked = closedGuard(date);
  if (locked) return locked;
  const before = userDayScheduleRepository.get(user.id, date);
  const after = userDayScheduleRepository.upsert({ userId: user.id, date, ...v.value, createdBy: actor.id });
  const changed = !sameView(before, after);
  if (changed) logChange(actor, before ? 'user_day_schedule_updated' : 'user_day_schedule_set', user, date, before, after, ip);
  return { ok: true, changed, schedule: view(after) };
}

// حذف برنامه‌ی ویژه‌ی یک روز (برگشت به شیفت/سراسری) ⇒ { ok, removed }
function clearDay(actor, userId, date, { ip } = {}) {
  if (!isDate(date)) return fail(400, 'INVALID_DATE', 'تاریخ باید YYYY-MM-DD معتبر باشد.');
  const { user, error } = loadUser(actor, userId, canManage);
  if (error) return error;
  const locked = closedGuard(date);
  if (locked) return locked;
  const before = userDayScheduleRepository.get(user.id, date);
  if (!before) return { ok: true, removed: false };
  userDayScheduleRepository.remove(user.id, date);
  logChange(actor, 'user_day_schedule_removed', user, date, before, null, ip);
  return { ok: true, removed: true };
}

// ثبت گروهی: چند کارمند × بازه‌ی تاریخ (حداکثر ۳۱ روز، ۵۰ نفر). weekdays (اختیاری، ۰=یکشنبه…۶=شنبه) فقط همان روزهای هفته را می‌گیرد.
// اگر هر ترکیب (کاربر، روز) خطا بدهد (اسکوپ/ماه بسته/ساعت) آن مورد در results خطا می‌گیرد و بقیه اعمال می‌شود.
// ⇒ { ok, appliedCount, results: [{ userId, date, ok, changed?, error? }] }
function bulk(actor, input, { ip } = {}) {
  const { userIds, from, to, weekdays } = input || {};
  if (!input || (input.kind !== 'work' && input.kind !== 'off')) return fail(400, 'INVALID_KIND', '«kind» باید work یا off باشد.');
  if (!Array.isArray(userIds) || userIds.length === 0) return fail(400, 'INVALID_USERS', '«userIds» باید فهرست غیرخالی باشد.');
  const ids = [...new Set(userIds.map(Number))];
  if (ids.some((x) => !Number.isInteger(x) || x <= 0)) return fail(400, 'INVALID_USERS', 'شناسه‌ی کارمند نامعتبر است.');
  if (ids.length > MAX_BULK_USERS) return fail(400, 'TOO_MANY_USERS', `حداکثر ${MAX_BULK_USERS} کارمند در هر درخواست.`);
  if (!isDate(from) || !isDate(to) || to < from) return fail(400, 'INVALID_RANGE', 'بازه‌ی تاریخ نامعتبر است (from ≤ to، YYYY-MM-DD).');
  const span = dayNumber(to) - dayNumber(from) + 1;
  if (span > MAX_BULK_DAYS) return fail(400, 'RANGE_TOO_LONG', `حداکثر ${MAX_BULK_DAYS} روز در هر درخواست.`);
  if (weekdays !== undefined && (!Array.isArray(weekdays) || weekdays.some((w) => !Number.isInteger(w) || w < 0 || w > 6))) {
    return fail(400, 'INVALID_WEEKDAYS', '«weekdays» باید آرایه‌ای از ۰ تا ۶ باشد.');
  }
  const dates = [];
  for (let i = 0; i < span; i += 1) {
    const d = addDays(from, i);
    if (weekdays === undefined || weekdays.includes(calendarService.weekdayOf(d))) dates.push(d);
  }
  if (!dates.length) return fail(400, 'NO_DAYS', 'هیچ روزی با این فیلتر روز هفته در بازه نیست.');

  const results = [];
  for (const userId of ids) {
    for (const date of dates) {
      const r = setDay(actor, userId, date, input, { ip });
      results.push(r.ok ? { userId, date, ok: true, changed: r.changed } : { userId, date, ok: false, error: r.error, code: r.code });
    }
  }
  return { ok: true, appliedCount: results.filter((r) => r.ok && r.changed).length, results };
}

// فهرست روزبه‌روز یک کارمند در [from, to]: برنامه‌ی ویژه (اگر هست) + تقویم مؤثرِ همان روز (override ← شیفت ← سراسری).
// ⇒ { ok, userId, from, to, days: [{ date, schedule, effective: { isWorkingDay, kind, expectedStart, expectedEnd, source } }] }
function list(actor, userId, from, to) {
  if (!isDate(from) || !isDate(to) || to < from) return fail(400, 'INVALID_RANGE', 'بازه‌ی تاریخ نامعتبر است (from ≤ to، YYYY-MM-DD).');
  if (dayNumber(to) - dayNumber(from) + 1 > MAX_RANGE_DAYS) return fail(400, 'RANGE_TOO_LONG', `حداکثر ${MAX_RANGE_DAYS} روز در هر درخواست.`);
  const { user, error } = loadUser(actor, userId, canRead);
  if (error) return error;
  const settings = settingsRepository.getAll();
  const rows = new Map(userDayScheduleRepository.listRange(user.id, from, to).map((r) => [r.schedule_date, r]));
  const days = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const row = rows.get(d) || null;
    const cal = calendarService.getCalendarDay(user, d, { settings });
    const source = row ? 'override' : (shiftsRepository.shiftOn(user.id, d) ? 'shift' : 'global');
    days.push({ date: d, schedule: view(row), effective: { isWorkingDay: cal.isWorkingDay, kind: cal.kind, expectedStart: cal.expectedStart, expectedEnd: cal.expectedEnd, isHoliday: cal.isHoliday, holidayTitle: cal.holidayTitle, source } });
  }
  return { ok: true, userId: user.id, from, to, days };
}

module.exports = { setDay, clearDay, bulk, list, validateDay, MAX_BULK_DAYS, MAX_BULK_USERS };

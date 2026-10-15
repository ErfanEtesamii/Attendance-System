// D1 (فاز ۱۲): شمارش تأخیر ماهانه و مدل «اجازه‌ی ورود».
//
// قانون: اگر کارمند در یک ماه شمسی «بیش از N بار» (N = lateMonthlyLimit) تأخیر داشته باشد، ثبتِ ورودِ دیرِ بعدی نیاز به اجازه‌ی سرپرست دارد.
// تفسیر «بیش از ۳ بار»: بار اول تا سوم آزاد؛ وقتی lateCount ≥ N (سه تأخیرِ قطعی‌شده) گیت فعال می‌شود، یعنی «ورودِ چهارم به بعد» اجازه می‌خواهد.
//
// تعریف دقیق «تأخیر»: همان late > 0 خروجی computeDay (شیفتِ مؤثر B1، مهلت تأخیر، override روز B2، پنجره‌های مرخصی/مأموریت ساعتی).
//   • فقط روزهای قبل از «امروز» (به وقت شرکت) شمرده می‌شوند؛ تأخیرِ امروز که در حال ثبت است شمرده نمی‌شود.
//   • رکورد قطعی‌شده = روزِ گذشته‌ای که ورود دارد (حتی اگر خروج فراموش شده؛ تأخیر فقط به ورود وابسته است). رکورد با وضعیت leave/holiday
//     یا ورودِ نامعتبر شمرده نمی‌شود؛ روز غیرکاری/مرخصیِ تمام‌روز را خودِ computeDay late=۰ می‌دهد.
//   • مرز ماه = ماه شمسی (utils/jalali).
// این سرویس فقط «وضعیت گیت» و چرخه‌ی اجازه را مدیریت می‌کند؛ اعمال روی ثبت ورود (D2) و اعلان/UI (D3) بعداً.
// خروجی عملیات‌های کاربری: { ok: true, ... } یا { ok: false, status, code, error } (بدون exception برای خطای کاربر).
const attendanceRepository = require('../repositories/attendanceRepository');
const checkinPermissionRepository = require('../repositories/checkinPermissionRepository');
const settingsRepository = require('../repositories/settingsRepository');
const usersRepository = require('../repositories/usersRepository');
const dayService = require('../engine/dayService');
const { jalaliMonthRangeOf, jalaliPartsOfDateString } = require('../utils/jalali');
const { todayInZone } = require('../utils/time');
const { addDays } = require('../utils/shiftDay');
const { sanitizeText } = require('../utils/sanitize');

const fail = (status, code, error) => ({ ok: false, status, code, error });
const MAX_NOTE = 200;

// ---------- شمارش ----------

// تعداد روزهای تأخیرِ قطعی‌شده‌ی یک کارمند در ماه شمسی jalaliMonth = { jy, jm }
// ⇒ { count, days: [{ date, lateMinutes }], range: { from, to }, label }
function countLateInMonth(userId, jalaliMonth, { now = new Date(), settings = null, context = null } = {}) {
  const s = settings || settingsRepository.getAll();
  const range = jalaliMonthRangeOf(jalaliMonth.jy, jalaliMonth.jm); // RangeError برای ورودی نامعتبر
  const today = todayInZone(s.timezone, now);
  const last = addDays(today, -1) < range.to ? addDays(today, -1) : range.to; // فقط روزهای قبل از امروز
  const days = [];
  if (last >= range.from) {
    const ctx = context || dayService.loadContext();
    for (const record of attendanceRepository.listByUserAndRange(userId, range.from, last)) {
      if (!record.check_in_time || record.status === 'leave' || record.status === 'holiday') continue;
      let d;
      try { d = dayService.computeRecordDay(record, { context: ctx }); } catch (err) { if (err instanceof RangeError) continue; throw err; }
      if (d.flags.includes('invalid_time')) continue;
      if (d.late > 0) days.push({ date: record.record_date, lateMinutes: d.late });
    }
  }
  return { count: days.length, days, range: { from: range.from, to: range.to }, label: range.label };
}

// ---------- «دیر بودنِ همین ورود» (D2) ----------

// قبل از ثبت: اگر همین لحظه ورود می‌زد، دیر محسوب می‌شد؟ یک رکورد «فرضی» (ذخیره نمی‌شود) با ساعت ورود = now به همان موتور computeDay
// (شیفتِ مؤثر B1، override روز B2، مهلت تأخیر، مرخصی/مأموریتِ ساعتی، روز غیرکاری) داده می‌شود؛ یعنی تعریفِ «دیر» دقیقاً همان است که بعد از ثبت
// در گزارش‌ها می‌آید. ورود به‌موقع/قبل از شروع/داخل مهلت/روز غیرکاری ⇒ late=false. هر خطای محاسبه ⇒ late=false (fail-open: گیت هرگز ثبت را به‌اشتباه نمی‌بندد).
// ⇒ { late, lateMinutes }
function wouldBeLate(user, now = new Date()) {
  try {
    const recordDate = attendanceRepository.currentRecordDate(user.id, now);
    const d = dayService.computeRecordDay({ id: 0, user_id: user.id, record_date: recordDate, check_in_time: now.toISOString(), check_out_time: null, status: 'normal' }, { now });
    return { late: d.late > 0, lateMinutes: d.late };
  } catch (err) {
    if (!(err instanceof RangeError)) throw err;
    return { late: false, lateMinutes: 0 };
  }
}

// تصمیم گیت برای یک ثبت ورود ⇒ { action: 'allow'|'warn'|'block', state, late, lateMinutes, viaPermission }
//   allow : خاموش / زیر سقف / ورود به‌موقع / اجازه‌ی approvedِ معتبر دارد (viaPermission=true؛ بعد از ثبت باید consumeOnCheckIn صدا زده شود)
//   warn  : mode=soft و بالای سقف و ورودِ دیر ⇒ ثبت مجاز است ولی باید audit/هشدار برود
//   block : mode=enforce و بالای سقف و ورودِ دیر و بدون اجازه ⇒ ثبت نشود (۴۰۹ LATE_LIMIT_REACHED)
function evaluateCheckIn(user, now = new Date()) {
  const state = getGateState(user, now);
  const out = (action, extra = {}) => ({ action, state, late: false, lateMinutes: 0, viaPermission: false, ...extra });
  if (!state.enabled || !state.overLimit) return out('allow');
  const l = wouldBeLate(user, now);
  if (!l.late) return out('allow', l);
  if (state.permission && state.permission.status === 'approved') return out('allow', { ...l, viaPermission: true });
  return out(state.mode === 'enforce' ? 'block' : 'warn', l);
}

// ---------- چرخه‌ی اجازه ----------

const nowIsoOf = (now) => now.toISOString();
const ttlMs = (settings) => Number(settings.lateLimitPermissionTtlMinutes) * 60000;

// منقضی‌کردن تنبل: approvedِ گذشته از expires_at و pendingِ روزهای قبل (برای یک کاربر)
function expireStale(userId, now, settings) {
  checkinPermissionRepository.expireStale({ nowIso: nowIsoOf(now), today: todayInZone(settings.timezone, now), userId });
}

function view(row) {
  if (!row) return null;
  return {
    id: row.id, userId: row.user_id, date: row.permission_date, status: row.status, reason: row.reason, requestedAt: row.requested_at,
    decidedBy: row.decided_by, decidedAt: row.decided_at, decisionNote: row.decision_note, expiresAt: row.expires_at, usedAt: row.used_at,
  };
}

// وضعیت گیتِ کارمند «همین حالا» ⇒
//   { enabled, mode, limit, lateCount, overLimit, blocked, permission, month:{jy,jm,label} }
//   overLimit: lateCount ≥ limit (ورودِ دیر اجازه می‌خواهد)؛ blocked: overLimit و اجازه‌ی approvedِ معتبر ندارد.
//   permission: اجازه‌ی فعال امروز (pending/approved) یا آخرین تصمیم امروز (مثلاً rejected) برای نمایش به کارمند؛ وگرنه null.
// خاموش (limit=۰ یا mode=off) ⇒ enabled=false، blocked=false، شمارش انجام نمی‌شود.
function getGateState(user, now = new Date()) {
  const settings = settingsRepository.getAll();
  const limit = Number(settings.lateMonthlyLimit) || 0;
  const mode = settings.lateLimitGateMode;
  const today = todayInZone(settings.timezone, now);
  const parts = jalaliPartsOfDateString(today);
  const base = { enabled: false, mode, limit, lateCount: 0, overLimit: false, blocked: false, permission: null, month: parts ? { jy: parts.jy, jm: parts.jm } : null };
  if (limit <= 0 || mode === 'off') return base;

  expireStale(user.id, now, settings);
  const { count, label } = countLateInMonth(user.id, { jy: parts.jy, jm: parts.jm }, { now, settings });
  const permission = checkinPermissionRepository.findActive(user.id, today) || checkinPermissionRepository.findLatest(user.id, today);
  const approved = !!permission && permission.status === 'approved';
  const overLimit = count >= limit;
  return { ...base, enabled: true, lateCount: count, overLimit, blocked: overLimit && !approved, permission: view(permission), month: { jy: parts.jy, jm: parts.jm, label } };
}

// درخواست اجازه‌ی ورود برای امروز ⇒ { ok, permission }
// فقط وقتی گیت روشن و کارمند به سقف رسیده؛ علت الزامی (≤ ۲۰۰ نویسه)؛ یک درخواستِ فعال در روز.
function requestPermission(user, reason, now = new Date()) {
  const text = typeof reason === 'string' ? sanitizeText(reason).trim() : '';
  if (!text) return fail(400, 'REASON_REQUIRED', 'علت درخواست الزامی است.');
  if (text.length > MAX_NOTE) return fail(400, 'REASON_TOO_LONG', `علت حداکثر ${MAX_NOTE} نویسه است.`);
  const state = getGateState(user, now);
  if (!state.enabled || !state.overLimit) return fail(409, 'PERMISSION_NOT_REQUIRED', 'برای ثبت ورود نیازی به اجازه‌ی سرپرست ندارید.');
  const settings = settingsRepository.getAll();
  const today = todayInZone(settings.timezone, now);
  const active = checkinPermissionRepository.findActive(user.id, today);
  if (active) return { ...fail(409, 'PERMISSION_ALREADY_ACTIVE', 'برای امروز یک درخواست فعال دارید.'), permission: view(active) };
  try {
    return { ok: true, permission: view(checkinPermissionRepository.insert({ userId: user.id, date: today, reason: text, requestedAt: nowIsoOf(now) })) };
  } catch (err) {
    if (/UNIQUE|constraint/i.test(String(err && err.message))) { // رقابت دو درخواست همزمان
      return { ...fail(409, 'PERMISSION_ALREADY_ACTIVE', 'برای امروز یک درخواست فعال دارید.'), permission: view(checkinPermissionRepository.findActive(user.id, today)) };
    }
    throw err;
  }
}

// آیا actor حق تصمیم روی درخواستِ این کارمند را دارد؟ admin همیشه؛ سرپرست فقط مستقیمِ همان کارمند؛ کارمندِ بدون سرپرست فقط ادمین؛ hr/employee هرگز.
function canDecide(actor, employee) {
  if (actor.role === 'admin') return true;
  return actor.role === 'manager' && employee.manager_id !== null && employee.manager_id !== undefined && employee.manager_id === actor.id;
}

// تصمیم سرپرست/ادمین ⇒ { ok, permission }
// approve=true ⇒ approved با expires_at = لحظه‌ی تأیید + TTL؛ false ⇒ rejected. فقط روی pending؛ دوباره‌کاری ⇒ ۴۰۹.
function decide(actor, id, approve, note, now = new Date()) {
  const row = checkinPermissionRepository.findById(Number(id));
  if (!row) return fail(404, 'PERMISSION_NOT_FOUND', 'درخواست یافت نشد.');
  const employee = usersRepository.findById(row.user_id);
  if (!employee || !canDecide(actor, employee)) return fail(403, 'FORBIDDEN', 'اجازه‌ی تصمیم روی این درخواست را ندارید.');
  let text = null;
  if (note !== undefined && note !== null && String(note).trim() !== '') {
    text = sanitizeText(String(note)).trim();
    if (text.length > MAX_NOTE) return fail(400, 'NOTE_TOO_LONG', `یادداشت حداکثر ${MAX_NOTE} نویسه است.`);
  }
  const settings = settingsRepository.getAll();
  expireStale(row.user_id, now, settings);
  const fresh = checkinPermissionRepository.findById(row.id);
  if (fresh.status !== 'pending') return fail(409, 'PERMISSION_NOT_PENDING', fresh.status === 'expired' ? 'مهلت این درخواست گذشته است.' : 'روی این درخواست قبلاً تصمیم گرفته شده است.');
  const ok = checkinPermissionRepository.decide(row.id, {
    approve: !!approve, decidedBy: actor.id, decidedAt: nowIsoOf(now), note: text, expiresAt: new Date(now.getTime() + ttlMs(settings)).toISOString(),
  });
  if (!ok) return fail(409, 'PERMISSION_NOT_PENDING', 'روی این درخواست قبلاً تصمیم گرفته شده است.'); // رقابت دو تصمیم همزمان
  return { ok: true, permission: view(checkinPermissionRepository.findById(row.id)) };
}

// مصرف اجازه‌ی approvedِ معتبرِ امروز هنگام ورود موفق (D2 صدا می‌زند) ⇒ ردیف مصرف‌شده یا null (اجازه‌ای نبود/منقضی بود)
function consumeOnCheckIn(user, now = new Date()) {
  const settings = settingsRepository.getAll();
  expireStale(user.id, now, settings);
  const active = checkinPermissionRepository.findActive(user.id, todayInZone(settings.timezone, now));
  if (!active || active.status !== 'approved') return null;
  return checkinPermissionRepository.markUsed(active.id, nowIsoOf(now)) ? view(checkinPermissionRepository.findById(active.id)) : null;
}

// صف اجازه‌ها برای سرپرست/ادمین (اسکوپ را route با userIds می‌دهد؛ null = همه) ⇒ [{ ...view, user, lateCount }]
function listForQueue({ status = null, userIds = null, now = new Date() } = {}) {
  const settings = settingsRepository.getAll();
  checkinPermissionRepository.expireStale({ nowIso: nowIsoOf(now), today: todayInZone(settings.timezone, now) });
  const parts = jalaliPartsOfDateString(todayInZone(settings.timezone, now));
  const ctx = dayService.loadContext();
  const counts = new Map();
  return checkinPermissionRepository.list({ status, userIds }).map((row) => {
    if (!counts.has(row.user_id)) counts.set(row.user_id, countLateInMonth(row.user_id, { jy: parts.jy, jm: parts.jm }, { now, settings, context: ctx }).count);
    const u = usersRepository.findById(row.user_id);
    return { ...view(row), user: u ? { id: u.id, fullName: u.full_name, personnelCode: u.personnel_code, department: u.department || null } : null, lateCount: counts.get(row.user_id), limit: Number(settings.lateMonthlyLimit) || 0 };
  });
}

// خلاصه‌ی «فقط‌خواندنیِ» تأخیر ماه جاریِ یک کارمند برای نمایش (پروفایل پنل، متن اعلان) — بدون هیچ نوشتنی (expireStale نمی‌زند).
// ⇒ { limit, mode, enabled, lateCount, overLimit, month: { jy, jm, label } | null }   limit=۰ ⇒ سقف تعریف نشده (UI چیزی نشان ندهد)
function monthSummary(userId, now = new Date()) {
  const settings = settingsRepository.getAll();
  const limit = Number(settings.lateMonthlyLimit) || 0;
  const mode = settings.lateLimitGateMode;
  const parts = jalaliPartsOfDateString(todayInZone(settings.timezone, now));
  const out = { limit, mode, enabled: limit > 0 && mode !== 'off', lateCount: 0, overLimit: false, month: null };
  if (limit <= 0 || !parts) return out;
  const { count, label } = countLateInMonth(userId, { jy: parts.jy, jm: parts.jm }, { now, settings });
  return { ...out, lateCount: count, overLimit: count >= limit, month: { jy: parts.jy, jm: parts.jm, label } };
}

module.exports = { countLateInMonth, monthSummary, getGateState, wouldBeLate, evaluateCheckIn, requestPermission, decide, consumeOnCheckIn, listForQueue, canDecide };

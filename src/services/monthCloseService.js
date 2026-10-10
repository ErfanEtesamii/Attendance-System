// S5-3a: چک‌لیست پیش از بستن ماه شمسی (فقط خواندنی؛ بستن/snapshot در S5-3b، قفل در S5-3c).
//
// پنج بررسی + یک بررسی زمانی. هر مورد یک «مانع» (بستن را مسدود می‌کند) یا «هشدار» (فقط نمایش) است و این تصمیم
// تجاری با تنظیمات monthClose* است، نه با کد (رجیستری تنظیمات، گروه «بستن ماه»).
//
//   month_not_ended     آخرین روز ماه هنوز تمام نشده (امروز ≤ آخرین روز ماه، به وقت شرکت)                 — monthCloseRequireMonthEnded
//   incomplete          روزهای ناقص: ورودِ بدون خروج (وضعیت incomplete یا پرچم missing_checkout)         — monthCloseBlockIncomplete
//   open_disputes       اعتراض باز به رکوردهای ماه (یا اعتراضِ بدون رکوردِ ثبت‌شده در همین ماه)             — monthCloseBlockOpenDisputes
//   pending_leave       مرخصی/مأموریتِ «در انتظار» که بازه‌اش با ماه هم‌پوشانی دارد                          — monthCloseBlockPendingLeave
//   pending_overtime    اضافه‌کاریِ منتظر تأیید (فقط وقتی «الزام تأیید اضافه‌کاری» روشن است)                — monthCloseBlockPendingOvertime
//   suspicious          مورد مشکوکِ «بررسی‌نشده» (open) با تاریخ رویداد در ماه (نشانه، نه اتهام)           — monthCloseBlockSuspicious
//
// «ناقص» و «اضافه‌کاری منتظر» از همان monthlyReportService (و درنتیجه computeDay) می‌آیند تا چک‌لیست با گزارش ماهانه ناسازگار نشود.
// کل شرکت بررسی می‌شود (همه‌ی کاربران، حتی غیرفعال‌ها؛ بستن ماه کل شرکت است نه یک تیم).

const usersRepository = require('../repositories/usersRepository');
const disputeRepository = require('../repositories/disputeRepository');
const leaveRepository = require('../repositories/leaveRepository');
const suspiciousRepository = require('../repositories/suspiciousRepository');
const monthClosuresRepository = require('../repositories/monthClosuresRepository');
const dayService = require('../engine/dayService');
const { computeMonthlyReport, computeTotals } = require('./monthlyReportService');
const { jalaliMonthRangeOf } = require('../utils/jalali');
const { todayInZone } = require('../utils/time');

const SAMPLE_LIMIT = 10; // تعداد نمونه‌ی نمایشی هر مورد؛ count همیشه شمارش کامل است

// شمارنده‌ی نمونه‌ها: samples فقط SAMPLE_LIMIT تای اول را نگه می‌دارد
function collector() {
  const samples = [];
  let count = 0;
  return {
    add(sample) { count += 1; if (samples.length < SAMPLE_LIMIT) samples.push(sample); },
    result() { return { count, samples }; },
  };
}

/**
 * @param {object} p
 * @param {number} p.year سال شمسی
 * @param {number} p.month ماه شمسی ۱..۱۲
 * @param {Date|string} [p.now]
 * @param {object} [p.context] خروجی dayService.loadContext()
 * @param {object[]} [p.users] (تست) به‌جای همه‌ی کاربران
 * @param {object} [p.report] گزارش ماهانه‌ی از قبل ساخته‌شده با includeDays (برای بستن ماه: یک‌بار محاسبه، هم چک‌لیست هم snapshot)
 * @returns {object} { year, month, label, from, to, today, closure, items[], blockingCount, warningCount, canClose }
 * @throws {RangeError} سال/ماه نامعتبر
 */
function buildChecklist({ year, month, now, context, users, report: precomputed } = {}) {
  const range = jalaliMonthRangeOf(year, month); // RangeError برای ورودی نامعتبر
  const ctx = context || dayService.loadContext();
  const { settings, timezone } = ctx;
  const nowDate = now === undefined ? new Date() : new Date(now);
  const today = todayInZone(timezone, nowDate);
  const allUsers = Array.isArray(users) ? users : usersRepository.listUsers({});
  const nameOf = new Map(allUsers.map((u) => [u.id, u.full_name]));
  const userLabel = (id) => nameOf.get(id) || `کاربر ${id}`;

  const closureRow = monthClosuresRepository.findByMonth(year, month);
  const closure = closureRow
    ? { status: closureRow.status, closedAt: closureRow.closed_at, closedBy: closureRow.closed_by, reopenedAt: closureRow.reopened_at, closeCount: closureRow.close_count }
    : { status: 'open' };

  // گزارش ماهانه با ریز روزانه (فقط یک‌بار) برای «ناقص» و «اضافه‌کاری منتظر»
  const report = precomputed || computeMonthlyReport({ users: allUsers, year, month, now: nowDate, context: ctx, includeDays: true, includeBalances: false });

  const items = [];
  const push = (key, title, hint, blocking, found, extra = {}) => {
    const { count, samples } = found;
    items.push({ key, title, hint, blocking: !!blocking, count, ok: count === 0, samples, ...extra });
  };

  // ۰) ماه تمام شده؟
  {
    const notEnded = today <= range.to;
    push('month_not_ended', 'پایان ماه', 'بستن ماه پیش از پایان آخرین روز آن، داده‌ی ناقص را قفل می‌کند.',
      settings.monthCloseRequireMonthEnded === true,
      { count: notEnded ? 1 : 0, samples: notEnded ? [{ text: `امروز ${today} است و آخرین روز ماه ${range.to} است.` }] : [] });
  }

  // ۱) روزهای ناقص
  {
    const c = collector();
    for (const u of report.users) {
      for (const d of u.days || []) {
        if (d.status === 'incomplete') c.add({ userId: u.user.id, fullName: u.user.fullName, date: d.date });
      }
    }
    push('incomplete', 'روزهای ناقص (ورود بدون خروج)', 'رکوردهای بدون خروج را اصلاح یا ببندید.', settings.monthCloseBlockIncomplete === true, c.result());
  }

  // ۲) اعتراض‌های باز
  {
    const c = collector();
    for (const d of disputeRepository.listOpenInRange(range.from, range.to)) {
      c.add({ disputeId: d.id, userId: d.user_id, fullName: userLabel(d.user_id), date: d.record_date || String(d.created_at).slice(0, 10), message: String(d.message || '').slice(0, 120) });
    }
    push('open_disputes', 'اعتراض‌های باز', 'اعتراض‌ها را بررسی و رسیدگی کنید.', settings.monthCloseBlockOpenDisputes === true, c.result());
  }

  // ۳) مرخصی/مأموریت در انتظار
  {
    const c = collector();
    const { rows } = leaveRepository.listQueue({ status: 'pending', from: range.from, to: range.to, limit: null });
    for (const l of rows) {
      c.add({ requestId: l.id, userId: l.user_id, fullName: userLabel(l.user_id), startDate: l.start_date, endDate: l.end_date, kind: l.kind || null });
    }
    push('pending_leave', 'مرخصی/مأموریت در انتظار', 'درخواست‌های در انتظار را تأیید یا رد کنید.', settings.monthCloseBlockPendingLeave === true, c.result());
  }

  // ۴) اضافه‌کاری منتظر تأیید (فقط با الزام تأیید)
  {
    const c = collector();
    if (settings.overtimeRequiresApproval === true) {
      for (const u of report.users) {
        for (const d of u.days || []) {
          if (d.approvalStatus === 'pending' && d.overtimePayable > 0) c.add({ userId: u.user.id, fullName: u.user.fullName, date: d.date, minutes: d.overtimePayable });
        }
      }
    }
    push('pending_overtime', 'اضافه‌کاری منتظر تأیید', 'اضافه‌کاری معلق را تأیید یا رد کنید.', settings.monthCloseBlockPendingOvertime === true, c.result(),
      { applicable: settings.overtimeRequiresApproval === true });
  }

  // ۵) موارد مشکوکِ بررسی‌نشده
  {
    const c = collector();
    for (const e of suspiciousRepository.list({ status: 'open', from: range.from, to: range.to, limit: 1000 })) {
      c.add({ eventId: e.id, eventType: e.event_type, date: e.event_date, users: e.user_ids.map((id) => ({ userId: id, fullName: userLabel(id) })) });
    }
    push('suspicious', 'موارد مشکوکِ بررسی‌نشده', 'این‌ها «نشانه» هستند نه اتهام؛ بررسی و وضعیتشان را ثبت کنید.', settings.monthCloseBlockSuspicious === true, c.result());
  }

  // مانع = مورد «مانع» با شمارش > ۰
  const blockers = items.filter((i) => i.blocking && i.count > 0);
  const warnings = items.filter((i) => !i.blocking && i.count > 0);
  return {
    year, month, label: range.label, from: range.from, to: range.to, today,
    closure,
    items,
    blockingCount: blockers.length,
    warningCount: warnings.length,
    // ماهِ از قبل بسته‌شده دوباره بسته نمی‌شود (باید اول باز شود، S5-3c)
    canClose: blockers.length === 0 && closure.status !== 'closed',
  };
}

// ---------- بستن ماه (S5-3b) ----------

const SNAPSHOT_VERSION = 1;
const MAX_NOTE = 500;

class MonthCloseError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = 'MonthCloseError';
    this.code = code; // ALREADY_CLOSED | CHECKLIST_BLOCKED
    Object.assign(this, extra);
  }
}

/**
 * بستن ماه: چک‌لیست باید مانعی نداشته باشد؛ سپس گزارش ماهانه‌ی «کامل» (همه‌ی کاربران، ریز روزانه، مانده‌ها) به‌همراه
 * تنظیمات مؤثر همان لحظه به‌صورت snapshot ذخیره می‌شود و از آن به بعد گزارش آن ماه از snapshot خوانده می‌شود، نه از محاسبه‌ی زنده.
 * @returns {{ closure: object, checklist: object }}
 * @throws {RangeError} سال/ماه نامعتبر
 * @throws {MonthCloseError} ALREADY_CLOSED | CHECKLIST_BLOCKED (checklist در خطا)
 */
function closeMonth({ year, month, closedBy = null, note = null, now, context } = {}) {
  const range = jalaliMonthRangeOf(year, month); // RangeError
  const ctx = context || dayService.loadContext();
  const nowDate = now === undefined ? new Date() : new Date(now);
  const allUsers = usersRepository.listUsers({});
  const report = computeMonthlyReport({ users: allUsers, year, month, now: nowDate, context: ctx, includeDays: true, includeBalances: true });
  const checklist = buildChecklist({ year, month, now: nowDate, context: ctx, users: allUsers, report });
  if (checklist.closure.status === 'closed') throw new MonthCloseError('ALREADY_CLOSED', 'این ماه از قبل بسته شده است.', { checklist });
  if (!checklist.canClose) throw new MonthCloseError('CHECKLIST_BLOCKED', 'چک‌لیست بستن ماه موانع باز دارد.', { checklist });

  const cleanNote = typeof note === 'string' && note.trim() ? note.trim().slice(0, MAX_NOTE) : null;
  const snapshot = {
    version: SNAPSHOT_VERSION,
    closedAtIso: nowDate.toISOString(),
    timezone: ctx.timezone,
    settings: ctx.settings, // تنظیمات مؤثرِ لحظه‌ی بستن (ارقام snapshot با همین‌ها حساب شده‌اند)
    report,
  };
  let closure;
  try {
    closure = monthClosuresRepository.saveClosure({ year, month, periodFrom: range.from, periodTo: range.to, snapshot, checklist, note: cleanNote, closedBy });
  } catch (err) {
    if (err && err.code === 'ALREADY_CLOSED') throw new MonthCloseError('ALREADY_CLOSED', err.message, { checklist });
    throw err;
  }
  return { closure, checklist };
}

/**
 * گزارش ماهانه از snapshot ماهِ بسته‌شده، با همان شکل خروجی computeMonthlyReport (+ source/closedAt).
 * @param {object} closureRow ردیف monthClosuresRepository.findByMonth (باید snapshot داشته باشد)
 * @param {object} [o]
 * @param {number[]|null} [o.allowedIds] اسکوپ نقش (null ⇒ همه)؛ فراخواننده محاسبه می‌کند
 * @param {number} [o.userId] فقط این کاربر (بدون فیلتر «فعال»؛ مثل رفتار زنده)
 * @param {string} [o.department] فیلتر دپارتمان (نوشتار هنگام بستن، پس از trim)
 * @param {boolean} [o.includeInactive] کاربرانی که هنگام بستن غیرفعال بوده‌اند هم بیایند
 * @param {boolean} [o.includeDays] ریز روزانه
 */
function reportFromSnapshot(closureRow, { allowedIds = null, userId, department, includeInactive = false, includeDays = false } = {}) {
  const snap = closureRow && closureRow.snapshot;
  if (!snap || !snap.report) throw new Error('snapshot ماه بسته‌شده در دسترس نیست.');
  const base = snap.report;
  let list = base.users;
  if (allowedIds !== null && allowedIds !== undefined) {
    const allowed = new Set(allowedIds);
    list = list.filter((u) => allowed.has(u.user.id));
  }
  if (userId !== undefined && userId !== null) list = list.filter((u) => u.user.id === userId);
  else {
    if (!includeInactive) list = list.filter((u) => u.user.isActive);
    if (department) list = list.filter((u) => (u.user.department || '').trim() === department);
  }
  const users = list.map((u) => {
    if (includeDays) return u;
    const { days, ...rest } = u; // eslint-disable-line no-unused-vars
    return rest;
  });
  return {
    year: base.year, month: base.month, from: base.from, to: base.to, label: base.label, daysInMonth: base.daysInMonth, today: base.today,
    overtimePolicy: base.overtimePolicy,
    users,
    totals: computeTotals(users),
    source: 'snapshot',
    closedAt: closureRow.closed_at,
  };
}

module.exports = { buildChecklist, closeMonth, reportFromSnapshot, MonthCloseError, SAMPLE_LIMIT, SNAPSHOT_VERSION };

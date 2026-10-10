// S5-2a: محاسبه‌ی گزارش ماهانه‌ی شمسی (بدون HTTP و بدون قفل/بستن ماه؛ آن‌ها در S5-3).
//
// قراردادها:
//   • «فقط از computeDay»: هر روز ماه با computeDay (موتور خالص) حساب می‌شود؛ منطق جدیدی برای تأخیر/زودتر رفتن/اضافه‌کاری/مفید اینجا نیست.
//     ورودی‌های موتور (تقویم روز، شیفت، پنجره‌های مرخصی تأییدشده) دقیقاً مثل تقویم تیم (admin/calendar.js) ساخته می‌شوند، ولی «یک‌جا و بدون N+1»
//     (رکوردها، مرخصی‌ها، تعطیلی‌ها و شیفت‌ها یک‌بار برای همه‌ی کاربران خوانده می‌شوند؛ فقط استراحت‌ها به‌ازای رکوردِ دارای ورود).
//   • اضافه‌کاری قابل‌پرداخت: payable روزانه‌ی computeDay ⇒ حذف معلق/ردشده (تأیید S3-5c) ⇒ سقف ماهانه (S3-5b) با همان توابع dayService
//     (approvalStatusOf / eligiblePayable / capMonthlyOvertime)؛ نتیجه با dayService.computeMonthOvertime یکی است (تست می‌شود).
//   • ماه = ماه شمسی (jalaliMonthRangeOf)؛ رکوردها با record_date میلادی (مرجع DB). «امروز» به وقت شرکت (timezone تنظیمات) است و now تزریق‌پذیر.
//   • مانده‌ی مرخصی «سالانه» و «تا لحظه‌ی گزارش» است (ledger سال شمسی ماه گزارش)، نه مانده‌ی پایان همان ماه؛ برای ماه بسته‌شده snapshot در S5-3b می‌آید.
//
// روز کاری مورد انتظار = روزهایی که تقویم (آخر هفته/تعطیلی کامل/روزهای کاری شیفت) آن‌ها را کاری می‌داند (نیم‌روز هم یک روز کاری است؛ کوتاه‌شدنش
// در expectedMinutes می‌آید). مرخصی تمام‌روز روز کاری را از «غیبت» خارج می‌کند ولی از expectedWorkDays کم نمی‌شود.
//
// دسته‌بندی «انحصاری» هر روز کاری (اولویت مثل تقویم تیم):
//   ورود ثبت‌شده ⇒ present | ثبت دستی بدون ورود با status=leave ⇒ manual_leave | status=holiday ⇒ manual_holiday |
//   مرخصی/مأموریتِ تمام‌روز ⇒ leave/mission | بعد از امروز ⇒ future | امروز ⇒ pending | گذشته ⇒ absent
// روز غیرکاری فقط holiday/weekend است؛ اگر در آن ورودی ثبت شده باشد در workedOnNonWorkingDays هم می‌آید (و کل کارش اضافه‌کاری است؛ کار موتور).
//
// ساعت مفید: روز دارای ورودِ بدون خروجِ گذشته (missing_checkout) در جمع نمی‌آید (موتور برایش تا now می‌شمارد)؛ رکورد باز امروز تا now حساب می‌شود.
//
// روزهای پیش از تاریخ ثبت کاربر (created_at به وقت شرکت) بدون رکورد ⇒ not_started و بیرون از همه‌ی شمارش‌ها (تازه‌واردِ وسط ماه غایب حساب نمی‌شود).
//
// کسری (shortfall) = Σ روزهای «سپری‌شده‌ی کاری»: غیبت ⇒ expected؛ روز دارای ورود و خروجِ سالم ⇒ max(0, expected − effective).
// روز ناقص (incomplete/بدون خروج)، رکورد باز و داده‌ی زمانی خراب در کسری نمی‌آیند (مبهم‌اند) و جدا شمرده می‌شوند (incompleteDays / invalidDays).

const attendanceRepository = require('../repositories/attendanceRepository');
const breakRepository = require('../repositories/breakRepository');
const leaveRepository = require('../repositories/leaveRepository');
const leaveTypesRepository = require('../repositories/leaveTypesRepository');
const holidaysRepository = require('../repositories/holidaysRepository');
const shiftsRepository = require('../repositories/shiftsRepository');
const overtimeApprovalRepository = require('../repositories/overtimeApprovalRepository');
const dayService = require('../engine/dayService');
const leaveBalanceService = require('./leaveBalanceService');
const { computeDay } = require('../engine/computeDay');
const { resolveCalendarDay, pickHoliday } = require('../engine/calendarService');
const { leaveWindowsOnDate, requestRowToValue } = require('../utils/leaveUnits');
const { jalaliMonthRangeOf, jalaliMonthDates } = require('../utils/jalali');
const { todayInZone } = require('../utils/time');

const unitOf = (l) => l.unit || 'day';
const sum = (arr) => arr.reduce((t, v) => t + v, 0);

// کلیدهای عددیِ قابل‌جمع در totals (مسیر نقطه‌ای داخل خروجی هر کاربر)
const TOTAL_PATHS = [
  'calendar.expectedWorkDays', 'calendar.holidayDays', 'calendar.weekendDays', 'calendar.halfDays',
  'attendance.presentDays', 'attendance.absentDays', 'attendance.lateDays', 'attendance.earlyLeaveDays', 'attendance.incompleteDays',
  'attendance.pendingDays', 'attendance.futureDays', 'attendance.manualHolidayDays', 'attendance.notStartedDays', 'attendance.workedOnNonWorkingDays', 'attendance.invalidDays',
  'leave.leaveDays', 'leave.leaveMinutes', 'leave.missionDays', 'leave.missionMinutes',
  'time.expectedMinutes', 'time.effectiveMinutes', 'time.shortfallMinutes', 'time.lateMinutes', 'time.earlyLeaveMinutes',
  'overtime.rawMinutes', 'overtime.payableDailyMinutes', 'overtime.pendingMinutes', 'overtime.rejectedMinutes',
  'overtime.eligibleMinutes', 'overtime.payableMinutes', 'overtime.clippedMinutes',
];

function getPath(obj, path) { return path.split('.').reduce((o, k) => o[k], obj); }
function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i += 1) { o[keys[i]] = o[keys[i]] || {}; o = o[keys[i]]; }
  o[keys[keys.length - 1]] = value;
}

// تاریخ (به وقت شرکت) ثبت کاربر در سیستم؛ created_at دیتابیس UTC با قالب 'YYYY-MM-DD HH:MM:SS' است. نامعتبر ⇒ null (بدون محدودیت)
function startDateOf(user, timezone) {
  if (!user || typeof user.created_at !== 'string') return null;
  const d = new Date(`${user.created_at.trim().replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? null : todayInZone(timezone, d);
}

function emptyDayResult() {
  return { expected: 0, workedGross: null, break: 0, effective: null, late: 0, earlyLeave: 0, overtime: 0, overtimePayable: 0, isOpen: false, flags: [], status: null };
}

// جمع «جمع‌پذیر»های خروجی کاربران (totals). جدا شده تا گزارش ماهِ بسته (S5-3b) بعد از فیلتر اسکوپ از snapshot هم همان جمع را بسازد.
function computeTotals(userRecords) {
  const totals = {};
  for (const path of TOTAL_PATHS) setPath(totals, path, sum(userRecords.map((r) => getPath(r, path))));
  totals.userCount = userRecords.length;
  return totals;
}

/**
 * @param {object} p
 * @param {object[]} p.users ردیف‌های users (اسکوپ نقش را فراخواننده قبلاً اعمال کرده؛ این سرویس خودش دسترسی تعیین نمی‌کند)
 * @param {number} p.year سال شمسی
 * @param {number} p.month ماه شمسی ۱..۱۲
 * @param {Date|string} [p.now] لحظه‌ی «الان» (تزریق برای تست)
 * @param {object} [p.context] خروجی dayService.loadContext()
 * @param {boolean} [p.includeDays] ریز روزانه‌ی هر کاربر (days[]) هم برگردد
 * @param {boolean} [p.includeBalances] مانده‌ی مرخصی سالانه (پیش‌فرض true)
 * @returns {{ year, month, from, to, label, daysInMonth, today, overtimePolicy, users: object[], totals: object }}
 * @throws {RangeError} سال/ماه نامعتبر
 */
function computeMonthlyReport({ users, year, month, now, context, includeDays = false, includeBalances = true } = {}) {
  const range = jalaliMonthRangeOf(year, month); // RangeError برای ورودی نامعتبر
  const ctx = context || dayService.loadContext();
  const { settings, timezone } = ctx;
  const nowDate = now === undefined ? new Date() : new Date(now);
  const today = todayInZone(timezone, nowDate);
  const dates = jalaliMonthDates(year, month);
  const list = Array.isArray(users) ? users.filter(Boolean) : [];
  const ids = list.map((u) => u.id);

  // ---- خواندن‌های کلی (بدون N+1) ----
  const recordsByUser = new Map();
  for (const r of attendanceRepository.listByUserIdsAndRange(ids, range.from, range.to)) {
    if (!recordsByUser.has(r.user_id)) recordsByUser.set(r.user_id, new Map());
    recordsByUser.get(r.user_id).set(r.record_date, r);
  }
  const leavesByUser = new Map();
  for (const l of leaveRepository.listApprovedInRange(ids, range.from, range.to)) {
    if (!leavesByUser.has(l.user_id)) leavesByUser.set(l.user_id, []);
    leavesByUser.get(l.user_id).push(l);
  }
  const holidaysByDate = new Map();
  for (const h of holidaysRepository.listHolidays()) {
    if (h.holiday_date < range.from || h.holiday_date > range.to) continue;
    if (!holidaysByDate.has(h.holiday_date)) holidaysByDate.set(h.holiday_date, []);
    holidaysByDate.get(h.holiday_date).push(h);
  }
  const shiftById = new Map(shiftsRepository.listShifts().map((sh) => [sh.id, sh]));
  const types = leaveTypesRepository.listLeaveTypes();
  const typeById = new Map(types.map((t) => [t.id, t]));
  const trackedTypes = types.filter((t) => t.isActive && t.countsAgainstBalance);

  const requiresApproval = settings.overtimeRequiresApproval === true;
  const cap = settings.overtimeMonthlyCapMinutes;
  const allRecordIds = [];
  for (const m of recordsByUser.values()) for (const r of m.values()) allRecordIds.push(r.id);
  const decisions = requiresApproval ? overtimeApprovalRepository.mapByRecordIds(allRecordIds) : new Map();

  const out = list.map((u) => {
    const shift = (u.shift_id != null && shiftById.get(u.shift_id)) || null;
    const recMap = recordsByUser.get(u.id) || new Map();
    const activeFrom = startDateOf(u, timezone);
    const userLeaves = leavesByUser.get(u.id) || [];

    const calendar = { daysInMonth: range.daysInMonth, expectedWorkDays: 0, holidayDays: 0, weekendDays: 0, halfDays: 0 };
    const att = {
      presentDays: 0, absentDays: 0, lateDays: 0, earlyLeaveDays: 0, incompleteDays: 0, pendingDays: 0, futureDays: 0,
      manualHolidayDays: 0, workedOnNonWorkingDays: 0, invalidDays: 0, notStartedDays: 0,
    };
    const leave = { leaveDays: 0, leaveMinutes: 0, missionDays: 0, missionMinutes: 0 };
    const time = { expectedMinutes: 0, effectiveMinutes: 0, shortfallMinutes: 0, lateMinutes: 0, earlyLeaveMinutes: 0 };
    const typeAcc = new Map(); // key: leaveTypeId|null ⇒ { leaveTypeId, title, kind, days, minutes }
    const bucket = (leaveTypeId, kind) => {
      const key = leaveTypeId === null ? 'manual' : String(leaveTypeId);
      if (!typeAcc.has(key)) {
        const t = leaveTypeId === null ? null : typeById.get(leaveTypeId);
        typeAcc.set(key, { leaveTypeId, title: t ? t.title : 'ثبت دستی (بدون نوع)', kind: t ? t.kind : kind, days: 0, minutes: 0 });
      }
      return typeAcc.get(key);
    };
    const dayRows = [];
    const otDays = []; // روزهای دارای رکورد، به ترتیب تاریخ (برای تأیید و سقف ماهانه)

    for (const dateStr of dates) {
      const holiday = pickHoliday(holidaysByDate.get(dateStr) || [], u.department);
      const cal = resolveCalendarDay({ dateStr, shift, settings, holiday });
      const record = recMap.get(dateStr) || null;
      const hasCheckIn = !!(record && record.check_in_time);

      // روزهای پیش از ثبت کاربر در سیستم (و بدون رکورد) «غیبت» نیستند؛ از همه‌ی شمارش‌ها بیرون می‌مانند (کارمند تازه‌واردِ وسط ماه)
      if (!record && activeFrom && dateStr < activeFrom) {
        att.notStartedDays += 1;
        if (includeDays) dayRows.push({ date: dateStr, status: 'not_started', kind: cal.kind, holidayTitle: cal.holidayTitle, expected: 0, effective: null, late: 0, earlyLeave: 0, overtime: 0, overtimePayable: 0, flags: [], leaveMinutes: 0 });
        continue;
      }

      if (cal.isWorkingDay) calendar.expectedWorkDays += 1;
      else if (cal.kind === 'holiday') calendar.holidayDays += 1;
      else calendar.weekendDays += 1;
      if (cal.isWorkingDay && cal.kind === 'half') calendar.halfDays += 1;

      // پنجره‌های مرخصی تأییدشده‌ی همین روز (به‌همراه نوع و دقیقه‌ی هر درخواست)
      const covering = userLeaves.filter((l) => dateStr >= l.start_date && dateStr <= l.end_date);
      const parts = [];
      for (const l of covering) {
        const ws = leaveWindowsOnDate([requestRowToValue(l)], dateStr, () => cal);
        if (ws.length) parts.push({ leave: l, windows: ws, minutes: sum(ws.map((w) => w.end - w.start)) });
      }
      const windows = parts.flatMap((p) => p.windows);

      let day;
      let invalid = false;
      try {
        const breaks = hasCheckIn ? breakRepository.listByAttendanceRecord(record.id) : [];
        day = computeDay({ record, breaks, settings, now: nowDate, timezone, shift, calendar: cal, approvedLeaves: windows.length ? windows : null });
      } catch (err) {
        if (!(err instanceof RangeError)) throw err;
        console.error(`[monthlyReport] روز ${dateStr} کاربر ${u.id} قابل‌محاسبه نیست:`, err.message);
        day = emptyDayResult();
        invalid = true;
      }
      if (invalid || day.flags.includes('invalid_time')) att.invalidDays += 1;

      time.expectedMinutes += day.expected;
      // ورودِ بدون خروجِ روزِ گذشته (missing_checkout) ساعت مفیدِ بی‌معنا می‌دهد (موتور تا now می‌شمارد ⇒ ده‌ها ساعت)؛ در جمع نمی‌آید و در incompleteDays شمرده می‌شود.
      // رکورد بازِ «امروز» (هنوز در حال کار) تا همین لحظه حساب می‌شود.
      if (day.effective !== null && !day.flags.includes('missing_checkout')) time.effectiveMinutes += day.effective;
      if (day.late > 0) { att.lateDays += 1; time.lateMinutes += day.late; }
      if (day.earlyLeave > 0) { att.earlyLeaveDays += 1; time.earlyLeaveMinutes += day.earlyLeave; }
      if (record) otDays.push({ record, day });

      // دقیقه‌ی مرخصی به تفکیک نوع (هر روزی که پنجره دارد؛ حتی اگر همان روز ورود هم ثبت شده باشد)
      for (const p of parts) {
        const b = bucket(p.leave.leave_type_id, p.leave.kind);
        b.minutes += p.minutes;
        if (p.leave.kind === 'mission') leave.missionMinutes += p.minutes; else leave.leaveMinutes += p.minutes;
      }
      // مرخصی «تمام‌روز» = پنجره‌ها کل روزِ مورد انتظار را پوشانده‌اند (expected = ۰ روی روز کاری)؛ به نوعِ پرمدت‌تر نسبت داده می‌شود
      const fullyOnLeave = cal.isWorkingDay && parts.length > 0 && day.expected === 0;
      const mainPart = parts.slice().sort((a, b) => b.minutes - a.minutes)[0] || null;

      let status;
      if (hasCheckIn) {
        if (cal.isWorkingDay) att.presentDays += 1; else att.workedOnNonWorkingDays += 1;
        if (record.status === 'incomplete' || day.flags.includes('missing_checkout')) { att.incompleteDays += 1; status = 'incomplete'; }
        else status = day.late > 0 ? 'late' : 'present';
      } else if (!cal.isWorkingDay) {
        status = cal.kind === 'holiday' ? 'holiday' : 'weekend';
      } else if (record && record.status === 'leave') {
        leave.leaveDays += 1;
        bucket(null, 'leave').days += 1;
        status = 'manual_leave';
      } else if (record && record.status === 'holiday') {
        att.manualHolidayDays += 1;
        status = 'manual_holiday';
      } else if (fullyOnLeave && mainPart) {
        const b = bucket(mainPart.leave.leave_type_id, mainPart.leave.kind);
        b.days += 1;
        if (mainPart.leave.kind === 'mission') { leave.missionDays += 1; status = 'mission'; } else { leave.leaveDays += 1; status = 'leave'; }
      } else if (dateStr > today) {
        att.futureDays += 1;
        status = 'future';
      } else if (dateStr === today) {
        att.pendingDays += 1;
        status = 'pending';
      } else {
        att.absentDays += 1;
        status = 'absent';
      }

      // کسری (فقط روز کاریِ سپری‌شده)
      if (cal.isWorkingDay && dateStr <= today) {
        if (status === 'absent') time.shortfallMinutes += day.expected;
        else if ((status === 'present' || status === 'late') && !day.isOpen && day.effective !== null && !day.flags.includes('invalid_time')) {
          time.shortfallMinutes += Math.max(0, day.expected - day.effective);
        }
      }

      if (includeDays) {
        dayRows.push({
          date: dateStr, status, kind: cal.kind, holidayTitle: cal.holidayTitle,
          expected: day.expected, effective: day.effective, late: day.late, earlyLeave: day.earlyLeave,
          overtime: day.overtime, overtimePayable: day.overtimePayable, flags: day.flags,
          leaveMinutes: sum(parts.map((p) => p.minutes)),
        });
      }
    }

    // ---- اضافه‌کاری: payable روزانه ⇒ تأیید ⇒ سقف ماهانه (همان ترتیب computeMonthOvertime) ----
    const daily = otDays.map((d) => d.day.overtimePayable);
    const statuses = otDays.map((d, i) => dayService.approvalStatusOf(requiresApproval, daily[i], decisions.get(d.record.id)));
    const eligible = daily.map((p, i) => dayService.eligiblePayable(p, statuses[i]));
    const capped = dayService.capMonthlyOvertime(eligible, cap);
    const overtime = {
      rawMinutes: sum(otDays.map((d) => d.day.overtime)),
      payableDailyMinutes: sum(daily),
      pendingMinutes: sum(daily.filter((_, i) => statuses[i] === 'pending')),
      rejectedMinutes: sum(daily.filter((_, i) => statuses[i] === 'rejected')),
      eligibleMinutes: sum(eligible),
      payableMinutes: sum(capped),
      clippedMinutes: sum(eligible) - sum(capped),
    };

    const balances = [];
    if (includeBalances) {
      for (const t of trackedTypes) {
        const b = leaveBalanceService.describeBalance({ userId: u.id, leaveTypeId: t.id, jalaliYear: year });
        if (!b.ok || !b.tracked) continue;
        balances.push({
          leaveTypeId: t.id, title: t.title,
          entitled: b.entitled, carriedOver: b.carriedOver, adjustments: b.adjustments, used: b.used, remaining: b.remaining, pending: b.pending,
          display: b.display,
        });
      }
    }

    const rec = {
      user: { id: u.id, fullName: u.full_name, personnelCode: u.personnel_code, department: u.department || null, isActive: !!u.is_active },
      calendar,
      attendance: att,
      leave: { ...leave, byType: [...typeAcc.values()] },
      time,
      overtime,
      balances,
    };
    if (includeDays) {
      // وضعیت تأیید و اضافه‌کاری قابل‌پرداخت (پس از تأیید و سقف) روی روزهای دارای رکورد
      const byDate = new Map(otDays.map((d, i) => [d.record.record_date, { approvalStatus: statuses[i], overtimePayableFinal: capped[i] }]));
      rec.days = dayRows.map((d) => ({ ...d, ...(byDate.get(d.date) || {}) }));
    }
    return rec;
  });

  const totals = computeTotals(out);

  return {
    year, month, from: range.from, to: range.to, label: range.label, daysInMonth: range.daysInMonth, today,
    overtimePolicy: { enabled: settings.overtimeEnabled === true, requiresApproval, monthlyCapMinutes: cap },
    users: out,
    totals,
  };
}

module.exports = { computeMonthlyReport, computeTotals };

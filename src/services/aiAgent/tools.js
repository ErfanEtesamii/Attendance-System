// ابزارهای ایجنت هوش مصنوعی: همان داده‌ی پشت نمودارهای پنل، فقط‌خواندنی و با اسکوپ نقشِ کاربرِ پرسنده.
//
// قراردادها:
//   • هیچ محاسبه‌ی تازه‌ای نیست؛ همه‌چیز از سرویس‌های موجود (performanceService / analyticsService / ...) می‌آید، پس عددهایی که ایجنت می‌بیند
//     دقیقاً همان عددهای نمودارهاست.
//   • هر ابزار مجوز خودش را جدا چک می‌کند (performance.read / analytics.read) و کاربران را با visibleUsers/canAccessUser محدود می‌کند.
//   • حقوق و نرخ ساعتی فقط از ابزار payroll_summary (flag: financial) و فقط با مجوز payroll.read + AI_ALLOW_PAYROLL به مدل می‌رسد؛
//     برای همه‌ی ابزارهای دیگر includePayroll=false و حذف بازگشتیِ کلیدهای مالی (stripFinancial) برقرار است.
//   • ورودی ابزار از مدل می‌آید ⇒ نامعتبر فرض می‌شود و اعتبارسنجی می‌شود؛ خطا به‌صورت متن به مدل برمی‌گردد تا خودش اصلاح کند.

const config = require('../../config');
const { hasPermission } = require('../../middleware/permissions');
const { visibleUsers, canAccessUser } = require('../../api/routes/admin/common');
const { parseYearMonth } = require('../../api/routes/admin/monthParams');
const usersRepository = require('../../repositories/usersRepository');
const settingsRepository = require('../../repositories/settingsRepository');
const monthClosuresRepository = require('../../repositories/monthClosuresRepository');
const { todayInZone } = require('../../utils/time');
const perf = require('../performanceService');
const analytics = require('../analyticsService');
const breakdown = require('../analyticsBreakdownService');
const { detectPatterns } = require('../patternService');
const { computeMonthlyReport } = require('../monthlyReportService');
const { reportFromSnapshot } = require('../monthCloseService');

// سرویس‌های رایگان سقف توکن در دقیقه‌ی کمی دارند (مثلاً ۸۰۰۰)؛ خروجی هر ابزار باید کوچک بماند.
const MAX_RESULT_CHARS = 9000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const FINANCIAL_KEYS = /^(hourlyRate|hourly_rate|rateToman|amountToman|amount_toman|estimatedAmount|payroll|salary|earnings)$/i;

class ToolError extends Error {}

const today = () => todayInZone(settingsRepository.getTimezone());
const shiftIso = (iso, days) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };

function stripFinancial(value) {
  if (Array.isArray(value)) return value.map(stripFinancial);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) if (!FINANCIAL_KEYS.test(k)) out[k] = stripFinancial(v);
    return out;
  }
  return value;
}

function need(ctx, permission) {
  if (!hasPermission(ctx.adminUser.role, permission)) throw new ToolError('شما برای این داده مجوز ندارید.');
}

function userFilter(ctx, input) {
  let users = visibleUsers(ctx.adminUser, { onlyActive: input.includeInactive !== true });
  if (input.userId !== undefined && input.userId !== null) {
    if (!Number.isInteger(input.userId)) throw new ToolError('userId باید عدد صحیح باشد.');
    if (!canAccessUser(ctx.adminUser, input.userId)) throw new ToolError('به این کارمند دسترسی ندارید.');
    const u = usersRepository.findById(input.userId);
    if (!u) throw new ToolError('کارمند یافت نشد.');
    users = [u];
  } else if (input.department) {
    const dep = String(input.department).trim();
    users = users.filter((u) => (u.department || '').trim() === dep);
  }
  if (users.length === 0) throw new ToolError('هیچ کارمندی با این فیلتر پیدا نشد.');
  return users;
}

function yearMonth(input) {
  const p = parseYearMonth(String(input.year), String(input.month));
  if (p.error) throw new ToolError(p.error.error);
  return p;
}

function monthlyReportFor(users, year, month) {
  const closure = monthClosuresRepository.findByMonth(year, month);
  if (closure && closure.status === 'closed' && closure.snapshot) {
    return { ...reportFromSnapshot(closure, { allowedIds: users.map((u) => u.id), includeInactive: true }) };
  }
  return { ...computeMonthlyReport({ users, year, month }), source: 'live' };
}

function requireDates(input) {
  for (const k of ['from', 'to']) if (input[k] !== undefined && !DATE_RE.test(String(input[k]))) throw new ToolError(`${k} باید YYYY-MM-DD (میلادی) باشد.`);
}

function rangeOf(input) {
  try { return perf.resolveRange({ range: input.range, from: input.from, to: input.to, today: today() }); } catch (err) {
    if (err instanceof perf.PerformanceError) throw new ToolError(err.message);
    throw err;
  }
}

const RANGE_PROPS = {
  range: { type: 'string', enum: ['24h', '3d', '6d', '30d', '90d', 'custom'], description: 'بازه‌ی از پیش‌تعریف‌شده (پیش‌فرض 30d). برای custom باید from و to (میلادی YYYY-MM-DD) بدهید.' },
  from: { type: 'string', description: 'شروع بازه (میلادی YYYY-MM-DD)، فقط با range=custom' },
  to: { type: 'string', description: 'پایان بازه (میلادی YYYY-MM-DD)، فقط با range=custom' },
};
const MONTH_PROPS = {
  year: { type: 'integer', description: 'سال شمسی ۴ رقمی، مثلاً 1405' },
  month: { type: 'integer', description: 'ماه شمسی ۱ تا ۱۲' },
};
const SCOPE_PROPS = {
  userId: { type: 'integer', description: 'فقط یک کارمند (شناسه از list_employees)' },
  department: { type: 'string', description: 'فقط یک دپارتمان' },
};

const TOOLS = [
  {
    name: 'list_employees',
    description: 'فهرست کارمندان قابل‌دسترس برای کاربر جاری (شناسه، نام، دپارتمان). برای تبدیل نام به userId اول این را صدا بزنید.',
    input_schema: { type: 'object', properties: { department: { type: 'string' }, includeInactive: { type: 'boolean' } } },
    run(ctx, input) {
      const users = visibleUsers(ctx.adminUser, { onlyActive: input.includeInactive !== true })
        .filter((u) => !input.department || (u.department || '').trim() === String(input.department).trim());
      return { count: users.length, employees: users.map((u) => ({ id: u.id, fullName: u.full_name, department: u.department || null, role: u.role })) };
    },
  },
  {
    name: 'team_performance',
    description: 'نمای عملکرد همه‌ی کارمندان در یک بازه: مجموع‌ها، نرخ حضور، وقت‌شناسی، تحقق برنامه، میانگین ورود/خروج، رگه‌ی بدون تأخیر، و مقایسه با دوره‌ی قبل. (همان صفحه‌ی «عملکرد کارمندان — تیم»)',
    input_schema: { type: 'object', properties: { ...RANGE_PROPS, department: { type: 'string' } } },
    run(ctx, input) {
      need(ctx, 'performance.read'); requireDates(input);
      const users = visibleUsers(ctx.adminUser, { onlyActive: true }).filter((u) => !input.department || (u.department || '').trim() === String(input.department).trim());
      if (users.length === 0) throw new ToolError('هیچ کارمندی با این فیلتر پیدا نشد.');
      const out = perf.teamOverview({ users, range: rangeOf(input) });
      // sparkline روزانه‌ی هر نفر برای تحلیل کلی لازم نیست و حجم را زیاد می‌کند
      if (Array.isArray(out.rows)) out.rows = out.rows.map(({ spark, ...r }) => r);
      return out;
    },
  },
  {
    name: 'employee_performance',
    description: 'عملکرد کامل یک کارمند در یک بازه با مقایسه‌ی دوره‌ی قبل: نمودارهای ساعت مفید/تأخیر/اضافه‌کاری، بینش‌ها (روز هفته، ساعت ورود، رگه‌ها)، تسک‌ها، مرخصی و اعتراض.',
    input_schema: { type: 'object', properties: { userId: { type: 'integer' }, ...RANGE_PROPS }, required: ['userId'] },
    run(ctx, input) {
      need(ctx, 'performance.read'); requireDates(input);
      const [user] = userFilter(ctx, { userId: input.userId, includeInactive: true });
      return perf.employeePerformance({ user, range: rangeOf(input), includePayroll: false });
    },
  },
  {
    name: 'employee_day',
    description: 'بازرسی یک روز مشخص از یک کارمند: رکورد تردد، بازه‌های حضور، استراحت‌ها، مرخصی/دورکاری، اعتراض و تسک‌های همان روز.',
    input_schema: { type: 'object', properties: { userId: { type: 'integer' }, date: { type: 'string', description: 'میلادی YYYY-MM-DD' } }, required: ['userId', 'date'] },
    run(ctx, input) {
      need(ctx, 'performance.read');
      if (!DATE_RE.test(String(input.date || ''))) throw new ToolError('date باید YYYY-MM-DD باشد.');
      const [user] = userFilter(ctx, { userId: input.userId, includeInactive: true });
      try { return perf.dayInspection({ user, date: input.date, includePayroll: false }); } catch (err) {
        if (err instanceof perf.PerformanceError) throw new ToolError(err.message);
        throw err;
      }
    },
  },
  {
    name: 'late_trend',
    description: 'نمودار روند تأخیر در طول زمان (هفتگی یا ماهانه)، کل یا به‌تفکیک دپارتمان/کارمند.',
    input_schema: {
      type: 'object',
      properties: {
        granularity: { type: 'string', enum: ['week', 'month'] },
        groupBy: { type: 'string', enum: ['none', 'department', 'user'] },
        from: { type: 'string' }, to: { type: 'string' }, ...SCOPE_PROPS,
      },
    },
    run(ctx, input) {
      need(ctx, 'analytics.read'); requireDates(input);
      const granularity = input.granularity || 'week';
      const to = input.to || today();
      const from = input.from || shiftIso(to, granularity === 'month' ? -364 : -83);
      try { return analytics.lateTrend({ users: userFilter(ctx, input), from, to, granularity, groupBy: input.groupBy || 'none' }); } catch (err) {
        if (err instanceof analytics.AnalyticsError) throw new ToolError(err.message);
        throw err;
      }
    },
  },
  {
    name: 'late_compare',
    description: 'مقایسه‌ی تأخیر یک ماه شمسی با ماه قبل (کل یا به‌تفکیک دپارتمان/کارمند).',
    input_schema: { type: 'object', properties: { ...MONTH_PROPS, groupBy: { type: 'string', enum: ['none', 'department', 'user'] }, ...SCOPE_PROPS }, required: ['year', 'month'] },
    run(ctx, input) {
      need(ctx, 'analytics.read');
      const p = yearMonth(input);
      try { return analytics.compareLate({ users: userFilter(ctx, input), year: p.year, month: p.month, groupBy: input.groupBy || 'none' }); } catch (err) {
        if (err instanceof analytics.AnalyticsError) throw new ToolError(err.message);
        throw err;
      }
    },
  },
  {
    name: 'rankings',
    description: 'رتبه‌بندی ماهانه‌ی کارمندان بر اساس اضافه‌کاری (overtime) یا کسری کار (shortfall).',
    input_schema: { type: 'object', properties: { ...MONTH_PROPS, metric: { type: 'string', enum: ['overtime', 'shortfall'] }, limit: { type: 'integer' }, ...SCOPE_PROPS }, required: ['year', 'month'] },
    run(ctx, input) {
      need(ctx, 'analytics.read');
      const p = yearMonth(input);
      const report = monthlyReportFor(userFilter(ctx, input), p.year, p.month);
      const limit = breakdown.parseLimit(input.limit === undefined ? undefined : String(input.limit));
      const body = input.metric === 'shortfall' ? breakdown.rankShortfall(report, { limit }) : breakdown.rankOvertime(report, { limit });
      return { year: p.year, month: p.month, label: report.label, source: report.source, metric: input.metric || 'overtime', ...body };
    },
  },
  {
    name: 'attendance_rate',
    description: 'نرخ حضور ماهانه، کل یا به‌تفکیک دپارتمان/کارمند.',
    input_schema: { type: 'object', properties: { ...MONTH_PROPS, groupBy: { type: 'string', enum: ['none', 'department', 'user'] }, ...SCOPE_PROPS }, required: ['year', 'month'] },
    run(ctx, input) {
      need(ctx, 'analytics.read');
      const p = yearMonth(input);
      const report = monthlyReportFor(userFilter(ctx, input), p.year, p.month);
      return { year: p.year, month: p.month, label: report.label, source: report.source, ...breakdown.attendanceRate(report, { groupBy: input.groupBy || 'none' }) };
    },
  },
  {
    name: 'leave_by_type',
    description: 'توزیع مرخصی ماهانه بر اساس نوع مرخصی، کل یا به‌تفکیک دپارتمان.',
    input_schema: { type: 'object', properties: { ...MONTH_PROPS, groupBy: { type: 'string', enum: ['none', 'department'] }, ...SCOPE_PROPS }, required: ['year', 'month'] },
    run(ctx, input) {
      need(ctx, 'analytics.read');
      const p = yearMonth(input);
      const report = monthlyReportFor(userFilter(ctx, input), p.year, p.month);
      return { year: p.year, month: p.month, label: report.label, source: report.source, ...breakdown.leaveByType(report, { groupBy: input.groupBy || 'none' }) };
    },
  },
  {
    name: 'checkin_distribution',
    description: 'توزیع ساعت ورود (هیستوگرام) در یک بازه (پیش‌فرض ۳۰ روز اخیر).',
    input_schema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' }, binMinutes: { type: 'integer' }, ...SCOPE_PROPS } },
    run(ctx, input) {
      need(ctx, 'analytics.read'); requireDates(input);
      const to = input.to || today();
      const from = input.from || shiftIso(to, -29);
      try { return breakdown.checkinDistribution({ users: userFilter(ctx, input), from, to, binMinutes: input.binMinutes || 30 }); } catch (err) {
        if (err instanceof analytics.AnalyticsError) throw new ToolError(err.message);
        throw err;
      }
    },
  },
  {
    name: 'behavior_patterns',
    description: 'نشانه‌های الگوی رفتاری یک ماه شمسی (مثلاً تأخیرهای پشت‌سرهم، غیبت‌های تکراری) همراه با دلیل هر مورد. این‌ها «نشانه» هستند نه اثبات.',
    input_schema: { type: 'object', properties: { ...MONTH_PROPS, ...SCOPE_PROPS }, required: ['year', 'month'] },
    run(ctx, input) {
      need(ctx, 'analytics.read');
      const p = yearMonth(input);
      return detectPatterns({ users: userFilter(ctx, input), year: p.year, month: p.month });
    },
  },
];

// ابزارهای تکمیلی (تردد/دورکاری/تسک/مرخصی/اعتراض/اضافه‌کاری/شیفت/رویداد مشکوک)
TOOLS.push(...require('./extraTools').build({ need, userFilter, ToolError, today, shiftIso, DATE_RE, getTimezone: () => settingsRepository.getTimezone() }));

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

// توضیح کوتاه انگلیسی برای ارسال به سرویس‌های OpenAI-سازگار: توکن بسیار کمتری از فارسی می‌خورد (سقف توکن در دقیقه‌ی پلن‌های رایگان کم است).
const SHORT_DESC = {
  list_employees: 'List accessible employees (id, name, department). Call first to map a name to userId.',
  team_performance: 'Team overview for a range: attendance rate, punctuality, plan adherence, avg in/out, streaks, vs previous period. range: 24h|3d|6d|30d|90d|custom (with from,to).',
  employee_performance: 'Full performance of one employee for a range vs previous period: useful/late/overtime hours, weekday and check-in insights, tasks, leave, disputes.',
  employee_day: 'Inspect one day of one employee: attendance records, segments, breaks, leave/remote, disputes, tasks.',
  late_trend: 'Lateness trend over time (granularity week|month), optionally grouped by department/user.',
  late_compare: 'Compare lateness of a Jalali month (year, month) with the previous month.',
  rankings: 'Monthly ranking of employees by overtime or shortfall (metric).',
  attendance_rate: 'Monthly attendance rate for a Jalali year/month, optionally grouped.',
  leave_by_type: 'Monthly leave distribution by leave type.',
  checkin_distribution: 'Histogram of check-in times in a range (default last 30 days).',
  behavior_patterns: 'Behavioral pattern signals for a Jalali month (consecutive lateness, repeated absences). Signals, not proof.',
  attendance_log: 'Attendance records (in/out times, worked and break minutes) for a range. With userId: per-day rows; otherwise per-employee summary.',
  remote_work: 'Remote-work sessions (times, approval status, duration) in a range.',
  tasks_overview: 'Tasks and weekly plans: planned, done/partial/not-done, reasons, urgent, plan submission. With userId also lists the tasks.',
  leave_requests: 'Leave/mission requests overlapping a range with status summary. With userId and year (Jalali) also leave balances.',
  disputes: 'Employee disputes about attendance records: open/resolved counts, messages, times.',
  overtime_decisions: 'Overtime approve/reject decisions with reasons in a range.',
  shifts_holidays: 'Defined shifts, holidays and per-day schedule overrides; with userId also that employee shift.',
  suspicious_events: 'System-flagged suspicious events (same IP, device change) with review status.',
  payroll_summary: 'Monthly payroll for a Jalali year/month: hourly rate (thousand toman/hour), useful and overtime minutes, amount (toman), previous month, department totals. With userId also daily breakdown. Sensitive: use only when the manager asks about pay.',
  org_overview: 'Organization structure: employees per department, roles, managers with team sizes, inactive count.',
  panel_settings: 'Company settings of the panel (work hours, overtime, leave, reminders, planning...). Optional group filter.',
  audit_trail: 'Recent admin/system actions (who did what, when) in a range; optional actor userId or action text.',
  system_status: 'Month closing status of recent Jalali months, failed background jobs, firing monitor alerts.',
  checkin_permissions: 'Late check-in permission requests with status, reasons and decisions in a range.',
};

/** تعریف ابزارها. compact=true ⇒ توضیح کوتاه انگلیسی (برای سرویس‌های OpenAI-سازگار) */
function toolDefinitions({ compact = false } = {}) {
  return TOOLS.filter((t) => !t.financial || config.ai.allowPayroll)
    .map(({ name, description, input_schema: schema }) => ({ name, description: (compact && SHORT_DESC[name]) || description, input_schema: schema }));
}

/** اجرای یک ابزار ⇒ { text, isError }؛ هرگز throw نمی‌کند (خطا به مدل برمی‌گردد). */
function runTool(ctx, name, input) {
  const tool = BY_NAME.get(name);
  if (!tool) return { text: `ابزار «${name}» وجود ندارد.`, isError: true };
  try {
    const safeInput = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    if (tool.financial && !config.ai.allowPayroll) return { text: 'دسترسی ایجنت به حقوق غیرفعال است.', isError: true };
    const raw = tool.run(ctx, safeInput);
    let text = JSON.stringify(tool.financial ? raw : stripFinancial(raw)); // فقط ابزار مالیِ مجازشده، خروجی‌اش stripFinancial نمی‌شود
    if (text.length > MAX_RESULT_CHARS) {
      text = `${text.slice(0, MAX_RESULT_CHARS)}…[خروجی بریده شد؛ بازه یا دامنه را کوچک‌تر کنید (یک کارمند/دپارتمان/بازه‌ی کوتاه‌تر)]`;
    }
    return { text, isError: false };
  } catch (err) {
    if (err instanceof ToolError) return { text: err.message, isError: true };
    return { text: 'خطای داخلی هنگام خواندن داده.', isError: true, internal: err };
  }
}

module.exports = { toolDefinitions, runTool, stripFinancial, TOOLS, ToolError, MAX_RESULT_CHARS };

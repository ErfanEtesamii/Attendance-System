// ابزارهای ایجنت هوش مصنوعی: همان داده‌ی پشت نمودارهای پنل، فقط‌خواندنی و با اسکوپ نقشِ کاربرِ پرسنده.
//
// قراردادها:
//   • هیچ محاسبه‌ی تازه‌ای نیست؛ همه‌چیز از سرویس‌های موجود (performanceService / analyticsService / ...) می‌آید، پس عددهایی که ایجنت می‌بیند
//     دقیقاً همان عددهای نمودارهاست.
//   • هر ابزار مجوز خودش را جدا چک می‌کند (performance.read / analytics.read) و کاربران را با visibleUsers/canAccessUser محدود می‌کند.
//   • حقوق و نرخ ساعتی هرگز به مدل نمی‌رسد (includePayroll=false + حذف بازگشتیِ کلیدهای مالی).
//   • ورودی ابزار از مدل می‌آید ⇒ نامعتبر فرض می‌شود و اعتبارسنجی می‌شود؛ خطا به‌صورت متن به مدل برمی‌گردد تا خودش اصلاح کند.

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

const MAX_RESULT_CHARS = 40000;
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

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

/** تعریف ابزارها به قالب Messages API */
function toolDefinitions() {
  return TOOLS.map(({ name, description, input_schema: schema }) => ({ name, description, input_schema: schema }));
}

/** اجرای یک ابزار ⇒ { text, isError }؛ هرگز throw نمی‌کند (خطا به مدل برمی‌گردد). */
function runTool(ctx, name, input) {
  const tool = BY_NAME.get(name);
  if (!tool) return { text: `ابزار «${name}» وجود ندارد.`, isError: true };
  try {
    const safeInput = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    let text = JSON.stringify(stripFinancial(tool.run(ctx, safeInput)));
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

// خروجی xlsx «حقوق و دستمزد» و «عملکرد کارکنان» — فقط ساخت داده‌ی شیت‌ها (بدون HTTP و بدون exceljs).
//
// ورودی: خروجی performanceService (monthlyPayrollCompared با withDays / teamDetailed). هیچ محاسبه‌ی تازه‌ای اینجا نیست؛ فقط نگاشت فیلد به ستون.
// اسکوپ و مجوز را route تعیین می‌کند (payroll.read / performance.read ⇒ فقط admin/owner). نرخ ساعتی فقط در خروجی حقوق (و در عملکرد فقط با includePayroll) می‌آید.
// قالب: مثل monthlyExportService هر شیت با «تعریف ستون‌ها» [header، توضیح، تابع مقدار] ساخته می‌شود و شیت «راهنما» از همان تعریف‌ها تولید می‌شود.
// مدت‌ها هم «دقیقه» (عدد قابل جمع) و هم «ساعت:دقیقه» (متن)؛ مبلغ‌ها به تومان (نرخ ساعتی به هزار تومان).

const { isoDateToJalaliString } = require('../utils/jalali');
const { minutesToHHMM } = require('../api/routes/admin/common');
const { DAY_STATUS } = require('./monthlyExportService');

const WEEKDAYS = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'];
const weekday = (iso) => { try { return iso ? WEEKDAYS[(new Date(`${iso}T00:00:00Z`).getUTCDay() + 1) % 7] : ''; } catch (_) { return ''; } };
const jalali = (iso) => { try { return iso ? isoDateToJalaliString(iso) : ''; } catch (_) { return ''; } };
const hhmm = (m) => (m === null || m === undefined || Number.isNaN(m) ? '' : minutesToHHMM(m));
const num = (v) => (v === null || v === undefined || Number.isNaN(v) ? '' : v);
const clock = (m) => (m === null || m === undefined || Number.isNaN(m) ? '' : `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.round(m % 60)).padStart(2, '0')}`);
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : '');
const sum = (arr) => arr.reduce((t, v) => t + (v || 0), 0);
const ROLE = { employee: 'کارمند', manager: 'سرپرست', admin: 'ادمین', owner: 'مالک', hr: 'منابع انسانی' };
const EXCLUDE_REASON = { open_dispute: 'اعتراض باز', missing_checkout: 'ورود بدون خروج' };
const APPROVAL = { not_required: 'نیاز به تأیید ندارد', none: '—', pending: 'معلق', approved: 'تأییدشده', rejected: 'ردشده' };
const LEAVE_STATUS = { pending: 'در انتظار', approved: 'تأییدشده', rejected: 'ردشده' };
const LEAVE_KIND = { leave: 'مرخصی', mission: 'مأموریت' };
const FLAG = { missing_checkout: 'بدون خروج', invalid_time: 'زمان نامعتبر', long_open_break: 'استراحت بسته‌نشده', outside_shift: 'خارج از شیفت' };
const TASK_STATUS = { done: 'انجام‌شده', partial: 'نیمه‌کاره', not_done: 'انجام‌نشده' };

const sheetFrom = (name, columns, rows) => ({ name, headers: columns.map((c) => c[0]), rows: rows.map((r) => columns.map((c) => c[2](r))) });

function guideSheet(defs) {
  const rows = [];
  for (const [sheetName, cols] of defs) for (const c of cols) rows.push([sheetName, c[0], c[1]]);
  rows.push(['همه‌ی شیت‌ها', 'خالی بودن مقدار', 'مقدار خالی یعنی آن ستون برای آن ردیف معنا ندارد (مثلاً نرخ ثبت‌نشده) نه صفر.']);
  return { name: 'راهنما', headers: ['شیت', 'ستون', 'تعریف'], rows };
}

const generatedAt = (opts) => (opts && opts.generatedAt ? new Date(opts.generatedAt) : new Date()).toISOString();

// =====================================================================================
// حقوق و دستمزد ماهانه
// =====================================================================================
const IDENT = [
  ['نام کارمند', 'نام و نام خانوادگی.', (r) => r.fullName],
  ['کد پرسنلی', 'کد پرسنلی ثبت‌شده.', (r) => r.code],
  ['دپارتمان', 'دپارتمان کارمند.', (r) => r.department],
];

const PAY_SUMMARY = [
  ...IDENT,
  ['نرخ ساعتی (هزار تومان)', 'نرخ ثبت‌شده برای کارمند؛ خالی یعنی نرخ ثبت نشده و حقوق محاسبه نمی‌شود.', (r) => num(r.rateKt)],
  ['نرخ ساعتی (تومان)', 'نرخ ساعتی به تومان (= هزار تومان × ۱۰۰۰).', (r) => (r.rateKt == null ? '' : r.rateKt * 1000)],
  ['روز کاری ماه', 'تعداد روزهای کاری ماه طبق تقویم/شیفت.', (r) => num(r.totalWorkDays)],
  ['روز کاری سپری‌شده', 'روزهای کاریِ گذشته (پیش از امروز) تا لحظه‌ی گزارش.', (r) => num(r.elapsedWorkDays)],
  ['روز دارای کارکرد', 'روزهایی که ساعت مفید محاسبه‌شده داشته‌اند (روز خارج‌شده شمرده نمی‌شود).', (r) => r.workedDays],
  ['ساعت مفید (دقیقه)', 'مجموع ساعت مفید (با مأموریت) پس از استثناها؛ مبنای حقوق.', (r) => r.usefulMinutes],
  ['ساعت مفید (ساعت:دقیقه)', 'همان ستون قبل به‌صورت ساعت:دقیقه.', (r) => hhmm(r.usefulMinutes)],
  ['میانگین مفید هر روز (دقیقه)', 'ساعت مفید ÷ روز دارای کارکرد.', (r) => (r.workedDays ? Math.round(r.usefulMinutes / r.workedDays) : '')],
  ['اضافه‌کاری (دقیقه)', 'اضافه‌کاری نهایی (پس از تأیید و سقف) که درون ساعت مفید شمرده شده است.', (r) => r.overtimeMinutes],
  ['دقیقه تأخیر', 'مجموع تأخیر ورود ماه.', (r) => num(r.lateMinutes)],
  ['دقیقه کسری', 'مجموع کسری کار ماه (غیبت = کل مورد انتظار).', (r) => num(r.shortfallMinutes)],
  ['حقوق (تومان)', 'ساعت مفید × نرخ ساعتی؛ همان فرمول «کارکرد تخمینی» Mini App. خالی اگر نرخ ثبت نشده.', (r) => num(r.amountToman)],
  ['میانگین حقوق هر روز (تومان)', 'حقوق ÷ روز دارای کارکرد.', (r) => num(r.avgPerWorkedDayToman)],
  ['سهم از کل حقوق (٪)', 'سهم این نفر از جمع حقوق کارمندان این خروجی.', (r) => (r.amountToman != null ? pct(r.amountToman, r.totalAmount) : '')],
  ['حقوق ماه قبل (تومان)', 'حقوق همین کارمند در ماه شمسی قبل (با نرخ فعلی).', (r) => num(r.previousAmountToman)],
  ['تغییر نسبت به ماه قبل (تومان)', 'حقوق این ماه منهای ماه قبل.', (r) => (r.amountToman != null && r.previousAmountToman != null ? r.amountToman - r.previousAmountToman : '')],
  ['تغییر نسبت به ماه قبل (٪)', 'درصد تغییر؛ خالی اگر ماه قبل صفر/نامشخص.', (r) => (r.amountToman != null && r.previousAmountToman ? Math.round(((r.amountToman - r.previousAmountToman) / r.previousAmountToman) * 1000) / 10 : '')],
  ['ساعت مفید ماه قبل (دقیقه)', 'ساعت مفید ماه قبل.', (r) => num(r.previousUsefulMinutes)],
  ['پیش‌بینی پایان ماه (تومان)', 'فقط ماه جاری: میانگین روزانه‌ی تاکنون × کل روزهای کاری ماه.', (r) => num(r.projectedAmountToman)],
  ['تعداد روز خارج‌شده', 'روزهایی که به‌خاطر اعتراض باز یا ورود بدون خروج در حقوق نیامده‌اند.', (r) => r.excludedDays.length],
  ['تاریخ روزهای خارج‌شده', 'فهرست تاریخ شمسی روزهای خارج‌شده.', (r) => r.excludedDays.map((d) => jalali(d.date)).join('، ')],
  ['وضعیت', 'توضیح خودکار: بدون نرخ / دارای روز خارج‌شده / عادی.', (r) => (r.rateKt == null ? 'بدون نرخ' : (r.excludedDays.length ? 'دارای روز خارج‌شده' : 'عادی'))],
];

const PAY_DAILY = [
  ...IDENT,
  ['تاریخ میلادی', 'تاریخ مرجع (YYYY-MM-DD).', (r) => r.d.date],
  ['تاریخ شمسی', 'همان روز به تاریخ شمسی.', (r) => jalali(r.d.date)],
  ['روز هفته', 'نام روز هفته.', (r) => weekday(r.d.date)],
  ['وضعیت روز', 'وضعیت انحصاری روز.', (r) => DAY_STATUS[r.d.status] || r.d.status || ''],
  ['ساعت مفید (دقیقه)', 'ساعت مفید آن روز؛ برای روز خارج‌شده صفر.', (r) => r.d.usefulMinutes],
  ['ساعت مفید (ساعت:دقیقه)', 'همان ستون قبل به‌صورت ساعت:دقیقه.', (r) => hhmm(r.d.usefulMinutes)],
  ['اضافه‌کاری (دقیقه)', 'اضافه‌کاری نهایی آن روز.', (r) => r.d.overtimeMinutes],
  ['نرخ ساعتی (هزار تومان)', 'نرخ کارمند.', (r) => num(r.rateKt)],
  ['مبلغ روز (تومان)', 'هر روز جدا گرد می‌شود؛ جمع روزها ممکن است با «حقوق» چند تومان اختلاف گرد‌کردن داشته باشد.', (r) => num(r.d.amountToman)],
  ['علت خروج از محاسبه', 'اگر روز در حقوق نیامده: اعتراض باز / ورود بدون خروج.', (r) => (r.d.excluded ? (EXCLUDE_REASON[r.d.excluded] || r.d.excluded) : '')],
];

const PAY_DEPT = [
  ['دپارتمان', 'نام دپارتمان.', (r) => r.department],
  ['تعداد کارمند', 'کارمندان این خروجی در دپارتمان.', (r) => r.employees],
  ['کارمند دارای نرخ', 'کارمندانی که نرخ ساعتی دارند.', (r) => r.priced],
  ['ساعت مفید (دقیقه)', 'مجموع ساعت مفید.', (r) => r.usefulMinutes],
  ['ساعت مفید (ساعت:دقیقه)', 'همان ستون قبل.', (r) => hhmm(r.usefulMinutes)],
  ['جمع حقوق (تومان)', 'مجموع حقوق دپارتمان.', (r) => r.amountToman],
  ['میانگین هر نفر (تومان)', 'جمع حقوق ÷ تعداد کارمند دارای نرخ.', (r) => (r.priced ? Math.round(r.amountToman / r.priced) : '')],
  ['میانگین هر ساعت (تومان)', 'جمع حقوق ÷ ساعت مفید.', (r) => (r.usefulMinutes ? Math.round(r.amountToman / (r.usefulMinutes / 60)) : '')],
  ['سهم از کل حقوق (٪)', 'سهم دپارتمان از جمع.', (r) => pct(r.amountToman, r.total)],
];

const PAY_EXCLUDED = [
  ...IDENT,
  ['تاریخ میلادی', 'روز خارج‌شده.', (r) => r.date],
  ['تاریخ شمسی', 'همان روز به شمسی.', (r) => jalali(r.date)],
  ['علت', 'اعتراض باز / ورود بدون خروج؛ تا رفع علت (حل اعتراض یا اصلاح رکورد) در حقوق نمی‌آید.', (r) => EXCLUDE_REASON[r.reason] || r.reason],
];

/**
 * @param {object} data خروجی performanceService.monthlyPayrollCompared (با withDays: true)
 * @returns {Array<{name:string, headers:string[], rows:any[][]}>}
 */
function buildPayrollSheets(data, opts = {}) {
  const total = (data.totals && data.totals.amountToman) || 0;
  const people = data.rows.map((r) => ({
    ...r,
    fullName: r.user.fullName || '', code: r.user.personnelCode || '', department: r.user.department || '', totalAmount: total,
  }));
  const idOf = (r) => ({ fullName: r.user.fullName || '', code: r.user.personnelCode || '', department: r.user.department || '' });

  const dailyRows = [];
  const excludedRows = [];
  for (const r of data.rows) {
    for (const d of r.days || []) dailyRows.push({ ...idOf(r), rateKt: r.rateKt, d });
    for (const e of r.excludedDays || []) excludedRows.push({ ...idOf(r), ...e });
  }
  const depts = (data.departments || []).map((d) => ({
    ...d,
    priced: data.rows.filter((r) => (r.user.department || 'بدون دپارتمان') === d.department && r.amountToman != null).length,
    total,
  }));

  const summary = sheetFrom('حقوق کارکنان', PAY_SUMMARY, people);
  // ردیف جمع (ستون‌های متنی خالی)
  const t = data.totals || {};
  const at = (title) => summary.headers.indexOf(title);
  const totalRow = summary.headers.map(() => '');
  totalRow[0] = 'جمع';
  const put = (title, v) => { const i = at(title); if (i >= 0) totalRow[i] = v; };
  put('ساعت مفید (دقیقه)', t.usefulMinutes); put('ساعت مفید (ساعت:دقیقه)', hhmm(t.usefulMinutes));
  put('اضافه‌کاری (دقیقه)', t.overtimeMinutes); put('حقوق (تومان)', t.amountToman);
  put('تعداد روز خارج‌شده', t.excludedDays); put('پیش‌بینی پایان ماه (تومان)', num(t.projectedAmountToman));
  put('حقوق ماه قبل (تومان)', num(data.previous && data.previous.totals ? data.previous.totals.amountToman : null));
  put('دقیقه تأخیر', sum(data.rows.map((r) => r.lateMinutes))); put('دقیقه کسری', sum(data.rows.map((r) => r.shortfallMinutes)));
  put('روز دارای کارکرد', sum(data.rows.map((r) => r.workedDays)));
  if (people.length) summary.rows.push(totalRow);

  const daily = sheetFrom('ریز روزانه حقوق', PAY_DAILY, dailyRows);
  const dept = sheetFrom('دپارتمان‌ها', PAY_DEPT, depts);
  const excluded = sheetFrom('روزهای خارج‌شده', PAY_EXCLUDED, excludedRows);

  const meta = {
    name: 'مشخصات گزارش',
    headers: ['مورد', 'مقدار'],
    rows: [
      ['ماه شمسی', data.label], ['سال شمسی', data.year], ['شماره ماه', data.month],
      ['از (میلادی)', data.from], ['تا (میلادی)', data.to], ['«امروز» در محاسبه', data.today],
      ['تعداد کارمند', t.employees], ['کارمند بدون نرخ', t.withoutRate],
      ['جمع حقوق (تومان)', t.amountToman], ['میانگین هر نفر (تومان)', num(t.averageToman)], ['میانه (تومان)', num(t.medianToman)],
      ['پیش‌بینی پایان ماه (تومان)', num(t.projectedAmountToman)],
      ['جمع ساعت مفید (دقیقه)', t.usefulMinutes], ['جمع اضافه‌کاری (دقیقه)', t.overtimeMinutes],
      ['روز خارج‌شده از محاسبه', t.excludedDays],
      ['ماه مقایسه', data.previous ? data.previous.label : ''], ['جمع حقوق ماه مقایسه (تومان)', data.previous && data.previous.totals ? num(data.previous.totals.amountToman) : ''],
      ['فرمول حقوق', 'ساعت مفید (با مأموریت، دقیقه) × نرخ ساعتی (هزار تومان) × ۱۰۰۰ ÷ ۶۰؛ روز دارای اعتراض باز و روز «ورود بدون خروج» محاسبه نمی‌شود.'],
      ['توجه', 'این فایل محرمانه است (نرخ و حقوق افراد). فقط ادمین امکان دریافت دارد و دریافت آن در گزارش ممیزی ثبت می‌شود.'],
      ['زمان تهیه‌ی فایل (UTC)', generatedAt(opts)],
    ],
  };
  const guide = guideSheet([['حقوق کارکنان', PAY_SUMMARY], ['ریز روزانه حقوق', PAY_DAILY], ['دپارتمان‌ها', PAY_DEPT], ['روزهای خارج‌شده', PAY_EXCLUDED]]);
  return [summary, daily, dept, excluded, meta, guide];
}

// =====================================================================================
// عملکرد کارکنان (بازه‌ی دلخواه)
// =====================================================================================
const PERF_SUMMARY = (withPay) => [
  ['رتبه (تحقق ساعت)', 'رتبه بر اساس «درصد تحقق ساعت کاری» (۱ = بهترین)؛ خالی اگر قابل محاسبه نیست.', (p) => num(p.rank)],
  ['نام کارمند', 'نام و نام خانوادگی.', (p) => p.user.fullName || ''],
  ['کد پرسنلی', 'کد پرسنلی.', (p) => p.user.personnelCode || ''],
  ['دپارتمان', 'دپارتمان.', (p) => p.user.department || ''],
  ['نقش', 'نقش در سیستم.', (p) => ROLE[p.user.role] || p.user.role || ''],
  ['وضعیت حساب', 'فعال/غیرفعال.', (p) => (p.user.isActive ? 'فعال' : 'غیرفعال')],
  ['روز کاری سپری‌شده', 'روزهای کاری گذشته در بازه.', (p) => p.insights.workingDays],
  ['روز حضور', 'روزهای حاضر یا با تأخیر.', (p) => p.insights.presentDays],
  ['روز غیبت', 'روزهای کاریِ گذشته بدون ورود/مرخصی/مأموریت.', (p) => p.insights.absentDays],
  ['روز تأخیر', 'روزهایی که تأخیر داشته است.', (p) => p.insights.lateDays],
  ['درصد حضور', 'حضور ÷ (حضور + غیبت).', (p) => num(p.insights.attendanceRate)],
  ['درصد وقت‌شناسی', '(حضور − تأخیر) ÷ حضور.', (p) => num(p.insights.punctualityRate)],
  ['درصد تحقق ساعت کاری', 'ساعت مفید ÷ مورد انتظار در روزهای تمام‌شده.', (p) => num(p.insights.fulfillmentRate)],
  ['ساعت مورد انتظار (دقیقه)', 'مجموع ساعت کاری مورد انتظار بازه.', (p) => p.totals.expected],
  ['ساعت مفید (دقیقه)', 'مجموع ساعت مفید (با مأموریت).', (p) => p.totals.useful],
  ['ساعت مفید (ساعت:دقیقه)', 'همان ستون قبل.', (p) => hhmm(p.totals.useful)],
  ['میانگین مفید روزانه (دقیقه)', 'میانگین در روزهای دارای کارکرد.', (p) => num(p.insights.avgDailyUseful)],
  ['کسری (دقیقه)', 'مجموع کسری کار.', (p) => p.totals.shortfall],
  ['دقیقه تأخیر', 'مجموع تأخیر ورود.', (p) => p.totals.late],
  ['دقیقه زودتر رفتن', 'مجموع خروج زودهنگام.', (p) => p.totals.earlyLeave],
  ['اضافه‌کاری نهایی (دقیقه)', 'پس از تأیید و سقف.', (p) => p.totals.overtime],
  ['اضافه‌کاری معلق (دقیقه)', 'منتظر تأیید.', (p) => p.insights.overtime.pending],
  ['اضافه‌کاری ردشده (دقیقه)', 'ردشده.', (p) => p.insights.overtime.rejected],
  ['روز دارای اضافه‌کاری', 'تعداد روزهای اضافه‌کاری.', (p) => p.insights.overtime.days],
  ['استراحت (دقیقه)', 'مجموع استراحت‌ها.', (p) => p.totals.breaks],
  ['دورکاری (دقیقه)', 'مجموع دورکاری تأییدشده.', (p) => p.totals.remote],
  ['روز دورکاری', 'روزهایی که دورکاری داشته است.', (p) => p.insights.remoteDays],
  ['میانگین ساعت ورود', 'میانگین ساعت ورود (وقت شرکت).', (p) => clock(p.insights.avgCheckIn)],
  ['میانگین ساعت خروج', 'میانگین ساعت خروج.', (p) => clock(p.insights.avgCheckOut)],
  ['زودترین ورود', 'زودترین ساعت ورود.', (p) => clock(p.insights.earliestCheckIn)],
  ['دیرترین ورود', 'دیرترین ساعت ورود.', (p) => clock(p.insights.latestCheckIn)],
  ['پراکندگی ساعت ورود (دقیقه)', 'انحراف معیار ساعت ورود؛ کمتر = منظم‌تر.', (p) => num(p.insights.checkInSpread)],
  ['بلندترین رگه‌ی حضور (روز)', 'بیشترین روز پیاپیِ حاضر.', (p) => p.insights.streakPresent.longest],
  ['بلندترین رگه‌ی به‌موقع (روز)', 'بیشترین روز پیاپیِ بدون تأخیر.', (p) => p.insights.streakOnTime.longest],
  ['بهترین روز', 'روز با بیشترین ساعت مفید.', (p) => (p.insights.bestDay ? `${jalali(p.insights.bestDay.date)} (${hhmm(p.insights.bestDay.useful)})` : '')],
  ['ضعیف‌ترین روز', 'روز با بیشترین تأخیر+کسری.', (p) => (p.insights.worstDay ? `${jalali(p.insights.worstDay.date)} (تأخیر ${p.insights.worstDay.late}، کسری ${p.insights.worstDay.shortfall} دقیقه)` : '')],
  ['تسک‌های کل', 'تسک‌های برنامه‌ی هفتگی در بازه (بدون «خارج از برنامه»).', (p) => p.tasks.total],
  ['تسک انجام‌شده', 'وضعیت انجام‌شده.', (p) => p.tasks.done],
  ['تسک نیمه‌کاره', 'وضعیت نیمه‌کاره.', (p) => p.tasks.partial],
  ['تسک انجام‌نشده', 'وضعیت انجام‌نشده.', (p) => p.tasks.notDone],
  ['تسک حذف‌شده', 'تسک‌هایی که حذف شده‌اند (در کل نمی‌آیند).', (p) => p.tasks.dropped],
  ['تسک منتقل‌شده', 'به روز دیگر منتقل شده.', (p) => p.tasks.carried],
  ['گزارش با تأخیر', 'تسک‌هایی که با تأخیر گزارش شده‌اند.', (p) => p.tasks.answeredLate],
  ['درصد تکمیل تسک', 'انجام‌شده + نیمی از نیمه‌کاره ÷ کل.', (p) => num(p.tasks.completionRate)],
  ['مرخصی تأییدشده (تعداد)', 'درخواست‌های مرخصی تأییدشده که با بازه هم‌پوشانی دارند.', (p) => p.leaves.filter((l) => l.kind === 'leave' && l.status === 'approved').length],
  ['مأموریت تأییدشده (تعداد)', 'مأموریت‌های تأییدشده.', (p) => p.leaves.filter((l) => l.kind === 'mission' && l.status === 'approved').length],
  ['درخواست در انتظار', 'مرخصی/مأموریت در انتظار.', (p) => p.leaves.filter((l) => l.status === 'pending').length],
  ['اعتراض باز', 'اعتراض‌های ثبت‌شده در بازه که هنوز باز است.', (p) => p.disputes.open],
  ['اعتراض حل‌شده', 'اعتراض‌های حل‌شده.', (p) => p.disputes.resolved],
  ['ساعت مفید دوره‌ی قبل (دقیقه)', 'همان طول بازه، بلافاصله قبل از شروع.', (p) => p.previousTotals.useful],
  ['تغییر ساعت مفید نسبت به دوره‌ی قبل (٪)', 'درصد تغییر؛ خالی اگر دوره‌ی قبل صفر.', (p) => (p.previousTotals.useful ? Math.round(((p.totals.useful - p.previousTotals.useful) / p.previousTotals.useful) * 1000) / 10 : '')],
  ...(withPay ? [
    ['نرخ ساعتی (هزار تومان)', 'نرخ ثبت‌شده (فقط ادمین).', (p) => num(p.payroll && p.payroll.rateKt)],
    ['حقوق بازه (تومان)', 'ساعت مفید × نرخ؛ خالی اگر نرخ ثبت نشده.', (p) => num(p.payroll && p.payroll.amountToman)],
    ['حقوق دوره‌ی قبل (تومان)', 'همان محاسبه برای دوره‌ی قبل.', (p) => num(p.payroll && p.payroll.previousAmountToman)],
    ['روز خارج‌شده از حقوق', 'اعتراض باز / ورود بدون خروج.', (p) => (p.payroll ? p.payroll.excludedDays.length : '')],
  ] : []),
];

const PERF_DAILY = (withPay) => [
  ['نام کارمند', 'نام.', (r) => r.p.user.fullName || ''],
  ['کد پرسنلی', 'کد پرسنلی.', (r) => r.p.user.personnelCode || ''],
  ['دپارتمان', 'دپارتمان.', (r) => r.p.user.department || ''],
  ['تاریخ میلادی', 'تاریخ مرجع.', (r) => r.d.date],
  ['تاریخ شمسی', 'تاریخ شمسی.', (r) => jalali(r.d.date)],
  ['روز هفته', 'نام روز هفته.', (r) => weekday(r.d.date)],
  ['وضعیت', 'وضعیت انحصاری روز.', (r) => DAY_STATUS[r.d.status] || r.d.status || ''],
  ['ساعت ورود', 'به وقت شرکت.', (r) => clock(r.d.checkIn)],
  ['ساعت خروج', 'به وقت شرکت؛ خالی اگر خروج ثبت نشده.', (r) => clock(r.d.checkOut)],
  ['مورد انتظار (دقیقه)', 'ساعت کاری مورد انتظار آن روز.', (r) => r.d.expected],
  ['ساعت مفید (دقیقه)', 'ساعت مفید با مأموریت.', (r) => r.d.useful],
  ['ساعت مفید (ساعت:دقیقه)', 'همان ستون قبل.', (r) => hhmm(r.d.useful)],
  ['کسری (دقیقه)', 'کسری کار آن روز.', (r) => r.d.shortfall],
  ['تأخیر (دقیقه)', 'تأخیر ورود.', (r) => r.d.late],
  ['زودتر رفتن (دقیقه)', 'خروج زودهنگام.', (r) => r.d.earlyLeave],
  ['استراحت (دقیقه)', 'با حقوق + بدون حقوق.', (r) => r.d.breaks],
  ['مرخصی/مأموریت (دقیقه)', 'پنجره‌ی مرخصی/مأموریت آن روز.', (r) => r.d.leave],
  ['دورکاری (دقیقه)', 'دورکاری تأییدشده.', (r) => r.d.remote],
  ['اضافه‌کاری خام (دقیقه)', 'پیش از تأیید/سقف.', (r) => r.d.otRaw],
  ['وضعیت تأیید اضافه‌کاری', 'نیاز ندارد / معلق / تأییدشده / ردشده.', (r) => (r.d.otApproval ? (APPROVAL[r.d.otApproval] || r.d.otApproval) : '')],
  ['اضافه‌کاری نهایی (دقیقه)', 'پس از تأیید و سقف.', (r) => r.d.overtime],
  ['تسک کل', 'تعداد تسک آن روز.', (r) => r.d.tasksTotal],
  ['تسک انجام‌شده', 'تسک‌های انجام‌شده.', (r) => r.d.tasksDone],
  ['پرچم‌ها', 'هشدارهای داده.', (r) => (r.d.flags || []).map((f) => FLAG[f] || f).join('، ')],
  ...(withPay ? [['مبلغ روز (تومان)', 'مبلغ همان روز (فقط ادمین).', (r) => (r.pay ? num(r.pay.amountToman) : '')]] : []),
];

const PERF_TREND = [
  ['تاریخ میلادی', 'تاریخ مرجع.', (r) => r.date],
  ['تاریخ شمسی', 'تاریخ شمسی.', (r) => jalali(r.date)],
  ['روز هفته', 'نام روز.', (r) => weekday(r.date)],
  ['حاضر', 'تعداد کارمند حاضر.', (r) => r.present],
  ['غایب', 'تعداد کارمند غایب.', (r) => r.absent],
  ['با تأخیر', 'تعداد کارمند دارای تأخیر.', (r) => r.lateCount],
  ['مجموع تأخیر (دقیقه)', 'جمع تأخیر همه.', (r) => r.late],
  ['ساعت مفید (دقیقه)', 'جمع ساعت مفید همه.', (r) => r.useful],
  ['ساعت مفید (ساعت:دقیقه)', 'همان ستون قبل.', (r) => hhmm(r.useful)],
  ['کسری (دقیقه)', 'جمع کسری.', (r) => r.shortfall],
  ['اضافه‌کاری (دقیقه)', 'جمع اضافه‌کاری نهایی.', (r) => r.overtime],
  ['استراحت (دقیقه)', 'جمع استراحت.', (r) => r.breaks],
  ['درصد حضور آن روز', 'حاضر ÷ (حاضر + غایب).', (r) => pct(r.present, r.present + r.absent)],
];

const PERF_DEPT = [
  ['دپارتمان', 'نام دپارتمان.', (r) => r.department],
  ['تعداد کارمند', 'تعداد.', (r) => r.employees],
  ['روز حضور', 'مجموع روز حضور.', (r) => r.presentDays],
  ['روز غیبت', 'مجموع غیبت.', (r) => r.absentDays],
  ['روز تأخیر', 'مجموع روز تأخیر.', (r) => r.lateDays],
  ['درصد حضور', 'حضور ÷ (حضور + غیبت).', (r) => pct(r.presentDays, r.presentDays + r.absentDays)],
  ['درصد وقت‌شناسی', '(حضور − تأخیر) ÷ حضور.', (r) => pct(r.presentDays - r.lateDays, r.presentDays)],
  ['ساعت مورد انتظار (دقیقه)', 'جمع.', (r) => r.expected],
  ['ساعت مفید (دقیقه)', 'جمع.', (r) => r.useful],
  ['ساعت مفید (ساعت:دقیقه)', 'همان ستون قبل.', (r) => hhmm(r.useful)],
  ['درصد تحقق', 'مفید ÷ مورد انتظار.', (r) => pct(r.useful, r.expected)],
  ['کسری (دقیقه)', 'جمع.', (r) => r.shortfall],
  ['دقیقه تأخیر', 'جمع.', (r) => r.late],
  ['اضافه‌کاری (دقیقه)', 'جمع.', (r) => r.overtime],
  ['میانگین مفید هر نفر (دقیقه)', 'مفید ÷ تعداد کارمند.', (r) => (r.employees ? Math.round(r.useful / r.employees) : '')],
  ['تسک کل', 'جمع تسک.', (r) => r.tasksTotal],
  ['تسک انجام‌شده', 'جمع.', (r) => r.tasksDone],
  ['درصد تکمیل تسک', 'انجام‌شده ÷ کل.', (r) => pct(r.tasksDone, r.tasksTotal)],
];

const PERF_WEEKDAY = [
  ['نام کارمند', 'نام.', (r) => r.fullName],
  ['کد پرسنلی', 'کد پرسنلی.', (r) => r.code],
  ['روز هفته', 'شنبه تا جمعه.', (r) => WEEKDAYS[r.w.weekday]],
  ['تعداد روز کاری', 'روزهای کاری این روز هفته در بازه.', (r) => r.w.days],
  ['میانگین مفید (دقیقه)', 'میانگین ساعت مفید در این روز هفته.', (r) => r.w.avgUseful],
  ['روز تأخیر', 'تعداد تأخیر.', (r) => r.w.lateDays],
  ['روز غیبت', 'تعداد غیبت.', (r) => r.w.absentDays],
  ['میانگین ساعت ورود', 'میانگین ورود در این روز هفته.', (r) => clock(r.w.avgCheckIn)],
];

const PERF_TASKS = [
  ['نام کارمند', 'نام.', (r) => r.fullName],
  ['کد پرسنلی', 'کد پرسنلی.', (r) => r.code],
  ['دپارتمان', 'دپارتمان.', (r) => r.department],
  ['نوع', '«علت» = علت انجام‌نشدن (تجمیعی)؛ «تسک» = ریز تسک‌های اخیرِ ناقص.', (r) => r.kind],
  ['تاریخ شمسی', 'برای ریز تسک.', (r) => r.date],
  ['عنوان / علت', 'عنوان تسک یا متن علت.', (r) => r.title],
  ['وضعیت', 'انجام‌نشده/نیمه‌کاره (برای ریز تسک).', (r) => r.status],
  ['تعداد', 'برای علت‌ها: چند بار تکرار شده.', (r) => r.count],
];

const PERF_LEAVE = [
  ['نام کارمند', 'نام.', (r) => r.fullName],
  ['کد پرسنلی', 'کد پرسنلی.', (r) => r.code],
  ['دسته', 'مرخصی/مأموریت.', (r) => LEAVE_KIND[r.l.kind] || r.l.kind || ''],
  ['نوع', 'عنوان نوع.', (r) => r.l.type || ''],
  ['وضعیت', 'در انتظار/تأییدشده/ردشده.', (r) => LEAVE_STATUS[r.l.status] || r.l.status || ''],
  ['از تاریخ (شمسی)', 'شروع.', (r) => jalali(r.l.from)],
  ['تا تاریخ (شمسی)', 'پایان.', (r) => jalali(r.l.to)],
  ['تعداد روز تقویمی', 'از شروع تا پایان (شامل هر دو).', (r) => (r.l.from && r.l.to ? Math.round((Date.parse(`${r.l.to}T00:00:00Z`) - Date.parse(`${r.l.from}T00:00:00Z`)) / 86400000) + 1 : '')],
  ['دلیل', 'متن ثبت‌شده.', (r) => r.l.reason || ''],
];

/**
 * @param {object} data خروجی performanceService.teamDetailed
 * @param {{ includePayroll?: boolean, generatedAt?: any }} [opts]
 */
function buildPerformanceSheets(data, opts = {}) {
  const withPay = !!opts.includePayroll;
  const people = data.people.slice();
  // رتبه بر اساس درصد تحقق (نزولی)؛ بدون مقدار ⇒ بی‌رتبه. ترتیب ردیف‌ها همان ترتیب رتبه می‌شود.
  const ranked = people.filter((p) => p.insights.fulfillmentRate != null).sort((a, b) => b.insights.fulfillmentRate - a.insights.fulfillmentRate);
  ranked.forEach((p, i) => { p.rank = i + 1; });
  const ordered = [...ranked, ...people.filter((p) => p.insights.fulfillmentRate == null)];

  const summaryCols = PERF_SUMMARY(withPay);
  const dailyCols = PERF_DAILY(withPay);
  const summary = sheetFrom('خلاصه عملکرد', summaryCols, ordered);

  const dailyRows = [];
  const weekdayRows = [];
  const taskRows = [];
  const leaveRows = [];
  const trend = new Map();
  const depts = new Map();
  for (const p of ordered) {
    const idn = { fullName: p.user.fullName || '', code: p.user.personnelCode || '', department: p.user.department || '' };
    const payByDate = new Map(((p.payroll && p.payroll.days) || []).map((d) => [d.date, d]));
    for (const d of p.series) {
      dailyRows.push({ p, d, pay: payByDate.get(d.date) });
      const t = trend.get(d.date) || { date: d.date, present: 0, absent: 0, lateCount: 0, late: 0, useful: 0, shortfall: 0, overtime: 0, breaks: 0 };
      if (d.status === 'present' || d.status === 'late') t.present += 1;
      if (d.status === 'absent') t.absent += 1;
      if (d.late > 0) t.lateCount += 1;
      t.late += d.late; t.useful += d.useful; t.shortfall += d.shortfall; t.overtime += d.overtime; t.breaks += d.breaks;
      trend.set(d.date, t);
    }
    for (const w of p.insights.byWeekday) if (w.days > 0) weekdayRows.push({ ...idn, w });
    for (const r of p.tasks.reasons) taskRows.push({ ...idn, kind: 'علت', date: '', title: r.label, status: '', count: r.count });
    for (const t of p.tasks.recentNotDone) taskRows.push({ ...idn, kind: 'تسک', date: jalali(t.date), title: t.reason ? `${t.title} — علت: ${t.reason}` : t.title, status: TASK_STATUS[t.status] || t.status, count: '' });
    for (const l of p.leaves) leaveRows.push({ ...idn, l });
    const k = p.user.department || 'بدون دپارتمان';
    const d = depts.get(k) || { department: k, employees: 0, presentDays: 0, absentDays: 0, lateDays: 0, expected: 0, useful: 0, shortfall: 0, late: 0, overtime: 0, tasksTotal: 0, tasksDone: 0 };
    d.employees += 1; d.presentDays += p.insights.presentDays; d.absentDays += p.insights.absentDays; d.lateDays += p.insights.lateDays;
    d.expected += p.totals.expected; d.useful += p.totals.useful; d.shortfall += p.totals.shortfall; d.late += p.totals.late; d.overtime += p.totals.overtime;
    d.tasksTotal += p.tasks.total; d.tasksDone += p.tasks.done;
    depts.set(k, d);
  }
  const daily = sheetFrom('ریز روزانه', dailyCols, dailyRows);
  const trendSheet = sheetFrom('روند روزانه تیم', PERF_TREND, [...trend.values()].sort((a, b) => a.date.localeCompare(b.date)));
  const deptSheet = sheetFrom('دپارتمان‌ها', PERF_DEPT, [...depts.values()].sort((a, b) => b.useful - a.useful));
  const weekdaySheet = sheetFrom('روز هفته', PERF_WEEKDAY, weekdayRows);
  const tasksSheet = sheetFrom('تسک‌ها و علت‌ها', PERF_TASKS, taskRows);
  const leaveSheet = sheetFrom('مرخصی و مأموریت', PERF_LEAVE, leaveRows);

  const r = data.range;
  const meta = {
    name: 'مشخصات گزارش',
    headers: ['مورد', 'مقدار'],
    rows: [
      ['از (میلادی)', r.from], ['تا (میلادی)', r.to], ['از (شمسی)', jalali(r.from)], ['تا (شمسی)', jalali(r.to)], ['تعداد روز بازه', r.days],
      ['دوره‌ی قبل برای مقایسه', `${jalali(r.previous.from)} تا ${jalali(r.previous.to)}`],
      ['«امروز» در محاسبه', data.today], ['منطقه‌ی زمانی', data.timezone || ''],
      ['تعداد کارمند', people.length],
      ['شامل حقوق', withPay ? 'بله' : 'خیر'],
      ['روش رتبه‌بندی', 'بر اساس «درصد تحقق ساعت کاری» (ساعت مفید ÷ مورد انتظار در روزهای تمام‌شده).'],
      ['زمان تهیه‌ی فایل (UTC)', generatedAt(opts)],
    ],
  };
  const guide = guideSheet([
    ['خلاصه عملکرد', summaryCols], ['ریز روزانه', dailyCols], ['روند روزانه تیم', PERF_TREND], ['دپارتمان‌ها', PERF_DEPT],
    ['روز هفته', PERF_WEEKDAY], ['تسک‌ها و علت‌ها', PERF_TASKS], ['مرخصی و مأموریت', PERF_LEAVE],
  ]);
  return [summary, daily, trendSheet, deptSheet, weekdaySheet, tasksSheet, leaveSheet, meta, guide];
}

module.exports = { buildPayrollSheets, buildPerformanceSheets, WEEKDAYS };

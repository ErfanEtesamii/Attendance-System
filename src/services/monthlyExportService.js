// S5-4a: شیت‌های خروجی xlsx «گزارش ماهانه‌ی شمسی» — فقط ساخت داده‌ی شیت‌ها (بدون HTTP و بدون exceljs).
//
// ورودی: payload خروجی GET /admin/reports/monthly (زنده یا snapshot ماه بسته؛ با ریز روزانه). این سرویس هیچ محاسبه‌ی تازه‌ای ندارد
// و اسکوپ نقش را تعیین نمی‌کند؛ فقط فیلد به ستون نگاشت می‌کند.
//
// قالب ثابت: هر شیت با «تعریف ستون‌ها» (header، توضیح، تابع مقدار) ساخته می‌شود و شیت «راهنما» دقیقاً از همین تعریف‌ها تولید می‌شود
// تا راهنما هرگز از ستون‌های واقعی عقب نیفتد. ترتیب شیت‌ها: گزارش ماهانه، خلاصه دپارتمان، مرخصی و مأموریت، مانده مرخصی، ریز روزانه، مشخصات گزارش، راهنما.
// مدت‌ها هم «دقیقه» (عدد؛ قابل جمع در اکسل) و هم «ساعت:دقیقه» (متن؛ برای خواندن).

const { isoDateToJalaliString } = require('../utils/jalali');
const { minutesToHHMM } = require('../api/routes/admin/common');

const SHEET = { main: 'گزارش ماهانه', dept: 'خلاصه دپارتمان', leave: 'مرخصی و مأموریت', balances: 'مانده مرخصی', daily: 'ریز روزانه', meta: 'مشخصات گزارش', guide: 'راهنما' };

const DAY_STATUS = {
  present: 'حاضر', late: 'تأخیر', incomplete: 'ناقص (بدون خروج)', absent: 'غایب', leave: 'مرخصی', mission: 'مأموریت',
  manual_leave: 'مرخصی (ثبت دستی)', manual_holiday: 'تعطیل (ثبت دستی)', holiday: 'تعطیل', weekend: 'آخر هفته',
  pending: 'امروز (در جریان)', future: 'آینده', not_started: 'پیش از ثبت در سیستم',
};
const APPROVAL = { not_required: 'نیاز به تأیید ندارد', none: '—', pending: 'معلق', approved: 'تأییدشده', rejected: 'ردشده' };
const FLAG = {
  missing_checkout: 'بدون خروج', invalid_time: 'زمان نامعتبر', long_open_break: 'استراحت بسته‌نشده', outside_shift: 'خارج از شیفت',
};

const WEEKDAYS = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'];
const weekday = (iso) => { try { return iso ? WEEKDAYS[(new Date(`${iso}T00:00:00Z`).getUTCDay() + 1) % 7] : ''; } catch (_) { return ''; } };
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : '');

const hhmm = (m) => (m === null || m === undefined || Number.isNaN(m) ? '' : minutesToHHMM(m));
const num = (v) => (v === null || v === undefined || Number.isNaN(v) ? '' : v);
const jalali = (iso) => { try { return iso ? isoDateToJalaliString(iso) : ''; } catch (_) { return ''; } };

// تعریف ستون‌ها: [header, توضیح، (userRecord) => مقدار]
const MAIN_COLUMNS = [
  ['نام کارمند', 'نام و نام خانوادگی کارمند.', (u) => u.user.fullName || ''],
  ['کد پرسنلی', 'کد پرسنلی ثبت‌شده در سیستم.', (u) => u.user.personnelCode || ''],
  ['دپارتمان', 'دپارتمان کارمند (در ماه بسته: هنگام بستن).', (u) => u.user.department || ''],
  ['روز کاری مورد انتظار', 'تعداد روزهای کاری ماه طبق تقویم/شیفت (نیم‌روز هم یک روز کاری است؛ مرخصی از آن کم نمی‌شود).', (u) => u.calendar.expectedWorkDays],
  ['روز حضور', 'روزهای کاری که ورود ثبت شده است.', (u) => u.attendance.presentDays],
  ['روز غیبت', 'روزهای کاریِ گذشته بدون ورود، بدون مرخصی/مأموریت و بدون ثبت دستی.', (u) => u.attendance.absentDays],
  ['روز مرخصی', 'روزهای کاری که مرخصی تمام‌روز (تأییدشده یا ثبت دستی) دارند.', (u) => u.leave.leaveDays],
  ['روز مأموریت', 'روزهای کاری که مأموریت تمام‌روز تأییدشده دارند.', (u) => u.leave.missionDays],
  ['روز تعطیل', 'تعطیلی رسمی کامل (تقویم).', (u) => u.calendar.holidayDays],
  ['روز آخر هفته', 'روزهای آخر هفته (غیرکاری).', (u) => u.calendar.weekendDays],
  ['روز تأخیر', 'تعداد روزهایی که تأخیر (پس از مهلت تنظیم‌شده) داشته است.', (u) => u.attendance.lateDays],
  ['دقیقه تأخیر', 'مجموع دقیقه‌های تأخیر.', (u) => u.time.lateMinutes],
  ['روز زودتر رفتن', 'تعداد روزهایی که زودتر از پایان کار خارج شده است.', (u) => u.attendance.earlyLeaveDays],
  ['دقیقه زودتر رفتن', 'مجموع دقیقه‌های زودتر رفتن.', (u) => u.time.earlyLeaveMinutes],
  ['روز ناقص', 'روزهای دارای ورودِ بدون خروج؛ در ساعت مفید و کسری نمی‌آیند.', (u) => u.attendance.incompleteDays],
  ['دقیقه مورد انتظار', 'مجموع ساعت کاری مورد انتظار (دقیقه) پس از کسر مرخصی ساعتی/نیم‌روزی.', (u) => u.time.expectedMinutes],
  ['دقیقه مفید', 'مجموع ساعت کار مفید (دقیقه) پس از کسر استراحت‌ها.', (u) => u.time.effectiveMinutes],
  ['ساعت مفید (ساعت:دقیقه)', 'همان «دقیقه مفید» به‌صورت ساعت:دقیقه.', (u) => hhmm(u.time.effectiveMinutes)],
  ['دقیقه کسری', 'کسری کار: روز غایب = کل مورد انتظار؛ روز حاضر = مورد انتظار منهای مفید (نه منفی).', (u) => u.time.shortfallMinutes],
  ['کسری (ساعت:دقیقه)', 'همان «دقیقه کسری» به‌صورت ساعت:دقیقه.', (u) => hhmm(u.time.shortfallMinutes)],
  ['اضافه‌کاری خام (دقیقه)', 'دقیقه‌های کار بیش از ساعت مورد انتظار، پیش از آستانه/سقف/ضریب.', (u) => u.overtime.rawMinutes],
  ['اضافه‌کاری معلق (دقیقه)', 'اضافه‌کاری روزانه که منتظر تأیید است (فقط وقتی الزام تأیید روشن است).', (u) => u.overtime.pendingMinutes],
  ['اضافه‌کاری ردشده (دقیقه)', 'اضافه‌کاری روزانه‌ی ردشده.', (u) => u.overtime.rejectedMinutes],
  ['اضافه‌کاری قابل‌پرداخت (دقیقه)', 'اضافه‌کاری پس از آستانه/گرد‌کردن/ضریب، تأیید و سقف ماهانه؛ مبنای پرداخت.', (u) => u.overtime.payableMinutes],
  ['برش سقف ماهانه (دقیقه)', 'بخشی از اضافه‌کاری مجاز که به‌خاطر سقف ماهانه قابل‌پرداخت نشد.', (u) => u.overtime.clippedMinutes],
  // C1 (ستون‌های جدید در انتها؛ ماه‌های بسته‌شده‌ی قدیمی این مقدار را ندارند ⇒ خالی)
  ['استراحت با حقوق (دقیقه)', 'مجموع بخش «با حقوق» استراحت‌های کوتاه (از ساعت مفید کم نشده است).', (u) => num(u.breaks && u.breaks.paidMinutes)],
  ['استراحت بدون حقوق (دقیقه)', 'مجموع استراحت‌هایی که از ساعت مفید کم شده است (مازاد سقف، بعد از تعداد مجاز، ناهار و کسر ثابت).', (u) => num(u.breaks && u.breaks.unpaidMinutes)],
  // R7 (انتهای ستون‌ها؛ ماه بسته‌ی قدیمی remote ندارد ⇒ خالی)
  ['روز دورکاری تأییدشده', 'روزهایی که حداقل یک نشست دورکاری تأییدشده دارند (جدا از ستون‌های بالا نیست؛ در «روز حضور» هم شمرده شده‌اند). نشست‌های منتظر/ردشده شمرده نمی‌شوند.', (u) => num(u.remote && u.remote.approvedDays)],
  ['دقیقه دورکاری تأییدشده', 'مجموع مدت نشست‌های دورکاری تأییدشده (دقیقه).', (u) => num(u.remote && u.remote.approvedMinutes)],
  ['ساعت دورکاری تأییدشده (ساعت:دقیقه)', 'همان «دقیقه دورکاری تأییدشده» به‌صورت ساعت:دقیقه.', (u) => (u.remote ? hhmm(u.remote.approvedMinutes) : '')],
  // شاخص‌های مشتق (انتهای ستون‌ها؛ فقط از ستون‌های بالا حساب می‌شوند، برای ردیف جمع هم معتبرند)
  ['درصد حضور', 'روز حضور ÷ (روز حضور + روز غیبت).', (u) => pct(u.attendance.presentDays, u.attendance.presentDays + u.attendance.absentDays)],
  ['درصد وقت‌شناسی', '(روز حضور − روز تأخیر) ÷ روز حضور.', (u) => pct(u.attendance.presentDays - u.attendance.lateDays, u.attendance.presentDays)],
  ['درصد تحقق ساعت کاری', 'دقیقه مفید ÷ دقیقه مورد انتظار.', (u) => pct(u.time.effectiveMinutes, u.time.expectedMinutes)],
  ['میانگین مفید هر روز حضور (دقیقه)', 'دقیقه مفید ÷ روز حضور.', (u) => (u.attendance.presentDays ? Math.round(u.time.effectiveMinutes / u.attendance.presentDays) : '')],
  ['میانگین تأخیر هر روز تأخیر (دقیقه)', 'دقیقه تأخیر ÷ روز تأخیر.', (u) => (u.attendance.lateDays ? Math.round(u.time.lateMinutes / u.attendance.lateDays) : '')],
  ['اضافه‌کاری قابل‌پرداخت (ساعت:دقیقه)', 'همان «اضافه‌کاری قابل‌پرداخت (دقیقه)» به‌صورت ساعت:دقیقه.', (u) => hhmm(u.overtime.payableMinutes)],
  ['مجموع دقیقه مرخصی و مأموریت', 'جمع دقیقه‌ی پنجره‌های مرخصی/مأموریت همه‌ی نوع‌ها.', (u) => (u.leave && u.leave.byType ? u.leave.byType.reduce((t, x) => t + (x.minutes || 0), 0) : '')],
];

const DEPT_COLUMNS = [
  ['دپارتمان', 'نام دپارتمان (بدون دپارتمان جداست).', (r) => r.department],
  ['تعداد کارمند', 'کارمندان این گزارش در دپارتمان.', (r) => r.employees],
  ['روز حضور', 'مجموع روز حضور.', (r) => r.present],
  ['روز غیبت', 'مجموع روز غیبت.', (r) => r.absent],
  ['روز مرخصی', 'مجموع روز مرخصی.', (r) => r.leave],
  ['روز تأخیر', 'مجموع روز تأخیر.', (r) => r.lateDays],
  ['دقیقه تأخیر', 'مجموع دقیقه تأخیر.', (r) => r.lateMin],
  ['دقیقه مورد انتظار', 'مجموع.', (r) => r.expected],
  ['دقیقه مفید', 'مجموع.', (r) => r.effective],
  ['ساعت مفید (ساعت:دقیقه)', 'همان «دقیقه مفید» به‌صورت ساعت:دقیقه.', (r) => hhmm(r.effective)],
  ['دقیقه کسری', 'مجموع.', (r) => r.shortfall],
  ['اضافه‌کاری قابل‌پرداخت (دقیقه)', 'مجموع.', (r) => r.otPayable],
  ['درصد حضور', 'حضور ÷ (حضور + غیبت).', (r) => pct(r.present, r.present + r.absent)],
  ['درصد وقت‌شناسی', '(حضور − تأخیر) ÷ حضور.', (r) => pct(r.present - r.lateDays, r.present)],
  ['درصد تحقق ساعت کاری', 'مفید ÷ مورد انتظار.', (r) => pct(r.effective, r.expected)],
  ['میانگین مفید هر نفر (دقیقه)', 'دقیقه مفید ÷ تعداد کارمند.', (r) => (r.employees ? Math.round(r.effective / r.employees) : '')],
];

function deptRows(users) {
  const m = new Map();
  for (const u of users) {
    const k = (u.user.department || '').trim() || 'بدون دپارتمان';
    const d = m.get(k) || { department: k, employees: 0, present: 0, absent: 0, leave: 0, lateDays: 0, lateMin: 0, expected: 0, effective: 0, shortfall: 0, otPayable: 0 };
    d.employees += 1; d.present += u.attendance.presentDays || 0; d.absent += u.attendance.absentDays || 0; d.leave += u.leave.leaveDays || 0;
    d.lateDays += u.attendance.lateDays || 0; d.lateMin += u.time.lateMinutes || 0; d.expected += u.time.expectedMinutes || 0;
    d.effective += u.time.effectiveMinutes || 0; d.shortfall += u.time.shortfallMinutes || 0; d.otPayable += u.overtime.payableMinutes || 0;
    m.set(k, d);
  }
  return [...m.values()].sort((a, b) => b.effective - a.effective);
}

const LEAVE_COLUMNS = [
  ['نام کارمند', 'نام کارمند.', (r) => r.fullName],
  ['کد پرسنلی', 'کد پرسنلی.', (r) => r.code],
  ['نوع', 'نام نوع مرخصی/مأموریت (ثبت دستی بدون نوع جداست).', (r) => r.title],
  ['دسته', 'مرخصی یا مأموریت.', (r) => (r.kind === 'mission' ? 'مأموریت' : 'مرخصی')],
  ['روز کامل', 'تعداد روزهای تمام‌روز این نوع.', (r) => r.days],
  ['دقیقه', 'مجموع دقیقه‌ی پنجره‌های مرخصی/مأموریت این نوع در ماه (شامل ساعتی و نیم‌روز).', (r) => r.minutes],
  ['ساعت:دقیقه', 'همان «دقیقه» به‌صورت ساعت:دقیقه.', (r) => hhmm(r.minutes)],
];

const BALANCE_COLUMNS = [
  ['نام کارمند', 'نام کارمند.', (r) => r.fullName],
  ['کد پرسنلی', 'کد پرسنلی.', (r) => r.code],
  ['نوع مرخصی', 'نوعی که از مانده کم می‌کند.', (r) => r.b.title],
  ['استحقاق (دقیقه)', 'استحقاق سالانه (صریح یا پیش‌فرض تنظیمات).', (r) => num(r.b.entitled)],
  ['انتقالی (دقیقه)', 'مانده‌ی منتقل‌شده از سال قبل.', (r) => num(r.b.carriedOver)],
  ['تعدیل (دقیقه)', 'مجموع تعدیل‌های دستی.', (r) => num(r.b.adjustments)],
  ['مصرف‌شده (دقیقه)', 'مرخصی تأییدشده‌ی سال شمسی.', (r) => num(r.b.used)],
  ['در انتظار (دقیقه)', 'درخواست‌های در انتظار تصمیم.', (r) => num(r.b.pending)],
  ['مانده (دقیقه)', 'استحقاق + انتقالی + تعدیل − مصرف. مانده «سالانه تا لحظه‌ی گزارش» (یا لحظه‌ی بستن ماه) است نه پایان همین ماه.', (r) => num(r.b.remaining)],
  ['مانده (نمایش)', 'مانده به روز/ساعت بر پایه‌ی طول روز کاری.', (r) => (r.b.display && (r.b.display.text || r.b.display.label)) || ''],
];

const DAILY_COLUMNS = [
  ['نام کارمند', 'نام کارمند.', (r) => r.fullName],
  ['کد پرسنلی', 'کد پرسنلی.', (r) => r.code],
  ['تاریخ میلادی', 'تاریخ مرجع (YYYY-MM-DD).', (r) => r.d.date],
  ['تاریخ شمسی', 'همان روز به تاریخ شمسی.', (r) => jalali(r.d.date)],
  ['وضعیت', 'وضعیت انحصاری روز (حاضر، تأخیر، غایب، مرخصی، تعطیل، …).', (r) => DAY_STATUS[r.d.status] || r.d.status || ''],
  ['مناسبت', 'عنوان تعطیلی (در صورت وجود).', (r) => r.d.holidayTitle || ''],
  ['دقیقه مورد انتظار', 'ساعت کاری مورد انتظار آن روز (دقیقه).', (r) => num(r.d.expected)],
  ['دقیقه مفید', 'ساعت کار مفید آن روز (دقیقه)؛ خالی اگر ورودی نبوده یا روز ناقص است.', (r) => (r.d.flags || []).includes('missing_checkout') ? '' : num(r.d.effective)],
  ['دقیقه تأخیر', 'تأخیر ورود (دقیقه).', (r) => num(r.d.late)],
  ['دقیقه زودتر رفتن', 'زودتر رفتن (دقیقه).', (r) => num(r.d.earlyLeave)],
  ['دقیقه مرخصی', 'مجموع پنجره‌ی مرخصی/مأموریت آن روز (دقیقه).', (r) => num(r.d.leaveMinutes)],
  ['اضافه‌کاری خام (دقیقه)', 'اضافه‌کاری خام آن روز.', (r) => num(r.d.overtime)],
  ['اضافه‌کاری روزانه قابل‌پرداخت (دقیقه)', 'پس از آستانه/گرد‌کردن/ضریب، پیش از تأیید و سقف ماهانه.', (r) => num(r.d.overtimePayable)],
  ['وضعیت تأیید اضافه‌کاری', 'نیاز به تأیید ندارد / معلق / تأییدشده / ردشده.', (r) => (r.d.approvalStatus ? (APPROVAL[r.d.approvalStatus] || r.d.approvalStatus) : '')],
  ['اضافه‌کاری نهایی (دقیقه)', 'پس از تأیید و سقف ماهانه.', (r) => num(r.d.overtimePayableFinal)],
  ['پرچم‌ها', 'هشدارهای داده (بدون خروج، زمان نامعتبر، …).', (r) => (r.d.flags || []).map((f) => FLAG[f] || f).join('، ')],
  ['استراحت با حقوق (دقیقه)', 'بخش با حقوق استراحت‌های کوتاه آن روز (از ساعت مفید کم نشده).', (r) => (r.d.flags || []).includes('missing_checkout') ? '' : num(r.d.breakPaid)],
  ['دورکاری', 'اگر آن روز نشست دورکاری تأییدشده داشته «دورکاری» می‌نویسد.', (r) => (r.d.viaRemote ? 'دورکاری' : '')],
  ['دقیقه دورکاری تأییدشده', 'مدت نشست‌های دورکاری تأییدشده‌ی آن روز (دقیقه).', (r) => (r.d.viaRemote ? num(r.d.remoteMinutes) : '')],
  ['استراحت بدون حقوق (دقیقه)', 'بخش بدون حقوقِ استراحت‌های آن روز (از ساعت مفید کم شده).', (r) => (r.d.flags || []).includes('missing_checkout') ? '' : num(r.d.breakUnpaid)],
  ['روز هفته', 'نام روز هفته.', (r) => weekday(r.d.date)],
  ['دقیقه مأموریت', 'مدت مأموریت تأییدشده‌ی آن روز (دقیقه)؛ خالی اگر نبوده.', (r) => num(r.d.missionMinutes)],
  ['دقیقه مفید با مأموریت', 'ساعت مفید + مأموریت؛ مبنای حقوق/عملکرد. خالی برای روز ناقص.', (r) => ((r.d.flags || []).includes('missing_checkout') ? '' : num(r.d.effectiveWithMission))],
];

function sheetFrom(name, columns, rows) {
  return { name, headers: columns.map((c) => c[0]), rows: rows.map((r) => columns.map((c) => c[2](r))) };
}

function totalRow(report) {
  const t = report.totals;
  const fake = {
    user: { fullName: 'جمع', personnelCode: '', department: '' },
    calendar: t.calendar, attendance: t.attendance, leave: t.leave, time: t.time, overtime: t.overtime, remote: t.remote,
  };
  return fake;
}

/**
 * @param {object} payload خروجی resolveMonthly (باید days داشته باشد تا شیت «ریز روزانه» پر شود)
 * @param {{ generatedAt?: Date|string }} [opts]
 * @returns {Array<{name: string, headers: string[], rows: any[][]}>}
 */
function buildMonthlySheets(payload, opts = {}) {
  const users = payload.users || [];

  const main = sheetFrom(SHEET.main, MAIN_COLUMNS, [...users, ...(users.length ? [totalRow(payload)] : [])]);

  const leaveRows = [];
  const balanceRows = [];
  const dailyRows = [];
  for (const u of users) {
    const id = { fullName: u.user.fullName || '', code: u.user.personnelCode || '' };
    for (const t of (u.leave && u.leave.byType) || []) leaveRows.push({ ...id, ...t });
    for (const b of u.balances || []) balanceRows.push({ ...id, b });
    for (const d of u.days || []) dailyRows.push({ ...id, d });
  }
  const dept = sheetFrom(SHEET.dept, DEPT_COLUMNS, deptRows(users));
  const leave = sheetFrom(SHEET.leave, LEAVE_COLUMNS, leaveRows);
  const balances = sheetFrom(SHEET.balances, BALANCE_COLUMNS, balanceRows);
  const daily = sheetFrom(SHEET.daily, DAILY_COLUMNS, dailyRows);

  const closure = payload.closure;
  const sourceLabel = payload.source === 'snapshot' ? 'snapshot ماه بسته (ارقام ثابت لحظه‌ی بستن)' : 'محاسبه‌ی زنده (ممکن است با تغییر داده‌ها عوض شود)';
  const generated = opts.generatedAt ? new Date(opts.generatedAt) : new Date();
  const meta = {
    name: SHEET.meta,
    headers: ['مورد', 'مقدار'],
    rows: [
      ['ماه شمسی', payload.label],
      ['سال شمسی', payload.year],
      ['شماره ماه', payload.month],
      ['از (میلادی)', payload.from],
      ['تا (میلادی)', payload.to],
      ['تعداد روز ماه', payload.daysInMonth],
      ['تعداد کارمند', users.length],
      ['منبع ارقام', sourceLabel],
      ['وضعیت ماه', closure ? ({ closed: 'بسته', reopened: 'بازشده (زنده)' }[closure.status] || closure.status) : 'باز'],
      ['زمان بستن', closure && closure.status === 'closed' ? (closure.closedAt || '') : ''],
      ['تعداد اصلاح پس از بستن', Array.isArray(payload.adjustments) ? payload.adjustments.length : ''],
      ['«امروز» در محاسبه', payload.today],
      ['الزام تأیید اضافه‌کاری', payload.overtimePolicy && payload.overtimePolicy.requiresApproval ? 'بله' : 'خیر'],
      ['سقف ماهانه اضافه‌کاری (دقیقه)', payload.overtimePolicy ? payload.overtimePolicy.monthlyCapMinutes : ''],
      ['زمان تهیه‌ی فایل (UTC)', generated.toISOString()],
    ],
  };

  const guideRows = [];
  for (const [sheetName, cols] of [[SHEET.main, MAIN_COLUMNS], [SHEET.dept, DEPT_COLUMNS], [SHEET.leave, LEAVE_COLUMNS], [SHEET.balances, BALANCE_COLUMNS], [SHEET.daily, DAILY_COLUMNS]]) {
    for (const c of cols) guideRows.push([sheetName, c[0], c[1]]);
  }
  guideRows.push([SHEET.main, 'ردیف «جمع»', 'جمع ستون‌های عددی همه‌ی کارمندان نمایش‌داده‌شده (ستون‌های متنی خالی‌اند).']);
  guideRows.push([SHEET.daily, 'خالی بودن مقدار', 'مقدار خالی یعنی آن روز/ستون معنا ندارد (مثلاً مفید برای روز تعطیل) نه صفر.']);
  const guide = { name: SHEET.guide, headers: ['شیت', 'ستون', 'تعریف'], rows: guideRows };

  return [main, dept, leave, balances, daily, meta, guide];
}

module.exports = { buildMonthlySheets, SHEET, MAIN_COLUMNS, DAY_STATUS };

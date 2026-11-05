// S5-1b: شیت‌های خروجی xlsx «گزارش کارمندان» — فقط ساخت داده‌ی شیت‌ها (بدون HTTP و بدون exceljs).
//
// ورودی: users (از قبل بر اساس اسکوپ نقش و فیلتر فیلتر شده‌اند — این سرویس خودش دسترسی را تعیین نمی‌کند)، from/to (میلادی YYYY-MM-DD).
// خروجی: [{ name, headers, rows }] برای buildWorkbook / sendSheets در utils/xlsx.js. چهار شیت:
//   ۱. خلاصه کارمند   ۲. ریز روزانه   ۳. مرخصی و مأموریت   ۴. اضافه‌کاری
// قراردادها:
//   • تاریخ‌ها هم میلادی (مرجع DB) و هم شمسی؛ مدت‌ها هم «دقیقه» (عدد، برای فرمول/جمع در اکسل) و هم «ساعت:دقیقه» (متن، برای خواندن).
//   • فقط از موتور محاسبه (dayService / computeDay) و aggregateRecords استفاده می‌شود؛ منطق جدیدی برای تأخیر/اضافه‌کاری اینجا نیست.
//   • اضافه‌کاری «قابل‌پرداخت» = پس از اعمال تأیید (S3-5c) ولی «بدون سقف ماهانه»؛ سقف ماهانه به مرز ماه شمسی وابسته است و در گزارش ماهانه (S5-2a) می‌آید.
//   • رکورد با داده‌ی زمانی خراب کل خروجی را نمی‌شکند (ستون‌های زمان خالی می‌مانند).

const attendanceRepository = require('../repositories/attendanceRepository');
const breakRepository = require('../repositories/breakRepository');
const leaveRepository = require('../repositories/leaveRepository');
const dayService = require('../engine/dayService');
const { isoDateToJalaliString } = require('../utils/jalali');
const { formatTime, minutesSinceMidnight } = require('../utils/time');
const { aggregateRecords, safeSummary, minutesToHHMM } = require('../api/routes/admin/common');
const remoteWorkRepository = require('../repositories/remoteWorkRepository');

const SHEET_NAMES = { summary: 'خلاصه کارمند', daily: 'ریز روزانه', leave: 'مرخصی و مأموریت', overtime: 'اضافه‌کاری', remote: 'دورکاری', meta: 'مشخصات گزارش' };

const WEEKDAYS = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'];
const REC_STATUS = { normal: 'عادی', late: 'تأخیر', incomplete: 'ناقص (بدون خروج)', leave: 'مرخصی', holiday: 'تعطیل', present: 'حاضر', absent: 'غایب' };
const ROLE = { employee: 'کارمند', manager: 'سرپرست', admin: 'ادمین', owner: 'مالک', hr: 'منابع انسانی' };
const weekday = (iso) => { try { return iso ? WEEKDAYS[(new Date(`${iso}T00:00:00Z`).getUTCDay() + 1) % 7] : ''; } catch (_) { return ''; } };
const clockOf = (m) => (m === null || m === undefined || Number.isNaN(m) ? '' : `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.round(m % 60)).padStart(2, '0')}`);
const avgOf = (a) => (a.length ? Math.round(a.reduce((t, v) => t + v, 0) / a.length) : null);

const LEAVE_STATUS = { pending: 'در انتظار', approved: 'تأییدشده', rejected: 'ردشده' };
const LEAVE_KIND = { leave: 'مرخصی', mission: 'مأموریت' };
const LEAVE_UNIT = { day: 'روز', half_day: 'نیم‌روز', hour: 'ساعت' };
const APPROVAL_STATUS = { not_required: 'نیاز به تأیید ندارد', none: '—', pending: 'معلق', approved: 'تأییدشده', rejected: 'ردشده' };

const num = (v) => (v === null || v === undefined || Number.isNaN(v) ? '' : v);
const hhmm = (m) => (m === null || m === undefined || Number.isNaN(m) ? '' : minutesToHHMM(m));
const jalali = (iso) => { try { return iso ? isoDateToJalaliString(iso) : ''; } catch (_) { return ''; } };
const timeOf = (iso, tz) => { try { return iso ? formatTime(iso, tz) : ''; } catch (_) { return ''; } };

// C1: «استراحت با حقوق / بدون حقوق» یک رکورد (خالی اگر محاسبه ممکن نبود یا روز ناقص قدیمی است)
const splitCells = (record, context) => {
  const stale = record.check_in_time && !record.check_out_time && record.record_date < require('../utils/serverTime').todayDateString();
  const s = stale ? null : dayService.breakSplit(record, { context });
  return [s ? s.paid : '', s ? s.unpaid : ''];
};

const IDENT_HEADERS = ['نام کارمند', 'کد پرسنلی', 'دپارتمان'];
const ident = (u) => [u.full_name || '', u.personnel_code || '', u.department || ''];

/**
 * @param {{ users: object[], from: string, to: string }} p
 * @returns {Array<{ name: string, headers: string[], rows: any[][] }>}
 */
function buildEmployeeReportSheets({ users, from, to }) {
  const list = Array.isArray(users) ? users : [];
  const ids = list.map((u) => u.id);
  const context = dayService.loadContext();
  const tz = context.timezone;

  const byUser = new Map(list.map((u) => [u.id, []]));
  for (const r of attendanceRepository.listByUserIdsAndRange(ids, from, to)) {
    if (byUser.has(r.user_id)) byUser.get(r.user_id).push(r);
  }

  const userMap = new Map(list.map((u) => [u.id, u]));
  const leaveList = leaveRepository.listInRangeWithType(ids, from, to);
  const leaveByUser = new Map();
  for (const l of leaveList) { if (!leaveByUser.has(l.user_id)) leaveByUser.set(l.user_id, []); leaveByUser.get(l.user_id).push(l); }
  const closedRemote = remoteWorkRepository.listClosedInRange(ids, from, to);
  const remoteMinutesOf = (s) => {
    const a = Date.parse(s.approved_start_at || s.start_at); const b = Date.parse(s.approved_end_at || s.end_at);
    return Number.isFinite(a) && Number.isFinite(b) && b > a ? Math.round((b - a) / 60000) : 0;
  };
  const remoteMinutesByUser = new Map();
  for (const s of closedRemote) if (s.status === 'approved') remoteMinutesByUser.set(s.user_id, (remoteMinutesByUser.get(s.user_id) || 0) + remoteMinutesOf(s));

  const summaryRows = [];
  const dailyRows = [];
  const overtimeRows = [];
  const remoteRows = [];

  for (const u of list) {
    const records = byUser.get(u.id);
    const agg = aggregateRecords(records);

    let month = null;
    try {
      month = dayService.computeMonthOvertime(records, { context, capMinutes: 0 });
    } catch (err) {
      if (!(err instanceof RangeError)) throw err;
      console.error(`[reportExport] محاسبه‌ی اضافه‌کاری کاربر ${u.id} ناموفق بود:`, err.message);
    }

    // ستون‌های تکمیلی خلاصه (در انتها): میانگین‌ها، ورود/خروج، استراحت، مرخصی/دورکاری
    const ins = []; const outs = []; let breakTotal = 0; let paidTotal = 0; let unpaidTotal = 0;
    for (const r of records) {
      try {
        if (r.check_in_time) ins.push(minutesSinceMidnight(r.check_in_time, tz));
        if (r.check_out_time) outs.push(minutesSinceMidnight(r.check_out_time, tz));
      } catch (_) { /* زمان خراب نادیده گرفته می‌شود */ }
      breakTotal += Number(breakRepository.totalBreakMinutes(r.id)) || 0;
      const sp = splitCells(r, context);
      paidTotal += Number(sp[0]) || 0; unpaidTotal += Number(sp[1]) || 0;
    }
    const uLeaves = leaveByUser.get(u.id) || [];
    const remoteMin = remoteMinutesByUser.get(u.id) || 0;
    const extra = [
      ROLE[u.role] || u.role || '',
      agg.presentDays ? Math.round(((agg.presentDays - agg.lateCount) / agg.presentDays) * 1000) / 10 : '',
      agg.presentDays ? Math.round(agg.totalEffective / agg.presentDays) : '',
      clockOf(avgOf(ins)), clockOf(avgOf(outs)),
      clockOf(ins.length ? Math.min(...ins) : null), clockOf(ins.length ? Math.max(...ins) : null),
      breakTotal, paidTotal, unpaidTotal,
      uLeaves.filter((l) => l.kind === 'leave' && l.status === 'approved').length,
      uLeaves.filter((l) => l.kind === 'mission' && l.status === 'approved').length,
      uLeaves.filter((l) => l.status === 'pending').length,
      uLeaves.filter((l) => l.status === 'rejected').length,
      remoteMin, hhmm(remoteMin),
    ];

    summaryRows.push([
      ...ident(u),
      agg.recordCount, agg.presentDays,
      Math.round(agg.totalEffective), hhmm(agg.totalEffective),
      agg.lateCount, agg.totalLateMinutes,
      agg.earlyLeaveCount, agg.totalEarlyMinutes,
      agg.incompleteCount, agg.leaveDays, agg.holidayDays,
      agg.overtimeMinutes, hhmm(agg.overtimeMinutes),
      month ? month.totalEligible : '', month ? hhmm(month.totalEligible) : '',
      ...extra,
    ]);

    // ریز روزانه: جدیدترین آخر نه اول؛ برای گزارش، ترتیب زمانی صعودی
    for (const r of records.slice().sort((a, b) => (a.record_date < b.record_date ? -1 : a.record_date > b.record_date ? 1 : a.id - b.id))) {
      const s = safeSummary(r, { context });
      dailyRows.push([
        ...ident(u),
        r.record_date, jalali(r.record_date),
        timeOf(r.check_in_time, tz), timeOf(r.check_out_time, tz),
        breakRepository.totalBreakMinutes(r.id),
        num(s.effectiveMinutes), hhmm(s.effectiveMinutes),
        s.lateMinutes, s.earlyLeaveMinutes, s.overtimeMinutes,
        r.status,
        ...splitCells(r, context), // C1: ستون‌های جدید در انتها
        weekday(r.record_date), REC_STATUS[r.status] || r.status || '', r.check_in_ip || '', r.check_out_ip || '',
      ]);
    }

    if (month) {
      for (const d of month.days) {
        if (d.overtime <= 0 && d.overtimePayableDaily <= 0 && d.approvalStatus !== 'approved' && d.approvalStatus !== 'rejected') continue;
        overtimeRows.push([
          ...ident(u),
          d.recordDate, jalali(d.recordDate),
          d.overtime, hhmm(d.overtime),
          d.overtimePayableDaily,
          APPROVAL_STATUS[d.approvalStatus] || d.approvalStatus,
          d.overtimePayableEligible, hhmm(d.overtimePayableEligible),
          weekday(d.recordDate),
        ]);
      }
    }
  }

  for (const s of closedRemote) {
    const u = userMap.get(s.user_id) || {};
    const minutes = remoteMinutesOf(s);
    remoteRows.push([...ident(u), s.work_date, jalali(s.work_date), timeOf(s.start_at, tz), timeOf(s.end_at, tz), minutes, hhmm(minutes), s.status === 'pending' ? 'در انتظار تأیید' : (s.status === 'approved' ? 'تأییدشده' : 'ردشده'), weekday(s.work_date)]);
  }
  const dayCount = (a, b) => (a && b ? Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000) + 1 : '');
  const leaveRows = leaveList.map((l) => {
    const u = userMap.get(l.user_id) || {};
    return [
      ...ident(u),
      l.type_title || '', LEAVE_KIND[l.kind] || l.kind || '', LEAVE_STATUS[l.status] || l.status || '',
      l.start_date, jalali(l.start_date), l.end_date, jalali(l.end_date),
      LEAVE_UNIT[l.unit] || l.unit || '',
      num(l.duration_minutes), hhmm(l.duration_minutes),
      l.reason || '',
      weekday(l.start_date), dayCount(l.start_date, l.end_date), l.created_at || '', l.updated_at || '',
    ];
  });

  const meta = {
    name: SHEET_NAMES.meta,
    headers: ['مورد', 'مقدار'],
    rows: [
      ['از (میلادی)', from], ['تا (میلادی)', to], ['از (شمسی)', jalali(from)], ['تا (شمسی)', jalali(to)],
      ['تعداد کارمند', list.length],
      ['تعداد رکورد تردد', dailyRows.length], ['تعداد درخواست مرخصی/مأموریت', leaveRows.length],
      ['تعداد ردیف اضافه‌کاری', overtimeRows.length], ['تعداد نشست دورکاری', remoteRows.length],
      ['منطقه‌ی زمانی', tz],
      ['توضیح اضافه‌کاری', 'ستون «قابل‌پرداخت» بدون سقف ماهانه است؛ سقف ماهانه در گزارش ماهانه اعمال می‌شود.'],
      ['زمان تهیه‌ی فایل (UTC)', new Date().toISOString()],
    ],
  };

  return [
    {
      name: SHEET_NAMES.summary,
      headers: [...IDENT_HEADERS, 'تعداد روز رکورد', 'روز حضور', 'مجموع دقیقه مفید', 'مجموع ساعت مفید (ساعت:دقیقه)',
        'تعداد تأخیر', 'مجموع دقیقه تأخیر', 'تعداد خروج زودهنگام', 'مجموع دقیقه خروج زودهنگام',
        'تعداد روز ناقص', 'روز مرخصی', 'روز تعطیل', 'دقیقه اضافه‌کاری', 'اضافه‌کاری (ساعت:دقیقه)',
        'دقیقه اضافه‌کاری قابل‌پرداخت (بدون سقف ماهانه)', 'قابل‌پرداخت (ساعت:دقیقه)',
        'نقش', 'درصد وقت‌شناسی', 'میانگین مفید هر روز حضور (دقیقه)', 'میانگین ساعت ورود', 'میانگین ساعت خروج', 'زودترین ورود', 'دیرترین ورود',
        'مجموع استراحت (دقیقه)', 'استراحت با حقوق (دقیقه)', 'استراحت بدون حقوق (دقیقه)',
        'مرخصی تأییدشده (تعداد)', 'مأموریت تأییدشده (تعداد)', 'درخواست در انتظار', 'درخواست ردشده',
        'دقیقه دورکاری تأییدشده', 'ساعت دورکاری تأییدشده (ساعت:دقیقه)'],
      rows: summaryRows,
    },
    {
      name: SHEET_NAMES.daily,
      headers: [...IDENT_HEADERS, 'تاریخ', 'تاریخ شمسی', 'ورود', 'خروج', 'دقیقه استراحت',
        'دقیقه مفید', 'ساعت مفید (ساعت:دقیقه)', 'دقیقه تأخیر', 'دقیقه خروج زودهنگام', 'دقیقه اضافه‌کاری', 'وضعیت',
        'استراحت با حقوق (دقیقه)', 'استراحت بدون حقوق (دقیقه)',
        'روز هفته', 'وضعیت (فارسی)', 'IP ورود', 'IP خروج'],
      rows: dailyRows,
    },
    {
      name: SHEET_NAMES.leave,
      headers: [...IDENT_HEADERS, 'نوع', 'دسته', 'وضعیت', 'از تاریخ', 'از تاریخ (شمسی)', 'تا تاریخ', 'تا تاریخ (شمسی)',
        'واحد', 'مدت (دقیقه)', 'مدت (ساعت:دقیقه)', 'دلیل',
        'روز هفته شروع', 'تعداد روز تقویمی', 'زمان ثبت درخواست', 'آخرین تغییر'],
      rows: leaveRows,
    },
    {
      name: SHEET_NAMES.overtime,
      headers: [...IDENT_HEADERS, 'تاریخ', 'تاریخ شمسی', 'دقیقه اضافه‌کاری', 'اضافه‌کاری (ساعت:دقیقه)',
        'قابل‌پرداخت روزانه (دقیقه)', 'وضعیت تأیید', 'قابل‌پرداخت پس از تأیید (دقیقه)', 'قابل‌پرداخت پس از تأیید (ساعت:دقیقه)', 'روز هفته'],
      rows: overtimeRows,
    },
    {
      name: SHEET_NAMES.remote,
      headers: [...IDENT_HEADERS, 'تاریخ', 'تاریخ شمسی', 'شروع دورکاری', 'پایان دورکاری', 'دقیقه دورکاری', 'ساعت دورکاری (ساعت:دقیقه)', 'وضعیت تأیید', 'روز هفته'],
      rows: remoteRows,
    },
    meta,
  ];
}

module.exports = { buildEmployeeReportSheets, SHEET_NAMES };

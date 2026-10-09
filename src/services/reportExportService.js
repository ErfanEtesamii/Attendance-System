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
const { formatTime } = require('../utils/time');
const { aggregateRecords, safeSummary, minutesToHHMM } = require('../api/routes/admin/common');

const SHEET_NAMES = { summary: 'خلاصه کارمند', daily: 'ریز روزانه', leave: 'مرخصی و مأموریت', overtime: 'اضافه‌کاری' };

const LEAVE_STATUS = { pending: 'در انتظار', approved: 'تأییدشده', rejected: 'ردشده' };
const LEAVE_KIND = { leave: 'مرخصی', mission: 'مأموریت' };
const LEAVE_UNIT = { day: 'روز', half_day: 'نیم‌روز', hour: 'ساعت' };
const APPROVAL_STATUS = { not_required: 'نیاز به تأیید ندارد', none: '—', pending: 'معلق', approved: 'تأییدشده', rejected: 'ردشده' };

const num = (v) => (v === null || v === undefined || Number.isNaN(v) ? '' : v);
const hhmm = (m) => (m === null || m === undefined || Number.isNaN(m) ? '' : minutesToHHMM(m));
const jalali = (iso) => { try { return iso ? isoDateToJalaliString(iso) : ''; } catch (_) { return ''; } };
const timeOf = (iso, tz) => { try { return iso ? formatTime(iso, tz) : ''; } catch (_) { return ''; } };

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

  const summaryRows = [];
  const dailyRows = [];
  const overtimeRows = [];

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

    summaryRows.push([
      ...ident(u),
      agg.recordCount, agg.presentDays,
      Math.round(agg.totalEffective), hhmm(agg.totalEffective),
      agg.lateCount, agg.totalLateMinutes,
      agg.earlyLeaveCount, agg.totalEarlyMinutes,
      agg.incompleteCount, agg.leaveDays, agg.holidayDays,
      agg.overtimeMinutes, hhmm(agg.overtimeMinutes),
      month ? month.totalEligible : '', month ? hhmm(month.totalEligible) : '',
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
        ]);
      }
    }
  }

  const userMap = new Map(list.map((u) => [u.id, u]));
  const leaveRows = leaveRepository.listInRangeWithType(ids, from, to).map((l) => {
    const u = userMap.get(l.user_id) || {};
    return [
      ...ident(u),
      l.type_title || '', LEAVE_KIND[l.kind] || l.kind || '', LEAVE_STATUS[l.status] || l.status || '',
      l.start_date, jalali(l.start_date), l.end_date, jalali(l.end_date),
      LEAVE_UNIT[l.unit] || l.unit || '',
      num(l.duration_minutes), hhmm(l.duration_minutes),
      l.reason || '',
    ];
  });

  return [
    {
      name: SHEET_NAMES.summary,
      headers: [...IDENT_HEADERS, 'تعداد روز رکورد', 'روز حضور', 'مجموع دقیقه مفید', 'مجموع ساعت مفید (ساعت:دقیقه)',
        'تعداد تأخیر', 'مجموع دقیقه تأخیر', 'تعداد خروج زودهنگام', 'مجموع دقیقه خروج زودهنگام',
        'تعداد روز ناقص', 'روز مرخصی', 'روز تعطیل', 'دقیقه اضافه‌کاری', 'اضافه‌کاری (ساعت:دقیقه)',
        'دقیقه اضافه‌کاری قابل‌پرداخت (بدون سقف ماهانه)', 'قابل‌پرداخت (ساعت:دقیقه)'],
      rows: summaryRows,
    },
    {
      name: SHEET_NAMES.daily,
      headers: [...IDENT_HEADERS, 'تاریخ', 'تاریخ شمسی', 'ورود', 'خروج', 'دقیقه استراحت',
        'دقیقه مفید', 'ساعت مفید (ساعت:دقیقه)', 'دقیقه تأخیر', 'دقیقه خروج زودهنگام', 'دقیقه اضافه‌کاری', 'وضعیت'],
      rows: dailyRows,
    },
    {
      name: SHEET_NAMES.leave,
      headers: [...IDENT_HEADERS, 'نوع', 'دسته', 'وضعیت', 'از تاریخ', 'از تاریخ (شمسی)', 'تا تاریخ', 'تا تاریخ (شمسی)',
        'واحد', 'مدت (دقیقه)', 'مدت (ساعت:دقیقه)', 'دلیل'],
      rows: leaveRows,
    },
    {
      name: SHEET_NAMES.overtime,
      headers: [...IDENT_HEADERS, 'تاریخ', 'تاریخ شمسی', 'دقیقه اضافه‌کاری', 'اضافه‌کاری (ساعت:دقیقه)',
        'قابل‌پرداخت روزانه (دقیقه)', 'وضعیت تأیید', 'قابل‌پرداخت پس از تأیید (دقیقه)', 'قابل‌پرداخت پس از تأیید (ساعت:دقیقه)'],
      rows: overtimeRows,
    },
  ];
}

module.exports = { buildEmployeeReportSheets, SHEET_NAMES };

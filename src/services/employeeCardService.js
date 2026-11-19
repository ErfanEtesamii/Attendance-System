// خروجی «کارتکس کارمند»: برای هر کارمند یک شیت = مستطیل مشخصات (نام، کد پرسنلی، دپارتمان، IP، میانگین ورود/خروج) + جدول همه‌ی روزهای بازه
// (روز بدون ورود «غیبت»، تعطیل/آخر هفته «تعطیل»…) + ردیف «جمع کل». هیچ ستونِ تکراری (نام/کد/دپارتمان در هر ردیف) ندارد.
// فقط ساخت داده‌ی شیت‌ها (بدون HTTP)؛ ورودی ریز روزانه از computeMonthlyReport({ includeDays }) می‌آید (همان موتور و تقویم/مرخصی/شیفت).

const attendanceRepository = require('../repositories/attendanceRepository');
const dayService = require('../engine/dayService');
const { computeMonthlyReport } = require('./monthlyReportService');
const { isoDateToJalaliString } = require('../utils/jalali');
const { formatTime, minutesSinceMidnight } = require('../utils/time');

const WEEKDAYS = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'];
const weekday = (iso) => WEEKDAYS[(new Date(`${iso}T00:00:00Z`).getUTCDay() + 1) % 7];
const jalali = (iso) => { try { return isoDateToJalaliString(iso); } catch (_) { return iso; } };
const clock = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.round(m % 60)).padStart(2, '0')}`;
const DASH = '—';

const CARD_HEADERS = ['تاریخ', 'روز هفته', 'ساعت ورود', 'ساعت خروج', 'دقیقه استراحت', 'دقیقه مفید', 'دقیقه تأخیر', 'وضعیت'];
const STATUS_LABEL = {
  present: 'حاضر', late: 'حاضر', incomplete: 'ناقص', absent: 'غیبت', leave: 'مرخصی', manual_leave: 'مرخصی', mission: 'مأموریت',
  holiday: 'تعطیل', manual_holiday: 'تعطیل', weekend: 'تعطیل', pending: 'امروز', future: DASH, not_started: DASH, untimed: 'حاضر',
};
const TONE = { absent: 'absent', holiday: 'holiday', weekend: 'holiday', manual_holiday: 'holiday', incomplete: 'incomplete' };

/**
 * شیت‌های کارتکس از خروجی گزارش (users[].days). records: رکوردهای خام برای ساعت ورود/خروج و IP.
 * @returns {Array<{name, headers, rows, card, footer, rowTones}>} یک شیت برای هر کارمند
 */
function buildCardSheets({ report, records, timezone }) {
  const tz = timezone || dayService.loadContext().timezone;
  const byUserDate = new Map();
  for (const r of records || []) byUserDate.set(`${r.user_id}|${r.record_date}`, r);
  const rangeText = `از ${jalali(report.from)} تا ${jalali(report.to)}`;
  return (report.users || []).map((u) => {
    const ips = new Set(); const ins = []; const outs = [];
    let breakSum = 0; let effSum = 0; let lateSum = 0; let absent = 0;
    const rows = []; const tones = [];
    for (const d of u.days || []) {
      const rec = byUserDate.get(`${u.user.id}|${d.date}`) || null;
      const hasIn = !!(rec && rec.check_in_time);
      const incomplete = d.status === 'incomplete';
      const hasOut = hasIn && !!rec.check_out_time && !incomplete;
      if (hasIn) {
        ins.push(minutesSinceMidnight(rec.check_in_time, tz));
        if (rec.check_in_ip) ips.add(String(rec.check_in_ip).replace(/^::ffff:/, ''));
      }
      if (hasOut) {
        outs.push(minutesSinceMidnight(rec.check_out_time, tz));
        if (rec.check_out_ip) ips.add(String(rec.check_out_ip).replace(/^::ffff:/, ''));
      }
      const worked = d.status === 'present' || d.status === 'late' || incomplete || d.status === 'untimed' || hasIn;
      const brk = worked ? (d.breakPaid || 0) + (d.breakUnpaid || 0) : null;
      const eff = worked && !incomplete && d.effective !== null && d.effective !== undefined ? Math.round(d.effective) : null;
      const late = worked && d.late !== undefined ? d.late : null;
      if (brk) breakSum += brk;
      if (eff) effSum += eff;
      if (late) lateSum += late;
      if (d.status === 'absent') absent += 1;
      rows.push([
        jalali(d.date), weekday(d.date),
        hasIn ? formatTime(rec.check_in_time, tz) : DASH,
        hasOut ? formatTime(rec.check_out_time, tz) : (hasIn ? 'بدون خروج' : DASH),
        brk === null ? DASH : brk, eff === null ? DASH : eff, late === null ? DASH : late,
        STATUS_LABEL[d.status] || DASH,
      ]);
      tones.push(TONE[d.status] || '');
    }
    const avg = (a) => (a.length ? clock(Math.round(a.reduce((t, v) => t + v, 0) / a.length)) : DASH);
    const user = u.user;
    return {
      name: user.fullName || 'کارمند',
      headers: CARD_HEADERS,
      rows,
      rowTones: tones,
      card: {
        title: `مشخصات کارمند — ${rangeText}`,
        lines: [
          [[`کارمند:  ${user.fullName || ''}`, 3], [`کد پرسنلی:  ${user.personnelCode || ''}`, 2], [`دپارتمان:  ${user.department || ''}`, 3]],
          [[`IP:  ${[...ips].sort().join('، ') || DASH}`, 3], [`میانگین ورود:  ${avg(ins)}`, 2], [`میانگین خروج:  ${avg(outs)}`, 3]],
        ],
      },
      footer: { label: 'جمع کل', labelSpan: 4, values: [breakSum, effSum, lateSum, `${absent} روز غیبت`] },
    };
  });
}

/** گزارش بازه‌ی دلخواه (from/to میلادی) برای users ⇒ شیت‌های کارتکس. */
function buildRangeCardSheets({ users, from, to }) {
  const context = dayService.loadContext();
  const report = computeMonthlyReport({ users, rangeOverride: { from, to }, includeDays: true, includeBalances: false, context });
  const records = attendanceRepository.listByUserIdsAndRange(users.map((u) => u.id), report.from, report.to);
  return buildCardSheets({ report, records, timezone: context.timezone });
}

/** از payload گزارش ماهانه (live یا snapshot) ⇒ شیت‌های کارتکس. */
function buildMonthlyCardSheets(payload) {
  const ids = (payload.users || []).map((u) => u.user.id);
  const records = ids.length ? attendanceRepository.listByUserIdsAndRange(ids, payload.from, payload.to) : [];
  return buildCardSheets({ report: payload, records });
}

module.exports = { buildCardSheets, buildRangeCardSheets, buildMonthlyCardSheets, CARD_HEADERS };

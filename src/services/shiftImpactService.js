// پیش‌نمایش «اعمال شیفت روی روزهای گذشته»: وقتی شیفتِ کارمند دیرتر از واقعیت ثبت شده (مثلاً شیفت چرخشی که اعمال نشده بود) و
// تأخیر/زودرفتن اشتباه خورده، ادمین قبل از ثبتِ انتساب با تاریخِ اعمالِ گذشته می‌بیند هر روز چه تغییری می‌کند.
// فقط خواندن؛ هیچ چیز ذخیره نمی‌شود. وضعیت رکورد هنگام ورود همیشه «normal» ذخیره می‌شود و تأخیر زنده از شیفتِ مؤثر محاسبه می‌شود،
// پس خودِ انتساب با تاریخ گذشته همه‌ی گزارش‌ها را اصلاح می‌کند (ماه بسته‌شده مستثناست و ۴۰۹ می‌دهد).
const attendanceRepository = require('../repositories/attendanceRepository');
const shiftsRepository = require('../repositories/shiftsRepository');
const userDayScheduleRepository = require('../repositories/userDayScheduleRepository');
const dayService = require('../engine/dayService');
const { virtualShiftFor } = require('../engine/calendarService');
const { todayDateString } = require('../utils/serverTime');

const MAX_RECORDS = 400;

function metrics(day) {
  return { late: day.late || 0, earlyLeave: day.earlyLeave || 0, overtime: day.overtime || 0, expected: day.expected || 0 };
}

// ⇒ { from, to, shiftId, shiftName, isRetroactive, totals: { records, changedDays, lateBefore, lateAfter, ... }, days: [{ date, before, after, changed, overridden }] }
function preview(user, shift, effectiveFrom) {
  const to = todayDateString();
  const from = effectiveFrom > to ? to : effectiveFrom;
  const records = effectiveFrom > to ? [] : attendanceRepository
    .search({ from, to, userIds: [user.id], limit: MAX_RECORDS })
    .filter((r) => r.check_in_time)
    .sort((a, b) => (a.record_date < b.record_date ? -1 : 1));
  const ctx = dayService.loadContext();
  const days = [];
  for (const record of records) {
    const date = record.record_date;
    let before;
    let after;
    let overridden = false;
    try {
      before = metrics(dayService.computeRecordDay(record, { context: ctx }));
      const override = userDayScheduleRepository.get(user.id, date);
      if (override) { overridden = true; after = before; } // برنامه‌ی ویژه‌ی همان روز بر شیفت غالب است ⇒ تغییری نمی‌کند
      else {
        const base = shift ? shiftsRepository.applyWeekdayHours(shift, date) : null;
        after = metrics(dayService.computeRecordDay(record, { context: ctx, shift: virtualShiftFor(base, null, ctx.settings) }));
      }
    } catch (err) {
      if (err instanceof RangeError) continue; // رکورد با زمان خراب
      throw err;
    }
    days.push({ date, before, after, overridden, changed: JSON.stringify(before) !== JSON.stringify(after) });
  }
  const sum = (key, side) => days.reduce((n, d) => n + d[side][key], 0);
  return {
    from,
    to,
    shiftId: shift ? shift.id : null,
    shiftName: shift ? shift.name : null,
    isRetroactive: effectiveFrom < to,
    truncated: records.length >= MAX_RECORDS,
    totals: {
      records: days.length,
      changedDays: days.filter((d) => d.changed).length,
      lateDaysBefore: days.filter((d) => d.before.late > 0).length,
      lateDaysAfter: days.filter((d) => d.after.late > 0).length,
      lateBefore: sum('late', 'before'),
      lateAfter: sum('late', 'after'),
      earlyLeaveBefore: sum('earlyLeave', 'before'),
      earlyLeaveAfter: sum('earlyLeave', 'after'),
      overtimeBefore: sum('overtime', 'before'),
      overtimeAfter: sum('overtime', 'after'),
    },
    days: days.filter((d) => d.changed),
  };
}

module.exports = { preview };

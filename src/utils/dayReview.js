// منطق مشترک «مرور شبانه»: وضعیت یک روز مشخص برای فهرستی از کارمندان.
// هم API پنل (GET /api/admin/nightly-review) و هم پیام شبانه‌ی بات از همین تابع استفاده می‌کنند
// تا هر دو همیشه یک نتیجه نشان بدهند.

const attendanceRepository = require('../repositories/attendanceRepository');
const holidaysRepository = require('../repositories/holidaysRepository');
const settingsRepository = require('../repositories/settingsRepository');
const { getCalendarDay } = require('../engine/calendarService');
const leaveRepository = require('../repositories/leaveRepository');
const dayService = require('../engine/dayService');
const { todayDateString } = require('./serverTime');

// S3-8b: تقویم همان روز برای همان کاربر (تعطیلی کامل/دپارتمانی، آخر هفته، روز غیرکاریِ شیفت). داده‌ی خراب ⇒ روز کاری (رفتار قبلی)، نه خطا.
function calendarOf(user, date, ctx) {
  try {
    return getCalendarDay(user, date, ctx);
  } catch (err) {
    console.error('[dayReview] getCalendarDay ناموفق:', err.message);
    return { isWorkingDay: true, kind: 'working' };
  }
}

/**
 * @param {Array} users کاربران (ردیف‌های جدول users)
 * @param {string} date YYYY-MM-DD
 */
function reviewDay(allUsers, date) {
  const today = todayDateString();
  // کارمندی که بعد از آن تاریخ ساخته شده، در آن روز «غایب» نیست؛ اصلاً در سیستم نبوده
  const users = allUsers.filter((u) => !u.created_at || String(u.created_at).slice(0, 10) <= date);
  const ctx = { settings: settingsRepository.getAll(), holidays: holidaysRepository.listByDate(date) };
  const records = users.length
    ? attendanceRepository.search({ from: date, to: date, userIds: users.map((u) => u.id), limit: 5000 })
    : [];
  const byUser = new Map();
  records.forEach((r) => { if (!byUser.has(r.user_id)) byUser.set(r.user_id, r); });

  return users.map((user) => {
    const record = byUser.get(user.id) || null;
    const hasCheckIn = !!(record && record.check_in_time);
    const noCheckout = hasCheckIn && !record.check_out_time && !['leave', 'holiday'].includes(record.status);
    const onLeave = leaveRepository.hasApprovedLeaveOnDate(user.id, date, 'leave');
    const onMission = leaveRepository.hasApprovedMissionOnDate(user.id, date);
    const calendar = calendarOf(user, date, ctx);

    let state;
    if (record && record.status === 'holiday') state = 'holiday';
    else if (record && record.status === 'leave') state = 'leave';
    else if (record && record.status === 'incomplete') state = 'incomplete';
    else if (hasCheckIn && record.check_out_time) state = 'checked_out';
    else if (hasCheckIn) state = date < today ? 'incomplete' : 'present';
    else if (calendar.kind === 'holiday') state = 'holiday';
    else if (!calendar.isWorkingDay) state = 'holiday'; // آخر هفته/روز غیرکاریِ شیفت: کسی غایب نیست (S3-8b)
    else if (onLeave) state = 'leave';
    else state = 'absent';

    const summary = hasCheckIn ? dayService.summarizeRecord(record) : null;
    const lateMinutes = summary ? summary.lateMinutes : 0;

    return {
      user: {
        id: user.id,
        fullName: user.full_name,
        personnelCode: user.personnel_code,
        department: user.department,
        telegramUserId: user.telegram_user_id,
      },
      state,
      calendarKind: calendar.kind, // working | half | weekend | holiday (افزایشی؛ S3-8b)
      onMission,
      noCheckout,
      lateMinutes,
      earlyLeaveMinutes: summary ? summary.earlyLeaveMinutes : 0,
      // بدون ثبت خروج، «ساعت مفید» بی‌معنی است
      effectiveMinutes: summary && !noCheckout ? summary.effectiveMinutes : null,
      checkIn: record ? record.check_in_time : null,
      checkOut: record ? record.check_out_time : null,
      recordId: record ? record.id : null,
      needsAttention: state === 'absent' || state === 'incomplete' || noCheckout || lateMinutes > 0,
    };
  });
}

function summarize(rows) {
  const t = {
    total: rows.length, present: 0, late: 0, noCheckout: 0, absent: 0, leave: 0, holiday: 0, attention: 0,
  };
  rows.forEach((r) => {
    if (r.state === 'checked_out' || r.state === 'present') t.present += 1;
    if (r.lateMinutes > 0) t.late += 1;
    if (r.noCheckout) t.noCheckout += 1;
    if (r.state === 'absent') t.absent += 1;
    if (r.state === 'leave') t.leave += 1;
    if (r.state === 'holiday') t.holiday += 1;
    if (r.needsAttention) t.attention += 1;
  });
  return t;
}

module.exports = { reviewDay, summarize };

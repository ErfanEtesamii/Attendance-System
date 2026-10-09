// S4-14a: تقویم تیم — وضعیت هر روز/هر کاربر در یک ماه شمسی (برای نمای شبکه‌ای در S4-14b).
// بدون N+1: یک کوئری برای رکوردهای تردد (IN روی idx_attendance_user_date)، یک کوئری برای مرخصی‌های
// تأییدشده (IN روی idx_leave_user_status)، یک‌بار خواندن کل جدول holidays و یک‌بار خواندن همه‌ی شیفت‌ها (جدول‌های کوچک؛ فیلتر/نگاشت در JS).
// وضعیت تأخیر با computeDay مستقیم و breaks=[] (تأخیر به استراحت وابسته نیست) و پنجره‌های مرخصی از داده‌ی حافظه ساخته می‌شود؛
// پس به‌ازای هر رکورد هیچ کوئری اضافه (استراحت/مرخصی) اجرا نمی‌شود.
// بدون migration جدید: ایندکس‌های موجود (001_baseline؛ idx_leave_user_status در 014 حفظ شده) برای این الگوی کوئری کافی‌اند.
//
// مجوز: dashboard.read (مثل بقیه‌ی نماهای تیمی/داشبورد؛ کارمند این مجوز را ندارد ⇒ ۴۰۳).
// اسکوپ: scopedUserIds مشترک (common.js) — برای سرپرست «فقط زیرمجموعه‌های مستقیم» (بدون ردیف خودش، مطابق تعریف کانونی).
//
// اولویت تعیین وضعیت هر سلول (روز×کاربر):
//   ۱) رکورد با ورود ثبت‌شده (حتی در روز تعطیل/آخر هفته) ⇒ incomplete | late | present
//   ۲) رکورد دستی بدون ورود با status='leave'|'holiday' ⇒ leave | holiday (مثل classifyToday/aggregateRecords)
//   ۳) روز غیرکاری طبق تقویم (تعطیل کامل یا آخر هفته) ⇒ holiday | weekend
//   ۴) مرخصی/مأموریتِ تأییدشده «تمام‌روز» (unit='day') ⇒ leave | mission
//      (مرخصی ساعتی/نیم‌روزی کل روز را مرخصی نمی‌کند؛ فقط در فیلد leave گزارش می‌شود و وضعیت از ادامه‌ی قواعد می‌آید)
//   ۵) تاریخ بعد از امروز ⇒ future
//   ۶) امروز بدون رکورد ⇒ pending
//   ۷) گذشته بدون رکورد ⇒ absent

const express = require('express');
const router = express.Router();

const { requirePermission } = require('../../../middleware/permissions');
const usersRepository = require('../../../repositories/usersRepository');
const attendanceRepository = require('../../../repositories/attendanceRepository');
const leaveRepository = require('../../../repositories/leaveRepository');
const holidaysRepository = require('../../../repositories/holidaysRepository');
const shiftsRepository = require('../../../repositories/shiftsRepository');
const dayService = require('../../../engine/dayService');
const { computeDay } = require('../../../engine/computeDay');
const { resolveCalendarDay, pickHoliday } = require('../../../engine/calendarService');
const { leaveWindowsOnDate, requestRowToValue } = require('../../../utils/leaveUnits');
const { jalaliMonthRangeOf, jalaliMonthDates } = require('../../../utils/jalali');
const { todayDateString } = require('../../../utils/serverTime');
const { scopedUserIds, canAccessUser } = require('./common');

const bad = (res, code, error) => res.status(400).json({ error, code });
const isId = (v) => /^\d+$/.test(String(v));
const unitOf = (l) => l.unit || 'day';

function parseQuery(q) {
  const year = /^\d{3,4}$/.test(String(q.year || '')) ? parseInt(q.year, 10) : NaN;
  const month = /^\d{1,2}$/.test(String(q.month || '')) ? parseInt(q.month, 10) : NaN;
  if (!Number.isInteger(year) || year < 1300 || year > 1500) {
    return { ok: false, code: 'INVALID_YEAR', error: 'سال شمسی نامعتبر است.' };
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return { ok: false, code: 'INVALID_MONTH', error: 'ماه شمسی باید بین ۱ و ۱۲ باشد.' };
  }
  const out = { year, month };
  if (q.userId !== undefined) {
    if (!isId(q.userId)) return { ok: false, code: 'INVALID_USER', error: 'شناسه‌ی کاربر نامعتبر است.' };
    out.userId = parseInt(q.userId, 10);
  }
  if (q.department !== undefined && q.department !== '') out.department = String(q.department).trim();
  return { ok: true, value: out };
}

// دقیقه‌های تأخیر یک رکورد دارای ورود؛ بدون هیچ کوئری (breaks خالی؛ مرخصی‌ها از حافظه). زمان خراب ⇒ ۰ (route نمی‌شکند).
function lateMinutesOf({ record, dateStr, shift, cal, dayLeaves, dayCtx }) {
  try {
    const rows = dayLeaves.length ? leaveWindowsOnDate(dayLeaves.map(requestRowToValue), dateStr, () => cal) : [];
    const day = computeDay({
      record,
      breaks: [],
      settings: dayCtx.settings,
      timezone: dayCtx.timezone,
      shift,
      calendar: cal,
      approvedLeaves: rows.length ? rows : null,
    });
    return day.late || 0;
  } catch (err) {
    if (err instanceof RangeError) return 0;
    throw err;
  }
}

// وضعیت یک سلول. همه‌ی ورودی‌ها از قبل در حافظه‌اند.
function buildDayCell({ dateStr, user, shift, record, dayLeaves, settings, holidayRows, today, dayCtx }) {
  const holiday = pickHoliday(holidayRows, user.department);
  const cal = resolveCalendarDay({ dateStr, shift, settings, holiday });
  const fullDayLeave = dayLeaves.find((l) => unitOf(l) === 'day') || null;

  let status;
  let lateMinutes = 0;
  if (record && record.check_in_time) {
    if (record.status === 'incomplete') status = 'incomplete';
    else {
      lateMinutes = lateMinutesOf({ record, dateStr, shift, cal, dayLeaves, dayCtx });
      status = lateMinutes > 0 ? 'late' : 'present';
    }
  } else if (record && record.status === 'leave') {
    status = 'leave';
  } else if (record && record.status === 'holiday') {
    status = 'holiday';
  } else if (!cal.isWorkingDay) {
    status = cal.isHoliday ? 'holiday' : 'weekend';
  } else if (fullDayLeave) {
    status = fullDayLeave.kind === 'mission' ? 'mission' : 'leave';
  } else if (dateStr > today) {
    status = 'future';
  } else if (dateStr === today) {
    status = 'pending';
  } else {
    status = 'absent';
  }

  const shown = fullDayLeave || dayLeaves[0] || null;
  return {
    date: dateStr,
    isWorkingDay: cal.isWorkingDay,
    isHoliday: cal.isHoliday,
    holidayTitle: cal.holidayTitle,
    kind: cal.kind,
    leave: shown
      ? {
        kind: shown.kind,
        leaveTypeId: shown.leave_type_id,
        requestId: shown.id,
        unit: unitOf(shown),
        halfDayPart: shown.half_day_part || null,
        startTime: shown.start_time || null,
        endTime: shown.end_time || null,
      }
      : null,
    hasRecord: !!record,
    status,
    lateMinutes,
  };
}

// GET /admin/calendar?year=&month=&userId=&department=  (year/month شمسی)
router.get('/admin/calendar', requirePermission('dashboard.read'), (req, res) => {
  const parsed = parseQuery(req.query);
  if (!parsed.ok) return bad(res, parsed.code, parsed.error);
  const { year, month, userId, department } = parsed.value;
  const me = req.adminUser;

  let range;
  try {
    range = jalaliMonthRangeOf(year, month);
  } catch (err) {
    return bad(res, 'INVALID_DATE', err.message);
  }

  const scoped = scopedUserIds(me); // null = بدون محدودیت (admin/hr)
  let users = usersRepository.listUsers({});
  if (scoped !== null) users = users.filter((u) => scoped.includes(u.id));
  if (userId !== undefined) {
    if (!canAccessUser(me, userId)) return res.status(403).json({ error: 'به این کاربر دسترسی ندارید.' });
    const target = usersRepository.findById(userId);
    if (!target) return res.status(404).json({ error: 'کاربر یافت نشد.' });
    users = [target];
  } else if (department) {
    users = users.filter((u) => (u.department || '').trim() === department);
  }

  const dayCtx = dayService.loadContext();
  const { settings } = dayCtx;
  // S4-14b: آستانه‌ی هشدار هم‌زمانی (تنظیم teamCalendarMaxConcurrent؛ ۰ = خاموش) برای UI؛ محاسبه‌ی هشدار سمت UI روی افراد نمایش‌داده‌شده است.
  const maxConcurrent = Math.max(0, parseInt(settings.teamCalendarMaxConcurrent, 10) || 0);
  const head = { year, month, from: range.from, to: range.to, label: range.label, maxConcurrent };
  if (!users.length) return res.json({ ...head, users: [] });

  const allIds = users.map((u) => u.id);
  const dates = jalaliMonthDates(year, month);
  const today = todayDateString();

  // ---- خواندن‌های کلی (بدون N+1) ----
  const records = attendanceRepository.listByUserIdsAndRange(allIds, range.from, range.to);
  const leaves = leaveRepository.listApprovedInRange(allIds, range.from, range.to);
  const holidaysByDate = new Map();
  for (const h of holidaysRepository.listHolidays()) {
    if (h.holiday_date < range.from || h.holiday_date > range.to) continue;
    if (!holidaysByDate.has(h.holiday_date)) holidaysByDate.set(h.holiday_date, []);
    holidaysByDate.get(h.holiday_date).push(h);
  }
  const shiftById = new Map(shiftsRepository.listShifts().map((sh) => [sh.id, sh]));
  const recordsByUser = new Map();
  for (const r of records) {
    if (!recordsByUser.has(r.user_id)) recordsByUser.set(r.user_id, new Map());
    recordsByUser.get(r.user_id).set(r.record_date, r);
  }
  const leavesByUser = new Map();
  for (const l of leaves) {
    if (!leavesByUser.has(l.user_id)) leavesByUser.set(l.user_id, []);
    leavesByUser.get(l.user_id).push(l);
  }

  const result = users.map((u) => {
    const shift = (u.shift_id != null && shiftById.get(u.shift_id)) || null; // از کش یک‌باره‌ی شیفت‌ها (بدون کوئری به‌ازای کاربر)
    const recMap = recordsByUser.get(u.id) || new Map();
    const userLeaves = leavesByUser.get(u.id) || [];
    const days = dates.map((dateStr) => buildDayCell({
      dateStr,
      user: u,
      shift,
      record: recMap.get(dateStr) || null,
      dayLeaves: userLeaves.filter((l) => dateStr >= l.start_date && dateStr <= l.end_date),
      settings,
      holidayRows: holidaysByDate.get(dateStr) || [],
      today,
      dayCtx,
    }));
    return {
      user: {
        id: u.id,
        fullName: u.full_name,
        personnelCode: u.personnel_code,
        department: u.department || null,
        isActive: !!u.is_active,
      },
      days,
    };
  });

  return res.json({ ...head, users: result });
});

module.exports = router;

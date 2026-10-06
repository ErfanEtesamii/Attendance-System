// ابزارهای مشترک مسیرهای پنل مدیریتی (قبلاً بین admin.js و adminPanel.js تکرار/پراکنده بود).
// اسکوپ نقش‌ها (scopedUserIds) تنها یک‌جا تعریف می‌شود تا admin/manager/employee در همه‌ی routeها یکسان رفتار کنند.

const usersRepository = require('../../../repositories/usersRepository');
const breakRepository = require('../../../repositories/breakRepository');
const auditRepository = require('../../../repositories/auditRepository');
const workHours = require('../../../utils/workHours');
const { todayDateString } = require('../../../utils/serverTime');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES = ['normal', 'late', 'incomplete', 'leave', 'holiday'];

function scopedUserIds(adminUser) {
  if (adminUser.role === 'admin') return null;
  if (adminUser.role === 'employee') return [adminUser.id]; // کارمند فقط خودش
  return usersRepository.listUsers({ managerId: adminUser.id }).map((u) => u.id);
}

function visibleUsers(adminUser, { onlyActive = false } = {}) {
  const ids = scopedUserIds(adminUser);
  let users = usersRepository.listUsers({ onlyActive });
  if (ids !== null) users = users.filter((u) => ids.includes(u.id));
  return users;
}

function canAccessUser(adminUser, userId) {
  const ids = scopedUserIds(adminUser);
  return ids === null || ids.includes(Number(userId));
}

function shiftDate(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function parseRange(query, defaultDays = 30) {
  const to = DATE_RE.test(query.to || '') ? query.to : todayDateString();
  const from = DATE_RE.test(query.from || '') ? query.from : shiftDate(to, -(defaultDays - 1));
  return { from, to };
}

function isoOrNull(value) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'INVALID';
  return d.toISOString();
}

function userBrief(u) {
  if (!u) return null;
  return {
    id: u.id,
    fullName: u.full_name,
    personnelCode: u.personnel_code,
    department: u.department,
    role: u.role,
    isActive: !!u.is_active,
    telegramUserId: u.telegram_user_id,
  };
}

// رکورد قدیمی که خروج ندارد (ناقص) نباید ساعت مفیدش تا «الان» کش بیاید - عدد بی‌معنی می‌شود
function safeSummary(record) {
  const s = workHours.summarizeRecord(record);
  if (record.check_in_time && !record.check_out_time && record.record_date < todayDateString()) {
    s.effectiveMinutes = null;
    s.isOpen = false;
  }
  return s;
}

function enrichRecord(record, userMap) {
  const breaks = breakRepository.listByAttendanceRecord(record.id);
  return {
    ...record,
    user: userBrief(userMap ? userMap.get(record.user_id) : usersRepository.findById(record.user_id)),
    breaks,
    breakMinutes: breakRepository.totalBreakMinutes(record.id),
    summary: safeSummary(record),
  };
}

function makeUserMap() {
  const map = new Map();
  usersRepository.listUsers({}).forEach((u) => map.set(u.id, u));
  return map;
}

function requireReason(req, res) {
  const reason = ((req.body && req.body.reason) || req.query.reason || '').toString().trim();
  if (!reason) {
    res.status(400).json({ error: 'ذکر دلیل برای این عملیات الزامی است.' });
    return null;
  }
  return reason;
}

function audit(req, action, details) {
  auditRepository.logEvent({
    userId: req.adminUser.id,
    action,
    ipAddress: req.ip,
    details: { source: 'admin_panel', ...details },
  });
}

// وضعیت زنده‌ی امروز یک کارمند
function classifyToday(user, record, openBreak, today, holiday, onLeave) {
  if (record) {
    if (record.status === 'holiday') return 'holiday';
    if (record.status === 'leave') return 'leave';
    if (record.status === 'incomplete') return 'incomplete';
    if (record.check_in_time && record.check_out_time) return 'checked_out';
    if (record.check_in_time && openBreak) return 'on_break';
    if (record.check_in_time) return 'present';
  }
  if (holiday) return 'holiday';
  if (onLeave) return 'leave';
  return 'absent';
}

function minutesToHHMM(mins) {
  if (mins == null || Number.isNaN(mins)) return null;
  const m = Math.round(mins);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function aggregateRecords(records) {
  const agg = {
    recordCount: records.length,
    presentDays: 0,
    totalEffective: 0,
    avgEffective: 0,
    lateCount: 0,
    totalLateMinutes: 0,
    earlyLeaveCount: 0,
    totalEarlyMinutes: 0,
    overtimeMinutes: 0,
    incompleteCount: 0,
    leaveDays: 0,
    holidayDays: 0,
    avgCheckIn: null,
  };
  let checkInSum = 0;
  let checkInN = 0;
  let effN = 0;
  records.forEach((r) => {
    if (r.status === 'leave') agg.leaveDays += 1;
    if (r.status === 'holiday') agg.holidayDays += 1;
    if (r.status === 'incomplete') agg.incompleteCount += 1;
    if (!r.check_in_time) return;
    const s = safeSummary(r);
    agg.presentDays += 1;
    if (s.effectiveMinutes != null) {
      agg.totalEffective += s.effectiveMinutes;
      effN += 1;
    }
    if (s.lateMinutes > 0) {
      agg.lateCount += 1;
      agg.totalLateMinutes += s.lateMinutes;
    }
    if (s.earlyLeaveMinutes > 0) {
      agg.earlyLeaveCount += 1;
      agg.totalEarlyMinutes += s.earlyLeaveMinutes;
    }
    agg.overtimeMinutes += s.overtimeMinutes;
    checkInSum += workHours.minutesSinceMidnight(new Date(r.check_in_time));
    checkInN += 1;
  });
  agg.avgEffective = effN ? Math.round(agg.totalEffective / effN) : 0;
  agg.avgCheckIn = checkInN ? minutesToHHMM(checkInSum / checkInN) : null;
  return agg;
}

module.exports = {
  DATE_RE,
  STATUSES,
  scopedUserIds,
  visibleUsers,
  canAccessUser,
  shiftDate,
  parseRange,
  isoOrNull,
  userBrief,
  safeSummary,
  enrichRecord,
  makeUserMap,
  requireReason,
  audit,
  classifyToday,
  minutesToHHMM,
  aggregateRecords,
};

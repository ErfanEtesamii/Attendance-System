// مسیرهای تکمیلی پنل مدیریتی وب: کنترل کامل و مشاهده‌ی همه‌ی جزئیات.
//
// این فایل مکمل admin.js است (همان احراز هویت/اسکوپ): ادمین کل همه‌چیز را می‌بیند و تغییر می‌دهد،
// مدیر دپارتمان (role=manager) فقط تیم خودش را می‌بیند و فقط اکشن‌های «بررسی» (اعتراض‌ها، پیام به
// کارمند تیم) دارد. هر عملیات نوشتنی حساس: دلیل اجباری + ثبت در audit_log.

const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const router = express.Router();

const config = require('../../config');
const { getDb } = require('../../db/connection');
const { requireAdminAuth, requireFullAdmin } = require('../../middleware/adminAuth');
const usersRepository = require('../../repositories/usersRepository');
const attendanceRepository = require('../../repositories/attendanceRepository');
const breakRepository = require('../../repositories/breakRepository');
const leaveRepository = require('../../repositories/leaveRepository');
const holidaysRepository = require('../../repositories/holidaysRepository');
const disputeRepository = require('../../repositories/disputeRepository');
const auditRepository = require('../../repositories/auditRepository');
const workHours = require('../../utils/workHours');
const { todayDateString, nowIso } = require('../../utils/serverTime');
const { sendMessage } = require('../../bot/notifier');
const { sendCsv } = require('../../utils/csv');

router.use('/admin', requireAdminAuth);

// ---------- ابزارهای مشترک ----------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES = ['normal', 'late', 'incomplete', 'leave', 'holiday'];

function scopedUserIds(adminUser) {
  if (adminUser.role === 'admin') return null;
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

// ---------- نمای کلی (داشبورد کامل) ----------

router.get('/admin/overview', (req, res) => {
  const today = todayDateString();
  const users = visibleUsers(req.adminUser, { onlyActive: true });
  const userIds = users.map((u) => u.id);
  const holiday = holidaysRepository.isHoliday(today);

  const totals = {
    employees: users.length,
    present: 0,
    onBreak: 0,
    checkedOut: 0,
    absent: 0,
    onLeave: 0,
    incomplete: 0,
    late: 0,
    holiday: holiday,
  };

  users.forEach((u) => {
    const record = attendanceRepository.findTodayRecord(u.id);
    const openBreak = record ? breakRepository.findOpenBreak(record.id) : null;
    const onLeave = leaveRepository.hasApprovedLeaveOnDate(u.id, today, 'leave');
    const key = classifyToday(u, record, openBreak, today, holiday, onLeave);
    if (key === 'present') totals.present += 1;
    else if (key === 'on_break') totals.onBreak += 1;
    else if (key === 'checked_out') totals.checkedOut += 1;
    else if (key === 'absent') totals.absent += 1;
    else if (key === 'leave') totals.onLeave += 1;
    else if (key === 'incomplete') totals.incomplete += 1;
    if (record && record.check_in_time && workHours.summarizeRecord(record).lateMinutes > 0) {
      totals.late += 1;
    }
  });

  // روند ۱۴ روز اخیر
  const trendFrom = shiftDate(today, -13);
  const recent = attendanceRepository.search({ from: trendFrom, to: today, userIds, limit: 5000 });
  const trend = [];
  for (let i = 13; i >= 0; i -= 1) {
    const date = shiftDate(today, -i);
    const dayRecords = recent.filter((r) => r.record_date === date && r.check_in_time);
    let late = 0;
    let effective = 0;
    dayRecords.forEach((r) => {
      const s = safeSummary(r);
      if (s.lateMinutes > 0) late += 1;
      effective += s.effectiveMinutes || 0;
    });
    trend.push({
      date,
      present: dayRecords.length,
      late,
      incomplete: recent.filter((r) => r.record_date === date && r.status === 'incomplete').length,
      avgEffective: dayRecords.length ? Math.round(effective / dayRecords.length) : 0,
    });
  }

  // دپارتمان‌ها
  const deptMap = new Map();
  users.forEach((u) => {
    const name = u.department || 'بدون دپارتمان';
    if (!deptMap.has(name)) deptMap.set(name, { name, total: 0, present: 0 });
    const d = deptMap.get(name);
    d.total += 1;
    const rec = attendanceRepository.findTodayRecord(u.id);
    if (rec && rec.check_in_time) d.present += 1;
  });

  // پرتأخیرترین‌ها در ۳۰ روز اخیر
  const monthRecords = attendanceRepository.search({
    from: shiftDate(today, -29), to: today, userIds, limit: 20000,
  });
  const lateBy = new Map();
  monthRecords.forEach((r) => {
    if (!r.check_in_time) return;
    const s = workHours.summarizeRecord(r);
    if (s.lateMinutes > 0) {
      const cur = lateBy.get(r.user_id) || { count: 0, minutes: 0 };
      cur.count += 1;
      cur.minutes += s.lateMinutes;
      lateBy.set(r.user_id, cur);
    }
  });
  const userMap = makeUserMap();
  const topLate = [...lateBy.entries()]
    .map(([id, v]) => ({ userId: id, fullName: userMap.get(id)?.full_name || '—', ...v }))
    .sort((a, b) => b.count - a.count || b.minutes - a.minutes)
    .slice(0, 5);

  // درخواست‌ها / اعتراض‌های باز
  const pendingLeave = leaveRepository.listPending().filter((r) => userIds.includes(r.user_id)).length;
  const openDisputes = disputeRepository.listOpen().filter((d) => userIds.includes(d.user_id)).length;

  let recentActivity = [];
  if (req.adminUser.role === 'admin') {
    recentActivity = auditRepository.listRecent(8).map((r) => ({
      ...r,
      userFullName: r.user_id ? userMap.get(r.user_id)?.full_name || null : null,
    }));
  }

  res.json({
    date: today,
    totals,
    pending: { leave: pendingLeave, disputes: openDisputes },
    trend,
    departments: [...deptMap.values()].sort((a, b) => b.total - a.total),
    topLate,
    recentActivity,
    settings: require('../../repositories/settingsRepository').getAll(),
  });
});

// ---------- تابلوی زنده‌ی امروز ----------

router.get('/admin/live', (req, res) => {
  const today = todayDateString();
  const holiday = holidaysRepository.isHoliday(today);
  const users = visibleUsers(req.adminUser, { onlyActive: true });

  const rows = users.map((u) => {
    const record = attendanceRepository.findTodayRecord(u.id);
    const breaks = record ? breakRepository.listByAttendanceRecord(record.id) : [];
    const openBreak = breaks.find((b) => !b.end_time) || null;
    const onLeave = leaveRepository.hasApprovedLeaveOnDate(u.id, today, 'leave');
    const onMission = leaveRepository.hasApprovedMissionOnDate(u.id, today);
    const state = classifyToday(u, record, openBreak, today, holiday, onLeave);
    return {
      user: userBrief(u),
      state,
      onMission,
      record: record || null,
      breaks,
      openBreak,
      breakMinutes: record ? breakRepository.totalBreakMinutes(record.id) : 0,
      summary: record ? workHours.summarizeRecord(record) : null,
    };
  });

  res.json({ date: today, serverTime: nowIso(), holiday, rows });
});

// ---------- جستجو و مرور همه‌ی رکوردهای تردد ----------

function filteredAttendance(req) {
  const { from, to } = parseRange(req.query, 7);
  const { userId, department, status, q } = req.query;
  let users = visibleUsers(req.adminUser);
  if (userId) users = users.filter((u) => String(u.id) === String(userId));
  if (department) users = users.filter((u) => (u.department || '') === department);
  if (q) {
    const needle = q.toString().trim().toLowerCase();
    users = users.filter(
      (u) =>
        (u.full_name || '').toLowerCase().includes(needle) ||
        (u.personnel_code || '').toLowerCase().includes(needle)
    );
  }
  const limit = Math.min(parseInt(req.query.limit, 10) || 500, 2000);
  const records = attendanceRepository.search({
    from,
    to,
    userIds: users.map((u) => u.id),
    status: STATUSES.includes(status) ? status : null,
    limit,
  });
  const userMap = new Map(users.map((u) => [u.id, u]));
  return { from, to, records, userMap };
}

router.get('/admin/attendance', (req, res) => {
  const { from, to, records, userMap } = filteredAttendance(req);
  res.json({ from, to, count: records.length, records: records.map((r) => enrichRecord(r, userMap)) });
});

router.get('/admin/attendance/export', (req, res) => {
  const { from, to, records, userMap } = filteredAttendance(req);
  const fmt = (iso) => (iso ? new Date(iso).toLocaleString('fa-IR') : '');
  const rows = records.map((r) => {
    const e = enrichRecord(r, userMap);
    return [
      e.user?.fullName || '', e.user?.personnelCode || '', e.user?.department || '',
      r.record_date, fmt(r.check_in_time), r.check_in_ip || '', fmt(r.check_out_time),
      r.check_out_ip || '', e.breakMinutes, e.summary.effectiveMinutes ?? '', e.summary.lateMinutes,
      e.summary.earlyLeaveMinutes, e.summary.overtimeMinutes, r.status,
    ];
  });
  audit(req, 'attendance_exported', { from, to, count: rows.length });
  sendCsv(
    res,
    `attendance-records_${from}_${to}.csv`,
    ['نام', 'کد پرسنلی', 'دپارتمان', 'تاریخ', 'ورود', 'IP ورود', 'خروج', 'IP خروج',
      'دقیقه استراحت', 'دقیقه مفید', 'دقیقه تأخیر', 'دقیقه خروج زودهنگام', 'دقیقه اضافه‌کاری', 'وضعیت'],
    rows
  );
});

// ---------- جزئیات یک رکورد (استراحت‌ها، IPها، تاریخچه‌ی تغییرات) ----------

router.get('/admin/attendance-records/:id', (req, res) => {
  const record = attendanceRepository.findById(parseInt(req.params.id, 10));
  if (!record) return res.status(404).json({ error: 'رکورد یافت نشد.' });
  if (!canAccessUser(req.adminUser, record.user_id)) {
    return res.status(403).json({ error: 'به این رکورد دسترسی ندارید.' });
  }
  let history = [];
  if (req.adminUser.role === 'admin') {
    history = auditRepository
      .search({ q: `"recordId":${record.id}`, limit: 50 })
      .map((r) => ({ ...r, userFullName: r.user_id ? usersRepository.findById(r.user_id)?.full_name : null }));
  }
  const disputes = disputeRepository
    .listByUser(record.user_id)
    .filter((d) => d.attendance_record_id === record.id);
  res.json({ ...enrichRecord(record), history, disputes });
});

router.post('/admin/attendance-records', requireFullAdmin, (req, res) => {
  const reason = requireReason(req, res);
  if (!reason) return;
  const { userId, date, checkInTime, checkOutTime, status } = req.body || {};
  const user = usersRepository.findById(parseInt(userId, 10));
  if (!user) return res.status(404).json({ error: 'کارمند یافت نشد.' });
  if (!DATE_RE.test(date || '')) return res.status(400).json({ error: 'تاریخ نامعتبر است (YYYY-MM-DD).' });
  const ci = isoOrNull(checkInTime);
  const co = isoOrNull(checkOutTime);
  if (ci === 'INVALID' || co === 'INVALID') return res.status(400).json({ error: 'ساعت نامعتبر است.' });
  if (ci && co && new Date(co) < new Date(ci)) {
    return res.status(400).json({ error: 'ساعت خروج نمی‌تواند قبل از ورود باشد.' });
  }
  const st = STATUSES.includes(status) ? status : 'normal';
  const existing = getDb()
    .prepare('SELECT id FROM attendance_records WHERE user_id = ? AND record_date = ?')
    .get(user.id, date);
  if (existing) {
    return res.status(409).json({ error: 'برای این کارمند در این تاریخ از قبل رکورد وجود دارد.', recordId: existing.id });
  }
  const created = attendanceRepository.createManual({
    userId: user.id, recordDate: date, checkInTime: ci, checkOutTime: co, status: st,
  });
  audit(req, 'attendance_record_manually_created', { recordId: created.id, targetUserId: user.id, date, reason });
  res.status(201).json(enrichRecord(created));
});

router.delete('/admin/attendance-records/:id', requireFullAdmin, (req, res) => {
  const reason = requireReason(req, res);
  if (!reason) return;
  const record = attendanceRepository.findById(parseInt(req.params.id, 10));
  if (!record) return res.status(404).json({ error: 'رکورد یافت نشد.' });
  attendanceRepository.removeWithBreaks(record.id);
  audit(req, 'attendance_record_deleted', {
    recordId: record.id, targetUserId: record.user_id, date: record.record_date,
    snapshot: { in: record.check_in_time, out: record.check_out_time, status: record.status }, reason,
  });
  res.json({ ok: true });
});

// ---------- استراحت‌ها ----------

router.post('/admin/attendance-records/:id/breaks', requireFullAdmin, (req, res) => {
  const reason = requireReason(req, res);
  if (!reason) return;
  const record = attendanceRepository.findById(parseInt(req.params.id, 10));
  if (!record) return res.status(404).json({ error: 'رکورد یافت نشد.' });
  const { breakType, startTime, endTime } = req.body || {};
  const st = isoOrNull(startTime);
  const en = isoOrNull(endTime);
  if (!st || st === 'INVALID' || en === 'INVALID') return res.status(400).json({ error: 'زمان استراحت نامعتبر است.' });
  if (en && new Date(en) < new Date(st)) return res.status(400).json({ error: 'پایان استراحت قبل از شروع است.' });
  const created = breakRepository.createManual({
    attendanceRecordId: record.id,
    breakType: breakType === 'short_break' ? 'short_break' : 'lunch',
    startTime: st,
    endTime: en,
  });
  audit(req, 'break_record_manually_created', { recordId: record.id, breakId: created.id, targetUserId: record.user_id, reason });
  res.status(201).json(created);
});

router.patch('/admin/break-records/:id', requireFullAdmin, (req, res) => {
  const reason = requireReason(req, res);
  if (!reason) return;
  const br = breakRepository.findById(parseInt(req.params.id, 10));
  if (!br) return res.status(404).json({ error: 'استراحت یافت نشد.' });
  const { breakType, startTime, endTime } = req.body || {};
  const fields = {};
  if (breakType !== undefined) fields.break_type = breakType === 'short_break' ? 'short_break' : 'lunch';
  const st = isoOrNull(startTime);
  const en = isoOrNull(endTime);
  if (st === 'INVALID' || en === 'INVALID') return res.status(400).json({ error: 'زمان نامعتبر است.' });
  if (st) fields.start_time = st;
  if (en !== undefined) fields.end_time = en;
  const startFinal = fields.start_time || br.start_time;
  const endFinal = fields.end_time !== undefined ? fields.end_time : br.end_time;
  if (endFinal && new Date(endFinal) < new Date(startFinal)) {
    return res.status(400).json({ error: 'پایان استراحت قبل از شروع است.' });
  }
  const updated = breakRepository.updateManual(br.id, fields);
  const record = attendanceRepository.findById(br.attendance_record_id);
  audit(req, 'break_record_manually_edited', {
    recordId: br.attendance_record_id, breakId: br.id, targetUserId: record?.user_id, fields: Object.keys(fields), reason,
  });
  res.json(updated);
});

router.delete('/admin/break-records/:id', requireFullAdmin, (req, res) => {
  const reason = requireReason(req, res);
  if (!reason) return;
  const br = breakRepository.findById(parseInt(req.params.id, 10));
  if (!br) return res.status(404).json({ error: 'استراحت یافت نشد.' });
  breakRepository.remove(br.id);
  const record = attendanceRepository.findById(br.attendance_record_id);
  audit(req, 'break_record_deleted', {
    recordId: br.attendance_record_id, breakId: br.id, targetUserId: record?.user_id, reason,
  });
  res.json({ ok: true });
});

// ---------- پرونده‌ی کامل یک کارمند ----------

router.get('/admin/users/:id/details', (req, res) => {
  const user = usersRepository.findById(parseInt(req.params.id, 10));
  if (!user) return res.status(404).json({ error: 'کارمند یافت نشد.' });
  if (!canAccessUser(req.adminUser, user.id)) {
    return res.status(403).json({ error: 'به این کارمند دسترسی ندارید.' });
  }
  const { from, to } = parseRange(req.query, 30);
  const records = attendanceRepository.listByUserAndRange(user.id, from, to);
  const manager = user.manager_id ? usersRepository.findById(user.manager_id) : null;
  const team = usersRepository.listUsers({ managerId: user.id }).map(userBrief);
  const today = todayDateString();
  const todayRecord = attendanceRepository.findTodayRecord(user.id);

  let audits = [];
  if (req.adminUser.role === 'admin') {
    const own = auditRepository.search({ userId: user.id, limit: 100 });
    const about = auditRepository.search({ q: `"targetUserId":${user.id}`, limit: 100 });
    const seen = new Set();
    audits = [...own, ...about]
      .filter((r) => (seen.has(r.id) ? false : seen.add(r.id)))
      .sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1))
      .slice(0, 100)
      .map((r) => ({ ...r, userFullName: r.user_id ? usersRepository.findById(r.user_id)?.full_name : null }));
  }

  res.json({
    user: {
      ...userBrief(user),
      managerId: user.manager_id,
      managerName: manager ? manager.full_name : null,
      createdAt: user.created_at,
      updatedAt: user.updated_at,
    },
    range: { from, to },
    todayState: todayRecord ? enrichRecord(todayRecord) : null,
    stats: aggregateRecords(records),
    records: records.map((r) => enrichRecord(r)),
    leaves: leaveRepository.listByUser(user.id),
    disputes: disputeRepository.listByUser(user.id),
    team,
    audit: audits,
    onLeaveToday: leaveRepository.hasApprovedLeaveOnDate(user.id, today, 'leave'),
  });
});

router.post('/admin/users/:id/message', (req, res) => {
  const user = usersRepository.findById(parseInt(req.params.id, 10));
  if (!user) return res.status(404).json({ error: 'کارمند یافت نشد.' });
  if (!canAccessUser(req.adminUser, user.id)) {
    return res.status(403).json({ error: 'به این کارمند دسترسی ندارید.' });
  }
  const text = ((req.body && req.body.text) || '').trim();
  if (!text) return res.status(400).json({ error: 'متن پیام خالی است.' });
  if (!user.telegram_user_id) return res.status(400).json({ error: 'این کارمند آیدی تلگرام ثبت‌شده ندارد.' });
  sendMessage(user.telegram_user_id, `📩 پیام از ${req.adminUser.full_name}:\n\n${text}`).then((ok) => {
    audit(req, 'admin_message_sent', { targetUserId: user.id, delivered: ok });
    if (!ok) return res.status(502).json({ error: 'ارسال پیام ناموفق بود (بات تنظیم نشده یا کاربر بات را مسدود کرده).' });
    res.json({ ok: true });
  });
});

// ---------- اعتراض‌های کارمندان ----------

router.get('/admin/disputes', (req, res) => {
  const status = ['open', 'resolved'].includes(req.query.status) ? req.query.status : null;
  const ids = scopedUserIds(req.adminUser);
  let items = disputeRepository.listAll({ status });
  if (ids !== null) items = items.filter((d) => ids.includes(d.user_id));
  const userMap = makeUserMap();
  res.json(
    items.map((d) => {
      const rec = d.attendance_record_id ? attendanceRepository.findById(d.attendance_record_id) : null;
      return {
        id: d.id,
        message: d.message,
        status: d.status,
        createdAt: d.created_at,
        updatedAt: d.updated_at,
        employee: userBrief(userMap.get(d.user_id)),
        record: rec ? { id: rec.id, date: rec.record_date } : null,
      };
    })
  );
});

router.post('/admin/disputes/:id/:action(resolve|reopen)', (req, res) => {
  const dispute = disputeRepository.findById(parseInt(req.params.id, 10));
  if (!dispute) return res.status(404).json({ error: 'اعتراض یافت نشد.' });
  if (!canAccessUser(req.adminUser, dispute.user_id)) {
    return res.status(403).json({ error: 'به این کارمند دسترسی ندارید.' });
  }
  const resolving = req.params.action === 'resolve';
  const updated = disputeRepository.setStatus(dispute.id, resolving ? 'resolved' : 'open');
  const note = ((req.body && req.body.note) || '').trim();
  audit(req, resolving ? 'dispute_resolved' : 'dispute_reopened', {
    disputeId: dispute.id, targetUserId: dispute.user_id, note: note || undefined,
  });
  const employee = usersRepository.findById(dispute.user_id);
  if (resolving && employee?.telegram_user_id) {
    sendMessage(
      employee.telegram_user_id,
      `اعتراض شما بررسی و بسته شد ✅${note ? `\nپاسخ ادمین: ${note}` : ''}`
    );
  }
  res.json(updated);
});

// ---------- مرخصی/مأموریت: کنترل کامل ادمین ----------

router.post('/admin/leave-requests', requireFullAdmin, (req, res) => {
  const { userId, startDate, endDate, leaveType, reason, status } = req.body || {};
  const user = usersRepository.findById(parseInt(userId, 10));
  if (!user) return res.status(404).json({ error: 'کارمند یافت نشد.' });
  if (!DATE_RE.test(startDate || '') || !DATE_RE.test(endDate || '') || endDate < startDate) {
    return res.status(400).json({ error: 'بازه‌ی تاریخ نامعتبر است.' });
  }
  const created = leaveRepository.createLeaveRequest({
    userId: user.id, startDate, endDate, leaveType: leaveType === 'mission' ? 'mission' : 'leave', reason,
  });
  const finalStatus = ['approved', 'rejected', 'pending'].includes(status) ? status : 'approved';
  const saved = finalStatus === 'pending' ? created : leaveRepository.setStatus(created.id, finalStatus, req.adminUser.id);
  audit(req, 'leave_request_created_by_admin', { requestId: saved.id, targetUserId: user.id, status: finalStatus });
  res.status(201).json(saved);
});

router.patch('/admin/leave-requests/:id', requireFullAdmin, (req, res) => {
  const reqRow = leaveRepository.findById(parseInt(req.params.id, 10));
  if (!reqRow) return res.status(404).json({ error: 'درخواست یافت نشد.' });
  const { status, startDate, endDate, leaveType, reason } = req.body || {};
  const fields = {};
  if (status !== undefined) {
    if (!['pending', 'approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'وضعیت نامعتبر است.' });
    fields.status = status;
  }
  if (startDate !== undefined) fields.start_date = startDate;
  if (endDate !== undefined) fields.end_date = endDate;
  if ((fields.start_date || reqRow.start_date) > (fields.end_date || reqRow.end_date)) {
    return res.status(400).json({ error: 'بازه‌ی تاریخ نامعتبر است.' });
  }
  if (leaveType !== undefined) fields.leave_type = leaveType === 'mission' ? 'mission' : 'leave';
  if (reason !== undefined) fields.reason = reason;
  const updated = leaveRepository.updateManual(reqRow.id, fields, req.adminUser.id);
  audit(req, 'leave_request_edited_by_admin', {
    requestId: reqRow.id, targetUserId: reqRow.user_id, fields: Object.keys(fields), from: reqRow.status, to: updated.status,
  });
  const employee = usersRepository.findById(reqRow.user_id);
  if (fields.status && fields.status !== reqRow.status && employee?.telegram_user_id) {
    const label = { approved: 'تأیید شد ✅', rejected: 'رد شد ❌', pending: 'به حالت «در انتظار» بازگشت' }[fields.status];
    sendMessage(
      employee.telegram_user_id,
      `وضعیت درخواست ${updated.leave_type === 'mission' ? 'مأموریت' : 'مرخصی'} شما (${updated.start_date} تا ${updated.end_date}) ${label}`
    );
  }
  res.json(updated);
});

router.delete('/admin/leave-requests/:id', requireFullAdmin, (req, res) => {
  const reqRow = leaveRepository.findById(parseInt(req.params.id, 10));
  if (!reqRow) return res.status(404).json({ error: 'درخواست یافت نشد.' });
  leaveRepository.remove(reqRow.id);
  audit(req, 'leave_request_deleted_by_admin', { requestId: reqRow.id, targetUserId: reqRow.user_id });
  res.json({ ok: true });
});

// ---------- گزارش تحلیلی ----------

router.get('/admin/reports/summary', (req, res) => {
  const { from, to } = parseRange(req.query, 30);
  const { department, userId } = req.query;
  let users = visibleUsers(req.adminUser);
  if (department) users = users.filter((u) => (u.department || '') === department);
  if (userId) users = users.filter((u) => String(u.id) === String(userId));
  const userIds = users.map((u) => u.id);
  const all = attendanceRepository.search({ from, to, userIds, limit: 50000 });

  const rows = users.map((u) => ({
    user: userBrief(u),
    ...aggregateRecords(all.filter((r) => r.user_id === u.id)),
  }));

  const deptMap = new Map();
  rows.forEach((r) => {
    const name = r.user.department || 'بدون دپارتمان';
    const d = deptMap.get(name) || { name, employees: 0, presentDays: 0, totalEffective: 0, lateCount: 0, incompleteCount: 0, leaveDays: 0 };
    d.employees += 1;
    d.presentDays += r.presentDays;
    d.totalEffective += r.totalEffective;
    d.lateCount += r.lateCount;
    d.incompleteCount += r.incompleteCount;
    d.leaveDays += r.leaveDays;
    deptMap.set(name, d);
  });

  const daily = [];
  for (let d = from; d <= to && daily.length < 366; d = shiftDate(d, 1)) {
    const recs = all.filter((r) => r.record_date === d && r.check_in_time);
    let eff = 0;
    let late = 0;
    recs.forEach((r) => {
      const s = safeSummary(r);
      eff += s.effectiveMinutes || 0;
      if (s.lateMinutes > 0) late += 1;
    });
    daily.push({ date: d, present: recs.length, late, totalEffective: eff });
  }

  res.json({
    from, to,
    totals: aggregateRecords(all),
    rows,
    departments: [...deptMap.values()],
    daily,
    departmentOptions: [...new Set(visibleUsers(req.adminUser).map((u) => u.department).filter(Boolean))],
  });
});

// ---------- ارسال پیام گروهی (فقط ادمین کل) ----------

router.post('/admin/broadcast', requireFullAdmin, async (req, res) => {
  const { scope, department, userIds, text } = req.body || {};
  const message = (text || '').trim();
  if (!message) return res.status(400).json({ error: 'متن پیام خالی است.' });

  let targets = usersRepository.listUsers({ onlyActive: true });
  if (scope === 'department') targets = targets.filter((u) => (u.department || '') === (department || ''));
  else if (scope === 'users') {
    const set = new Set((userIds || []).map(Number));
    targets = targets.filter((u) => set.has(u.id));
  } else if (scope !== 'all') {
    return res.status(400).json({ error: 'scope نامعتبر است.' });
  }
  targets = targets.filter((u) => u.telegram_user_id);
  if (!targets.length) return res.status(400).json({ error: 'گیرنده‌ای با آیدی تلگرام پیدا نشد.' });
  if (targets.length > 500) return res.status(400).json({ error: 'حداکثر ۵۰۰ گیرنده در هر ارسال.' });

  let delivered = 0;
  for (const u of targets) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await sendMessage(u.telegram_user_id, `📢 اطلاعیه:\n\n${message}`);
    if (ok) delivered += 1;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 50)); // احترام به rate limit تلگرام
  }
  audit(req, 'broadcast_sent', { scope, department: department || null, recipients: targets.length, delivered });
  res.json({ recipients: targets.length, delivered, failed: targets.length - delivered });
});

// ---------- فیلترهای Audit ----------

router.get('/admin/audit-actions', requireFullAdmin, (req, res) => {
  res.json(auditRepository.listActions());
});

// ---------- سیستم و پشتیبان‌گیری (فقط ادمین کل) ----------

router.get('/admin/system', requireFullAdmin, (req, res) => {
  const db = getDb();
  const count = (t) => db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c;
  const fileSize = (p) => {
    try { return fs.statSync(p).size; } catch (_) { return 0; }
  };
  res.json({
    serverTime: nowIso(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    uptimeSeconds: Math.round(process.uptime()),
    nodeVersion: process.version,
    platform: `${os.type()} ${os.release()}`,
    memoryMb: Math.round(process.memoryUsage().rss / 1048576),
    environment: config.nodeEnv,
    database: {
      path: path.basename(config.dbPath),
      sizeBytes: fileSize(config.dbPath) + fileSize(`${config.dbPath}-wal`),
      tables: {
        users: count('users'),
        attendance_records: count('attendance_records'),
        break_records: count('break_records'),
        leave_requests: count('leave_requests'),
        holidays: count('holidays'),
        record_disputes: count('record_disputes'),
        audit_log: count('audit_log'),
        settings: count('settings'),
      },
    },
    integration: {
      botConfigured: !!config.telegramBotToken,
      botUsername: config.telegramBotUsername || null,
      miniAppUrl: config.miniAppUrl || null,
      httpsDirect: !!(config.sslCertPath && config.sslKeyPath),
      allowedNetworkCidr: config.allowedNetworkCidr,
      trustProxy: config.trustProxy,
      sessionMaxAgeDays: config.adminSessionMaxAgeDays,
    },
    cron: config.cron,
  });
});

router.get('/admin/system/backup', requireFullAdmin, async (req, res) => {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(os.tmpdir(), `attendance-backup-${stamp}.db`);
  try {
    await getDb().backup(dest);
  } catch (err) {
    return res.status(500).json({ error: `پشتیبان‌گیری ناموفق بود: ${err.message}` });
  }
  audit(req, 'database_backup_downloaded', { file: path.basename(dest) });
  res.download(dest, `attendance-backup-${stamp}.db`, () => {
    fs.unlink(dest, () => {});
  });
});

module.exports = router;

// نمای کلی پنل: هویت کاربر جاری، داشبورد خلاصه، نمای کلی کامل، تابلوی زنده و مرور شبانه.
// (تقسیم‌شده از admin.js/adminPanel.js؛ URLها و رفتار بدون تغییر. احراز هویت در index.js یک‌بار اعمال می‌شود.)

const express = require('express');
const router = express.Router();
const { getDb } = require('../../../db/connection');

const usersRepository = require('../../../repositories/usersRepository');
const attendanceRepository = require('../../../repositories/attendanceRepository');
const breakRepository = require('../../../repositories/breakRepository');
const leaveRepository = require('../../../repositories/leaveRepository');
const holidaysRepository = require('../../../repositories/holidaysRepository');
const settingsRepository = require('../../../repositories/settingsRepository');
const disputeRepository = require('../../../repositories/disputeRepository');
const remoteWorkRepository = require('../../../repositories/remoteWorkRepository');
const checkinPermissionRepository = require('../../../repositories/checkinPermissionRepository');
const teamReviewService = require('../../../services/teamReviewService');
const auditRepository = require('../../../repositories/auditRepository');
const dayService = require('../../../engine/dayService');
const dayReview = require('../../../utils/dayReview');
const { todayDateString, nowIso } = require('../../../utils/serverTime');
const { DATE_RE, scopedUserIds, visibleUsers, shiftDate, userBrief, safeSummary, makeUserMap, classifyToday } = require('./common');
const { requirePermission, permissionsFor } = require('../../../middleware/permissions');

router.get('/admin/me', requirePermission('me.read'), (req, res) => {
  const u = req.adminUser;
  res.json({ id: u.id, fullName: u.full_name, role: u.role, department: u.department });
});

// S4-4b: فهرست مجوزهای کاربر جاری برای نمایش/پنهان‌کردن منو و دکمه‌ها در پنل.
// فقط برای UI است؛ امنیت واقعی همچنان با requirePermission روی هر route اعمال می‌شود (پنهان‌بودن دکمه حفاظت نیست).
router.get('/admin/me/permissions', requirePermission('me.read'), (req, res) => {
  const role = req.adminUser.role;
  res.json({ role, permissions: permissionsFor(role) });
});

const DASHBOARD_WIDGETS = ['stats', 'inbox', 'trend', 'late'];
const DASHBOARD_SIZES = new Set(['small', 'medium', 'large']);
const DEFAULT_DASHBOARD_LAYOUT = { order: DASHBOARD_WIDGETS, hidden: [], sizes: {} };
function safeDashboardLayout(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return DEFAULT_DASHBOARD_LAYOUT;
  const allowed = new Set(DASHBOARD_WIDGETS);
  const order = Array.isArray(value.order) ? value.order.filter((x) => allowed.has(x)) : [];
  const hidden = Array.isArray(value.hidden) ? value.hidden.filter((x) => allowed.has(x)) : [];
  const sizes = Object.fromEntries(Object.entries(value.sizes || {}).filter(([key, size]) => allowed.has(key) && DASHBOARD_SIZES.has(size)));
  return { order: [...new Set([...order, ...DASHBOARD_WIDGETS])], hidden: [...new Set(hidden)], sizes };
}
router.get('/admin/me/dashboard-layout', requirePermission('me.read'), (req, res) => {
  const row = getDb().prepare('SELECT dashboard_layout FROM user_dashboard_prefs WHERE user_id = ?').get(req.adminUser.id);
  let raw = null; try { raw = row ? JSON.parse(row.dashboard_layout) : null; } catch (_) {}
  res.json(safeDashboardLayout(raw));
});
router.put('/admin/me/dashboard-layout', requirePermission('me.read'), (req, res) => {
  const layout = safeDashboardLayout(req.body);
  const json = JSON.stringify(layout);
  if (Buffer.byteLength(json, 'utf8') > 4096) return res.status(400).json({ error: 'چیدمان بیش از حد بزرگ است.' });
  getDb().prepare(`INSERT INTO user_dashboard_prefs (user_id, dashboard_layout, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(user_id) DO UPDATE SET dashboard_layout = excluded.dashboard_layout, updated_at = excluded.updated_at`).run(req.adminUser.id, json);
  res.json(layout);
});

// ---------- داشبورد خلاصه ----------

router.get('/admin/dashboard', requirePermission('dashboard.read'), (req, res) => {
  const adminUser = req.adminUser;
  const allowedIds = scopedUserIds(adminUser);
  const allUsers =
    allowedIds === null
      ? usersRepository.listUsers({ onlyActive: true })
      : usersRepository.listUsers({ onlyActive: true }).filter((u) => allowedIds.includes(u.id));

  let presentCount = 0;
  let onBreakCount = 0;
  let incompleteCount = 0;

  allUsers.forEach((u) => {
    const record = attendanceRepository.findTodayRecord(u.id);
    if (!record) return;
    if (record.status === 'incomplete') incompleteCount += 1;
    if (record.check_in_time && !record.check_out_time) presentCount += 1;
  });

  res.json({
    totalEmployees: allUsers.length,
    presentToday: presentCount,
    incompleteToday: incompleteCount,
    date: todayDateString(),
  });
});

// D1: inbox فقط‌خواندنی؛ cache کوتاه کلیدشده با کاربر تا بین درخواست‌های داشبورد فشار اضافی ایجاد نشود.
const inboxCache = new Map();
router.get('/admin/inbox', requirePermission('dashboard.read'), (req, res) => {
  const cached = inboxCache.get(req.adminUser.id); if (cached && cached.until > Date.now()) return res.json(cached.value);
  const ids = scopedUserIds(req.adminUser);
  const within = (row) => ids === null || ids.includes(row.user_id);
  const pendingLeave = leaveRepository.listPending().filter(within);
  const buckets = [
    ['leave', pendingLeave.filter((row) => row.kind !== 'mission')],
    ['mission', pendingLeave.filter((row) => row.kind === 'mission')],
    ['remoteWork', remoteWorkRepository.listQueue({ userIds: ids, status: 'pending', limit: 5 }).rows],
    ['dispute', disputeRepository.listOpen().filter(within)],
    ['checkinPermission', checkinPermissionRepository.list({ status: 'pending', userIds: ids, limit: 200 })],
  ];
  if (teamReviewService.isReviewer(req.adminUser)) {
    const reviewDate = teamReviewService.reviewDateFor(req.adminUser, todayDateString());
    const review = reviewDate ? teamReviewService.reviewState(req.adminUser, reviewDate) : null;
    buckets.push(['reportReview', review ? review.unreviewed.map((x) => ({ id: x.userId, user_id: x.userId, created_at: reviewDate })) : []]);
  } else buckets.push(['reportReview', []]);
  const userMap = makeUserMap();
  const out = {};
  buckets.forEach(([key, rows]) => { out[key] = { count: rows.length, items: rows.slice(0, 5).map((row) => ({ id: row.id, userId: row.user_id, name: userMap.get(row.user_id)?.full_name || '—', createdAt: row.created_at || row.requested_at || row.start_at || null, reportDate: key === 'reportReview' ? row.created_at : undefined })) }; });
  inboxCache.set(req.adminUser.id, { until: Date.now() + 15000, value: out });
  res.json(out);
});

// ---------- نمای کلی (داشبورد کامل) ----------

router.get('/admin/overview', requirePermission('dashboard.read'), (req, res) => {
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
    if (record && record.check_in_time && dayService.summarizeRecord(record).lateMinutes > 0) {
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
    const s = dayService.summarizeRecord(r);
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
    settings: settingsRepository.getAll(),
  });
});

// ---------- تابلوی زنده‌ی امروز ----------

router.get('/admin/live', requirePermission('dashboard.read'), (req, res) => {
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
      record: record ? { ...record, segmentCount: attendanceRepository.listSegments(record.id).length } : null,
      breaks,
      openBreak,
      breakMinutes: record ? breakRepository.totalBreakMinutes(record.id) : 0,
      summary: record ? dayService.summarizeRecord(record) : null,
    };
  });

  res.json({ date: today, serverTime: nowIso(), holiday, rows });
});

// ---------- مرور شبانه: وضعیت یک روز برای تیم سرپرست (ادمین: همه) ----------

router.get('/admin/nightly-review', requirePermission('dashboard.read'), (req, res) => {
  const today = todayDateString();
  let date = DATE_RE.test(req.query.date || '') ? req.query.date : today;
  if (date > today) date = today;
  const users = visibleUsers(req.adminUser, { onlyActive: true });
  const rows = dayReview.reviewDay(users, date);
  res.json({
    date,
    today,
    holiday: holidaysRepository.isHoliday(date),
    totals: dayReview.summarize(rows),
    rows,
  });
});

module.exports = router;

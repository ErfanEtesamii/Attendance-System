// گزارش‌ها: خروجی CSV و گزارش تحلیلی.
// (تقسیم‌شده از admin.js/adminPanel.js؛ URLها و رفتار بدون تغییر. احراز هویت در index.js یک‌بار اعمال می‌شود.)

const express = require('express');
const router = express.Router();

const usersRepository = require('../../../repositories/usersRepository');
const attendanceRepository = require('../../../repositories/attendanceRepository');
const auditRepository = require('../../../repositories/auditRepository');
const dayService = require('../../../engine/dayService');
const { sendCsv } = require('../../../utils/csv');
const { scopedUserIds, visibleUsers, shiftDate, parseRange, userBrief, safeSummary, aggregateRecords } = require('./common');

// ---------- فاز ۶: خروجی اکسل (CSV) ----------
// نکته: خروجی CSV با BOM است، نه .xlsx باینری واقعی - توضیح کامل در src/utils/csv.js.
// این سه مسیر همان محدوده‌ی داده‌ای (scoping بر اساس نقش) مسیرهای JSON بالا را رعایت می‌کنند.

router.get('/admin/reports/export', (req, res) => {
  const { from, to, userId } = req.query;
  if (!from || !to) {
    return res.status(400).json({ error: 'پارامترهای from و to (به‌فرمت YYYY-MM-DD) الزامی‌اند.' });
  }

  const allowedIds = scopedUserIds(req.adminUser);
  let team = usersRepository.listUsers({});
  if (allowedIds !== null) team = team.filter((u) => allowedIds.includes(u.id));
  if (userId) team = team.filter((u) => String(u.id) === String(userId));

  const rows = team.map((member) => {
    const records = attendanceRepository.listByUserAndRange(member.id, from, to);
    const summary = dayService.summarizeRange(records);
    return [
      member.full_name,
      member.personnel_code || '',
      member.department || '',
      summary.dayCount,
      Math.round(summary.totalEffective),
      summary.lateCount,
      summary.earlyLeaveCount,
      summary.incompleteCount,
    ];
  });

  auditRepository.logEvent({
    userId: req.adminUser.id,
    action: 'report_exported',
    details: { source: 'admin_panel', from, to, userId: userId || null },
  });

  sendCsv(
    res,
    `attendance-report_${from}_${to}.csv`,
    [
      'نام کارمند',
      'کد پرسنلی',
      'دپارتمان',
      'تعداد روز رکورد',
      'مجموع دقیقه مفید',
      'تعداد تأخیر',
      'تعداد خروج زودهنگام',
      'تعداد روز ناقص',
    ],
    rows
  );
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

module.exports = router;

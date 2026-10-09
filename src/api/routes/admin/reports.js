// گزارش‌ها: خروجی CSV و گزارش تحلیلی.
// (تقسیم‌شده از admin.js/adminPanel.js؛ URLها و رفتار بدون تغییر. احراز هویت در index.js یک‌بار اعمال می‌شود.)

const express = require('express');
const router = express.Router();

const usersRepository = require('../../../repositories/usersRepository');
const attendanceRepository = require('../../../repositories/attendanceRepository');
const auditRepository = require('../../../repositories/auditRepository');
const dayService = require('../../../engine/dayService');
const { sendSheets, exportAuditFields } = require('../../../utils/xlsx'); // پیش‌فرض CSV؛ ?format=xlsx ⇒ xlsx چندشیتی (بدون exceljs ⇒ CSV + اعلام fallback)
const { buildEmployeeReportSheets } = require('../../../services/reportExportService');
const { computeMonthlyReport } = require('../../../services/monthlyReportService');
const { scopedUserIds, canAccessUser, visibleUsers, shiftDate, parseRange, userBrief, safeSummary, aggregateRecords } = require('./common');
const { requirePermission } = require('../../../middleware/permissions');

// ---------- فاز ۶: خروجی اکسل (CSV) ----------
// نکته: خروجی CSV با BOM است، نه .xlsx باینری واقعی - توضیح کامل در src/utils/csv.js.
// این سه مسیر همان محدوده‌ی داده‌ای (scoping بر اساس نقش) مسیرهای JSON بالا را رعایت می‌کنند.

router.get('/admin/reports/export', requirePermission('reports.read'), (req, res) => {
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

  // CSV: همان جدول خلاصه‌ی قبلی (ستون‌ها بدون تغییر). xlsx (S5-1b): چهار شیت — خلاصه کارمند، ریز روزانه، مرخصی و مأموریت، اضافه‌کاری
  // (شیت‌ها فقط برای xlsx ساخته می‌شوند). همان team (اسکوپ نقش + فیلتر userId) برای هر دو قالب.
  const csv = {
    headers: [
      'نام کارمند',
      'کد پرسنلی',
      'دپارتمان',
      'تعداد روز رکورد',
      'مجموع دقیقه مفید',
      'تعداد تأخیر',
      'تعداد خروج زودهنگام',
      'تعداد روز ناقص',
    ],
    rows,
  };
  return sendSheets(req, res, `attendance-report_${from}_${to}.csv`, () => buildEmployeeReportSheets({ users: team, from, to }), {
    csv,
    onExport: (info) => auditRepository.logEvent({
      userId: req.adminUser.id,
      action: 'report_exported',
      ipAddress: req.ip,
      details: { source: 'admin_panel', from, to, userId: userId || null, count: rows.length, ...exportAuditFields(info) },
    }),
  });
});

// ---------- گزارش تحلیلی ----------

router.get('/admin/reports/summary', requirePermission('reports.read'), (req, res) => {
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

// ---------- گزارش ماهانه‌ی شمسی (S5-2b) ----------
// GET /admin/reports/monthly?year=&month=&userId=&department=&days=1&includeInactive=1   (year/month شمسی؛ هر دو الزامی)
// فقط خواندن و «بدون قفل» (بستن ماه/snapshot در S5-3). منطق محاسبه کاملاً در monthlyReportService (فقط از computeDay).
// اسکوپ نقش مثل بقیه‌ی گزارش‌ها: admin/hr همه، manager فقط تیم مستقیمش، employee فقط خودش. userId خارج از اسکوپ ⇒ ۴۰۳.
// پیش‌فرض فقط کاربران فعال؛ includeInactive=1 غیرفعال‌ها را هم می‌آورد. days=1 ریز روزانه‌ی هر کاربر را هم می‌دهد.
router.get('/admin/reports/monthly', requirePermission('reports.read'), (req, res) => {
  const q = req.query;
  const year = /^\d{4}$/.test(String(q.year || '')) ? parseInt(q.year, 10) : NaN;
  const month = /^\d{1,2}$/.test(String(q.month || '')) ? parseInt(q.month, 10) : NaN;
  if (!Number.isInteger(year) || year < 1300 || year > 1500) return res.status(400).json({ error: 'سال شمسی (year) الزامی و باید ۴ رقمی معتبر باشد.', code: 'INVALID_YEAR' });
  if (!Number.isInteger(month) || month < 1 || month > 12) return res.status(400).json({ error: 'ماه شمسی (month) الزامی و باید بین ۱ تا ۱۲ باشد.', code: 'INVALID_MONTH' });
  const flag = (v) => v === '1' || v === 'true';
  const me = req.adminUser;

  let users = visibleUsers(me, { onlyActive: !flag(q.includeInactive) });
  if (q.userId !== undefined && q.userId !== '') {
    if (!/^\d+$/.test(String(q.userId))) return res.status(400).json({ error: 'شناسه‌ی کاربر نامعتبر است.', code: 'INVALID_USER' });
    if (!canAccessUser(me, q.userId)) return res.status(403).json({ error: 'به این کاربر دسترسی ندارید.' });
    const target = usersRepository.findById(parseInt(q.userId, 10));
    if (!target) return res.status(404).json({ error: 'کاربر یافت نشد.' });
    users = [target];
  } else if (q.department) {
    const dep = String(q.department).trim();
    users = users.filter((u) => (u.department || '').trim() === dep);
  }

  const report = computeMonthlyReport({ users, year, month, includeDays: flag(q.days) });
  return res.json({ ...report, departmentOptions: [...new Set(visibleUsers(me).map((u) => u.department).filter(Boolean))] });
});

module.exports = router;

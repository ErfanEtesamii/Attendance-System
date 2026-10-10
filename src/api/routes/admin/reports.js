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
const { reportFromSnapshot } = require('../../../services/monthCloseService');
const { buildMonthlySheets, MAIN_COLUMNS } = require('../../../services/monthlyExportService');
const monthClosuresRepository = require('../../../repositories/monthClosuresRepository');
const { scopedUserIds, canAccessUser, visibleUsers, shiftDate, parseRange, userBrief, safeSummary, aggregateRecords } = require('./common');
const { requirePermission, hasPermission } = require('../../../middleware/permissions');

// ---------- فاز ۶: خروجی اکسل (CSV) ----------
// نکته: خروجی CSV با BOM است، نه .xlsx باینری واقعی - توضیح کامل در src/utils/csv.js.
// این سه مسیر همان محدوده‌ی داده‌ای (scoping بر اساس نقش) مسیرهای JSON بالا را رعایت می‌کنند.

router.get('/admin/reports/export', requirePermission('reports.read'), (req, res) => {
  const { from, to, userId, department } = req.query;
  if (!from || !to) {
    return res.status(400).json({ error: 'پارامترهای from و to (به‌فرمت YYYY-MM-DD) الزامی‌اند.' });
  }

  const allowedIds = scopedUserIds(req.adminUser);
  let team = usersRepository.listUsers({});
  if (allowedIds !== null) team = team.filter((u) => allowedIds.includes(u.id));
  if (userId) team = team.filter((u) => String(u.id) === String(userId));
  if (department) team = team.filter((u) => (u.department || '') === department); // S5-5b: همان فیلتر دپارتمان صفحه (مثل reports/summary)

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
// منطق مشترک گزارش ماهانه (JSON، خروجی xlsx S5-4a و نمای چاپ S5-4b): اعتبارسنجی، اسکوپ نقش، انتخاب snapshot/زنده.
// ⇒ { error: { status, json } } | { payload }  (opts.days=true ⇒ ریز روزانه همیشه)
function resolveMonthly(req, opts = {}) {
  const q = req.query;
  const forceDays = opts.days === true;
  const year = /^\d{4}$/.test(String(q.year || '')) ? parseInt(q.year, 10) : NaN;
  const month = /^\d{1,2}$/.test(String(q.month || '')) ? parseInt(q.month, 10) : NaN;
  if (!Number.isInteger(year) || year < 1300 || year > 1500) return { error: { status: 400, json: { error: 'سال شمسی (year) الزامی و باید ۴ رقمی معتبر باشد.', code: 'INVALID_YEAR' } } };
  if (!Number.isInteger(month) || month < 1 || month > 12) return { error: { status: 400, json: { error: 'ماه شمسی (month) الزامی و باید بین ۱ تا ۱۲ باشد.', code: 'INVALID_MONTH' } } };
  const flag = (v) => v === '1' || v === 'true';
  const me = req.adminUser;

  let users = visibleUsers(me, { onlyActive: !flag(q.includeInactive) });
  if (q.userId !== undefined && q.userId !== '') {
    if (!/^\d+$/.test(String(q.userId))) return { error: { status: 400, json: { error: 'شناسه‌ی کاربر نامعتبر است.', code: 'INVALID_USER' } } };
    if (!canAccessUser(me, q.userId)) return { error: { status: 403, json: { error: 'به این کاربر دسترسی ندارید.' } } };
    const target = usersRepository.findById(parseInt(q.userId, 10));
    if (!target) return { error: { status: 404, json: { error: 'کاربر یافت نشد.' } } };
    users = [target];
  } else if (q.department) {
    const dep = String(q.department).trim();
    users = users.filter((u) => (u.department || '').trim() === dep);
  }

  const departmentOptions = [...new Set(visibleUsers(me).map((u) => u.department).filter(Boolean))];
  const closure = monthClosuresRepository.findByMonth(year, month);
  const closureInfo = closure ? { status: closure.status, closedAt: closure.closed_at, closeCount: closure.close_count } : null;

  // ماهِ بسته‌شده (S5-3b): ارقام از snapshot لحظه‌ی بستن می‌آید، نه محاسبه‌ی زنده؛ پس تغییر بعدی تنظیمات/رکوردها آن را عوض نمی‌کند.
  // source=live (فقط کسی که monthclose.read دارد) محاسبه‌ی زنده‌ی فعلی را برای مقایسه با snapshot می‌دهد.
  const wantLive = q.source === 'live';
  if (wantLive && !hasPermission(me.role, 'monthclose.read')) return { error: { status: 403, json: { error: 'برای این عملیات مجوز لازم را ندارید.' } } };
  if (closure && closure.status === 'closed' && closure.snapshot && !wantLive) {
    const hasUser = q.userId !== undefined && q.userId !== '';
    const snap = reportFromSnapshot(closure, {
      allowedIds: scopedUserIds(me),
      userId: hasUser ? parseInt(q.userId, 10) : undefined,
      department: !hasUser && q.department ? String(q.department).trim() : undefined,
      includeInactive: flag(q.includeInactive),
      includeDays: forceDays || flag(q.days),
    });
    // اصلاح‌های بعد از بستن (S5-3c): snapshot دست‌نخورده است؛ اینجا فقط شفاف‌سازی. سرپرست/کارمند فقط اصلاح‌های کاربران داخل اسکوپ خودشان را می‌بینند.
    const scope = scopedUserIds(me);
    const visible = scope === null ? null : new Set(scope);
    const adjustments = monthClosuresRepository.listAdjustments(closure.id, closure.close_count, { limit: 200 })
      .filter((a) => visible === null || a.user_id === null || visible.has(a.user_id))
      .map((a) => ({ id: a.id, action: a.action, entityType: a.entity_type, userId: a.user_id, date: a.effective_date, reason: a.reason, adjustedBy: a.adjusted_by, adjustedAt: a.adjusted_at }));
    return { payload: { ...snap, closure: closureInfo, adjustments, departmentOptions } };
  }

  const report = computeMonthlyReport({ users, year, month, includeDays: forceDays || flag(q.days) });
  return { payload: { ...report, source: 'live', closure: closureInfo, departmentOptions } };
}

function sendResolved(res, r) {
  if (r.error) return res.status(r.error.status).json(r.error.json);
  return res.json(r.payload);
}

router.get('/admin/reports/monthly', requirePermission('reports.read'), (req, res) => sendResolved(res, resolveMonthly(req)));

// ---------- خروجی xlsx گزارش ماهانه (S5-4a) ----------
// GET /admin/reports/monthly/export?year=&month=&format=xlsx|csv&userId=&department=&includeInactive=1[&source=live]
// همان اعتبارسنجی/اسکوپ/انتخاب snapshot گزارش JSON (resolveMonthly)؛ ماه بسته ⇒ ارقام snapshot. xlsx شش شیت دارد (قالب ثابت + «مشخصات گزارش» + «راهنما»)؛
// CSV (پیش‌فرض) فقط شیت اصلی؛ بدون exceljs ⇒ CSV + اعلام fallback. audit: report_exported با kind=monthly.
router.get('/admin/reports/monthly/export', requirePermission('reports.read'), (req, res) => {
  const r = resolveMonthly(req, { days: true });
  if (r.error) return res.status(r.error.status).json(r.error.json);
  const payload = r.payload;
  const mm = String(payload.month).padStart(2, '0');
  const sheets = () => buildMonthlySheets(payload);
  const mainCols = MAIN_COLUMNS;
  const csv = {
    headers: mainCols.map((c) => c[0]),
    rows: [...payload.users, ...(payload.users.length ? [{ user: { fullName: 'جمع', personnelCode: '', department: '' }, ...payload.totals }] : [])]
      .map((u) => mainCols.map((c) => c[2](u))),
  };
  return sendSheets(req, res, `monthly-report_${payload.year}-${mm}.csv`, sheets, {
    csv,
    onExport: (info) => auditRepository.logEvent({
      userId: req.adminUser.id,
      action: 'report_exported',
      ipAddress: req.ip,
      details: { source: 'admin_panel', kind: 'monthly', year: payload.year, month: payload.month, dataSource: payload.source, userId: req.query.userId || null, count: payload.users.length, ...exportAuditFields(info) },
    }),
  });
});

module.exports = router;

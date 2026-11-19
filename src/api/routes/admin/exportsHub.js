// «خروجی‌ها»: خروجی Excel/CSV برای لیست‌هایی که در پنل بود ولی دانلود نداشتند (مرخصی و مأموریت، مانده‌ی مرخصی، اعتراض‌ها، تعطیلات، شیفت‌ها).
// همه از همان اسکوپ/مجوز لیست اصلی استفاده می‌کنند و با sendTable (xlsx پیش‌فرض، ?format=csv) تحویل داده می‌شوند؛ audit با قالب واقعاً تحویل‌شده.
// ⚠️ باید قبل از routeهای دارای /:id (disputes، shifts) mount شود تا «export» به‌عنوان id برداشت نشود.
const express = require('express');
const router = express.Router();

const { requirePermission } = require('../../../middleware/permissions');
const usersRepository = require('../../../repositories/usersRepository');
const leaveRepository = require('../../../repositories/leaveRepository');
const leaveTypesRepository = require('../../../repositories/leaveTypesRepository');
const leaveBalanceService = require('../../../services/leaveBalanceService');
const leaveApprovalService = require('../../../services/leaveApprovalService');
const disputeService = require('../../../services/disputeService');
const holidaysRepository = require('../../../repositories/holidaysRepository');
const shiftsRepository = require('../../../repositories/shiftsRepository');
const { sendTable, exportAuditFields } = require('../../../utils/xlsx');
const { isoDateToJalaliString, jalaliYearOfDateString } = require('../../../utils/jalali');
const { todayDateString } = require('../../../utils/serverTime');
const { DATE_RE, scopedUserIds, audit } = require('./common');

const STATUS_FA = { pending: 'در انتظار', approved: 'تأییدشده', rejected: 'ردشده', cancelled: 'لغوشده', canceled: 'لغوشده' };
const KIND_FA = { annual: 'مرخصی', mission: 'مأموریت' };
const DISPUTE_FA = { open: 'باز', resolved: 'حل‌شده', closed_by_user: 'بسته‌شده توسط کارمند', resolved_by_admin: 'حل‌شده توسط ادمین' };
const WEEKDAY_FA = { 0: 'یکشنبه', 1: 'دوشنبه', 2: 'سه‌شنبه', 3: 'چهارشنبه', 4: 'پنجشنبه', 5: 'جمعه', 6: 'شنبه' };
const jd = (d) => (d && DATE_RE.test(d) ? isoDateToJalaliString(d) : '');
const dt = (iso) => (iso ? new Date(iso).toLocaleString('fa-IR') : '');

// مرخصی و مأموریت: ?from&to (روی تاریخ شروع) &status=all|pending|approved|rejected &kind=annual|mission
router.get('/admin/leave-requests/export', requirePermission('leave.read'), (req, res) => {
  const { from, to } = req.query;
  if ((from && !DATE_RE.test(from)) || (to && !DATE_RE.test(to))) return res.status(400).json({ error: 'تاریخ‌ها باید به‌فرمت YYYY-MM-DD باشند.' });
  const status = req.query.status && req.query.status !== 'all' ? req.query.status : null;
  const allowed = scopedUserIds(req.adminUser);
  let items = leaveRepository.listAll(status ? { status } : {});
  if (allowed !== null) items = items.filter((r) => allowed.includes(r.user_id));
  if (req.query.kind) items = items.filter((r) => r.kind === req.query.kind);
  if (from) items = items.filter((r) => r.start_date >= from);
  if (to) items = items.filter((r) => r.start_date <= to);
  const types = new Map(leaveTypesRepository.listLeaveTypes().map((t) => [t.id, t.title]));
  const rows = items.map((r) => {
    const u = usersRepository.findById(r.user_id);
    const dec = leaveApprovalService.decisionInfo(r);
    return [
      u ? u.full_name : '', (u && u.personnel_code) || '', (u && u.department) || '',
      KIND_FA[r.kind] || r.kind || '', types.get(r.leave_type_id) || '',
      r.start_date, jd(r.start_date), r.end_date, jd(r.end_date), STATUS_FA[r.status] || r.status || '',
      dec ? dec.fullName : '', r.reason || '', dt(r.created_at),
    ];
  });
  return sendTable(req, res, `leave-requests_${from || 'all'}_${to || 'all'}.csv`,
    ['نام', 'کد پرسنلی', 'دپارتمان', 'نوع', 'عنوان نوع', 'از (میلادی)', 'از (شمسی)', 'تا (میلادی)', 'تا (شمسی)', 'وضعیت', 'تصمیم‌گیرنده', 'دلیل', 'زمان ثبت'],
    rows, { sheetName: 'مرخصی و مأموریت', onExport: (info) => audit(req, 'report_exported', { kind: 'leave_requests', from: from || null, to: to || null, status, count: rows.length, ...exportAuditFields(info) }) });
});

// مانده‌ی مرخصی: ?year (سال شمسی؛ پیش‌فرض جاری). همان اسکوپ GET /admin/leave-balances بدون userId.
router.get('/admin/leave-balances/export', requirePermission('leave.balance.read'), (req, res) => {
  const raw = req.query.year;
  const year = raw === undefined || raw === '' ? jalaliYearOfDateString(todayDateString()) : (/^\d{4}$/.test(String(raw)) ? Number(raw) : null);
  if (year === null || year < 1300 || year > 1800) return res.status(400).json({ error: 'سال شمسی نامعتبر است.', code: 'INVALID_YEAR' });
  const me = req.adminUser;
  let users = usersRepository.listUsers({ onlyActive: true });
  const ids = scopedUserIds(me);
  if (ids !== null) { const ok = new Set(me.role === 'manager' ? [...ids, me.id] : ids); users = users.filter((u) => ok.has(u.id)); }
  const rows = [];
  for (const u of users) {
    for (const t of leaveTypesRepository.listLeaveTypes().filter((x) => x.countsAgainstBalance)) {
      const d = leaveBalanceService.describeBalance({ userId: u.id, leaveTypeId: t.id, jalaliYear: year });
      if (!d.ok || !d.tracked) continue;
      rows.push([u.full_name, u.personnel_code || '', u.department || '', t.title, year, d.entitled, d.carriedOver, d.adjustments, d.used, d.pending, d.remaining]);
    }
  }
  return sendTable(req, res, `leave-balances_${year}.csv`,
    ['نام', 'کد پرسنلی', 'دپارتمان', 'نوع مرخصی', 'سال شمسی', 'استحقاق (دقیقه)', 'مانده از قبل (دقیقه)', 'تعدیل (دقیقه)', 'مصرف‌شده (دقیقه)', 'در انتظار تأیید (دقیقه)', 'مانده (دقیقه)'],
    rows, { sheetName: 'مانده‌ی مرخصی', onExport: (info) => audit(req, 'report_exported', { kind: 'leave_balances', year, count: rows.length, ...exportAuditFields(info) }) });
});

// اعتراض‌ها: ?status= (همان فیلترهای GET /admin/disputes؛ ناشناخته ⇒ همه)
router.get('/admin/disputes/export', requirePermission('disputes.read'), (req, res) => {
  const status = disputeService.ADMIN_STATUS_FILTERS.includes(req.query.status) ? req.query.status : null;
  const items = disputeService.listForAdmin({ status, userIds: scopedUserIds(req.adminUser) });
  const rows = items.map((d) => {
    const u = usersRepository.findById(d.userId);
    return [u ? u.full_name : '', (u && u.personnel_code) || '', d.recordDate || '', jd(d.recordDate), d.message || '', DISPUTE_FA[d.status] || d.status || '', d.messageCount, d.reopenCount, dt(d.createdAt), dt(d.closedAt)];
  });
  return sendTable(req, res, `disputes_${todayDateString()}.csv`,
    ['نام', 'کد پرسنلی', 'تاریخ رکورد', 'تاریخ شمسی رکورد', 'متن اعتراض', 'وضعیت', 'تعداد پیام', 'دفعات بازگشایی', 'زمان ثبت', 'زمان بسته شدن'],
    rows, { sheetName: 'اعتراض‌ها', onExport: (info) => audit(req, 'report_exported', { kind: 'disputes', status, count: rows.length, ...exportAuditFields(info) }) });
});

// تعطیلات رسمی/شرکتی (کل لیست)
router.get('/admin/holidays/export', requirePermission('settings.read'), (req, res) => {
  const rows = holidaysRepository.listHolidays().map((h) => [h.holiday_date, jd(h.holiday_date), h.title || '', h.kind || '', h.scope || '', h.department || '', h.half_end_time || '']);
  return sendTable(req, res, `holidays_${todayDateString()}.csv`,
    ['تاریخ', 'تاریخ شمسی', 'عنوان', 'نوع', 'دامنه', 'دپارتمان', 'پایان نیم‌روز'],
    rows, { sheetName: 'تعطیلات', onExport: (info) => audit(req, 'report_exported', { kind: 'holidays', count: rows.length, ...exportAuditFields(info) }) });
});

// شیفت‌ها
router.get('/admin/shifts/export', requirePermission('shifts.read'), (req, res) => {
  const rows = shiftsRepository.listShifts().map((s) => {
    const days = Array.isArray(s.workDays) ? s.workDays : [];
    return [s.name, s.startTime, s.endTime, s.graceLateMinutes, s.graceEarlyMinutes, days.map((d) => WEEKDAY_FA[d]).filter(Boolean).join('، '), s.overnight ? 'بله' : 'خیر', s.maxLunchMinutes, s.fixedLunchDeductMinutes, s.userCount ?? ''];
  });
  return sendTable(req, res, `shifts_${todayDateString()}.csv`,
    ['نام شیفت', 'شروع', 'پایان', 'مهلت تأخیر (دقیقه)', 'مهلت زودتر رفتن (دقیقه)', 'روزهای کاری', 'شیفت شب', 'سقف ناهار (دقیقه)', 'کسر ثابت ناهار (دقیقه)', 'تعداد کارمند'],
    rows, { sheetName: 'شیفت‌ها', onExport: (info) => audit(req, 'report_exported', { kind: 'shifts', count: rows.length, ...exportAuditFields(info) }) });
});

module.exports = router;

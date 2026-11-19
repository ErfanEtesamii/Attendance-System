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
const { sendSheets, exportAuditFields } = require('../../../utils/xlsx');
const { splitByEmployee, withCard } = require('../../../utils/exportCards');
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
  // CSV: جدول تخت قبلی. xlsx (کارتکس): شیت «خلاصه‌ی افراد» + یک شیت برای هر کارمند (فقط درخواست‌های او، بدون تکرار نام/کد/دپارتمان و تاریخ میلادی)
  const CSV_HEADERS = ['نام', 'کد پرسنلی', 'دپارتمان', 'نوع', 'عنوان نوع', 'از (میلادی)', 'از (شمسی)', 'تا (میلادی)', 'تا (شمسی)', 'وضعیت', 'تصمیم‌گیرنده', 'دلیل', 'زمان ثبت'];
  const sheets = () => {
    const keep = [0, 1, 2, 3, 4, 6, 8, 9, 10, 11, 12];
    const flat = { name: 'درخواست‌ها', headers: keep.map((i) => CSV_HEADERS[i]), rows: rows.map((r) => keep.map((i) => r[i])) };
    const by = new Map();
    for (const r of rows) {
      const k = `${r[0]}|${r[1]}`;
      if (!by.has(k)) by.set(k, { name: r[0], code: r[1], dept: r[2], total: 0, approved: 0, pending: 0, rejected: 0 });
      const e = by.get(k); e.total += 1;
      if (r[9] === STATUS_FA.approved) e.approved += 1; else if (r[9] === STATUS_FA.pending) e.pending += 1; else if (r[9] === STATUS_FA.rejected) e.rejected += 1;
    }
    const sum = { name: 'خلاصه افراد', headers: ['نام', 'کد پرسنلی', 'دپارتمان', 'کل درخواست‌ها', 'تأییدشده', 'در انتظار', 'ردشده'], rows: [...by.values()].map((e) => [e.name, e.code, e.dept, e.total, e.approved, e.pending, e.rejected]) };
    const range = `${from ? jd(from) : 'ابتدا'} تا ${to ? jd(to) : 'امروز'}`;
    return [withCard(sum, { title: 'مرخصی و مأموریت — خلاصه‌ی افراد', lines: [`بازه (تاریخ شروع):  ${range}`, `تعداد درخواست:  ${rows.length}`, `تعداد کارمند:  ${by.size}`], footer: false }),
      ...splitByEmployee([flat], { title: `کارتکس مرخصی و مأموریت — ${range}` })];
  };
  return sendSheets(req, res, `leave-requests_${from || 'all'}_${to || 'all'}.csv`, sheets, {
    csv: { headers: CSV_HEADERS, rows },
    onExport: (info) => audit(req, 'report_exported', { kind: 'leave_requests', from: from || null, to: to || null, status, count: rows.length, ...exportAuditFields(info) }) });
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
  // CSV: جدول تخت قبلی. xlsx (کارتکس): برای هر نوع مرخصی یک شیت (کادر: نوع، سال، تعداد کارمند) با یک ردیف برای هر کارمند
  const CSV_HEADERS = ['نام', 'کد پرسنلی', 'دپارتمان', 'نوع مرخصی', 'سال شمسی', 'استحقاق (دقیقه)', 'مانده از قبل (دقیقه)', 'تعدیل (دقیقه)', 'مصرف‌شده (دقیقه)', 'در انتظار (دقیقه)', 'مانده (دقیقه)'];
  const sheets = () => {
    const types = [...new Set(rows.map((r) => r[3]))];
    const out = types.map((ty) => {
      const mine = rows.filter((r) => r[3] === ty);
      const sheet = { name: ty, headers: ['نام', 'کد پرسنلی', 'دپارتمان', ...CSV_HEADERS.slice(5)], rows: mine.map((r) => [r[0], r[1], r[2], ...r.slice(5)]) };
      return withCard(sheet, { title: `مانده‌ی مرخصی — ${ty}`, lines: [`نوع مرخصی:  ${ty}`, `سال شمسی:  ${year}`, `تعداد کارمند:  ${mine.length}`] });
    });
    return out.length ? out : [{ name: 'مانده‌ی مرخصی', headers: CSV_HEADERS, rows: [] }];
  };
  return sendSheets(req, res, `leave-balances_${year}.csv`, sheets, {
    csv: { headers: CSV_HEADERS, rows },
    onExport: (info) => audit(req, 'report_exported', { kind: 'leave_balances', year, count: rows.length, ...exportAuditFields(info) }) });
});

// اعتراض‌ها: ?status= (همان فیلترهای GET /admin/disputes؛ ناشناخته ⇒ همه)
router.get('/admin/disputes/export', requirePermission('disputes.read'), (req, res) => {
  const status = disputeService.ADMIN_STATUS_FILTERS.includes(req.query.status) ? req.query.status : null;
  const items = disputeService.listForAdmin({ status, userIds: scopedUserIds(req.adminUser) });
  const rows = items.map((d) => {
    const u = usersRepository.findById(d.userId);
    return [u ? u.full_name : '', (u && u.personnel_code) || '', d.recordDate || '', jd(d.recordDate), d.message || '', DISPUTE_FA[d.status] || d.status || '', d.messageCount, d.reopenCount, dt(d.createdAt), dt(d.closedAt)];
  });
  const CSV_HEADERS = ['نام', 'کد پرسنلی', 'تاریخ رکورد', 'تاریخ شمسی رکورد', 'متن اعتراض', 'وضعیت', 'تعداد پیام', 'دفعات بازگشایی', 'زمان ثبت', 'زمان بسته شدن'];
  const sheets = () => {
    const keep = [0, 1, 3, 4, 5, 6, 7, 8, 9]; // تاریخ میلادی رکورد حذف (شمسی کافی است)
    const sheet = { name: 'اعتراض‌ها', headers: keep.map((i) => CSV_HEADERS[i]), rows: rows.map((r) => keep.map((i) => r[i])) };
    const count = (label) => rows.filter((r) => r[5] === label).length;
    return [withCard(sheet, { title: 'اعتراض‌ها', lines: [`تعداد اعتراض:  ${rows.length}`, `باز:  ${count(DISPUTE_FA.open)}`, `حل‌شده:  ${count(DISPUTE_FA.resolved) + count(DISPUTE_FA.resolved_by_admin)}`, ...(status ? [`فیلتر وضعیت:  ${DISPUTE_FA[status] || status}`] : [])], footer: false })];
  };
  return sendSheets(req, res, `disputes_${todayDateString()}.csv`, sheets, {
    csv: { headers: CSV_HEADERS, rows },
    onExport: (info) => audit(req, 'report_exported', { kind: 'disputes', status, count: rows.length, ...exportAuditFields(info) }) });
});

// تعطیلات رسمی/شرکتی (کل لیست)
router.get('/admin/holidays/export', requirePermission('settings.read'), (req, res) => {
  const rows = holidaysRepository.listHolidays().map((h) => [h.holiday_date, jd(h.holiday_date), h.title || '', h.kind || '', h.scope || '', h.department || '', h.half_end_time || '']);
  const CSV_HEADERS = ['تاریخ', 'تاریخ شمسی', 'عنوان', 'نوع', 'دامنه', 'دپارتمان', 'پایان نیم‌روز'];
  const sheets = () => [withCard({ name: 'تعطیلات', headers: CSV_HEADERS.slice(1), rows: rows.map((r) => r.slice(1)) }, { title: 'تعطیلات رسمی و شرکتی', lines: [`تعداد تعطیلی:  ${rows.length}`], footer: false })];
  return sendSheets(req, res, `holidays_${todayDateString()}.csv`, sheets, {
    csv: { headers: CSV_HEADERS, rows },
    onExport: (info) => audit(req, 'report_exported', { kind: 'holidays', count: rows.length, ...exportAuditFields(info) }) });
});

// شیفت‌ها
router.get('/admin/shifts/export', requirePermission('shifts.read'), (req, res) => {
  const rows = shiftsRepository.listShifts().map((s) => {
    const days = Array.isArray(s.workDays) ? s.workDays : [];
    return [s.name, s.startTime, s.endTime, s.graceLateMinutes, s.graceEarlyMinutes, days.map((d) => WEEKDAY_FA[d]).filter(Boolean).join('، '), s.overnight ? 'بله' : 'خیر', s.maxLunchMinutes, s.fixedLunchDeductMinutes, s.userCount ?? ''];
  });
  const CSV_HEADERS = ['نام شیفت', 'شروع', 'پایان', 'مهلت تأخیر (دقیقه)', 'مهلت زودتر رفتن (دقیقه)', 'روزهای کاری', 'شیفت شب', 'سقف ناهار (دقیقه)', 'کسر ثابت ناهار (دقیقه)', 'تعداد کارمند'];
  const sheets = () => [withCard({ name: 'شیفت‌ها', headers: CSV_HEADERS, rows }, { title: 'شیفت‌ها', lines: [`تعداد شیفت:  ${rows.length}`, `کارمندان دارای شیفت:  ${rows.reduce((t, r) => t + (Number(r[9]) || 0), 0)}`], footer: false })];
  return sendSheets(req, res, `shifts_${todayDateString()}.csv`, sheets, {
    csv: { headers: CSV_HEADERS, rows },
    onExport: (info) => audit(req, 'report_exported', { kind: 'shifts', count: rows.length, ...exportAuditFields(info) }) });
});

module.exports = router;

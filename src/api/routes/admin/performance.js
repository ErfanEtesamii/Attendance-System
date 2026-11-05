// عملکرد کارمند و حقوق (فقط‌خواندنی).
//   GET /admin/performance/team?range=24h|3d|6d|30d|90d|custom[&from=&to][&department=]   performance.read (فقط admin)
//   GET /admin/performance/employee/:id?range=…[&from=&to]                                performance.read (فقط admin)
//   GET /admin/performance/employee/:id/day?date=YYYY-MM-DD                              performance.read (فقط admin)
//   GET /admin/payroll?year=&month=[&department=]                                         payroll.read (فقط admin)
//   GET /admin/payroll/:id?year=&month=                                                   payroll.read — ریز روزانه‌ی یک کارمند
//   GET /admin/payroll/export?year=&month=[&department=&includeInactive=1&format=xlsx|csv]  payroll.read — اکسل چندشیتی حقوق (audit: payroll_exported)
//   GET /admin/performance/export?range=…[&from=&to=&department=&includeInactive=1&format=xlsx|csv]  performance.read — اکسل چندشیتی عملکرد (audit: performance_exported)
// نرخ ساعتی فقط در مسیرهای payroll و فقط برای مجوز payroll.read می‌آید.
const express = require('express');
const router = express.Router();
const { requirePermission, hasPermission } = require('../../../middleware/permissions');
const { visibleUsers, canAccessUser } = require('./common');
const usersRepository = require('../../../repositories/usersRepository');
const settingsRepository = require('../../../repositories/settingsRepository');
const auditRepository = require('../../../repositories/auditRepository');
const { parseYearMonth } = require('./monthParams');
const { todayInZone } = require('../../../utils/time');
const perf = require('../../../services/performanceService');
const { sendSheets, exportAuditFields } = require('../../../utils/xlsx');
const { buildPayrollSheets, buildPerformanceSheets } = require('../../../services/performanceExportService');

const today = () => todayInZone(settingsRepository.getTimezone());

function rangeOf(req, res) {
  try { return perf.resolveRange({ range: req.query.range, from: req.query.from, to: req.query.to, today: today() }); } catch (err) {
    if (err instanceof perf.PerformanceError) { res.status(400).json({ error: err.message, code: err.code }); return null; }
    throw err;
  }
}

router.get('/admin/performance/team', requirePermission('performance.read'), (req, res) => {
  const range = rangeOf(req, res); if (!range) return undefined;
  let users = visibleUsers(req.adminUser, { onlyActive: req.query.includeInactive !== '1' });
  if (req.query.department) users = users.filter((u) => (u.department || '').trim() === String(req.query.department).trim());
  return res.json(perf.teamOverview({ users, range }));
});

router.get('/admin/performance/employee/:id', requirePermission('performance.read'), (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'شناسه‌ی کاربر نامعتبر است.', code: 'INVALID_USER' });
  if (!canAccessUser(req.adminUser, req.params.id)) return res.status(403).json({ error: 'به این کاربر دسترسی ندارید.' });
  const user = usersRepository.findById(parseInt(req.params.id, 10));
  if (!user) return res.status(404).json({ error: 'کارمند یافت نشد.' });
  const range = rangeOf(req, res); if (!range) return undefined;
  const includePayroll = hasPermission(req.adminUser.role, 'payroll.read');
  return res.json(perf.employeePerformance({ user, range, includePayroll }));
});

// بازرسی یک روز (مثل URL Inspection): رکورد، بازه‌های حضور، استراحت‌ها، مرخصی، دورکاری، اعتراض، تسک‌ها و (برای payroll.read) مبلغ همان روز
router.get('/admin/performance/employee/:id/day', requirePermission('performance.read'), (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'شناسه‌ی کاربر نامعتبر است.', code: 'INVALID_USER' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || ''))) return res.status(400).json({ error: 'date باید YYYY-MM-DD باشد.', code: 'INVALID_DATE' });
  if (!canAccessUser(req.adminUser, req.params.id)) return res.status(403).json({ error: 'به این کاربر دسترسی ندارید.' });
  const user = usersRepository.findById(parseInt(req.params.id, 10));
  if (!user) return res.status(404).json({ error: 'کارمند یافت نشد.' });
  try {
    return res.json(perf.dayInspection({ user, date: req.query.date, includePayroll: hasPermission(req.adminUser.role, 'payroll.read') }));
  } catch (err) {
    if (err instanceof perf.PerformanceError) return res.status(404).json({ error: err.message, code: err.code });
    throw err;
  }
});

// خروجی اکسل عملکرد کارکنان؛ ستون‌های حقوق فقط برای دارنده‌ی payroll.read می‌آید.
router.get('/admin/performance/export', requirePermission('performance.read'), (req, res) => {
  const range = rangeOf(req, res); if (!range) return undefined;
  let users = visibleUsers(req.adminUser, { onlyActive: req.query.includeInactive !== '1' });
  if (req.query.department) users = users.filter((u) => (u.department || '').trim() === String(req.query.department).trim());
  const includePayroll = hasPermission(req.adminUser.role, 'payroll.read');
  const data = perf.teamDetailed({ users, range, includePayroll });
  const sheets = buildPerformanceSheets(data, { includePayroll });
  return sendSheets(req, res, `performance_${range.from}_${range.to}.csv`, sheets, {
    csv: { headers: sheets[0].headers, rows: sheets[0].rows },
    onExport: (info) => auditRepository.logEvent({
      userId: req.adminUser.id,
      action: 'performance_exported',
      ipAddress: req.ip || null,
      details: { source: 'admin_panel', from: range.from, to: range.to, range: range.key, department: req.query.department || null, includePayroll, count: users.length, ...exportAuditFields(info) },
    }),
  });
});

function auditView(req, what, meta) {
  try {
    auditRepository.logEvent({ userId: req.adminUser.id, action: 'payroll_viewed', ipAddress: req.ip || null, details: { target: what, ...meta } });
  } catch (_) { /* ممیزی بهترین‌تلاش است؛ مشاهده را نمی‌شکند */ }
}

router.get('/admin/payroll', requirePermission('payroll.read'), (req, res) => {
  const p = parseYearMonth(req.query.year, req.query.month);
  if (p.error) return res.status(400).json(p.error);
  let users = visibleUsers(req.adminUser, { onlyActive: req.query.includeInactive !== '1' });
  if (req.query.department) users = users.filter((u) => (u.department || '').trim() === String(req.query.department).trim());
  auditView(req, 'all', { year: p.year, month: p.month });
  return res.json(perf.monthlyPayrollCompared({ users, year: p.year, month: p.month }));
});

// خروجی اکسل حقوق (محرمانه): قبل از /admin/payroll/:id تا «export» به‌عنوان شناسه تفسیر نشود. پیش‌فرض CSV (فقط شیت اصلی)؛ ?format=xlsx چندشیتی.
router.get('/admin/payroll/export', requirePermission('payroll.read'), (req, res) => {
  const p = parseYearMonth(req.query.year, req.query.month);
  if (p.error) return res.status(400).json(p.error);
  let users = visibleUsers(req.adminUser, { onlyActive: req.query.includeInactive !== '1' });
  if (req.query.department) users = users.filter((u) => (u.department || '').trim() === String(req.query.department).trim());
  const data = perf.monthlyPayrollCompared({ users, year: p.year, month: p.month, withDays: true });
  const sheets = buildPayrollSheets(data);
  const mm = String(p.month).padStart(2, '0');
  return sendSheets(req, res, `payroll_${p.year}-${mm}.csv`, sheets, {
    csv: { headers: sheets[0].headers, rows: sheets[0].rows },
    onExport: (info) => auditRepository.logEvent({
      userId: req.adminUser.id,
      action: 'payroll_exported',
      ipAddress: req.ip || null,
      details: { source: 'admin_panel', year: p.year, month: p.month, department: req.query.department || null, count: data.rows.length, ...exportAuditFields(info) },
    }),
  });
});

router.get('/admin/payroll/:id', requirePermission('payroll.read'), (req, res) => {
  const p = parseYearMonth(req.query.year, req.query.month);
  if (p.error) return res.status(400).json(p.error);
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'شناسه‌ی کاربر نامعتبر است.', code: 'INVALID_USER' });
  const user = usersRepository.findById(parseInt(req.params.id, 10));
  if (!user) return res.status(404).json({ error: 'کارمند یافت نشد.' });
  auditView(req, String(user.id), { year: p.year, month: p.month });
  const r = perf.monthlyPayroll({ users: [user], year: p.year, month: p.month, withDays: true });
  return res.json({ year: r.year, month: r.month, label: r.label, from: r.from, to: r.to, ...r.rows[0] });
});

module.exports = router;

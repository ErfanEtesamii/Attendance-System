// F1 (فاز ۱۲): نمای هفتگی کامل کارمند (فقط‌خواندنی). منطق و اسکوپ نقش در services/employeeWeekService.
//   GET /admin/users/:id/week?start=YYYY-MM-DD   team.week_view (admin/hr همه، سرپرست فقط کارمندان مستقیمش؛ کارمند ممنوع)
// start = هر تاریخ داخل هفته (پیش‌فرض هفته‌ی جاری)؛ هفته با تنظیم weekStartDay. حداکثر یک هفته در هر درخواست.
const express = require('express');
const { requirePermission } = require('../../../middleware/permissions');
const service = require('../../../services/employeeWeekService');
const settingsRepository = require('../../../repositories/settingsRepository');
const { earningsForUser } = require('../../../services/earningsService');
const { todayDateString } = require('../../../utils/serverTime');
const auditRepository = require('../../../repositories/auditRepository');
const { sendSheets, exportAuditFields } = require('../../../utils/xlsx');
const { buildWeekSheets, buildWeekText } = require('../../../services/weekExportService');

const router = express.Router();

function exportWeek(req, res, result) {
  if (!result.ok) return res.status(result.status).json({ error: result.error, code: result.code });
  const format = String(req.query.format || 'csv').toLowerCase();
  if (!['xlsx', 'csv', 'txt'].includes(format)) return res.status(400).json({ error: 'پارامتر format باید xlsx، csv یا txt باشد.', code: 'INVALID_FORMAT' });
  const start = result.week.start; const filename = `week-${result.user.id}_${start}`;
  const audit = (info) => auditRepository.logEvent({ userId: req.adminUser.id, action: 'report_exported', ipAddress: req.ip, details: { source: 'admin_panel', kind: 'week_plan', start, targetUserId: result.user.id, ...exportAuditFields(info) } });
  if (format === 'txt') {
    audit({ format: 'txt', requested: 'txt' });
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.txt"`);
    return res.send(buildWeekText(result));
  }
  const sheets = buildWeekSheets(result);
  return sendSheets(req, res, `${filename}.csv`, sheets, { onExport: audit });
}

// باید پیش از route معمولی ثبت شود تا مسیر خروجی مستقل و روشن بماند.
router.get('/admin/users/:id/week/export', requirePermission('team.week_view'), (req, res) => exportWeek(req, res, service.getWeek(req.adminUser, req.params.id, { start: req.query.start })));

router.get('/admin/users/:id/week', requirePermission('team.week_view'), (req, res) => {
  const r = service.getWeek(req.adminUser, req.params.id, { start: req.query.start });
  if (!r.ok) return res.status(r.status).json({ error: r.error, code: r.code });
  return res.json(r);
});

// M1 («وضعیت من»): هفته‌ی خودِ کاربر برای همه‌ی نقش‌ها. پارامتر کاربر ندارد؛ هویت فقط از نشست (req.adminUser).
router.get('/admin/me/week/export', requirePermission('me.read'), (req, res) => exportWeek(req, res, service.getMyWeek(req.adminUser, { start: req.query.start })));

router.get('/admin/me/week', requirePermission('me.read'), (req, res) => {
  const r = service.getMyWeek(req.adminUser, { start: req.query.start });
  if (!r.ok) return res.status(r.status).json({ error: r.error, code: r.code });
  return res.json(r);
});

// Phase 20: کارت «کارکرد این ماه» در «وضعیت من» پنل. هویت فقط از نشست (req.adminUser)؛ هیچ شناسه‌ای از query/body خوانده نمی‌شود.
// تنظیم خاموش یا نرخ تعریف‌نشده ⇒ { earnings: null } (نرخ خام هرگز برنمی‌گردد). همان سرویس Mini App.
router.get('/admin/me/earnings', requirePermission('me.read'), (req, res) => {
  const earnings = earningsForUser(req.adminUser, settingsRepository.getAll(), { today: todayDateString() });
  return res.json({ earnings });
});

module.exports = router;

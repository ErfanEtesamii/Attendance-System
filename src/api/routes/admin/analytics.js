// تحلیل‌ها (S5-6a): روند تأخیر و مقایسه با ماه قبل. فقط admin/hr (همه) و سرپرست (تیم خودش)؛ کارمند ممنوع
// (هم گارد مجوز analytics.read و هم لیست سفید کارمند در adminAuth). همه فقط‌خواندنی.
const express = require('express');
const router = express.Router();
const { requirePermission } = require('../../../middleware/permissions');
const { visibleUsers, canAccessUser } = require('./common');
const usersRepository = require('../../../repositories/usersRepository');
const { lateTrend, compareLate, AnalyticsError } = require('../../../services/analyticsService');
const { parseYearMonth } = require('./monthParams');
const breakdown = require('../../../services/analyticsBreakdownService');
const { computeMonthlyReport } = require('../../../services/monthlyReportService');
const { reportFromSnapshot } = require('../../../services/monthCloseService');
const monthClosuresRepository = require('../../../repositories/monthClosuresRepository');
const { todayDateString } = require('../../../utils/serverTime');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const flag = (v) => v === '1' || v === 'true';

// کاربران مجاز طبق اسکوپ نقش و فیلترهای userId/department/includeInactive ⇒ { users } | { error: {status, json} }
function resolveUsers(req) {
  const q = req.query;
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
  return { users };
}

function fail(res, err) {
  if (err instanceof AnalyticsError) return res.status(400).json({ error: err.message, code: err.code });
  throw err;
}

const shiftIso = (iso, days) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };

// GET /admin/analytics/late-trend?granularity=week|month&groupBy=none|department|user&from=&to=[&department=][&userId=][&includeInactive=1]
// پیش‌فرض بازه: ۱۲ هفته‌ی اخیر (week) یا ۱۲ ماه اخیر (month)
router.get('/admin/analytics/late-trend', requirePermission('analytics.read'), (req, res) => {
  const q = req.query;
  const granularity = q.granularity === undefined || q.granularity === '' ? 'week' : String(q.granularity);
  const groupBy = q.groupBy === undefined || q.groupBy === '' ? 'none' : String(q.groupBy);
  for (const k of ['from', 'to']) {
    if (q[k] !== undefined && q[k] !== '' && !DATE_RE.test(String(q[k]))) return res.status(400).json({ error: `${k} باید YYYY-MM-DD باشد.`, code: 'INVALID_RANGE' });
  }
  const to = q.to || todayDateString();
  const from = q.from || shiftIso(to, granularity === 'month' ? -364 : -83);
  const r = resolveUsers(req);
  if (r.error) return res.status(r.error.status).json(r.error.json);
  try {
    return res.json(lateTrend({ users: r.users, from, to, granularity, groupBy }));
  } catch (err) { return fail(res, err); }
});

// GET /admin/analytics/late-compare?year=&month=[&groupBy=][&department=][&userId=][&includeInactive=1]
router.get('/admin/analytics/late-compare', requirePermission('analytics.read'), (req, res) => {
  const p = parseYearMonth(req.query.year, req.query.month);
  if (p.error) return res.status(400).json(p.error);
  const groupBy = req.query.groupBy === undefined || req.query.groupBy === '' ? 'none' : String(req.query.groupBy);
  const r = resolveUsers(req);
  if (r.error) return res.status(r.error.status).json(r.error.json);
  try {
    return res.json(compareLate({ users: r.users, year: p.year, month: p.month, groupBy }));
  } catch (err) { return fail(res, err); }
});

// ---------- تحلیل‌های ماهانه (S5-6b) ----------
// همه روی «گزارش ماهانه»ی همان کاربران مجاز ساخته می‌شوند: ماه بسته ⇒ snapshot (مثل گزارش ماهانه)، وگرنه محاسبه‌ی زنده. فیلد source در پاسخ می‌آید.
function monthlyReportFor(users, year, month) {
  const closure = monthClosuresRepository.findByMonth(year, month);
  if (closure && closure.status === 'closed' && closure.snapshot) {
    return { ...reportFromSnapshot(closure, { allowedIds: users.map((u) => u.id), includeInactive: true }) };
  }
  return { ...computeMonthlyReport({ users, year, month }), source: 'live' };
}

// قالب مشترک: اعتبارسنجی ماه + کاربران ⇒ پاسخ build(report)
function monthlyHandler(build) {
  return (req, res) => {
    const p = parseYearMonth(req.query.year, req.query.month);
    if (p.error) return res.status(400).json(p.error);
    const r = resolveUsers(req);
    if (r.error) return res.status(r.error.status).json(r.error.json);
    try {
      const report = monthlyReportFor(r.users, p.year, p.month);
      return res.json({ year: p.year, month: p.month, label: report.label, from: report.from, to: report.to, source: report.source, ...build(report, req.query) });
    } catch (err) { return fail(res, err); }
  };
}
const groupOf = (q) => (q.groupBy === undefined || q.groupBy === '' ? 'none' : String(q.groupBy));

// GET /admin/analytics/rankings?year=&month=&metric=overtime|shortfall[&limit=10]
router.get('/admin/analytics/rankings', requirePermission('analytics.read'), monthlyHandler((report, q) => {
  const metric = q.metric === undefined || q.metric === '' ? 'overtime' : String(q.metric);
  if (!['overtime', 'shortfall'].includes(metric)) throw new AnalyticsError('INVALID_METRIC', 'metric باید overtime یا shortfall باشد.');
  const limit = breakdown.parseLimit(q.limit);
  return metric === 'overtime' ? breakdown.rankOvertime(report, { limit }) : breakdown.rankShortfall(report, { limit });
}));

// GET /admin/analytics/attendance-rate?year=&month=[&groupBy=none|department|user]
router.get('/admin/analytics/attendance-rate', requirePermission('analytics.read'), monthlyHandler((report, q) => breakdown.attendanceRate(report, { groupBy: groupOf(q) })));

// GET /admin/analytics/leave-by-type?year=&month=[&groupBy=none|department]
router.get('/admin/analytics/leave-by-type', requirePermission('analytics.read'), monthlyHandler((report, q) => breakdown.leaveByType(report, { groupBy: groupOf(q) })));

// GET /admin/analytics/checkin-distribution?from=&to=[&binMinutes=30][&department=][&userId=]  (پیش‌فرض: ۳۰ روز اخیر)
router.get('/admin/analytics/checkin-distribution', requirePermission('analytics.read'), (req, res) => {
  const q = req.query;
  for (const k of ['from', 'to']) {
    if (q[k] !== undefined && q[k] !== '' && !DATE_RE.test(String(q[k]))) return res.status(400).json({ error: `${k} باید YYYY-MM-DD باشد.`, code: 'INVALID_RANGE' });
  }
  const to = q.to || todayDateString();
  const from = q.from || shiftIso(to, -29);
  let binMinutes = 30;
  if (q.binMinutes !== undefined && q.binMinutes !== '') {
    if (!/^\d+$/.test(String(q.binMinutes))) return res.status(400).json({ error: 'binMinutes عدد نیست.', code: 'INVALID_BIN' });
    binMinutes = Number(q.binMinutes);
  }
  const r = resolveUsers(req);
  if (r.error) return res.status(r.error.status).json(r.error.json);
  try {
    return res.json(breakdown.checkinDistribution({ users: r.users, from, to, binMinutes }));
  } catch (err) { return fail(res, err); }
});

module.exports = router;

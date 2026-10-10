// بستن ماه (S5-3). این مرحله (S5-3a): فقط خواندن — وضعیت ماه‌های یک سال و چک‌لیست پیش از بستن.
// بستن (S5-3b) و بازکردن (S5-3c) در همین فایل اضافه می‌شوند.
//
// مجوز: monthclose.read (admin و hr؛ کل شرکت؛ سرپرست/کارمند ممنوع). اسکوپ تیمی معنا ندارد چون بستن ماه برای کل شرکت است.

const express = require('express');
const router = express.Router();

const { requirePermission } = require('../../../middleware/permissions');
const monthClosuresRepository = require('../../../repositories/monthClosuresRepository');
const { buildChecklist, closeMonth, MonthCloseError } = require('../../../services/monthCloseService');
const { auditChange, requireReason } = require('./common');
const { parseYearMonth, parseYear } = require('./monthParams');

// وضعیت ۱۲ ماه یک سال شمسی (ماهِ بدون ردیف = open)
router.get('/admin/month-closures', requirePermission('monthclose.read'), (req, res) => {
  const y = parseYear(req.query.year);
  if (y.error) return res.status(400).json(y.error);
  const byMonth = new Map(monthClosuresRepository.listByYear(y.year).map((r) => [r.jalali_month, r]));
  const months = [];
  for (let m = 1; m <= 12; m += 1) {
    const r = byMonth.get(m);
    months.push(r
      ? { month: m, status: r.status, closedAt: r.closed_at, closedBy: r.closed_by, closeCount: r.close_count, reopenedAt: r.reopened_at, reopenedBy: r.reopened_by, reopenReason: r.reopen_reason, closeNote: r.close_note }
      : { month: m, status: 'open' });
  }
  return res.json({ year: y.year, months });
});

// چک‌لیست پیش از بستن (فقط خواندن؛ چیزی نمی‌بندد)
router.get('/admin/month-closures/:year/:month/checklist', requirePermission('monthclose.read'), (req, res) => {
  const p = parseYearMonth(req.params.year, req.params.month);
  if (p.error) return res.status(400).json(p.error);
  return res.json(buildChecklist({ year: p.year, month: p.month }));
});

// جزئیات یک ماه: وضعیت + خلاصه‌ی snapshot (بدون خود snapshot سنگین)
router.get('/admin/month-closures/:year/:month', requirePermission('monthclose.read'), (req, res) => {
  const p = parseYearMonth(req.params.year, req.params.month);
  if (p.error) return res.status(400).json(p.error);
  const row = monthClosuresRepository.findByMonth(p.year, p.month);
  if (!row) return res.json({ year: p.year, month: p.month, status: 'open' });
  return res.json({
    year: p.year, month: p.month, status: row.status, periodFrom: row.period_from, periodTo: row.period_to,
    closedAt: row.closed_at, closedBy: row.closed_by, closeCount: row.close_count, closeNote: row.close_note,
    reopenedAt: row.reopened_at, reopenedBy: row.reopened_by, reopenReason: row.reopen_reason,
    adjustmentCount: row.status === 'closed' ? monthClosuresRepository.listAdjustments(row.id, row.close_count, { limit: 1000 }).length : 0,
    snapshot: row.snapshot ? { version: row.snapshot.version, closedAtIso: row.snapshot.closedAtIso, userCount: row.snapshot.report.users.length, totals: row.snapshot.report.totals } : null,
    checklist: row.checklist ? { blockingCount: row.checklist.blockingCount, warningCount: row.checklist.warningCount, items: row.checklist.items.map((i) => ({ key: i.key, count: i.count, blocking: i.blocking })) } : null,
  });
});

// بستن ماه (admin): { note? }. چک‌لیست مانع داشته باشد ⇒ ۴۰۹ با چک‌لیست؛ از قبل بسته ⇒ ۴۰۹.
router.post('/admin/month-closures/:year/:month/close', requirePermission('monthclose.close'), (req, res) => {
  const p = parseYearMonth(req.params.year, req.params.month);
  if (p.error) return res.status(400).json(p.error);
  const note = req.body && req.body.note !== undefined ? req.body.note : null;
  if (note !== null && typeof note !== 'string') return res.status(400).json({ error: 'توضیح (note) باید متن باشد.', code: 'INVALID_NOTE' });
  const before = monthClosuresRepository.findByMonth(p.year, p.month);
  let result;
  try {
    result = closeMonth({ year: p.year, month: p.month, closedBy: req.adminUser.id, note });
  } catch (err) {
    if (err instanceof MonthCloseError) return res.status(409).json({ error: err.message, code: err.code, checklist: err.checklist });
    throw err;
  }
  const { closure, checklist } = result;
  auditChange(req, {
    action: 'month_closed',
    entityType: 'month_closure',
    entityId: closure.id,
    before: { status: before ? before.status : 'open' },
    after: { status: 'closed', closeCount: closure.close_count, blockingCount: checklist.blockingCount, warningCount: checklist.warningCount, userCount: closure.snapshot.report.users.length },
    reason: closure.close_note,
    meta: { year: p.year, month: p.month, periodFrom: closure.period_from, periodTo: closure.period_to },
  });
  return res.status(201).json({
    year: p.year, month: p.month, status: closure.status, closedAt: closure.closed_at, closedBy: closure.closed_by, closeCount: closure.close_count,
    closeNote: closure.close_note, userCount: closure.snapshot.report.users.length, warningCount: checklist.warningCount,
  });
});

// اصلاح‌های ثبت‌شده بعد از بستن (نسخه‌ی جاری بستن)
router.get('/admin/month-closures/:year/:month/adjustments', requirePermission('monthclose.read'), (req, res) => {
  const p = parseYearMonth(req.params.year, req.params.month);
  if (p.error) return res.status(400).json(p.error);
  const row = monthClosuresRepository.findByMonth(p.year, p.month);
  if (!row) return res.json({ year: p.year, month: p.month, items: [] });
  return res.json({ year: p.year, month: p.month, closeCount: row.close_count, items: monthClosuresRepository.listAdjustments(row.id, row.close_count) });
});

// بازکردن ماه بسته (admin، دلیل اجباری). snapshot و اصلاح‌ها می‌مانند؛ تا بستن دوباره گزارش زنده است و قفل برداشته می‌شود.
router.post('/admin/month-closures/:year/:month/reopen', requirePermission('monthclose.reopen'), (req, res) => {
  const p = parseYearMonth(req.params.year, req.params.month);
  if (p.error) return res.status(400).json(p.error);
  const reason = requireReason(req, res);
  if (!reason) return undefined;
  const before = monthClosuresRepository.findByMonth(p.year, p.month);
  const row = monthClosuresRepository.reopen(p.year, p.month, { reopenedBy: req.adminUser.id, reason: reason.slice(0, 500) });
  if (!row) return res.status(409).json({ error: 'این ماه بسته نیست.', code: 'NOT_CLOSED' });
  auditChange(req, {
    action: 'month_reopened',
    entityType: 'month_closure',
    entityId: row.id,
    before: { status: before.status },
    after: { status: 'reopened' },
    reason,
    meta: { year: p.year, month: p.month },
  });
  return res.json({ year: p.year, month: p.month, status: row.status, reopenedAt: row.reopened_at, reopenedBy: row.reopened_by, reopenReason: row.reopen_reason });
});

module.exports = router;

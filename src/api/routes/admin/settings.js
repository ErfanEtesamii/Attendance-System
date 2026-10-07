// تنظیمات سیستم و تعطیلات رسمی.
// (تقسیم‌شده از admin.js/adminPanel.js؛ URLها و رفتار بدون تغییر. احراز هویت در index.js یک‌بار اعمال می‌شود.)

const express = require('express');
const router = express.Router();

const { requirePermission } = require('../../../middleware/permissions');
const holidaysRepository = require('../../../repositories/holidaysRepository');
const settingsRepository = require('../../../repositories/settingsRepository');
const usersRepository = require('../../../repositories/usersRepository');
const registry = require('../../../utils/settingsRegistry');
const { requireReason, auditChange } = require('./common');
const { parseHolidayBody, parseImport } = require('../../../utils/holidayInput');

// ---------- تعطیلات رسمی ----------

router.get('/admin/holidays', requirePermission('settings.read'), (req, res) => {
  res.json(holidaysRepository.listHolidays());
});

// خلاصه‌ی قابل‌ثبت در audit
const holidayView = (h) => ({ date: h.holiday_date, title: h.title, kind: h.kind, halfEndTime: h.half_end_time, scope: h.scope, department: h.department });

// دپارتمان دقیقاً (بعد از trim) با دپارتمان هیچ کاربری نمی‌خواند ⇒ تعطیلی روی کسی اثر نمی‌گذارد؛ فقط هشدار می‌دهیم، رد نمی‌کنیم.
function departmentUnmatched(h) {
  if (h.scope !== 'department') return false;
  return !usersRepository.listUsers({}).some((u) => (u.department || '').trim() === h.department);
}

function holidayResponse(h) {
  return { ...h, ...(departmentUnmatched(h) ? { warning: 'هیچ کاربری با این دپارتمان (دقیقاً با همین نوشتار) پیدا نشد؛ این تعطیلی فعلاً روی کسی اثر ندارد.' } : {}) };
}

// S3-9c: ورود گروهی تعطیلات. بدنه: { text } (خط‌به‌خط یا CSV؛ تاریخ شمسی) یا { items: [{date,title,kind,halfEndTime,department}] }
// و { commit: true } برای ذخیره. بدون commit فقط پیش‌نمایش است و هیچ چیزی نوشته نمی‌شود.
// وضعیت هر ردیف: new | duplicate (از قبل در تقویم) | duplicate_in_input (تکرار داخل همین ورودی؛ فقط اولی) | invalid.
// commit: اگر حتی یک ردیف نامعتبر باشد ⇒ ۴۲۲ و هیچ چیز ذخیره نمی‌شود؛ تکراری‌ها نادیده می‌مانند و بقیه در یک تراکنش ذخیره می‌شوند.
router.post('/admin/holidays/import', requirePermission('settings.edit'), (req, res) => {
  const body = req.body || {};
  const parsed = parseImport({ text: body.text, items: body.items });
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  const existing = new Set(holidaysRepository.listHolidays().map((h) => `${h.holiday_date}|${h.scope}|${h.department}`));
  const seen = new Set();
  const departments = new Set(usersRepository.listUsers({}).map((u) => (u.department || '').trim()).filter(Boolean));
  const rows = parsed.rows.map((r) => {
    if (!r.ok) return { line: r.line, input: r.input, status: 'invalid', error: r.error };
    const v = r.value;
    const key = `${v.date}|${v.scope}|${v.department}`;
    let status = 'new';
    if (existing.has(key)) status = 'duplicate';
    else if (seen.has(key)) status = 'duplicate_in_input';
    seen.add(key);
    const out = { line: r.line, input: r.input, status, ...v, jalali: r.jalali };
    if (v.scope === 'department' && !departments.has(v.department)) out.warning = 'هیچ کاربری با این دپارتمان (دقیقاً با همین نوشتار) پیدا نشد.';
    return out;
  });
  const count = (s) => rows.filter((r) => r.status === s).length;
  const summary = { total: rows.length, new: count('new'), duplicate: count('duplicate'), duplicateInInput: count('duplicate_in_input'), invalid: count('invalid') };

  if (body.commit !== true) return res.json({ committed: false, summary, rows });
  if (summary.invalid) return res.status(422).json({ error: 'ورودی ردیف نامعتبر دارد؛ چیزی ذخیره نشد. ابتدا خطاها را اصلاح کنید.', committed: false, summary, rows });

  const toAdd = rows.filter((r) => r.status === 'new');
  const added = holidaysRepository.addHolidaysBatch(toAdd.map((r) => ({ date: r.date, title: r.title, kind: r.kind, halfEndTime: r.halfEndTime, scope: r.scope, department: r.department })));
  const reason = (body.reason || '').toString().trim();
  // یک رکورد برای کل batch: after.added = فهرست تعطیلی‌های ثبت‌شده (before=null ⇒ ایجاد)
  auditChange(req, {
    action: 'holidays_imported',
    entityType: 'holiday',
    entityId: null,
    before: null,
    after: { added: added.map((h) => ({ date: h.holiday_date, title: h.title, kind: h.kind, scope: h.scope, department: h.department })) },
    reason,
    meta: { summary },
  });
  return res.json({ committed: true, summary: { ...summary, added: added.length }, rows });
});

router.post('/admin/holidays', requirePermission('settings.edit'), (req, res) => {
  const parsed = parseHolidayBody(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const v = parsed.value;
  const dup = holidaysRepository.listByDate(v.date).find((h) => h.scope === v.scope && h.department === v.department);
  if (dup) return res.status(409).json({ error: 'برای این تاریخ و دامنه قبلاً تعطیلی ثبت شده است؛ آن را ویرایش کنید.' });
  const holiday = holidaysRepository.addHoliday(v.date, v.title, v);
  const reason = ((req.body || {}).reason || '').toString().trim();
  auditChange(req, { action: 'holiday_added', entityType: 'holiday', entityId: holiday.id, before: null, after: holidayView(holiday), reason, meta: { holidayId: holiday.id } });
  return res.status(201).json(holidayResponse(holiday));
});

router.put('/admin/holidays/:id', requirePermission('settings.edit'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const before = Number.isInteger(id) ? holidaysRepository.getHoliday(id) : null;
  if (!before) return res.status(404).json({ error: 'تعطیلی موردنظر پیدا نشد.' });
  const parsed = parseHolidayBody(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const after = holidaysRepository.updateHoliday(id, parsed.value);
  if (after && after.conflict) return res.status(409).json({ error: 'برای این تاریخ و دامنه تعطیلی دیگری ثبت شده است.' });
  const reason = ((req.body || {}).reason || '').toString().trim();
  auditChange(req, { action: 'holiday_updated', entityType: 'holiday', entityId: id, before: holidayView(before), after: holidayView(after), reason, meta: { holidayId: id } });
  return res.json(holidayResponse(after));
});

router.delete('/admin/holidays/:id', requirePermission('settings.edit'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const before = Number.isInteger(id) ? holidaysRepository.getHoliday(id) : null;
  if (!before) return res.status(404).json({ error: 'تعطیلی موردنظر پیدا نشد.' });
  holidaysRepository.removeHoliday(id);
  auditChange(req, { action: 'holiday_removed', entityType: 'holiday', entityId: id, before: holidayView(before), after: null, meta: { holidayId: id } });
  return res.json({ ok: true });
});

// S3-8c: بعد از تغییر/reset هر تنظیم cron، زمان‌بندی Jobها همان لحظه و بدون ری‌استارت دوباره ساخته می‌شود.
// ضدخطا: خرابیِ reload هرگز ذخیره‌ی تنظیم را برنمی‌گرداند (مقدار در DB ماندگار است و در ری‌استارت بعدی اعمال می‌شود). تنظیم غیر cron ⇒ undefined.
// اگر پروسه‌ی فعلی زمان‌بندی را بالا نیاورده (مثلاً فقط API) نتیجه‌ی { reloaded: false, reason: 'scheduler_not_started' } است.
function reloadSchedulerIfCron(keys) {
  if (!keys.some((k) => { const d = registry.getDef(k); return d && d.type === 'cron'; })) return undefined;
  try {
    return require('../../../bot/scheduler').reload(); // require تنبل: مسیر API به بارگذاری Jobها وابسته نشود
  } catch (err) {
    console.error('[settings] reload زمان‌بندی ناموفق:', err.message);
    return { reloaded: false, reason: 'error', error: err.message, changed: [], errors: [] };
  }
}

// ---------- تنظیمات سیستم (ساعت کاری، آستانه‌ها) ----------

router.get('/admin/settings', requirePermission('settings.read'), (req, res) => {
  res.json(settingsRepository.getAll());
});

router.patch('/admin/settings', requirePermission('settings.edit'), (req, res) => {
  const before = settingsRepository.getAll();
  const updated = settingsRepository.update(req.body || {});
  // S3-1b: مقدار قبل/بعد کلیدهای تغییرکرده هم در details می‌آید (فیلدهای قبلی بدون تغییر)
  const changedKeys = Object.keys(updated).filter((k) => !registry.sameValue(updated[k], before[k]));
  const beforeChanged = {};
  const afterChanged = {};
  changedKeys.forEach((k) => { beforeChanged[k] = before[k]; afterChanged[k] = updated[k]; });
  // S4-1b: قالب استاندارد logChange؛ changes همان { کلید: { before, after } } قبلی است و fields (کلیدهای ارسالی) در meta می‌ماند
  auditChange(req, {
    action: 'settings_updated',
    entityType: 'settings',
    entityId: null,
    before: beforeChanged,
    after: afterChanged,
    meta: { fields: Object.keys(req.body || {}) },
  });
  reloadSchedulerIfCron(changedKeys); // پاسخ PATCH قدیمی (آبجکت تخت تنظیمات) عمداً بدون تغییر می‌ماند
  res.json(updated);
});

// ---------- API تنظیمات با متادیتا (S3-1b) ----------
// UI فعلی همچنان از GET/PATCH /admin/settings بالا استفاده می‌کند؛ این سه مسیر برای صفحه‌ی تنظیمات جدید (S3-9a) است.

// GET /admin/settings/items → { items: [{ key, type, group, groupLabel, description, value, default, isDefault, updatedAt, min?, max?, values? }] }
router.get('/admin/settings/items', requirePermission('settings.read'), (req, res) => {
  res.json({ items: settingsRepository.getItems(), groups: registry.GROUP_LABELS });
});

// PUT /admin/settings/:key  { value, reason (اجباری) } → ۴۰۴ کلید ناشناخته، ۴۰۰ بدون دلیل/مقدار نامعتبر
router.put('/admin/settings/:key', requirePermission('settings.edit'), (req, res) => {
  const { key } = req.params;
  if (!registry.getDef(key)) return res.status(404).json({ error: 'تنظیم موردنظر پیدا نشد.' });
  const reason = requireReason(req, res);
  if (reason === null) return undefined;

  const checked = registry.validate(key, (req.body || {}).value);
  if (!checked.ok) return res.status(400).json({ error: `مقدار «${key}» نامعتبر است: ${checked.error}`, key });

  const before = settingsRepository.getItem(key).value;
  if (registry.sameValue(before, checked.value)) return res.json({ changed: false, item: settingsRepository.getItem(key) });

  const item = settingsRepository.setValue(key, checked.value);
  auditChange(req, { action: 'settings_updated', entityType: 'settings', entityId: key, before: { [key]: before }, after: { [key]: item.value }, reason, meta: { fields: [key] } });
  const scheduler = reloadSchedulerIfCron([key]);
  return res.json({ changed: true, item, ...(scheduler ? { scheduler } : {}) });
});

// POST /admin/settings/:key/reset  { reason (اجباری) } → بازگشت یک کلید به پیش‌فرض
router.post('/admin/settings/:key/reset', requirePermission('settings.edit'), (req, res) => {
  const { key } = req.params;
  if (!registry.getDef(key)) return res.status(404).json({ error: 'تنظیم موردنظر پیدا نشد.' });
  const reason = requireReason(req, res);
  if (reason === null) return undefined;

  const before = settingsRepository.getItem(key).value;
  if (!settingsRepository.resetValue(key)) return res.json({ changed: false, item: settingsRepository.getItem(key) }); // ردیفی نبود: همین الان پیش‌فرض است
  const item = settingsRepository.getItem(key);
  auditChange(req, { action: 'settings_reset', entityType: 'settings', entityId: key, before: { [key]: before }, after: { [key]: item.value }, reason, meta: { fields: [key] } });
  const scheduler = reloadSchedulerIfCron([key]);
  return res.json({ changed: true, item, ...(scheduler ? { scheduler } : {}) });
});

module.exports = router;

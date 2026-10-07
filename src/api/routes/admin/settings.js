// تنظیمات سیستم و تعطیلات رسمی.
// (تقسیم‌شده از admin.js/adminPanel.js؛ URLها و رفتار بدون تغییر. احراز هویت در index.js یک‌بار اعمال می‌شود.)

const express = require('express');
const router = express.Router();

const { requireFullAdmin } = require('../../../middleware/adminAuth');
const holidaysRepository = require('../../../repositories/holidaysRepository');
const settingsRepository = require('../../../repositories/settingsRepository');
const auditRepository = require('../../../repositories/auditRepository');
const usersRepository = require('../../../repositories/usersRepository');
const registry = require('../../../utils/settingsRegistry');
const { requireReason, audit } = require('./common');

// ---------- تعطیلات رسمی ----------

router.get('/admin/holidays', (req, res) => {
  res.json(holidaysRepository.listHolidays());
});

// S3-9b: اعتبارسنجی ورودی تعطیلی با پیام فارسی (پیش‌تر فقط CHECK جدول بود و ۵۰۰ می‌داد).
// ورودی قدیمی { date, title } معتبر می‌ماند (= تعطیلی کامل برای همه). خروجی: { ok, value } | { ok: false, error }
function parseHolidayBody(body) {
  const b = body || {};
  const bad = (error) => ({ ok: false, error });
  const date = typeof b.date === 'string' ? b.date.trim() : '';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00Z`) : null;
  if (!d || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== date) return bad('تاریخ نامعتبر است (قالب YYYY-MM-DD).');
  const title = typeof b.title === 'string' ? b.title.trim() : '';
  if (!title) return bad('عنوان الزامی است.');
  if (title.length > 100) return bad('عنوان حداکثر ۱۰۰ نویسه می‌تواند باشد.');

  const kind = b.kind === undefined || b.kind === '' ? 'full' : b.kind;
  if (kind !== 'full' && kind !== 'half') return bad('نوع تعطیلی باید «کامل» یا «نیم‌روز» باشد.');
  let halfEndTime = null;
  if (kind === 'half') {
    const m = typeof b.halfEndTime === 'string' ? /^\s*(\d{1,2}):(\d{2})\s*$/.exec(b.halfEndTime) : null;
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return bad('برای نیم‌روز، ساعت پایان کار (HH:MM) الزامی است.');
    halfEndTime = `${m[1].padStart(2, '0')}:${m[2]}`;
  }

  const scope = b.scope === undefined || b.scope === '' ? 'all' : b.scope;
  if (scope !== 'all' && scope !== 'department') return bad('دامنه باید «همه» یا «دپارتمان» باشد.');
  let department = '';
  if (scope === 'department') {
    department = typeof b.department === 'string' ? b.department.trim() : '';
    if (!department) return bad('برای تعطیلی دپارتمانی، نام دپارتمان الزامی است.');
    if (department.length > 100) return bad('نام دپارتمان حداکثر ۱۰۰ نویسه می‌تواند باشد.');
  }
  return { ok: true, value: { date, title, kind, halfEndTime, scope, department } };
}

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

router.post('/admin/holidays', requireFullAdmin, (req, res) => {
  const parsed = parseHolidayBody(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const v = parsed.value;
  const dup = holidaysRepository.listByDate(v.date).find((h) => h.scope === v.scope && h.department === v.department);
  if (dup) return res.status(409).json({ error: 'برای این تاریخ و دامنه قبلاً تعطیلی ثبت شده است؛ آن را ویرایش کنید.' });
  const holiday = holidaysRepository.addHoliday(v.date, v.title, v);
  const reason = ((req.body || {}).reason || '').toString().trim();
  audit(req, 'holiday_added', { ...holidayView(holiday), holidayId: holiday.id, ...(reason ? { reason } : {}) });
  return res.status(201).json(holidayResponse(holiday));
});

router.put('/admin/holidays/:id', requireFullAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const before = Number.isInteger(id) ? holidaysRepository.getHoliday(id) : null;
  if (!before) return res.status(404).json({ error: 'تعطیلی موردنظر پیدا نشد.' });
  const parsed = parseHolidayBody(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const after = holidaysRepository.updateHoliday(id, parsed.value);
  if (after && after.conflict) return res.status(409).json({ error: 'برای این تاریخ و دامنه تعطیلی دیگری ثبت شده است.' });
  const reason = ((req.body || {}).reason || '').toString().trim();
  audit(req, 'holiday_updated', { holidayId: id, before: holidayView(before), after: holidayView(after), ...(reason ? { reason } : {}) });
  return res.json(holidayResponse(after));
});

router.delete('/admin/holidays/:id', requireFullAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const before = Number.isInteger(id) ? holidaysRepository.getHoliday(id) : null;
  if (!before) return res.status(404).json({ error: 'تعطیلی موردنظر پیدا نشد.' });
  holidaysRepository.removeHoliday(id);
  audit(req, 'holiday_removed', { holidayId: req.params.id, ...holidayView(before) });
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

router.get('/admin/settings', (req, res) => {
  res.json(settingsRepository.getAll());
});

router.patch('/admin/settings', requireFullAdmin, (req, res) => {
  const before = settingsRepository.getAll();
  const updated = settingsRepository.update(req.body || {});
  // S3-1b: مقدار قبل/بعد کلیدهای تغییرکرده هم در details می‌آید (فیلدهای قبلی بدون تغییر)
  const changes = {};
  Object.keys(updated).forEach((k) => {
    if (!registry.sameValue(updated[k], before[k])) changes[k] = { before: before[k], after: updated[k] };
  });
  auditRepository.logEvent({
    userId: req.adminUser.id,
    action: 'settings_updated',
    details: { source: 'admin_panel', fields: Object.keys(req.body || {}), changes },
  });
  reloadSchedulerIfCron(Object.keys(changes)); // پاسخ PATCH قدیمی (آبجکت تخت تنظیمات) عمداً بدون تغییر می‌ماند
  res.json(updated);
});

// ---------- API تنظیمات با متادیتا (S3-1b) ----------
// UI فعلی همچنان از GET/PATCH /admin/settings بالا استفاده می‌کند؛ این سه مسیر برای صفحه‌ی تنظیمات جدید (S3-9a) است.

// GET /admin/settings/items → { items: [{ key, type, group, groupLabel, description, value, default, isDefault, updatedAt, min?, max?, values? }] }
router.get('/admin/settings/items', (req, res) => {
  res.json({ items: settingsRepository.getItems(), groups: registry.GROUP_LABELS });
});

// PUT /admin/settings/:key  { value, reason (اجباری) } → ۴۰۴ کلید ناشناخته، ۴۰۰ بدون دلیل/مقدار نامعتبر
router.put('/admin/settings/:key', requireFullAdmin, (req, res) => {
  const { key } = req.params;
  if (!registry.getDef(key)) return res.status(404).json({ error: 'تنظیم موردنظر پیدا نشد.' });
  const reason = requireReason(req, res);
  if (reason === null) return undefined;

  const checked = registry.validate(key, (req.body || {}).value);
  if (!checked.ok) return res.status(400).json({ error: `مقدار «${key}» نامعتبر است: ${checked.error}`, key });

  const before = settingsRepository.getItem(key).value;
  if (registry.sameValue(before, checked.value)) return res.json({ changed: false, item: settingsRepository.getItem(key) });

  const item = settingsRepository.setValue(key, checked.value);
  audit(req, 'settings_updated', { fields: [key], changes: { [key]: { before, after: item.value } }, reason });
  const scheduler = reloadSchedulerIfCron([key]);
  return res.json({ changed: true, item, ...(scheduler ? { scheduler } : {}) });
});

// POST /admin/settings/:key/reset  { reason (اجباری) } → بازگشت یک کلید به پیش‌فرض
router.post('/admin/settings/:key/reset', requireFullAdmin, (req, res) => {
  const { key } = req.params;
  if (!registry.getDef(key)) return res.status(404).json({ error: 'تنظیم موردنظر پیدا نشد.' });
  const reason = requireReason(req, res);
  if (reason === null) return undefined;

  const before = settingsRepository.getItem(key).value;
  if (!settingsRepository.resetValue(key)) return res.json({ changed: false, item: settingsRepository.getItem(key) }); // ردیفی نبود: همین الان پیش‌فرض است
  const item = settingsRepository.getItem(key);
  audit(req, 'settings_reset', { fields: [key], changes: { [key]: { before, after: item.value } }, reason });
  const scheduler = reloadSchedulerIfCron([key]);
  return res.json({ changed: true, item, ...(scheduler ? { scheduler } : {}) });
});

module.exports = router;

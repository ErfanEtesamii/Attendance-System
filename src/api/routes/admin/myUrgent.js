// تسک فوریِ خودِ کاربر از «وضعیت من» (پنل) — برای همه‌ی نقش‌ها (me.read). همان selfUrgentTaskService که Mini App (`/miniapp/my-urgent`) صدا می‌زند؛
// یعنی همه‌ی قوانین (تنظیم selfUrgentEnabled، سقف روزانه، بازه‌ی امروز تا ۶۰ روز بعد، روز کاری، ماه بسته، قفل هفته، فقط‌بدون‌پاسخ برای ویرایش/حذف، اعلان به سرپرست) یکسان است.
// ⚠️ اسکوپ: همه‌چیز فقط با req.adminUser؛ هیچ userId از کلاینت پذیرفته نمی‌شود (تسک کاربر دیگر ⇒ TASK_NOT_FOUND). بدنه فقط title/description/date.
//   GET    /admin/me/urgent/config     { enabled, maxPerDay } — برای نمایش/مخفی‌کردن دکمه (اجرای واقعی سمت سرور دوباره چک می‌شود)
//   POST   /admin/me/urgent            { title, description?, date }
//   PATCH  /admin/me/urgent/:id        { title?, description?, date? } (تاریخ فقط داخل همان هفته)
//   DELETE /admin/me/urgent/:id
// audit: self_urgent_task_added / _edited / _removed با source: 'panel'.
const express = require('express');
const { requirePermission } = require('../../../middleware/permissions');
const { createRateLimiter } = require('../../../middleware/rateLimiter');
const selfUrgentTaskService = require('../../../services/selfUrgentTaskService');
const settingsRepository = require('../../../repositories/settingsRepository');
const { REPORT_ERROR_STATUS } = require('../../../utils/reportErrors');

const router = express.Router();

// مثل miniAppMyUrgentLimiter؛ کلید = شناسه‌ی کاربرِ نشست (نه IP)
router.use('/admin/me/urgent', createRateLimiter({
  name: 'panel-my-urgent',
  windowMs: 60 * 1000,
  max: 10,
  message: 'تعداد درخواست‌های تسک فوری بیش از حد مجاز است. لطفاً کمی صبر کنید.',
  keyFn: (req) => `panel-my-urgent:${req.adminUser ? req.adminUser.id : req.ip}`,
}));

const sendError = (res, r) => res.status(REPORT_ERROR_STATUS[r.code] || selfUrgentTaskService.statusOf(r.code)).json({ error: r.error, code: r.code });
const taskIdParam = (req) => { const n = Number(req.params.id); return Number.isInteger(n) && n > 0 ? n : null; };
const badTaskId = (res) => res.status(404).json({ error: 'تسک فوری یافت نشد.', code: 'TASK_NOT_FOUND' });

router.get('/admin/me/urgent/config', requirePermission('me.read'), (req, res) => {
  const s = settingsRepository.getAll();
  res.json({ enabled: !!s.selfUrgentEnabled, maxPerDay: Number(s.selfUrgentMaxPerDay) || 5 });
});

router.post('/admin/me/urgent', requirePermission('me.read'), (req, res) => {
  const r = selfUrgentTaskService.add(req.adminUser, req.body || {}, { ip: req.ip, source: 'panel' });
  if (!r.ok) return sendError(res, r);
  return res.status(201).json(r);
});

router.patch('/admin/me/urgent/:id', requirePermission('me.read'), (req, res) => {
  const id = taskIdParam(req);
  if (id === null) return badTaskId(res);
  const r = selfUrgentTaskService.update(req.adminUser, id, req.body || {}, { ip: req.ip, source: 'panel' });
  if (!r.ok) return sendError(res, r);
  return res.json(r);
});

router.delete('/admin/me/urgent/:id', requirePermission('me.read'), (req, res) => {
  const id = taskIdParam(req);
  if (id === null) return badTaskId(res);
  const r = selfUrgentTaskService.remove(req.adminUser, id, { ip: req.ip, source: 'panel' });
  if (!r.ok) return sendError(res, r);
  return res.json(r);
});

module.exports = router;

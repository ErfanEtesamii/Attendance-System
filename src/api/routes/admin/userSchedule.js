// B2 (فاز ۱۲): برنامه‌ی کاری روزبه‌روز هر کارمند (override روز). قواعد در services/userScheduleService؛ اینجا فقط HTTP.
//   GET    /admin/users/:id/schedule?from=&to=        schedule.read   (admin/hr همه، سرپرست زیرمجموعه) — حداکثر ۶۲ روز
//   PUT    /admin/users/:id/schedule/:date            schedule.manage { kind: 'work'|'off', startTime?, endTime?, note? }
//   DELETE /admin/users/:id/schedule/:date            schedule.manage (برگشت به شیفت/سراسری)
//   POST   /admin/schedule/bulk                       schedule.manage { userIds[≤۵۰], from, to (≤۳۱ روز), weekdays?, kind, startTime?, endTime?, note? }
// ماه بسته‌شده ⇒ ۴۰۹؛ کارمند/hr نوشتن ندارند؛ سرپرست فقط زیرمجموعه‌ی خودش.
const express = require('express');
const { requirePermission } = require('../../../middleware/permissions');
const service = require('../../../services/userScheduleService');

const router = express.Router();

const send = (res, r, okStatus = 200) => {
  if (r.ok) return res.status(okStatus).json(r);
  return res.status(r.status).json({ error: r.error, code: r.code });
};

router.get('/admin/users/:id/schedule', requirePermission('schedule.read'), (req, res) => {
  const { from, to } = req.query;
  return send(res, service.list(req.adminUser, req.params.id, String(from || ''), String(to || '')));
});

router.put('/admin/users/:id/schedule/:date', requirePermission('schedule.manage'), (req, res) =>
  send(res, service.setDay(req.adminUser, req.params.id, req.params.date, req.body || {}, { ip: req.ip })));

router.delete('/admin/users/:id/schedule/:date', requirePermission('schedule.manage'), (req, res) =>
  send(res, service.clearDay(req.adminUser, req.params.id, req.params.date, { ip: req.ip })));

router.post('/admin/schedule/bulk', requirePermission('schedule.manage'), (req, res) =>
  send(res, service.bulk(req.adminUser, req.body || {}, { ip: req.ip })));

module.exports = router;

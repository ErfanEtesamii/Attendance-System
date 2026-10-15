// E1 (فاز ۱۲): تسک فوری — مدیر/سرپرست کار فوری به کارمند می‌دهد؛ در برنامه‌ی همان روزِ او با علامت «تسک فوری» می‌آید.
//   POST   /admin/users/:id/urgent-tasks  { title, description?, date, deadlineTime?, note? }   tasks.assign_urgent
//          ⇒ ۲۰۱ { task, createdPlan } | { error, code }
//   GET    /admin/urgent-tasks?userId=&from=&to=                                                tasks.assign_urgent
//          ⇒ { items: [{ id, userId, userName, title, description, date, deadlineTime, note, assignedBy, assignedByName, status, rescheduleTo, answered }], total }
//   DELETE /admin/urgent-tasks/:taskId                                                          tasks.assign_urgent
//          ⇒ { ok: true } | ۴۰۹ HAS_ANSWERS (کارمند پاسخ داده) | ۴۰۹ MONTH_CLOSED
// اسکوپ سمت سرور داخل urgentTaskService: admin همه، manager فقط زیردست مستقیم؛ hr/کارمند مجوز ندارند ⇒ ۴۰۳. قفلِ برنامه‌ی هفته‌ی شروع‌شده شامل تسک فوری نمی‌شود.
const express = require('express');
const router = express.Router();

const { requirePermission } = require('../../../middleware/permissions');
const usersRepository = require('../../../repositories/usersRepository');
const urgentTaskService = require('../../../services/urgentTaskService');
const { scopedUserIds, DATE_RE } = require('./common');

const isId = (v) => /^\d+$/.test(String(v));
const bad = (res, code, error) => res.status(400).json({ error, code });
const send = (res, r) => res.status(r.status || 400).json({ error: r.error, code: r.code });

router.post('/admin/users/:id/urgent-tasks', requirePermission('tasks.assign_urgent'), (req, res) => {
  if (!isId(req.params.id)) return bad(res, 'INVALID_ID', 'شناسه‌ی کارمند نامعتبر است.');
  const target = usersRepository.findById(Number(req.params.id));
  const r = urgentTaskService.assign(req.adminUser, target, req.body || {}, { ip: req.ip, source: 'admin_panel' });
  if (!r.ok) return send(res, r);
  res.status(201).json({ task: r.task, createdPlan: r.createdPlan });
});

router.get('/admin/urgent-tasks', requirePermission('tasks.assign_urgent'), (req, res) => {
  const q = req.query;
  let userId = null;
  if (q.userId !== undefined && q.userId !== '') {
    if (!isId(q.userId)) return bad(res, 'INVALID_ID', 'userId نامعتبر است.');
    userId = Number(q.userId);
  }
  for (const k of ['from', 'to']) {
    if (q[k] !== undefined && q[k] !== '' && !DATE_RE.test(String(q[k]))) return bad(res, 'INVALID_DATE', `${k} نامعتبر است (YYYY-MM-DD).`);
  }
  const items = urgentTaskService.list({ userIds: scopedUserIds(req.adminUser), userId, from: q.from || null, to: q.to || null });
  res.json({ items, total: items.length });
});

router.delete('/admin/urgent-tasks/:taskId', requirePermission('tasks.assign_urgent'), (req, res) => {
  if (!isId(req.params.taskId)) return bad(res, 'INVALID_ID', 'شناسه‌ی تسک نامعتبر است.');
  const r = urgentTaskService.remove(req.adminUser, Number(req.params.taskId), { ip: req.ip, source: 'admin_panel' });
  if (!r.ok) return send(res, r);
  res.json({ ok: true });
});

module.exports = router;

// اعلان‌های درون‌پنلی «خود کاربر» (S4-5b). جدول و سرویس: S4-5a.
//
// ⚠️ اسکوپ سمت سرور: همه‌ی routeها فقط با req.adminUser.id کار می‌کنند و هیچ پارامتر/فیلد «userId» نمی‌پذیرند؛
// پس کارمند/سرپرست/hr/ادمین فقط اعلان‌های خودشان را می‌بینند و علامت می‌زنند. اعلانِ دیگران یا ناموجود ⇒ ۴۰۴ یکسان (وجودش فاش نمی‌شود).
// علامت خوانده‌شدن در audit ثبت نمی‌شود (تغییر وضعیت شخصی است، نه تغییر داده‌ی مدیریتی). فقط API؛ UI زنگوله در S4-6a.

const express = require('express');
const router = express.Router();

const notificationsRepository = require('../../../repositories/notificationsRepository');
const { requirePermission } = require('../../../middleware/permissions');

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 30;

function toView(n) {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    link: n.link,
    data: n.data,
    isRead: n.read_at !== null,
    readAt: n.read_at,
    createdAt: n.created_at,
  };
}

// پارامتر query باید یک مقدار متنی باشد (?a=1&a=2 یا a[x]=1 ⇒ آرایه/آبجکت ⇒ نامعتبر)
function single(query, key) {
  const v = query[key];
  if (v === undefined) return undefined;
  return typeof v === 'string' ? v : null;
}

// GET /admin/notifications?unread=1&limit=30&before=<id> — جدیدترین اول؛ nextBefore فقط وقتی صفحه‌ی بعدی ممکن است
router.get('/admin/notifications', requirePermission('notifications.read'), (req, res) => {
  const unreadRaw = single(req.query, 'unread');
  const limitRaw = single(req.query, 'limit');
  const beforeRaw = single(req.query, 'before');

  let unreadOnly = false;
  if (unreadRaw !== undefined) {
    if (['1', 'true'].includes(unreadRaw)) unreadOnly = true;
    else if (!['0', 'false'].includes(unreadRaw)) return res.status(400).json({ error: 'unread باید ۰ یا ۱ باشد.' });
  }
  let limit = DEFAULT_LIMIT;
  if (limitRaw !== undefined) {
    if (limitRaw === null || !/^\d+$/.test(limitRaw) || Number(limitRaw) < 1 || Number(limitRaw) > MAX_LIMIT) {
      return res.status(400).json({ error: `limit باید عدد صحیح بین ۱ تا ${MAX_LIMIT} باشد.` });
    }
    limit = Number(limitRaw);
  }
  let beforeId = null;
  if (beforeRaw !== undefined) {
    if (beforeRaw === null || !/^\d+$/.test(beforeRaw) || Number(beforeRaw) < 1) {
      return res.status(400).json({ error: 'before باید شناسه‌ی عددی مثبت باشد.' });
    }
    beforeId = Number(beforeRaw);
  }

  const rows = notificationsRepository.listForUser(req.adminUser.id, { unreadOnly, limit, beforeId });
  res.json({
    items: rows.map(toView),
    nextBefore: rows.length === limit ? rows[rows.length - 1].id : null,
  });
});

// GET /admin/notifications/unread-count — برای polling زنگوله
router.get('/admin/notifications/unread-count', requirePermission('notifications.read'), (req, res) => {
  res.json({ unread: notificationsRepository.countUnread(req.adminUser.id) });
});

// POST /admin/notifications/read-all — همه‌ی اعلان‌های خوانده‌نشده‌ی خودِ کاربر
router.post('/admin/notifications/read-all', requirePermission('notifications.mark'), (req, res) => {
  const updated = notificationsRepository.markAllRead(req.adminUser.id);
  res.json({ ok: true, updated, unread: 0 });
});

// POST /admin/notifications/:id/read — idempotent
router.post('/admin/notifications/:id/read', requirePermission('notifications.mark'), (req, res) => {
  if (!/^\d+$/.test(req.params.id) || Number(req.params.id) < 1) return res.status(400).json({ error: 'شناسه‌ی اعلان نامعتبر است.' });
  const n = notificationsRepository.markRead(req.adminUser.id, Number(req.params.id));
  if (!n) return res.status(404).json({ error: 'اعلان پیدا نشد.' });
  res.json({ ok: true, notification: toView(n), unread: notificationsRepository.countUnread(req.adminUser.id) });
});

module.exports = router;

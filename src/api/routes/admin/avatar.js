// عکس پروفایل در پنل مدیریتی (کوکی نشست؛ <img src> مستقیم).
//   GET    /admin/avatars          فهرست کاربران دارای عکس (اسکوپ پرسنده)
//   GET    /admin/avatar/:userId   عکس خودِ کاربر، یا کاربری که در اسکوپ او هست (canAccessUser)؛ بدون عکس ⇒ 404
//   POST   /admin/avatar           بدنه = خودِ تصویر (Content-Type = نوع تصویر)؛ فقط برای «خودِ» کاربر
//   DELETE /admin/avatar           حذف عکس خود
const express = require('express');
const router = express.Router();
const { canAccessUser, scopedUserIds } = require('./common');
const { getDb } = require('../../../db/connection');
const avatarService = require('../../../services/avatarService');
const auditRepository = require('../../../repositories/auditRepository');

// فهرست کاربرانِ دارای عکس (فقط در اسکوپ پرسنده) ⇒ { versions: { [userId]: نسخه } }؛ کلاینت فقط برای همین‌ها عکس می‌خواهد
router.get('/admin/avatars', (req, res) => {
  const ids = scopedUserIds(req.adminUser);
  const versions = {};
  for (const r of getDb().prepare('SELECT user_id, file_id FROM user_avatars').all()) {
    if (r.user_id === req.adminUser.id || ids === null || ids.includes(r.user_id)) versions[r.user_id] = r.file_id;
  }
  res.set('Cache-Control', 'private, no-store');
  res.json({ versions });
});

router.get('/admin/avatar/:userId', (req, res) => {
  if (!/^\d+$/.test(req.params.userId)) return res.status(404).json({ error: 'عکسی ثبت نشده است.' });
  const id = parseInt(req.params.userId, 10);
  if (id !== req.adminUser.id && !canAccessUser(req.adminUser, id)) return res.status(404).json({ error: 'عکسی ثبت نشده است.' });
  return avatarService.send(res, id);
});

router.post('/admin/avatar', async (req, res, next) => {
  try {
    const mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const size = parseInt(req.headers['content-length'], 10);
    const r = await avatarService.save(req.adminUser.id, req, { mime, size: Number.isFinite(size) ? size : undefined });
    if (!r.ok) return res.status(400).json({ error: r.error, code: r.code });
    auditRepository.logEvent({ userId: req.adminUser.id, action: 'avatar_updated', ipAddress: req.ip, details: { source: 'admin_panel', size: r.avatar.size } });
    return res.status(201).json({ ok: true, version: r.avatar.file_id });
  } catch (err) { return next(err); }
});

router.delete('/admin/avatar', async (req, res, next) => {
  try {
    const r = await avatarService.remove(req.adminUser.id);
    if (r.removed) auditRepository.logEvent({ userId: req.adminUser.id, action: 'avatar_removed', ipAddress: req.ip, details: { source: 'admin_panel' } });
    return res.json({ ok: true });
  } catch (err) { return next(err); }
});

module.exports = router;

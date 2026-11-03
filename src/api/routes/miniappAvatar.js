// عکس پروفایل در Mini App (احراز هویت با initData؛ پاسخ data URL چون CSP تصویر blob را نمی‌پذیرد).
// این فایل با «router.use(require('./miniappAvatar'))» داخل miniapp.js ثبت می‌شود (پس از میان‌افزار احراز Mini App).
const express = require('express');
const router = express.Router();
const avatarService = require('../../services/avatarService');
const auditRepository = require('../../repositories/auditRepository');

router.get('/miniapp/avatar', (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  res.json({ dataUrl: avatarService.dataUrl(req.miniAppUser.id) });
});

// بدنه = خودِ تصویر (Content-Type = image/jpeg|png|webp)
router.post('/miniapp/avatar', async (req, res, next) => {
  try {
    const mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const size = parseInt(req.headers['content-length'], 10);
    const r = await avatarService.save(req.miniAppUser.id, req, { mime, size: Number.isFinite(size) ? size : undefined });
    if (!r.ok) return res.status(400).json({ error: r.error, code: r.code });
    auditRepository.logEvent({ userId: req.miniAppUser.id, action: 'avatar_updated', ipAddress: req.ip, details: { source: 'miniapp', size: r.avatar.size } });
    return res.status(201).json({ ok: true, dataUrl: avatarService.dataUrl(req.miniAppUser.id) });
  } catch (err) { return next(err); }
});

router.delete('/miniapp/avatar', async (req, res, next) => {
  try {
    const r = await avatarService.remove(req.miniAppUser.id);
    if (r.removed) auditRepository.logEvent({ userId: req.miniAppUser.id, action: 'avatar_removed', ipAddress: req.ip, details: { source: 'miniapp' } });
    return res.json({ ok: true });
  } catch (err) { return next(err); }
});

module.exports = router;

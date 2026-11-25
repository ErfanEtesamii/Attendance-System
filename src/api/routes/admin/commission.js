// پورسانت فروش (دیدار). هویت فقط از نشست؛ مبلغ لیدربرد فقط برای خودِ شخص (یا admin/owner).
//   GET  /admin/me/commission?year=&month=       me.read   — پورسانت و معامله‌های موفقِ خودم
//   GET  /admin/sales-team/leaderboard           me.read   — رتبه‌ها (تعداد/مبلغ فاکتور)، مبلغ دیگران حذف‌شده
//   POST /admin/commission/sync                  users.write — همگام‌سازی دستی با دیدار
//   GET/PUT /admin/users/:id/didar-email            users.write — ایمیل دیدارِ کارمند (نگاشت مسئول معامله)
const express = require('express');
const { requirePermission } = require('../../../middleware/permissions');
const service = require('../../../services/commissionService');
const { getDb } = require('../../../db/connection');

const router = express.Router();
const intOrUndef = (v) => { const n = Number(v); return Number.isInteger(n) ? n : undefined; };
const qOf = (req) => ({ jy: intOrUndef(req.query.year), jm: intOrUndef(req.query.month), from: String(req.query.from || ''), to: String(req.query.to || '') });

router.get('/admin/me/commission', requirePermission('me.read'), (req, res) => {
  service.syncIfStale();
  const row = getDb().prepare('SELECT didar_email FROM users WHERE id = ?').get(req.adminUser.id);
  // «کل زمان»ِ پورسانتِ خودش برای کارمند بسته است (کف: ابتدای فصل جاری یا ماه قبل)؛ ادمین/مالک بدون کف
  const floor = service.canViewTeam(req.adminUser) ? null : service.floorFor(false); // ادمین/مالک/سرپرستِ فروش بدون کف
  const commission = service.myCommission({ ...req.adminUser, didar_email: row && row.didar_email }, qOf(req), { floor });
  return res.json({ commission, canViewTeam: service.canViewTeam(req.adminUser) });
});

const NOT_SALES = { error: 'این بخش مخصوص تیم فروش است.', code: 'NOT_SALES_TEAM' };
router.get('/admin/sales-team/leaderboard', requirePermission('me.read'), (req, res) => {
  if (!service.hasSalesAccess(req.adminUser)) return res.status(403).json(NOT_SALES);
  service.syncIfStale();
  return res.json({ leaderboard: service.leaderboard(req.adminUser, qOf(req)) });
});

// کارت پورسانتِ اعضا برای ادمین/مالک (همه) و سرپرست (زیرمجموعه‌ی مستقیم)؛ دسترسی در سرویس اعمال می‌شود
router.get('/admin/sales-team/members', requirePermission('me.read'), (req, res) => {
  service.syncIfStale();
  return res.json(service.membersSummary(req.adminUser, qOf(req)));
});
router.get('/admin/sales-team/members/:id', requirePermission('me.read'), (req, res) => {
  const r = service.memberCommission(req.adminUser, req.params.id, qOf(req));
  if (!r) return res.status(404).json({ error: 'این همکار پیدا نشد یا اجازه‌ی دیدنش را ندارید.', code: 'NOT_FOUND' });
  return res.json(r);
});

router.post('/admin/commission/sync', requirePermission('users.write'), async (req, res) => {
  const r = await service.sync();
  return res.status(r.ok ? 200 : 502).json(r.ok ? { ok: true, count: r.count } : { error: r.error, code: r.code });
});

router.get('/admin/users/:id/didar-email', requirePermission('users.write'), (req, res) => {
  const r = getDb().prepare('SELECT didar_email FROM users WHERE id = ?').get(Number(req.params.id));
  if (!r) return res.status(404).json({ error: 'کاربر پیدا نشد.', code: 'NOT_FOUND' });
  return res.json({ email: r.didar_email || '' });
});

router.put('/admin/users/:id/didar-email', requirePermission('users.write'), (req, res) => {
  const email = String((req.body && req.body.email) || '').trim().toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'ایمیل نامعتبر است.', code: 'INVALID_EMAIL' });
  const r = getDb().prepare('UPDATE users SET didar_email = ? WHERE id = ?').run(email || null, Number(req.params.id));
  if (!r.changes) return res.status(404).json({ error: 'کاربر پیدا نشد.', code: 'NOT_FOUND' });
  return res.json({ ok: true });
});

module.exports = router;

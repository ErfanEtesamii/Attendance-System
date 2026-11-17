// فاز C (مرحله ۴): مدیریت سرپرست‌ها و تیم‌ها — فقط admin/owner (مجوز supervisors.manage).
//   GET  /admin/supervisors            فهرست سرپرست‌ها + کارمندان بدون سرپرست
//   GET  /admin/supervisors/:id        اعضای تیم یک سرپرست
//   POST /admin/supervisors/:id/members   افزودن اعضا (set manager_id)
//   POST /admin/supervisors/:id/transfer  انتقال گروهی تیم (toSupervisorId=null ⇒ بدون سرپرست)
// هر دو POST با body.dryRun=true فقط «پیش‌نمایش» می‌دهند (بدون نوشتن و بدون نیاز به دلیل).
// نوشتن واقعی: دلیل اجباری (جز owner)، تراکنش، auditChange (entityType='supervisor') و بازسازی تسک واجب سرپرست‌ها.
// تغییر نقش/فعال‌بودن سرپرست از همان PATCH /admin/users/:id انجام می‌شود (این فایل به آن دست نمی‌زند).
// فاز D (بخش ۱) — استثنا برای هر سرپرست (فقط role=manager؛ اولویت: استثنا > تنظیم سراسری):
//   GET    /admin/supervisors/:id/overrides        کلیدهای مجاز + مقدار سراسری/استثنا/مؤثر
//   PUT    /admin/supervisors/:id/overrides/:key   body: { value, reason } (دلیل اجباری جز owner)
//   DELETE /admin/supervisors/:id/overrides/:key   body|query: { reason } ⇒ برگشت به تنظیم سراسری
// فاز D (بخش ۲) — جانشین سرپرست (فقط role=manager؛ جانشین هم manager فعال):
//   GET /admin/supervisors/:id/deputy   جانشین فعلی + وضعیت «در حال جانشینی» + گزینه‌های ممکن
//   PUT /admin/supervisors/:id/deputy   body: { deputyId|null, reason } (null ⇒ حذف جانشین؛ دلیل اجباری جز owner)

const express = require('express');
const router = express.Router();

const { requirePermission, hasPermission } = require('../../../middleware/permissions');
const { getDb } = require('../../../db/connection');
const usersRepository = require('../../../repositories/usersRepository');
const teamReviewService = require('../../../services/teamReviewService');
const recordEditQuota = require('../../../services/recordEditQuotaService');
const { sanitizeText } = require('../../../utils/sanitize');
const { supervisorView, supervisorOverrideView, supervisorDeputyView } = require('../../../utils/auditViews');
const deputyService = require('../../../services/supervisorDeputyService');
const overridesRepository = require('../../../repositories/supervisorOverridesRepository');
const settingsRepository = require('../../../repositories/settingsRepository');
const { SUPERVISOR_OVERRIDE_DEFS, isKey, validateOverride } = require('../../../utils/supervisorOverrideKeys');
const { auditChange, requireReason } = require('./common');

const SUPERVISOR_ROLES = ['manager', 'admin', 'owner'];
const MAX_BATCH = 500;

function refreshReviewers(ids) {
  try { teamReviewService.refreshReviewersOf(ids); } catch (err) { console.error('[supervisors] بازسازی تسک واجب ناموفق (نادیده گرفته شد):', sanitizeText(err && err.message, 200)); }
}

// ---------- شمارش‌ها (یک کوئری برای همه‌ی سرپرست‌ها) ----------

function teamCounts() {
  const rows = getDb().prepare(
    `SELECT manager_id AS id, COUNT(*) AS total, SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active
       FROM users WHERE manager_id IS NOT NULL AND role <> 'owner' GROUP BY manager_id`
  ).all();
  return new Map(rows.map((r) => [r.id, { total: r.total, active: r.active || 0 }]));
}

// درخواست‌های مرخصی/ماموریتِ pending کارمندانِ هر سرپرست (از manager_id «زنده»)
function pendingCounts() {
  const rows = getDb().prepare(
    `SELECT u.manager_id AS id, COUNT(*) AS n FROM leave_requests lr JOIN users u ON u.id = lr.user_id
      WHERE lr.status = 'pending' AND u.manager_id IS NOT NULL GROUP BY u.manager_id`
  ).all();
  return new Map(rows.map((r) => [r.id, r.n]));
}

function pendingOfUsers(userIds) {
  if (!userIds.length) return 0;
  const marks = userIds.map(() => '?').join(',');
  return getDb().prepare(`SELECT COUNT(*) AS n FROM leave_requests WHERE status = 'pending' AND user_id IN (${marks})`).get(...userIds).n;
}

function lastLogins() {
  const rows = getDb().prepare("SELECT user_id AS id, MAX(occurred_at) AS at FROM audit_log WHERE action = 'admin_panel_login' AND user_id IS NOT NULL GROUP BY user_id").all();
  return new Map(rows.map((r) => [r.id, r.at]));
}

function reviewOf(user) {
  try {
    const r = teamReviewService.getTeamReview(user);
    if (!r || !r.ok || !r.applicable) return { applicable: false, viewed: null, reviewDate: r && r.reviewDate ? r.reviewDate : null };
    return { applicable: true, viewed: !!r.complete, reviewDate: r.reviewDate, unreviewed: r.unreviewed.length, reportCount: r.reportCount };
  } catch (_) {
    return { applicable: false, viewed: null, reviewDate: null };
  }
}

function recordEditOf(user) {
  try {
    if (!user || user.role !== 'manager') return null;
    const u = recordEditQuota.getUsage(user);
    if (!u || u.exempt) return null;
    return { used: u.used, limit: u.limit, unlimited: !!u.unlimited };
  } catch (_) { return null; }
}

function brief(u) {
  return { id: u.id, fullName: u.full_name, personnelCode: u.personnel_code || null, department: u.department || null, role: u.role, isActive: !!u.is_active, managerId: u.manager_id || null };
}

// جانشین ثبت‌شده‌ی یک سرپرست برای نمایش: { id, fullName, isActive, covering } یا null (covering = همین الان جایگزین است)
function deputyBrief(u) {
  if (!u || u.role !== 'manager' || !u.deputy_id) return null;
  const d = usersRepository.findById(u.deputy_id);
  if (!d) return null;
  const active = deputyService.activeDeputyOf(u);
  return { id: d.id, fullName: d.full_name, isActive: !!d.is_active, covering: !!active };
}

// ---------- اعتبارسنجی ----------

const parseId = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };

// سرپرستِ هدف: باید فعال و manager/admin/owner باشد (همان قاعده‌ی فرم کارمند/addEmployee)
function checkSupervisorTarget(target) {
  if (!target) return { status: 404, error: 'سرپرست یافت نشد.' };
  if (!SUPERVISOR_ROLES.includes(target.role)) return { status: 400, error: 'سرپرست باید نقش سرپرست، ادمین یا مالک داشته باشد.' };
  if (!target.is_active) return { status: 400, error: 'سرپرست غیرفعال نمی‌تواند تیم بگیرد.' };
  return null;
}

// آیا X در زنجیره‌ی سرپرستیِ S (S، سرپرستِ S، …) هست؟ ⇒ انتساب X زیر S حلقه می‌سازد
function createsLoop(supervisorId, memberId) {
  const seen = new Set();
  let cur = supervisorId;
  while (cur && !seen.has(cur)) {
    if (cur === memberId) return true;
    seen.add(cur);
    const u = usersRepository.findById(cur);
    cur = u ? u.manager_id : null;
  }
  return false;
}

// ⇒ { error:{status,error} } یا { members:[user] }
function resolveMembers(req, supervisor, ids) {
  if (!Array.isArray(ids) || !ids.length) return { error: { status: 400, error: 'حداقل یک کارمند انتخاب کنید.' } };
  if (ids.length > MAX_BATCH) return { error: { status: 400, error: `در هر بار حداکثر ${MAX_BATCH} نفر.` } };
  const uniq = [...new Set(ids.map(parseId))];
  if (uniq.includes(null)) return { error: { status: 400, error: 'شناسه‌ی کارمند نامعتبر است.' } };
  const members = [];
  for (const id of uniq) {
    const u = usersRepository.findById(id);
    if (!u) return { error: { status: 404, error: `کارمند ${id} یافت نشد.` } };
    if (u.role === 'owner') return { error: { status: 400, error: 'مالک (owner) عضو تیم نمی‌شود.' } };
    if (supervisor && u.id === supervisor.id) return { error: { status: 400, error: 'سرپرست نمی‌تواند عضو تیم خودش باشد.' } };
    if (supervisor && createsLoop(supervisor.id, u.id)) return { error: { status: 400, error: `«${u.full_name}» سرپرستِ بالادستِ این سرپرست است؛ حلقه‌ی سرپرستی مجاز نیست.` } };
    // جابه‌جایی ادمین مثل PATCH /admin/users/:id فقط با admins.manage (owner)
    if (u.role === 'admin' && !hasPermission(req.adminUser.role, 'admins.manage')) return { error: { status: 403, error: 'جابه‌جایی ادمین فقط برای owner مجاز است.' } };
    members.push(u);
  }
  return { members };
}

function previewOf({ members, from, to }) {
  const ids = members.map((m) => m.id);
  const unchanged = members.filter((m) => (m.manager_id || null) === (to ? to.id : null));
  return {
    dryRun: true,
    from: from ? brief(from) : null,
    to: to ? brief(to) : null,
    count: members.length,
    unchangedCount: unchanged.length,
    members: members.map((m) => ({ ...brief(m), fromSupervisor: m.manager_id ? (usersRepository.findById(m.manager_id) || {}).full_name || null : null })),
    pendingRequests: pendingOfUsers(ids),
    note: 'درخواست‌های در انتظار این کارمندان خودکار به سرپرست جدید می‌روند (تأییدکننده از manager_id زنده محاسبه می‌شود).',
  };
}

// اعمال یک جابه‌جایی گروهی در یک تراکنش + ممیزی + بازسازی تسک واجب
function applyMove(req, { members, to, fromHint, reason, action }) {
  const db = getDb();
  const oldManagers = new Set();
  const moved = [];
  db.transaction(() => {
    for (const m of members) {
      const oldId = m.manager_id || null;
      const newId = to ? to.id : null;
      if (oldId === newId) continue;
      usersRepository.updateUser(m.id, { manager_id: newId });
      if (oldId) oldManagers.add(oldId);
      moved.push(m.id);
      auditChange(req, {
        action,
        entityType: 'supervisor',
        entityId: newId || oldId || fromHint || null,
        before: supervisorView({ manager_id: oldId }),
        after: supervisorView({ manager_id: newId }),
        reason: reason || null,
        meta: { targetUserId: m.id, fromSupervisorId: oldId, toSupervisorId: newId, batchSize: members.length },
      });
    }
  })();
  refreshReviewers([...(to ? [to.id] : []), ...oldManagers, ...moved]);
  return moved;
}

// ---------- GET /admin/supervisors ----------

router.get('/admin/supervisors', requirePermission('supervisors.manage'), (req, res) => {
  const counts = teamCounts();
  const pending = pendingCounts();
  const logins = lastLogins();
  const all = usersRepository.listUsers({});
  const list = all
    .filter((u) => u.role === 'manager' || (counts.get(u.id) && counts.get(u.id).total > 0))
    .map((u) => {
      const c = counts.get(u.id) || { total: 0, active: 0 };
      return {
        ...brief(u),
        label: u.role === 'manager' ? 'سرپرست' : (u.role === 'admin' ? 'ادمین دارای تیم' : null),
        activeMembers: c.active,
        totalMembers: c.total,
        pendingRequests: pending.get(u.id) || 0,
        review: u.is_active ? reviewOf(u) : { applicable: false, viewed: null, reviewDate: null },
        recordEdit: recordEditOf(u),
        deputy: deputyBrief(u),
        lastLoginAt: logins.get(u.id) || null,
      };
    });
  const unassigned = all.filter((u) => !u.manager_id && u.role !== 'owner' && u.is_active && !SUPERVISOR_ROLES.includes(u.role)).map(brief);
  res.json({ supervisors: list, unassigned: { count: unassigned.length, users: unassigned.slice(0, 200) } });
});

// ---------- GET /admin/supervisors/:id ----------

router.get('/admin/supervisors/:id', requirePermission('supervisors.manage'), (req, res) => {
  const id = parseId(req.params.id);
  const sup = id ? usersRepository.findById(id) : null;
  if (!sup) return res.status(404).json({ error: 'سرپرست یافت نشد.' });
  const team = usersRepository.listUsers({ managerId: sup.id });
  const pend = new Map(getDb().prepare(
    "SELECT user_id AS id, COUNT(*) AS n FROM leave_requests WHERE status = 'pending' GROUP BY user_id"
  ).all().map((r) => [r.id, r.n]));
  res.json({
    supervisor: brief(sup),
    members: team.map((m) => ({ ...brief(m), pendingRequests: pend.get(m.id) || 0 })),
    pendingRequests: team.reduce((s, m) => s + (pend.get(m.id) || 0), 0),
  });
});

// ---------- POST /admin/supervisors/:id/members ----------

router.post('/admin/supervisors/:id/members', requirePermission('supervisors.manage'), (req, res) => {
  const id = parseId(req.params.id);
  const sup = id ? usersRepository.findById(id) : null;
  const bad = checkSupervisorTarget(sup);
  if (bad) return res.status(bad.status).json({ error: bad.error });
  const body = req.body || {};
  const r = resolveMembers(req, sup, body.userIds);
  if (r.error) return res.status(r.error.status).json({ error: r.error.error });
  if (body.dryRun === true) return res.json(previewOf({ members: r.members, from: null, to: sup }));
  const reason = requireReason(req, res);
  if (reason === null) return undefined;
  const moved = applyMove(req, { members: r.members, to: sup, reason: sanitizeText(reason, 500), action: 'supervisor_members_added' });
  return res.json({ ok: true, moved: moved.length, unchanged: r.members.length - moved.length, supervisorId: sup.id });
});

// ---------- POST /admin/supervisors/:id/transfer ----------

router.post('/admin/supervisors/:id/transfer', requirePermission('supervisors.manage'), (req, res) => {
  const fromId = parseId(req.params.id);
  const from = fromId ? usersRepository.findById(fromId) : null;
  if (!from) return res.status(404).json({ error: 'سرپرست مبدأ یافت نشد.' });
  const body = req.body || {};
  const rawTo = body.toSupervisorId;
  let to = null;
  if (rawTo !== null && rawTo !== undefined && rawTo !== '') {
    const toId = parseId(rawTo);
    to = toId ? usersRepository.findById(toId) : null;
    const bad = checkSupervisorTarget(to);
    if (bad) return res.status(bad.status).json({ error: bad.error });
    if (to.id === from.id) return res.status(400).json({ error: 'سرپرست مقصد همان مبدأ است.' });
  } else if (rawTo === undefined) {
    return res.status(400).json({ error: 'سرپرست مقصد را مشخص کنید (null ⇒ بدون سرپرست).' });
  }
  const team = usersRepository.listUsers({ managerId: from.id });
  let ids;
  if (body.all === true) ids = team.map((m) => m.id);
  else {
    if (!Array.isArray(body.userIds)) return res.status(400).json({ error: 'userIds یا all:true لازم است.' });
    const inTeam = new Set(team.map((m) => m.id));
    ids = body.userIds.map(parseId);
    if (ids.includes(null) || ids.some((x) => !inTeam.has(x))) return res.status(400).json({ error: 'همه‌ی کارمندان انتخابی باید عضو تیم فعلیِ سرپرست مبدأ باشند.' });
  }
  const r = resolveMembers(req, to, ids);
  if (r.error) return res.status(r.error.status).json({ error: r.error.error });
  if (body.dryRun === true) return res.json(previewOf({ members: r.members, from, to }));
  const reason = requireReason(req, res);
  if (reason === null) return undefined;
  const moved = applyMove(req, { members: r.members, to, fromHint: from.id, reason: sanitizeText(reason, 500), action: 'supervisor_team_transferred' });
  return res.json({ ok: true, moved: moved.length, fromSupervisorId: from.id, toSupervisorId: to ? to.id : null });
});

// ---------- استثنا برای هر سرپرست (فاز D، بخش ۱) ----------

// هدف باید کاربرِ role=manager باشد (غیرفعال هم مجاز است تا قبل از فعال‌سازی قابل تنظیم باشد)
function overrideTarget(req, res) {
  const id = parseId(req.params.id);
  const sup = id ? usersRepository.findById(id) : null;
  if (!sup) { res.status(404).json({ error: 'سرپرست یافت نشد.' }); return null; }
  if (sup.role !== 'manager') { res.status(400).json({ error: 'استثنا فقط برای کاربرانِ با نقش سرپرست تعریف می‌شود.' }); return null; }
  return sup;
}

function globalValueOf(key) {
  try { return settingsRepository.getAll()[key]; } catch (_) { return undefined; }
}

router.get('/admin/supervisors/:id/overrides', requirePermission('supervisors.manage'), (req, res) => {
  const sup = overrideTarget(req, res);
  if (!sup) return undefined;
  const current = overridesRepository.listByUser(sup.id);
  const items = Object.keys(SUPERVISOR_OVERRIDE_DEFS).map((key) => {
    const def = SUPERVISOR_OVERRIDE_DEFS[key];
    const has = Object.prototype.hasOwnProperty.call(current, key) && validateOverride(key, current[key]).ok;
    const global = globalValueOf(key);
    return { key, label: def.label, type: def.type, min: def.min ?? null, max: def.max ?? null, global: global === undefined ? null : global, override: has ? current[key] : null, hasOverride: has, effective: has ? current[key] : (global === undefined ? null : global) };
  });
  return res.json({ supervisor: brief(sup), items });
});

router.put('/admin/supervisors/:id/overrides/:key', requirePermission('supervisors.manage'), (req, res) => {
  const sup = overrideTarget(req, res);
  if (!sup) return undefined;
  const key = req.params.key;
  if (!isKey(key)) return res.status(400).json({ error: 'کلید استثنا نامعتبر است.' });
  const v = validateOverride(key, (req.body || {}).value);
  if (!v.ok) return res.status(400).json({ error: v.error });
  const reason = requireReason(req, res);
  if (reason === null) return undefined;
  const before = overridesRepository.get(sup.id, key);
  if (before === v.value) return res.json({ ok: true, key, value: v.value, changed: false });
  getDb().transaction(() => {
    overridesRepository.set(sup.id, key, v.value);
    auditChange(req, {
      action: 'supervisor_override_set',
      entityType: 'supervisor_override',
      entityId: sup.id,
      before: before === undefined ? null : supervisorOverrideView({ value: before }),
      after: supervisorOverrideView({ value: v.value }),
      reason: sanitizeText(reason, 500) || null,
      meta: { targetUserId: sup.id, key },
    });
  })();
  return res.json({ ok: true, key, value: v.value, changed: true });
});

router.delete('/admin/supervisors/:id/overrides/:key', requirePermission('supervisors.manage'), (req, res) => {
  const sup = overrideTarget(req, res);
  if (!sup) return undefined;
  const key = req.params.key;
  if (!isKey(key)) return res.status(400).json({ error: 'کلید استثنا نامعتبر است.' });
  const reason = requireReason(req, res);
  if (reason === null) return undefined;
  const before = overridesRepository.get(sup.id, key);
  if (before === undefined) return res.json({ ok: true, key, removed: false });
  getDb().transaction(() => {
    overridesRepository.remove(sup.id, key);
    auditChange(req, {
      action: 'supervisor_override_cleared',
      entityType: 'supervisor_override',
      entityId: sup.id,
      before: supervisorOverrideView({ value: before }),
      after: null,
      reason: sanitizeText(reason, 500) || null,
      meta: { targetUserId: sup.id, key },
    });
  })();
  return res.json({ ok: true, key, removed: true });
});

// ---------- جانشین سرپرست (فاز D، بخش ۲) ----------

router.get('/admin/supervisors/:id/deputy', requirePermission('supervisors.manage'), (req, res) => {
  const sup = overrideTarget(req, res);
  if (!sup) return undefined;
  const candidates = usersRepository.listUsers({ onlyActive: true }).filter((u) => u.role === 'manager' && u.id !== sup.id).map(brief);
  return res.json({ supervisor: brief(sup), deputy: deputyBrief(sup), absent: deputyService.isAbsent(sup), candidates });
});

router.put('/admin/supervisors/:id/deputy', requirePermission('supervisors.manage'), (req, res) => {
  const sup = overrideTarget(req, res);
  if (!sup) return undefined;
  const raw = (req.body || {}).deputyId;
  const clearing = raw === null;
  let deputy = null;
  if (!clearing) {
    const did = parseId(raw);
    if (!did) return res.status(400).json({ error: 'شناسه‌ی جانشین نامعتبر است.' });
    deputy = usersRepository.findById(did);
    const bad = deputyService.validateDeputy(sup, deputy);
    if (bad) return res.status(deputy ? 400 : 404).json({ error: bad });
  }
  const reason = requireReason(req, res);
  if (reason === null) return undefined;
  const beforeId = sup.deputy_id || null;
  const afterId = deputy ? deputy.id : null;
  if (beforeId === afterId) return res.json({ ok: true, deputyId: afterId, changed: false });
  getDb().transaction(() => {
    usersRepository.updateUser(sup.id, { deputy_id: afterId });
    auditChange(req, {
      action: afterId ? 'supervisor_deputy_set' : 'supervisor_deputy_cleared',
      entityType: 'supervisor_deputy',
      entityId: sup.id,
      before: supervisorDeputyView({ deputy_id: beforeId }),
      after: supervisorDeputyView({ deputy_id: afterId }),
      reason: sanitizeText(reason, 500) || null,
      meta: { targetUserId: sup.id, deputyId: afterId, previousDeputyId: beforeId },
    });
  })();
  return res.json({ ok: true, deputyId: afterId, changed: true });
});

module.exports = router;

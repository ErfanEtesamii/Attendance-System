// فاز C (مرحله ۴): مدیریت سرپرست‌ها و تیم‌ها — فقط admin/owner (مجوز supervisors.manage).
//   GET  /admin/supervisors            فهرست سرپرست‌ها + کارمندان بدون سرپرست
//   GET  /admin/supervisors/:id        اعضای تیم یک سرپرست
//   POST /admin/supervisors/:id/members   افزودن اعضا (set manager_id)
//   POST /admin/supervisors/:id/transfer  انتقال گروهی تیم (toSupervisorId=null ⇒ بدون سرپرست)
// هر دو POST با body.dryRun=true فقط «پیش‌نمایش» می‌دهند (بدون نوشتن و بدون نیاز به دلیل).
// نوشتن واقعی: دلیل اجباری (جز owner)، تراکنش، auditChange (entityType='supervisor') و بازسازی تسک واجب سرپرست‌ها.
// تغییر نقش/فعال‌بودن سرپرست از همان PATCH /admin/users/:id انجام می‌شود (این فایل به آن دست نمی‌زند).

const express = require('express');
const router = express.Router();

const { requirePermission, hasPermission } = require('../../../middleware/permissions');
const { getDb } = require('../../../db/connection');
const usersRepository = require('../../../repositories/usersRepository');
const teamReviewService = require('../../../services/teamReviewService');
const recordEditQuota = require('../../../services/recordEditQuotaService');
const { sanitizeText } = require('../../../utils/sanitize');
const { supervisorView } = require('../../../utils/auditViews');
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

module.exports = router;

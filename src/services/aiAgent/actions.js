// عملیات اجرایی ایجنت — فقط با تأیید صریح انسان. ایجنت فقط «پیشنهاد» ثبت می‌کند (propose)؛ اجرا فقط از confirm() و فقط
// توسط همان ادمین، قبل از انقضا، یک‌بار. منطق اجرا همان منطق پنل است (applyDecision / disputeService) و مجوز و اسکوپ دوباره سنجیده می‌شود.
// ممنوع: حقوق، حذف، هر عملیات مالی. هر اجرا/لغو در audit ثبت می‌شود.
const { getDb } = require('../../db/connection');
const { hasPermission } = require('../../middleware/permissions');
const auditRepository = require('../../repositories/auditRepository');
const leaveRepository = require('../../repositories/leaveRepository');
const disputeRepository = require('../../repositories/disputeRepository');
const disputeService = require('../disputeService');
const notificationEvents = require('../notificationEvents');
const { canAccessUser, auditChange } = require('../../api/routes/admin/common');
const { disputeView } = require('../../utils/auditViews');

const TTL_MIN = 15;
const KINDS = {
  leave_decision: { perm: 'leave.approve', label: 'تصمیم مرخصی' },
  dispute_reply: { perm: 'disputes.resolve', label: 'پاسخ به اعتراض' },
  dispute_resolve: { perm: 'disputes.resolve', label: 'بستن اعتراض' },
};
const clean = (s, n) => String(s == null ? '' : s).trim().slice(0, n);

class ActionError extends Error {}

function propose(admin, kind, input) {
  const def = KINDS[kind];
  if (!def) throw new ActionError('نوع عملیات مجاز نیست.');
  if (!hasPermission(admin.role, def.perm)) throw new ActionError('مجوز این عملیات را ندارید.');
  let payload; let summary;
  if (kind === 'leave_decision') {
    const id = Number(input.requestId);
    const decision = input.decision;
    if (!Number.isInteger(id) || !['approve', 'reject'].includes(decision)) throw new ActionError('requestId و decision (approve|reject) لازم است.');
    const r = leaveRepository.findById(id);
    if (!r) throw new ActionError('درخواست یافت نشد.');
    if (!canAccessUser(admin, r.user_id)) throw new ActionError('به این کارمند دسترسی ندارید.');
    if (r.status !== 'pending') throw new ActionError('این درخواست قبلاً تصمیم‌گیری شده است.');
    const note = clean(input.note, 500);
    if (decision === 'reject' && !note) throw new ActionError('برای رد درخواست، دلیل (note) لازم است.');
    const who = getDb().prepare('SELECT full_name n FROM users WHERE id=?').get(r.user_id);
    payload = { requestId: id, decision, note };
    summary = `${decision === 'approve' ? '✅ تأیید' : '❌ رد'} درخواست مرخصی #${id} ${who ? who.n : ''} (${r.start_date} تا ${r.end_date})${note ? ` — ${note}` : ''}`;
  } else {
    const id = Number(input.disputeId);
    if (!Number.isInteger(id)) throw new ActionError('disputeId لازم است.');
    const d = disputeRepository.findById(id);
    if (!d) throw new ActionError('اعتراض یافت نشد.');
    if (!canAccessUser(admin, d.user_id)) throw new ActionError('به این کارمند دسترسی ندارید.');
    if (d.status !== 'open') throw new ActionError('این اعتراض بسته است.');
    if (kind === 'dispute_reply') {
      const message = clean(input.message, 500);
      if (!message) throw new ActionError('متن پاسخ لازم است.');
      payload = { disputeId: id, message };
      summary = `💬 پاسخ به اعتراض #${id}: «${message}»`;
    } else {
      if (d.attendance_record_id) throw new ActionError('این اعتراض به یک رکورد تردد وابسته است و ممکن است نیاز به اصلاح رکورد داشته باشد؛ از خود پنل ببندید.');
      const note = clean(input.note, 500);
      payload = { disputeId: id, note };
      summary = `🔒 بستن اعتراض #${id}${note ? ` با پیام «${note}»` : ''}`;
    }
  }
  const ins = getDb().prepare(`INSERT INTO ai_pending_actions(admin_id,kind,payload,summary,expires_at) VALUES (?,?,?,?,datetime('now','+${TTL_MIN} minutes'))`)
    .run(admin.id, kind, JSON.stringify(payload), summary);
  return { id: Number(ins.lastInsertRowid), summary };
}

function load(admin, id) {
  const row = getDb().prepare('SELECT * FROM ai_pending_actions WHERE id=?').get(Number(id));
  if (!row || row.admin_id !== admin.id) throw new ActionError('عملیات یافت نشد.');
  if (row.status !== 'pending') throw new ActionError('این عملیات قبلاً پردازش شده است.');
  if (getDb().prepare("SELECT datetime('now') > ? e").get(row.expires_at).e) {
    getDb().prepare("UPDATE ai_pending_actions SET status='expired', decided_at=datetime('now') WHERE id=?").run(row.id);
    throw new ActionError('مهلت تأیید گذشته است؛ دوباره درخواست دهید.');
  }
  return row;
}

function cancel(admin, id) {
  const row = load(admin, id);
  getDb().prepare("UPDATE ai_pending_actions SET status='cancelled', decided_at=datetime('now') WHERE id=?").run(row.id);
  auditRepository.logEvent({ userId: admin.id, action: 'ai_action_cancelled', details: { actionId: row.id, kind: row.kind } });
  return { ok: true, message: 'لغو شد.' };
}

function confirm(admin, id, { ip = null } = {}) {
  const row = load(admin, id);
  const def = KINDS[row.kind];
  if (!def || !hasPermission(admin.role, def.perm)) throw new ActionError('مجوز این عملیات را ندارید.');
  // رزرو اتمی: دو تأیید هم‌زمان ⇒ فقط یکی اجرا می‌شود
  const claimed = getDb().prepare("UPDATE ai_pending_actions SET status='executed', decided_at=datetime('now') WHERE id=? AND status='pending'").run(row.id);
  if (claimed.changes !== 1) throw new ActionError('این عملیات قبلاً پردازش شده است.');
  const p = JSON.parse(row.payload);
  const req = { adminUser: admin, ip, body: {} };
  let message;
  try {
    if (row.kind === 'leave_decision') {
      const { applyDecision } = require('../../api/routes/admin/leaveDecision');
      const r = applyDecision(req, { requestId: p.requestId, decision: p.decision, note: p.note });
      if (!r.ok) throw new ActionError(r.error || 'اجرا ناموفق بود.');
      message = p.decision === 'approve' ? 'درخواست مرخصی تأیید شد.' : 'درخواست مرخصی رد شد.';
    } else {
      const d = disputeRepository.findById(p.disputeId);
      if (!d || !canAccessUser(admin, d.user_id)) throw new ActionError('اعتراض در دسترس نیست.');
      if (row.kind === 'dispute_reply') {
        const r = disputeService.replyAsAdmin(admin, d.id, { message: p.message });
        if (!r.ok) throw new ActionError(r.error || 'ارسال پاسخ ناموفق بود.');
        auditRepository.logEvent({ userId: admin.id, action: 'dispute_message_sent', ipAddress: ip, details: { source: 'ai_agent', disputeId: d.id, messageId: r.message.id, targetUserId: d.user_id } });
        notificationEvents.disputeAdminMessage(d, r.message, { actor: admin });
        message = 'پاسخ ارسال شد.';
      } else {
        const r = disputeService.resolveAsAdmin(admin, d.id, { note: p.note });
        if (!r.ok) throw new ActionError(r.error || 'بستن اعتراض ناموفق بود.');
        auditChange(req, { action: 'dispute_resolved', entityType: 'dispute', entityId: d.id, before: disputeView(d), after: disputeView(r.updated), reason: r.note || null, meta: { disputeId: d.id, targetUserId: d.user_id, via: 'ai_agent' } });
        notificationEvents.disputeResolved(r.updated, { note: r.note });
        notificationEvents.disputeResolvedTelegram(r.updated, { note: r.note, actor: admin });
        message = 'اعتراض بسته شد.';
      }
    }
  } catch (err) {
    getDb().prepare("UPDATE ai_pending_actions SET status='failed' WHERE id=?").run(row.id);
    throw err;
  }
  auditRepository.logEvent({ userId: admin.id, action: 'ai_action_executed', ipAddress: ip, details: { actionId: row.id, kind: row.kind, payload: p } });
  return { ok: true, message };
}

module.exports = { propose, confirm, cancel, ActionError, KINDS };

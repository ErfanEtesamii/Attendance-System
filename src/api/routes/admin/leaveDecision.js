// تصمیم روی یک درخواست مرخصی + عوارضِ آن (audit، اعلان پنل، پیام تلگرام) — منبع مشترک route تکی (leave.js) و تصمیم دسته‌جمعی (leaveQueue.js، S4-13a)
// تا رفتار هر دو مسیر دقیقاً یکی بماند. منطق تصمیم/زنجیره در leaveApprovalService است؛ این‌جا فقط اجرا + اثرهای جانبی.

const usersRepository = require('../../../repositories/usersRepository');
const leaveRepository = require('../../../repositories/leaveRepository');
const { notifyUser } = require('../../../bot/notifier');
const { auditChange } = require('./common');
const { leaveRequestView } = require('../../../utils/auditViews');
const notificationEvents = require('../../../services/notificationEvents');
const leaveApprovalService = require('../../../services/leaveApprovalService');

const ERROR_STATUS = { NOT_FOUND: 404, ALREADY_DECIDED: 400, FORBIDDEN: 403 };

// یادداشت تصمیم: رشته‌ی trim‌شده، حداکثر ۵۰۰ نویسه
const normalizeNote = (note) => (note === undefined || note === null ? '' : String(note)).trim().slice(0, 500);

// ⇒ { ok:false, status, code, error } یا { ok:true, result, request } (result = خروجی leaveApprovalService.decide، request = ردیف پس از تصمیم)
// bulk = true فقط در meta ممیزی علامت می‌خورد.
function applyDecision(req, { requestId, decision, note, bulk = false }) {
  const request = leaveRepository.findById(requestId);
  if (!request) return { ok: false, status: 404, code: 'NOT_FOUND', error: 'درخواست یافت نشد.' };

  const result = leaveApprovalService.decide({ requestId, actor: req.adminUser, decision, note });
  if (!result.ok) return { ok: false, status: ERROR_STATUS[result.code] || 400, code: result.code, error: result.error };
  const updated = result.request;
  const employee = usersRepository.findById(request.user_id);

  const finalAction = result.finalStatus === 'approved' ? 'leave_request_approved' : 'leave_request_rejected';
  auditChange(req, {
    action: result.completed ? finalAction : 'leave_request_step_approved',
    entityType: 'leave_request',
    entityId: requestId,
    before: leaveRequestView(request),
    after: leaveRequestView(updated),
    reason: note || null, // یادداشت تصمیم‌گیرنده = دلیل تصمیم
    meta: { requestId, employeeId: request.user_id, targetUserId: request.user_id, step: result.step, role: result.role, nextRole: result.nextRole, ...(bulk ? { bulk: true } : {}) },
  });

  if (!result.completed) {
    notificationEvents.leaveStepAdvanced(updated); // اعلان به تأییدکننده‌ی مرحله‌ی بعد (S4-11b)
    return { ok: true, result, request: updated };
  }

  notificationEvents.leaveDecided(updated, { note }); // اعلان پنل برای کارمند (S4-6b)
  if (employee?.telegram_user_id) {
    const typeLabel = request.kind === 'mission' ? 'مأموریت' : 'مرخصی';
    const statusLabel = result.finalStatus === 'approved' ? 'تأیید شد ✅' : 'رد شد ❌';
    const roleLabel = { admin: 'ادمین', hr: 'منابع انسانی' }[req.adminUser.role] || 'سرپرست';
    notifyUser(
      employee.telegram_user_id,
      `درخواست ${typeLabel} شما (${request.start_date} تا ${request.end_date}) ${statusLabel}` + (note ? `\nپاسخ ${roleLabel}: ${note}` : '')
    );
  }
  return { ok: true, result, request: updated };
}

module.exports = { applyDecision, normalizeNote };

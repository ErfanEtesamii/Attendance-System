// تأیید مرخصی/ماموریت (S4-11a؛ بازطراحی «تصمیم تک‌مرحله‌ای»).
// قانون: هر درخواست «یک» مرحله‌ی تأیید دارد و هم سرپرست مستقیم کارمند (users.manager_id فعلی) و هم هر ادمین می‌تواند تأیید/رد کند.
//   • تصمیم اولِ هرکدام نهایی است؛ تأیید مجدد، مرحله‌ی اضافه و ارجاع خودکار به ادمین وجود ندارد.
//   • مجوز «زنده» از manager_id فعلیِ کارمند محاسبه می‌شود و به نقشِ ذخیره‌شده در ردیف زنجیره وابسته نیست
//     (ردیف leave_approvals فقط برای تاریخچه‌ی تصمیم نگه داشته می‌شود: چه کسی، کی، با چه یادداشتی).
//   • کارمندِ بدون سرپرست: فقط ادمین‌ها.
//   • درخواستِ بدون زنجیره (current_step = NULL، قدیمی) هم با همین قاعده تصمیم‌پذیر است.

const { getDb } = require('../db/connection');
const leaveRepository = require('../repositories/leaveRepository');
const leaveApprovalRepository = require('../repositories/leaveApprovalRepository');
const usersRepository = require('../repositories/usersRepository');

const { isAdmin } = require('../utils/roles');
// نقش «نمایشی» مرحله‌ی تصمیم: سرپرست مستقیم اگر تعریف شده، وگرنه ادمین. (هر دو می‌توانند تصمیم بگیرند؛ فقط برای نمایش/اعلان)
function planRoles(request) {
  const employee = usersRepository.findById(request.user_id);
  return [employee && employee.manager_id ? 'manager' : 'admin'];
}

// ساخت زنجیره برای درخواستِ تازه/بازگشته به pending (مراحل قبلی پاک می‌شوند). درخواست غیر pending ⇒ هیچ.
function initChain(requestId) {
  const request = leaveRepository.findById(requestId);
  if (!request || request.status !== 'pending') return null;
  const run = getDb().transaction(() => {
    leaveApprovalRepository.deleteByRequest(requestId);
    leaveApprovalRepository.insertSteps(requestId, planRoles(request));
    leaveApprovalRepository.setCurrentStep(requestId, 1);
  });
  run();
  return leaveRepository.findById(requestId);
}

// حذف زنجیره (درخواست مستقیماً توسط مدیر نهایی/دستکاری شد)
function clearChain(requestId) {
  leaveApprovalRepository.deleteByRequest(requestId);
  leaveApprovalRepository.setCurrentStep(requestId, null);
}

const getChain = (requestId) => leaveApprovalRepository.listByRequest(requestId);

// نقشِ «نمایشیِ» منتظرِ تصمیم (live از manager_id)؛ غیر pending ⇒ null. نقش ذخیره‌شده در ردیف زنجیره نادیده گرفته می‌شود.
function awaitingRole(request) {
  if (!request || request.status !== 'pending') return null;
  const employee = usersRepository.findById(request.user_id);
  return employee && employee.manager_id ? 'manager' : 'admin';
}

// تنها ادمین فعال سیستم؟ (استثنای خودتأییدی ماموریت)
function isSoleActiveAdmin(user) {
  if (!user || !isAdmin(user)) return false;
  return !usersRepository.listUsers({ onlyActive: true, includeOwner: true }).some((u) => isAdmin(u) && u.id !== user.id);
}

// ادمین: هر درخواست. سرپرست: فقط کارمندِ مستقیمِ فعلی خودش. بقیه (از جمله hr): خیر.
// پارامتر سوم (role) فقط برای سازگاری با فراخوان‌های قدیمی است و نادیده گرفته می‌شود.
function canDecide(actor, request) {
  if (!actor || !request) return false;
  if (isAdmin(actor)) return true;
  if (actor.role !== 'manager') return false;
  const employee = usersRepository.findById(request.user_id);
  return !!employee && employee.manager_id === actor.id;
}

// decision: 'approve' | 'reject'؛ actor: ردیف کاربر (id, role)
// ⇒ { ok, request, completed, finalStatus, step, role, nextRole } یا { ok:false, code: NOT_FOUND|ALREADY_DECIDED|FORBIDDEN, error }
function decide({ requestId, actor, decision, note }) {
  const request = leaveRepository.findById(requestId);
  if (!request) return { ok: false, code: 'NOT_FOUND', error: 'درخواست یافت نشد.' };
  if (request.status !== 'pending') return { ok: false, code: 'ALREADY_DECIDED', error: 'این درخواست قبلاً بررسی شده است.' };
  const role = awaitingRole(request);
  // ماموریت: هیچ‌کس درخواست خودش را تأیید/رد نمی‌کند؛ تنها استثنا ادمینِ «تنها ادمین فعال» (با audit ویژه)
  const selfDecision = request.kind === 'mission' && actor && actor.id === request.user_id;
  if (selfDecision && !isSoleActiveAdmin(actor)) {
    return { ok: false, code: 'SELF_APPROVAL', role, error: 'تصمیم درباره‌ی ماموریتِ خودتان ممکن نیست؛ سرپرست یا ادمین دیگری باید تصمیم بگیرد.' };
  }
  if (!canDecide(actor, request)) {
    return { ok: false, code: 'FORBIDDEN', role, error: 'تصمیم این درخواست با سرپرست مستقیم کارمند یا ادمین است.' };
  }
  const step = request.current_step || null;
  const result = getDb().transaction(() => {
    if (step) leaveApprovalRepository.decideStep(requestId, step, decision === 'approve' ? 'approved' : 'rejected', actor.id, note);
    leaveApprovalRepository.deletePendingSteps(requestId); // مرحله‌های باقی‌مانده‌ی زنجیره‌های قدیمی: تصمیم اول نهایی است
    leaveRepository.setStatus(requestId, decision === 'approve' ? 'approved' : 'rejected', actor.id);
    leaveApprovalRepository.setCurrentStep(requestId, null);
    return { completed: true, finalStatus: decision === 'approve' ? 'approved' : 'rejected', nextRole: null };
  })();
  if (selfDecision) {
    try {
      require('../repositories/auditRepository').logEvent({ userId: actor.id, action: 'mission_self_decided', details: { requestId, decision, reason: 'sole_active_admin' } });
    } catch (_) { /* ثبت best-effort */ }
  }
  return { ok: true, request: leaveRepository.findById(requestId), step, role, ...result };
}

const ROLE_LABELS = { manager: 'سرپرست', admin: 'ادمین', owner: 'ادمین', hr: 'منابع انسانی' };

// «چه کسی تصمیم گرفت» برای درخواستِ تصمیم‌گرفته‌شده (approved|rejected)؛ وگرنه null.
// ⇒ { id, fullName, role: 'manager'|'admin'|'hr'..., roleLabel, decidedAt, note }
// (role برای owner هم 'admin' برمی‌گردد؛ منبع: leave_requests.approver_id + ردیف تاریخچه‌ی leave_approvals در صورت وجود)
function decisionInfo(request) {
  if (!request || !['approved', 'rejected'].includes(request.status) || !request.approver_id) return null;
  const user = usersRepository.findById(request.approver_id);
  if (!user) return null;
  const row = getChain(request.id).filter((s) => s.status !== 'pending' && s.decidedBy === user.id).pop() || null;
  const role = isAdmin(user) ? 'admin' : user.role;
  return { id: user.id, fullName: user.full_name, role, roleLabel: ROLE_LABELS[user.role] || ROLE_LABELS[role] || 'تأییدکننده', decidedAt: (row && row.decidedAt) || request.updated_at || null, note: (row && row.note) || null };
}

module.exports = { planRoles, initChain, clearChain, getChain, awaitingRole, canDecide, decide, decisionInfo };

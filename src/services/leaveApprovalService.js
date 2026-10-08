// زنجیره‌ی تأیید مرخصی (S4-11a).
// مراحل: گام ۱ = سرپرست مستقیم کارمند (کارمندِ بدون سرپرست ⇒ admin). گام اضافه (قابل‌تنظیم، پیش‌فرض خاموش) وقتی:
//   • طول بازه (روز تقویمی) بیشتر از leaveApprovalExtraStepDays باشد (۰ = خاموش)، یا
//   • کد نوع درخواست در leaveApprovalExtraStepTypes (جداشده با ویرگول) باشد.
//   نقش گام اضافه = leaveApprovalExtraStepRole (admin|hr)؛ اگر با گام ۱ یکی باشد (مثلاً هر دو admin) گام تکراری ساخته نمی‌شود.
// تصمیم: admin هر مرحله را می‌تواند؛ سرپرست فقط مرحله‌ی «manager» برای زیرمجموعه‌ی مستقیم خودش؛ hr فقط مرحله‌ی «hr».
//   رد در هر مرحله ⇒ کل درخواست رد. تأیید مرحله‌ی آخر ⇒ approved (تنها همان لحظه «تصمیم نهایی» است و اعلان کارمند می‌رود).
// درخواستِ بدون زنجیره (current_step = NULL، مثل درخواست‌های قبل از این مرحله) تک‌مرحله‌ای می‌ماند: admin یا سرپرست مستقیم.
// اعلان به تأییدکننده‌ی مرحله‌ی بعد/جانشین: S4-11b.

const { getDb } = require('../db/connection');
const leaveRepository = require('../repositories/leaveRepository');
const leaveApprovalRepository = require('../repositories/leaveApprovalRepository');
const leaveTypesRepository = require('../repositories/leaveTypesRepository');
const usersRepository = require('../repositories/usersRepository');
const settingsRepository = require('../repositories/settingsRepository');
const { dayDiff } = require('../utils/shiftDay');

// نقش‌های مراحل برای یک درخواست (آرایه‌ی ۱ یا ۲ عضوی)
function planRoles(request) {
  const settings = settingsRepository.getAll();
  const employee = usersRepository.findById(request.user_id);
  const roles = [employee && employee.manager_id ? 'manager' : 'admin'];
  const type = leaveTypesRepository.findById(request.leave_type_id);
  const codes = settings.leaveApprovalExtraStepTypes.split(',').map((s) => s.trim()).filter(Boolean);
  const spanDays = dayDiff(request.end_date, request.start_date) + 1;
  const byDays = settings.leaveApprovalExtraStepDays > 0 && spanDays > settings.leaveApprovalExtraStepDays;
  const byType = !!type && codes.includes(type.code);
  if ((byDays || byType) && !roles.includes(settings.leaveApprovalExtraStepRole)) roles.push(settings.leaveApprovalExtraStepRole);
  return roles;
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

// نقشِ منتظرِ تصمیم؛ بدون زنجیره (قدیمی) ⇒ 'manager' (admin هم می‌تواند)؛ غیر pending ⇒ null
function awaitingRole(request) {
  if (!request || request.status !== 'pending') return null;
  if (!request.current_step) return 'manager';
  const row = getChain(request.id).find((r) => r.step === request.current_step);
  return row ? row.approverRole : 'manager';
}

function canDecide(actor, request, role) {
  if (!actor) return false;
  if (actor.role === 'admin') return true;
  if (role === 'hr') return actor.role === 'hr';
  const employee = usersRepository.findById(request.user_id);
  return role === 'manager' && actor.role === 'manager' && !!employee && employee.manager_id === actor.id;
}

// decision: 'approve' | 'reject'؛ actor: ردیف کاربر (id, role)
// ⇒ { ok, request, completed, finalStatus, step, role, nextRole } یا { ok:false, code: NOT_FOUND|ALREADY_DECIDED|FORBIDDEN, error }
function decide({ requestId, actor, decision, note }) {
  const request = leaveRepository.findById(requestId);
  if (!request) return { ok: false, code: 'NOT_FOUND', error: 'درخواست یافت نشد.' };
  if (request.status !== 'pending') return { ok: false, code: 'ALREADY_DECIDED', error: 'این درخواست قبلاً بررسی شده است.' };
  const role = awaitingRole(request);
  if (!canDecide(actor, request, role)) {
    const who = { manager: 'سرپرست مستقیم کارمند یا ادمین', admin: 'ادمین', hr: 'منابع انسانی یا ادمین' }[role];
    return { ok: false, code: 'FORBIDDEN', role, error: `تصمیم این مرحله با ${who} است.` };
  }
  const chain = getChain(requestId);
  const step = request.current_step || null;
  const result = getDb().transaction(() => {
    if (step) leaveApprovalRepository.decideStep(requestId, step, decision === 'approve' ? 'approved' : 'rejected', actor.id, note);
    if (decision === 'reject') {
      leaveRepository.setStatus(requestId, 'rejected', actor.id);
      leaveApprovalRepository.setCurrentStep(requestId, null);
      return { completed: true, finalStatus: 'rejected', nextRole: null };
    }
    const next = chain.find((r) => r.step > (step || 0) && r.status === 'pending');
    if (next) {
      leaveApprovalRepository.setCurrentStep(requestId, next.step);
      return { completed: false, finalStatus: 'pending', nextRole: next.approverRole };
    }
    leaveRepository.setStatus(requestId, 'approved', actor.id);
    leaveApprovalRepository.setCurrentStep(requestId, null);
    return { completed: true, finalStatus: 'approved', nextRole: null };
  })();
  return { ok: true, request: leaveRepository.findById(requestId), step, role, ...result };
}

// ارجاع مرحله‌ی فعالِ «manager» به admin (S4-11c). فقط وقتی مرحله‌ی فعال manager و pending باشد؛ ⇒ { ok, request } یا { ok:false }
function escalateToAdmin(requestId) {
  const request = leaveRepository.findById(requestId);
  if (!request || request.status !== 'pending' || !request.current_step) return { ok: false };
  const row = getChain(requestId).find((r) => r.step === request.current_step);
  if (!row || row.approverRole !== 'manager' || row.status !== 'pending') return { ok: false };
  leaveApprovalRepository.setApproverRole(requestId, row.step, 'admin');
  return { ok: true, request: leaveRepository.findById(requestId), step: row.step };
}

module.exports = { planRoles, initChain, clearChain, getChain, awaitingRole, canDecide, decide, escalateToAdmin };

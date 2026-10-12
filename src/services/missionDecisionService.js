// C4: تصمیم‌گیری سرپرست روی ماموریت از بات (مرور شبانه): فهرست منتظرها، رد با علتِ اجباری، اصلاح ساعت.
// روی leaveApprovalService.decide سوار است (همان زنجیره/مجوزها)؛ هیچ مسیر تصمیم تازه‌ای نمی‌سازد.

const usersRepository = require('../repositories/usersRepository');
const leaveRepository = require('../repositories/leaveRepository');
const auditRepository = require('../repositories/auditRepository');
const leaveApprovalService = require('./leaveApprovalService');
const leaveDurationService = require('./leaveDurationService');
const notificationEvents = require('./notificationEvents');
const { sanitizeText } = require('../utils/sanitize');

const REJECT_REASON_MIN = 3;
const REJECT_REASON_MAX = 300;
const TIME_RE = /^\s*(\d{1,2}):(\d{2})\s*(?:-|–|تا|to)\s*(\d{1,2}):(\d{2})\s*$/;
const pad = (n) => String(n).padStart(2, '0');

const cleanText = (v, max) => sanitizeText(v, max + 1).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();

// ماموریت‌های pending که «نوبت مرحله‌ی سرپرست» است و کارمندشان زیردست مستقیم همین سرپرست است (قدیمی‌ترین اول)
function pendingForSupervisor(supervisor, { limit = null } = {}) {
  const rows = leaveRepository.listQueue({ status: 'pending', kind: 'mission', limit: null }).rows;
  const out = rows.filter((r) => {
    const emp = usersRepository.findById(r.user_id);
    return emp && emp.manager_id === supervisor.id && leaveApprovalService.awaitingRole(r) === 'manager';
  });
  return limit ? out.slice(0, limit) : out;
}

// شرح یک خطی ماموریت برای پیام تلگرام
function describeMission(request, employee) {
  const when = request.unit === 'hour' && request.start_time ? `${request.start_date} ${request.start_time}–${request.end_time}`
    : request.unit === 'half_day' ? `${request.start_date} (نیم‌روز ${request.half_day_part === 'afternoon' ? 'عصر' : 'صبح'})`
      : request.start_date === request.end_date ? request.start_date : `${request.start_date} تا ${request.end_date}`;
  const bits = [`#${request.id} ${employee ? employee.full_name : `کاربر ${request.user_id}`} — ${when}`];
  if (request.destination) bits.push(`مقصد: ${request.destination}`);
  if (request.reason) bits.push(`علت: ${request.reason}`);
  if (request.source === 'miniapp_now_auto') bits.push('⚠️ پایان خودکار (= پایان شیفت) — ساعت پایان را اصلاح کنید');
  else if (request.source === 'miniapp_now_open') bits.push('⏳ هنوز باز است (پایان موقت = پایان شیفت)');
  return bits.join('\n');
}

// کیبورد inline هر ماموریت
function missionKeyboardRow(request) {
  const row = [
    { text: '✅ تأیید', callback_data: `leave_approve:${request.id}` },
    { text: '❌ رد', callback_data: `leave_reject:${request.id}` },
  ];
  if (request.unit === 'hour') row.push({ text: '✏️ اصلاح ساعت', callback_data: `mission_edit:${request.id}` });
  return row;
}

function rejectMission({ requestId, actor, reason }) {
  const text = cleanText(reason, REJECT_REASON_MAX);
  if (text.length < REJECT_REASON_MIN) return { ok: false, code: 'REASON_REQUIRED', error: `علت رد الزامی است (حداقل ${REJECT_REASON_MIN} نویسه).` };
  const request = leaveRepository.findById(requestId);
  if (!request || request.kind !== 'mission') return { ok: false, code: 'NOT_FOUND', error: 'ماموریت یافت نشد.' };
  const result = leaveApprovalService.decide({ requestId, actor, decision: 'reject', note: text });
  if (!result.ok) return result;
  auditRepository.logEvent({ userId: actor.id, action: 'leave_request_rejected', details: { requestId, employeeId: request.user_id, step: result.step, via: 'nightly_review', reasonLength: text.length } });
  notificationEvents.leaveDecided(result.request, { note: text });
  return { ...result, reason: text };
}

function approveMission({ requestId, actor }) {
  const request = leaveRepository.findById(requestId);
  if (!request || request.kind !== 'mission') return { ok: false, code: 'NOT_FOUND', error: 'ماموریت یافت نشد.' };
  const result = leaveApprovalService.decide({ requestId, actor, decision: 'approve' });
  if (!result.ok) return result;
  auditRepository.logEvent({
    userId: actor.id,
    action: !result.completed ? 'leave_request_step_approved' : 'leave_request_approved',
    details: { requestId, employeeId: request.user_id, step: result.step, nextRole: result.nextRole, via: 'nightly_review' },
  });
  if (result.completed) notificationEvents.leaveDecided(result.request);
  else notificationEvents.leaveStepAdvanced(result.request);
  return result;
}

// «HH:MM-HH:MM» ⇒ { startTime, endTime } یا null
function parseTimeRange(text) {
  const m = TIME_RE.exec(String(text || '').replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))));
  if (!m) return null;
  const [h1, m1, h2, m2] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  if (h1 > 23 || h2 > 23 || m1 > 59 || m2 > 59) return null;
  return { startTime: `${pad(h1)}:${pad(m1)}`, endTime: `${pad(h2)}:${pad(m2)}` };
}

// اصلاح ساعتِ ماموریتِ ساعتیِ pending توسط کسی که نوبت تصمیم اوست؛ با همان اعتبارسنجی/تداخل ثبت. تصمیم (تأیید) جداست.
function adjustTimes({ requestId, actor, text }) {
  const request = leaveRepository.findById(requestId);
  if (!request || request.kind !== 'mission') return { ok: false, code: 'NOT_FOUND', error: 'ماموریت یافت نشد.' };
  if (request.status !== 'pending') return { ok: false, code: 'ALREADY_DECIDED', error: 'این درخواست قبلاً بررسی شده است.' };
  if (request.unit !== 'hour') return { ok: false, code: 'NOT_HOURLY', error: 'اصلاح ساعت فقط برای ماموریت ساعتی ممکن است.' };
  const role = leaveApprovalService.awaitingRole(request);
  if (!leaveApprovalService.canDecide(actor, request, role) || (actor.id === request.user_id)) return { ok: false, code: 'FORBIDDEN', error: 'اجازه‌ی اصلاح این ماموریت را ندارید.' };
  const range = parseTimeRange(text);
  if (!range) return { ok: false, code: 'BAD_FORMAT', error: 'قالب ساعت درست نیست؛ مثال: 09:30-12:00' };
  const prep = leaveDurationService.prepare({
    userId: request.user_id, startDate: request.start_date, endDate: request.end_date, unit: 'hour',
    startTime: range.startTime, endTime: range.endTime, leaveTypeId: request.leave_type_id, excludeRequestId: request.id,
  }, { skipUnit: true });
  if (!prep.ok) return { ok: false, code: prep.errors[0].code, error: prep.errors[0].error };
  const updated = leaveRepository.updateTimes(request.id, range.startTime, range.endTime, prep.durationMinutes);
  auditRepository.logChange({
    actor: actor.id, action: 'mission_time_adjusted', entityType: 'leave_request', entityId: request.id,
    before: { start_time: request.start_time, end_time: request.end_time }, after: { start_time: range.startTime, end_time: range.endTime },
    reason: 'اصلاح ساعت توسط تأییدکننده', meta: { requestId: request.id, targetUserId: request.user_id },
  });
  return { ok: true, request: updated, ...range };
}

module.exports = { pendingForSupervisor, describeMission, missionKeyboardRow, rejectMission, approveMission, adjustTimes, parseTimeRange, REJECT_REASON_MIN };

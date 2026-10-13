// سرویس اعتراضِ کارمند (فاز ۱۱، D2): فهرست/thread فقط برای مالک، ارسال پیام، «ادامه‌ی اعتراض» و «خاتمه توسط کارمند».
// همه‌ی قواعد سمت سرور است؛ UI فقط راهنماست. SQL فقط در disputeRepository.
//
// مدل وضعیت (جزئیات در migration 027): status = open | resolved؛ closed_by = admin | user | NULL.
//   phase (مشتق، برای UI):  open (کارمند منتظر پاسخ) | answered (باز و آخرین پیام از ادمین) |
//                          resolved (بسته توسط ادمین) | closed_by_user (خاتمه توسط کارمند)
//
// قواعد:
//   • اعتراضِ دیگران ⇒ ۴۰۴ (وجودش لو نمی‌رود).
//   • پیام فقط وقتی اعتراض باز است؛ بعد از بسته‌شدن فقط با «ادامه‌ی اعتراض» (reopen) همراه پیام جدید.
//   • سقف دفعات ادامه: تنظیم disputeMaxReopens (۰ = خاموش). reopen‌های ادمین به این سقف نمی‌شمارند.
//   • ماهِ بسته: اعتراضِ مربوط به ماه بسته‌شده فقط‌خواندنی است (ارسال پیام/ادامه/خاتمه ⇒ ۴۰۹ MONTH_CLOSED)؛
//     ماهِ اعتراض = تاریخ رکوردِ وصل‌شده، یا روز ثبت اعتراض (مثل چک‌لیست بستن ماه). ثبت اعتراضِ جدید تغییری نکرده.

const disputeRepository = require('../repositories/disputeRepository');
const attendanceRepository = require('../repositories/attendanceRepository');
const auditRepository = require('../repositories/auditRepository');
const settingsRepository = require('../repositories/settingsRepository');
const monthClosuresRepository = require('../repositories/monthClosuresRepository');
const { sanitizeText } = require('../utils/sanitize');

const MESSAGE_MAX = 500;

const ERROR_STATUS = {
  NOT_FOUND: 404,
  VALIDATION: 400,
  DISPUTE_CLOSED: 409, // اعتراض بسته است؛ برای پیام باید «ادامه‌ی اعتراض» بزند
  DISPUTE_NOT_CLOSED: 409, // ادامه فقط برای اعتراضِ بسته‌شده
  DISPUTE_ALREADY_CLOSED: 409,
  REOPEN_LIMIT: 409,
  MONTH_CLOSED: 409,
};
const statusOf = (code) => ERROR_STATUS[code] || 400;
const fail = (code, error, extra = {}) => ({ ok: false, code, error, ...extra });

// ---------- ابزارهای داخلی ----------

// پیام را اعتبارسنجی/پاک می‌کند. ⇒ { text } | { error } (fail)
function cleanMessage(raw) {
  if (typeof raw !== 'string') return { error: fail('VALIDATION', 'متن پیام الزامی است.') };
  const trimmed = raw.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  if (!trimmed) return { error: fail('VALIDATION', 'متن پیام نباید خالی باشد.') };
  if (trimmed.length > MESSAGE_MAX) return { error: fail('VALIDATION', `متن پیام حداکثر ${MESSAGE_MAX} نویسه می‌تواند باشد.`) };
  return { text: sanitizeText(trimmed, MESSAGE_MAX) };
}

function recordDateOf(dispute) {
  if (dispute.attendance_record_id) {
    const rec = attendanceRepository.findById(dispute.attendance_record_id);
    if (rec) return rec.record_date;
  }
  return String(dispute.created_at || '').slice(0, 10);
}

function isMonthClosed(dispute) {
  const date = recordDateOf(dispute);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && monthClosuresRepository.findClosedOverlapping(date, date).length > 0;
}

const monthClosedFailure = () => fail('MONTH_CLOSED', 'این اعتراض مربوط به ماهِ بسته‌شده است و فقط‌خواندنی است.');

function phaseOf(d, lastSenderRole) {
  if (d.status === 'open') return lastSenderRole === 'admin' ? 'answered' : 'open';
  return d.closed_by === 'user' ? 'closed_by_user' : 'resolved';
}

// نمای خروجی یک اعتراض (فیلدهای قدیمیِ ردیف حفظ می‌شوند؛ فیلدهای جدید اضافه‌اند)
function present(d, { messageCount, lastSenderRole, recordDate = null, maxReopens }) {
  const closed = d.status === 'resolved';
  return {
    id: d.id,
    user_id: d.user_id,
    attendance_record_id: d.attendance_record_id || null,
    record_date: recordDate,
    message: d.message,
    status: d.status,
    closed_by: d.closed_by || null,
    closed_at: d.closed_at || null,
    reopen_count: d.reopen_count || 0,
    max_reopens: maxReopens,
    message_count: messageCount,
    last_sender_role: lastSenderRole,
    last_message_at: d.last_message_at || d.created_at,
    phase: phaseOf(d, lastSenderRole),
    can_reply: d.status === 'open',
    can_reopen: closed && maxReopens > 0 && (d.reopen_count || 0) < maxReopens,
    can_close: d.status === 'open',
    created_at: d.created_at,
    updated_at: d.updated_at,
  };
}

function presentMessage(m, userId) {
  return {
    id: m.id,
    sender_role: m.sender_role,
    is_mine: m.sender_role === 'user' && m.sender_user_id === userId,
    message: m.message,
    created_at: m.created_at,
  };
}

// اعتراضِ متعلق به همین کاربر یا fail(NOT_FOUND)
function ownDispute(user, id) {
  const n = Number(id);
  const d = Number.isInteger(n) && n > 0 ? disputeRepository.findById(n) : null;
  if (!d || d.user_id !== user.id) return { error: fail('NOT_FOUND', 'اعتراض یافت نشد.') };
  return { dispute: d };
}

function snapshotOf(user, id, maxReopens) {
  const d = disputeRepository.findById(id);
  const messages = disputeRepository.listMessages(id);
  const last = messages[messages.length - 1];
  return {
    dispute: present(d, {
      messageCount: messages.length,
      lastSenderRole: last ? last.sender_role : 'user',
      recordDate: d.attendance_record_id ? (attendanceRepository.findById(d.attendance_record_id) || {}).record_date || null : null,
      maxReopens,
    }),
    messages: messages.map((m) => presentMessage(m, user.id)),
  };
}

const maxReopensNow = () => settingsRepository.getAll().disputeMaxReopens;

// ---------- API سرویس ----------

/** فهرست اعتراض‌های خودِ کارمند (جدیدترین اول) با وضعیت و تعداد پیام. */
function listMine(user) {
  const maxReopens = maxReopensNow();
  return disputeRepository.listByUserWithSummary(user.id).map((d) =>
    present(d, { messageCount: d.message_count, lastSenderRole: d.last_sender_role, recordDate: d.record_date || null, maxReopens })
  );
}

/** thread کامل یک اعتراض (فقط مالک). */
function getMine(user, id) {
  const own = ownDispute(user, id);
  if (own.error) return own.error;
  return { ok: true, ...snapshotOf(user, own.dispute.id, maxReopensNow()) };
}

/** ثبت اعتراض جدید؛ پیام اولیه در dispute_messages هم نوشته می‌شود. */
function create(user, { attendanceRecordId, message } = {}, { ip = null } = {}) {
  const msg = cleanMessage(message);
  if (msg.error) return msg.error;
  if (attendanceRecordId) {
    const record = attendanceRepository.findById(attendanceRecordId);
    if (!record || record.user_id !== user.id) return fail('NOT_FOUND', 'رکورد یافت نشد.');
  }
  const dispute = disputeRepository.createDispute({
    userId: user.id,
    attendanceRecordId: attendanceRecordId || null,
    message: msg.text,
  });
  auditRepository.logEvent({
    userId: user.id,
    action: 'record_dispute_submitted',
    ipAddress: ip,
    details: { attendanceRecordId: attendanceRecordId || null, disputeId: dispute.id },
  });
  return { ok: true, dispute };
}

/** پیام کارمند روی اعتراضِ باز. */
function postMessage(user, id, { message } = {}, { ip = null } = {}) {
  const own = ownDispute(user, id);
  if (own.error) return own.error;
  const d = own.dispute;
  const msg = cleanMessage(message);
  if (msg.error) return msg.error;
  if (d.status !== 'open') {
    return fail('DISPUTE_CLOSED', 'این اعتراض بسته شده است. برای ادامه‌ی گفت‌وگو از «ادامه‌ی اعتراض» استفاده کنید.');
  }
  if (isMonthClosed(d)) return monthClosedFailure();

  const saved = disputeRepository.addMessage({ disputeId: d.id, senderUserId: user.id, senderRole: 'user', message: msg.text });
  auditRepository.logEvent({
    userId: user.id,
    action: 'record_dispute_message_sent',
    ipAddress: ip,
    details: { disputeId: d.id, messageId: saved.id, length: msg.text.length },
  });
  return { ok: true, ...snapshotOf(user, d.id, maxReopensNow()) };
}

/** «ادامه‌ی اعتراض» بعد از بسته‌شدن (توسط ادمین یا خود کارمند)، همراه پیام جدید؛ با سقف disputeMaxReopens. */
function reopen(user, id, { message } = {}, { ip = null } = {}) {
  const own = ownDispute(user, id);
  if (own.error) return own.error;
  const d = own.dispute;
  const msg = cleanMessage(message);
  if (msg.error) return msg.error;
  if (d.status !== 'resolved') return fail('DISPUTE_NOT_CLOSED', 'این اعتراض هنوز باز است؛ می‌توانید مستقیم پیام بدهید.');
  const maxReopens = maxReopensNow();
  if (maxReopens <= 0) return fail('REOPEN_LIMIT', 'ادامه‌ی اعتراضِ بسته‌شده فعال نیست.', { maxReopens });
  if ((d.reopen_count || 0) >= maxReopens) {
    return fail('REOPEN_LIMIT', `سقف دفعات ادامه‌ی اعتراض (${maxReopens} بار) پر شده است.`, { maxReopens });
  }
  if (isMonthClosed(d)) return monthClosedFailure();

  const updated = disputeRepository.reopenWithMessage({
    id: d.id, senderUserId: user.id, senderRole: 'user', message: msg.text, countAsReopen: true, maxReopens,
  });
  if (!updated) return fail('DISPUTE_NOT_CLOSED', 'وضعیت اعتراض تغییر کرده است؛ صفحه را تازه کنید.');
  auditRepository.logEvent({
    userId: user.id,
    action: 'record_dispute_reopened_by_user',
    ipAddress: ip,
    details: { disputeId: d.id, reopenCount: updated.reopen_count, previousClosedBy: d.closed_by || null, length: msg.text.length },
  });
  return { ok: true, ...snapshotOf(user, d.id, maxReopens) };
}

/** «خاتمه توسط کارمند» (closed_by = user)؛ فقط وقتی اعتراض باز است. */
function close(user, id, { ip = null } = {}) {
  const own = ownDispute(user, id);
  if (own.error) return own.error;
  const d = own.dispute;
  if (d.status !== 'open') return fail('DISPUTE_ALREADY_CLOSED', 'این اعتراض قبلاً بسته شده است.');
  if (isMonthClosed(d)) return monthClosedFailure();

  disputeRepository.setStatus(d.id, 'resolved', { closedBy: 'user' });
  auditRepository.logEvent({
    userId: user.id,
    action: 'record_dispute_closed_by_user',
    ipAddress: ip,
    details: { disputeId: d.id },
  });
  return { ok: true, ...snapshotOf(user, d.id, maxReopensNow()) };
}

module.exports = { MESSAGE_MAX, statusOf, ERROR_STATUS, listMine, getMine, create, postMessage, reopen, close };

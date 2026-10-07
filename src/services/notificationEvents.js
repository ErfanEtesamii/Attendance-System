// اتصال رویدادهای موجود به اعلان‌های درون‌پنلی (S4-6b). منطق «چه کسی، چه چیزی» فقط اینجاست؛ ثبت واقعی با notify (S4-5a).
//
// رویدادها و گیرنده‌ها:
//   leaveRequested(request)          درخواست مرخصی/مأموریت جدید   ⇒ تأییدکننده‌ها (مدیر مستقیم‌ِ فعال؛ وگرنه همه‌ی ادمین‌های فعال)
//   leaveDecided(request, {note})    تأیید/رد درخواست              ⇒ خودِ کارمند
//   disputeOpened(dispute)           اعتراض جدید به رکورد          ⇒ همان تأییدکننده‌ها
//   disputeResolved(dispute, {note}) بسته‌شدن اعتراض               ⇒ خودِ کارمند
//   systemAlert({...})               هشدار سیستم (watchdog)        ⇒ همه‌ی ادمین‌های فعال
//   suspiciousCreated(event)         «نشانه»ی مورد مشکوک جدید      ⇒ ادمین‌ها + سرپرستی که «همه‌ی» کاربران مورد در تیم اویند (اسکوپ S2-5a)
//
// قوانین:
//   • هرگز استثنا نمی‌دهد و جریان اصلی را نمی‌شکند (ثبت تردد/مرخصی/اعتراض/watchdog)؛ خطا فقط لاگ می‌شود.
//   • درج ردیف پنل همگام (قبل از برگشت) انجام می‌شود؛ فراخواننده لازم نیست await کند.
//   • تلگرام از notify فرستاده نمی‌شود (telegram:false): هر رویداد از قبل مسیر تلگرام خودش را دارد و نباید پیام تکراری برود.
//   • dedupeKey: فراخوانی دوباره‌ی همان رویداد اعلان تکراری نمی‌سازد (شناسه‌ی رویداد + در تصمیم‌ها وضعیت و updated_at).

const usersRepository = require('../repositories/usersRepository');
const { notify } = require('./notificationService');
const { sanitizeText } = require('../utils/sanitize');

const SUSPICIOUS_LABEL = {
  shared_device: 'یک دستگاه برای چند نفر',
  same_ip_close: 'یک IP و ثبت‌های بسیار نزدیک',
  device_change: 'تغییر ناگهانی دستگاه',
};

const leaveLabel = (leaveType) => (leaveType === 'mission' ? 'مأموریت' : 'مرخصی');

function logError(label, err) {
  console.error(`[notifyEvents] ${label} ناموفق (نادیده گرفته شد):`, sanitizeText(err && err.message ? err.message : String(err), 200));
}

function activeAdmins() {
  return usersRepository.listUsers({ onlyActive: true }).filter((u) => u.role === 'admin');
}

// مدیر مستقیم‌ِ فعال اگر هست، وگرنه ادمین‌های فعال (همان قاعده‌ی notifyApprovers بات). خودِ درخواست‌دهنده حذف می‌شود.
function handlersOf(employee) {
  let list = [];
  if (employee.manager_id) {
    const manager = usersRepository.findById(employee.manager_id);
    if (manager && manager.is_active) list = [manager];
  }
  if (list.length === 0) list = activeAdmins();
  return list.filter((u) => u.id !== employee.id);
}

/** ثبت یک اعلان بدون شکستن فراخواننده. @returns {Promise<object|null>} */
function send(label, userId, input) {
  try {
    return notify(userId, { ...input, telegram: false }).catch((err) => { logError(label, err); return null; });
  } catch (err) {
    logError(label, err);
    return Promise.resolve(null);
  }
}

// بدنه‌ی هر رویداد داخل guard اجرا می‌شود (خواندن DB هم ممکن است خطا بدهد) و همیشه Promise برمی‌گرداند.
function guard(label, build) {
  try {
    const jobs = build();
    return Promise.all(jobs).then((r) => r.filter(Boolean));
  } catch (err) {
    logError(label, err);
    return Promise.resolve([]);
  }
}

function period(request) {
  return request.start_date === request.end_date ? request.start_date : `${request.start_date} تا ${request.end_date}`;
}

function leaveRequested(request) {
  return guard('leaveRequested', () => {
    const employee = usersRepository.findById(request.user_id);
    if (!employee) return [];
    const label = leaveLabel(request.leave_type);
    return handlersOf(employee).map((h) =>
      send('leaveRequested', h.id, {
        type: 'leave_requested',
        title: `درخواست ${label} جدید`,
        body: `${employee.full_name} — ${period(request)}${request.reason ? `\n${sanitizeText(request.reason, 200)}` : ''}`,
        link: '#/leave',
        data: { requestId: request.id, employeeId: employee.id, leaveType: request.leave_type },
        dedupeKey: `leave_requested:${request.id}`,
      })
    );
  });
}

/** @param {object} request ردیف «پس از تصمیم» (status = approved|rejected). غیر از این دو ⇒ بی‌اثر. */
function leaveDecided(request, { note = null } = {}) {
  return guard('leaveDecided', () => {
    if (!request || !['approved', 'rejected'].includes(request.status)) return [];
    const label = leaveLabel(request.leave_type);
    const approved = request.status === 'approved';
    return [
      send('leaveDecided', request.user_id, {
        type: approved ? 'leave_approved' : 'leave_rejected',
        title: `درخواست ${label} شما ${approved ? 'تأیید شد' : 'رد شد'}`,
        body: `${period(request)}${note ? `\nپاسخ: ${sanitizeText(note, 300)}` : ''}`,
        link: '#/leave',
        data: { requestId: request.id, status: request.status },
        dedupeKey: `leave_decided:${request.id}:${request.status}:${request.updated_at || ''}`,
      }),
    ];
  });
}

function disputeOpened(dispute) {
  return guard('disputeOpened', () => {
    const employee = usersRepository.findById(dispute.user_id);
    if (!employee) return [];
    return handlersOf(employee).map((h) =>
      send('disputeOpened', h.id, {
        type: 'dispute_opened',
        title: 'اعتراض جدید به رکورد',
        body: `${employee.full_name}: ${sanitizeText(dispute.message || '', 200)}`,
        link: '#/disputes',
        data: { disputeId: dispute.id, employeeId: employee.id, attendanceRecordId: dispute.attendance_record_id || null },
        dedupeKey: `dispute_opened:${dispute.id}`,
      })
    );
  });
}

/** @param {object} dispute ردیف «پس از بسته‌شدن» (status = resolved). غیر از آن ⇒ بی‌اثر. */
function disputeResolved(dispute, { note = null } = {}) {
  return guard('disputeResolved', () => {
    if (!dispute || dispute.status !== 'resolved') return [];
    return [
      send('disputeResolved', dispute.user_id, {
        type: 'dispute_resolved',
        title: 'اعتراض شما بررسی و بسته شد',
        body: note ? `پاسخ: ${sanitizeText(note, 300)}` : null,
        link: '#/disputes',
        data: { disputeId: dispute.id },
        dedupeKey: `dispute_resolved:${dispute.id}:${dispute.updated_at || ''}`,
      }),
    ];
  });
}

/** firstSeenAt شروع «همین دوره‌ی» هشدار است؛ بازگشت/ادامه‌ی همان دوره اعلان دوباره نمی‌سازد. */
function systemAlert({ key, title, detail = null, firstSeenAt }) {
  return guard('systemAlert', () =>
    activeAdmins().map((a) =>
      send('systemAlert', a.id, {
        type: 'system_alert',
        title: `هشدار سیستم: ${title}`,
        body: detail,
        link: '#/system',
        data: { alertKey: key },
        dedupeKey: `system_alert:${key}:${firstSeenAt}`,
      })
    )
  );
}

// سرپرستی که «همه‌ی» کاربران مورد زیرمجموعه‌ی مستقیم اویند (همان قاعده‌ی inScope در routes/admin/suspicious.js)
function managerInScope(event) {
  const users = (event.user_ids || []).map((id) => usersRepository.findById(id));
  if (users.length === 0 || users.some((u) => !u || !u.manager_id)) return null;
  const managerId = users[0].manager_id;
  if (!users.every((u) => u.manager_id === managerId)) return null;
  const manager = usersRepository.findById(managerId);
  return manager && manager.is_active ? manager : null;
}

/** @param {object} event ردیف suspiciousRepository (user_ids آرایه). هر مورد «نشانه» است نه اتهام. */
function suspiciousCreated(event) {
  return guard('suspiciousCreated', () => {
    const recipients = new Map(activeAdmins().map((a) => [a.id, a]));
    const manager = managerInScope(event);
    if (manager) recipients.set(manager.id, manager);
    const label = SUSPICIOUS_LABEL[event.event_type] || event.event_type;
    return [...recipients.keys()].map((id) =>
      send('suspiciousCreated', id, {
        type: 'suspicious_event',
        title: 'نشانه‌ی جدید برای بررسی',
        body: `${label} · ${event.event_date}`,
        link: '#/suspicious',
        data: { eventId: event.id, eventType: event.event_type },
        dedupeKey: `suspicious_event:${event.id}`,
      })
    );
  });
}

module.exports = { leaveRequested, leaveDecided, disputeOpened, disputeResolved, systemAlert, suspiciousCreated };

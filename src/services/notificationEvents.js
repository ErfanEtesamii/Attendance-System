// اتصال رویدادهای موجود به اعلان‌های درون‌پنلی (S4-6b). منطق «چه کسی، چه چیزی» فقط اینجاست؛ ثبت واقعی با notify (S4-5a).
//
// رویدادها و گیرنده‌ها:
//   leaveRequested(request)          درخواست مرخصی/مأموریت جدید   ⇒ تأییدکننده‌ها (مدیر مستقیم‌ِ فعال؛ وگرنه همه‌ی ادمین‌های فعال)
//   leaveStepAdvanced(request)       تأیید مرحله‌ی میانی زنجیره       ⇒ تأییدکننده‌های «مرحله‌ی بعد» (admin‌ها / hr‌های فعال)؛ تلگرام هم می‌رود (S4-11b)
//   leaveDecided(request, {note})    تأیید/رد درخواست              ⇒ خودِ کارمند (+ در تأیید: جانشین، اگر ثبت شده)
//   disputeOpened(dispute)           اعتراض جدید به رکورد          ⇒ همان تأییدکننده‌ها
//   disputeResolved(dispute, {note}) بسته‌شدن اعتراض               ⇒ خودِ کارمند
//   disputeAdminMessage(dispute, message, {actor})  پیام تازه‌ی ادمین/سرپرست در گفت‌وگوی اعتراض (D4) ⇒ خودِ کارمند (پنل + تلگرام)
//   disputeUserMessage(dispute, message, {reopened}) پیام تازه‌ی کارمند یا «ادامه‌ی اعتراض» (D4)       ⇒ همان تأییدکننده‌های disputeOpened (فقط پنل)
//   systemAlert({...})               هشدار سیستم (watchdog)        ⇒ همه‌ی ادمین‌های فعال
//   suspiciousCreated(event)         «نشانه»ی مورد مشکوک جدید      ⇒ ادمین‌ها + سرپرستی که «همه‌ی» کاربران مورد در تیم اویند (اسکوپ S2-5a)
//   reportCommented({...})           کامنتِ سرپرست روی گزارش روزانه  ⇒ خودِ کارمند (D9؛ تنها رویدادی که تلگرام هم می‌فرستد، چون مسیر تلگرامِ جدا ندارد)
//   urgentTaskAssigned({...})        تسک فوریِ تازه (E1)             ⇒ خودِ کارمند (پنل + تلگرام، با دکمه‌ی باز کردن Mini App)
//   urgentTaskReminder({...})        یادآوریِ نزدیک‌شدن مهلتِ تسک فوری (E1) ⇒ خودِ کارمند (پنل + تلگرام)
//
// قوانین:
//   • هرگز استثنا نمی‌دهد و جریان اصلی را نمی‌شکند (ثبت تردد/مرخصی/اعتراض/watchdog)؛ خطا فقط لاگ می‌شود.
//   • درج ردیف پنل همگام (قبل از برگشت) انجام می‌شود؛ فراخواننده لازم نیست await کند.
//   • تلگرام از notify فرستاده نمی‌شود (telegram:false): هر رویداد از قبل مسیر تلگرام خودش را دارد و نباید پیام تکراری برود.
//   • dedupeKey: فراخوانی دوباره‌ی همان رویداد اعلان تکراری نمی‌سازد (شناسه‌ی رویداد + در تصمیم‌ها وضعیت و updated_at).

const usersRepository = require('../repositories/usersRepository');
const { notify } = require('./notificationService');
const { sendMessage } = require('../bot/notifier');
const panelLinks = require('../bot/panelLinks');
const leaveApprovalService = require('./leaveApprovalService');
const { sanitizeText } = require('../utils/sanitize');
const { isoDateToJalaliString } = require('../utils/jalali');
const crypto = require('crypto');
const lateLimitService = require('./lateLimitService');
const settingsRepository = require('../repositories/settingsRepository');

const SUSPICIOUS_LABEL = {
  shared_device: 'یک دستگاه برای چند نفر',
  same_ip_close: 'یک IP و ثبت‌های بسیار نزدیک',
  device_change: 'تغییر ناگهانی دستگاه',
};

const leaveLabel = (kind) => (kind === 'mission' ? 'مأموریت' : 'مرخصی');

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
    return notify(userId, { telegram: false, ...input }).catch((err) => { logError(label, err); return null; });
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

// تأییدکننده‌های «مرحله‌ی فعال» درخواست (S4-11b): manager ⇒ همان قاعده‌ی handlersOf؛ admin ⇒ ادمین‌های فعال؛ hr ⇒ hrهای فعال
function approversOf(request, employee) {
  const role = leaveApprovalService.awaitingRole(request);
  if (role === 'admin') return activeAdmins().filter((u) => u.id !== employee.id);
  if (role === 'hr') return usersRepository.listUsers({ onlyActive: true }).filter((u) => u.role === 'hr' && u.id !== employee.id);
  return handlersOf(employee);
}

function leaveRequested(request) {
  return guard('leaveRequested', () => {
    const employee = usersRepository.findById(request.user_id);
    if (!employee) return [];
    const label = leaveLabel(request.kind);
    return approversOf(request, employee).map((h) =>
      send('leaveRequested', h.id, {
        type: 'leave_requested',
        title: `درخواست ${label} جدید`,
        body: `${employee.full_name} — ${period(request)}${request.reason ? `\n${sanitizeText(request.reason, 200)}` : ''}`,
        link: '#/leave',
        data: { requestId: request.id, employeeId: employee.id, leaveType: request.kind },
        dedupeKey: `leave_requested:${request.id}`,
      })
    );
  });
}

/** @param {object} request ردیف «پس از تصمیم» (status = approved|rejected). غیر از این دو ⇒ بی‌اثر. */
function leaveDecided(request, { note = null } = {}) {
  return guard('leaveDecided', () => {
    if (!request || !['approved', 'rejected'].includes(request.status)) return [];
    const label = leaveLabel(request.kind);
    const approved = request.status === 'approved';
    const jobs = [
      send('leaveDecided', request.user_id, {
        type: approved ? 'leave_approved' : 'leave_rejected',
        title: `درخواست ${label} شما ${approved ? 'تأیید شد' : 'رد شد'}`,
        body: `${period(request)}${note ? `\nپاسخ: ${sanitizeText(note, 300)}` : ''}`,
        link: '#/leave',
        data: { requestId: request.id, status: request.status },
        dedupeKey: `leave_decided:${request.id}:${request.status}:${request.updated_at || ''}`,
      }),
    ];
    // جانشین فقط وقتی مرخصی «قطعی» شد خبردار می‌شود (S4-11b)
    if (approved && request.substitute_user_id) {
      const employee = usersRepository.findById(request.user_id);
      jobs.push(
        send('leaveSubstitute', request.substitute_user_id, {
          type: 'leave_substitute',
          title: `شما جانشین ${employee ? employee.full_name : 'همکار'} هستید`,
          body: `${label} تأییدشده: ${period(request)}`,
          link: '#/leave',
          data: { requestId: request.id, employeeId: request.user_id },
          dedupeKey: `leave_substitute:${request.id}`,
        })
      );
    }
    return jobs;
  });
}

/** پس از تأیید مرحله‌ی میانی؛ request = ردیف «پس از تصمیم» (هنوز pending با current_step بعدی). */
function leaveStepAdvanced(request) {
  return guard('leaveStepAdvanced', () => {
    if (!request || request.status !== 'pending' || !request.current_step) return [];
    const employee = usersRepository.findById(request.user_id);
    if (!employee) return [];
    const label = leaveLabel(request.kind);
    return approversOf(request, employee).map((a) =>
      notify(a.id, {
        type: 'leave_requested',
        title: `درخواست ${label} منتظر تأیید شماست`,
        body: `${employee.full_name} — ${period(request)} (مرحله ${request.current_step})`,
        link: '#/leave',
        data: { requestId: request.id, employeeId: employee.id, step: request.current_step },
        dedupeKey: `leave_step:${request.id}:${request.current_step}`,
        telegram: true,
      }).catch((err) => { logError('leaveStepAdvanced', err); return null; })
    );
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

/**
 * پیام تلگرامِ «اعتراض شما بسته شد» به کارمند (مسیر مشترکِ پنل و بات؛ همان متن قبلی) + دکمه‌ی باز کردن مستقیم همان گفت‌وگو.
 * خطا هرگز استثنا نمی‌دهد. اعلان درون‌پنلی جدا با disputeResolved است.
 * @param {{id: number, user_id: number}} dispute
 * @param {{note?: string|null, actor?: {role?: string}}} [opts]
 */
function disputeResolvedTelegram(dispute, { note = null, actor = null } = {}) {
  return guard('disputeResolvedTelegram', () => {
    const employee = dispute ? usersRepository.findById(dispute.user_id) : null;
    if (!employee || !employee.telegram_user_id) return [];
    const who = actor && actor.role === 'admin' ? 'ادمین' : 'سرپرست';
    const text = `اعتراض شما بررسی و بسته شد ✅${note ? `\nپاسخ ${who}: ${note}` : ''}`;
    const btn = panelLinks.disputeButton(dispute.id);
    const options = btn ? { reply_markup: { inline_keyboard: [[btn]] } } : undefined;
    return [Promise.resolve(sendMessage(employee.telegram_user_id, text, options)).catch((err) => { logError('disputeResolvedTelegram', err); return null; })];
  });
}

/**
 * پیام تازه‌ی ادمین/سرپرست در گفت‌وگوی اعتراض (D4) ⇒ اعلان درون‌پنلی + تلگرام به خودِ کارمند (مثل reportCommented؛ مسیر تلگرامِ جدا ندارد).
 * dedupeKey = شناسه‌ی پیام: ثبت مجدد همان پیام اعلان تکراری نمی‌سازد، هر پیام تازه اعلان تازه می‌دهد.
 * بستن اعتراض اینجا نیست (disputeResolved + تلگرام مسیر خودش را دارد؛ پیام پایانی دوبار اعلام نمی‌شود).
 * @param {{id: number, user_id: number}} dispute
 * @param {{id: number, message: string}} message پیام ثبت‌شده
 * @param {{actor?: {role?: string}}} [opts]
 */
function disputeAdminMessage(dispute, message, { actor = null } = {}) {
  return guard('disputeAdminMessage', () => {
    if (!dispute || !message || message.id == null) return [];
    const who = actor && actor.role === 'admin' ? 'ادمین' : 'سرپرست';
    return [
      send('disputeAdminMessage', dispute.user_id, {
        type: 'dispute_admin_message',
        title: 'پاسخ تازه به اعتراض شما',
        body: `پاسخ ${who}: ${sanitizeText(message.message || '', 300)}`,
        link: '#/disputes',
        data: { disputeId: dispute.id, messageId: message.id },
        dedupeKey: `dispute_admin_message:${message.id}`,
        telegram: true,
        telegramButton: panelLinks.disputeButton(dispute.id) || undefined, // لینک مستقیم به همان گفت‌وگو
      }),
    ];
  });
}

/**
 * پیام تازه‌ی کارمند در اعتراض (یا «ادامه‌ی اعتراض»، reopened) (D4) ⇒ تأییدکننده‌ها (مدیر مستقیم‌ِ فعال؛ وگرنه ادمین‌های فعال) مثل disputeOpened؛ فقط پنل.
 * @param {{id: number, user_id: number}} dispute
 * @param {{id: number, message: string}} message پیام ثبت‌شده
 * @param {{reopened?: boolean}} [opts]
 */
function disputeUserMessage(dispute, message, { reopened = false } = {}) {
  return guard('disputeUserMessage', () => {
    if (!dispute || !message || message.id == null) return [];
    const employee = usersRepository.findById(dispute.user_id);
    if (!employee) return [];
    return handlersOf(employee).map((h) =>
      send('disputeUserMessage', h.id, {
        type: 'dispute_user_message',
        title: reopened ? 'کارمند اعتراض را ادامه داد' : 'پیام تازه در اعتراض',
        body: `${employee.full_name}: ${sanitizeText(message.message || '', 200)}`,
        link: '#/disputes',
        data: { disputeId: dispute.id, employeeId: employee.id, messageId: message.id, reopened: !!reopened },
        dedupeKey: `dispute_user_message:${message.id}`,
      })
    );
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

/** تغییر برنامه‌ی هفتگیِ «ثبت‌شده» توسط کارمند ⇒ اعلان به سرپرست (یا ادمین‌ها). */
function weeklyPlanChanged(employee, plan, summary = {}) {
  return guard('weeklyPlanChanged', () => handlersOf(employee).map((h) => send('weeklyPlanChanged', h.id, {
    type: 'weekly_plan_changed',
    title: 'برنامه‌ی هفتگی تغییر کرد',
    body: `${employee.full_name} برنامه‌ی هفته‌ی ${plan.week_start_date} را پس از ثبت تغییر داد (افزوده ${summary.added || 0}، ویرایش ${summary.edited || 0}، حذف ${summary.removed || 0}).`,
    link: '#/plans',
    data: { planId: plan.id, employeeId: employee.id },
    dedupeKey: `weekly_plan_changed:${plan.id}:${new Date().toISOString().slice(0, 16)}`, // حداکثر یک اعلان در دقیقه
  })));
}

const REACTION_LABEL = { like: '👍 پسندید', great: '🌟 عالی بود', thanks: '🙏 ممنون' };

/**
 * سرپرست روی گزارش روزانه‌ی کارمند کامنت گذاشت (D9-ب) ⇒ اعلان درون‌پنلی + تلگرام به خودِ کارمند.
 * dedupeKey شامل خلاصه‌ی متن است: ثبت مجدد همان کامنت اعلان تکراری نمی‌سازد؛ ویرایش کامنت اعلان تازه می‌دهد.
 * @param {{reviewer: object, subject: object, reportDate: string, comment: string, reaction?: string|null}} p
 */
function reportCommented({ reviewer, subject, reportDate, comment, reaction = null }) {
  return guard('reportCommented', () => {
    if (!reviewer || !subject || !comment || subject.id === reviewer.id) return [];
    const digest = crypto.createHash('sha1').update(String(comment)).digest('hex').slice(0, 10);
    const when = isoDateToJalaliString(reportDate) || reportDate;
    const lines = [`${reviewer.full_name} گزارش روز ${when} شما را مشاهده کرد و نوشت:`, `«${sanitizeText(comment, 300)}»`];
    if (reaction && REACTION_LABEL[reaction]) lines.push(REACTION_LABEL[reaction]);
    return [send('reportCommented', subject.id, {
      type: 'report_commented',
      title: 'کامنت سرپرست روی گزارش شما',
      body: lines.join('\n'),
      data: { reviewerId: reviewer.id, reportDate },
      dedupeKey: `report_commented:${reviewer.id}:${subject.id}:${reportDate}:${digest}`,
      telegram: true,
    })];
  });
}

// ---------- تسک فوری (فاز ۱۲، E1) ----------
const jalaliOf = (iso) => isoDateToJalaliString(iso) || iso;

function urgentButton() {
  const url = panelLinks.miniAppLink({ view: 'today' }); // لینک مستقیم به صفحه‌ی اصلیِ Mini App (لیست امروز)؛ view ناشناخته ⇒ صفحه‌ی اصلی
  return url && panelLinks.canUseWebApp(url) ? { text: '📋 باز کردن لیست امروز', web_app: { url } } : undefined;
}

/**
 * تسک فوریِ تازه ⇒ اعلان پنل + تلگرام به کارمند: «📌 تسک فوری از طرف …: …». dedupeKey = شناسه‌ی تسک.
 * @param {{task: {id: number, title: string, planned_date: string, urgent_deadline_time?: string|null, urgent_note?: string|null}, employee: {id: number}, actor: {full_name?: string}}} p
 */
function urgentTaskAssigned({ task, employee, actor }) {
  return guard('urgentTaskAssigned', () => {
    if (!task || !employee || !actor) return [];
    const lines = [`📌 تسک فوری از طرف ${actor.full_name || 'مدیر'}: ${sanitizeText(task.title, 120)}`, `تاریخ: ${jalaliOf(task.planned_date)}`];
    if (task.urgent_deadline_time) lines.push(`مهلت: ساعت ${task.urgent_deadline_time}`);
    if (task.urgent_note) lines.push(`توضیح: ${sanitizeText(task.urgent_note, 300)}`);
    return [send('urgentTaskAssigned', employee.id, {
      type: 'urgent_task_assigned',
      title: '📌 تسک فوری',
      body: lines.join('\n'),
      link: '#/today',
      data: { taskId: task.id, date: task.planned_date, assignedBy: actor.id || null },
      dedupeKey: `urgent_task_assigned:${task.id}`,
      telegram: true,
      telegramButton: urgentButton(),
    })];
  });
}

/** یادآوری قبل از مهلتِ ساعتیِ تسک فوری (job: urgentTaskReminder). dedupeKey = تسک + روز ⇒ هر تسک فقط یک‌بار. */
function urgentTaskReminder({ task, employeeId, minutesLeft }) {
  return guard('urgentTaskReminder', () => {
    if (!task || !employeeId) return [];
    return [send('urgentTaskReminder', employeeId, {
      type: 'urgent_task_reminder',
      title: '⏰ مهلت تسک فوری نزدیک است',
      body: `«${sanitizeText(task.title, 120)}» تا ساعت ${task.urgent_deadline_time}${minutesLeft > 0 ? ` (حدود ${minutesLeft} دقیقه‌ی دیگر)` : ''} باید انجام شود.`,
      link: '#/today',
      data: { taskId: task.id, date: task.planned_date },
      dedupeKey: `urgent_task_reminder:${task.id}:${task.planned_date}`,
      telegram: true,
      telegramButton: urgentButton(),
    })];
  });
}

// ---------- اجازه‌ی ورود (فاز ۱۲، D3) ----------
const CHECKIN_PERMISSION_LINK = '#/checkin_permissions';

// ساعت HH:MM به وقت شرکت (timezone تنظیمات)؛ خطا ⇒ null
function hhmmInCompanyZone(iso) {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: settingsRepository.getAll().timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
  } catch (_) {
    return null;
  }
}

/**
 * درخواست تازه‌ی اجازه‌ی ورود ⇒ سرپرست مستقیمِ فعال (وگرنه ادمین‌های فعال؛ همان handlersOf): اعلان پنل + تلگرام با دکمه‌های «✅ اجازه می‌دهم / ❌ رد»
 * (callback: cp_ok:<id> | cp_no:<id>، پردازش در bot/commands/checkinPermission.js). hr اعلان نمی‌گیرد (فقط‌خواندنی). dedupeKey = شناسه‌ی درخواست.
 * @param {{id: number, userId: number, reason: string}} permission نمای lateLimitService (camelCase)
 */
function checkinPermissionRequested(permission) {
  return guard('checkinPermissionRequested', () => {
    if (!permission || permission.id == null) return [];
    const employee = usersRepository.findById(permission.userId);
    if (!employee) return [];
    let counts = '';
    try {
      const m = lateLimitService.monthSummary(employee.id);
      if (m.limit > 0) counts = `\nتأخیر این ماه: ${m.lateCount} از ${m.limit}`;
    } catch (err) {
      logError('checkinPermissionRequested(count)', err); // شمارش شکست بخورد، اعلان می‌رود
    }
    const keyboard = [[
      { text: '✅ اجازه می‌دهم', callback_data: `cp_ok:${permission.id}` },
      { text: '❌ رد', callback_data: `cp_no:${permission.id}` },
    ]];
    return handlersOf(employee).map((h) =>
      send('checkinPermissionRequested', h.id, {
        type: 'checkin_permission_requested',
        title: 'درخواست اجازه‌ی ورود',
        body: `${employee.full_name} برای ثبت ورود امروز اجازه می‌خواهد.\nعلت: ${sanitizeText(permission.reason || '', 200)}${counts}`,
        link: CHECKIN_PERMISSION_LINK,
        data: { permissionId: permission.id, employeeId: employee.id },
        dedupeKey: `checkin_permission_requested:${permission.id}`,
        telegram: true,
        telegramKeyboard: keyboard,
      })
    );
  });
}

/**
 * تصمیم سرپرست/ادمین روی اجازه‌ی ورود ⇒ اعلان پنل + تلگرام به خودِ کارمند. غیر از approved|rejected ⇒ بی‌اثر.
 * تأیید: ساعتِ پایانِ اعتبار (expiresAt) در متن می‌آید و (روی https) دکمه‌ی باز کردن Mini App برای ثبت ورود.
 * @param {{id: number, userId: number, status: string, expiresAt?: string|null}} permission
 * @param {{actor?: {role?: string}, note?: string|null}} [opts]
 */
function checkinPermissionDecided(permission, { actor = null, note = null } = {}) {
  return guard('checkinPermissionDecided', () => {
    if (!permission || !['approved', 'rejected'].includes(permission.status)) return [];
    const approved = permission.status === 'approved';
    const who = actor && actor.role === 'admin' ? 'ادمین' : 'سرپرست';
    const until = approved && permission.expiresAt ? hhmmInCompanyZone(permission.expiresAt) : null;
    const lines = [approved
      ? `اکنون می‌توانید ورود خود را ثبت کنید${until ? ` (تا ساعت ${until} معتبر است)` : ''}.`
      : 'ورود شما با این درخواست ثبت نمی‌شود؛ با سرپرست خود هماهنگ کنید.'];
    if (note) lines.push(`پاسخ ${who}: ${sanitizeText(note, 300)}`);
    const url = approved ? panelLinks.miniAppLink() : null;
    return [
      send('checkinPermissionDecided', permission.userId, {
        type: approved ? 'checkin_permission_approved' : 'checkin_permission_rejected',
        title: approved ? 'اجازه‌ی ورود شما تأیید شد' : 'درخواست اجازه‌ی ورود شما رد شد',
        body: lines.join('\n'),
        data: { permissionId: permission.id, status: permission.status },
        dedupeKey: `checkin_permission_decided:${permission.id}:${permission.status}`,
        telegram: true,
        telegramButton: url && panelLinks.canUseWebApp(url) ? { text: '🕘 ثبت ورود', web_app: { url } } : undefined,
      }),
    ];
  });
}

module.exports = { urgentTaskAssigned, urgentTaskReminder, checkinPermissionRequested, checkinPermissionDecided, reportCommented, weeklyPlanChanged, leaveRequested, leaveStepAdvanced, leaveDecided, disputeOpened, disputeResolved, disputeResolvedTelegram, disputeAdminMessage, disputeUserMessage, systemAlert, suspiciousCreated };

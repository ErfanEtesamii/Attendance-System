// Job یادآوری/ارجاع تأیید مرخصی (S4-11c). هر اجرا درخواست‌های pending دارای زنجیره را مرور می‌کند:
//   • مرحله‌ی «manager»:
//       - سرپرست امروز مرخصی/مأموریت تأییدشده‌ی روزانه یا نیم‌روز دارد (leaveEscalateWhenApproverOnLeave روشن) ⇒ همان لحظه ارجاع به admin.
//       - وگرنه اگر از شروع مرحله بیش از leaveApprovalReminderHours (T) گذشته ⇒ یادآوری به سرپرست (یک بار برای هر مرحله).
//         سپس اگر از یادآوری بیش از leaveApprovalEscalateHours (E) گذشته و هنوز بی‌اقدام است ⇒ ارجاع به admin (مرحله به admin می‌رسد).
//   • مرحله‌ی «admin» یا «hr»: فقط یادآوری بعد از T ساعت به همان نقش (ارجاع ندارد).
// شروع مرحله: مرحله‌ی ۱ = created_at درخواست؛ مرحله‌ی n = زمان تصمیم مرحله‌ی n−۱.
// «یک بار یادآوری» بدون جدول تازه: ردیف اعلان با dedupeKey = leave_reminder:<id>:<step> (و created_at آن مبنای E است).
// همه‌ی تنظیمات پیش‌فرض خاموش‌اند ⇒ Job کاری نمی‌کند. خطای یک درخواست بقیه را نمی‌شکند. هیچ تصمیمی (تأیید/رد) خودکار گرفته نمی‌شود.
// now تزریق‌پذیر برای تست. خروجی: { skipped?, checked, reminded, escalated, errors }

const leaveRepository = require('../../repositories/leaveRepository');
const usersRepository = require('../../repositories/usersRepository');
const settingsRepository = require('../../repositories/settingsRepository');
const notificationsRepository = require('../../repositories/notificationsRepository');
const auditRepository = require('../../repositories/auditRepository');
const leaveApprovalService = require('../../services/leaveApprovalService');
const { notify } = require('../../services/notificationService');
const { todayInZone } = require('../../utils/time');
const { sanitizeText } = require('../../utils/sanitize');

const HOUR = 3600000;
const toMs = (s) => (typeof s === 'string' ? Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s.replace(' ', 'T')}Z`) : NaN);

function recipientsOf(role, employee) {
  const active = usersRepository.listUsers({ onlyActive: true });
  if (role === 'admin') return active.filter((u) => u.role === 'admin' && u.id !== employee.id);
  if (role === 'hr') return active.filter((u) => u.role === 'hr' && u.id !== employee.id);
  const manager = employee.manager_id ? usersRepository.findById(employee.manager_id) : null;
  return manager && manager.is_active ? [manager] : [];
}

const period = (r) => (r.start_date === r.end_date ? r.start_date : `${r.start_date} تا ${r.end_date}`);
const label = (r) => (r.kind === 'mission' ? 'مأموریت' : 'مرخصی');

function onLeaveToday(userId, today) {
  return leaveRepository.listApprovedOnDate(userId, today).some((r) => r.unit !== 'hour');
}

async function runLeaveApprovalReminder({ now = new Date() } = {}) {
  const s = settingsRepository.getAll();
  const T = s.leaveApprovalReminderHours;
  const E = s.leaveApprovalEscalateHours;
  const onLeaveRule = s.leaveEscalateWhenApproverOnLeave;
  const out = { checked: 0, reminded: 0, escalated: 0, errors: 0 };
  if (!(T > 0) && !(E > 0) && !onLeaveRule) return { ...out, skipped: true };

  const today = todayInZone(s.timezone, now);
  const pending = leaveRepository.listPending().filter((r) => r.current_step);
  for (const request of pending) {
    out.checked += 1;
    try {
      const employee = usersRepository.findById(request.user_id);
      const chain = leaveApprovalService.getChain(request.id);
      const row = chain.find((c) => c.step === request.current_step);
      if (!employee || !row || row.status !== 'pending') continue;
      const startedMs = request.current_step === 1 ? toMs(request.created_at) : toMs((chain.find((c) => c.step === request.current_step - 1) || {}).decidedAt);
      const ageH = Number.isFinite(startedMs) ? (now.getTime() - startedMs) / HOUR : 0;

      const escalate = async (reason) => {
        const res = leaveApprovalService.escalateToAdmin(request.id);
        if (!res.ok) return;
        out.escalated += 1;
        auditRepository.logChange({
          actor: null,
          action: 'leave_request_escalated',
          entityType: 'leave_request',
          entityId: request.id,
          before: { approver_role: 'manager' },
          after: { approver_role: 'admin' },
          reason,
          meta: { requestId: request.id, targetUserId: request.user_id, step: res.step },
        });
        for (const a of recipientsOf('admin', employee)) {
          await notify(a.id, {
            type: 'leave_requested',
            title: `ارجاع: درخواست ${label(request)} منتظر تأیید شماست`,
            body: `${employee.full_name} — ${period(request)}\n${reason}`,
            link: '#/leave',
            data: { requestId: request.id, employeeId: employee.id, escalated: true },
            dedupeKey: `leave_escalated:${request.id}:${row.step}`,
            telegram: true,
          });
        }
      };
      const remind = async (users, key) => {
        let sent = false;
        for (const u of users) {
          const res = await notify(u.id, {
            type: 'leave_requested',
            title: `یادآوری: درخواست ${label(request)} هنوز منتظر تأیید شماست`,
            body: `${employee.full_name} — ${period(request)}`,
            link: '#/leave',
            data: { requestId: request.id, employeeId: employee.id, reminder: true },
            dedupeKey: key,
            telegram: true,
          });
          if (res && res.created) sent = true;
        }
        if (sent) out.reminded += 1;
      };

      const key = `leave_reminder:${request.id}:${row.step}`;
      if (row.approverRole === 'manager') {
        const manager = recipientsOf('manager', employee)[0];
        if (onLeaveRule && manager && onLeaveToday(manager.id, today)) { await escalate('سرپرست در مرخصی/مأموریت تأییدشده است'); continue; }
        if (!manager) continue;
        if (T > 0 && ageH >= T) {
          const existing = notificationsRepository.findByDedupe(manager.id, key);
          if (!existing) await remind([manager], key);
          else if (E > 0 && (now.getTime() - toMs(existing.created_at)) / HOUR >= E) await escalate(`سرپرست پس از یادآوری ${E} ساعت اقدام نکرد`);
        }
      } else if (T > 0 && ageH >= T) {
        await remind(recipientsOf(row.approverRole, employee), key);
      }
    } catch (err) {
      out.errors += 1;
      console.error('[leaveApprovalReminder] خطا برای درخواست', request.id, sanitizeText(err && err.message ? err.message : String(err), 200));
    }
  }
  return out;
}

module.exports = { runLeaveApprovalReminder };

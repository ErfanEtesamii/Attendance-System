// Job یادآوری تأیید مرخصی/ماموریت. ارجاع خودکار به ادمین حذف شده: ادمین‌ها از لحظه‌ی ثبت خودشان تأییدکننده‌اند.
//   • مرخصی/ماموریتِ pending: اگر از ثبت بیش از leaveApprovalReminderHours (T) گذشته ⇒ یک بار یادآوری به سرپرست مستقیم + ادمین‌های فعال
//     (کارمندِ بدون سرپرست ⇒ فقط ادمین‌ها). ۰ = خاموش.
//   • ماموریت: مستقل از T، از ساعت MISSION_REMINDER_HOUR روزِ بعد از ثبت، اگر هنوز بی‌پاسخ است ⇒ یک بار یادآوری (dedupe).
// «یک بار یادآوری» بدون جدول تازه: ردیف اعلان با dedupeKey = leave_reminder:<id> / mission_reminder:<id>. هیچ تصمیمی خودکار گرفته نمی‌شود.
// now تزریق‌پذیر برای تست. خروجی: { skipped?, checked, reminded, errors }

const leaveRepository = require('../../repositories/leaveRepository');
const usersRepository = require('../../repositories/usersRepository');
const settingsRepository = require('../../repositories/settingsRepository');
const { notify } = require('../../services/notificationService');
const { todayInZone } = require('../../utils/time');
const { sanitizeText } = require('../../utils/sanitize');

const { isAdmin } = require('../../utils/roles');
const HOUR = 3600000;
const toMs = (s) => (typeof s === 'string' ? Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s.replace(' ', 'T')}Z`) : NaN);

// گیرنده‌ها: سرپرست مستقیمِ فعال + همه‌ی ادمین‌های فعال (بدون خودِ کارمند و بدون تکرار)
function recipientsOf(employee) {
  const active = usersRepository.listUsers({ onlyActive: true, includeOwner: true });
  const manager = require('../../services/leaveApprovalService').decidingSupervisorOf(employee); // فاز B: بدون leave.approve ⇒ فقط ادمین‌ها
  const deputy = require('../../services/leaveApprovalService').decidingDeputyOf(employee); // فاز D (بخش ۲): جانشینِ فعال علاوه بر سرپرست
  const list = [...(manager ? [manager] : []), ...(deputy ? [deputy] : []), ...active.filter((u) => isAdmin(u))];
  const seen = new Set();
  return list.filter((u) => u.id !== employee.id && !seen.has(u.id) && seen.add(u.id));
}

const period = (r) => (r.start_date === r.end_date ? r.start_date : `${r.start_date} تا ${r.end_date}`);
const label = (r) => (r.kind === 'mission' ? 'مأموریت' : 'مرخصی');

const MISSION_REMINDER_HOUR = 10;

async function remindAll(request, employee, key, out) {
  let sent = false;
  for (const u of recipientsOf(employee)) {
    const res = await notify(u.id, {
      type: 'leave_requested',
      title: `یادآوری: درخواست ${label(request)} هنوز منتظر تأیید است`,
      body: `${employee.full_name} — ${period(request)}`,
      link: '#/leave',
      data: { requestId: request.id, employeeId: employee.id, reminder: true },
      dedupeKey: key,
      telegram: true,
    });
    if (res && res.created) sent = true;
  }
  if (sent) out.reminded += 1;
}

// یادآوری ماموریت‌های منتظر — مستقل از تنظیم T (ماموریت قاعده‌ی ثابت دارد)
async function runMissionApprovalReminder({ now = new Date() } = {}) {
  const s = settingsRepository.getAll();
  const out = { checked: 0, reminded: 0, errors: 0 };
  const today = todayInZone(s.timezone, now);
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: s.timezone, hour: '2-digit', hourCycle: 'h23' }).format(now));
  const pending = leaveRepository.listQueue({ status: 'pending', kind: 'mission', limit: null }).rows;
  for (const request of pending) {
    out.checked += 1;
    try {
      const employee = usersRepository.findById(request.user_id);
      if (!employee) continue;
      const createdMs = toMs(request.created_at);
      const createdDay = Number.isFinite(createdMs) ? todayInZone(s.timezone, new Date(createdMs)) : today;
      if (hour >= MISSION_REMINDER_HOUR && createdDay < today) await remindAll(request, employee, `mission_reminder:${request.id}`, out);
    } catch (err) {
      out.errors += 1;
      console.error('[missionApprovalReminder] خطا برای درخواست', request.id, sanitizeText(err && err.message ? err.message : String(err), 200));
    }
  }
  return out;
}

async function runLeaveApprovalReminder({ now = new Date() } = {}) {
  const missions = await runMissionApprovalReminder({ now }); // C4: شکل خروجیِ قبلی حفظ می‌شود؛ شمارنده‌ی ماموریت فقط لاگ می‌شود
  if (missions.reminded || missions.errors) console.log('[leaveApprovalReminder] ماموریت:', JSON.stringify(missions));
  return runGeneralLeaveApprovalReminder({ now });
}

async function runGeneralLeaveApprovalReminder({ now = new Date() } = {}) {
  const s = settingsRepository.getAll();
  const T = s.leaveApprovalReminderHours;
  const out = { checked: 0, reminded: 0, errors: 0 };
  if (!(T > 0)) return { ...out, skipped: true };

  const pending = leaveRepository.listPending().filter((r) => r.kind !== 'mission');
  for (const request of pending) {
    out.checked += 1;
    try {
      const employee = usersRepository.findById(request.user_id);
      if (!employee) continue;
      const startedMs = toMs(request.created_at);
      const ageH = Number.isFinite(startedMs) ? (now.getTime() - startedMs) / HOUR : 0;
      if (ageH >= T) await remindAll(request, employee, `leave_reminder:${request.id}`, out);
    } catch (err) {
      out.errors += 1;
      console.error('[leaveApprovalReminder] خطا برای درخواست', request.id, sanitizeText(err && err.message ? err.message : String(err), 200));
    }
  }
  return out;
}

module.exports = { runLeaveApprovalReminder, runMissionApprovalReminder };

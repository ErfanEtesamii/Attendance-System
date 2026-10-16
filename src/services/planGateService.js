// گیت خروج برنامه‌ی هفتگی (D5): «بدون برنامه‌ی هفته‌ی بعد، خروجِ روزِ ثبت برنامه ثبت نمی‌شود.»
// همه‌ی تصمیم‌ها سمت سرور است؛ UI فقط کاربر را به ویزارد می‌برد و خروج را دوباره می‌فرستد.
//   • فعال‌شدن: planGateMode ≠ off و تاریخ رکورد ≥ planGateStartDate (اگر پر باشد).
//   • «روز ثبت» = getPlanDay(کاربر، هفته‌ی تاریخ رکورد). گیت از همان روز تا آخر همان هفته فعال است (یعنی اگر روز ثبت خروج نزد، اولین خروجِ بعدی هم گیت می‌شود).
//   • برآورده‌شدن: برنامه‌ی هفته‌ی بعد submitted و دست‌کم planMinTasks تسک (غیرسیستمی، حذف‌نشده) دارد.
//   • ماهِ بسته ⇒ ثبت برنامه ممکن نیست ⇒ گیت اعمال نمی‌شود. روز ثبت وجود ندارد (مرخصی/تعطیلیِ کل هفته) ⇒ اعمال نمی‌شود.
//   • معافیت یک‌باره (ادمین/سرپرست با علت): خروج مجاز و معافیت مصرف می‌شود.
//   • enforce ⇒ block، soft ⇒ remind (خروج ثبت می‌شود + یادآوری)، off ⇒ allow.
//   • «آخرین فرصت» (planGateWarnWeekday، پیش‌فرض چهارشنبه): اگر آن روز قبل از روز ثبت باشد و برنامه ثبت نشده، خروج فقط با تأیید صریح کاربر (confirmPlanDeadline) ثبت می‌شود (action = confirm).
const settingsRepository = require('../repositories/settingsRepository');
const plansRepo = require('../repositories/weeklyPlanRepository');
const exemptionsRepo = require('../repositories/planGateRepository');
const monthClosuresRepository = require('../repositories/monthClosuresRepository');
const attendanceRepository = require('../repositories/attendanceRepository');
const auditRepository = require('../repositories/auditRepository');
const calendarService = require('../engine/calendarService');
const { addDays } = require('../utils/shiftDay');

function planSatisfied(userId, weekStart, minTasks) {
  const plan = plansRepo.findByUserWeek(userId, weekStart);
  if (!plan || plan.status !== 'submitted') return false;
  const count = plansRepo.listTasks(plan.id).filter((t) => !t.is_system && !t.is_urgent).length;
  return count >= Math.max(0, minTasks);
}

/** وضعیت گیت برای کاربر در تاریخِ رکورد. هرگز چیزی نمی‌نویسد. */
function evaluate(user, recordDate, { settings } = {}) {
  const s = settings || settingsRepository.getAll();
  const mode = s.planGateMode;
  const base = { applies: false, warn: false, mode, satisfied: false, exemption: null, weekStart: null, planDay: null };
  if (mode !== 'enforce' && mode !== 'soft') return base;
  if (s.planGateStartDate && recordDate < s.planGateStartDate) return base;
  const thisWeek = calendarService.weekStartOf(recordDate, s.weekStartDay);
  const weekStart = addDays(thisWeek, 7);
  const planDay = calendarService.getPlanDay(user, thisWeek, { settings: s });
  const out = { ...base, weekStart, planDay };
  if (!planDay) return out;
  if (monthClosuresRepository.findClosedOverlapping(weekStart, addDays(weekStart, 6)).length > 0) return out;
  if (recordDate < planDay) {
    // روز «آخرین فرصت» (پیش از روز ثبت): فقط هشدار/تأیید، نه مسدودسازی
    const warnDay = s.planGateWarnWeekday;
    if (warnDay && warnDay !== 'off' && calendarService.weekdayOf(recordDate) === Number(warnDay)
      && !planSatisfied(user.id, weekStart, s.planMinTasks)) out.warn = true;
    return out;
  }
  out.applies = true;
  out.satisfied = planSatisfied(user.id, weekStart, s.planMinTasks);
  out.exemption = out.satisfied ? null : exemptionsRepo.findUnused(user.id, weekStart);
  return out;
}

/**
 * تصمیم برای خروج: { action: 'allow'|'block'|'remind'|'confirm', exemptionId?, info }
 * خطای داخلی ⇒ allow (fail-open): خرابیِ گیت نباید ثبت تردد را بشکند.
 */
function check(user, recordDate) {
  try {
    const info = evaluate(user, recordDate);
    if (info.warn && !info.applies) return { action: 'confirm', info };
    if (!info.applies || info.satisfied) return { action: 'allow', info };
    if (info.exemption) return { action: 'allow', exemptionId: info.exemption.id, info };
    return { action: info.mode === 'enforce' ? 'block' : 'remind', info };
  } catch (err) {
    console.error('[planGate] خطا (نادیده گرفته شد، خروج مجاز):', err && err.message ? err.message : err);
    return { action: 'allow', info: null };
  }
}

/** مصرف معافیت بعد از ثبتِ موفق خروج (idempotent). */
function consumeExemption(user, gate, record, ip) {
  if (!gate || !gate.exemptionId) return false;
  try {
    const used = exemptionsRepo.consume(gate.exemptionId, record.id);
    if (used) auditRepository.logEvent({ userId: user.id, action: 'plan_gate_exemption_used', ipAddress: ip, details: { exemptionId: gate.exemptionId, recordId: record.id, weekStart: gate.info && gate.info.weekStart } });
    return used;
  } catch (err) {
    console.error('[planGate] مصرف معافیت ناموفق:', err.message);
    return false;
  }
}

/** معافیت یک‌باره برای هفته‌ی بعدِ «امروز»ِ کاربر. اجازه/اسکوپ را route بررسی می‌کند. */
function grantExemption({ user, grantedBy, reason, today }) {
  const s = settingsRepository.getAll();
  const weekStart = addDays(calendarService.weekStartOf(today, s.weekStartDay), 7);
  const existing = exemptionsRepo.find(user.id, weekStart);
  if (existing) return { ok: false, code: existing.used_at ? 'EXEMPTION_USED' : 'EXEMPTION_EXISTS', exemption: existing };
  const exemption = exemptionsRepo.create({ userId: user.id, weekStart, grantedBy: grantedBy.id, reason });
  auditRepository.logEvent({ userId: grantedBy.id, action: 'plan_gate_exemption_granted', details: { targetUserId: user.id, weekStart, reason, exemptionId: exemption.id } });
  return { ok: true, exemption };
}

/**
 * وضعیت برای UI: آیا امروز گیت می‌شود؟ و «بنر اجباری روز بعد»:
 * اگر روز ثبتِ هفته‌ی قبل خروجِ خودکار بسته شد (رکورد ناقص) و برنامه‌ی همین هفته ثبت نشده، بنر نشان داده می‌شود.
 */
function status(user, today) {
  const s = settingsRepository.getAll();
  const info = evaluate(user, today, { settings: s });
  let banner = false;
  try {
    if ((s.planGateMode === 'enforce' || s.planGateMode === 'soft') && !(s.planGateStartDate && today < s.planGateStartDate)) {
      const thisWeek = calendarService.weekStartOf(today, s.weekStartDay);
      const prevWeek = addDays(thisWeek, -7);
      const prevPlanDay = calendarService.getPlanDay(user, prevWeek, { settings: s });
      const closed = monthClosuresRepository.findClosedOverlapping(thisWeek, addDays(thisWeek, 6)).length > 0;
      if (prevPlanDay && !closed && !planSatisfied(user.id, thisWeek, s.planMinTasks)) {
        banner = attendanceRepository.listByUserAndRange(user.id, prevPlanDay, addDays(prevWeek, 6))
          .some((r) => r.check_in_time && !r.check_out_time);
      }
    }
  } catch (err) { console.error('[planGate] بنر:', err.message); }
  return {
    mode: info.mode, applies: info.applies, warn: info.warn, satisfied: info.satisfied, exempt: !!info.exemption,
    weekStart: info.weekStart, planDay: info.planDay, banner,
    blocked: info.applies && !info.satisfied && !info.exemption && info.mode === 'enforce',
  };
}

module.exports = { evaluate, check, consumeExemption, grantExemption, status };

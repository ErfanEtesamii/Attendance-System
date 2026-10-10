// قفل ویرایش ماه بسته (S5-3c). نگهبان مشترک routeهایی که داده‌ی «محاسبه‌شونده‌ی ماه» را عوض می‌کنند
// (رکورد تردد/استراحت، تأیید اضافه‌کاری، مرخصی). بدون این، snapshot و داده‌ی زنده بی‌صدا از هم جدا می‌شدند.
//
// قاعده: اگر بازه‌ی تاریخِ عملیات با ماهِ «closed» هم‌پوشانی داشته باشد
//   • غیر-ادمین (سرپرست/hr/…): ۴۰۳ MONTH_CLOSED
//   • ادمین بدون دلیل: ۴۰۰ MONTH_CLOSED_REASON_REQUIRED
//   • ادمین با دلیل: مجاز؛ بعد از موفقیت route باید adjust() را صدا بزند (ردیف adjustment + audit)
// ماهِ «reopened» یا باز قفل نیست. snapshot هرگز بازنویسی نمی‌شود (فقط با reopen + بستن دوباره).
// ⚠️ ثبت ورود/خروج واقعی کارمند (بات/Mini App) برای «امروز» است و بازه‌ی ماه بسته را لمس نمی‌کند؛ پوشش داده نشده.

const monthClosuresRepository = require('../../../repositories/monthClosuresRepository');
const auditRepository = require('../../../repositories/auditRepository');

const MONTH_NAMES_ERR = (c) => `ماه ${c.jalali_year}/${String(c.jalali_month).padStart(2, '0')} بسته شده است`;

// ⇒ { locked:false } | { locked:true, ok:false, status, code, error } | { locked:true, ok:true, closure }
// (قابل‌استفاده بدون req/res: منطق خالص روی actor)
function evaluate({ actor, from, to, reason, bulk = false }) {
  const closed = monthClosuresRepository.findClosedOverlapping(from, to || from);
  if (!closed.length) return { locked: false };
  const c = closed[0];
  const label = MONTH_NAMES_ERR(c);
  if (!actor || actor.role !== 'admin') {
    return { locked: true, ok: false, status: 403, code: 'MONTH_CLOSED', error: `${label}؛ فقط ادمین می‌تواند با ذکر دلیل آن را اصلاح کند.` };
  }
  if (bulk) return { locked: true, ok: false, status: 409, code: 'MONTH_CLOSED', error: `${label}؛ اصلاح آن از صف دسته‌جمعی ممکن نیست (تک‌به‌تک با دلیل).` };
  if (!reason || !String(reason).trim()) {
    return { locked: true, ok: false, status: 400, code: 'MONTH_CLOSED_REASON_REQUIRED', error: `${label}؛ برای اصلاح، ذکر دلیل الزامی است.` };
  }
  return { locked: true, ok: true, closure: c, reason: String(reason).trim().slice(0, 500) };
}

// نسخه‌ی route: پاسخ خطا را می‌فرستد. ⇒ false (پاسخ داده شد؛ route باید return کند) | null (قفل نیست) | { closure, reason } (مجاز؛ بعد adjust بزنید)
function guard(req, res, { from, to, reason }) {
  const r = evaluate({ actor: req.adminUser, from, to, reason });
  if (!r.locked) return null;
  if (!r.ok) { res.status(r.status).json({ error: r.error, code: r.code }); return false; }
  return { closure: r.closure, reason: r.reason };
}

// ثبت اصلاح پس از موفقیت عملیات (adjustment + audit). lock = خروجی guard
function adjust(req, lock, { action, entityType, entityId = null, userId = null, date = null, details = null }) {
  if (!lock) return null;
  const row = monthClosuresRepository.addAdjustment({
    closureId: lock.closure.id, closeCount: lock.closure.close_count, action, entityType, entityId, userId,
    effectiveDate: date, reason: lock.reason, details, adjustedBy: req.adminUser.id,
  });
  auditRepository.logEvent({
    userId: req.adminUser.id,
    action: 'closed_month_adjustment',
    ipAddress: req.ip,
    details: { source: 'admin_panel', year: lock.closure.jalali_year, month: lock.closure.jalali_month, adjustmentId: row.id, adjustedAction: action, entityType, entityId, targetUserId: userId, date, reason: lock.reason },
  });
  return row;
}

module.exports = { evaluate, guard, adjust };

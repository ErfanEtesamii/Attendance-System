// ثبت و مدیریت «ماموریت» کارمند (C1). روی leaveService/leaveApprovalService سوار است؛ قواعد مدت، تداخل و زنجیره‌ی تأیید همان‌هاست.
//   • فقط نوع ماموریت (code='mission'، kind='mission')؛ واحد day|half_day|hour (محدودیت واحدِ نوع برای ماموریت اعمال نمی‌شود).
//   • بازه‌ی ثبت: missionBackdateDays (گذشته) و missionAdvanceDays (آینده)؛ قواعد گذشته/آینده/پیش‌اطلاع «مرخصی» برای ماموریت اعمال نمی‌شود.
//   • علت اجباری ۵–۳۰۰ نویسه؛ مقصد اختیاری ≤ ۱۰۰ نویسه.
//   • لغو: فقط صاحب درخواست و فقط تا قبل از تصمیم (pending)؛ ردیف حذف و در audit ثبت می‌شود.

const settingsRepository = require('../repositories/settingsRepository');
const leaveRepository = require('../repositories/leaveRepository');
const leaveTypesRepository = require('../repositories/leaveTypesRepository');
const leaveService = require('./leaveService');
const leaveApprovalService = require('./leaveApprovalService');
const attachmentService = require('./attachmentService');
const { sanitizeText } = require('../utils/sanitize');
const { dayDiff } = require('../utils/shiftDay');
const { todayInZone } = require('../utils/time');

const SOURCE_MINIAPP = 'miniapp_button';
const REASON_MIN = 5;
const REASON_MAX = 300;
const DEST_MAX = 100;

const err = (code, error) => ({ ok: false, errors: [{ code, error }], warnings: [] });

// حذف کاراکترهای کنترلی و فاصله‌های اضافی؛ بدون تگ‌زدایی (خروجی همه‌جا escape می‌شود)
function cleanText(value, max) {
  return sanitizeText(value, max + 1).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}

function missionType() {
  const t = leaveTypesRepository.findByCode('mission');
  return t && t.kind === 'mission' && t.isActive !== false ? t : null;
}

/** @returns {{ok:true, request, warnings} | {ok:false, errors, warnings}} */
function create(input = {}, { now } = {}) {
  const reason = cleanText(input.reason, REASON_MAX);
  if (reason.length < REASON_MIN) return err('REASON_TOO_SHORT', `علت ماموریت را حداقل ${REASON_MIN} نویسه بنویسید.`);
  if (reason.length > REASON_MAX) return err('REASON_TOO_LONG', `علت ماموریت حداکثر ${REASON_MAX} نویسه است.`);
  const destination = cleanText(input.destination, DEST_MAX);
  if (destination.length > DEST_MAX) return err('DESTINATION_TOO_LONG', `مقصد حداکثر ${DEST_MAX} نویسه است.`);

  const type = missionType();
  if (!type) return err('MISSION_TYPE_UNAVAILABLE', 'نوع «ماموریت» فعال نیست؛ با ادمین تماس بگیرید.');

  const unit = input.unit || 'day';
  if (!['day', 'half_day', 'hour'].includes(unit)) return err('INVALID_UNIT', 'واحد ماموریت باید روز، نیم‌روز یا ساعتی باشد.');
  if (!input.startDate) return err('START_REQUIRED', 'تاریخ شروع الزامی است.');

  const settings = settingsRepository.getAll();
  const today = todayInZone(settings.timezone, now instanceof Date ? now : new Date());
  const offset = typeof input.startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.startDate) ? dayDiff(input.startDate, today) : null;
  if (offset !== null) {
    if (offset < 0 && -offset > settings.missionBackdateDays) {
      return err('MISSION_PAST_TOO_FAR', settings.missionBackdateDays > 0 ? `ثبت ماموریت فقط تا ${settings.missionBackdateDays} روز قبل مجاز است.` : 'ثبت ماموریت برای گذشته مجاز نیست.');
    }
    if (offset > settings.missionAdvanceDays) return err('MISSION_FUTURE_TOO_FAR', `ثبت ماموریت فقط تا ${settings.missionAdvanceDays} روز جلوتر مجاز است.`);
  }

  const result = leaveService.create({
    userId: input.userId,
    leaveTypeId: type.id,
    unit,
    startDate: input.startDate,
    endDate: unit === 'day' ? (input.endDate || input.startDate) : input.startDate,
    halfDayPart: input.halfDayPart,
    startTime: input.startTime,
    endTime: input.endTime,
    reason,
    source: input.source || SOURCE_MINIAPP,
    destination: destination || undefined,
    attachment: input.attachment,
  }, { skip: ['past', 'future', 'notice', 'balance', 'attachment', 'unit'], now });
  return result;
}

// یادداشت سرپرست = آخرین یادداشت مرحله‌های تصمیم‌گرفته‌شده
function presentMission(r) {
  const chain = leaveApprovalService.getChain(r.id);
  const decided = chain.filter((s) => s.status !== 'pending' && s.note);
  return {
    id: r.id, status: r.status, unit: r.unit, startDate: r.start_date, endDate: r.end_date,
    halfDayPart: r.half_day_part, startTime: r.start_time, endTime: r.end_time, durationMinutes: r.duration_minutes,
    reason: r.reason, destination: r.destination || null, hasAttachment: !!r.attachment_id,
    managerNote: decided.length ? decided[decided.length - 1].note : null,
    createdAt: r.created_at,
    openNow: r.source === 'miniapp_now_open', // C6: پایانِ باز (ساعت پایان موقت = پایان شیفت)
    autoEnded: r.source === 'miniapp_now_auto',
  };
}

function listForUser(userId) {
  return leaveRepository.listMissionsByUser(userId).map(presentMission);
}

/** لغو تا قبل از تصمیم. @returns {{ok:true, request}|{ok:false, code, error}} */
async function cancel({ userId, requestId }) {
  const r = Number.isInteger(requestId) ? leaveRepository.findById(requestId) : null;
  if (!r || r.user_id !== userId || r.kind !== 'mission') return { ok: false, code: 'NOT_FOUND', error: 'ماموریت یافت نشد.' };
  if (r.status !== 'pending') return { ok: false, code: 'ALREADY_DECIDED', error: 'این ماموریت قبلاً بررسی شده و قابل لغو نیست.' };
  leaveRepository.remove(r.id); // زنجیره‌ی تأیید با CASCADE پاک می‌شود
  if (r.attachment_id) await attachmentService.remove(r.attachment_id);
  return { ok: true, request: r };
}

module.exports = { create, cancel, listForUser, presentMission, SOURCE_MINIAPP, REASON_MIN, REASON_MAX, DEST_MAX };

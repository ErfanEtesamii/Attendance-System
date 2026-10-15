// C1 (فاز ۱۲): سیاست «استراحت کوتاه با حقوق» برای نمایش در Mini App (محاسبه‌ی اصلی در engine/computeDay است؛ اینجا فقط خواندن سیاست و
// شماره‌ی استراحت جاری). مقدار شیفتِ مؤثر آن روز (paidBreakCount/paidBreakMinutes؛ null = سراسری) بر تنظیمات سراسری غالب است.
// پیش‌فرض هر دو ۰ ⇒ enabled=false و UI چیزی نشان نمی‌دهد (رفتار قبلی).
const settingsRepository = require('../repositories/settingsRepository');
const shiftsRepository = require('../repositories/shiftsRepository');

const pick = (shiftValue, settingValue) => {
  const v = shiftValue !== undefined && shiftValue !== null ? shiftValue : settingValue;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

// ⇒ { enabled, count, minutes }
function policyFor(userId, date, settings = null) {
  const s = settings || settingsRepository.getAll();
  const shift = date ? shiftsRepository.shiftOn(userId, date) : shiftsRepository.findByUserId(userId);
  const count = pick(shift && shift.paidBreakCount, s.paidBreakCount);
  const minutes = pick(shift && shift.paidBreakMinutes, s.paidBreakMinutes);
  return { enabled: count > 0 && minutes > 0, count, minutes };
}

// شماره‌ی یک استراحتِ کوتاه (۱‌مبنا) میان استراحت‌های کوتاهِ همان روز به ترتیب شروع؛ ناهار/ناموجود ⇒ null
function shortOrdinal(breaks, breakRow) {
  if (!breakRow || breakRow.break_type !== 'short_break') return null;
  const shorts = breaks.filter((b) => b.break_type === 'short_break').sort((a, b) => (a.start_time < b.start_time ? -1 : a.start_time > b.start_time ? 1 : a.id - b.id));
  const i = shorts.findIndex((b) => b.id === breakRow.id);
  return i < 0 ? null : i + 1;
}

// اطلاعات «با حقوق بودن» یک استراحت برای کلاینت؛ سیاست خاموش یا ناهار ⇒ null
// ⇒ { count, minutes, index, isPaid } — isPaid=false یعنی تعداد مجاز تمام شده و کل این استراحت از ساعت کاری کم می‌شود
function paidInfo(userId, date, breaks, breakRow, settings = null) {
  const policy = policyFor(userId, date, settings);
  if (!policy.enabled) return null;
  const index = shortOrdinal(breaks, breakRow);
  if (index === null) return null;
  return { count: policy.count, minutes: policy.minutes, index, isPaid: index <= policy.count };
}

module.exports = { policyFor, shortOrdinal, paidInfo };

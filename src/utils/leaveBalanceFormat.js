// S4-9b: منطق خالص مانده‌ی مرخصی — تبدیل «دقیقه» به روز/ساعت/دقیقه بر پایه‌ی طول روز کاری «همان کاربر»، و ارزیابی سیاست مانده.
// بدون DB. طول روز کاری را فراخواننده می‌دهد (leaveBalanceService.workDayMinutesOf: شیفت کاربر یا تنظیمات سراسری).

const POLICIES = ['block', 'warn', 'allow_negative'];
const FALLBACK_DAY_MINUTES = 480; // فقط وقتی ساعت‌های کاری قابل‌خواندن نیست (داده‌ی خراب)؛ قاعده‌ی تجاری نیست

const hhmm = (v) => {
  const m = typeof v === 'string' ? /^\s*(\d{1,2}):(\d{2})\s*$/.exec(v) : null;
  return m && Number(m[1]) <= 23 && Number(m[2]) <= 59 ? Number(m[1]) * 60 + Number(m[2]) : null;
};

// طول روز کاری (دقیقه) از ساعت شروع/پایان؛ پایان ≤ شروع ⇒ شیفت شب (عبور از نیمه‌شب). نامعتبر ⇒ null.
function dayLengthMinutes(start, end) {
  const s = hhmm(start);
  const e = hhmm(end);
  if (s === null || e === null) return null;
  const len = e > s ? e - s : e + 1440 - s;
  return len > 0 ? len : null;
}

// minutes (عدد صحیح، شاید منفی) ⇒ { negative, days, hours, minutes, text }؛ dayMinutes = طول روز کاری کاربر.
// ۱ روز = dayMinutes، ۱ ساعت = ۶۰ دقیقه؛ مثال با روز ۵۱۰ دقیقه: ۱۰۲۰ ⇒ «۲ روز»؛ ۶۰۰ ⇒ «۱ روز و ۱ ساعت و ۳۰ دقیقه».
function formatMinutes(minutes, dayMinutes) {
  if (!Number.isSafeInteger(minutes)) throw new RangeError('minutes باید عدد صحیح باشد.');
  if (!Number.isSafeInteger(dayMinutes) || dayMinutes <= 0) throw new RangeError('dayMinutes باید عدد صحیح مثبت باشد.');
  const negative = minutes < 0;
  let rest = Math.abs(minutes);
  const days = Math.floor(rest / dayMinutes);
  rest -= days * dayMinutes;
  const hours = Math.floor(rest / 60);
  const mins = rest - hours * 60;
  const parts = [];
  if (days) parts.push(`${days} روز`);
  if (hours) parts.push(`${hours} ساعت`);
  if (mins) parts.push(`${mins} دقیقه`);
  const body = parts.length ? parts.join(' و ') : '0 دقیقه';
  return { negative, days, hours, minutes: mins, text: negative && parts.length ? `منفی ${body}` : body };
}

// ارزیابی سیاست برای درخواستی به مدت requestedMinutes وقتی مانده‌ی فعلی remaining است (بدون اعمال؛ تصمیم با leaveService در S4-10a).
// ⇒ { allowed, warn, shortfall, remainingAfter }؛ shortfall = کسری (≥ ۰).
//   block ⇒ کسری دارد ⇒ allowed:false | warn ⇒ allowed:true, warn:true | allow_negative ⇒ allowed:true, warn:false
function evaluatePolicy(policy, remaining, requestedMinutes) {
  if (!POLICIES.includes(policy)) throw new RangeError(`سیاست نامعتبر است: ${policy}`);
  if (!Number.isSafeInteger(remaining) || !Number.isSafeInteger(requestedMinutes) || requestedMinutes < 0) throw new RangeError('remaining و requestedMinutes باید عدد صحیح (requested ≥ ۰) باشند.');
  const remainingAfter = remaining - requestedMinutes;
  const shortfall = remainingAfter < 0 ? -remainingAfter : 0;
  if (shortfall === 0) return { allowed: true, warn: false, shortfall, remainingAfter };
  if (policy === 'block') return { allowed: false, warn: false, shortfall, remainingAfter };
  return { allowed: true, warn: policy === 'warn', shortfall, remainingAfter };
}

module.exports = { POLICIES, FALLBACK_DAY_MINUTES, dayLengthMinutes, formatMinutes, evaluatePolicy };

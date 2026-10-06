// اعتبارسنجی خالص ورودی شیفت (S3-6a) — بدون دیتابیس. خروجی: { ok:true, value } یا { ok:false, error }.
// value با نام‌های camelCase و مقادیر نرمال‌شده است (HH:MM دو رقمی، workDays مرتب و یکتا، overnight بولین).

const FIELDS = ['name', 'startTime', 'endTime', 'graceLateMinutes', 'graceEarlyMinutes', 'workDays', 'overnight', 'maxLunchMinutes', 'fixedLunchDeductMinutes'];
const REQUIRED = ['name', 'startTime', 'endTime'];
const DEFAULTS = {
  graceLateMinutes: 0,
  graceEarlyMinutes: 0,
  workDays: [0, 1, 2, 3, 6], // شنبه تا چهارشنبه (۰=یکشنبه … ۶=شنبه؛ همیشه مرتب)؛ جمعه/پنجشنبه تعطیل — تقویم رسمی در S3-7
  overnight: false,
  maxLunchMinutes: 0,
  fixedLunchDeductMinutes: 0,
};
const MINUTE_LIMITS = {
  graceLateMinutes: [0, 720, 'مهلت تأخیر'],
  graceEarlyMinutes: [0, 720, 'مهلت زودتر رفتن'],
  maxLunchMinutes: [0, 480, 'حداکثر ناهار'],
  fixedLunchDeductMinutes: [0, 480, 'کسر ثابت ناهار'],
};
const NAME_MAX = 60;

const bad = (error, field) => ({ ok: false, error, field });

function normalizeTime(raw) {
  const m = typeof raw === 'string' ? /^\s*(\d{1,2}):(\d{2})\s*$/.exec(raw) : null;
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

function toBool(raw) {
  if (raw === true || raw === 1 || raw === '1' || raw === 'true') return true;
  if (raw === false || raw === 0 || raw === '0' || raw === 'false') return false;
  return null;
}

function toMinutes(raw) {
  if (typeof raw === 'number') return Number.isInteger(raw) ? raw : null;
  if (typeof raw === 'string' && /^\s*\d+\s*$/.test(raw)) return parseInt(raw, 10);
  return null;
}

// partial=false (ایجاد): فیلدهای اجباری باید باشند و بقیه پیش‌فرض می‌گیرند.
// partial=true (ویرایش): فقط فیلدهای داده‌شده بررسی می‌شوند؛ سازگاری start/end/overnight را route با مقدار ادغام‌شده دوباره می‌سنجد (checkConsistency).
function validateShiftInput(body, { partial = false } = {}) {
  const input = body && typeof body === 'object' ? body : {};
  const out = {};

  for (const f of REQUIRED) {
    if (!partial && (input[f] === undefined || input[f] === null || input[f] === '')) return bad(`فیلد «${f}» الزامی است.`, f);
  }

  if (input.name !== undefined) {
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!name) return bad('نام شیفت نباید خالی باشد.', 'name');
    if (name.length > NAME_MAX) return bad(`نام شیفت حداکثر ${NAME_MAX} نویسه است.`, 'name');
    out.name = name;
  }
  for (const f of ['startTime', 'endTime']) {
    if (input[f] === undefined) continue;
    const t = normalizeTime(input[f]);
    if (!t) return bad(`«${f}» باید ساعت معتبر با قالب HH:MM باشد.`, f);
    out[f] = t;
  }
  for (const [f, [min, max, label]] of Object.entries(MINUTE_LIMITS)) {
    if (input[f] === undefined) continue;
    const n = toMinutes(input[f]);
    if (n === null || n < min || n > max) return bad(`${label} باید عدد صحیح بین ${min} و ${max} (دقیقه) باشد.`, f);
    out[f] = n;
  }
  if (input.overnight !== undefined) {
    const b = toBool(input.overnight);
    if (b === null) return bad('«overnight» باید true یا false باشد.', 'overnight');
    out.overnight = b;
  }
  if (input.workDays !== undefined) {
    const days = input.workDays;
    if (!Array.isArray(days) || days.length === 0 || days.length > 7) return bad('«workDays» باید آرایه‌ای ۱ تا ۷ عضوی از روزهای هفته (۰=یکشنبه … ۶=شنبه) باشد.', 'workDays');
    if (!days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) return bad('هر عضو «workDays» باید عدد صحیح ۰ تا ۶ باشد (۰=یکشنبه … ۶=شنبه).', 'workDays');
    if (new Set(days).size !== days.length) return bad('«workDays» نباید روز تکراری داشته باشد.', 'workDays');
    out.workDays = [...days].sort((a, b) => a - b);
  }

  const unknown = Object.keys(input).filter((k) => !FIELDS.includes(k) && k !== 'reason');
  if (unknown.length) return bad(`فیلد ناشناخته: ${unknown.join('، ')}`, unknown[0]);

  const value = partial ? out : { ...DEFAULTS, ...out };
  if (!partial) {
    const c = checkConsistency(value);
    if (!c.ok) return c;
  }
  return { ok: true, value };
}

// شیفت عادی: پایان بعد از شروع؛ شیفت شب (overnight): پایان قبل از شروع (روز بعد). برابر بودن شروع و پایان در هر دو حالت نامعتبر است.
function checkConsistency({ startTime, endTime, overnight }) {
  if (startTime === endTime) return bad('ساعت شروع و پایان نباید یکسان باشند.', 'endTime');
  if (overnight && endTime > startTime) return bad('در شیفت شب (overnight) ساعت پایان باید قبل از ساعت شروع باشد (پایان در روز بعد).', 'overnight');
  if (!overnight && endTime < startTime) return bad('ساعت پایان قبل از شروع است؛ اگر شیفت از نیمه‌شب رد می‌شود overnight را true کنید.', 'overnight');
  return { ok: true };
}

module.exports = { validateShiftInput, checkConsistency, normalizeTime, DEFAULTS, NAME_MAX };

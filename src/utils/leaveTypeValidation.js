// اعتبارسنجی خالص ورودی نوع مرخصی/مأموریت (S4-7a) — بدون دیتابیس. خروجی: { ok:true, value } یا { ok:false, error, field }.
// ایجاد (partial=false): code, title اجباری؛ بقیه پیش‌فرض می‌گیرند. ویرایش (partial=true): فقط فیلدهای داده‌شده؛ code در ویرایش پذیرفته نمی‌شود.

const FIELDS = ['code', 'title', 'kind', 'isPaid', 'requiresAttachment', 'countsAgainstBalance', 'allowedUnits', 'maxConsecutiveDays', 'isActive'];
const BOOL_FIELDS = ['isPaid', 'requiresAttachment', 'countsAgainstBalance', 'isActive'];
const KINDS = ['leave', 'mission'];
const UNITS = ['day', 'half_day', 'hour']; // ترتیب نرمال‌سازی
const CODE_RE = /^[a-z][a-z0-9_]{1,31}$/;
const TITLE_MAX = 60;
const MAX_DAYS_LIMIT = 366;
const DEFAULTS = {
  kind: 'leave',
  isPaid: true,
  requiresAttachment: false,
  countsAgainstBalance: true,
  allowedUnits: ['day'],
  maxConsecutiveDays: null,
  isActive: true,
};

const bad = (error, field) => ({ ok: false, error, field });

function toBool(raw) {
  if (raw === true || raw === 1 || raw === '1' || raw === 'true') return true;
  if (raw === false || raw === 0 || raw === '0' || raw === 'false') return false;
  return null;
}

function validateLeaveTypeInput(body, { partial = false } = {}) {
  const input = body && typeof body === 'object' ? body : {};
  const out = {};

  if (partial && input.code !== undefined) return bad('کد نوع بعد از ساخت قابل تغییر نیست (اگر لازم است نوع جدید بسازید و نوع قدیمی را غیرفعال کنید).', 'code');
  if (!partial && (input.code === undefined || input.code === null || input.code === '')) return bad('فیلد «code» الزامی است.', 'code');
  if (!partial && (input.title === undefined || input.title === null || input.title === '')) return bad('فیلد «title» الزامی است.', 'title');

  if (input.code !== undefined) {
    const code = typeof input.code === 'string' ? input.code.trim() : '';
    if (!CODE_RE.test(code)) return bad('«code» باید با حرف انگلیسی کوچک شروع شود و فقط حرف کوچک، عدد و _ داشته باشد (۲ تا ۳۲ نویسه).', 'code');
    out.code = code;
  }
  if (input.title !== undefined) {
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    if (!title) return bad('عنوان نباید خالی باشد.', 'title');
    if (title.length > TITLE_MAX) return bad(`عنوان حداکثر ${TITLE_MAX} نویسه است.`, 'title');
    out.title = title;
  }
  if (input.kind !== undefined) {
    if (!KINDS.includes(input.kind)) return bad('«kind» باید leave (مرخصی) یا mission (مأموریت) باشد.', 'kind');
    out.kind = input.kind;
  }
  for (const f of BOOL_FIELDS) {
    if (input[f] === undefined) continue;
    const b = toBool(input[f]);
    if (b === null) return bad(`«${f}» باید true یا false باشد.`, f);
    out[f] = b;
  }
  if (input.allowedUnits !== undefined) {
    const u = input.allowedUnits;
    if (!Array.isArray(u) || u.length === 0) return bad('«allowedUnits» باید آرایه‌ی غیرخالی از day، half_day، hour باشد.', 'allowedUnits');
    if (!u.every((x) => UNITS.includes(x))) return bad('هر عضو «allowedUnits» باید یکی از day، half_day، hour باشد.', 'allowedUnits');
    if (new Set(u).size !== u.length) return bad('«allowedUnits» نباید عضو تکراری داشته باشد.', 'allowedUnits');
    out.allowedUnits = UNITS.filter((x) => u.includes(x));
  }
  if (input.maxConsecutiveDays !== undefined) {
    const raw = input.maxConsecutiveDays;
    if (raw === null || raw === '') {
      out.maxConsecutiveDays = null; // بدون سقف
    } else {
      const n = typeof raw === 'number' ? raw : (typeof raw === 'string' && /^\s*\d+\s*$/.test(raw) ? parseInt(raw, 10) : NaN);
      if (!Number.isInteger(n) || n < 1 || n > MAX_DAYS_LIMIT) return bad(`«maxConsecutiveDays» باید null (بدون سقف) یا عدد صحیح ۱ تا ${MAX_DAYS_LIMIT} باشد.`, 'maxConsecutiveDays');
      out.maxConsecutiveDays = n;
    }
  }

  const unknown = Object.keys(input).filter((k) => !FIELDS.includes(k) && k !== 'reason');
  if (unknown.length) return bad(`فیلد ناشناخته: ${unknown.join('، ')}`, unknown[0]);

  return { ok: true, value: partial ? out : { ...DEFAULTS, ...out } };
}

module.exports = { validateLeaveTypeInput, KINDS, UNITS };

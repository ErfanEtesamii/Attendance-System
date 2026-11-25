// S3-1a: رجیستری تنظیمات پویا. «تنها منبع حقیقت» برای کلیدها، نوع، پیش‌فرض، بازه، توضیح و گروه.
// خالص است (بدون SQL و بدون دسترسی به DB)؛ ذخیره/خواندن در settingsRepository انجام می‌شود.
//
// افزودن تنظیم جدید = یک خط در REGISTRY (پایین همین فایل)؛ اعتبارسنجی، پیش‌فرض و خواندن/ذخیره خودکار است.
//
// انواع: number (عدد صحیح، مگر integer:false) | boolean | time (HH:MM) | cron (با node-cron validate)
//        | enum (values) | string (minLength/maxLength اختیاری) | timezone (نام IANA، مثل Asia/Tehran)
//        | weekdays (آرایه‌ی روزهای هفته ۰=یکشنبه … ۶=شنبه؛ ورودی آرایه یا متن «4,5»؛ مقدار نرمال = آرایه‌ی مرتب و یکتا)
//        | multiselect (زیرمجموعه‌ای از values؛ ورودی آرایه یا متن جداشده با کاما؛ مقدار نرمال = آرایه‌ی یکتا به ترتیب values؛ allowEmpty اختیاری)

const cron = require('node-cron');
const config = require('../config');
const time = require('./time');
const { SUPERVISOR_TOGGLEABLE_CAPABILITIES } = require('./supervisorCapabilities');

const TYPES = ['number', 'boolean', 'time', 'cron', 'enum', 'string', 'timezone', 'weekdays', 'multiselect', 'date'];

// برچسب فارسی گروه‌ها (برای صفحه‌ی تنظیمات گروه‌بندی‌شده در S3-9a)
const GROUP_LABELS = {
  workHours: 'ساعت کاری',
  calendar: 'تقویم کاری',
  overtime: 'اضافه‌کاری',
  leave: 'مرخصی و ماموریت',
  reminders: 'تأخیر و یادآوری',
  security: 'امنیت',
  retention: 'نگهداری و آرشیو',
  schedule: 'زمان‌بندی کارهای خودکار',
  monthClose: 'بستن ماه',
  reportDelivery: 'ارسال خودکار گزارش',
  patterns: 'هشدار الگوهای رفتاری',
  planning: 'برنامه و گزارش روزانه',
  performance: 'امتیاز عملکرد',
  disputes: 'اعتراض‌ها',
  supervisors: 'سرپرست‌ها',
  sales: 'تیم فروش و پورسانت',
};

// ---------- اعتبارسنجی بر اساس نوع ----------
// خروجی: { ok: true, value } با مقدار نرمال‌شده | { ok: false, error } با پیام فارسی

function parseBool(value) {
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return null;
}

function validateValue(def, raw) {
  const bad = (error) => ({ ok: false, error });
  switch (def.type) {
    case 'number': {
      let n;
      if (typeof raw === 'number') n = raw;
      else if (typeof raw === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(raw)) n = Number(raw);
      else return bad('باید عدد باشد.');
      if (!Number.isFinite(n)) return bad('باید عدد باشد.');
      if (def.integer !== false && !Number.isInteger(n)) return bad('باید عدد صحیح باشد.');
      if (def.min !== undefined && n < def.min) return bad(`نباید کمتر از ${def.min} باشد.`);
      if (def.max !== undefined && n > def.max) return bad(`نباید بیشتر از ${def.max} باشد.`);
      return { ok: true, value: n };
    }
    case 'boolean': {
      const b = parseBool(raw);
      return b === null ? bad('باید true یا false باشد.') : { ok: true, value: b };
    }
    case 'time': {
      const m = typeof raw === 'string' ? /^\s*(\d{1,2}):(\d{2})\s*$/.exec(raw) : null;
      if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return bad('باید ساعت معتبر با قالب HH:MM باشد.');
      return { ok: true, value: `${m[1].padStart(2, '0')}:${m[2]}` };
    }
    case 'cron': {
      const s = typeof raw === 'string' ? raw.trim() : '';
      return s && cron.validate(s) ? { ok: true, value: s } : bad('عبارت cron نامعتبر است.');
    }
    case 'enum': {
      return def.values.includes(raw) ? { ok: true, value: raw } : bad(`باید یکی از ${def.values.join('، ')} باشد.`);
    }
    case 'string': {
      if (typeof raw !== 'string') return bad('باید متن باشد.');
      const s = raw.trim();
      if (s.length < (def.minLength || 0)) return bad(`حداقل ${def.minLength} نویسه لازم است.`);
      if (s.length > (def.maxLength || 200)) return bad(`حداکثر ${def.maxLength || 200} نویسه مجاز است.`);
      return { ok: true, value: s };
    }
    case 'date': { // D2: تاریخ میلادی YYYY-MM-DD یا خالی (= تنظیم نشده)
      const s = typeof raw === 'string' ? raw.trim() : '';
      if (s === '') return { ok: true, value: '' };
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
      const d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
      return d && d.toISOString().slice(0, 10) === s ? { ok: true, value: s } : bad('باید تاریخ معتبر با قالب YYYY-MM-DD (یا خالی) باشد.');
    }
    case 'timezone': {
      const zone = time.normalizeTimezone(raw);
      return zone ? { ok: true, value: zone } : bad('باید نام معتبر منطقه‌ی زمانی IANA باشد (مثل Asia/Tehran).');
    }
    case 'weekdays': {
      // آرایه‌ی عددها یا متن جداشده با کاما ('4,5'؛ متن خالی = بدون روز، فقط اگر def.allowEmpty)
      let list;
      if (Array.isArray(raw)) list = raw;
      else if (typeof raw === 'string') list = raw.trim() === '' ? [] : raw.split(',').map((x) => (/^\s*\d\s*$/.test(x) ? Number(x) : NaN));
      else return bad('باید فهرست روزهای هفته باشد (۰=یکشنبه … ۶=شنبه).');
      if (!list.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) return bad('هر روز باید عدد صحیح ۰ تا ۶ باشد (۰=یکشنبه … ۶=شنبه).');
      const days = [...new Set(list)].sort((a, b) => a - b);
      if (days.length < (def.allowEmpty ? 0 : 1)) return bad('حداقل یک روز لازم است.');
      if (days.length > (def.maxDays || 7)) return bad(`حداکثر ${def.maxDays || 7} روز مجاز است.`);
      return { ok: true, value: days };
    }
    case 'multiselect': {
      // آرایه‌ی رشته‌ها یا متن جداشده با کاما؛ عضو ناشناخته ⇒ خطا؛ مقدار نرمال یکتا و به ترتیب def.values
      let list;
      if (Array.isArray(raw)) list = raw;
      else if (typeof raw === 'string') list = raw.trim() === '' ? [] : raw.split(',').map((x) => x.trim());
      else return bad('باید فهرستی از گزینه‌ها باشد.');
      if (!list.every((x) => typeof x === 'string' && def.values.includes(x))) return bad('فهرست شامل گزینه‌ی ناشناخته است.');
      const picked = def.values.filter((v) => list.includes(v));
      if (picked.length < (def.allowEmpty ? 0 : 1)) return bad('حداقل یک گزینه لازم است.');
      return { ok: true, value: picked };
    }
    default:
      return bad('نوع تنظیم ناشناخته است.');
  }
}

// ---------- تعریف رجیستری ----------
// def(key، کلید DB، نوع، { default، fallback، min، max، values، group، label، description، hint }
//  - label: عنوان کوتاه فارسی؛ description: توضیح یک‌خطی؛ hint (اختیاری): توضیح کامل‌تر که فقط با «بیشتر» دیده می‌شود.)
//  - default می‌تواند تابع باشد (مثلاً خواندن از config در لحظه‌ی استفاده).
//  - fallback: مقدار ثابت امن برای وقتی که default (مثلاً از .env) نامعتبر باشد؛ سرور به‌خاطر غلط تایپی در .env بالا نیامدن ندارد.
const REGISTRY = [];
function def(key, dbKey, type, opts) {
  REGISTRY.push({ key, dbKey, type, ...opts });
}

// ساعت کاری
def('timezone', 'timezone', 'timezone', { group: 'workHours', section: 'ساعت و منطقه‌ی زمانی', default: () => config.timezone, fallback: 'Asia/Tehran', label: 'منطقه‌ی زمانی', description: 'منطقه‌ی زمانی شرکت؛ مبنای تشخیص روز و ساعت کاری.', hint: 'نام استاندارد منطقه را وارد کنید، مثلاً Asia/Tehran.' });
def('workDayStart', 'work_day_start', 'time', { group: 'workHours', section: 'ساعت و منطقه‌ی زمانی', default: () => config.workDayStart, fallback: '08:00', label: 'ساعت شروع کار', description: 'ساعتی که کار هر روز شروع می‌شود.' });
def('workDayEnd', 'work_day_end', 'time', { group: 'workHours', section: 'ساعت و منطقه‌ی زمانی', default: () => config.workDayEnd, fallback: '16:30', label: 'ساعت پایان کار', description: 'ساعتی که کار هر روز تمام می‌شود.' });
// S3-3a: مهلت تأخیر در محاسبه‌ی روز (نه یادآور؛ یادآور ورود با lateCheckinGraceMinutes جداست)
def('lateGraceMinutes', 'late_grace_minutes', 'number', { group: 'workHours', section: 'تأخیر و زودتر رفتن', min: 0, max: 240, default: 0, label: 'مهلت تأخیر', description: 'چند دقیقه بعد از شروع کار، ورود هنوز تأخیر حساب نشود. (۰ = بدون مهلت)', hint: 'ورود تا پایان این مهلت «تأخیر» نمی‌خورد. این مهلت جدا از مهلت یادآوری ورود است.' });
def('lateCountsFrom', 'late_counts_from', 'enum', { group: 'workHours', section: 'تأخیر و زودتر رفتن', values: ['shift_start', 'after_grace'], default: 'shift_start', label: 'مبنای محاسبه‌ی تأخیر', description: 'دقیقه‌ی تأخیر از شروع کار حساب شود یا از پایان مهلت.', hint: '«از ساعت شروع کار» کل تأخیر را می‌شمارد؛ «پس از پایان مهلت» فقط دقیقه‌های بعد از مهلت را.' });
def('earlyGraceMinutes', 'early_grace_minutes', 'number', { group: 'workHours', section: 'تأخیر و زودتر رفتن', min: 0, max: 240, default: 0, label: 'مهلت زودتر رفتن', description: 'چند دقیقه زودتر از پایان کار رفتن، «زودتر رفتن» حساب نشود. (۰ = بدون مهلت)', hint: 'اگر خروج زودتر از این مهلت باشد، کل دقیقه‌های مانده تا پایان کار حساب می‌شود.' });
// S3-7a: تقویم کاری (فقط برای getCalendarDay؛ مصرف‌کننده‌ها در S3-7c وصل می‌شوند). روزهای هفته: ۰=یکشنبه … ۶=شنبه
def('weekendDays', 'weekend_days', 'weekdays', { group: 'calendar', maxDays: 6, default: [5], label: 'روزهای آخر هفته', description: 'روزهای تعطیل هفته برای کارمندان بدون شیفت.', hint: 'پیش‌فرض جمعه است. کارمند دارای شیفت از روزهای کاریِ شیفت خودش پیروی می‌کند.' });
def('halfDayWeekdays', 'half_day_weekdays', 'weekdays', { group: 'calendar', allowEmpty: true, default: [4], label: 'روزهای نیم‌روز کاری', description: 'روزهایی از هفته که فقط نیمی از روز کار می‌شود. (خالی = بدون نیم‌روز)', hint: 'پیش‌فرض پنجشنبه است. فقط روزی که کاری باشد نیم‌روز می‌شود.' });
def('halfDayEndTime', 'half_day_end_time', 'time', { group: 'calendar', default: '12:30', label: 'ساعت پایان نیم‌روز', description: 'ساعت پایان کار در روزهای نیم‌روز.', hint: 'اگر زودتر از شروع کار یا دیرتر از پایان کار باشد، نادیده گرفته می‌شود.' });
def('teamCalendarMaxConcurrent', 'team_calendar_max_concurrent', 'number', { group: 'calendar', min: 0, max: 1000, default: 0, label: 'سقف هم‌زمانی مرخصی تیم', description: 'اگر بیش از این تعداد نفر هم‌روز مرخصی باشند، هشدار بده. (۰ = بدون هشدار)', hint: 'فقط مرخصی و مأموریت تمام‌روزِ تأییدشده شمرده می‌شود و آن روز در تقویم ماهانه‌ی تیم هشدار می‌گیرد.' });
// U1: ناهار ثبت‌نشده با کسر ثابت ۴۵ دقیقه پس از حداقل ۴ ساعت حضور ناخالص؛ سقف ناهار ۰ یعنی بدون سقف.
def('maxLunchMinutes', 'max_lunch_minutes', 'number', { group: 'workHours', section: 'ناهار', min: 0, max: 480, default: 0, label: 'سقف ناهار روزانه', description: 'حداکثر دقیقه‌ی ناهار مجاز در روز. (۰ = بدون سقف)', hint: 'ناهارِ بیشتر از سقف «مازاد استراحت» گزارش می‌شود و همچنان از ساعت مفید کم می‌شود.' });
def('fixedLunchDeductMinutes', 'fixed_lunch_deduct_minutes', 'number', { group: 'workHours', section: 'ناهار', min: 0, max: 480, default: 45, label: 'کسر ثابت ناهار', description: 'اگر ناهار ثبت نشده، این‌قدر دقیقه از ساعت مفید کم شود. (۰ = خاموش)', hint: 'فقط وقتی اعمال می‌شود که حضور به حداقل تعیین‌شده برسد. استراحت کوتاه جای ناهار حساب نمی‌شود.' });
def('fixedLunchMinPresenceMinutes', 'fixed_lunch_min_presence_minutes', 'number', { group: 'workHours', section: 'ناهار', min: 0, default: 240, label: 'حداقل حضور برای کسر ناهار', description: 'حداقل دقیقه‌ی حضور برای اعمال کسر ثابت ناهار. (۰ = بدون حداقل)', hint: 'حضور ناخالص یعنی از ورود تا خروج، بدون کم‌کردن استراحت‌ها.' });
def('fixedLunchMode', 'fixed_lunch_mode', 'enum', { group: 'workHours', section: 'ناهار', values: ['present_in_window', 'always'], default: 'present_in_window', label: 'شرط اعمال کسر ناهار', description: 'کسر ثابت ناهار فقط برای کارمندی اعمال شود که در بازه‌ی ناهار در شرکت حضور داشته.', hint: '«فقط با حضور در بازه‌ی ناهار»: اگر کارمند در ساعت ناهار در شرکت نبوده (مثلاً زود رفته یا دیر آمده) چیزی کسر نمی‌شود. «همیشه» رفتار قدیمی است و فقط «حداقل حضور روزانه» را می‌سنجد.' });
def('lunchWindowStart', 'lunch_window_start', 'time', { group: 'workHours', section: 'ناهار', default: '12:00', label: 'شروع بازه‌ی ناهار', description: 'ساعتی که بازه‌ی ناهار شرکت شروع می‌شود.', hint: 'حضور کارمند فقط داخل این بازه برای کسر ناهار سنجیده می‌شود. اگر پایان بازه پیش از شروع آن باشد، شرط بازه نادیده گرفته می‌شود.', dependsOn: { key: 'fixedLunchMode', equals: 'present_in_window' } });
def('lunchWindowEnd', 'lunch_window_end', 'time', { group: 'workHours', section: 'ناهار', default: '14:00', label: 'پایان بازه‌ی ناهار', description: 'ساعتی که بازه‌ی ناهار شرکت تمام می‌شود.', dependsOn: { key: 'fixedLunchMode', equals: 'present_in_window' } });
def('fixedLunchMinOverlapMinutes', 'fixed_lunch_min_overlap_minutes', 'number', { group: 'workHours', section: 'ناهار', min: 1, max: 240, default: 15, label: 'حداقل حضور در بازه‌ی ناهار', description: 'کارمند باید حداقل این‌قدر دقیقه داخل بازه‌ی ناهار در شرکت بوده باشد تا ناهار کسر شود.', hint: 'مثلاً با ۱۵، کسی که ساعت ۱۳:۵۰ می‌رسد (۱۰ دقیقه حضور در بازه) ناهارش کسر نمی‌شود.', dependsOn: { key: 'fixedLunchMode', equals: 'present_in_window' } });
def('fixedLunchProRate', 'fixed_lunch_pro_rate', 'boolean', { group: 'workHours', section: 'ناهار', default: true, label: 'کسر متناسب با حضور در بازه', description: 'اگر کارمند فقط بخشی از بازه‌ی ناهار حاضر بوده، کسر ناهار از همان مقدار حضور بیشتر نشود.', hint: 'خاموش ⇒ هر کس به حداقل حضور برسد، کسر ثابت کامل می‌شود. روشن ⇒ مثلاً با کسر ۴۵ دقیقه و حضور ۲۰ دقیقه‌ای در بازه، فقط ۲۰ دقیقه کسر می‌شود.', dependsOn: { key: 'fixedLunchMode', equals: 'present_in_window' } });
def('maxReEntriesPerDay', 'max_re_entries_per_day', 'number', { group: 'workHours', section: 'خروج و ورود مجدد', min: 0, max: 50, default: 5, label: 'سقف ورود مجدد در روز', description: 'کارمند در یک روز حداکثر چند بار بعد از خروج می‌تواند برگردد. (۰ = غیرفعال)', hint: 'هر خروج و ورود مجدد یک نوبت کاری جدید است. وقتی سقف تمام شود، کارمند دیگر نمی‌تواند برگردد و استراحت هم نمی‌زند. برای برداشتن سقف «ورود مجدد نامحدود» را روشن کنید.', dependsOn: { key: 'maxReEntriesUnlimited', equals: false } });
def('maxReEntriesUnlimited', 'max_re_entries_unlimited', 'boolean', { group: 'workHours', section: 'خروج و ورود مجدد', default: false, label: 'ورود مجدد نامحدود', description: 'تعداد دفعات خروج و ورود مجدد در روز سقف نداشته باشد.', hint: 'با روشن بودن این گزینه عدد «سقف ورود مجدد در روز» نادیده گرفته می‌شود. هر نوبت در پنل و گزارش‌ها جدا دیده می‌شود.' });
// C1 (فاز ۱۲): استراحت کوتاهِ با حقوق (هر دو پیش‌فرض ۰ = خاموش ⇒ رفتار قبلی). روی هر شیفت هم می‌شود جدا تنظیم کرد (NULL = همین مقدار سراسری)
def('paidBreakCount', 'paid_break_count', 'number', { group: 'workHours', section: 'استراحت', min: 0, max: 10, default: 3, label: 'تعداد استراحت با حقوق', description: 'حداکثر چند استراحت کوتاه در روز با حقوق حساب شود. (۰ = خاموش)' });
def('paidBreakCountUnlimited', 'paid_break_count_unlimited', 'boolean', { group: 'workHours', section: 'استراحت', default: false, label: 'استراحت با حقوق نامحدود', description: 'تعداد استراحت‌های با حقوق سقف نداشته باشد.', hint: 'استراحت‌ها به ترتیب شروع از مجموع دقیقه‌های روزانه سهم می‌گیرند و مازاد بدون حقوق است. مجموع دقیقه‌ها باید بیشتر از ۰ باشد.' });
def('paidBreakMinutes', 'paid_break_minutes', 'number', { group: 'workHours', section: 'استراحت', min: 0, max: 120, default: 45, label: 'مجموع استراحت با حقوق', description: 'مجموع دقیقه‌ی استراحتِ با حقوق در روز. (۰ = خاموش)', hint: 'این مقدار به ترتیب شروع، بین استراحت‌های مجاز تقسیم می‌شود.' });
def('breakMaxPerDay', 'break_max_per_day', 'number', { group: 'workHours', section: 'استراحت', min: 0, max: 50, default: 0, label: 'سقف تعداد استراحت در روز', description: 'حداکثر چند بار در روز می‌شود استراحت (ناهار، نماز، کوتاه) شروع کرد. (۰ = بدون سقف)', hint: 'فقط ثبت دستی کارمند را محدود می‌کند؛ اصلاح ادمین و ثبت‌های قبلی تغییر نمی‌کند.', dependsOn: { key: 'breakButtonsEnabled', equals: true } });
// استراحت و ناهارِ زمان‌بندی‌شده (جایگزین دکمه‌ی دستی): سیستم سر ساعت پیام «وقت استراحت/ناهار است» و در پایان پیام «تمام شد» می‌فرستد.
// استراحتِ زمان‌بندی‌شده بدون حقوق‌کسر است (ثبت نمی‌شود)؛ کسر ناهار از fixedLunchDeductMinutes می‌آید (ناهار ثبت‌نشده ⇒ کسر ثابت).
def('breakButtonsEnabled', 'break_buttons_enabled', 'boolean', { group: 'workHours', section: 'استراحت', default: true, label: 'دکمه‌ی ثبت استراحت/ناهار', description: 'دکمه‌ی «ثبت استراحت» (ناهار، نماز، استراحت کوتاه) در Mini App نمایش داده شود.', hint: 'خاموش ⇒ دکمه پنهان و ثبت دستی در سرور هم رد می‌شود. برای استراحت و ناهارِ ساعتِ ثابت، خاموش کنید و پیام خودکار را روشن کنید.' });
def('scheduledBreakEnabled', 'scheduled_break_enabled', 'boolean', { group: 'workHours', section: 'پیام خودکار استراحت و ناهار', default: false, label: 'پیام خودکار استراحت', description: 'سر ساعت استراحت و پایان آن برای حاضرها پیام تلگرام برود.', hint: 'فقط برای کارمندِ حاضرِ روز کاری با شیفت ساعت‌دار غیرشب که ساعت استراحت در بازه‌ی شیفتش باشد. استراحتِ زمان‌بندی‌شده از ساعت کاری کم نمی‌شود.' });
def('scheduledBreakStart', 'scheduled_break_start', 'time', { group: 'workHours', section: 'پیام خودکار استراحت و ناهار', default: '12:00', label: 'شروع استراحت خودکار', description: 'ساعت پیام «وقت استراحت است».' });
def('scheduledBreakMinutes', 'scheduled_break_minutes', 'number', { group: 'workHours', section: 'پیام خودکار استراحت و ناهار', min: 1, max: 120, default: 15, label: 'مدت استراحت خودکار', description: 'چند دقیقه بعد از شروع، پیام «استراحت تمام شد» برود.' });
def('scheduledWarnMinutes', 'scheduled_warn_minutes', 'number', { group: 'workHours', section: 'پیام خودکار استراحت و ناهار', min: 0, max: 60, default: 5, label: 'هشدار قبل از پایان استراحت/ناهار', description: 'چند دقیقه مانده به پایان استراحت یا ناهار پیام یادآوری برود. (۰ = خاموش)', hint: 'مثلاً ۵ ⇒ «۵ دقیقه‌ی دیگر تمام می‌شود». اگر از مدت استراحت/ناهار کمتر نباشد، برای آن پیام هشدار نمی‌رود.' });
def('scheduledLunchEnabled', 'scheduled_lunch_enabled', 'boolean', { group: 'workHours', section: 'پیام خودکار استراحت و ناهار', default: false, label: 'پیام خودکار ناهار', description: 'سر ساعت ناهار و پایان آن برای حاضرها پیام تلگرام برود.', hint: 'مقدار کسر ناهار از «کسر ثابت ناهار» می‌آید؛ همان را روی مدت ناهار (مثلاً ۴۵) بگذارید و «حداقل حضور» را ۰ کنید تا هر روز کسر شود.' });
def('scheduledLunchStart', 'scheduled_lunch_start', 'time', { group: 'workHours', section: 'پیام خودکار استراحت و ناهار', default: '12:15', label: 'شروع ناهار خودکار', description: 'ساعت پیام «وقت ناهار است».' });
def('scheduledLunchMinutes', 'scheduled_lunch_minutes', 'number', { group: 'workHours', section: 'پیام خودکار استراحت و ناهار', min: 1, max: 240, default: 45, label: 'مدت ناهار خودکار', description: 'چند دقیقه بعد از شروع، پیام «ناهار تمام شد» برود.' });
// D1 (فاز ۱۲): سقف تأخیر در هر ماه شمسی و «اجازه‌ی ورود». lateMonthlyLimit=۰ ⇒ خاموش؛ با سقف N، N بار تأخیرِ بسته‌شده آزاد است و ورودِ دیرِ بعدی اجازه می‌خواهد.
def('lateMonthlyLimit', 'late_monthly_limit', 'number', { related: ['supervisors'], group: 'workHours', section: 'تأخیر و زودتر رفتن', min: 0, max: 31, default: 0, label: 'سقف تأخیر ماهانه', description: 'حداکثر چند تأخیر در هر ماه شمسی. (۰ = خاموش)', hint: 'بعد از رسیدن به سقف، ثبت ورودِ دیر به اجازه‌ی سرپرست نیاز دارد.' });
def('lateLimitGateMode', 'late_limit_gate_mode', 'enum', { related: ['supervisors'], group: 'workHours', section: 'تأخیر و زودتر رفتن', values: ['off', 'soft', 'enforce'], default: 'off', label: 'نحوه‌ی اعمال سقف تأخیر', description: 'اگر تأخیر از سقف بگذرد، چه اتفاقی بیفتد.', hint: '«بی‌اثر» کاری نمی‌کند؛ «هشدار» فقط رویداد ثبت می‌کند و ورود مجاز است؛ «الزامی» بدون اجازه‌ی سرپرست ورود ثبت نمی‌شود.' });
def('lateLimitPermissionTtlMinutes', 'late_limit_permission_ttl_minutes', 'number', { related: ['supervisors'], group: 'workHours', section: 'تأخیر و زودتر رفتن', min: 5, max: 720, default: 60, label: 'اعتبار اجازه‌ی ورود', description: 'اجازه‌ی سرپرست چند دقیقه معتبر بماند.', hint: 'با یک ورود موفق مصرف می‌شود و بعد از این مدت منقضی است.' });
// S3-4b: آستانه‌ی پرچم‌ها (فقط گزارش؛ عددی را عوض نمی‌کنند)
def('idleAskEnabled', 'idle_ask_enabled', 'boolean', { group: 'workHours', section: 'تایم پرت هنگام خروج', default: true, label: 'پرسش تایم پرت هنگام خروج', description: 'هنگام ثبت خروج از کارمند می‌پرسد تایم پرت داشته یا نه.', hint: 'اگر کارمند «بله» بزند، مقداری را که انتخاب می‌کند از ساعت مفید همان روز کم می‌شود؛ «خیر» چیزی کم نمی‌کند. خاموش ⇒ پرسشی نمایش داده نمی‌شود.' });
def('idleMaxMinutes', 'idle_max_minutes', 'number', { group: 'workHours', section: 'تایم پرت هنگام خروج', min: 0, max: 1440, default: 0, label: 'سقف تایم پرت در هر خروج', description: 'بیشترین دقیقه‌ای که کارمند می‌تواند به‌عنوان تایم پرت ثبت کند؛ ۰ = بدون سقف.', hint: '۰ ⇒ بدون محدودیت (در پنجره‌ی خروج تا مدت حضور همان روز قابل انتخاب است). مثلاً ۱۲۰ یعنی حداکثر ۲ ساعت.', dependsOn: { key: 'idleAskEnabled', equals: true } });
def('idleStepMinutes', 'idle_step_minutes', 'number', { group: 'workHours', section: 'تایم پرت هنگام خروج', min: 1, max: 60, default: 5, label: 'گام انتخاب تایم پرت', description: 'فاصله‌ی گزینه‌های دقیقه در انتخاب تایم پرت.', hint: 'مثلاً ۵ یعنی ۵، ۱۰، ۱۵ … دقیقه.', dependsOn: { key: 'idleAskEnabled', equals: true } });
def('longOpenBreakMinutes', 'long_open_break_minutes', 'number', { group: 'workHours', section: 'هشدار و علامت‌گذاری', min: 1, max: 720, default: 120, label: 'آستانه‌ی استراحت باز', description: 'استراحتی که بیش از این دقیقه باز بماند علامت می‌خورد.', hint: 'منظور استراحتی است که پایان نخورده است.' });
def('outsideShiftMarginMinutes', 'outside_shift_margin_minutes', 'number', { group: 'workHours', section: 'هشدار و علامت‌گذاری', min: 0, max: 720, default: 120, label: 'حاشیه‌ی خارج از شیفت', description: 'ورود یا خروج تا این دقیقه بیرون از شیفت مجاز است.', hint: 'بیشتر از این حاشیه «خارج از شیفت» علامت می‌خورد. مقدار ۷۲۰ عملاً آن را خاموش می‌کند.' });
def('crossMidnightMode', 'cross_midnight_mode', 'enum', { group: 'workHours', section: 'ساعت و منطقه‌ی زمانی', values: ['legacy', 'by_shift_day'], default: 'legacy', label: 'خروج بعد از نیمه‌شب', description: 'خروج بعد از نیمه‌شب در شیفت عادی چطور حساب شود.', hint: '«سازگار با گذشته» همان محاسبه‌ی قبلی است؛ «بر پایه‌ی روز شیفت» آن را ادامه‌ی همان روز کاری می‌شمارد.' });
def('dailyTargetMinutes', 'daily_target_minutes', 'number', { group: 'workHours', section: 'ساعت و منطقه‌ی زمانی', min: 60, max: 960, default: 480, label: 'هدف ساعت مفید روزانه', description: 'هدف روزانه‌ی ساعت مفید که در حلقه‌ی پیشرفتِ Mini App نمایش داده می‌شود.', hint: 'فقط نمایشی است و روی تأخیر، حقوق و گزارش‌ها اثر ندارد. ۴۸۰ دقیقه = ۸ ساعت.' });
// S3-5a: اضافه‌کاری روزانه (پیش‌فرض خاموش؛ ضریب‌ها ۱ = خنثی، عدد قانونی hard-code نشده)
def('overtimeEnabled', 'overtime_enabled', 'boolean', { group: 'overtime', default: false, label: 'محاسبه‌ی اضافه‌کاری', description: 'اضافه‌کاریِ قابل‌پرداخت محاسبه شود. (خاموش = ۰)', hint: 'اگر خاموش باشد، اضافه‌کاری خام همچنان در گزارش‌ها دیده می‌شود.' });
def('overtimeMinMinutes', 'overtime_min_minutes', 'number', { group: 'overtime', min: 0, max: 480, default: 0, label: 'حداقل اضافه‌کاری روزانه', description: 'کمتر از این دقیقه، اضافه‌کاری قابل‌پرداخت نیست. (۰ = بدون حداقل)', hint: 'کمتر از حداقل صفر حساب می‌شود و برابر یا بیشتر از آن کامل شمرده می‌شود.' });
def('overtimeDailyCapMinutes', 'overtime_daily_cap_minutes', 'number', { group: 'overtime', min: 0, max: 720, default: 0, label: 'سقف اضافه‌کاری روزانه', description: 'حداکثر دقیقه‌ی اضافه‌کاریِ قابل‌پرداخت در یک روز. (۰ = بدون سقف)', hint: 'سقف پیش از گرد کردن و اعمال ضریب برش می‌خورد.' });
def('overtimeFactor', 'overtime_factor', 'number', { group: 'overtime', integer: false, min: 0, max: 10, default: 1, label: 'ضریب اضافه‌کاری روز عادی', description: 'ضریب پرداخت اضافه‌کاری روزهای عادی. (۱ = بدون ضریب)', hint: 'دقیقه‌ی قابل‌پرداخت برابر است با دقیقه‌ی گردشده ضرب‌در ضریب.' });
def('overtimeHolidayFactor', 'overtime_holiday_factor', 'number', { group: 'overtime', integer: false, min: 0, max: 10, default: 1, label: 'ضریب اضافه‌کاری تعطیلی', description: 'ضریب پرداخت اضافه‌کاری روزهای تعطیل. (۱ = بدون ضریب)' });
def('overtimeRoundStep', 'overtime_round_step', 'number', { group: 'overtime', min: 1, max: 60, default: 1, label: 'گام گرد کردن اضافه‌کاری', description: 'اضافه‌کاری به مضرب این دقیقه گرد شود. (۱ = بدون گرد کردن)' });
def('overtimeRounding', 'overtime_rounding', 'enum', { group: 'overtime', values: ['down', 'nearest', 'up'], default: 'down', label: 'روش گرد کردن', description: 'اضافه‌کاری به پایین، نزدیک‌ترین یا بالا گرد شود.', hint: 'در حالت «نزدیک‌ترین»، نیم‌گام به بالا گرد می‌شود.' });
def('overtimeMonthlyCapMinutes', 'overtime_monthly_cap_minutes', 'number', { group: 'overtime', min: 0, max: 12000, default: 0, label: 'سقف اضافه‌کاری ماهانه', description: 'حداکثر دقیقه‌ی اضافه‌کاریِ قابل‌پرداخت در ماه. (۰ = بدون سقف)', hint: 'روزها به ترتیب تاریخ جمع می‌شوند و مازاد بر سقف پرداخت نمی‌شود. فقط در محاسبه‌ی ماهانه اعمال می‌شود، نه خروجی روزانه.' });
def('overtimeRequiresApproval', 'overtime_requires_approval', 'boolean', { related: ['supervisors'], group: 'overtime', default: false, label: 'الزام تأیید اضافه‌کاری', description: 'اضافه‌کاری فقط بعد از تأیید سرپرست یا ادمین پرداخت شود.', hint: 'تا زمان تأیید «معلق» است و در جمع ماهانه نمی‌آید؛ ردشده هم نمی‌آید.' });
// S5-3a: چک‌لیست پیش از بستن ماه. هر مورد «مانع» (بستن را مسدود می‌کند) یا «هشدار» (فقط نمایش) است؛ تصمیم تجاری با ادمین، نه کد.
def('monthCloseRequireMonthEnded', 'month_close_require_month_ended', 'boolean', { group: 'monthClose', default: true, label: 'بستن ماه پس از پایان آن', description: 'ماه فقط بعد از آخرین روز ماه شمسی بسته شود.', hint: 'اگر خاموش باشد، ادمین می‌تواند ماهِ در جریان را هم ببندد.' });
def('monthCloseBlockIncomplete', 'month_close_block_incomplete', 'boolean', { group: 'monthClose', default: true, label: 'مسدود شدن با روز ناقص', description: 'اگر روز ناقص (ورود بدون خروج) باشد، بستن ماه ممکن نباشد.', hint: 'اگر خاموش باشد، فقط هشدار می‌دهد.' });
def('monthCloseBlockOpenDisputes', 'month_close_block_open_disputes', 'boolean', { group: 'monthClose', default: true, label: 'مسدود شدن با اعتراض باز', description: 'اگر به رکوردهای ماه اعتراض باز باشد، بستن ماه ممکن نباشد.', hint: 'اگر خاموش باشد، فقط هشدار می‌دهد.' });
def('monthCloseBlockPendingLeave', 'month_close_block_pending_leave', 'boolean', { group: 'monthClose', default: true, label: 'مسدود شدن با مرخصی در انتظار', description: 'اگر درخواست مرخصی یا ماموریتِ در انتظار با ماه هم‌پوشانی دارد، بستن ممکن نباشد.', hint: 'اگر خاموش باشد، فقط هشدار می‌دهد.' });
def('monthCloseBlockPendingOvertime', 'month_close_block_pending_overtime', 'boolean', { group: 'monthClose', default: true, label: 'مسدود شدن با اضافه‌کاری در انتظار', description: 'اگر اضافه‌کاریِ منتظر تأیید باشد، بستن ماه ممکن نباشد.', hint: 'فقط وقتی «الزام تأیید اضافه‌کاری» روشن است اثر دارد. اگر خاموش باشد، فقط هشدار می‌دهد.' });
def('monthCloseBlockSuspicious', 'month_close_block_suspicious', 'boolean', { group: 'monthClose', default: false, label: 'مسدود شدن با مورد مشکوک', description: 'اگر مورد مشکوکِ بررسی‌نشده باشد، بستن ماه ممکن نباشد.', hint: 'پیش‌فرض خاموش است، چون «مشکوک» نشانه است نه اتهام؛ در این حالت فقط هشدار می‌دهد.' });
// S5-5a: ارسال خودکار xlsx گزارش ماهانه در تلگرام (روز اول ماه شمسی، برای ماه قبل). پیش‌فرض خاموش؛ ایمیل پشتیبانی نمی‌شود.
def('reportXlsxEnabled', 'report_xlsx_enabled', 'boolean', { group: 'reportDelivery', default: false, label: 'ارسال فایل اکسل ماهانه', description: 'فایل اکسل گزارش ماه قبل، روز اول هر ماه شمسی در تلگرام ارسال شود.', hint: 'اگر خاموش باشد، فقط پیام متنی ارسال می‌شود.' });
def('reportXlsxRecipientRoles', 'report_xlsx_recipient_roles', 'string', { related: ['supervisors'], group: 'reportDelivery', default: 'admin', maxLength: 40, label: 'نقش‌های گیرنده‌ی اکسل', description: 'نقش‌هایی که فایل اکسل را می‌گیرند، با ویرگول جدا شوند.', hint: 'نقش‌های مجاز: admin، hr و manager. ادمین و منابع انسانی کل شرکت و سرپرست فقط تیم خودش را می‌گیرد؛ فقط کاربران فعالِ دارای تلگرام.' });
def('employeeZipEnabled', 'employee_zip_enabled', 'boolean', { group: 'reportDelivery', default: false, label: 'ارسال زیپ اکسل کارمندان', description: 'روز اول هر ماه شمسی، زیپ اکسل جداگانه‌ی هر کارمند برای ماه قبل در تلگرام ارسال شود.', hint: 'گیرنده‌ها را در «شناسه‌ی گیرنده‌های زیپ» بنویسید.' });
def('employeeZipRecipientIds', 'employee_zip_recipient_ids', 'string', { group: 'reportDelivery', default: '', maxLength: 60, label: 'شناسه‌ی گیرنده‌های زیپ کارمندان', description: 'شناسه‌ی عددیِ کاربران گیرنده، با ویرگول جدا شوند (مثلاً 1,22).', hint: 'فقط کاربران فعالِ دارای تلگرام؛ شناسه در صفحه‌ی کاربر دیده می‌شود.' });
def('reportXlsxRequireClosed', 'report_xlsx_require_closed', 'boolean', { group: 'reportDelivery', default: false, label: 'ارسال فقط برای ماه بسته', description: 'فایل فقط وقتی ماه قبل بسته شده باشد ارسال شود.', hint: 'اگر خاموش باشد، فایل با ارقام زنده ارسال می‌شود و «زنده» بودنش در فایل و کپشن اعلام می‌شود.' });
// مرخصی و مانده (S4-9b). هیچ عدد قانونی hard-code نیست: پیش‌فرض‌ها خنثی‌اند و ادمین مقدار شرکت را می‌دهد.
def('leaveDefaultEntitlementMinutes', 'leave_default_entitlement_minutes', 'number', { group: 'leave', min: 0, max: 10000000, default: 0, label: 'استحقاق سالانه‌ی پیش‌فرض', description: 'سهم سالانه‌ی پیش‌فرض هر نوع مرخصی، به دقیقه. (۰ = بدون استحقاق)', hint: 'برای کسی که استحقاق ثبت‌شده ندارد اعمال می‌شود. مثلاً ۲۶ روز را در طول روز کاری ضرب و به دقیقه وارد کنید.' });
def('leaveCarryOverCapMinutes', 'leave_carry_over_cap_minutes', 'number', { group: 'leave', min: 0, max: 10000000, default: 0, label: 'سقف انتقال از سال قبل', description: 'حداکثر دقیقه‌ی مرخصی که از سال قبل منتقل می‌شود. (۰ = بدون سقف)', hint: 'انتقال بیشتر از سقف رد می‌شود.' });
def('leaveBalancePolicy', 'leave_balance_policy', 'enum', { group: 'leave', values: ['block', 'warn', 'allow_negative'], default: 'warn', label: 'رفتار در کمبود مانده', description: 'اگر درخواست از مانده بیشتر باشد، چه شود.', hint: '«مسدود» ثبت را رد می‌کند؛ «هشدار» ثبت می‌کند ولی هشدار می‌دهد؛ «مانده‌ی منفی» بی‌صدا ثبت می‌کند.' });
def('leaveAllowPastRequests', 'leave_allow_past_requests', 'boolean', { group: 'leave', default: true, label: 'ثبت مرخصی برای گذشته', description: 'ثبت مرخصی یا ماموریت برای تاریخ گذشته مجاز باشد.', hint: 'اگر خاموش باشد، فقط از امروز به بعد ثبت می‌شود.' });
def('leaveMaxPastDays', 'leave_max_past_days', 'number', { group: 'leave', min: 0, max: 3650, default: 0, label: 'سقف فاصله‌ی گذشته', description: 'تاریخ شروع درخواست حداکثر چند روز قبل باشد. (۰ = بدون سقف)', hint: 'فقط وقتی ثبت برای گذشته مجاز است اعمال می‌شود.' });
def('leaveMaxFutureDays', 'leave_max_future_days', 'number', { group: 'leave', min: 0, max: 3650, default: 0, label: 'سقف فاصله‌ی آینده', description: 'تاریخ شروع درخواست حداکثر چند روز بعد باشد. (۰ = بدون سقف)' });
def('leaveMinNoticeHours', 'leave_min_notice_hours', 'number', { group: 'leave', min: 0, max: 8760, default: 0, label: 'حداقل پیش‌اطلاع', description: 'درخواست حداقل چند ساعت قبل از شروع ثبت شود. (۰ = بدون حداقل)', hint: 'برای مرخصی ساعتی از ساعت شروع و برای بقیه از ابتدای روز شروع حساب می‌شود. فقط درخواست‌های آینده را شامل می‌شود.' });
def('backupIncludeAttachments', 'backup_include_attachments', 'boolean', { group: 'retention', default: true, label: 'پیوست‌ها در بک‌آپ', description: 'بک‌آپ روزانه پیوست‌های مرخصی را هم کپی کند.', hint: 'کپی به‌صورت افزایشی در پوشه‌ی بک‌آپ انجام می‌شود.' });
def('leaveAttachmentMaxKb', 'leave_attachment_max_kb', 'number', { group: 'leave', min: 16, max: 20000, default: 5120, label: 'حداکثر حجم پیوست', description: 'بیشینه‌ی حجم پیوست درخواست مرخصی، به کیلوبایت.', hint: 'سقف دانلود بات تلگرام حدود ۲۰ مگابایت است.' });
def('leaveAttachmentTypes', 'leave_attachment_types', 'string', { group: 'leave', default: 'image/jpeg,image/png,application/pdf', maxLength: 200, label: 'نوع فایل‌های مجاز پیوست', description: 'نوع فایل‌های مجاز برای پیوست، با ویرگول جدا شوند.', hint: 'فقط زیرمجموعه‌ی نوع‌های JPEG، PNG و PDF معنا دارد؛ محتوای فایل هم بررسی می‌شود.' });
def('leaveApprovalReminderHours', 'leave_approval_reminder_hours', 'number', { related: ['supervisors'], group: 'leave', min: 0, max: 8760, default: 0, label: 'یادآوری تأیید مرخصی', description: 'اگر درخواست این‌قدر ساعت بی‌پاسخ ماند، به تأییدکننده یادآوری شود. (۰ = خاموش)', hint: 'یادآوری برای سرپرست مستقیم و همه‌ی ادمین‌ها می‌رود.' });
def('missionReminderHour', 'mission_reminder_hour', 'number', { group: 'leave', min: 0, max: 23, default: 10, label: 'ساعت یادآوری ماموریتِ بی‌پاسخ', description: 'از این ساعتِ روز بعد از ثبت، اگر ماموریت هنوز بی‌پاسخ است یادآوری تأیید برود.', hint: 'ساعت ۲۴ساعته به وقت شرکت؛ مثلاً ۱۰ یعنی ساعت ۱۰ صبح.' });
// تأخیر و یادآوری
def('salesNotifyEnabled', 'sales_notify_enabled', 'boolean', { group: 'sales', default: true, label: 'پیام تشویقی معامله‌ی موفق', description: 'با هر معامله‌ی موفقِ تازه در دیدار، پیام تشویقی تلگرام به خودِ کارشناس برود.', hint: 'شامل رسیدن به پله‌ی بالاتر پورسانت و فاکتورهای پنجم، دهم و … ماه است. پیام‌ها متنوع‌اند و مبلغ فقط برای خودِ کارشناس می‌رود. معامله‌های قبل از فعال‌سازی هرگز اعلام نمی‌شوند.' });
def('salesGroupChatId', 'sales_group_chat_id', 'string', { group: 'sales', default: '', maxLength: 40, label: 'شناسه‌ی گروه تلگرام تیم فروش', description: 'اگر پر شود، تبریک کوتاه و بدون مبلغ به این گروه هم می‌رود. (خالی = خاموش)', hint: 'بات باید در گروه عضو باشد. شناسه‌ی گروه معمولاً با منفی شروع می‌شود، مثل -1001234567890.' });
def('lateCheckinGraceMinutes', 'late_checkin_grace_minutes', 'number', { group: 'reminders', min: 0, max: 720, default: () => config.lateCheckinGraceMinutes, fallback: 15, label: 'مهلت یادآوری ورود', description: 'چند دقیقه بعد از شروع کار صبر شود، سپس یادآوری ورود برود.', hint: 'جدا از «مهلت تأخیر» است که روی حساب تأخیر اثر می‌گذارد.' });
def('checkoutReminderMinutesBefore', 'checkout_reminder_minutes_before', 'number', { group: 'reminders', min: 0, max: 720, default: () => config.checkoutReminderMinutesBefore, fallback: 15, label: 'یادآوری ثبت خروج', description: 'چند دقیقه مانده به پایان کار، یادآوری ثبت خروج برود.' });
def('urgentTaskReminderLeadMinutes', 'urgent_task_reminder_lead_minutes', 'number', { group: 'reminders', min: 5, max: 1440, default: 30, label: 'پیش‌آگاهی مهلت تسک فوری', description: 'چند دقیقه مانده به مهلت تسک فوری، اگر هنوز پاسخی ندارد یادآوری برای کارمند برود.', hint: 'زمان اجرای خودِ یادآوری در بخش «زمان‌بندی کارهای خودکار» تنظیم می‌شود.' });
def('breakOverrunReminderMinutes', 'break_overrun_reminder_minutes', 'number', { group: 'reminders', min: 0, max: 240, default: 15, label: 'یادآوری استراحت باز', description: 'اگر استراحتی این‌قدر دقیقه باز ماند، به کارمند پیام برود. (۰ = خاموش)', hint: 'پیام از کارمند می‌خواهد در صورت تمام‌شدن استراحت، پایانش را بزند. برای هر استراحت فقط یک‌بار ارسال می‌شود.' });
def('breakOverrunReminderLunch', 'break_overrun_reminder_lunch', 'boolean', { group: 'reminders', default: false, label: 'یادآوری باز بودن ناهار', description: 'یادآوری استراحت باز برای ناهار هم ارسال شود.', hint: 'پیش‌فرض خاموش است، چون ناهار معمولاً از آستانه‌ی یادآوری طولانی‌تر است و فقط استراحت کوتاه و نماز یادآوری می‌گیرد.' });
def('repeatedLatenessThreshold', 'repeated_lateness_threshold', 'number', { related: ['supervisors'], group: 'reminders', min: 1, max: 100, default: () => config.repeatedLatenessThreshold, fallback: 3, label: 'آستانه‌ی تأخیر تکراری', description: 'با چند تأخیر در ماه، اعلان «تأخیر تکراری» به مدیر برود.' });
// امنیت
def('missionBackdateDays', 'mission_backdate_days', 'number', { group: 'leave', min: 0, max: 30, default: 3, label: 'ثبت ماموریت برای گذشته', description: 'ماموریت حداکثر چند روز قبل قابل ثبت باشد. (۰ = بدون ثبت برای گذشته)', hint: 'برای ماموریت‌هایی است که فراموش شده‌اند.' });
def('missionAdvanceDays', 'mission_advance_days', 'number', { group: 'leave', min: 0, max: 365, default: 30, label: 'ثبت ماموریت برای آینده', description: 'ماموریت حداکثر چند روز جلوتر قابل ثبت باشد.' });
def('allowCheckinWithPendingMission', 'allow_checkin_with_pending_mission', 'boolean', { related: ['supervisors'], group: 'leave', default: true, label: 'تردد با ماموریتِ در انتظار', description: 'با ماموریتِ در انتظارِ تأییدِ امروز، ورود و خروج از بیرون شبکه مجاز باشد.', hint: 'تا تصمیم سرپرست، رکورد نشانه‌ی «نیازمند بررسی» می‌گیرد.' });
// ---- D2: برنامه‌ی هفتگی و گزارش روزانه ----
def('weekStartDay', 'week_start_day', 'number', { group: 'planning', min: 0, max: 6, default: 6, label: 'اولین روز هفته', description: 'روز شروع هفته در برنامه‌ریزی.', hint: 'عدد ۰ یکشنبه است و عدد ۶ شنبه.' });
def('planSubmissionWeekday', 'plan_submission_weekday', 'enum', { group: 'planning', values: ['auto', '0', '1', '2', '3', '4', '5', '6'], default: 'auto', label: 'روز ثبت برنامه‌ی هفته‌ی بعد', description: 'برنامه‌ی هفته‌ی بعد در چه روزی ثبت شود.', hint: '«خودکار» یعنی آخرین روز کاریِ هفته‌ی همان کاربر؛ یا شماره‌ی روز را انتخاب کنید (۰ = یکشنبه … ۶ = شنبه).' });
def('planGateWarnWeekday', 'plan_gate_warn_weekday', 'enum', { group: 'planning', values: ['off', '0', '1', '2', '3', '4', '5', '6'], default: '3', label: 'روز آخرین فرصت ثبت برنامه', description: 'در این روز، هنگام خروجِ بدون برنامه از کارمند تأیید گرفته شود.', hint: 'فقط وقتی اثر دارد که این روز پیش از روز ثبت باشد. «خاموش» یعنی بدون این پرسش.' });
def('planMinTasks', 'plan_min_tasks', 'number', { group: 'planning', min: 0, max: 30, default: 1, label: 'حداقل تسک برنامه‌ی هفتگی', description: 'حداقل چند تسک برای ثبت برنامه‌ی هفتگی لازم است.' });
def('planGateMode', 'plan_gate_mode', 'enum', { group: 'planning', values: ['enforce', 'soft', 'off'], default: 'off', label: 'الزام ثبت برنامه‌ی هفتگی', description: 'هنگام خروج، ثبت برنامه‌ی هفته‌ی بعد چقدر اجباری باشد.', hint: '«الزامی» بدون برنامه اجازه‌ی خروج نمی‌دهد؛ «یادآوری» فقط یادآوری می‌کند؛ «خاموش» اثری ندارد.' });
def('planGateStartDate', 'plan_gate_start_date', 'date', { group: 'planning', default: '', label: 'تاریخ شروع الزام', description: 'از چه تاریخی الزام برنامه و گزارش روزانه اعمال شود. (خالی = از همین حالا)', hint: 'تاریخ میلادی و به شکل YYYY-MM-DD وارد می‌شود.' });
def('dailyReportGateMode', 'daily_report_gate_mode', 'enum', { group: 'planning', values: ['enforce', 'soft', 'off'], default: 'enforce', label: 'الزام گزارش روزانه', description: 'هنگام خروج، وضعیت تسک‌های همان روز پرسیده شود.', hint: '«الزامی» بدون تعیین وضعیت تسک‌های الزامی خروج ثبت نمی‌کند؛ «نرم» خروج را مجاز می‌کند و تا ۲۴ ساعت فرصت تکمیل می‌دهد؛ «خاموش» سؤالی نمی‌پرسد.' });
def('reportBackfillDays', 'report_backfill_days', 'number', { group: 'planning', min: 0, max: 14, default: 2, label: 'مهلت تکمیل گزارش گذشته', description: 'گزارش روز گذشته تا چند روز بعد قابل تکمیل باشد.', hint: 'مثلاً برای رکوردی که خروجش خودکار ثبت شده است.' });
def('reportSoftWindowHours', 'report_soft_window_hours', 'number', { group: 'planning', min: 1, max: 168, default: 24, label: 'مهلت تکمیل گزارش در حالت نرم', description: 'در حالت «نرم»، گزارش روزانه تا چند ساعت بعد از خروج هنوز قابل تکمیل است.', hint: 'فقط وقتی «حالت گزارش روزانه» روی نرم است اثر دارد.' });
def('reportMaxExtraTasks', 'report_max_extra_tasks', 'number', { group: 'planning', min: 1, max: 50, default: 10, label: 'سقف کارهای خارج از برنامه', description: 'در هر بار ثبت گزارش روزانه حداکثر چند «کار خارج از برنامه» می‌شود اضافه کرد.' });
def('taskCarryMaxTimes', 'task_carry_max_times', 'number', { group: 'planning', min: 0, max: 20, default: 0, label: 'سقف انتقال تسک', description: 'هر تسک حداکثر چند بار به روز دیگر منتقل شود. (۰ = بدون سقف)', hint: 'بعد از رسیدن به سقف، تسک باید انجام یا حذف شود. مقدار پیشنهادی: ۳.' });
def('selfUrgentEnabled', 'self_urgent_enabled', 'boolean', { related: ['supervisors'], group: 'planning', default: true, label: 'تسک فوری شخصی', description: 'کارمند بتواند برای خودش تسک فوری بگذارد.', hint: 'از «وضعیت من» یا مینی‌اپ ثبت می‌شود و به سرپرست اعلان می‌رود. اگر خاموش باشد، فقط سرپرست و ادمین تسک فوری می‌گذارند.' });
def('selfUrgentMaxPerDay', 'self_urgent_max_per_day', 'number', { group: 'planning', min: 1, max: 50, default: 5, label: 'سقف تسک فوری شخصی', description: 'هر کارمند حداکثر چند تسک فوری برای یک روز بگذارد.', hint: 'منظور روزِ برنامه‌ریزی‌شده است، نه روز ثبت.' });
def('taskReportAdminMaxParts', 'task_report_admin_max_parts', 'number', { related: ['supervisors'], group: 'planning', min: 1, max: 10, default: 6, label: 'سقف پیام گزارش تسک ادمین', description: 'گزارش تسک‌های امروز برای ادمین حداکثر در چند پیام برود.', hint: 'گزارش همه‌ی تیم‌هاست؛ سرپرست‌ها همیشه حداکثر ۳ پیام می‌گیرند.' });
def('encouragementsEnabled', 'encouragements_enabled', 'boolean', { group: 'planning', default: true, label: 'پیام تشویقی', description: 'بعد از ثبت گزارش روزانه، پیام تشویقی کوتاه نمایش داده شود.' });
// این‌ها «امتیاز ساعت مفید» را می‌سازند، نه حقوق و مزایای پرداختی. کسر حقوق نیازمند آیین‌نامه و قرارداد مصوب شرکت است.
def('latePerformancePenaltyEnabled', 'late_performance_penalty_enabled', 'boolean', { group: 'performance', default: false, label: 'کسر امتیاز تأخیر', description: 'تأخیر از امتیاز ساعت مفید کم شود.', hint: 'روی ساعت خام تردد و حقوق اثری ندارد.' });
def('latePerformanceThresholdMinutes', 'late_performance_threshold_minutes', 'number', { group: 'performance', min: 0, max: 480, default: 15, label: 'آستانه‌ی کسر امتیاز', description: 'تأخیر بیشتر از این دقیقه مشمول کسر امتیاز می‌شود.' });
def('latePerformancePenaltyFactor', 'late_performance_penalty_factor', 'number', { group: 'performance', integer: false, min: 0, max: 5, default: 1, label: 'ضریب کسر امتیاز', description: 'برای هر دقیقه تأخیرِ مشمول، چند دقیقه از امتیاز کم شود.' });
def('performanceRewardEnabled', 'performance_reward_enabled', 'boolean', { group: 'performance', default: false, label: 'چارچوب تشویق', description: 'چارچوب پاداش عملکرد فعال شود.', hint: 'تا وقتی شرکت فهرست اعمال پاداش را تعریف نکند، امتیازی خودکار اضافه نمی‌شود.' });
def('performanceRewardFactor', 'performance_reward_factor', 'number', { group: 'performance', integer: false, min: 0, max: 5, default: 1, label: 'ضریب پاداش', description: 'ضریب پاداش برای اعمالی که شرکت بعداً تعریف می‌کند. (۱ = بدون تغییر)' });
def('showEarningsCard', 'show_earnings_card', 'boolean', { group: 'performance', default: false, label: 'کارت کارکرد ماه', description: 'کارت «کارکرد این ماه» به کارمند نشان داده شود.', hint: 'در «وضعیت من» و فقط برای کاربری که نرخ ساعتی‌اش ثبت شده است. اگر خاموش باشد، هرگز نمایش داده نمی‌شود.' });
def('disputeMaxReopens', 'dispute_max_reopens', 'number', { group: 'disputes', min: 0, max: 20, default: 3, label: 'سقف ادامه‌ی اعتراض', description: 'کارمند چند بار بتواند اعتراضِ حل‌شده را ادامه دهد. (۰ = ممنوع)' });
def('systemGoLive', 'system_go_live', 'boolean', { group: 'security', default: false, label: 'حالت راه‌اندازی نهایی', description: 'با روشن بودن، بازنشانی برنامه (حذف داده‌ی عملیاتی) مسدود می‌شود.', hint: 'مگر اینکه ALLOW_DATA_RESET=true در فایل .env باشد؛ در غیر این صورت خطای ۴۰۳ می‌دهد.' });
def('duplicateTapWindowSeconds', 'duplicate_tap_window_seconds', 'number', { group: 'security', min: 0, max: 600, default: 120, label: 'مهلت تشخیص ثبت تکراری', description: 'اگر همان کار (ورود، خروج، استراحت) در این چند ثانیه تکرار شود، خطا نمی‌دهد. (۰ = خاموش)', hint: 'جلوی خطای «قبلاً ثبت شده» در دوبار لمس یا شبکه‌ی کند را می‌گیرد؛ چیزی دوبار ثبت نمی‌شود.' });
def('blockOnSharedDevice', 'block_on_shared_device', 'boolean', { group: 'security', default: false, label: 'دستگاه مشترک', description: 'ثبت تردد از دستگاهی که همان روز برای کاربر دیگری استفاده شده، مسدود شود.' });
def('remoteWorkEnabled', 'remote_work_enabled', 'boolean', { related: ['supervisors'], group: 'security', default: true, label: 'دورکاری بیرون از شبکه', description: 'کارمندِ بیرون از شبکه‌ی شرکت بتواند ساعتش را دورکاری ثبت کند.', hint: 'این ساعت‌ها تا تأیید سرپرست در هیچ گزارشی حساب نمی‌شوند. اگر خاموش باشد، فقط خطای «خارج از شبکه» می‌آید.' });
def('remoteWorkBotEnabled', 'remote_work_bot_enabled', 'boolean', { group: 'security', default: true, label: 'دورکاری از بات', description: 'ثبت دورکاری از بات تلگرام مجاز باشد.', hint: 'خاموش‌کردن اضطراری فقط شروع نشست تازه را می‌بندد؛ پایان نشستِ باز همچنان ممکن است.' });
def('remoteWorkBotBlockOnsiteToday', 'remote_work_bot_block_onsite_today', 'boolean', { group: 'security', default: true, label: 'مسدودسازی دورکاری پس از حضور حضوری', description: 'اگر کارمند همان روز حضوری ثبت کرده، دورکاری از بات ثبت نشود.' });
def('remoteWorkAllowAfterOnsiteCheckout', 'remote_work_allow_after_onsite_checkout', 'boolean', { group: 'security', default: true, label: 'دورکاری پس از خروج حضوری', description: 'بعد از ثبت خروج حضوری، شروع دورکاری از بات مجاز باشد.', hint: 'فقط وقتی اثر دارد که «مسدودسازی دورکاری پس از حضور حضوری» روشن باشد. حضوریِ باز همچنان مسدود می‌ماند.' });
def('remoteWorkMaxOpenHours', 'remote_work_max_open_hours', 'number', { related: ['supervisors'], group: 'security', min: 1, max: 72, default: 16, label: 'سقف باز ماندن دورکاری', description: 'دورکاریِ باز بیش از این‌قدر ساعت، شبانه بسته و علامت‌گذاری شود.', hint: 'پایان آن برابر شروع به‌علاوه‌ی همین سقف می‌شود و سرپرست باید دقیق‌تر بررسی کند.' });
// نگهداری و آرشیو
def('auditRetentionMonths', 'audit_retention_months', 'number', { group: 'retention', min: 1, max: 240, default: 24, label: 'نگهداری گزارش رویدادها', description: 'گزارش رویدادها چند ماه در بخش اصلی نگهداری شود.' });
def('auditArchiveEnabled', 'audit_archive_enabled', 'boolean', { group: 'retention', default: false, label: 'آرشیو ماهانه‌ی رویدادها', description: 'رویدادهای قدیمی هر ماه به آرشیو منتقل شوند.', hint: 'اگر خاموش باشد، فقط شمارش انجام می‌شود.' });
def('jobRunsRetentionDays', 'job_runs_retention_days', 'number', { group: 'retention', min: 7, max: 3650, default: 180, label: 'نگهداری تاریخچه‌ی اجرای کارها', description: 'تاریخچه‌ی اجرای کارهای خودکار چند روز نگه داشته شود.' });
def('monitorAlertsRetentionDays', 'monitor_alerts_retention_days', 'number', { group: 'retention', min: 7, max: 3650, default: 180, label: 'نگهداری هشدارهای پایش', description: 'هشدارهای حل‌شده‌ی پایش سیستم چند روز نگه داشته شوند.' });
def('rateLimitRetentionDays', 'rate_limit_retention_days', 'number', { group: 'retention', min: 1, max: 365, default: 7, label: 'نگهداری سوابق محدودیت درخواست', description: 'سوابق منقضی‌شده‌ی محدودیت درخواست چند روز نگه داشته شود.' });
def('notificationsRetentionDays', 'notifications_retention_days', 'number', { group: 'retention', min: 7, max: 3650, default: 90, label: 'نگهداری اعلان‌های خوانده‌شده', description: 'اعلان‌های خوانده‌شده چند روز نگه داشته شوند.', hint: 'اعلان خوانده‌نشده هرگز خودکار حذف نمی‌شود.' });
// S5-7b: آستانه‌های «قواعد الگو» (نشانه، نه اتهام). ۰ برای آستانه‌ی اصلیِ هر قاعده = همان قاعده خاموش
def('patternConsecutiveLateDays', 'pattern_consecutive_late_days', 'number', { group: 'patterns', min: 0, max: 60, default: 3, label: 'تأخیر پشت‌سرهم', description: 'حداقل چند روز حضوریِ متوالی با تأخیر، نشانه ثبت شود. (۰ = خاموش)', hint: 'مرخصی و تعطیلی زنجیره را نمی‌شکند.' });
def('patternWeekdayLateMinCount', 'pattern_weekday_late_min_count', 'number', { group: 'patterns', min: 0, max: 31, default: 3, label: 'تأخیر مکرر در یک روز هفته', description: 'حداقل چند تأخیر در یک روز مشخص هفته، در ماه. (۰ = خاموش)' });
def('patternWeekdayLateMinSharePercent', 'pattern_weekday_late_min_share_percent', 'number', { group: 'patterns', min: 1, max: 100, default: 75, label: 'حداقل سهم تأخیر آن روز هفته', description: 'حداقل چند درصدِ حضورهای آن روز هفته با تأخیر همراه باشد.' });
def('patternWeekdayLateMarginPercent', 'pattern_weekday_late_margin_percent', 'number', { group: 'patterns', min: 0, max: 100, default: 25, label: 'حاشیه‌ی سهم تأخیر روز هفته', description: 'سهم تأخیر آن روز هفته چند واحد درصد از بقیه‌ی روزها بیشتر باشد. (۰ = بدون شرط)', hint: 'برای اینکه کسی که هر روز دیر می‌آید، «الگوی روز هفته» نگیرد.' });
def('patternWeekendAbsenceMinCount', 'pattern_weekend_absence_min_count', 'number', { group: 'patterns', min: 0, max: 31, default: 3, label: 'غیبت چسبیده به تعطیلی', description: 'حداقل چند غیبتِ چسبیده به آخر هفته یا تعطیلی در ماه. (۰ = خاموش)', hint: 'غیبتِ چسبیده یعنی روز قبل یا بعدش آخر هفته یا تعطیلی باشد.' });
def('patternWeekendAbsenceMinSharePercent', 'pattern_weekend_absence_min_share_percent', 'number', { group: 'patterns', min: 1, max: 100, default: 60, label: 'حداقل سهم غیبت چسبیده', description: 'حداقل چند درصدِ غیبت‌های ماه چسبیده به آخر هفته یا تعطیلی باشد.' });
def('patternSuddenIncreaseFactor', 'pattern_sudden_increase_factor', 'number', { group: 'patterns', integer: false, min: 0, max: 20, default: 2, label: 'افزایش ناگهانی تأخیر', description: 'نرخ تأخیر ماه حداقل چند برابر میانگین ماه‌های قبل باشد. (۰ = خاموش)' });
def('patternSuddenIncreaseMinExtraLate', 'pattern_sudden_increase_min_extra_late', 'number', { group: 'patterns', min: 1, max: 31, default: 3, label: 'حداقل تأخیر اضافه‌ی ناگهانی', description: 'حداقل چند روز تأخیرِ بیشتر از انتظار، نشانه‌ی افزایش ناگهانی است.', hint: 'انتظار = نرخ تأخیر ماه‌های قبل × تعداد روزهای حضور ماه.' });
def('patternBaselineMonths', 'pattern_baseline_months', 'number', { group: 'patterns', min: 1, max: 12, default: 3, label: 'ماه‌های مبنا', description: 'برای میانگین، چند ماهِ قبل در نظر گرفته شود.' });
def('patternBaselineMinMonths', 'pattern_baseline_min_months', 'number', { group: 'patterns', min: 1, max: 12, default: 2, label: 'حداقل ماه‌های مبنای معتبر', description: 'حداقل چند ماهِ مبنای معتبر برای اجرای این قاعده لازم است.', hint: 'با کمتر از این تعداد، قاعده برای آن فرد اجرا نمی‌شود. ماه معتبر یعنی حضور کافی داشته باشد.' });
def('patternMinPresentDays', 'pattern_min_present_days', 'number', { group: 'patterns', min: 1, max: 31, default: 5, label: 'حداقل روز حضور برای ماه معتبر', description: 'ماهی که حداقل این‌قدر روز حضور داشته باشد، معتبر شمرده می‌شود.', hint: 'برای ماه جاری و ماه‌های مبنا اعمال می‌شود.' });
def('patternIdenticalTimeMinDays', 'pattern_identical_time_min_days', 'number', { group: 'patterns', min: 0, max: 31, default: 5, label: 'ساعت‌های دقیقاً یکسان', description: 'حداقل چند روز ورود (یا خروج) دقیقاً در یک دقیقه تکرار شود. (۰ = خاموش)', hint: 'ورودی دستی هم می‌تواند چنین الگویی بسازد.' });
def('patternIdenticalTimeMinSharePercent', 'pattern_identical_time_min_share_percent', 'number', { group: 'patterns', min: 1, max: 100, default: 80, label: 'حداقل سهم ساعت‌های یکسان', description: 'حداقل چند درصدِ ورودها (یا خروج‌های) ماه هم‌ساعت باشند.' });
// ---- فاز A سرپرست‌ها: قوانین سراسری (پیش‌فرض‌ها = رفتار هاردکد قبلی) ----
def('teamReviewTaskEnabled', 'team_review_task_enabled', 'boolean', { group: 'supervisors', default: true, label: 'تسک واجب بررسی گزارش تیم', description: 'برای سرپرست‌ها هر روز تسک واجب «بررسی گزارش روز قبل تیم» ساخته شود.', hint: 'اگر خاموش باشد، تسک جدید ساخته نمی‌شود؛ تسک‌های موجود همچنان بسته می‌شوند و مرور گزارش تیم در دسترس می‌ماند.' });
def('teamReviewLookbackDays', 'team_review_lookback_days', 'number', { group: 'supervisors', min: 7, max: 365, default: 60, label: 'بازه‌ی مشاهده‌ی گزارش تیم', description: 'سرپرست گزارش‌های حداکثر چند روز اخیر را ببیند.' });
def('teamReviewCommentMax', 'team_review_comment_max', 'number', { group: 'supervisors', min: 50, max: 1000, default: 300, label: 'سقف نویسه‌ی کامنت مرور گزارش', description: 'حداکثر طول کامنت سرپرست روی گزارش روزانه‌ی عضو تیم.' });
def('supervisorPlanCommentMax', 'supervisor_plan_comment_max', 'number', { group: 'supervisors', min: 100, max: 2000, default: 500, label: 'سقف نویسه‌ی یادداشت برنامه', description: 'حداکثر طول یادداشت سرپرست روی برنامه‌ی هفتگی.' });
def('urgentTaskMaxAheadDays', 'urgent_task_max_ahead_days', 'number', { group: 'supervisors', min: 1, max: 365, default: 60, label: 'سقف فاصله‌ی تسک فوری', description: 'تاریخ تسک فوری حداکثر چند روز جلوتر از امروز باشد.' });
def('missionRejectReasonMin', 'mission_reject_reason_min', 'number', { group: 'supervisors', min: 0, max: 50, default: 3, label: 'حداقل نویسه‌ی علت رد ماموریت', description: 'علت رد ماموریت حداقل چند نویسه باشد. (۰ = اختیاری)' });
def('nightlyReviewMaxParts', 'nightly_review_max_parts', 'number', { group: 'supervisors', min: 1, max: 10, default: 3, label: 'سقف پیام گزارش تسک سرپرست', description: 'گزارش تسک‌های تیم برای هر سرپرست حداکثر در چند پیام برود.', hint: 'مازاد، خلاصه می‌شود و دکمه‌ی پنل نشان داده می‌شود. سقف ادمین‌ها جداست.' });
def('nightlyReviewMaxItemsPerMember', 'nightly_review_max_items_per_member', 'number', { group: 'supervisors', min: 1, max: 20, default: 5, label: 'سقف تسک هر عضو در گزارش', description: 'برای هر عضو تیم حداکثر چند تسک در گزارش بیاید.' });
def('nightlyReviewMaxAttentionLines', 'nightly_review_max_attention_lines', 'number', { group: 'supervisors', min: 5, max: 100, default: 25, label: 'سقف مورد نیازمند توجه', description: 'در مرور شبانه حداکثر چند خط «نیازمند توجه» نمایش داده شود.' });
def('nightlyReviewMaxMissions', 'nightly_review_max_missions', 'number', { group: 'supervisors', min: 1, max: 20, default: 8, label: 'سقف ماموریت در مرور شبانه', description: 'در مرور شبانه حداکثر چند ماموریتِ منتظر تصمیم با دکمه بیاید.', hint: 'بقیه با دکمه‌ی «درخواست‌های منتظر» دیده می‌شوند.' });
def('nightlyReviewSendEnabled', 'nightly_review_send_enabled', 'boolean', { group: 'supervisors', default: true, label: 'ارسال مرور شبانه', description: 'مرور شبانه برای سرپرست‌ها ارسال شود.', hint: 'اگر خاموش باشد، فقط ارسال به سرپرست‌ها متوقف می‌شود.' });
def('morningDigestEnabled', 'morning_digest_enabled', 'boolean', { group: 'supervisors', default: true, label: 'ارسال خلاصه‌ی صبحگاهی', description: 'خلاصه‌ی صبحگاهی تسک‌ها برای سرپرست‌ها ارسال شود.' });
def('supervisorTeamReportEnabled', 'supervisor_team_report_enabled', 'boolean', { group: 'supervisors', default: true, label: 'گزارش‌های دوره‌ای تیم', description: 'گزارش‌های روزانه، هفتگی و ماهانه‌ی تیم برای سرپرست‌ها ارسال شود.' });
def('repeatedLatenessAlertSupervisor', 'repeated_lateness_alert_supervisor', 'boolean', { group: 'supervisors', default: true, label: 'هشدار تأخیر مکرر به سرپرست', description: 'وقتی عضو تیم به آستانه‌ی تأخیر تکراری رسید، به سرپرستش هشدار برود.', hint: 'آستانه در بخش «تأخیر و یادآوری» تنظیم می‌شود.' });
def('supervisorDecisionNotifyAdmins', 'supervisor_decision_notify_admins', 'boolean', { group: 'supervisors', default: true, label: 'اعلان تصمیم سرپرست به ادمین‌ها', description: 'وقتی سرپرست مرخصی یا اعتراض را تصمیم می‌دهد، ادمین‌ها هم مطلع شوند.' });
// S3-8c: زمان‌بندی Jobها (عبارت cron با فرمت node-cron). default از config (.env یا پیش‌فرض کد)؛ مقدار ذخیره‌شده‌ی پنل غالب است و reset دوباره به .env برمی‌گردد.
// job = نام Job (کلید config.cron و نام اجرای ثبت‌شده در job_runs). تغییر این کلیدها از مسیرهای settings بلافاصله با scheduler.reload() اعمال می‌شود (بدون ری‌استارت).
// fallback = پیش‌فرض ثابت امنِ کد برای وقتی که مقدار .env نامعتبر باشد (غلط تایپی cron دیگر سرور را بالا نمی‌آورد/نمی‌شکند).
function defCron(job, key, dbKey, getDefault, fallback, title, extra, group = 'schedule') {
  const hint = `پنج بخش: دقیقه، ساعت، روز ماه، ماه، روز هفته (۰ = یکشنبه … ۶ = شنبه).${extra ? ` ${extra}` : ''}`;
  def(key, dbKey, 'cron', { group, job, default: getDefault, fallback, label: `زمان‌بندی ${title}`, description: `زمان اجرای خودکار «${title}».`, hint });
}
defCron('lateCheckinCheck', 'cronLateCheckinCheck', 'cron_late_checkin_check', () => config.cron.lateCheckinCheck, '*/5 8-12 * * *', 'یادآوری ورود دیرهنگام');
defCron('checkoutReminderCheck', 'cronCheckoutReminderCheck', 'cron_checkout_reminder_check', () => config.cron.checkoutReminderCheck, '*/5 9-18 * * *', 'یادآوری ثبت خروج');
defCron('breakOverrunReminder', 'cronBreakOverrunReminder', 'cron_break_overrun_reminder', () => config.cron.breakOverrunReminder, '* * * * *', 'یادآوری استراحتِ فراموش‌شده');
defCron('scheduledBreakNotice', 'cronScheduledBreakNotice', 'cron_scheduled_break_notice', () => config.cron.scheduledBreakNotice, '* * * * *', 'پیام خودکار استراحت و ناهار', 'باید هر دقیقه اجرا شود تا سر ساعت پیام برود.');
defCron('dailyReport', 'cronDailyReport', 'cron_daily_report', () => config.cron.dailyReport, '0 17 * * *', 'گزارش پایان روز');
defCron('weeklyReport', 'cronWeeklyReport', 'cron_weekly_report', () => config.cron.weeklyReport, '0 8 * * 6', 'گزارش هفتگی');
defCron('monthlyReport', 'cronMonthlyReport', 'cron_monthly_report', () => config.cron.monthlyReport, '0 8 * * *', 'بررسی گزارش ماهانه', 'فقط روز اول ماه شمسی گزارش می‌فرستد؛ پس هر روز اجرا شود.');
defCron('nightlyReview', 'cronNightlyReview', 'cron_nightly_review', () => config.cron.nightlyReview, '0 20 * * *', 'مرور شبانه‌ی سرپرستان', undefined, 'supervisors');
defCron('morningDigest', 'cronMorningDigest', 'cron_morning_digest', () => config.cron.morningDigest, '0 8 * * *', 'خلاصه‌ی صبحگاهی تسک‌ها', 'برای سرپرستان و فقط در روز کاری.', 'supervisors');
defCron('aiDigest', 'cronAiDigest', 'cron_ai_digest', () => config.cron.aiDigest, '0 9 * * *', 'گزارش هوشمند تحلیلگر', 'برای ادمین‌هاست و AI_DIGEST_ENABLED=true در فایل .env لازم دارد.');
defCron('autoCloseIncomplete', 'cronAutoCloseIncomplete', 'cron_auto_close_incomplete', () => config.cron.autoCloseIncomplete, '59 23 * * *', 'بستن رکوردهای بدون خروج');
defCron('markNonWorkingDays', 'cronMarkNonWorkingDays', 'cron_mark_non_working_days', () => config.cron.markNonWorkingDays, '5 0 * * *', 'علامت‌گذاری تعطیل/مرخصی');
defCron('dailyBackup', 'cronDailyBackup', 'cron_daily_backup', () => config.cron.dailyBackup, '30 2 * * *', 'بک‌آپ روزانه');
defCron('auditArchive', 'cronAuditArchive', 'cron_audit_archive', () => config.cron.auditArchive, '0 3 1 * *', 'آرشیو ماهانه‌ی رویدادها');
defCron('dbMaintenance', 'cronDbMaintenance', 'cron_db_maintenance', () => config.cron.dbMaintenance, '0 4 2 * *', 'نگهداری ماهانه‌ی پایگاه داده');
defCron('leaveApprovalReminder', 'cronLeaveApprovalReminder', 'cron_leave_approval_reminder', () => config.cron.leaveApprovalReminder, '15 * * * *', 'یادآوری تأیید مرخصی');
defCron('urgentTaskReminder', 'cronUrgentTaskReminder', 'cron_urgent_task_reminder', () => config.cron.urgentTaskReminder, '*/10 * * * *', 'یادآوری مهلت تسک فوری');
defCron('teamReviewEnsure', 'cronTeamReviewEnsure', 'cron_team_review_ensure', () => config.cron.teamReviewEnsure, '10 0 * * *', 'تسک بررسی گزارش تیم', 'تسک واجب بررسی گزارش تیم را برای سرپرست‌ها می‌سازد.', 'supervisors');
// مرحله ۲: سقف ماهانه‌ی اصلاح رکورد توسط سرپرست (section = عنوان زیربخش «سقف‌ها» در پنل). ادمین/مالک معاف‌اند؛ ۰ = بدون سقف.
def('supervisorRecordEditMonthlyLimit', 'supervisor_record_edit_monthly_limit', 'number', { group: 'supervisors', section: 'سقف‌ها', min: 0, max: 100, default: 3, label: 'سقف اصلاح رکورد در ماه', description: 'هر سرپرست در هر ماه شمسی حداکثر چند بار رکورد تردد کارمندانش را اصلاح کند. (۰ = بدون سقف)', hint: 'ادمین و مالک سقف ندارند. برای ممنوع‌کردن کامل اصلاح، مجوز «اصلاح رکورد» سرپرست را خاموش کنید.' });
def('supervisorEnabledCapabilities', 'supervisor_enabled_capabilities', 'multiselect', { group: 'supervisors', section: 'قابلیت‌های سرپرست', values: SUPERVISOR_TOGGLEABLE_CAPABILITIES, allowEmpty: true, default: SUPERVISOR_TOGGLEABLE_CAPABILITIES, label: 'قابلیت‌های فعال سرپرست‌ها', description: 'کارهایی که سرپرست‌ها می‌توانند انجام دهند؛ موردِ خاموش برای همه بسته می‌شود.', hint: 'اسکوپ تیم (فقط کارمندان مستقیم) و قانون «نه برای خود» همچنان برقرار است. ادمین و مالک تحت‌تأثیر نیستند. اگر «تأیید/رد مرخصی و ماموریت» خاموش شود، درخواست‌ها فقط برای ادمین‌ها دیده می‌شود.' });
def('supervisorRecordEditCountMode', 'supervisor_record_edit_count_mode', 'enum', { group: 'supervisors', section: 'سقف‌ها', values: ['operation', 'record'], default: 'operation', label: 'نحوه‌ی شمارش اصلاح', description: 'هر عملیات یک بار شمرده شود یا هر رکوردِ اصلاح‌شده.', hint: '«هر عملیات» هر اصلاح موفق را می‌شمارد؛ «هر رکورد» چند اصلاح روی یک رکورد در همان ماه را یک بار می‌شمارد.' });
defCron('watchdog', 'cronWatchdog', 'cron_watchdog', () => config.monitor.watchdogCron, '*/5 * * * *', 'پایش سلامت سیستم', 'روشن یا خاموش بودنش با WATCHDOG_ENABLED در فایل .env است.');

// ترتیب زیربخش‌ها در هر گروه (فقط برای نمایش). زیربخشِ ناشناخته/بدون زیربخش بعد از همه می‌آید و ترتیب تعریف حفظ می‌شود.
const SECTION_ORDER = {
  workHours: ['ساعت و منطقه‌ی زمانی', 'تأخیر و زودتر رفتن', 'ناهار', 'استراحت', 'خروج و ورود مجدد', 'پیام خودکار استراحت و ناهار', 'تایم پرت هنگام خروج', 'هشدار و علامت‌گذاری'],
};

// ---------- توابع عمومی ----------
const BY_KEY = new Map(REGISTRY.map((d) => [d.key, d]));

function getDef(key) {
  return BY_KEY.get(key) || null;
}

function keys() {
  return REGISTRY.map((d) => d.key);
}

// تنظیم‌های زمان‌بندی (S3-8c): [{ job, key }] به ترتیب تعریف
function cronJobs() {
  return REGISTRY.filter((d) => d.type === 'cron' && d.job).map((d) => ({ job: d.job, key: d.key }));
}

// پیش‌فرض معتبر: default (در صورت تابع بودن، در لحظه) و اگر نامعتبر بود fallback
function defaultOf(key) {
  const d = BY_KEY.get(key);
  if (!d) return undefined;
  const raw = typeof d.default === 'function' ? d.default() : d.default;
  const r = validateValue(d, raw);
  if (r.ok) return r.value;
  if (d.fallback !== undefined) return d.fallback;
  throw new Error(`پیش‌فرض نامعتبر برای تنظیم ${key}`);
}

// اعتبارسنجی مقدار ورودی یک کلید (برای API در S3-1b)
function validate(key, raw) {
  const d = BY_KEY.get(key);
  if (!d) return { ok: false, error: 'کلید تنظیمات ناشناخته است.' };
  if (raw === undefined || raw === null || raw === '') return { ok: false, error: 'مقدار الزامی است.' };
  return validateValue(d, raw);
}

// مقدار ذخیره‌شده در DB (متن) → مقدار نوع‌دار؛ نبودن یا خرابی/خارج از بازه ⇒ پیش‌فرض (هرگز NaN و هرگز پرتاب خطا)
function deserialize(key, raw) {
  const d = BY_KEY.get(key);
  if (!d) return undefined;
  if (raw === undefined || raw === null) return defaultOf(key);
  const r = validateValue(d, raw);
  return r.ok ? r.value : defaultOf(key);
}

// مقدار معتبر → متن برای DB (بولی به '1'/'0' مثل قبل)
function serialize(key, value) {
  const d = BY_KEY.get(key);
  if (d.type === 'boolean') return value ? '1' : '0';
  if (d.type === 'weekdays' || d.type === 'multiselect') return value.join(',');
  return String(value);
}

// برابری دو مقدار نرمال‌شده‌ی یک تنظیم (آرایه‌ی weekdays با === برابر نمی‌شود)
function sameValue(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => x === b[i]);
  return a === b;
}

// بررسی سلامت خود رجیستری (کلید تکراری، نوع ناشناخته، پیش‌فرض نامعتبر، enum بدون values، cron/min>max)
function selfCheck() {
  const problems = [];
  const seenKeys = new Set();
  const seenDb = new Set();
  const seenJobs = new Set();
  REGISTRY.forEach((d) => {
    if (d.job) { if (seenJobs.has(d.job)) problems.push(`نام Job تکراری: ${d.job}`); seenJobs.add(d.job); }
    if (seenKeys.has(d.key)) problems.push(`کلید تکراری: ${d.key}`);
    if (seenDb.has(d.dbKey)) problems.push(`کلید DB تکراری: ${d.dbKey}`);
    seenKeys.add(d.key); seenDb.add(d.dbKey);
    if (!TYPES.includes(d.type)) problems.push(`نوع نامعتبر: ${d.key}`);
    if (!d.description) problems.push(`توضیح خالی: ${d.key}`);
    if (!GROUP_LABELS[d.group]) problems.push(`گروه نامعتبر: ${d.key}`);
    if (!d.label) problems.push(`برچسب خالی: ${d.key}`);
    if ((d.type === 'enum' || d.type === 'multiselect') && !(Array.isArray(d.values) && d.values.length)) problems.push(`values خالی: ${d.key}`);
    if (d.type === 'cron' && !d.job) problems.push(`نام Job برای تنظیم cron نیست: ${d.key}`);
    if (d.min !== undefined && d.max !== undefined && d.min > d.max) problems.push(`min>max: ${d.key}`);
    const raw = typeof d.default === 'function' ? d.default() : d.default;
    if (!validateValue(d, raw).ok && d.fallback === undefined) problems.push(`پیش‌فرض نامعتبر: ${d.key}`);
    if (d.fallback !== undefined && !validateValue(d, d.fallback).ok) problems.push(`fallback نامعتبر: ${d.key}`);
  });
  return problems;
}

// زیربخش‌بندی گروه‌های بلند (تب‌های پنل). فقط نمایش؛ ترتیب تب‌ها همین ترتیب کلیدهای اینجاست. گروه‌های کوتاه (≤۷ مورد) بدون تب می‌مانند.
const SECTION_MAP = {
  overtime: {
    'قواعد اضافه‌کاری': ['overtimeEnabled', 'overtimeRequiresApproval', 'overtimeMinMinutes', 'overtimeDailyCapMinutes', 'overtimeMonthlyCapMinutes'],
    'ضریب و گرد کردن': ['overtimeFactor', 'overtimeHolidayFactor', 'overtimeRounding', 'overtimeRoundStep'],
  },
  leave: {
    'استحقاق و مانده': ['leaveDefaultEntitlementMinutes', 'leaveCarryOverCapMinutes', 'leaveBalancePolicy'],
    'ثبت و مهلت‌ها': ['leaveAllowPastRequests', 'leaveMaxPastDays', 'leaveMaxFutureDays', 'leaveMinNoticeHours', 'leaveApprovalReminderHours'],
    'پیوست': ['leaveAttachmentMaxKb', 'leaveAttachmentTypes'],
    'ماموریت': ['missionReminderHour', 'missionBackdateDays', 'missionAdvanceDays', 'allowCheckinWithPendingMission'],
  },
  planning: {
    'برنامه‌ی هفتگی': ['weekStartDay', 'planSubmissionWeekday', 'planGateWarnWeekday', 'planMinTasks', 'planGateMode', 'planGateStartDate'],
    'گزارش روزانه': ['dailyReportGateMode', 'reportBackfillDays', 'reportSoftWindowHours', 'reportMaxExtraTasks'],
    'تسک‌ها و پیام‌ها': ['taskCarryMaxTimes', 'selfUrgentEnabled', 'selfUrgentMaxPerDay', 'taskReportAdminMaxParts', 'encouragementsEnabled'],
  },
  security: {
    'راه‌اندازی و ثبت تردد': ['systemGoLive', 'duplicateTapWindowSeconds', 'blockOnSharedDevice'],
    'دورکاری': ['remoteWorkEnabled', 'remoteWorkBotEnabled', 'remoteWorkBotBlockOnsiteToday', 'remoteWorkAllowAfterOnsiteCheckout', 'remoteWorkMaxOpenHours'],
  },
  patterns: {
    'تأخیر': ['patternConsecutiveLateDays', 'patternWeekdayLateMinCount', 'patternWeekdayLateMinSharePercent', 'patternWeekdayLateMarginPercent', 'patternSuddenIncreaseFactor', 'patternSuddenIncreaseMinExtraLate'],
    'غیبت و ساعت یکسان': ['patternWeekendAbsenceMinCount', 'patternWeekendAbsenceMinSharePercent', 'patternIdenticalTimeMinDays', 'patternIdenticalTimeMinSharePercent'],
    'ماه‌های مبنا': ['patternBaselineMonths', 'patternBaselineMinMonths', 'patternMinPresentDays'],
  },
  supervisors: {
    'بررسی گزارش تیم': ['teamReviewTaskEnabled', 'teamReviewLookbackDays', 'teamReviewCommentMax', 'supervisorPlanCommentMax', 'urgentTaskMaxAheadDays', 'missionRejectReasonMin'],
    'مرور شبانه و خلاصه‌ها': ['nightlyReviewSendEnabled', 'nightlyReviewMaxParts', 'nightlyReviewMaxItemsPerMember', 'nightlyReviewMaxAttentionLines', 'nightlyReviewMaxMissions', 'morningDigestEnabled', 'supervisorTeamReportEnabled'],
    'هشدارها و اعلان‌ها': ['repeatedLatenessAlertSupervisor', 'supervisorDecisionNotifyAdmins'],
    'سقف‌ها': ['supervisorRecordEditMonthlyLimit', 'supervisorRecordEditCountMode'],
    'قابلیت‌های سرپرست': ['supervisorEnabledCapabilities'],
    'زمان‌بندی': ['cronNightlyReview', 'cronMorningDigest', 'cronTeamReviewEnsure'],
  },
  schedule: {
    'یادآوری‌ها': ['cronLateCheckinCheck', 'cronCheckoutReminderCheck', 'cronBreakOverrunReminder', 'cronScheduledBreakNotice', 'cronLeaveApprovalReminder', 'cronUrgentTaskReminder'],
    'گزارش‌ها': ['cronDailyReport', 'cronWeeklyReport', 'cronMonthlyReport', 'cronAiDigest'],
    'پایان روز و تقویم': ['cronAutoCloseIncomplete', 'cronMarkNonWorkingDays'],
    'نگهداری و پایش': ['cronDailyBackup', 'cronAuditArchive', 'cronDbMaintenance', 'cronWatchdog'],
  },
};
for (const [group, secs] of Object.entries(SECTION_MAP)) {
  const seen = new Set();
  for (const [sec, ks] of Object.entries(secs)) {
    for (const k of ks) {
      const d = REGISTRY.find((x) => x.key === k);
      if (!d || d.group !== group) throw new Error(`SECTION_MAP: کلید ${k} در گروه ${group} نیست`);
      d.section = sec; seen.add(k);
    }
  }
  const missing = REGISTRY.filter((d) => d.group === group && !seen.has(d.key)).map((d) => d.key);
  if (missing.length) throw new Error(`SECTION_MAP: کلیدهای بدون زیربخش در ${group}: ${missing.join(', ')}`);
  SECTION_ORDER[group] = Object.keys(secs);
}

// تنظیم‌های «پیشرفته»: تخصصی و کم‌کاربرد. فقط نمایش را عوض می‌کند (در پنل زیر بخش بسته‌ی «پیشرفته» می‌مانند)؛ رفتار و مقدار پیش‌فرض دست‌نخورده است.
const ADVANCED_KEYS = [
  'fixedLunchMinPresenceMinutes', 'fixedLunchMinOverlapMinutes', 'fixedLunchProRate', 'maxLunchMinutes', 'lateCountsFrom',
  'scheduledWarnMinutes', 'longOpenBreakMinutes', 'outsideShiftMarginMinutes', 'overtimeRoundStep',
  'rateLimitRetentionDays', 'jobRunsRetentionDays', 'monitorAlertsRetentionDays', 'notificationsRetentionDays',
  'patternBaselineMonths', 'patternBaselineMinMonths', 'patternMinPresentDays', 'patternWeekdayLateMarginPercent', 'patternSuddenIncreaseMinExtraLate',
  'nightlyReviewMaxParts', 'nightlyReviewMaxItemsPerMember', 'nightlyReviewMaxAttentionLines', 'nightlyReviewMaxMissions',
  'taskReportAdminMaxParts', 'teamReviewCommentMax', 'supervisorPlanCommentMax',
];
for (const k of ADVANCED_KEYS) {
  const d = REGISTRY.find((x) => x.key === k);
  if (!d) throw new Error(`ADVANCED_KEYS: کلید ناشناخته ${k}`);
  d.advanced = true;
}

module.exports = { REGISTRY, ADVANCED_KEYS, SECTION_ORDER, GROUP_LABELS, TYPES, getDef, keys, cronJobs, defaultOf, validate, validateValue, deserialize, serialize, sameValue, selfCheck };

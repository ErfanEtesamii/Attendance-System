// S3-1a: رجیستری تنظیمات پویا. «تنها منبع حقیقت» برای کلیدها، نوع، پیش‌فرض، بازه، توضیح و گروه.
// خالص است (بدون SQL و بدون دسترسی به DB)؛ ذخیره/خواندن در settingsRepository انجام می‌شود.
//
// افزودن تنظیم جدید = یک خط در REGISTRY (پایین همین فایل)؛ اعتبارسنجی، پیش‌فرض و خواندن/ذخیره خودکار است.
//
// انواع: number (عدد صحیح، مگر integer:false) | boolean | time (HH:MM) | cron (با node-cron validate)
//        | enum (values) | string (minLength/maxLength اختیاری) | timezone (نام IANA، مثل Asia/Tehran)
//        | weekdays (آرایه‌ی روزهای هفته ۰=یکشنبه … ۶=شنبه؛ ورودی آرایه یا متن «4,5»؛ مقدار نرمال = آرایه‌ی مرتب و یکتا)

const cron = require('node-cron');
const config = require('../config');
const time = require('./time');

const TYPES = ['number', 'boolean', 'time', 'cron', 'enum', 'string', 'timezone', 'weekdays'];

// برچسب فارسی گروه‌ها (برای صفحه‌ی تنظیمات گروه‌بندی‌شده در S3-9a)
const GROUP_LABELS = {
  workHours: 'ساعت کاری',
  calendar: 'تقویم کاری',
  overtime: 'اضافه‌کاری',
  leave: 'مرخصی و مانده',
  reminders: 'تأخیر و یادآوری',
  security: 'امنیت',
  retention: 'نگهداری و آرشیو داده',
  schedule: 'زمان‌بندی Jobها',
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
    default:
      return bad('نوع تنظیم ناشناخته است.');
  }
}

// ---------- تعریف رجیستری ----------
// def(key، کلید DB، نوع، { default، fallback، min، max، values، group، description })
//  - default می‌تواند تابع باشد (مثلاً خواندن از config در لحظه‌ی استفاده).
//  - fallback: مقدار ثابت امن برای وقتی که default (مثلاً از .env) نامعتبر باشد؛ سرور به‌خاطر غلط تایپی در .env بالا نیامدن ندارد.
const REGISTRY = [];
function def(key, dbKey, type, opts) {
  REGISTRY.push({ key, dbKey, type, ...opts });
}

// ساعت کاری
def('timezone', 'timezone', 'timezone', { group: 'workHours', default: () => config.timezone, fallback: 'Asia/Tehran', description: 'منطقه‌ی زمانی شرکت (نام IANA) برای تعیین روز و ساعت کاری' });
def('workDayStart', 'work_day_start', 'time', { group: 'workHours', default: () => config.workDayStart, fallback: '08:00', description: 'ساعت شروع کار' });
def('workDayEnd', 'work_day_end', 'time', { group: 'workHours', default: () => config.workDayEnd, fallback: '16:30', description: 'ساعت پایان کار' });
// S3-3a: مهلت تأخیر در محاسبه‌ی روز (نه یادآور؛ یادآور ورود با lateCheckinGraceMinutes جداست)
def('lateGraceMinutes', 'late_grace_minutes', 'number', { group: 'workHours', min: 0, max: 240, default: 0, description: 'مهلت تأخیر (دقیقه) پس از ساعت شروع کار؛ ورود تا پایان مهلت «تأخیر» حساب نمی‌شود (۰ = بدون مهلت)' });
def('lateCountsFrom', 'late_counts_from', 'enum', { group: 'workHours', values: ['shift_start', 'after_grace'], default: 'shift_start', description: 'مبنای دقیقه‌ی تأخیر پس از گذشتن از مهلت: shift_start = از ساعت شروع کار (کل تأخیر)، after_grace = فقط از پایان مهلت' });
def('earlyGraceMinutes', 'early_grace_minutes', 'number', { group: 'workHours', min: 0, max: 240, default: 0, description: 'مهلت زودتر رفتن (دقیقه) پیش از ساعت پایان کار؛ خروج تا این مقدار زودتر «زودتر رفتن» حساب نمی‌شود (۰ = بدون مهلت). در صورت عبور از مهلت، کل دقیقه‌های مانده تا پایان کار حساب می‌شود' });
// S3-7a: تقویم کاری (فقط برای getCalendarDay؛ مصرف‌کننده‌ها در S3-7c وصل می‌شوند). روزهای هفته: ۰=یکشنبه … ۶=شنبه
def('weekendDays', 'weekend_days', 'weekdays', { group: 'calendar', maxDays: 6, default: [5], description: 'روزهای آخر هفته‌ی (تعطیل) شرکت برای کاربر بدون شیفت؛ ۰=یکشنبه … ۶=شنبه (پیش‌فرض جمعه = ۵). کاربر دارای شیفت از «روزهای کاری شیفت» پیروی می‌کند' });
def('halfDayWeekdays', 'half_day_weekdays', 'weekdays', { group: 'calendar', allowEmpty: true, default: [4], description: 'روزهای هفته‌ی نیم‌روز کاری (پیش‌فرض پنجشنبه = ۴)؛ فقط روزی که کاری است نیم‌روز می‌شود. فهرست خالی = بدون نیم‌روز' });
def('halfDayEndTime', 'half_day_end_time', 'time', { group: 'calendar', default: '12:30', description: 'ساعت پایان کار در روزهای نیم‌روز؛ اگر از شروع کار زودتر یا از پایان کار دیرتر باشد نادیده گرفته می‌شود' });
// S3-4a: استراحت‌ها (هر دو پیش‌فرض ۰ = خاموش ⇒ رفتار قبلی)
def('maxLunchMinutes', 'max_lunch_minutes', 'number', { group: 'workHours', min: 0, max: 480, default: 0, description: 'حداکثر ناهار مجاز در روز (دقیقه)؛ مازاد ناهار ثبت‌شده به‌صورت «مازاد استراحت» گزارش می‌شود و همچنان از ساعت مفید کم می‌شود (۰ = بدون سقف)' });
def('fixedLunchDeductMinutes', 'fixed_lunch_deduct_minutes', 'number', { group: 'workHours', min: 0, max: 480, default: 0, description: 'کسر ثابت ناهار (دقیقه) از ساعت مفید روزهای بسته‌شده‌ای که هیچ ناهاری ثبت نشده (۰ = خاموش)؛ استراحت کوتاه جای ناهار حساب نمی‌شود' });
// S3-4b: آستانه‌ی پرچم‌ها (فقط گزارش؛ عددی را عوض نمی‌کنند)
def('longOpenBreakMinutes', 'long_open_break_minutes', 'number', { group: 'workHours', min: 1, max: 720, default: 120, description: 'آستانه‌ی پرچم «استراحت بسته‌نشده» (دقیقه): استراحتی که پایان نخورده و بیش از این مدت طول کشیده پرچم می‌شود' });
def('outsideShiftMarginMinutes', 'outside_shift_margin_minutes', 'number', { group: 'workHours', min: 0, max: 720, default: 120, description: 'حاشیه‌ی مجاز (دقیقه) ورود/خروج پیش از شروع یا پس از پایان کار؛ بیرون از آن پرچم «خارج از شیفت» می‌خورد (۷۲۰ = عملاً خاموش)' });
// S3-5a: اضافه‌کاری روزانه (پیش‌فرض خاموش؛ ضریب‌ها ۱ = خنثی، عدد قانونی hard-code نشده)
def('overtimeEnabled', 'overtime_enabled', 'boolean', { group: 'overtime', default: false, description: 'محاسبه‌ی «اضافه‌کاری قابل‌پرداخت» (خاموش = ۰؛ اضافه‌کاری خام همچنان گزارش می‌شود)' });
def('overtimeMinMinutes', 'overtime_min_minutes', 'number', { group: 'overtime', min: 0, max: 480, default: 0, description: 'حداقل اضافه‌کاری روزانه (دقیقه) برای قابل‌پرداخت بودن؛ کمتر از آن صفر حساب می‌شود و برابر یا بیشتر کامل (۰ = بدون آستانه)' });
def('overtimeDailyCapMinutes', 'overtime_daily_cap_minutes', 'number', { group: 'overtime', min: 0, max: 720, default: 0, description: 'سقف اضافه‌کاری قابل‌پرداخت در یک روز (دقیقه)؛ پیش از گرد‌کردن و ضریب برش می‌خورد (۰ = بدون سقف)' });
def('overtimeFactor', 'overtime_factor', 'number', { group: 'overtime', integer: false, min: 0, max: 10, default: 1, description: 'ضریب اضافه‌کاری روز عادی (۱ = بدون ضریب)؛ دقیقه‌ی قابل‌پرداخت = دقیقه‌ی گرد‌شده × ضریب' });
def('overtimeHolidayFactor', 'overtime_holiday_factor', 'number', { group: 'overtime', integer: false, min: 0, max: 10, default: 1, description: 'ضریب اضافه‌کاری رکورد روز تعطیل (status = holiday)؛ ۱ = بدون ضریب' });
def('overtimeRoundStep', 'overtime_round_step', 'number', { group: 'overtime', min: 1, max: 60, default: 1, description: 'گام گرد‌کردن اضافه‌کاری (دقیقه)؛ ۱ = بدون گرد‌کردن' });
def('overtimeRounding', 'overtime_rounding', 'enum', { group: 'overtime', values: ['down', 'nearest', 'up'], default: 'down', description: 'حالت گرد‌کردن به گام: down = به پایین، nearest = نزدیک‌ترین (نیم‌گام به بالا)، up = به بالا' });
def('overtimeMonthlyCapMinutes', 'overtime_monthly_cap_minutes', 'number', { group: 'overtime', min: 0, max: 12000, default: 0, description: 'سقف ماهانه‌ی اضافه‌کاری قابل‌پرداخت (دقیقه‌ی معادل، پس از آستانه/گرد‌کردن/ضریب)؛ روزها به ترتیب تاریخ جمع می‌شوند و مازاد بر سقف قابل‌پرداخت نیست (۰ = بدون سقف). فقط در محاسبه‌ی ماهانه اعمال می‌شود، نه خروجی روزانه' });
def('overtimeRequiresApproval', 'overtime_requires_approval', 'boolean', { group: 'overtime', default: false, description: 'الزام تأیید اضافه‌کاری: وقتی روشن باشد اضافه‌کاری هر روز تا تأیید سرپرست/ادمین «معلق» است و در اضافه‌کاری قابل‌پرداخت ماهانه نمی‌آید؛ ردشده هم نمی‌آید (خاموش = بدون نیاز به تأیید)' });
// مرخصی و مانده (S4-9b). هیچ عدد قانونی hard-code نیست: پیش‌فرض‌ها خنثی‌اند و ادمین مقدار شرکت را می‌دهد.
def('leaveDefaultEntitlementMinutes', 'leave_default_entitlement_minutes', 'number', { group: 'leave', min: 0, max: 10000000, default: 0, description: 'استحقاق پیش‌فرض سالانه (دقیقه) برای هر نوعِ دارای مانده، وقتی برای کاربر/سال ردیف استحقاق صریح ثبت نشده؛ ردیف صریح همیشه اولویت دارد (۰ = بدون استحقاق پیش‌فرض). مثلاً ۲۶ روز × طول روز کاری را خودتان به دقیقه بدهید' });
def('leaveCarryOverCapMinutes', 'leave_carry_over_cap_minutes', 'number', { group: 'leave', min: 0, max: 10000000, default: 0, description: 'سقف مقدار انتقالی از سال قبل (دقیقه) هنگام ثبت انتقالی؛ بیشتر از آن رد می‌شود (۰ = بدون سقف)' });
def('leaveBalancePolicy', 'leave_balance_policy', 'enum', { group: 'leave', values: ['block', 'warn', 'allow_negative'], default: 'warn', description: 'وقتی درخواست از مانده بیشتر است: block = ثبت رد می‌شود، warn = ثبت می‌شود ولی هشدار می‌دهد، allow_negative = بی‌صدا مانده منفی می‌شود (اعمال در ثبت درخواست: S4-10a)' });
def('leaveAllowPastRequests', 'leave_allow_past_requests', 'boolean', { group: 'leave', default: true, description: 'اجازه‌ی ثبت درخواست مرخصی/مأموریت برای تاریخ گذشته (خاموش = فقط از امروز به بعد)' });
def('leaveMaxPastDays', 'leave_max_past_days', 'number', { group: 'leave', min: 0, max: 3650, default: 0, description: 'حداکثر فاصله‌ی گذشته‌ی مجاز (روز) برای تاریخ شروع درخواست، وقتی ثبت گذشته مجاز است (۰ = بدون سقف)' });
def('leaveMaxFutureDays', 'leave_max_future_days', 'number', { group: 'leave', min: 0, max: 3650, default: 0, description: 'حداکثر فاصله‌ی آینده (روز) برای تاریخ شروع درخواست (۰ = بدون سقف)' });
def('leaveMinNoticeHours', 'leave_min_notice_hours', 'number', { group: 'leave', min: 0, max: 8760, default: 0, description: 'حداقل پیش‌اطلاع (ساعت) بین لحظه‌ی ثبت و شروع مرخصی (برای ساعتی از ساعت شروع، وگرنه از ابتدای روز شروع)؛ فقط برای درخواست‌های آینده (۰ = بدون حداقل)' });
def('backupIncludeAttachments', 'backup_include_attachments', 'boolean', { group: 'retention', default: true, description: 'بک‌آپ روزانه پوشه‌ی پیوست‌های مرخصی را هم (به‌صورت آینه‌ی افزایشی در پوشه‌ی بک‌آپ) کپی کند' });
def('leaveAttachmentMaxKb', 'leave_attachment_max_kb', 'number', { group: 'leave', min: 16, max: 20000, default: 5120, description: 'حداکثر حجم پیوست درخواست مرخصی (کیلوبایت)؛ سقف دانلود بات تلگرام حدود ۲۰ مگابایت است' });
def('leaveAttachmentTypes', 'leave_attachment_types', 'string', { group: 'leave', default: 'image/jpeg,image/png,application/pdf', maxLength: 200, description: 'نوع‌های مجاز پیوست (mime، با ویرگول)؛ محتوای فایل با امضای JPEG/PNG/PDF هم سنجیده می‌شود، پس فقط زیرمجموعه‌ی همین سه نوع معنی دارد' });
def('leaveApprovalReminderHours', 'leave_approval_reminder_hours', 'number', { group: 'leave', min: 0, max: 8760, default: 0, description: 'اگر درخواست مرخصی بیش از این ساعت در مرحله‌ی فعلی بی‌اقدام ماند، به تأییدکننده‌ی همان مرحله یادآوری می‌رود (۰ = خاموش)' });
def('leaveApprovalEscalateHours', 'leave_approval_escalate_hours', 'number', { group: 'leave', min: 0, max: 8760, default: 0, description: 'اگر پس از یادآوریِ مرحله‌ی «سرپرست» این‌قدر ساعت دیگر هم بی‌اقدام ماند، مرحله به ادمین ارجاع می‌شود (۰ = ارجاعِ زمان‌محور خاموش)' });
def('leaveEscalateWhenApproverOnLeave', 'leave_escalate_when_approver_on_leave', 'boolean', { group: 'leave', default: false, description: 'اگر سرپرست مستقیم خودش مرخصی/مأموریت تأییدشده‌ی امروز (روزانه یا نیم‌روز) دارد، مرحله‌ی او فوراً به ادمین ارجاع شود' });
def('leaveApprovalExtraStepDays', 'leave_approval_extra_step_days', 'number', { group: 'leave', min: 0, max: 3650, default: 0, description: 'اگر طول بازه‌ی درخواست (روز تقویمی) بیشتر از این عدد باشد، علاوه بر سرپرست یک مرحله‌ی تأیید دیگر هم لازم است (۰ = خاموش)' });
def('leaveApprovalExtraStepTypes', 'leave_approval_extra_step_types', 'string', { group: 'leave', default: '', maxLength: 200, description: 'کدهای نوع مرخصی (با ویرگول، مثل annual,sick) که همیشه مرحله‌ی تأیید اضافه می‌خواهند؛ خالی = هیچ' });
def('leaveApprovalExtraStepRole', 'leave_approval_extra_step_role', 'enum', { group: 'leave', values: ['admin', 'hr'], default: 'admin', description: 'تأییدکننده‌ی مرحله‌ی اضافه: ادمین یا منابع انسانی' });
// تأخیر و یادآوری
def('lateCheckinGraceMinutes', 'late_checkin_grace_minutes', 'number', { group: 'reminders', min: 0, max: 720, default: () => config.lateCheckinGraceMinutes, fallback: 15, description: 'مهلت تأخیر ورود (دقیقه) پس از ساعت شروع، پیش از یادآوری ورود' });
def('checkoutReminderMinutesBefore', 'checkout_reminder_minutes_before', 'number', { group: 'reminders', min: 0, max: 720, default: () => config.checkoutReminderMinutesBefore, fallback: 15, description: 'یادآوری ثبت خروج، این‌قدر دقیقه پیش از پایان کار' });
def('repeatedLatenessThreshold', 'repeated_lateness_threshold', 'number', { group: 'reminders', min: 1, max: 100, default: () => config.repeatedLatenessThreshold, fallback: 3, description: 'حداقل تعداد تأخیر در ماه برای اعلان «تأخیر تکراری» به مدیر' });
// امنیت
def('blockOnSharedDevice', 'block_on_shared_device', 'boolean', { group: 'security', default: false, description: 'مسدودکردن ثبت تردد وقتی دستگاه همان روز برای کاربر دیگری استفاده شده' });
// نگهداری و آرشیو
def('auditRetentionMonths', 'audit_retention_months', 'number', { group: 'retention', min: 1, max: 240, default: 24, description: 'مدت نگهداری رویدادهای audit در جدول اصلی (ماه)' });
def('auditArchiveEnabled', 'audit_archive_enabled', 'boolean', { group: 'retention', default: false, description: 'انتقال ماهانه‌ی audit قدیمی به آرشیو (خاموش = فقط شمارش)' });
def('jobRunsRetentionDays', 'job_runs_retention_days', 'number', { group: 'retention', min: 7, max: 3650, default: 180, description: 'نگهداری تاریخچه‌ی اجرای Jobها (روز)' });
def('monitorAlertsRetentionDays', 'monitor_alerts_retention_days', 'number', { group: 'retention', min: 7, max: 3650, default: 180, description: 'نگهداری هشدارهای حل‌شده‌ی مانیتورینگ (روز)' });
def('rateLimitRetentionDays', 'rate_limit_retention_days', 'number', { group: 'retention', min: 1, max: 365, default: 7, description: 'نگهداری ردیف‌های منقضی‌شده‌ی rate limit (روز)' });
def('notificationsRetentionDays', 'notifications_retention_days', 'number', { group: 'retention', min: 7, max: 3650, default: 90, description: 'نگهداری اعلان‌های «خوانده‌شده» (روز؛ اعلان خوانده‌نشده هرگز خودکار حذف نمی‌شود)' });
// S3-8c: زمان‌بندی Jobها (عبارت cron با فرمت node-cron). default از config (.env یا پیش‌فرض کد)؛ مقدار ذخیره‌شده‌ی پنل غالب است و reset دوباره به .env برمی‌گردد.
// job = نام Job (کلید config.cron و نام اجرای ثبت‌شده در job_runs). تغییر این کلیدها از مسیرهای settings بلافاصله با scheduler.reload() اعمال می‌شود (بدون ری‌استارت).
// fallback = پیش‌فرض ثابت امنِ کد برای وقتی که مقدار .env نامعتبر باشد (غلط تایپی cron دیگر سرور را بالا نمی‌آورد/نمی‌شکند).
function defCron(job, key, dbKey, getDefault, fallback, title) {
  def(key, dbKey, 'cron', { group: 'schedule', job, default: getDefault, fallback, description: `زمان‌بندی Job «${title}» (عبارت cron: دقیقه ساعت روزماه ماه روزهفته؛ ۰=یکشنبه … ۶=شنبه). بدون ری‌استارت اعمال می‌شود` });
}
defCron('lateCheckinCheck', 'cronLateCheckinCheck', 'cron_late_checkin_check', () => config.cron.lateCheckinCheck, '*/5 8-12 * * *', 'یادآوری ورود دیرهنگام');
defCron('checkoutReminderCheck', 'cronCheckoutReminderCheck', 'cron_checkout_reminder_check', () => config.cron.checkoutReminderCheck, '*/5 9-18 * * *', 'یادآوری ثبت خروج');
defCron('dailyReport', 'cronDailyReport', 'cron_daily_report', () => config.cron.dailyReport, '0 17 * * *', 'گزارش پایان روز');
defCron('weeklyReport', 'cronWeeklyReport', 'cron_weekly_report', () => config.cron.weeklyReport, '0 8 * * 6', 'گزارش هفتگی');
defCron('monthlyReport', 'cronMonthlyReport', 'cron_monthly_report', () => config.cron.monthlyReport, '0 8 * * *', 'بررسی گزارش ماهانه‌ی شمسی (فقط روز اول ماه شمسی می‌فرستد؛ هر روز اجرا شود)');
defCron('nightlyReview', 'cronNightlyReview', 'cron_nightly_review', () => config.cron.nightlyReview, '0 20 * * *', 'مرور شبانه‌ی سرپرستان');
defCron('autoCloseIncomplete', 'cronAutoCloseIncomplete', 'cron_auto_close_incomplete', () => config.cron.autoCloseIncomplete, '59 23 * * *', 'بستن رکوردهای بدون خروج');
defCron('markNonWorkingDays', 'cronMarkNonWorkingDays', 'cron_mark_non_working_days', () => config.cron.markNonWorkingDays, '5 0 * * *', 'علامت‌گذاری تعطیل/مرخصی');
defCron('dailyBackup', 'cronDailyBackup', 'cron_daily_backup', () => config.cron.dailyBackup, '30 2 * * *', 'بک‌آپ روزانه');
defCron('auditArchive', 'cronAuditArchive', 'cron_audit_archive', () => config.cron.auditArchive, '0 3 1 * *', 'آرشیو ماهانه‌ی audit');
defCron('dbMaintenance', 'cronDbMaintenance', 'cron_db_maintenance', () => config.cron.dbMaintenance, '0 4 2 * *', 'نگهداری ماهانه‌ی دیتابیس');
defCron('leaveApprovalReminder', 'cronLeaveApprovalReminder', 'cron_leave_approval_reminder', () => config.cron.leaveApprovalReminder, '15 * * * *', 'یادآوری/ارجاع تأیید مرخصی');
defCron('watchdog', 'cronWatchdog', 'cron_watchdog', () => config.monitor.watchdogCron, '*/5 * * * *', 'watchdog (سلامت سیستم؛ روشن/خاموش‌بودنش همچنان با WATCHDOG_ENABLED در .env است)');

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
  if (d.type === 'weekdays') return value.join(',');
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
    if (d.type === 'enum' && !(Array.isArray(d.values) && d.values.length)) problems.push(`values خالی: ${d.key}`);
    if (d.type === 'cron' && !d.job) problems.push(`نام Job برای تنظیم cron نیست: ${d.key}`);
    if (d.min !== undefined && d.max !== undefined && d.min > d.max) problems.push(`min>max: ${d.key}`);
    const raw = typeof d.default === 'function' ? d.default() : d.default;
    if (!validateValue(d, raw).ok && d.fallback === undefined) problems.push(`پیش‌فرض نامعتبر: ${d.key}`);
    if (d.fallback !== undefined && !validateValue(d, d.fallback).ok) problems.push(`fallback نامعتبر: ${d.key}`);
  });
  return problems;
}

module.exports = { REGISTRY, GROUP_LABELS, TYPES, getDef, keys, cronJobs, defaultOf, validate, validateValue, deserialize, serialize, sameValue, selfCheck };

// فاز D (بخش ۱): کلیدهای مجازِ «استثنا برای هر سرپرست». خالص است: بدون DB.
// هر کلید همان کلید رجیستری تنظیمات (settingsRegistry) است؛ استثنا فقط برای نقش manager اعمال می‌شود.
// قابلیت‌های ماتریس مجوز (supervisorEnabledCapabilities) عمداً اینجا نیستند (مرحله‌ی بعد).

const SUPERVISOR_OVERRIDE_DEFS = Object.freeze({
  nightlyReviewSendEnabled: Object.freeze({ type: 'boolean', label: 'دریافت مرور شبانه' }),
  morningDigestEnabled: Object.freeze({ type: 'boolean', label: 'دریافت خلاصه‌ی صبحگاهی' }),
  supervisorTeamReportEnabled: Object.freeze({ type: 'boolean', label: 'دریافت گزارش‌های دوره‌ای تیم' }),
  repeatedLatenessAlertSupervisor: Object.freeze({ type: 'boolean', label: 'دریافت هشدار تأخیر مکرر' }),
  supervisorRecordEditMonthlyLimit: Object.freeze({ type: 'number', min: 0, max: 100, label: 'سقف اصلاح رکورد در ماه' }),
});

const SUPERVISOR_OVERRIDE_KEYS = Object.freeze(Object.keys(SUPERVISOR_OVERRIDE_DEFS));

const isKey = (key) => typeof key === 'string' && Object.prototype.hasOwnProperty.call(SUPERVISOR_OVERRIDE_DEFS, key);

// ⇒ { ok: true, value } | { ok: false, error }
function validateOverride(key, value) {
  if (!isKey(key)) return { ok: false, error: 'کلید استثنا نامعتبر است.' };
  const def = SUPERVISOR_OVERRIDE_DEFS[key];
  if (def.type === 'boolean') {
    if (typeof value !== 'boolean') return { ok: false, error: 'مقدار باید روشن یا خاموش باشد.' };
    return { ok: true, value };
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < def.min || value > def.max) {
    return { ok: false, error: `مقدار باید عدد صحیح بین ${def.min} و ${def.max} باشد.` };
  }
  return { ok: true, value };
}

module.exports = { SUPERVISOR_OVERRIDE_DEFS, SUPERVISOR_OVERRIDE_KEYS, isKey, validateOverride };

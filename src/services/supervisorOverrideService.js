// فاز D (بخش ۱): اولویت «استثنای سرپرست > تنظیم سراسری». هر خطا ⇒ مقدار سراسری (هرگز رفتار را نمی‌شکند).
// فقط برای کاربر با role === 'manager' اعمال می‌شود؛ admin/owner/hr/employee همیشه مقدار سراسری می‌گیرند.
const repo = require('../repositories/supervisorOverridesRepository');
const { isKey, validateOverride } = require('../utils/supervisorOverrideKeys');

const isManager = (user) => !!user && user.role === 'manager';

// مقدار استثنا یا undefined (بدون استثنا / کاربر غیرسرپرست / کلید غیرمجاز / خطا)
function overrideOf(user, key) {
  if (!isManager(user) || !isKey(key)) return undefined;
  try {
    const v = repo.get(user.id, key);
    return validateOverride(key, v).ok ? v : undefined;
  } catch (_) { return undefined; }
}

// مقدار مؤثر برای این کاربر؛ globalValue همان مقدار تنظیم سراسری است که فراخواننده خوانده
function effective(user, key, globalValue) {
  const v = overrideOf(user, key);
  return v === undefined ? globalValue : v;
}

// آیا برای این کلید «حداقل یک» سرپرست استثنای مقدار value دارد؟ (برای نگه‌داشتن short-circuit سراسری در job ها)
function anyOverrideEquals(key, value) {
  if (!isKey(key)) return false;
  try {
    for (const v of repo.mapForKey(key).values()) if (v === value && validateOverride(key, v).ok) return true;
    return false;
  } catch (_) { return false; }
}

module.exports = { overrideOf, effective, anyOverrideEquals };

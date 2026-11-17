// فاز D (بخش ۲): جانشین سرپرست.
// قاعده: کاربر با role='manager' می‌تواند جانشین (users.deputy_id، آن‌هم role='manager' و فعال) داشته باشد.
// جانشین «فعال» است وقتی سرپرست غیرفعال باشد یا امروز «تمام‌روز» در مرخصی/ماموریتِ تأییدشده باشد (calendarService.fullyOnApprovedLeave).
// جانشینِ فعال، «علاوه بر» سرپرست: اعلان/یادآوریِ تأیید را می‌گیرد، می‌تواند مرخصی/ماموریت و اجازه‌ی ورود اعضای تیم را تصمیم بگیرد
// و تسک فوری تعیین کند. سرپرست برنمی‌خورد (تصمیمِ اول نهایی است)؛ ادمین‌ها هم مثل قبل. هیچ‌کس برای خودش تصمیم نمی‌گیرد.
// بدون deputy_id ⇒ همه‌ی خروجی‌ها null/false و رفتار فعلی. هر خطا ⇒ «بدون جانشین» (هرگز رفتار را نمی‌شکند).
const usersRepository = require('../repositories/usersRepository');

const isManager = (u) => !!u && u.role === 'manager';

// سرپرست امروز در دسترس نیست؟ (غیرفعال یا تمام‌روز در مرخصی/ماموریتِ تأییدشده)
function isAbsent(manager, { now = new Date(), settings } = {}) {
  if (!manager) return false;
  if (!manager.is_active) return true;
  try {
    const settingsRepository = require('../repositories/settingsRepository');
    const calendarService = require('../engine/calendarService');
    const { todayInZone } = require('../utils/time');
    const s = settings || settingsRepository.getAll();
    const date = todayInZone(s.timezone, now);
    const cal = calendarService.getCalendarDay(manager, date, { settings: s });
    return !!(cal && cal.isWorkingDay && calendarService.fullyOnApprovedLeave(manager, date, cal));
  } catch (_) { return false; }
}

// جانشینِ «فعالِ» این سرپرست یا null (بدون جانشین / سرپرست حاضر است / جانشین نامعتبر، غیرفعال یا خودش غایب)
function activeDeputyOf(manager, opts = {}) {
  try {
    if (!isManager(manager) || !manager.deputy_id || manager.deputy_id === manager.id) return null;
    const deputy = usersRepository.findById(manager.deputy_id);
    if (!isManager(deputy) || !deputy.is_active) return null;
    if (!isAbsent(manager, opts) || isAbsent(deputy, opts)) return null;
    return deputy;
  } catch (_) { return null; }
}

// آیا actor همین الان جانشینِ فعالِ سرپرستِ managerId است؟
function actsFor(actor, managerId, opts = {}) {
  if (!isManager(actor) || !managerId || managerId === actor.id) return false;
  const deputy = activeDeputyOf(usersRepository.findById(managerId), opts);
  return !!deputy && deputy.id === actor.id;
}

// سرپرستانی که actor همین الان جانشینِ فعالشان است
function coveredManagers(actor, opts = {}) {
  if (!isManager(actor)) return [];
  try {
    return usersRepository.listByDeputy(actor.id).filter((m) => m.id !== actor.id && actsFor(actor, m.id, opts));
  } catch (_) { return []; }
}

// اعتبارسنجی انتخاب جانشین (برای API) ⇒ null یا متن خطا
function validateDeputy(supervisor, deputy) {
  if (!isManager(supervisor)) return 'جانشین فقط برای کاربرانِ با نقش سرپرست تعریف می‌شود.';
  if (!deputy) return 'جانشین یافت نشد.';
  if (deputy.id === supervisor.id) return 'سرپرست نمی‌تواند جانشین خودش باشد.';
  if (!isManager(deputy)) return 'جانشین باید نقش سرپرست داشته باشد (ادمین‌ها خودشان به همه‌ی درخواست‌ها دسترسی دارند).';
  if (!deputy.is_active) return 'جانشین باید فعال باشد.';
  return null;
}

module.exports = { isAbsent, activeDeputyOf, actsFor, coveredManagers, validateDeputy };

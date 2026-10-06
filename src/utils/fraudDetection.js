// قواعد تشخیص «نشانه‌ی مشکوک» (S2-4). همه‌ی توابع این فایل خالص‌اند:
// بدون DB، بدون زمان سیستم، بدون تغییر ورودی. ثبت نتیجه در suspiciousRepository و اتصال به
// ثبت تردد/nightlyReview کار S2-4e است.
//
// ⚠️ device_id سمت کلاینت ساخته می‌شود و قابل جعل است؛ خروجی فقط «نشانه» است، نه مدرک.

const { normalizeDeviceId } = require('./deviceInfo');

const EVENT_SHARED_DEVICE = 'shared_device';

// قاعده‌ی الف: یک device_id معتبر برای دو (یا بیشتر) کاربر مختلف در یک روز.
// ورودی: records = [{ id, user_id, record_date, check_in_device, check_out_device }]
//   (هر ردیف attendance_records؛ هر دو device ورود و خروج بررسی می‌شود.)
// خروجی: آرایه‌ی کاندیدای رویداد با همان شکل ورودی suspiciousRepository.create،
//   مرتب‌شده بر اساس (تاریخ، device) تا نتیجه قطعی باشد. یک کاربر که با یک device
//   چند بار ثبت کند، یا ردیف بدون device/با device نامعتبر ⇒ هیچ نشانه‌ای نمی‌سازد.
function detectSharedDevice(records) {
  if (!Array.isArray(records)) return [];

  // کلید گروه: تاریخ + device ⇒ { users: Set, recordIds: Set }
  const groups = new Map();
  for (const rec of records) {
    if (!rec || !Number.isInteger(rec.user_id) || typeof rec.record_date !== 'string') continue;
    const devices = new Set(
      [rec.check_in_device, rec.check_out_device].map(normalizeDeviceId).filter(Boolean)
    );
    for (const deviceId of devices) {
      const key = `${rec.record_date}\u0000${deviceId}`;
      let g = groups.get(key);
      if (!g) {
        g = { eventDate: rec.record_date, deviceId, users: new Set(), recordIds: new Set() };
        groups.set(key, g);
      }
      g.users.add(rec.user_id);
      if (Number.isInteger(rec.id)) g.recordIds.add(rec.id);
    }
  }

  const byNum = (a, b) => a - b;
  return [...groups.values()]
    .filter((g) => g.users.size >= 2)
    .map((g) => ({
      eventType: EVENT_SHARED_DEVICE,
      userIds: [...g.users].sort(byNum),
      recordIds: [...g.recordIds].sort(byNum),
      eventDate: g.eventDate,
      details: { rule: 'A', deviceId: g.deviceId, userCount: g.users.size },
    }))
    .sort((a, b) => (a.eventDate < b.eventDate ? -1 : a.eventDate > b.eventDate ? 1
      : a.details.deviceId < b.details.deviceId ? -1 : a.details.deviceId > b.details.deviceId ? 1 : 0));
}

module.exports = { EVENT_SHARED_DEVICE, detectSharedDevice };

// C5: ورود/خروج با ماموریتِ در انتظار (بدون بلوکه‌کردن). منطق تصمیم‌گیری و «نشانه» اینجاست تا middleware/route ساده بماند.
const settingsRepository = require('../repositories/settingsRepository');
const leaveRepository = require('../repositories/leaveRepository');
const suspiciousRepository = require('../repositories/suspiciousRepository');
const auditRepository = require('../repositories/auditRepository');

// آیا ورود/خروج از بیرون شبکه با ماموریتِ pending امروز مجاز است؟ ⇒ شناسه‌ی ماموریت یا null (تنظیم خاموش/نبودن pending)
function pendingMissionPass(userId, dateStr) {
  if (!userId) return null;
  if (settingsRepository.getAll().allowCheckinWithPendingMission !== true) return null;
  return leaveRepository.findPendingMissionOnDate(userId, dateStr);
}

// «نشانه» (نه اتهام) برای بررسی بعدی؛ ضدخطا ⇒ هرگز روی ثبت تردد اثر نمی‌گذارد
function flagPendingMissionOutside({ userId, record, requestId, action }) {
  try {
    const res = suspiciousRepository.create({
      eventType: 'pending_mission_outside', userIds: [userId], recordIds: [record.id], eventDate: record.record_date,
      details: { requestId, action },
    });
    auditRepository.logEvent({ userId, action: 'attendance_allowed_via_pending_mission', details: { requestId, recordId: record.id, step: action } });
    return res;
  } catch (err) {
    console.error('[pendingMission] ثبت نشانه ناموفق (نادیده گرفته شد):', err.message);
    return null;
  }
}

module.exports = { pendingMissionPass, flagPendingMissionOutside };

// Job پایان روز: رکوردهایی که ورود دارند ولی خروج ندارند را «ناقص» علامت‌گذاری می‌کند
// تا ادمین بعداً بررسی/اصلاح کند (طبق فاز ۵ سند). زمان خروج دستکاری نمی‌شود، فقط وضعیت.
// شیفت شب (S3-6c): رکورد امروزِ کاربر شیفت شب هنوز در جریان است (شیفت فردا صبح تمام می‌شود) ⇒ امروز دست نمی‌خورد؛
// رکورد باز «دیروز»ِ همان کاربران (شیفتی که حالا تمام شده) در اجرای امروز بسته/علامت می‌خورد.

const attendanceRepository = require('../../repositories/attendanceRepository');
const auditRepository = require('../../repositories/auditRepository');
const shiftsRepository = require('../../repositories/shiftsRepository');
const { todayDateString } = require('../../utils/serverTime');
const { isOvernightShift, addDays } = require('../../utils/shiftDay');

async function autoCloseIncompleteRecords() {
  const today = todayDateString();
  const nightCache = new Map();
  const isNightUser = (userId) => {
    if (!nightCache.has(userId)) nightCache.set(userId, isOvernightShift(shiftsRepository.findByUserId(userId)));
    return nightCache.get(userId);
  };
  const openRecords = [
    ...attendanceRepository.listOpenRecordsByDate(today).filter((r) => !isNightUser(r.user_id)),
    ...attendanceRepository.listOpenRecordsByDate(addDays(today, -1)).filter((r) => isNightUser(r.user_id)),
  ];

  for (const record of openRecords) {
    attendanceRepository.updateStatus(record.id, 'incomplete');
    auditRepository.logEvent({
      userId: record.user_id,
      action: 'record_auto_marked_incomplete',
      details: { recordId: record.id, date: record.record_date },
    });
  }

  return openRecords.length;
}

module.exports = { autoCloseIncompleteRecords };

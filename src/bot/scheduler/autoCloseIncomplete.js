// Job پایان روز: رکوردهایی که ورود دارند ولی خروج ندارند را «ناقص» علامت‌گذاری می‌کند
// تا ادمین بعداً بررسی/اصلاح کند (طبق فاز ۵ سند). زمان خروج دستکاری نمی‌شود، فقط وضعیت.

const attendanceRepository = require('../../repositories/attendanceRepository');
const auditRepository = require('../../repositories/auditRepository');
const { todayDateString } = require('../../utils/serverTime');

async function autoCloseIncompleteRecords() {
  const today = todayDateString();
  const openRecords = attendanceRepository.listOpenRecordsByDate(today);

  for (const record of openRecords) {
    attendanceRepository.updateStatus(record.id, 'incomplete');
    auditRepository.logEvent({
      userId: record.user_id,
      action: 'record_auto_marked_incomplete',
      details: { recordId: record.id, date: today },
    });
  }

  return openRecords.length;
}

module.exports = { autoCloseIncompleteRecords };

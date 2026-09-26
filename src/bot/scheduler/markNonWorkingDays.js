// Job اول صبح (قبل از شروع پنجره ثبت ورود): برای هر کارمند فعال، اگر امروز تعطیل رسمی باشد یا
// کارمند برای امروز مرخصی «تأییدشده» (نوع 'leave'، نه مأموریت) داشته باشد، و هنوز هیچ رکوردی برای
// امروز ثبت نشده، یک رکورد placeholder با status='holiday'/'leave' می‌سازد.
//
// این کار رفع گپ فاز ۵ سند وضعیت پروژه است: قبل از این Job، چنین روزهایی در گزارش پایان روز
// (reports.js) به‌اشتباه «غایب» نشان داده می‌شدند چون هیچ رکوردی برایشان وجود نداشت. reports.js هم
// به‌صورت مستقل (fallback) همین دو شرط را چک می‌کند، پس حتی اگر این Job به هر دلیلی اجرا نشود یا
// مرخصی بعد از اجرای صبحگاهی تأیید شود، گزارش باز هم درست خواهد بود؛ این Job فقط وضعیت را به‌صورت
// دائمی در دیتابیس ثبت می‌کند (برای تاریخچه/گزارش‌های آینده) که به‌مراتب بهتر از سکوت است.
// عمداً «مأموریت» را شامل نمی‌شود چون کارمند در مأموریت هنوز باید ورود ثبت کند (فقط از چک شبکه فاز ۲ معاف است).

const usersRepository = require('../../repositories/usersRepository');
const attendanceRepository = require('../../repositories/attendanceRepository');
const holidaysRepository = require('../../repositories/holidaysRepository');
const leaveRepository = require('../../repositories/leaveRepository');
const auditRepository = require('../../repositories/auditRepository');
const { todayDateString } = require('../../utils/serverTime');

async function markNonWorkingDays() {
  const today = todayDateString();
  const isHolidayToday = holidaysRepository.isHoliday(today);
  const users = usersRepository.listUsers({ onlyActive: true });
  let marked = 0;

  for (const user of users) {
    let status = null;
    if (isHolidayToday) {
      status = 'holiday';
    } else if (leaveRepository.hasApprovedLeaveOnDate(user.id, today, 'leave')) {
      status = 'leave';
    }
    if (!status) continue;

    const created = attendanceRepository.ensureNonWorkingDayRecord(user.id, today, status);
    if (created) {
      marked += 1;
      auditRepository.logEvent({
        userId: user.id,
        action: 'record_auto_marked_non_working_day',
        details: { date: today, status },
      });
    }
  }

  return marked;
}

module.exports = { markNonWorkingDays };

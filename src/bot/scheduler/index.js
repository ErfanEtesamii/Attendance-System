// ثبت تمام Jobهای زمان‌بندی‌شده فاز ۳. عبارات cron از src/config.js (که خودش از .env می‌خواند) گرفته می‌شود.
// ⚠️ پیش‌فرض‌های cron را حتماً متناسب با روزهای کاری واقعی شرکت در .env بازبینی کنید
// (پیش‌فرض فعلی: شنبه تا چهارشنبه به‌عنوان روزهای کاری در نظر گرفته شده - کدهای 6,0,1,2,3 در node-cron).

const cron = require('node-cron');
const config = require('../../config');
const { checkLateCheckins, checkRepeatedLateness } = require('./lateCheckinReminder');
const { checkCheckoutReminders } = require('./checkoutReminder');
const { autoCloseIncompleteRecords } = require('./autoCloseIncomplete');
const { sendDailyReport, sendWeeklyReport, sendMonthlyReport } = require('./reports');

function startSchedulers(bot) {
  cron.schedule(config.cron.lateCheckinCheck, () => {
    checkLateCheckins(bot).catch((err) => console.error('[scheduler] lateCheckinCheck error:', err));
    checkRepeatedLateness(bot).catch((err) => console.error('[scheduler] repeatedLateness error:', err));
  });

  cron.schedule(config.cron.checkoutReminderCheck, () => {
    checkCheckoutReminders(bot).catch((err) => console.error('[scheduler] checkoutReminder error:', err));
  });

  cron.schedule(config.cron.dailyReport, () => {
    sendDailyReport(bot).catch((err) => console.error('[scheduler] dailyReport error:', err));
  });

  cron.schedule(config.cron.weeklyReport, () => {
    sendWeeklyReport(bot).catch((err) => console.error('[scheduler] weeklyReport error:', err));
  });

  cron.schedule(config.cron.monthlyReport, () => {
    sendMonthlyReport(bot).catch((err) => console.error('[scheduler] monthlyReport error:', err));
  });

  cron.schedule(config.cron.autoCloseIncomplete, () => {
    autoCloseIncompleteRecords().catch((err) => console.error('[scheduler] autoCloseIncomplete error:', err));
  });

  console.log('[bot] تمام Jobهای زمان‌بندی‌شده فعال شدند.');
}

module.exports = { startSchedulers };

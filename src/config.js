// ماژول مرکزی خواندن تنظیمات از فایل .env
// در فازهای بعد (مثلاً فاز ۲) از همین فایل برای خواندن ALLOWED_NETWORK_CIDR استفاده می‌شود.

require('dotenv').config();
const path = require('path');

const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  dbPath: path.resolve(process.cwd(), process.env.DB_PATH || './data/attendance.db'),
  nodeEnv: process.env.NODE_ENV || 'development',
  allowedNetworkCidr: process.env.ALLOWED_NETWORK_CIDR || '192.168.10.0/24',

  // آیا یک ریورس‌پراکسی (IIS/nginx/...) جلوی این سرویس روی همان سرور محلی قرار دارد؟
  // این مقدار مستقیماً روی درستی چک IP فاز ۲ اثر می‌گذارد - توضیح کامل در README.
  trustProxy: process.env.TRUST_PROXY === 'true',

  // ===== فاز ۳: تنظیمات بات تلگرام =====
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',

  // آدرس Mini App برای دکمه منوی بات (فعلاً placeholder - Mini App واقعی در فاز ۴ ساخته می‌شود).
  // اگر خالی باشد، دکمه Menu تنظیم نمی‌شود.
  miniAppUrl: process.env.MINI_APP_URL || '',

  // ساعت شروع/پایان رسمی کار، برای تشخیص تأخیر/زودتر رفتن/اضافه‌کاری و یادآوری‌ها.
  // فرمت HH:mm بر اساس ساعت سرور. محاسبه کامل و نهایی در فاز ۵ انجام می‌شود؛
  // این مقدار همان‌جا هم دوباره استفاده خواهد شد.
  workDayStart: process.env.WORK_DAY_START || '08:00',
  workDayEnd: process.env.WORK_DAY_END || '16:30',

  // چند دقیقه بعد از WORK_DAY_START هنوز ورود ثبت نشده، یادآوری تأخیر ورود ارسال شود.
  lateCheckinGraceMinutes: parseInt(process.env.LATE_CHECKIN_GRACE_MINUTES || '15', 10),

  // چند دقیقه قبل از WORK_DAY_END یادآوری ثبت خروج ارسال شود.
  checkoutReminderMinutesBefore: parseInt(process.env.CHECKOUT_REMINDER_MINUTES_BEFORE || '15', 10),

  // بعد از چند تأخیر در ماه جاری به مدیر مستقیم هشدار «تأخیر مکرر» ارسال شود.
  repeatedLatenessThreshold: parseInt(process.env.REPEATED_LATENESS_THRESHOLD || '3', 10),

  // عبارات Cron برای Jobهای زمان‌بندی‌شده (فرمت node-cron: دقیقه ساعت روزماه ماه روزهفته).
  // ⚠️ پیش‌فرض‌ها را حتماً متناسب با روزهای کاری واقعی شرکت در .env تنظیم کنید.
  cron: {
    // بررسی روزانه ورودهای دیرهنگام (هر روز، مقداری بعد از WORK_DAY_START اجرا شود)
    lateCheckinCheck: process.env.CRON_LATE_CHECKIN_CHECK || '*/5 8-12 * * 6,0,1,2,3',
    // یادآوری ثبت خروج نزدیک پایان ساعت کاری
    checkoutReminderCheck: process.env.CRON_CHECKOUT_REMINDER_CHECK || '*/5 15-18 * * 6,0,1,2,3',
    // گزارش پایان روز برای مدیران/ادمین
    dailyReport: process.env.CRON_DAILY_REPORT || '0 17 * * 6,0,1,2,3',
    // گزارش هفتگی (شروع هفته کاری - شنبه صبح)
    weeklyReport: process.env.CRON_WEEKLY_REPORT || '0 8 * * 6',
    // گزارش ماهانه (اول ماه میلادی - در صورت نیاز به تقویم شمسی باید جداگانه پیاده‌سازی شود)
    monthlyReport: process.env.CRON_MONTHLY_REPORT || '0 8 1 * *',
    // بستن خودکار رکوردهای بدون خروج ثبت‌شده در پایان روز (وضعیت «ناقص»)
    autoCloseIncomplete: process.env.CRON_AUTO_CLOSE_INCOMPLETE || '59 23 * * *',
  },
};

module.exports = config;

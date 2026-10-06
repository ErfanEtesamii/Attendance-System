// ماژول مرکزی خواندن تنظیمات از فایل .env
// در فازهای بعد (مثلاً فاز ۲) از همین فایل برای خواندن ALLOWED_NETWORK_CIDR استفاده می‌شود.

// در تست‌ها (NODE_ENV=test) .env واقعی خوانده نمی‌شود تا تست‌ها hermetic باشند و به توکن/دیتابیس واقعی دست نزنند
if (process.env.NODE_ENV !== 'test') {
  require('dotenv').config();
}
const path = require('path');

// مقدار enum از env را نرمال می‌کند؛ مقدار نامعتبر = پیش‌فرض (تا غلط تایپی در .env سرور را از کار نیندازد)
function enumEnv(value, allowed, fallback) {
  const v = String(value || '').trim().toLowerCase();
  return allowed.includes(v) ? v : fallback;
}

// عدد صحیح مثبت از env؛ مقدار نامعتبر/صفر/منفی = پیش‌فرض (تا غلط تایپی در .env نگهداری بک‌آپ را خراب نکند)
function positiveIntEnv(value, fallback) {
  const n = parseInt(String(value || '').trim(), 10);
  return Number.isInteger(n) && n >= 1 ? n : fallback;
}

const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  dbPath: path.resolve(process.cwd(), process.env.DB_PATH || './data/attendance.db'),
  nodeEnv: process.env.NODE_ENV || 'development',
  allowedNetworkCidr: process.env.ALLOWED_NETWORK_CIDR || '192.168.10.0/24',

  // آیا یک ریورس‌پراکسی (IIS/nginx/...) جلوی این سرویس روی همان سرور محلی قرار دارد؟
  // این مقدار مستقیماً روی درستی چک IP فاز ۲ اثر می‌گذارد - توضیح کامل در README.
  trustProxy: process.env.TRUST_PROXY === 'true',

  // بخش ۲-ب۲: محل نگهداری شمارنده‌های rate limit. sqlite (پیش‌فرض) = ماندگار و بدون صفر شدن با ری‌استارت؛
  // memory = فقط حافظه‌ی پروسه (رفتار قبلی). اگر دیتابیس خطا بدهد، limiter موقتاً به حافظه برمی‌گردد (fail-open).
  rateLimitStore: enumEnv(process.env.RATE_LIMIT_STORE, ['sqlite', 'memory'], 'sqlite'),

  // ===== بخش ۲-ج۱: مانیتورینگ و هشدار =====
  monitor: {
    // watchdog هر چند دقیقه سلامت سیستم را می‌سنجد و در صورت مشکل به ادمین‌ها در تلگرام هشدار می‌دهد
    watchdogEnabled: process.env.WATCHDOG_ENABLED !== 'false',
    watchdogCron: process.env.CRON_WATCHDOG || '*/5 * * * *',
    // حداقل فاصله‌ی دو هشدار «از یک نوع» (دقیقه). هشدار Job شکست‌خورده هر ۲۴ ساعت تکرار می‌شود (نه ساعتی).
    alertThrottleMinutes: parseInt(process.env.ALERT_THROTTLE_MINUTES || '60', 10),
    // اگر فضای آزاد دیسکِ پوشه‌ی دیتابیس کمتر از این مقدار (مگابایت) شد هشدار
    diskMinFreeMb: parseInt(process.env.MONITOR_DISK_MIN_FREE_MB || '1024', 10),
    // اگر این‌قدر ثانیه از آخرین getUpdates موفق بات گذشته باشد، polling «قطع» حساب می‌شود
    pollingStaleSeconds: parseInt(process.env.MONITOR_POLLING_STALE_SECONDS || '120', 10),
    // شکست Jobی که قدیمی‌تر از این (ساعت) باشد دیگر وضعیت را degraded نمی‌کند (فقط در تاریخچه می‌ماند)
    jobFailureWindowHours: parseInt(process.env.MONITOR_JOB_FAILURE_WINDOW_HOURS || '72', 10),
    // بررسی بک‌آپ (سن آخرین بک‌آپ سالم + فایل‌های .suspect). از S2-1c پیش‌فرض روشن است (فقط مقدار دقیق 'false' خاموشش می‌کند).
    // بک‌آپ‌های pre-migration و فایل‌های .suspect به‌عنوان «آخرین بک‌آپ» حساب نمی‌شوند.
    backupCheck: process.env.MONITOR_BACKUP_CHECK !== 'false',
    backupDir: path.resolve(process.cwd(), process.env.BACKUP_DIR || './data/backups'),
    backupMaxAgeHours: parseInt(process.env.MONITOR_BACKUP_MAX_AGE_HOURS || '36', 10),
  },

  // ===== بخش ۲-ج۲: بک‌آپ روزانه (S2-1) =====
  // پوشه‌ی مقصد همان monitor.backupDir است (BACKUP_DIR). زمان اجرا: cron.dailyBackup (CRON_DAILY_BACKUP).
  backup: {
    // تعداد بک‌آپ روزانه‌ی نگه‌داشته‌شده (جدیدترین‌ها) و تعداد کپی ماهانه (اولین بک‌آپ هر ماه میلادی)
    keepDaily: positiveIntEnv(process.env.BACKUP_KEEP_DAILY, 14),
    keepMonthly: positiveIntEnv(process.env.BACKUP_KEEP_MONTHLY, 6),
  },

  // ===== بخش ۲-د: تشخیص موارد مشکوک (S2-4) =====
  fraud: {
    // قاعده‌ی ب: دو کاربر با یک IP که ثبتشان با فاصله‌ی کمتر از این‌قدر ثانیه باشد «نشانه» حساب می‌شود (پیش‌فرض ۶۰)
    sameIpWindowSeconds: positiveIntEnv(process.env.FRAUD_SAME_IP_WINDOW_SECONDS, 60),
    // قاعده‌ی ج: تغییر ناگهانی دستگاه. الگو = device‌های چند روز تقویمیِ اخیر (پیش‌فرض ۷) و حداقل چند روزِ
    // دارای device لازم است تا «الگو» حساب شود (پیش‌فرض ۳)
    deviceChangeLookbackDays: positiveIntEnv(process.env.FRAUD_DEVICE_CHANGE_LOOKBACK_DAYS, 7),
    deviceChangeMinHistoryDays: positiveIntEnv(process.env.FRAUD_DEVICE_CHANGE_MIN_HISTORY_DAYS, 3),
  },

  // ===== فاز ۳: تنظیمات بات تلگرام =====
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',

  // آدرس Mini App برای دکمه منوی بات (فعلاً placeholder - Mini App واقعی در فاز ۴ ساخته می‌شود).
  // اگر خالی باشد، دکمه Menu تنظیم نمی‌شود.
  miniAppUrl: process.env.MINI_APP_URL || '',

  // ===== فاز ۸: پنل مدیریتی وب (ورود با Telegram Login Widget) =====

  // یوزرنیم بات (بدون @)، لازم برای ویجت «ورود با تلگرام» در صفحه لاگین پنل ادمین.
  telegramBotUsername: process.env.TELEGRAM_BOT_USERNAME || '',

  // کلید امضای session پنل ادمین. حتماً در production یک مقدار تصادفی و طولانی در .env بگذارید؛
  // در توسعه اگر خالی باشد یک مقدار پیش‌فرض (ناامن) استفاده می‌شود تا فقط توسعه راحت باشد.
  adminSessionSecret:
    process.env.ADMIN_SESSION_SECRET ||
    (process.env.NODE_ENV === 'production' ? '' : 'dev-only-insecure-secret-change-me'),

  // مدت اعتبار session ورود مدیر به پنل وب (روز)
  adminSessionMaxAgeDays: parseInt(process.env.ADMIN_SESSION_MAX_AGE_DAYS || '7', 10),

  // ===== بخش ۲-الف: هدرهای امنیتی، کوکی و CSRF =====
  // حالت CSP: 'report-only' (پیش‌فرض: فقط گزارش تخلف در لاگ سرور، چیزی مسدود نمی‌شود) | 'enforce' | 'off'.
  // بعد از چند روز استفاده‌ی واقعی داخل تلگرام و دیدن‌نشدن گزارش تخلف، روی 'enforce' بگذارید.
  cspMode: enumEnv(process.env.CSP_MODE, ['off', 'report-only', 'enforce'], 'report-only'),
  // اگر ویجت «ورود با تلگرام» برای callback خود eval لازم داشت (فقط در صورت دیدن گزارش تخلف unsafe-eval)، این را true کنید.
  cspPanelUnsafeEval: process.env.CSP_PANEL_UNSAFE_EVAL === 'true',
  // HSTS فقط روی پاسخ‌های HTTPS ارسال می‌شود. پیش‌فرض ۱۸۰ روز، بدون includeSubDomains/preload (محافظه‌کارانه).
  hstsMaxAgeSeconds: parseInt(process.env.HSTS_MAX_AGE_SECONDS || '15552000', 10),
  // SameSite کوکی نشست پنل. پیش‌فرض strict؛ اگر در کلاینتی ورود شکست خورد موقتاً lax بگذارید.
  adminCookieSameSite: enumEnv(process.env.ADMIN_COOKIE_SAMESITE, ['strict', 'lax'], 'strict'),
  // Originهای اضافه‌ی مجاز برای درخواست‌های نوشتنی پنل (جدا با ویرگول؛ مثلاً https://attendance.farazhonar.com).
  // به‌صورت پیش‌فرض فقط Origin هم‌میزبان (همان Host درخواست) مجاز است.
  csrfExtraOrigins: (process.env.CSRF_EXTRA_ORIGINS || '').split(',').map((x) => x.trim()).filter(Boolean),

  // ===== HTTPS مستقیم از خود Node (بدون IIS/nginx) =====
  // طبق تصمیم معماری پروژه: چون هیچ ریورس‌پراکسی‌ای جلوی این سرویس قرار نمی‌گیرد، اگر این دو مسیر
  // پر شوند، سرور مستقیماً با https.createServer بالا می‌آید؛ اگر خالی بمانند (مثلاً در توسعه‌ی
  // محلی روی سیستم شخصی)، به همان HTTP ساده روی PORT برمی‌گردد.
  // فایل‌ها را بعد از صدور گواهی با DNS-01 برای attendance.farazhonar.com همین‌جا قرار دهید.
  sslCertPath: process.env.SSL_CERT_PATH || '',
  sslKeyPath: process.env.SSL_KEY_PATH || '',
  httpsEnabled: !!(process.env.SSL_CERT_PATH && process.env.SSL_KEY_PATH),

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
    // بررسی روزانه برای گزارش ماهانه شمسی (خود Job فقط در روز اول ماه شمسی واقعاً گزارش می‌فرستد)
    monthlyReport: process.env.CRON_MONTHLY_REPORT || '0 8 * * *',
    // پیام مرور شبانه برای سرپرستان: وضعیت تیم + درخواست‌ها/اعتراض‌های منتظر پاسخ
    nightlyReview: process.env.CRON_NIGHTLY_REVIEW || '0 20 * * 6,0,1,2,3',
    // بستن خودکار رکوردهای بدون خروج ثبت‌شده در پایان روز (وضعیت «ناقص»)
    autoCloseIncomplete: process.env.CRON_AUTO_CLOSE_INCOMPLETE || '59 23 * * *',
    // علامت‌گذاری روزهای تعطیل رسمی/مرخصی تأییدشده، قبل از شروع پنجره ثبت ورود (رفع گپ «غایب» فاز ۵)
    markNonWorkingDays: process.env.CRON_MARK_NON_WORKING_DAYS || '5 0 * * *',
    // بک‌آپ روزانه‌ی دیتابیس؛ پیش‌فرض ۰۲:۳۰ بامداد (خارج از ساعت کاری و بعد از Jobهای شبانه)
    dailyBackup: process.env.CRON_DAILY_BACKUP || '30 2 * * *',
    // Job ماهانه‌ی آرشیو audit (S2-6b: فقط dry-run)؛ پیش‌فرض روز اول هر ماه میلادی ساعت ۰۳:۰۰ (بعد از بک‌آپ، خارج از ساعت کاری)
    auditArchive: process.env.CRON_AUDIT_ARCHIVE || '0 3 1 * *',
  },
};

module.exports = config;

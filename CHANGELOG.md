# CHANGELOG

وضعیت و جزئیات کامل فازها: [`PROJECT_STATUS.md`](PROJECT_STATUS.md) — معماری: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

## [1.0.0-rc.1] — بخش ۱ (پایه فنی)

### ۱-ب — تمیزکاری ساختار و مستندات
- **تقسیم routeهای پنل**: `admin.js` و `adminPanel.js` (همپوشان، با `requireAdminAuth` که دو بار ثبت می‌شد) به `src/api/routes/admin/` شکسته شدند: `common`، `dashboard`، `users`، `attendance`، `leave`، `disputes`، `reports`، `settings`، `audit`، `system` و `index`. URLها، متدها، پاسخ‌ها و ترتیب انتخاب route بدون تغییر؛ `scopedUserIds` که دو بار تعریف شده بود یک‌جا شد.
- **حذف مسیرهای قدیمی فاز ۱** (`/api/users*`، `/api/attendance/*`، `/api/audit-log`): هیچ مصرف‌کننده‌ای نداشتند (بات از repository و Mini App از `/api/miniapp/*` استفاده می‌کند و پنل از `/api/admin/*`). `/api/attendance/*` بدون احراز هویت `userId` را از body می‌خواند؛ `/api/audit-log` به‌خاطر نبودن `requireAdminAuth` برای همه (حتی ادمین) ۴۰۳ می‌داد؛ `/api/users*` تکرار ضعیف‌تر `/api/admin/users` بود. اکنون ۴۰۴ می‌دهند.
- **`networkRestriction`**: دیگر `userId` خام body/query را برای استثنای مأموریت نمی‌پذیرد (فقط `req.miniAppUser` امضاشده)؛ بدون هویت، رد + ثبت audit (fail-closed).
- رفع: بک‌آپ قبل از migration اگر شکست بخورد، فایل صفربایتی ناقص را باقی نمی‌گذارد.
- رفع تست ناپایدار `initData` (۱ از ۱۶ اجراها بی‌دلیل خراب می‌شد).
- تست‌های جدید: `test/routeOrder.test.js` (عدم پنهان‌شدن route، یک‌بار ثبت‌بودن `requireAdminAuth`)، ۴۰۴ بودن مسیرهای قدیمی، رفتار جدید `networkRestriction`.
- مستندات: بازنویسی کامل `README.md`، `docs/ARCHITECTURE.md`، اصلاح `PROJECT_STATUS.md`، نسخه و توضیح `package.json`.

### ۱-الف — migration و زیرساخت تست
- سیستم migration (`schema_migrations`، `001_baseline`، helper بازسازی جدول، بک‌آپ قبل از اجرا)، `npm run migrate[:status]`.
- زیرساخت تست با `node:test` (`npm test`)، تست احراز initData/Login Widget، سشن، `networkRestriction`، ماتریس دسترسی، و `npm run smoke`.

## [0.4.0] و قبل‌تر
فازهای ۱ تا ۹ (بک‌اند، بات، Mini App، پنل مدیریتی، HTTPS مستقیم، rate limiting، اسکریپت‌های NSSM/SSL). شرح در `PROJECT_STATUS.md`.

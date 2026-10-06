# CHANGELOG

وضعیت و جزئیات کامل فازها: [`PROJECT_STATUS.md`](PROJECT_STATUS.md) — معماری: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

## [Unreleased] — بخش ۲ (امنیت، پایداری و عملیات)

### ۲-الف — هدرهای امنیتی، کوکی، CSRF، ابطال نشست
- **هدرها**: `src/middleware/securityHeaders.js` — `nosniff`، `Referrer-Policy: strict-origin`، `Permissions-Policy`، HSTS (فقط روی TLS)، حذف `X-Powered-By`، `no-store` و CSP بسته برای `/api`. CSP برای پنل و Mini App با اجازه‌ی تلگرام (اسکریپت‌ها، iframe ویجت، `frame-ancestors`)؛ پیش‌فرض `report-only` (`CSP_MODE`) با `POST /api/csp-report`.
- **کوکی نشست**: `SameSite=Strict` (قبلاً Lax؛ `ADMIN_COOKIE_SAMESITE=lax` برای بازگشت)، `Secure` روی TLS/production، ساخت یک‌جا در `src/utils/sessionCookie.js`.
- **CSRF**: روی همه‌ی متدهای نوشتنی `/api/admin/*` — هدر `X-Requested-With: AttendancePanel` + بررسی `Origin`/`Referer`. فرانت پنل هدر را می‌فرستد. ⚠️ هر کلاینت دیگری که مستقیم به `/api/admin/*` می‌نویسد باید هدر را اضافه کند.
- **ابطال نشست**: migration `002_session_version`؛ `sv` (نسخه‌ی کاربر) و `ge` (epoch سراسری در `settings`) داخل توکن؛ افزایش خودکار با تغییر `is_active`/`role`/`telegram_user_id`؛ `POST /admin/users/:id/revoke-sessions` و `POST /admin/system/revoke-all-sessions` (ادمین کل، دلیل اجباری، audit) + دکمه‌های پنل. رفتار تغییرکرده: کاربر غیرفعال‌شده از طریق پنل/بات در درخواست بعدی `401` (قبلاً `403`) می‌گیرد؛ توکن‌های قبلی تا اولین ابطال معتبرند.
- `AP.boot()` درون‌خطی به `public-admin/js/boot.js` منتقل شد (سازگاری با CSP).
- مستندات: `docs/SECURITY.md`. تست‌ها: `test/security.test.js` (۳۷ تست جدید).

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

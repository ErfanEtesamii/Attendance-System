# معماری سیستم حضور و غیاب فرازهنر

این سند کوتاه است و فقط «تصویر کلی» و «تصمیمات ثابت» را نگه می‌دارد. جزئیات هر فاز در `PROJECT_STATUS.md` و تغییرات در `CHANGELOG.md` است.

## نمودار جریان

```
                        شبکه داخلی شرکت (192.168.10.0/24)
 ┌──────────────┐  HTTPS   ┌─────────────────────────────────────────────────────────┐
 │ Mini App     │─────────▶│  Node.js (یک پروسه، Windows Service با NSSM)            │
 │ (public/)    │ initData │                                                         │
 └──────────────┘          │  Express (src/server.js)                                │
 ┌──────────────┐  HTTPS   │   ├─ /api/miniapp/*   telegramAuth(initData) →          │
 │ پنل مدیریتی  │─────────▶│   │                   networkRestriction → rateLimiter  │
 │ (public-admin)│ کوکی    │   ├─ /api/admin/auth/* ورود (Login Widget / کد یک‌بارمصرف)│
 └──────────────┘ session  │   ├─ /api/admin/*     requireAdminAuth → routes/admin/* │
                           │   └─ /api/health                                        │
 ┌──────────────┐ polling  │                                                         │
 │ Telegram     │◀────────▶│  بات (src/bot) + زمان‌بند node-cron (src/bot/scheduler) │
 │ Bot API      │ (خروجی)  │                  │                                      │
 └──────────────┘          │                  ▼                                      │
                           │   repositories (تنها جایی که SQL می‌نویسد)              │
                           │                  ▼                                      │
                           │   SQLite (data/attendance.db) + migrationها             │
                           └─────────────────────────────────────────────────────────┘
```

- **یک پروسه**: `src/index.js` هم API (`src/server.js`) و هم بات را بالا می‌آورد. `npm run start:api-only` فقط API.
- **زمان‌بندها** (`src/bot/scheduler/`): یادآور تأخیر، یادآور خروج، علامت‌گذاری روز تعطیل/مرخصی، بستن رکوردهای ناقص، گزارش‌ها، مرور شبانه.
- **مانیتورینگ** (بخش ۲-ج۱): هر Job با `wrapJob` در `job_runs` ثبت می‌شود؛ `systemHealth.collect` تنها منبع سلامت است؛ watchdog هر ۵ دقیقه به ادمین‌ها در تلگرام هشدار می‌دهد؛ `/api/health` عمومی فقط ok/degraded و `/api/admin/system/status` جزئیات (فقط ادمین). [`docs/MONITORING.md`](MONITORING.md)
- **دیتابیس**: تغییر ساختار فقط با migration (`src/db/migrations/`)؛ قبل از اعمال، بک‌آپ سازگار با WAL گرفته می‌شود.

## ساختار routeهای پنل (`src/api/routes/admin/`)

| فایل | دامنه |
|---|---|
| `index.js` | `requireAdminAuth` را یک‌بار ثبت و بقیه را mount می‌کند |
| `common.js` | اسکوپ نقش‌ها (`scopedUserIds`، `visibleUsers`، `canAccessUser`) و ابزارهای مشترک |
| `dashboard.js` | `me`، `dashboard`، `overview`، `live`، `nightly-review` |
| `users.js` | کارمندان، خروجی، پرونده‌ی کامل، پیام |
| `attendance.js` | رکوردهای تردد و استراحت‌ها |
| `leave.js` | مرخصی/مأموریت |
| `disputes.js` | اعتراض‌ها |
| `reports.js` | خروجی CSV و گزارش تحلیلی |
| `settings.js` | تنظیمات و تعطیلات |
| `audit.js` | Audit Log |
| `system.js` | پیام گروهی، وضعیت سیستم، بک‌آپ |

ترتیب ثبت فقط وقتی مهم است که دو الگو یک URL را بپوشانند (مثل `/admin/users/export` قبل از `/admin/users/:id`)؛ `test/routeOrder.test.js` وجود هر نوع پنهان‌شدگی را رد می‌کند.

## تصمیمات ثابت (بدون دلیل قوی تغییر نکنند)

1. **سرور محلی ویندوز** (`192.168.10.2`، رنج `192.168.10.0/24`)، اجرا با NSSM. نه Docker، نه سرویس ابری.
2. **Node مستقیم HTTPS سرو می‌کند**؛ ریورس‌پراکسی نداریم و `TRUST_PROXY` باید `false` بماند (وگرنه هدر جعلی `X-Forwarded-For` چک شبکه را دور می‌زند).
3. **بات با polling** است، نه webhook؛ هیچ پورت ورودی باز نیست.
4. **ثبت تردد فقط از داخل شبکه** (`networkRestriction`) با استثنای مأموریت تأییدشده. هویت برای این استثنا **فقط** از `req.miniAppUser` (امضاشده) خوانده می‌شود، نه از `userId` خام body/query.
5. **دو الگوریتم احراز هویت تلگرام عمداً جدا هستند**: Mini App ← `initData` (`HMAC` با کلید `"WebAppData"`)؛ ورود پنل ← Login Widget (`secret = SHA256(botToken)`). هرگز جایگزین هم نشوند.
6. **هیچ SQL خامی بیرون از `src/repositories`** (و `src/db`) نوشته نشود.
7. **همه‌ی timestampهای تردد از ساعت سرور** می‌آید (`src/utils/serverTime.js`)، هرگز از کلاینت.
8. **سشن پنل**: کوکی امضاشده‌ی stateless. نقش `employee` به‌صورت پیش‌فرض بسته است (default-deny): فقط مسیرهای لیست سفید `EMPLOYEE_ALLOWED` در `src/middleware/adminAuth.js`.
9. **تنظیمات سیستم** در جدول `settings` (قابل تغییر از پنل بدون ری‌استارت)؛ `.env` فقط مقدار پیش‌فرض است.
10. **زبان**: رابط و پیام‌ها فارسی (RTL)، نام‌های کد انگلیسی، کامنت‌ها فارسی. تاریخ در دیتابیس میلادی (`YYYY-MM-DD`) و نمایش شمسی.

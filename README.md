# سیستم حضور و غیاب تلگرامی فرازهنر

ثبت ورود/خروج/استراحت کارکنان از طریق **بات تلگرام** و **Telegram Mini App**، با محاسبه‌ی ساعت مفید کاری، مرخصی/مأموریت، گزارش‌های دوره‌ای و یک **پنل مدیریتی وب**. ثبت تردد فقط از داخل شبکه‌ی شرکت ممکن است.

- معماری و تصمیمات ثابت: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- وضعیت فازها و کارهای باقی‌مانده: [`PROJECT_STATUS.md`](PROJECT_STATUS.md)
- تاریخچه‌ی تغییرات: [`CHANGELOG.md`](CHANGELOG.md)

## فناوری‌ها

Node.js (>=18) · Express 4 · SQLite (`better-sqlite3`) · `node-telegram-bot-api` (polling) · `node-cron` · `jalaali-js`.
SQLite یعنی بدون سرویس دیتابیس جدا؛ کل دیتابیس یک فایل است (`data/attendance.db`). اجرا روی سرور محلی ویندوز با NSSM.

## نصب و اجرا

```bash
npm install
copy .env.example .env      # ویندوز  (لینوکس/مک: cp .env.example .env) و مقادیر را پر کنید
npm run migrate             # ساخت/به‌روزرسانی دیتابیس (یا npm run init-db برای دیتابیس خالی)
npm run create-admin -- <telegram_id> "نام کامل"   # فقط یک‌بار: اولین ادمین
npm start                   # API + بات در یک پروسه
```

- فقط API بدون بات: `npm run start:api-only`
- توسعه با ری‌استارت خودکار: `npm run dev`
- بررسی سلامت: `GET /api/health` ← `{"status":"ok", ...}`

### ادمین اول
دیتابیس بدون کاربر شروع می‌شود. به بات پیام بدهید (`/start`)؛ آیدی عددی تلگرامتان را می‌گوید. بعد `npm run create-admin -- <آیدی> "نام"` و دوباره `/start`.

### متغیرهای محیطی
مرجع کامل در [`PROJECT_STATUS.md`](PROJECT_STATUS.md) (بخش ۷) و توضیح هر مقدار داخل `.env.example`. مهم‌ترین‌ها:

| متغیر | توضیح |
|---|---|
| `TELEGRAM_BOT_TOKEN` | توکن بات از BotFather |
| `TELEGRAM_BOT_USERNAME` | یوزرنیم بات بدون `@` (برای ورود پنل) |
| `ADMIN_SESSION_SECRET` | **الزامی در production**؛ رشته‌ی تصادفی طولانی (`openssl rand -hex 32`) |
| `MINI_APP_URL` | آدرس نهایی Mini App، مثلاً `https://attendance.farazhonar.com/` |
| `SSL_CERT_PATH` / `SSL_KEY_PATH` | گواهی HTTPS؛ خالی = HTTP ساده (فقط توسعه) |
| `ALLOWED_NETWORK_CIDR` | رنج شبکه‌ی مجاز ثبت تردد (پیش‌فرض `192.168.10.0/24`) |
| `TRUST_PROXY` | باید `false` بماند (پراکسی نداریم) |
| `DB_PATH` | مسیر فایل دیتابیس (پیش‌فرض `./data/attendance.db`) |
| `CSP_MODE` | `report-only` (پیش‌فرض) / `enforce` / `off` — سیاست CSP؛ [`docs/SECURITY.md`](docs/SECURITY.md) |
| `ADMIN_COOKIE_SAMESITE` | `strict` (پیش‌فرض) یا `lax` برای بازگشت اضطراری |
| `CSP_PANEL_UNSAFE_EVAL` / `HSTS_MAX_AGE_SECONDS` / `CSRF_EXTRA_ORIGINS` | تنظیمات پیشرفته‌ی امنیت وب (پیش‌فرض‌ها معمولاً کافی‌اند) |

> ⚠️ `.env`، پوشه‌ی `.ssl/` و فایل‌های `data/*.db` هرگز commit یا در zip تحویلی گذاشته نشوند. برای ساخت بسته‌ی تحویل از `npm run package` استفاده کنید (رازها را خودکار حذف می‌کند) و قبل از commit/ارسال `npm run secret-scan` بزنید. در production اگر `ADMIN_SESSION_SECRET` کمتر از ۳۲ نویسه یا نمونه باشد سرور بالا نمی‌آید. جزئیات و چک‌لیست «اگر راز لو رفت»: [`docs/SECRETS.md`](docs/SECRETS.md).

## دیتابیس و migration

تغییر ساختار دیتابیس **فقط** با migration انجام می‌شود (`src/db/migrations/`، فایل‌های شماره‌دار):

```bash
npm run migrate           # اعمال migrationهای باقی‌مانده (قبلش بک‌آپ می‌گیرد)
npm run migrate:status    # فقط نمایش وضعیت
```

- هر migration داخل یک transaction اجرا می‌شود و در صورت خطا کامل rollback می‌شود.
- قبل از اجرا، بک‌آپ سازگار با WAL در `data/backups/pre-migration-<زمان>.db` گرفته می‌شود (چند نسخه‌ی آخر نگه داشته می‌شود).
- سرور هنگام بالا آمدن migrationهای باقی‌مانده را خودکار اجرا می‌کند.
- روی سرور production بهتر است قبل از `npm run migrate` دستی، سرویس را stop کنید (`nssm stop <service>`).
- برای تغییر `CHECK` در SQLite، helper بازسازی جدول (`rebuildTable`) در `src/db/migrator.js` موجود است.

جدول‌ها: `users`، `attendance_records`، `break_records`، `leave_requests`، `holidays`، `record_disputes`، `settings`، `audit_log` (غیرقابل‌ویرایش) و `schema_migrations`.
همه‌ی زمان‌های تردد از **ساعت سرور** گرفته می‌شود، نه کلاینت.

## ساختار پوشه‌ها

```
src/
  index.js                 نقطه‌ی ورود: API + بات (همین با NSSM اجرا می‌شود)
  server.js                ساخت اپ Express + HTTPS/HTTP
  config.js                خواندن .env (در NODE_ENV=test خوانده نمی‌شود)
  db/                      connection، migrator، migrate.js، init.js، migrations/
  repositories/            تنها لایه‌ای که SQL می‌نویسد
  middleware/              adminAuth، telegramAuth، networkRestriction، rateLimiter، errorHandler
  api/routes/
    index.js               سوار کردن همه‌ی routeها زیر /api
    health.js  miniapp.js  adminAuth.js
    admin/                 پنل مدیریتی، تقسیم‌شده بر اساس دامنه (index/common/dashboard/users/
                           attendance/leave/disputes/reports/settings/audit/system)
  bot/                     بات، دستورها (commands/)، Jobهای cron (scheduler/)، notifier
  utils/                   workHours، jalali، csv، session، serverTime، telegramInitData، telegramLoginAuth ...
  scripts/                 createAdmin، seedEmployees، pushPanelButton
public/                    Mini App کارمند (بدون build)
public-admin/              پنل مدیریتی وب (بدون build)، زیر /admin/
scripts/                   install-service.ps1 (NSSM)، setup-ssl-renewal.ps1، run-tests.js، smoke-test.js،
                           package-release.js (zip بدون راز)، secret-scan.js، lib/ (zip، اسکنر، قوانین release)
test/                      تست‌های خودکار (node:test)
docs/                      ARCHITECTURE.md، SECURITY.md (هدرها/CSP/کوکی/CSRF/ابطال نشست)، SECRETS.md (مدیریت رازها)
```

## نقش‌ها

| نقش | دسترسی |
|---|---|
| `admin` | همه‌چیز؛ تنظیمات، Audit، اصلاح رکورد، پیام گروهی، بک‌آپ |
| `manager` («سرپرست») | فقط تیم خودش (`manager_id`)؛ مشاهده، تأیید مرخصی، رسیدگی به اعتراض، پیام به تیم |
| `employee` | فقط داده‌ی خودش و فقط مسیرهای لیست سفید `EMPLOYEE_ALLOWED` در `src/middleware/adminAuth.js`؛ هر مسیر جدید برای او پیش‌فرض بسته است (default-deny) |

اسکوپ نقش‌ها سمت سرور اعمال می‌شود (`src/api/routes/admin/common.js`)؛ پنهان‌کردن دکمه‌ها در UI امنیت نیست.

## احراز هویت (دو الگوریتم جدا — هرگز جایگزین هم نشوند)

| ورودی | الگوریتم | فایل |
|---|---|---|
| Mini App | `initData` — `HMAC_SHA256(key="WebAppData")` | `src/utils/telegramInitData.js` |
| ورود پنل | Login Widget — `secret = SHA256(botToken)` | `src/utils/telegramLoginAuth.js` |

پنل پس از ورود یک کوکی `HttpOnly` امضاشده (stateless) می‌گیرد (`src/utils/session.js`). ورود با کد یک‌بارمصرف از بات و لینک مستقیم دکمه‌ی پنل هم وجود دارد.

## محدودیت شبکه

`src/middleware/networkRestriction.js` روی `check-in`، `check-out` و `break/*` در Mini App اعمال می‌شود: IP مبدأ باید داخل `ALLOWED_NETWORK_CIDR` باشد، یا کاربر **مأموریت تأییدشده** برای همان روز داشته باشد. هویت کاربر برای این استثنا فقط از `req.miniAppUser` (امضاشده) خوانده می‌شود. هر رد و هر عبور با استثنا در `audit_log` ثبت می‌شود.

## فهرست routeها (`/api`)

| مسیر | توضیح |
|---|---|
| `GET /health` | سلامت سرویس (عمومی) |
| `GET /miniapp/me`، `/today`، `/history`، `/report` | داده‌ی کارمند (پشت `telegramAuth`) |
| `POST /miniapp/check-in`، `/check-out`، `/break/start`، `/break/end` | ثبت تردد (+ شبکه + rate limit) |
| `GET/POST /miniapp/leave`، `GET/POST /miniapp/dispute` | مرخصی/مأموریت و اعتراض |
| `POST /admin/auth/webapp`، `/token`، `/code`، `/telegram`، `/logout`؛ `GET /admin/public-config` | ورود/خروج پنل |
| `GET /admin/me`، `/dashboard`، `/overview`، `/live`، `/nightly-review` | نمای کلی |
| `GET/POST /admin/users`، `GET /admin/users/export`، `GET/PATCH/DELETE /admin/users/:id`، `GET /admin/users/:id/details`، `POST /admin/users/:id/message` | کارمندان |
| `GET /admin/attendance`، `/attendance/export`؛ `GET/POST/PATCH/DELETE /admin/attendance-records…`؛ `POST /admin/attendance-records/:id/breaks`؛ `PATCH/DELETE /admin/break-records/:id` | رکوردهای تردد و استراحت |
| `GET/POST/PATCH/DELETE /admin/leave-requests…` | مرخصی/مأموریت |
| `GET /admin/disputes`، `POST /admin/disputes/:id/(resolve\|reopen)` | اعتراض‌ها |
| `GET /admin/reports/summary`، `/reports/export` | گزارش (CSV) |
| `GET/POST/DELETE /admin/holidays`، `GET/PATCH /admin/settings` | تعطیلات و تنظیمات |
| `GET /admin/audit-log`، `/audit-log/export`، `/audit-actions` | Audit Log (فقط ادمین) |
| `POST /admin/broadcast`، `GET /admin/system`، `/system/backup` | سیستم (فقط ادمین) |

> مسیرهای قدیمی فاز ۱ (`/api/users*`، `/api/attendance/*`، `/api/audit-log`) در نسخه‌ی `1.0.0-rc.1` حذف شدند (بدون مصرف‌کننده و بدون احراز هویت درست). دلیل در `CHANGELOG.md`.

## بات تلگرام

Polling (بدون webhook و بدون پورت ورودی). دستورها: `/start`، `/status`، `/report`، `/leave`، `/help` برای همه؛ `/add_employee`، `/fix_record` فقط ادمین؛ `/list_employees`، `/team_report`، `/pending_leaves` برای سرپرست (تیم خودش) و ادمین؛ دکمه‌ی ورود به پنل. حالت گفتگوهای چندمرحله‌ای در حافظه است و با ری‌استارت پروسه از بین می‌رود.

Jobهای `node-cron` (`src/bot/scheduler/`): یادآور تأخیر و خروج، علامت‌گذاری تعطیل/مرخصی، بستن رکوردهای ناقص، گزارش روزانه/هفتگی/ماهانه (ماه شمسی)، مرور شبانه. عبارات `CRON_*` و ساعت‌ها در `.env` قابل تنظیم‌اند؛ **پیش‌فرض‌ها شنبه تا چهارشنبه را فرض می‌کنند — با روزهای کاری واقعی تطبیق دهید.**

## استقرار (ویندوز + NSSM)

1. `npm install --omit=dev` و پر کردن `.env` (`NODE_ENV=production`).
2. گواهی HTTPS با DNS-01: `scripts/setup-ssl-renewal.ps1` (نیمه‌دستی؛ توضیح داخل اسکریپت). مسیرها در `SSL_CERT_PATH`/`SSL_KEY_PATH`.
3. نصب سرویس: `scripts/install-service.ps1` (NSSM، شروع خودکار، چرخش لاگ، ری‌استارت در crash).
4. در BotFather: `/setdomain` برای دامنه‌ی پنل (لازم برای Login Widget).
5. هر ارتقا: `nssm stop` ← جایگزینی کد ← `npm install` ← `npm run migrate` ← `nssm start`.

> اسکریپت‌های PowerShell روی ویندوز واقعی با دسترسی Administrator باید یک‌بار امتحان شوند.

## تست

```bash
npm test             # همه‌ی تست‌ها (node:test، بدون وابستگی اضافه)
npm run test:watch   # اجرای مجدد با هر تغییر
npm run smoke        # سرور واقعی روی دیتابیس موقت + چند درخواست کلیدی
npm run secret-scan  # جست‌وجوی توکن/کلید/راز در پروژه (کد خروج ۱ = یافته)
npm run package      # zip تحویل بدون .env/.ssl/data/node_modules/.git → dist/
```

تست‌ها hermetic هستند: دیتابیس موقت، توکن و راز ساختگی، و `.env` واقعی خوانده نمی‌شود. پوشش فعلی: migration، `initData` و Login Widget، سشن، `networkRestriction`، ماتریس دسترسی نقش × route، ساختار ترتیب routeها، و (بخش ۲-الف) هدرها/CSP، کوکی، CSRF و ابطال نشست، و (بخش ۲-ب۱) کنترل رازهای راه‌اندازی، اسکنر رازها و بسته‌ساز release. تست‌های موتور محاسبه با بخش ۳ می‌آید.

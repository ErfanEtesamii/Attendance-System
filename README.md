# سیستم حضور و غیاب تلگرامی فرازهنر

ثبت ورود/خروج/استراحت کارکنان از طریق **بات تلگرام** و **Telegram Mini App**، با محاسبه‌ی ساعت مفید کاری، مرخصی/مأموریت، گزارش‌های دوره‌ای و یک **پنل مدیریتی وب**. ثبت تردد فقط از داخل شبکه‌ی شرکت ممکن است.

- معماری و تصمیمات ثابت: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- وضعیت فازها و کارهای باقی‌مانده: [`PROJECT_STATUS.md`](PROJECT_STATUS.md)
- تاریخچه‌ی تغییرات: [`CHANGELOG.md`](CHANGELOG.md)
- فاز ۱۰ (استراحت، ریست برنامه، ماموریت، برنامه‌ی هفتگی/گزارش روزانه، بات دکمه‌ای): تصمیم‌ها [`docs/PHASE10_DECISIONS.md`](docs/PHASE10_DECISIONS.md) و استقرار/تست دستی [`docs/PHASE10_DEPLOY.md`](docs/PHASE10_DEPLOY.md)
- فاز ۱۱ (گیت خروج بر اساس اولویت، قفل برنامه‌ی هفتگی با شروع هفته، UI کارت‌های روزانه، گفت‌وگوی دوطرفه روی اعتراض): تصمیم‌ها [`docs/PHASE11_DECISIONS.md`](docs/PHASE11_DECISIONS.md) و استقرار/تست دستی [`docs/PHASE11_DEPLOY.md`](docs/PHASE11_DEPLOY.md)
- فاز ۱۲ (شیفت با تاریخ اعمال و برنامه‌ی روزبه‌روز، استراحت با حقوق، سقف تأخیر و اجازه‌ی ورود، تسک فوری، نمای هفتگی کارمند، منوی «📂 منو»، ورودی ساعت قابل‌تایپ، تسک واجب سرپرست): تصمیم‌ها [`docs/PHASE12_DECISIONS.md`](docs/PHASE12_DECISIONS.md) و استقرار/تست دستی [`docs/PHASE12_DEPLOY.md`](docs/PHASE12_DEPLOY.md). ⚠️ H1 (ساعت دورکاری) هنوز پیاده‌سازی نشده است.
- فاز ۱۳ (برنامه‌ی هفته‌ی بعد کارمندان با ظاهر دفترچه در پنل ادمین/سرپرست: مشاهده، ویرایش درجا، جابه‌جایی با کیبورد/drag/لمس، همزمانی با `PLAN_CONFLICT`، اعلان تجمیعی به کارمند، ساعت کاری روز/تسک فوری/یادداشت سرپرست از همان صفحه): تصمیم‌ها [`docs/PHASE13_DECISIONS.md`](docs/PHASE13_DECISIONS.md) و استقرار/تست دستی [`docs/PHASE13_DEPLOY.md`](docs/PHASE13_DEPLOY.md).

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
| `MINI_APP_URL` | آدرس نهایی Mini App، مثلاً `https://attendance.farazhonar.com:3000/` |
| `SSL_CERT_PATH` / `SSL_KEY_PATH` | گواهی HTTPS؛ خالی = HTTP ساده (فقط توسعه) |
| `ALLOWED_NETWORK_CIDR` | رنج شبکه‌ی مجاز ثبت تردد (پیش‌فرض `192.168.10.0/24`) |
| `TRUST_PROXY` | باید `false` بماند (پراکسی نداریم) |
| `DB_PATH` | مسیر فایل دیتابیس (پیش‌فرض `./data/attendance.db`) |
| `CSP_MODE` | `report-only` (پیش‌فرض) / `enforce` / `off` — سیاست CSP؛ [`docs/SECURITY.md`](docs/SECURITY.md) |
| `ADMIN_COOKIE_SAMESITE` | `strict` (پیش‌فرض) یا `lax` برای بازگشت اضطراری |
| `RATE_LIMIT_STORE` | `sqlite` (پیش‌فرض: شمارنده‌ی ماندگار، با ری‌استارت صفر نمی‌شود) یا `memory`؛ [`docs/SECURITY.md`](docs/SECURITY.md) بخش ۷ |
| `WATCHDOG_ENABLED` / `CRON_WATCHDOG` / `ALERT_THROTTLE_MINUTES` / `MONITOR_*` | مانیتورینگ و هشدار تلگرامی به ادمین‌ها (دیسک، polling، Job، بک‌آپ)؛ [`docs/MONITORING.md`](docs/MONITORING.md) |
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
                           (فاز ۱۳ — C1) سیستم طراحی «دفترچه»: css/notebook.css + js/notebook.js (اسکوپ .nb)؛ صفحه‌ی نمایشی توسعه: /admin/nb-demo.html (داده‌ی ثابت، بدون API؛ در استقرار همراه بقیه‌ی public-admin می‌آید، مشکلی برای secret-scan ندارد و می‌توان حذفش کرد)
scripts/                   install-service.ps1 (NSSM)، setup-ssl-renewal.ps1، run-tests.js، smoke-test.js،
                           package-release.js (zip بدون راز)، secret-scan.js، lib/ (zip، اسکنر، قوانین release)
test/                      تست‌های خودکار (node:test)
docs/                      ARCHITECTURE.md، PHASE10_DECISIONS.md، PHASE10_DEPLOY.md، PHASE11_DECISIONS.md، PHASE11_DEPLOY.md، PHASE12_DECISIONS.md، PHASE12_DEPLOY.md، UI_STATES.md، SECURITY.md (هدرها/CSP/کوکی/CSRF/ابطال نشست)، SECRETS.md (مدیریت رازها)
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
| `GET /health` | سلامت سرویس (عمومی): فقط `status` (`ok`/`degraded`) و `time` |
| `GET /miniapp/me`، `/today`، `/history`، `/report` | داده‌ی کارمند (پشت `telegramAuth`) |
| `POST /miniapp/check-in`، `/check-out`، `/break/start`، `/break/end` | ثبت تردد (+ شبکه + rate limit)؛ ورودِ دیر با سقف تأخیر در حالت `enforce` ⇒ ۴۰۹ `LATE_LIMIT_REACHED` |
| `GET/POST /miniapp/checkin-permission`، `GET /miniapp/schedule/upcoming` | وضعیت گیت تأخیر و درخواست «اجازه‌ی ورود»؛ ساعت کاری مؤثر امروز و روزهای بعد |
| `GET/POST /miniapp/leave` | مرخصی/مأموریت |
| `GET/POST /miniapp/dispute`، `GET /miniapp/dispute/:id`، `POST /miniapp/dispute/:id/(messages\|reopen\|close)` | اعتراض کارمند و گفت‌وگو روی آن (پیام، ادامه تا سقف `disputeMaxReopens`، خاتمه) |
| `POST /miniapp/mission`، `/mission/now`، `/mission/now/end`، `/missions/:id/cancel`؛ `GET /miniapp/missions`، `/mission/day` | ماموریت (ثبت، «همین حالا»، لغو، فهرست) |
| `GET/PUT /miniapp/plan`، `POST /miniapp/plan/submit`، `GET /miniapp/plan-gate` | برنامه‌ی هفتگی و وضعیت گیت خروج (هفته‌ی شروع‌شده ⇒ `editMode=readonly`، نوشتن ⇒ ۴۰۹ `PLAN_LOCKED`) |
| `GET /miniapp/daily-tasks`، `POST /miniapp/daily-report`، `GET /miniapp/report-backfill` | گزارش روزانه‌ی تسک‌ها (تسک low اختیاری است: `optional:true`، مانع خروج نیست) |
| `GET /miniapp/team-review`، `POST /miniapp/report-reviews` | مشاهده‌ی گزارش تیم (سرپرست) |
| `POST /admin/auth/webapp`، `/token`، `/code`، `/telegram`، `/logout`؛ `GET /admin/public-config` | ورود/خروج پنل |
| `GET /admin/me`، `/dashboard`، `/overview`، `/live`، `/nightly-review` | نمای کلی |
| `GET/POST /admin/users`، `GET /admin/users/export`، `GET/PATCH/DELETE /admin/users/:id`، `GET /admin/users/:id/details`، `POST /admin/users/:id/message` | کارمندان |
| `GET /admin/attendance`، `/attendance/export`؛ `GET/POST/PATCH/DELETE /admin/attendance-records…`؛ `POST /admin/attendance-records/:id/breaks`؛ `PATCH/DELETE /admin/break-records/:id` | رکوردهای تردد و استراحت |
| `GET/POST/PATCH/DELETE /admin/leave-requests…` | مرخصی/مأموریت |
| `GET /admin/leave-queue`، `POST /admin/leave-queue/bulk` | صف تأیید (فیلتر، مانده، تأیید/رد دسته‌جمعی) |
| `GET /admin/disputes`، `/disputes/counts`، `/disputes/:id`؛ `POST /admin/disputes/:id/messages`، `/disputes/:id/(resolve\|reopen)` | اعتراض‌ها و thread گفت‌وگو (پاسخ/حل/بازکردن با `disputes.resolve`) |
| `GET /admin/reports/summary`، `/reports/export` | گزارش (CSV) |
| `GET/POST/DELETE /admin/holidays`، `GET/PATCH /admin/settings` | تعطیلات و تنظیمات |
| `GET /admin/audit-log`، `/audit-log/export`، `/audit-actions` | Audit Log (فقط ادمین) |
| `POST /admin/broadcast`، `GET /admin/system`، `/system/status`، `/system/backup` | سیستم و وضعیت/مانیتورینگ (فقط ادمین) |
| `GET /admin/system/reset/options`، `POST /admin/system/reset/preview`، `POST /admin/system/reset` | ریست برنامه (فقط ادمین؛ تأیید دوگانه، بک‌آپ، rate limit؛ قفل Go-Live) |
| `GET /admin/team-review`، `/team-reports`، `/team-reports/export`، `/task-kpis`؛ `POST /admin/report-reviews`، `/plan-gate/exemptions` | گزارش‌های تیم، شاخص‌های تسک، مشاهده‌ی گزارش و معافیت یک‌باره‌ی گیت برنامه |
| `GET /admin/users/:id/schedule`؛ `PUT/DELETE /admin/users/:id/schedule/:date`؛ `POST /admin/schedule/bulk` | برنامه‌ی کاری روزبه‌روز (override؛ `schedule.read`/`schedule.manage`؛ ماه بسته ⇒ ۴۰۹؛ گروهی تا ۳۱ روز و ۵۰ نفر) |
| `GET/POST /admin/shifts…`، `PUT /admin/users/:id/shift`، `POST /admin/shifts/assign` | شیفت‌ها و انتساب (فردی/گروهی) با «تاریخ اعمال» |
| `GET /admin/checkin-permissions`، `POST /admin/checkin-permissions/:id/decide` | صف «اجازه‌ی ورود» و تأیید/رد (سرپرست مستقیم یا ادمین؛ HR فقط‌خواندنی) |
| `POST /admin/users/:id/urgent-tasks`، `GET /admin/urgent-tasks`، `DELETE /admin/urgent-tasks/:taskId` | تسک فوری (`tasks.assign_urgent`؛ ادمین همه، سرپرست زیردست مستقیم) |
| `GET /admin/users/:id/week?start=` | نمای هفتگی کامل کارمند با خلاصه‌ی عملکرد (`team.week_view`؛ فقط‌خواندنی) |

> مسیرهای قدیمی فاز ۱ (`/api/users*`، `/api/attendance/*`، `/api/audit-log`) در نسخه‌ی `1.0.0-rc.1` حذف شدند (بدون مصرف‌کننده و بدون احراز هویت درست). دلیل در `CHANGELOG.md`.

## بات تلگرام

Polling (بدون webhook و بدون پورت ورودی). همه‌ی کارها از دکمه‌ی **«📂 منو»** انجام می‌شود که تنها دکمه‌ی کیبورد پایین چت است؛ با لمس آن پیام منوی inline نقش‌محور (۲ ستونه، گروه‌بندی «کارهای من / تیم / مدیریت»، با «✖️ بستن منو») باز می‌شود و بعد از انتخاب پاک می‌شود. «🕒 ثبت تردد»، «📋 برنامه هفتگی» و «⚙️ پنل مدیریت» دکمه‌ی inline از نوع `web_app` (فقط https) هستند. کاربری که هنوز کیبورد قدیمی ۱۵ دکمه‌ای را دارد با اولین لمس یکی از دکمه‌هایش کیبورد جدید را می‌گیرد؛ برای جایگزینی یک‌جا می‌توان `node src/scripts/pushPanelButton.js --apply` را اجرا کرد (منوی «/» تلگرام عمداً خالی است؛ فقط `/start` برای شروع کار می‌کند). گزینه‌های منو — کارمند: «🕒 ثبت تردد»، «📊 وضعیت من»، «📈 گزارش من»، «🏖 مرخصی / 🚗 ماموریت»، «📋 برنامه هفتگی»، «🖥 پنل»، «❓ راهنما»؛ سرپرست: + «👥 گزارش تیم»، «📥 درخواست‌های منتظر»، «💬 اعتراض‌ها»، «📝 گزارش‌های دیروز تیم»، «👤 لیست اعضا»؛ ادمین: + «➕ افزودن کارمند»، «🛠 اصلاح رکورد»، «⚙️ پنل مدیریت». نقش هر بار سمت سرور از دیتابیس چک می‌شود. در جریان‌های چندمرحله‌ای تاریخ با تقویم شمسی inline، ساعت با اسلات ۳۰ دقیقه‌ای و کارمند/سرپرست با فهرست دکمه‌ای انتخاب می‌شود (تایپ `YYYY-MM-DD` / `HH:MM` هم پذیرفته است)؛ زیر هر مرحله «❌ انصراف | 🏠 منوی اصلی» هست و دکمه‌ی پیام قدیمی/منقضی «این دکمه منقضی شده، منو را باز کنید.» می‌دهد. فقط متن آزاد (نام، توضیح، دلیل) تایپ می‌ماند. حالت گفتگوهای چندمرحله‌ای در حافظه است و با ری‌استارت پروسه از بین می‌رود.

Jobهای `node-cron` (`src/bot/scheduler/`): یادآور تأخیر و خروج، علامت‌گذاری تعطیل/مرخصی، بستن رکوردهای ناقص، گزارش روزانه/هفتگی/ماهانه (ماه شمسی)، مرور شبانه، یادآوری مهلت تسک فوری (هر ۱۰ دقیقه، `CRON_URGENT_TASK_REMINDER`)، ساخت خودکار تسک واجب «بررسی گزارش روز قبل» برای سرپرست‌ها (هر روز ۰۰:۱۰، `CRON_TEAM_REVIEW_ENSURE`)، و **watchdog** (هشدار تلگرامی به ادمین‌ها؛ [`docs/MONITORING.md`](docs/MONITORING.md)). هر اجرای Job در جدول `job_runs` ثبت می‌شود و در پنل (ادمین ← «وضعیت سیستم») دیده می‌شود. عبارات `CRON_*` و ساعت‌ها در `.env` قابل تنظیم‌اند؛ **پیش‌فرض‌ها شنبه تا چهارشنبه را فرض می‌کنند — با روزهای کاری واقعی تطبیق دهید.**

## استقرار (ویندوز + NSSM)

1. `npm install --omit=dev` و پر کردن `.env` (`NODE_ENV=production`).
2. گواهی HTTPS با DNS-01: `scripts/setup-ssl-renewal.ps1` (نیمه‌دستی؛ توضیح داخل اسکریپت). مسیرها در `SSL_CERT_PATH`/`SSL_KEY_PATH`.
3. نصب سرویس: `scripts/install-service.ps1` (NSSM، شروع خودکار، چرخش لاگ، ری‌استارت در crash).
4. در BotFather: `/setdomain` برای دامنه‌ی پنل (لازم برای Login Widget).
5. هر ارتقا: `nssm stop` ← جایگزینی کد ← `npm install` ← `npm run migrate` ← `nssm start`.

ارتقا به فاز ۱۳ (migration ۰۳۳ تا ۰۳۵، فقط افزایشی؛ `.env` و وابستگی npm بدون تغییر): دستورها و چک‌لیست تست دستی در [`docs/PHASE13_DEPLOY.md`](docs/PHASE13_DEPLOY.md).

ارتقا به فاز ۱۲ (migration ۰۲۸ تا ۰۳۲، فقط افزایشی؛ `.env` تغییر اجباری ندارد؛ تنظیم‌های تازه‌ی استراحت با حقوق و سقف تأخیر به‌صورت پیش‌فرض خاموش‌اند): دستورها، فعال‌سازی تدریجی و چک‌لیست تست دستی در [`docs/PHASE12_DEPLOY.md`](docs/PHASE12_DEPLOY.md).

ارتقا به فاز ۱۱ (فقط migration ۰۲۷، افزایشی؛ بدون متغیر `.env` جدید؛ تنظیم تازه‌ی `disputeMaxReopens`): دستورها و چک‌لیست تست دستی در [`docs/PHASE11_DEPLOY.md`](docs/PHASE11_DEPLOY.md).

ارتقا به فاز ۱۰ (migration ۰۲۳ تا ۰۲۶، فقط افزایشی): دستورها و چک‌لیست تست دستی در [`docs/PHASE10_DEPLOY.md`](docs/PHASE10_DEPLOY.md). گیت‌های برنامه‌ی هفتگی و گزارش روزانه و قفل Go-Live پیش‌فرض **خاموش**اند؛ فعال‌سازی تدریجی توصیه می‌شود. متغیرهای جدید `.env`: `CRON_MORNING_DIGEST`، `ALLOW_DATA_RESET`.

> اسکریپت‌های PowerShell روی ویندوز واقعی با دسترسی Administrator باید یک‌بار امتحان شوند.

## تست

```bash
npm test             # همه‌ی تست‌ها (node:test، بدون وابستگی اضافه)
npm run test:watch   # اجرای مجدد با هر تغییر
npm run smoke        # سرور واقعی روی دیتابیس موقت + چند درخواست کلیدی
npm run secret-scan  # جست‌وجوی توکن/کلید/راز در پروژه (کد خروج ۱ = یافته)
npm run package      # zip تحویل بدون .env/.ssl/data/node_modules/.git → dist/
```

تست‌ها hermetic هستند: دیتابیس موقت، توکن و راز ساختگی، و `.env` واقعی خوانده نمی‌شود. پوشش فعلی: migration، `initData` و Login Widget، سشن، `networkRestriction`، ماتریس دسترسی نقش × route، ساختار ترتیب routeها، و (بخش ۲-الف) هدرها/CSP، کوکی، CSRF و ابطال نشست، و (بخش ۲-ب۱) کنترل رازهای راه‌اندازی، اسکنر رازها و بسته‌ساز release، و (بخش ۲-ج۱) ثبت اجرای Jobها، نبض polling، سلامت سیستم، watchdog با بات ماک‌شده و `/api/health` + `/api/admin/system/status`. تست‌های موتور محاسبه با بخش ۳ می‌آید. فاز ۱۰: استراحت، ریست برنامه (rollback، قفل Go-Live، rate limit)، ماموریت (اعتبارسنجی، اثر روی ساعت کاری، تأیید شبانه، ورود با ماموریت pending)، برنامه‌ی هفتگی و گیت‌های خروج، گزارش روزانه/تشویقی، گزارش تیم، منوی نقش‌محور بات و انتخابگرهای دکمه‌ای. فاز ۱۱: گیت خروج بر اساس اولویت، قفل برنامه‌ی هفتگی (`PLAN_LOCKED`)، UI برنامه‌ی هفتگی، گفت‌وگوی اعتراض (migration ۰۲۷، API کارمند/ادمین، اعلان‌ها، بستن ماه، UI) و سناریوی یکپارچه‌ی اعتراض. فاز ۱۲: پاسخ ادمین از بات در thread اعتراض (`disputeBotReply`)، شیفت با تاریخ اعمال (`shiftEffectiveFrom`، `shifts`)، برنامه‌ی روزبه‌روز (`userSchedule`)، استراحت با حقوق (`paidBreaks`، `computeDay`)، سقف تأخیر و اجازه‌ی ورود (`lateLimit`، `lateLimitGate`، `checkinPermissionNotify`)، تسک فوری (`urgentTaskBot` و تست‌های مرتبط)، نمای هفتگی کارمند (`employeeWeek`)، منوی «📂 منو» (`botMenu`)، ورودی ساعت قابل‌تایپ (`timeInput`، `botTimeInput`) و تسک واجب سرپرست «بررسی گزارش روز قبل» (`teamReviewH5`: ساخت خودکار و Job، پیشرفت «x از y مشاهده شد»، F1، رد ویرایش/حذف، ماه بسته، `morningDigest`). تست‌های فاز ۱۲ هنگام نگارش مستندات G1 اجرا نشده‌اند؛ پیش از استقرار `npm test` را اجرا کنید.

# سیستم حضور و غیاب تلگرامی فرازهنر

ثبت ورود/خروج/استراحت کارکنان از طریق **بات تلگرام** و **Telegram Mini App**، با محاسبه‌ی ساعت مفید کاری، مرخصی/مأموریت/دورکاری، برنامه‌ی هفتگی و گزارش روزانه‌ی تسک‌ها، گزارش‌های دوره‌ای و یک **پنل مدیریتی وب**. ثبت تردد حضوری فقط از داخل شبکه‌ی شرکت ممکن است (خارج از شبکه فقط با مأموریت تأییدشده یا دورکاری تأییدشده).

## فهرست

- [مستندات](#مستندات)
- [قابلیت‌ها](#قابلیتها)
- [فناوری‌ها](#فناوریها)
- [نصب و اجرا](#نصب-و-اجرا)
- [متغیرهای محیطی](#متغیرهای-محیطی)
- [دیتابیس و migration](#دیتابیس-و-migration)
- [ساختار پوشه‌ها](#ساختار-پوشهها)
- [نقش‌ها و دسترسی](#نقشها-و-دسترسی)
- [احراز هویت](#احراز-هویت)
- [محدودیت شبکه و دورکاری](#محدودیت-شبکه-و-دورکاری)
- [مسیرهای API](#مسیرهای-api)
- [بات تلگرام و Jobها](#بات-تلگرام-و-jobها)
- [امنیت و پایش](#امنیت-و-پایش)
- [استقرار (ویندوز + NSSM)](#استقرار-ویندوز--nssm)
- [بک‌آپ و بازیابی](#بکآپ-و-بازیابی)
- [تست](#تست)
- [وضعیت فعلی و کارهای باز](#وضعیت-فعلی-و-کارهای-باز)

## مستندات

| فایل | محتوا |
|---|---|
| [`docs/DOCUMENTATION.md`](docs/DOCUMENTATION.md) | **مستند فنی یکپارچه**: معماری، امنیت/رازها/مانیتورینگ/موارد مشکوک، حالت‌های UI، تصمیم‌ها و چک‌لیست استقرار/تست دستی هر فاز (۱۰ تا ۱۹)، تصمیم PDF، تست دستی ویزارد گزارش روزانه. در ابتدای فایل فهرست قابل‌کلیک دارد. |
| [`PROJECT_STATUS.md`](PROJECT_STATUS.md) | وضعیت فازها، نقشه‌ی فایل‌ها، کارهای باقی‌مانده و مرجع کامل `.env` |
| [`CHANGELOG.md`](CHANGELOG.md) | تاریخچه‌ی تغییرات |
| [`BACKUP_RESTORE.md`](BACKUP_RESTORE.md) | بک‌آپ و بازیابی دیتابیس |
| [`.env.example`](.env.example) | نمونه‌ی تنظیمات با توضیح هر مقدار |

> پوشه‌ی `docs/` قبلاً چند ده فایل جدا (`PHASE*_DECISIONS.md`، `PHASE*_DEPLOY.md`، `SECURITY.md`، …) داشت؛ همه در `docs/DOCUMENTATION.md` ادغام شده‌اند. ارجاع به نام فایل‌های قدیمی (مثلاً در `CHANGELOG.md`) را در همان فایل ادغامی، کنار عنوان هر بخش، می‌توانید پیدا کنید.

## قابلیت‌ها

**تردد و ساعت کاری**
- ورود، خروج، استراحت و **ورود مجدد** در همان روز (چند نوبت حضور، سقف `maxReEntriesPerDay`، جمع نوبت‌ها در موتور محاسبه و گزارش‌ها)
- قانون ناهار: کسر خودکار `fixedLunchDeductMinutes=45` برای حضور حداقل `fixedLunchMinPresenceMinutes=240`؛ در صورت ثبت ناهار فقط مدت واقعی
- استراحت با حقوق: استخر روزانه‌ی مشترک (`paidBreakCount=3`، `paidBreakMinutes=45`)؛ مازاد بدون حقوق
- شیفت با «تاریخ اعمال»، شیفت چرخشی و برنامه‌ی کاری روزبه‌روز (override) برای هر کارمند
- سقف تأخیر و «اجازه‌ی ورود» (درخواست کارمند، تأیید سرپرست/ادمین)
- موتور محاسبه‌ی ساعت مفید، اضافه‌کاری با تأیید، علامت‌گذاری تعطیل/مرخصی، بستن خودکار رکوردهای ناقص

**مرخصی، مأموریت، دورکاری**
- انواع مرخصی با مانده، زنجیره‌ی تأیید (سرپرست ← منابع انسانی)، جانشین، پیوست و صف تأیید دسته‌جمعی
- مأموریت (ثبت، «همین حالا»، لغو، تأیید شبانه) که استثنای شبکه را می‌دهد
- **دورکاری خارج از شبکه** (فاز ۱۴): نشست و استراحت جدا، تأیید سرپرست، شمارش جدا در گزارش‌ها (تنظیم `remoteWorkEnabled`)

**برنامه‌ی هفتگی و تسک‌ها**
- برنامه‌ی هفته‌ی بعد توسط کارمند، با گیت خروج بر اساس اولویت و قفل پس از شروع هفته (`PLAN_LOCKED`)
- گزارش روزانه‌ی تسک‌ها (انجام شد / ناقص / انجام نشد، توضیح، انتقال تسک و واگرد)، صفحه‌ی «امروزِ من» و تخته‌ی هفته
- تسک فوری (توسط سرپرست/ادمین یا شخصی) با یادآوری مهلت؛ تسک واجب «بررسی گزارش روز قبل» برای سرپرستان
- ویرایش برنامه‌ی هفته‌ی بعد کارمندان توسط ادمین/سرپرست با ظاهر «دفترچه»، با کنترل همزمانی (`PLAN_CONFLICT`)
- گزارش شبانه‌ی تسک‌ها برای سرپرست/ادمین و شاخص‌های تسک (KPI)

**گزارش، تحلیل و کنترل**
- گزارش‌های روزانه/هفتگی/ماهانه (تقویم شمسی)، خروجی CSV (و `.xlsx` در صورت نصب `exceljs`)، نمای چاپ
- تحلیل‌ها: روند و مقایسه‌ی تأخیر، رتبه‌بندی، نرخ حضور، توزیع ورود، الگوها؛ تقویم؛ مانده‌ی مرخصی
- بستن ماه (چک‌لیست، تعدیل، بازگشایی)، موارد مشکوک (ضدتقلب: IP یکسان، تغییر دستگاه)، Audit Log غیرقابل‌ویرایش با آرشیو
- اعتراض به رکورد با گفت‌وگوی دوطرفه (پیام، بازگشایی تا `disputeMaxReopens`، خاتمه)

**رابط‌ها**
- **Mini App کارمند** (`public/`): پالت سرمه‌ای/نارنجی، حلقه‌ی پیشرفت «امروز»، گرید شمسی تاریخچه، نمودارهای SVG، یکپارچگی با Telegram WebApp (BackButton، Haptic، safe-area، تم تلگرام)
- **پنل مدیریتی** (`public-admin/`): داشبورد، «وضعیت من» برای هر چهار نقش، صفحه‌ی تنظیمات گروه‌بندی‌شده، جدول‌های واکنش‌گرا، bottom-sheet، پالت فرمان (`Ctrl/Cmd+K`)، نمودارهای دسترس‌پذیر، تم روشن/تیره
- **بات تلگرام**: منوی نقش‌محور «📂 منو» (تنها دکمه‌ی کیبورد)

**مدیریت و عملیات**
- ریست برنامه (تأیید دوگانه، بک‌آپ، قفل Go-Live)، پیام گروهی، بک‌آپ روزانه، آرشیو Audit، نگهداری دیتابیس
- watchdog با هشدار تلگرامی به ادمین‌ها (دیسک، polling، Job، بک‌آپ) و ثبت اجرای Jobها

## فناوری‌ها

Node.js (>=18) · Express 4 · SQLite (`better-sqlite3`) · `node-telegram-bot-api` (polling) · `node-cron` · `jalaali-js` · `exceljs` (اختیاری، برای `.xlsx`).
فرانت‌اند (Mini App و پنل) بدون build و با JavaScript ساده است.
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

### اسکریپت‌های npm

| دستور | کار |
|---|---|
| `npm start` / `npm run dev` / `npm run start:api-only` | اجرا (عادی / با watch / فقط API) |
| `npm run init-db` / `npm run migrate` / `npm run migrate:status` | دیتابیس |
| `npm run create-admin -- <id> "نام"` | ساخت اولین ادمین |
| `npm test` / `npm run test:watch` | تست‌ها |
| `npm run smoke` | تست دودی روی سرور واقعی و دیتابیس موقت |
| `npm run bench:analytics` | بنچمارک تحلیل‌ها |
| `npm run secret-scan` | جست‌وجوی راز در پروژه (کد خروج ۱ = یافته) |
| `npm run package` | ساخت zip تحویل بدون راز در `dist/` |

اسکریپت‌های کمکی دیگر: `src/scripts/seedEmployees.js`، `src/scripts/pushPanelButton.js` (جایگزینی کیبورد قدیمی بات؛ `--apply`)، `scripts/restore-backup.js`، `scripts/install-fonts.js`.

## متغیرهای محیطی

مرجع کامل در [`PROJECT_STATUS.md`](PROJECT_STATUS.md) (بخش ۷) و توضیح هر مقدار داخل `.env.example`. مهم‌ترین‌ها:

| متغیر | توضیح |
|---|---|
| `TELEGRAM_BOT_TOKEN` | توکن بات از BotFather |
| `TELEGRAM_BOT_USERNAME` | یوزرنیم بات بدون `@` (برای ورود پنل) |
| `ADMIN_SESSION_SECRET` | **الزامی در production**؛ رشته‌ی تصادفی طولانی (`openssl rand -hex 32`) |
| `ADMIN_SESSION_MAX_AGE_DAYS` | مدت اعتبار نشست پنل |
| `MINI_APP_URL` | آدرس نهایی Mini App، مثلاً `https://attendance.farazhonar.com/` |
| `PORT` / `NODE_ENV` | پورت و حالت اجرا (`production` برای استقرار) |
| `SSL_CERT_PATH` / `SSL_KEY_PATH` | گواهی HTTPS؛ خالی = HTTP ساده (فقط توسعه) |
| `ALLOWED_NETWORK_CIDR` | رنج شبکه‌ی مجاز ثبت تردد (پیش‌فرض `192.168.10.0/24`) |
| `TRUST_PROXY` | باید `false` بماند (پراکسی نداریم) |
| `DB_PATH` | مسیر فایل دیتابیس (پیش‌فرض `./data/attendance.db`) |
| `TIMEZONE`، `WORK_DAY_START`، `WORK_DAY_END` | منطقه‌ی زمانی و ساعت کاری پیش‌فرض |
| `LATE_CHECKIN_GRACE_MINUTES`، `CHECKOUT_REMINDER_MINUTES_BEFORE`، `REPEATED_LATENESS_THRESHOLD` | آستانه‌های تأخیر و یادآوری |
| `CRON_*` | زمان‌بندی Jobها (گزارش‌ها، یادآورها، مرور شبانه، بک‌آپ، آرشیو، watchdog، …) |
| `ALLOW_DATA_RESET` | اجازه‌ی ریست برنامه (در production عمداً خاموش نگه دارید) |
| `CSP_MODE` | `report-only` (پیش‌فرض) / `enforce` / `off` |
| `ADMIN_COOKIE_SAMESITE` | `strict` (پیش‌فرض) یا `lax` برای بازگشت اضطراری |
| `RATE_LIMIT_STORE` | `sqlite` (پیش‌فرض، ماندگار) یا `memory` |
| `WATCHDOG_ENABLED` / `ALERT_THROTTLE_MINUTES` / `MONITOR_*` | مانیتورینگ و هشدار تلگرامی |
| `CRON_DAILY_BACKUP` / `BACKUP_KEEP_DAILY` / `BACKUP_KEEP_MONTHLY` | بک‌آپ خودکار و نگهداری |
| `FRAUD_*` | آستانه‌های تشخیص موارد مشکوک |
| `CSP_PANEL_UNSAFE_EVAL` / `HSTS_MAX_AGE_SECONDS` / `CSRF_EXTRA_ORIGINS` | تنظیمات پیشرفته‌ی امنیت وب |

> ⚠️ `.env`، پوشه‌ی `.ssl/` و فایل‌های `data/*.db` هرگز commit یا در zip تحویلی گذاشته نشوند. برای ساخت بسته‌ی تحویل از `npm run package` استفاده کنید (رازها را خودکار حذف می‌کند) و قبل از commit/ارسال `npm run secret-scan` بزنید. در production اگر `ADMIN_SESSION_SECRET` کمتر از ۳۲ نویسه یا نمونه باشد سرور بالا نمی‌آید. چک‌لیست «اگر راز لو رفت»: بخش «مدیریت رازها» در [`docs/DOCUMENTATION.md`](docs/DOCUMENTATION.md).

بیشتر قوانین کسب‌وکار (ناهار، استراحت، سقف تأخیر، دورکاری، گیت‌های برنامه/گزارش، …) در جدول `settings` هستند و از صفحه‌ی «تنظیمات» پنل (یا `GET/PATCH /api/admin/settings`) تغییر می‌کنند، نه از `.env`.

## دیتابیس و migration

تغییر ساختار دیتابیس **فقط** با migration انجام می‌شود (`src/db/migrations/`، فایل‌های شماره‌دار؛ فعلاً `001` تا `042`):

```bash
npm run migrate           # اعمال migrationهای باقی‌مانده (قبلش بک‌آپ می‌گیرد)
npm run migrate:status    # فقط نمایش وضعیت
```

- هر migration داخل یک transaction اجرا می‌شود و در صورت خطا کامل rollback می‌شود.
- قبل از اجرا، بک‌آپ سازگار با WAL در `data/backups/pre-migration-<زمان>.db` گرفته می‌شود (چند نسخه‌ی آخر نگه داشته می‌شود).
- سرور هنگام بالا آمدن migrationهای باقی‌مانده را خودکار اجرا می‌کند.
- روی production بهتر است قبل از `npm run migrate` دستی، سرویس را stop کنید (`nssm stop <service>`).
- برای تغییر `CHECK` در SQLite، helper بازسازی جدول (`rebuildTable`) در `src/db/migrator.js` موجود است.

گروه‌های اصلی جدول‌ها: کاربران و نقش‌ها (`users`)، تردد (`attendance_records`، `attendance_segments`، `break_records`)، مرخصی (`leave_requests`، `leave_types`، `leave_balances`، تأییدها و پیوست‌ها)، تعطیلات و بستن ماه، اعتراض‌ها (`record_disputes` و پیام‌ها)، شیفت و برنامه‌ی روزبه‌روز، برنامه‌ی هفتگی و تسک‌ها (`weekly_plans`، تسک فوری، لاگ تسک)، دورکاری (نشست و استراحت)، اجازه‌ی ورود، اعلان‌ها، موارد مشکوک، `settings`، `rate_limits`، `job_runs`، `audit_log` (غیرقابل‌ویرایش) و `schema_migrations`.
همه‌ی زمان‌های تردد از **ساعت سرور** گرفته می‌شود، نه کلاینت.

## ساختار پوشه‌ها

```
src/
  index.js                 نقطه‌ی ورود: API + بات (همین با NSSM اجرا می‌شود)
  server.js                ساخت اپ Express + HTTPS/HTTP
  config.js                خواندن .env (در NODE_ENV=test خوانده نمی‌شود)
  db/                      connection، migrator، migrate.js، init.js، migrations/
  repositories/            تنها لایه‌ای که SQL می‌نویسد
  services/                منطق کسب‌وکار (مرخصی، مأموریت، دورکاری، برنامه‌ی هفتگی، تسک‌ها، گزارش‌ها،
                           تحلیل، بستن ماه، ریست، اعلان‌ها، …)
  engine/                  موتور محاسبه‌ی روز کاری (computeDay، dayService، calendarService)
  middleware/              adminAuth، telegramAuth، networkRestriction، rateLimiter، csrf، permissions،
                           securityHeaders، maintenanceGate، errorHandler
  api/routes/
    index.js               سوار کردن همه‌ی routeها زیر /api
    health.js  miniapp.js  adminAuth.js  cspReport.js
    admin/                 پنل مدیریتی، تقسیم‌شده بر اساس دامنه (یک فایل برای هر حوزه)
  bot/                     بات، commands/، منو (menu/)، انتخابگرهای دکمه‌ای (ui/)، Jobهای cron (scheduler/)، notifier
  content/                 متن‌های ثابت (پیام‌های تشویقی، برچسب گزارش‌ها)
  utils/                   workHours، jalali، csv، session، serverTime، telegramInitData، telegramLoginAuth،
                           fraudDetection، jobRunner، backupRetention ...
  scripts/                 createAdmin، seedEmployees، pushPanelButton
public/                    Mini App کارمند (بدون build): app.js، planner.js، dailyReport.js، css/tokens.css (توکن مشترک تم)
public-admin/              پنل مدیریتی وب (بدون build)، زیر /admin/؛ viewها در js/views-*.js
                           سیستم طراحی «دفترچه»: css/notebook.css + js/notebook.js؛ صفحه‌ی نمایشی /admin/nb-demo.html
                           (داده‌ی ثابت، بدون API؛ قابل حذف)
scripts/                   install-service.ps1 (NSSM)، setup-ssl-renewal.ps1، run-tests.js، smoke-test.js،
                           package-release.js، secret-scan.js، restore-backup.js، bench-analytics.js، lib/
deploy/                    فایل‌های bat برای نصب/ری‌استارت/حذف سرویس
test/                      تست‌های خودکار (node:test)
docs/                      DOCUMENTATION.md (مستند فنی یکپارچه)
data/                      دیتابیس، backups/، attachments/ (commit نمی‌شوند)
```

> فایل‌های `port-3000.patch` و `port-443-revert.patch` در ریشه patchهای قدیمیِ تغییر پورت هستند و در اجرای برنامه نقشی ندارند.

## نقش‌ها و دسترسی

| نقش | دسترسی |
|---|---|
| `admin` | همه‌چیز؛ تنظیمات، Audit، اصلاح رکورد، پیام گروهی، بک‌آپ، ریست، بستن ماه |
| `hr` (منابع انسانی) | مشاهده‌ی سراسری (کاربران، گزارش‌ها، تحلیل‌ها، مانده‌ی مرخصی، ماه‌های بسته)، مرحله‌ی «منابع انسانی» در زنجیره‌ی تأیید مرخصی؛ بدون اختیارات مدیریتی ادمین |
| `manager` («سرپرست») | فقط تیم خودش (`manager_id`)؛ مشاهده، تأیید مرخصی/دورکاری/اجازه‌ی ورود، رسیدگی به اعتراض، برنامه‌ی هفتگی و تسک فوری زیردستان، پیام به تیم |
| `employee` | فقط داده‌ی خودش و فقط مسیرهای لیست سفید `EMPLOYEE_ALLOWED` در `src/middleware/adminAuth.js`؛ هر مسیر جدید برای او پیش‌فرض بسته است (default-deny) |

مجوزها به‌صورت «حوزه.عمل» (مثل `leave.approve`، `schedule.manage`، `plan.edit_team`) در `src/middleware/permissions.js` تعریف شده‌اند و نقش‌ها به آن‌ها نگاشت می‌شوند. اسکوپ تیم سرپرست سمت سرور اعمال می‌شود (`src/api/routes/admin/common.js`)؛ پنهان‌کردن دکمه‌ها در UI امنیت نیست. نقش بات هم هر بار از دیتابیس چک می‌شود.

## احراز هویت

دو الگوریتم جدا — هرگز جایگزین هم نشوند:

| ورودی | الگوریتم | فایل |
|---|---|---|
| Mini App | `initData` — `HMAC_SHA256(key="WebAppData")` | `src/utils/telegramInitData.js` |
| ورود پنل | Login Widget — `secret = SHA256(botToken)` | `src/utils/telegramLoginAuth.js` |

پنل پس از ورود یک کوکی `HttpOnly` امضاشده (stateless) می‌گیرد (`src/utils/session.js`). ورود با کد یک‌بارمصرف از بات و لینک مستقیم دکمه‌ی پنل هم وجود دارد. نشست‌ها قابل ابطال‌اند و درخواست‌های تغییردهنده زیر حفاظت CSRF هستند (جزئیات در [`docs/DOCUMENTATION.md`](docs/DOCUMENTATION.md)، بخش امنیت وب).

## محدودیت شبکه و دورکاری

`src/middleware/networkRestriction.js` روی `check-in`، `re-check-in`، `check-out` و `break/*` در Mini App اعمال می‌شود: IP مبدأ باید داخل `ALLOWED_NETWORK_CIDR` باشد، یا کاربر **مأموریت تأییدشده** برای همان روز داشته باشد. هویت کاربر برای این استثنا فقط از `req.miniAppUser` (امضاشده) خوانده می‌شود. هر رد و هر عبور با استثنا در `audit_log` ثبت می‌شود.

اگر `remoteWorkEnabled` روشن باشد، کارمند خارج از شبکه (`OUT_OF_NETWORK`) می‌تواند نشست **دورکاری** شروع کند (`/api/miniapp/remote/*`)؛ این نشست‌ها پس از تأیید سرپرست در گزارش‌ها با شمارنده و برچسب جدا شمرده می‌شوند.

## مسیرهای API

همه‌ی مسیرها زیر `/api` هستند. فهرست زیر خلاصه‌ی گروهی است؛ مرجع دقیق، فایل‌های `src/api/routes/miniapp.js` و `src/api/routes/admin/*.js` و ماتریس تست نقش × route است. مسیرهای قدیمی فاز ۱ (`/api/users*`، `/api/attendance/*`، `/api/audit-log`) در `1.0.0-rc.1` حذف شدند.

### عمومی
| مسیر | توضیح |
|---|---|
| `GET /health` | سلامت سرویس: فقط `status` (`ok`/`degraded`) و `time` |
| `POST /csp-report` | دریافت گزارش‌های CSP |

### Mini App کارمند (`/miniapp/*`، پشت `telegramAuth`)
| مسیر | توضیح |
|---|---|
| `GET me`، `today`، `history`، `report`، `network-state` | داده‌ی کارمند و وضعیت شبکه |
| `POST check-in`، `re-check-in`، `check-out`، `break/start`، `break/end` | ثبت تردد (+ شبکه + rate limit)؛ ورود دیر با سقف تأخیر در حالت `enforce` ⇒ ۴۰۹ `LATE_LIMIT_REACHED` |
| `GET/POST checkin-permission`، `GET schedule/upcoming` | گیت تأخیر و «اجازه‌ی ورود»؛ ساعت کاری مؤثر امروز و روزهای بعد |
| `GET remote/today`، `remote/history`؛ `POST remote/start`، `remote/end`، `remote/break/start`، `remote/break/end` | دورکاری |
| `GET leave-types`، `GET/POST leave`، `GET leave/:id/attachment` | مرخصی |
| `POST mission`، `mission/now`، `mission/now/end`، `missions/:id/cancel`، `missions/:id/attachment`؛ `GET missions`، `mission/day`؛ `DELETE missions/:id` | مأموریت |
| `GET/PUT plan`، `POST plan/seen`، `plan/submit`، `GET plan-gate`، `week-board` | برنامه‌ی هفتگی و گیت خروج (هفته‌ی شروع‌شده ⇒ فقط‌خواندنی، نوشتن ⇒ ۴۰۹ `PLAN_LOCKED`) |
| `GET daily-tasks`، `report-backfill`؛ `POST daily-report`، `daily-report/undo`؛ `PATCH daily-report/note` | گزارش روزانه‌ی تسک‌ها (تسک low اختیاری است) |
| `POST my-urgent`؛ `PATCH/DELETE my-urgent/:id` | تسک فوریِ شخصی |
| `GET team-review`؛ `POST report-reviews` | مشاهده‌ی گزارش تیم (سرپرست) |
| `GET/POST dispute`، `GET dispute/:id`، `POST dispute/:id/(messages\|reopen\|close)` | اعتراض و گفت‌وگو روی آن |

### پنل مدیریتی (`/admin/*`)
| حوزه | مسیرها |
|---|---|
| ورود | `POST auth/webapp`، `auth/token`، `auth/code`، `auth/telegram`، `auth/logout`؛ `GET public-config` |
| نمای کلی | `GET me`، `dashboard`، `overview`، `live`، `nightly-review`، `calendar` |
| «وضعیت من» (همه‌ی نقش‌ها، فقط داده‌ی خود) | `GET me/week`، `me/tasks/(today\|backfill\|pending-count)`؛ `POST me/tasks/(answer\|undo)`؛ `PATCH me/tasks/note`؛ `GET me/urgent/config`، `POST me/urgent`، `PATCH/DELETE me/urgent/:id` |
| کارمندان | `GET/POST users`، `GET users/export`، `GET/PATCH/DELETE users/:id`، `GET users/:id/details`، `POST users/:id/message` |
| تردد | `GET attendance`، `attendance/export`؛ `GET/POST/PATCH/DELETE attendance-records…`؛ `POST attendance-records/:id/breaks`؛ `PATCH/DELETE break-records/:id`؛ تأیید اضافه‌کاری `GET overtime-approvals`، `POST overtime-approvals/:recordId/(approve\|reject)` |
| مرخصی/مأموریت | `GET/POST/PATCH/DELETE leave-requests…`، `GET leave-queue`، `POST leave-queue/bulk`، `GET leave-balances`، `POST leave-balances/adjust`، `PUT leave-balances/entitlement`، انواع مرخصی |
| دورکاری | `GET remote-work`، `remote-work/count`؛ `POST remote-work/approve-batch`، `remote-work/:id/(approve\|reject)` |
| اعتراض‌ها | `GET disputes`، `disputes/counts`، `disputes/:id`؛ `POST disputes/:id/messages`، `disputes/:id/(resolve\|reopen)` |
| شیفت و برنامه‌ی کاری | `GET/POST shifts…`، `PUT users/:id/shift`، `POST shifts/assign`؛ `GET users/:id/schedule`، `PUT/DELETE users/:id/schedule/:date`، `POST schedule/bulk` |
| اجازه‌ی ورود | `GET checkin-permissions`، `POST checkin-permissions/:id/decide` |
| برنامه‌ی هفتگی تیم | `GET users/:id/plan`، `plan-overview`، `users/:id/week`؛ `POST users/:id/plan/tasks`، `plan/reorder`، `plan/notify`؛ `PATCH/DELETE plan-tasks/:taskId`؛ `PUT users/:id/plan/supervisor-comment`؛ `POST plan-gate/exemptions` |
| تسک‌ها و بازبینی | `POST users/:id/urgent-tasks`، `GET urgent-tasks`، `DELETE urgent-tasks/:taskId`؛ `GET team-review`، `team-reports`، `team-reports/export`، `task-kpis`؛ `POST report-reviews` |
| گزارش و تحلیل | `GET reports/summary`، `reports/export`؛ `GET analytics/(late-trend\|late-compare\|rankings\|attendance-rate\|leave-by-type\|checkin-distribution\|patterns)` |
| بستن ماه | `GET month-closures`، `month-closures/:y/:m/(checklist\|adjustments)`؛ `POST month-closures/:y/:m/(close\|reopen)` |
| کنترل و اعلان | `GET suspicious`، `POST suspicious/:id/review`؛ `GET notifications`، `notifications/unread-count`؛ `POST notifications/read-all`، `notifications/:id/read` |
| تعطیلات و تنظیمات | `GET/POST/DELETE holidays`، `GET/PATCH settings` |
| سیستم (فقط ادمین) | `GET audit-log`، `audit-log/export`، `audit-actions`؛ `POST broadcast`؛ `GET system`، `system/status`، `system/backup`؛ ریست: `GET system/reset/options`، `POST system/reset/preview`، `POST system/reset` |

## بات تلگرام و Jobها

Polling (بدون webhook و بدون پورت ورودی). همه‌ی کارها از دکمه‌ی **«📂 منو»** انجام می‌شود که تنها دکمه‌ی کیبورد پایین چت است؛ با لمس آن منوی inline نقش‌محور (۲ ستونه، گروه‌بندی «کارهای من / تیم / مدیریت»، با «✖️ بستن منو») باز می‌شود و بعد از انتخاب پاک می‌شود. «🕒 ثبت تردد»، «📋 برنامه هفتگی» و «⚙️ پنل مدیریت» دکمه‌ی inline از نوع `web_app` (فقط https) هستند. منوی «/» تلگرام عمداً خالی است؛ فقط `/start` کار می‌کند. کاربری که هنوز کیبورد قدیمی را دارد با اولین لمس کیبورد جدید را می‌گیرد؛ برای جایگزینی یک‌جا: `node src/scripts/pushPanelButton.js --apply`.

| نقش | گزینه‌های منو |
|---|---|
| کارمند | «🕒 ثبت تردد»، «📊 وضعیت من»، «📈 گزارش من»، «🏖 مرخصی / 🚗 ماموریت»، «📋 برنامه هفتگی»، «🖥 پنل»، «❓ راهنما» |
| سرپرست | + «👥 گزارش تیم»، «📥 درخواست‌های منتظر»، «💬 اعتراض‌ها»، «📝 گزارش‌های دیروز تیم»، «👤 لیست اعضا» |
| ادمین | + «➕ افزودن کارمند»، «🛠 اصلاح رکورد»، «⚙️ پنل مدیریت» |

در جریان‌های چندمرحله‌ای تاریخ با تقویم شمسی inline، ساعت با اسلات ۳۰ دقیقه‌ای و کارمند/سرپرست با فهرست دکمه‌ای انتخاب می‌شود (تایپ `YYYY-MM-DD` / `HH:MM` هم پذیرفته است)؛ زیر هر مرحله «❌ انصراف | 🏠 منوی اصلی» هست. فقط متن آزاد (نام، توضیح، دلیل) تایپ می‌ماند. حالت گفتگوهای چندمرحله‌ای در حافظه است و با ری‌استارت پروسه از بین می‌رود.

**Jobهای `node-cron`** (`src/bot/scheduler/`):

| دسته | Jobها |
|---|---|
| یادآورها | تأخیر در ورود، خروج، مهلت تسک فوری (هر ۱۰ دقیقه)، تأیید مرخصی، دورکاری |
| محاسبه و نگهداری | علامت‌گذاری تعطیل/مرخصی، بستن رکوردهای ناقص، بک‌آپ روزانه، آرشیو Audit، نگهداری دیتابیس |
| گزارش | روزانه/هفتگی/ماهانه (ماه شمسی)، خلاصه‌ی صبحگاهی، مرور شبانه، گزارش شبانه‌ی تسک‌ها، اسناد گزارش |
| سرپرستان | ساخت خودکار تسک واجب «بررسی گزارش روز قبل» (هر روز ۰۰:۱۰، `CRON_TEAM_REVIEW_ENSURE`) |
| پایش | **watchdog** (هشدار تلگرامی به ادمین‌ها) |

هر اجرای Job در جدول `job_runs` ثبت و در پنل (ادمین ← «وضعیت سیستم») نمایش داده می‌شود. عبارات `CRON_*` در `.env` (و برخی در تنظیمات پنل) قابل تغییرند؛ **پیش‌فرض‌ها شنبه تا چهارشنبه را فرض می‌کنند — با روزهای کاری واقعی تطبیق دهید.**

## امنیت و پایش

- هدرهای امنیتی و CSP (`CSP_MODE`، پیش‌فرض `report-only`)، HSTS، کوکی `HttpOnly` با `SameSite=Strict`، CSRF، ابطال نشست
- Rate limit ماندگار روی تردد و ورود پنل (SQLite، با ری‌استارت صفر نمی‌شود)
- default-deny برای نقش کارمند؛ کنترل رازهای راه‌اندازی، `secret-scan` و بسته‌ساز release بدون راز
- Audit Log غیرقابل‌ویرایش (با آرشیو ماهانه) و موارد مشکوک (IP یکسان، تغییر دستگاه)
- مانیتورینگ: `GET /api/health`، `GET /api/admin/system/status` و هشدار تلگرامی watchdog برای دیسک، polling، شکست Job و کهنگی بک‌آپ

جزئیات هر مورد در [`docs/DOCUMENTATION.md`](docs/DOCUMENTATION.md) (بخش «امنیت، رازها و پایش»).

## استقرار (ویندوز + NSSM)

1. `npm install --omit=dev` و پر کردن `.env` (`NODE_ENV=production`).
2. گواهی HTTPS با DNS-01: `scripts/setup-ssl-renewal.ps1` (نیمه‌دستی؛ توضیح داخل اسکریپت). مسیرها در `SSL_CERT_PATH`/`SSL_KEY_PATH`.
3. نصب سرویس: `scripts/install-service.ps1` (NSSM، شروع خودکار، چرخش لاگ، ری‌استارت در crash؛ نام پیش‌فرض سرویس `FarazHonarAttendance`).
4. در BotFather: `/setdomain` برای دامنه‌ی پنل (لازم برای Login Widget).
5. هر ارتقا: `nssm stop` ← جایگزینی کد ← `npm install` ← `npm run migrate` ← `nssm start`.

ارتقاهای فازی (فقط افزایشی؛ بدون تغییر اجباری `.env` مگر در موارد ذکرشده):

| فاز | migration | نکته |
|---|---|---|
| ۱۰ | ۰۲۳–۰۲۶ | گیت‌های برنامه‌ی هفتگی/گزارش روزانه و قفل Go-Live پیش‌فرض خاموش؛ `.env` جدید: `CRON_MORNING_DIGEST`، `ALLOW_DATA_RESET` |
| ۱۱ | ۰۲۷ | تنظیم تازه‌ی `disputeMaxReopens` |
| ۱۲ | ۰۲۸–۰۳۲ | استراحت با حقوق و سقف تأخیر پیش‌فرض خاموش |
| ۱۳ | ۰۳۳–۰۳۵ | بدون تغییر `.env` |
| ۱۴ | ۰۳۶–۰۳۸ | دورکاری؛ `ALLOWED_NETWORK_CIDR` و `TRUST_PROXY` را بررسی کنید |
| ۱۵ | ۰۳۹ | «امروزِ من»، توضیح انجام تسک |
| ۱۶–۱۹ | ۰۴۰–۰۴۲ | بازطراحی UI، ناهار/استراحت/ورود مجدد؛ تغییر اصلی سمت فرانت‌اند |

دستورها و چک‌لیست تست دستی هر فاز: [`docs/DOCUMENTATION.md`](docs/DOCUMENTATION.md) (بخش «فازها»).

> اسکریپت‌های PowerShell روی ویندوز واقعی با دسترسی Administrator باید یک‌بار امتحان شوند.

## بک‌آپ و بازیابی

بک‌آپ خودکار روزانه (`CRON_DAILY_BACKUP`) و پیش از هر migration در `data/backups/` گرفته می‌شود؛ بک‌آپ دستی از پنل (ادمین ← سیستم ← بک‌آپ) هم ممکن است. بازیابی با `scripts/restore-backup.js`. راهنمای کامل مرحله‌به‌مرحله: [`BACKUP_RESTORE.md`](BACKUP_RESTORE.md).

## تست

```bash
npm test             # همه‌ی تست‌ها (node:test، بدون وابستگی اضافه)
npm run test:watch   # اجرای مجدد با هر تغییر
npm run smoke        # سرور واقعی روی دیتابیس موقت + چند درخواست کلیدی
npm run secret-scan  # جست‌وجوی توکن/کلید/راز در پروژه (کد خروج ۱ = یافته)
npm run package      # zip تحویل بدون .env/.ssl/data/node_modules/.git → dist/
```

تست‌ها hermetic هستند: دیتابیس موقت، توکن و راز ساختگی، و `.env` واقعی خوانده نمی‌شود. آخرین اجرای ثبت‌شده در `PROJECT_STATUS.md`: ۲٬۶۴۳ تست در ۵۳۲ suite، بدون شکست. حوزه‌های پوشش:

- **هسته و امنیت:** migration، `initData` و Login Widget، سشن، `networkRestriction`، ماتریس دسترسی نقش × route و ترتیب routeها، هدرها/CSP، کوکی، CSRF، ابطال نشست، کنترل رازها و اسکنر، بسته‌ساز release
- **عملیات و پایش:** ثبت اجرای Jobها، نبض polling، watchdog با بات ماک‌شده، `/api/health` و `/api/admin/system/status`
- **تردد و محاسبه:** موتور `computeDay`، استراحت و استراحت با حقوق، ناهار، ورود مجدد/نوبت‌ها، شیفت و برنامه‌ی روزبه‌روز، سقف تأخیر و اجازه‌ی ورود، دورکاری
- **مرخصی و ماموریت:** اعتبارسنجی، اثر روی ساعت کاری، تأیید شبانه، مانده‌ها، زنجیره‌ی تأیید
- **برنامه و تسک:** برنامه‌ی هفتگی و گیت‌های خروج (`PLAN_LOCKED`)، گزارش روزانه، تسک فوری، «امروزِ من»، دید مدیر، گزارش شبانه، تسک واجب سرپرست
- **بات:** منوی نقش‌محور، انتخابگرهای دکمه‌ای، ورودی ساعت قابل‌تایپ
- **UI:** تست‌های ایستای CSS/دسترس‌پذیری/کنتراست، پوشش حالت‌های هر صفحه (طبق جدول بخش «حالت‌های UI» در `docs/DOCUMENTATION.md`)، تاریخ شمسی و رگرسیون پنل

## وضعیت فعلی و کارهای باز

فازهای ۱ تا ۱۹ در کد و تست خودکار تکمیل‌اند. موارد باز (جزئیات در [`PROJECT_STATUS.md`](PROJECT_STATUS.md)):

- **تست دستی روی محیط واقعی:** بات polling و `initData`/Login Widget روی تلگرام واقعی، HTTPS/DNS-01، اسکریپت‌های NSSM/win-acme، و UI پنل و Mini App در مرورگر/تلگرام (۳۲۰/۳۹۰/۷۶۸/۱۴۴۰px، دو تم، RTL، صفحه‌خوان، iOS/Android)
- **قبل از هر استقرار:** `npm test && npm run smoke && npm run secret-scan` روی سیستم هدف (بعضی محیط‌های توسعه `better-sqlite3` بومی نداشتند)
- **قوانین رسمی اضافه‌کاری** (سقف، ضریب، گرد‌کردن) هنوز با کارفرما نهایی نشده است
- **lazy-load viewهای پنل** به یک فاز معماری مستقل موکول شده است
- **تعیین DNS provider دامنه** برای خودکار شدن کامل تمدید SSL

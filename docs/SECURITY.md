# امنیت وب: هدرها، کوکی، CSRF و باطل‌کردن نشست

> بخش ۲-الف. راز‌ها و بسته‌بندی امن در `docs/SECRETS.md` (بخش ۲-ب)، بک‌آپ در `docs/BACKUP_RESTORE.md` (بخش ۲-ج) می‌آید.

## ۱. هدرهای امنیتی (`src/middleware/securityHeaders.js`)

روی همه‌ی پاسخ‌ها (استاتیک و API):

| هدر | مقدار / توضیح |
|---|---|
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin` — فقط origin به سایت دیگر می‌رود؛ چون لینک ورود پنل ممکن است `?t=<توکن>` داشته باشد |
| `Permissions-Policy` | دوربین، میکروفون، موقعیت، پرداخت، USB بسته |
| `Strict-Transport-Security` | فقط روی اتصال TLS واقعی؛ `max-age` پیش‌فرض ۱۸۰ روز، بدون `includeSubDomains`/`preload` (`HSTS_MAX_AGE_SECONDS`) |
| `X-Powered-By` | حذف شد |

مسیرهای `/api/*` علاوه بر این: `Cache-Control: no-store`، `X-Frame-Options: DENY` و CSP بسته (`default-src 'none'`).

### CSP

سه نوع مسیر: `api` (`/api/*`)، `panel` (`/admin/*`)، `miniapp` (بقیه).

- `script-src 'self' https://telegram.org` (برای `telegram-web-app.js` و `telegram-widget.js`)؛ **بدون** `unsafe-inline`.
- `style-src 'self'` + `style-src-attr 'unsafe-inline'` (فقط صفت `style=""`؛ تگ `<style>` مجاز نیست).
- پنل: `frame-src https://oauth.telegram.org https://telegram.org` برای iframe ویجت ورود تلگرام.
- `frame-ancestors 'self' https://web.telegram.org https://*.telegram.org` برای پنل و Mini App؛ برای API `'none'`.
  (کلاینت‌های native تلگرام iframe نیستند و به این بند وابسته نیستند.)
- `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `report-uri /api/csp-report`.

**حالت‌ها** (`CSP_MODE` در `.env`):

| مقدار | رفتار |
|---|---|
| `report-only` (پیش‌فرض) | سیاست کامل فقط گزارش می‌شود؛ یک سیاست «پایه» (`frame-ancestors`, `base-uri`, `object-src`) اجباری است |
| `enforce` | سیاست کامل اجباری |
| `off` | فقط سیاست پایه |

گزارش‌ها به `POST /api/csp-report` می‌روند و (بدون ذخیره در دیتابیس، یکتا‌شده، rate-limit شده) در لاگ سرور با پیشوند `[CSP]` چاپ می‌شوند.

**چک‌لیست رفتن به `enforce`** (روی سرور واقعی، داخل تلگرام):
1. چند روز با `report-only` کار کنید و دکمه‌ی «پنل» و «ثبت تردد» را از **موبایل و دسکتاپ تلگرام** بزنید، و ورود با ویجت و با کد `/panel` را هم.
2. لاگ سرور را برای خط‌های `[CSP] تخلف` بگردید. اگر چیزی جز افزونه‌های مرورگر نبود → `CSP_MODE=enforce` و سرویس را restart کنید.
3. اگر `[CSP]` درباره‌ی `eval` / `unsafe-eval` در پنل بود (ممکن است ویجت تلگرام برای `data-onauth` از eval استفاده کند) → `CSP_PANEL_UNSAFE_EVAL=true`. این فقط برای پنل اعمال می‌شود.
4. اگر بعد از `enforce` مشکلی پیش آمد: `CSP_MODE=report-only` و restart (بازگشت فوری).

قیدهایی که تست خودکار نگه می‌دارد (`test/security.test.js`): هیچ `<script>` درون‌خطی، `<style>`، `onclick=` و `eval`/`new Function` در فایل‌های `public/` و `public-admin/` نباشد. (اسکریپت `AP.boot()` قبلاً درون‌خطی بود و به `public-admin/js/boot.js` منتقل شد.)

## ۲. کوکی نشست (`src/utils/sessionCookie.js`)

`HttpOnly; Path=/; SameSite=Strict; Max-Age=…` و `Secure` در production، روی HTTPS مستقیم یا اتصال TLS.

- `SameSite=Strict`: همه‌ی درخواست‌های پنل از صفحه‌ی همین دامنه می‌آیند. اگر ورود از لینک بات (ناوبری cross-site) شروع شود، صفحه‌ی استاتیک بدون کوکی لود می‌شود و `fetch`های بعدی هم‌سایت‌اند.
  در صورت مشکل در یک کلاینت، موقتاً `ADMIN_COOKIE_SAMESITE=lax`.
- `Path=/` و نام کوکی عمداً تغییر نکردند تا نشست‌های فعلی قطع نشوند و دو کوکی هم‌نام ایجاد نشود.
- **محدودیت شناخته‌شده:** Mini App/پنل داخل iframe «Telegram Web» (`web.telegram.org`) کوکی third-party حساب می‌شود و با Lax هم از قبل ارسال نمی‌شد؛ با Strict بدتر نشده است. کلاینت‌های موبایل/دسکتاپ تلگرام top-level هستند و مشکلی ندارند.

## ۳. CSRF (`src/middleware/csrf.js`)

برای همه‌ی متدهای غیر `GET/HEAD/OPTIONS` زیر `/api/admin/*` (شامل ورود و خروج):

1. هدر `X-Requested-With: AttendancePanel` **الزامی** است (مرورگر برای آن در درخواست cross-origin preflight می‌فرستد و سرور CORS ندارد).
2. اگر `Origin` هست باید هم‌میزبان `Host` باشد (یا در `CSRF_EXTRA_ORIGINS`)؛ `null` و ناشناخته رد می‌شود. اگر `Origin` نبود، `Referer` همین قاعده را دارد. اگر هر دو نبودند، فقط با وجود هدر سفارشی عبور می‌کند (curl، تست).

پاسخ رد: `403` با `{ code: 'CSRF' }`. `/api/miniapp/*` مشمول نیست (کوکی ندارد، با `X-Telegram-Init-Data` احراز می‌شود).

**قرارداد فرانت‌اند:** هر `fetch` نوشتنی جدید در پنل باید از `AP.api` استفاده کند (هدر را خودش می‌فرستد). فایل قدیمی و بلااستفاده‌ی `public-admin/js/app.js` هم هدر را دارد.

## ۴. باطل‌کردن نشست

نشست stateless است؛ توکن حاوی `{ userId, sv, ge, exp }` است و در **هر** درخواست مقایسه می‌شود:

- `sv` با `users.session_version` (برای هر کاربر)
- `ge` با `settings.global_session_epoch` (برای همه)

عدم تطابق ← `401` با `code: 'SESSION_REVOKED'` و پاک‌شدن کوکی. توکن‌های قدیمی بدون `sv/ge` به‌صورت `۰` حساب می‌شوند، پس با استقرار این بخش هیچ‌کس خارج نمی‌شود.

**خودکار:** هر تغییر واقعی در `is_active`، `role` یا `telegram_user_id` (در `usersRepository.updateUser`؛ پنل، بات و اسکریپت‌ها را پوشش می‌دهد) `session_version` را زیاد می‌کند. تغییر نام، دپارتمان، کد پرسنلی یا سرپرست نشست را باطل نمی‌کند. فعال‌کردن دوباره‌ی کاربر نشست قدیمی را زنده نمی‌کند.

**دستی (فقط ادمین کل، دلیل اجباری، audit):**
- `POST /api/admin/users/:id/revoke-sessions` — دکمه‌ی «خروج از همه‌ی نشست‌ها» در پروفایل کارمند (action: `user_sessions_revoked`).
- `POST /api/admin/system/revoke-all-sessions` — دکمه‌ی «خروج همه‌ی کاربران» در صفحه‌ی «سیستم و پشتیبان» (action: `all_sessions_revoked`). نشست ادمینِ اجراکننده حفظ می‌شود مگر `includeSelf: true`.

**اضطراری — چرخش `ADMIN_SESSION_SECRET`:** اگر مشکوک هستید راز امضا یا کوکی‌ای لو رفته: مقدار جدید (`openssl rand -hex 32`) در `.env` بگذارید و سرویس را restart کنید (`nssm restart <نام سرویس>`). **همه** توکن‌ها بلافاصله نامعتبر می‌شوند (حتی اگر دکمه‌ی پنل در دسترس نباشد) و همه باید دوباره وارد شوند. این روش در برابر کسی که خودِ راز را دارد تنها راه است؛ ابطال از پنل فقط در برابر کوکی‌های دزدیده‌شده کافی است.

## ۵. نکته برای migrationهای بعدی

ستون `users.session_version` (migration ۰۰۲) باید در هر `rebuildTable` روی `users` (مثلاً افزودن نقش `hr` در بخش ۴) **در تعریف جدید جدول بیاید**، وگرنه با بازسازی جدول حذف می‌شود و ورود همه خراب می‌شود. تست `rebuildTable` در `test/migrations.test.js` این را با ستون موجود نشان می‌دهد.

## ۶. رازها و بسته‌ی تحویل
مدیریت رازها (`npm run package`، `npm run secret-scan`، کنترل راه‌اندازی، `icacls`، و چک‌لیست «اگر راز لو رفت») در [`SECRETS.md`](SECRETS.md) است. چرخش `ADMIN_SESSION_SECRET` برای ابطال اضطراری همان‌جا و در بخش ۴ همین سند آمده است.

## ۷. Rate limit ماندگار (بخش ۲-ب۲)

- **ذخیره‌سازی:** شمارنده‌ها در جدول `rate_limit_hits` (migration `003_rate_limits`، repository: `rateLimitRepository`) نگهداری می‌شوند؛ با ری‌استارت/crash سرویس (NSSM) صفر **نمی‌شوند**. قبلاً ری‌استارت = بازنشانی سقف تلاش ورود.
- **الگوریتم:** همان fixed-window قبلی؛ هر درخواست یک UPSERT اتمیک. ردیف‌های منقضی هر ۱۰ دقیقه (و هنگام اولین استفاده بعد از بالا آمدن) پاک می‌شوند. جدول فقط داده‌ی کوتاه‌عمر دارد و بخشی از داده‌ی کاربری/تردد نیست.
- **سقف‌ها و کلیدها (بدون تغییر نسبت به قبل):**

| limiter (`name` ثابت) | مسیرها | کلید | سقف |
|---|---|---|---|
| `miniapp-action` | `/api/miniapp/check-in`، `check-out`، `break/start`، `break/end` | `miniapp:<آیدی تلگرام>` | ۲۰ در ۱ دقیقه |
| `admin-login` | `/api/admin/auth/code`، `/api/admin/auth/telegram` | IP | ۱۰ در ۱۵ دقیقه |
| `panel-auto-login` | `/api/admin/auth/webapp`، `/api/admin/auth/token` | IP | ۱۲۰ در ۱۵ دقیقه |
| `csp-report` | `/api/csp-report` | IP | ۳۰ در ۱ دقیقه (بدون audit) |

  نام limiter کلید ذخیره‌ی ماندگار است؛ **تغییر نام یک limiter = شمارنده‌ی آن از صفر شروع می‌شود** (و ردیف قدیمی خودبه‌خود منقضی/پاک می‌شود).
- **ثبت ۴۲۹ در `audit_log`:** action = `rate_limit_exceeded`، با `ip_address` و جزئیات `{limiter, key, method, path, count, window_resets_at}` (مسیر بدون query string؛ هیچ مقدار body/header ثبت نمی‌شود). فقط **اولین** درخواست مسدودشده‌ی هر کلید در هر پنجره ثبت می‌شود (حتی بعد از ری‌استارت)، و سقف سراسری ۳۰ رکورد در دقیقه وجود دارد تا حمله با IPهای زیاد لاگ را پر نکند. در پنل: صفحه‌ی Audit ← فیلتر action.
- **خطای دیتابیس:** اگر نوشتن شمارنده شکست بخورد (قفل/دیسک پر)، limiter موقتاً از شمارنده‌ی حافظه استفاده می‌کند (محدودیت برداشته نمی‌شود، سرویس هم نمی‌افتد) و خطا با پیشوند `[rate-limit]` در لاگ می‌آید.
- **`RATE_LIMIT_STORE=memory`** رفتار قبلی (فقط حافظه) را برمی‌گرداند؛ پیش‌فرض `sqlite`.
- **محدودیت‌ها (صادقانه):** پنجره‌ی ثابت است (در مرز دو پنجره تا ۲ برابر سقف ممکن است عبور کند). کلید ورود پنل فقط IP است؛ چون ممکن است چند کارمند پشت یک IP باشند، سقف `panel-auto-login` بالاتر است. اگر چند سرور/پروسه‌ی جدا شد، این SQLite مشترک فقط برای پروسه‌های روی همان فایل کافی است.

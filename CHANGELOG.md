# CHANGELOG

وضعیت و جزئیات کامل فازها: [`PROJECT_STATUS.md`](PROJECT_STATUS.md) — معماری: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

## [Unreleased] — بخش ۳ (موتور محاسبه و تنظیمات)

### S3-1b — API تنظیمات با متادیتا، ذخیره با دلیل اجباری و reset
- **`GET /api/admin/settings/items`** (سرپرست/ادمین): `{ items, groups }`؛ هر آیتم: `key, type, group, groupLabel, description, value, default, isDefault, updatedAt` و (در صورت وجود) `min/max/values`.
- **`PUT /api/admin/settings/:key`** `{ value, reason }` (فقط ادمین کل): دلیل اجباری و مقدار نامعتبر ⇒ ۴۰۰ (پیام فارسی، بدون هیچ تغییر)، کلید ناشناخته ⇒ ۴۰۴. مقدار برابر با مقدار فعلی ⇒ `changed:false` بدون نوشتن و بدون audit.
- **`POST /api/admin/settings/:key/reset`** `{ reason }` (فقط ادمین کل): ردیف ذخیره‌شده‌ی آن کلید حذف می‌شود تا پیش‌فرض (و در صورت تغییر، پیش‌فرضِ `.env`) دنبال شود؛ ردیفی نبود ⇒ `changed:false`.
- **audit**: اکشن `settings_updated` (PUT) و `settings_reset` با همان قالب details قبلی (`source`, `fields`) به‌علاوه‌ی `changes: { key: { before, after } }` و `reason`. `PATCH /api/admin/settings` (که UI فعلی می‌زند) هم اکنون `changes` قبل/بعد را در details می‌گذارد؛ پذیرش، پاسخ و بدون‌دلیل‌بودنش بدون تغییر است.
- **`settingsRepository`**: `getItems/getItem/setValue/resetValue` (SQL فقط آنجا). `GET/PATCH /api/admin/settings` و UI بدون تغییر.
- بدون migration، بدون وابستگی جدید.
- تست: `test/settingsApi.test.js` (۴ تست: لیست و متادیتا + سازگاری GET قدیمی، ذخیره/۴۰۰/audit/no-op، reset، دسترسی/۴۰۴/CSRF و PATCH قدیمی). `npm test`: ۲۸۰ سبز.

### S3-1a — رجیستری تنظیمات + اعتبارسنجی (بدون API/UI)
- **`src/utils/settingsRegistry.js`** (جدید، خالص و بدون SQL): هر تنظیم یک خط `def(key, dbKey, type, { default, fallback, min, max, values, group, description })`. انواع: `number` (صحیح با بازه) | `boolean` | `time` (HH:MM؛ `8:00` ⇒ `08:00`) | `cron` (با `node-cron` validate) | `enum` | `string`. توضیح فارسی و `group` (برچسب‌ها در `GROUP_LABELS`) برای صفحه‌ی گروه‌بندی‌شده‌ی S3-9a. `validate(key, raw)` ⇒ `{ok,value}|{ok:false,error}` (برای S3-1b)، `deserialize` (خراب/خارج از بازه ⇒ پیش‌فرض، هرگز NaN)، `serialize`، `defaultOf` (پیش‌فرض از `config`/`.env` و در صورت نامعتبر بودن `fallback` ثابت تا غلط تایپی در `.env` سرور را خراب نکند) و `selfCheck()` (کلید تکراری/پیش‌فرض نامعتبر و ...).
- **`settingsRepository`**: `KEY_MAP/INT_RANGES/BOOLEAN_KEYS/DEFAULTS` حذف و همه از رجیستری ساخته می‌شود؛ API عمومی و ترتیب/نام کلیدهای `getAll()` بدون تغییر. هر ۱۱ کلید فعلی (۵ کلید اصلی + ۶ کلید S2) منتقل شد. رفتار `update`: نامعتبر/خالی/ناشناخته **همچنان نادیده** (۴۰۰ در S3-1b).
- ⚠️ تغییر رفتار جزئی (فقط برای مقدار نامعتبر): ۵ کلید قدیمی اکنون هم بازه دارند (دقیقه ۰ تا ۷۲۰، آستانه‌ی تأخیر ۱ تا ۱۰۰ و ساعت‌ها HH:MM معتبر)؛ قبلاً هر متنی ذخیره می‌شد و مقدار عددی خراب هنگام خواندن `NaN` می‌شد. مقدار معتبر قبلی در DB دقیقاً همان می‌ماند.
- بدون migration، بدون وابستگی جدید، بدون تغییر API/UI.
- تست: `test/settingsRegistry.test.js` (۴ تست: سلامت رجیستری و پوشش ۱۱ کلید، هر نوع با مقدار معتبر/نامعتبر، سازگاری با مقادیر موجود DB، رفتار `update`). `npm test`: ۲۷۶ سبز.

## [Unreleased] — بخش ۲ (امنیت، پایداری و عملیات)

### S2-7b — Job ماهانه‌ی نگهداری دیتابیس (cleanup + ANALYZE/optimize + VACUUM)
- **`src/bot/scheduler/dbMaintenance.js`** ← `runDbMaintenance()` با ترتیب: ۱) `runCleanup({ dryRun: false })` (S2-7a؛ نگهداری‌ها از تنظیمات) ۲) `ANALYZE` ۳) `PRAGMA optimize` ۴) `VACUUM` + `wal_checkpoint(TRUNCATE)` **فقط اگر فضای دیسک کافی است**. خطای cleanup بقیه‌ی مراحل را متوقف نمی‌کند ولی در پایان Job را «error» می‌کند.
- **شرط VACUUM**: از چک دیسک `systemHealth.checkDisk()` (اکنون export شده) استفاده می‌شود؛ لازم است فضای آزاد ≥ **۲ × (حجم دیتابیس + WAL) + `MONITOR_DISK_MIN_FREE_MB`** باشد (VACUUM نسخه‌ی کاملی می‌سازد). فضای ناکافی **یا نامعلوم** (statfs در دسترس نیست) ⇒ VACUUM رد و لاگ می‌شود، Job خطا نمی‌دهد و ماه بعد دوباره تلاش می‌کند. تصمیم در تابع خالص `vacuumDecision` است.
- **`src/repositories/maintenanceRepository.js`** (جدید): `analyze/optimize/vacuum/checkpointTruncate` (SQL فقط اینجا).
- **زمان‌بندی**: `config.cron.dbMaintenance` (env `CRON_DB_MAINTENANCE`، پیش‌فرض `0 4 2 * *` = روز دوم هر ماه میلادی ۰۴:۰۰، بعد از بک‌آپ ۰۲:۳۰ و آرشیو audit ۰۳:۰۰) با `wrapJob('dbMaintenance', …)` و `cron.validate` (نامعتبر ⇒ فقط لاگ خطا). در `.env.example` مستند شد. ⚠️ VACUUM هنگام اجرا قفل نوشتن می‌گیرد (`busy_timeout` ۵ ثانیه)، برای همین در ساعت کم‌ترافیک است.
- بدون migration، بدون API/UI، بدون وابستگی جدید.
- تست: `test/dbMaintenance.test.js` (۴ تست: فرمول و مرز `vacuumDecision`، **فضای ناکافی/نامعلوم ⇒ VACUUM صدا زده نمی‌شود** و Job موفق می‌ماند، ترتیب مراحل + اجرای واقعی (freelist صفر می‌شود، cleanup واقعی ردیف منقضی را حذف می‌کند، users/attendance_records دست‌نخورده، integrity_check ok)، خطای cleanup ⇒ error با اجرای بقیه‌ی مراحل و ثبت cron). `npm test`: ۲۷۲ سبز.

### S2-7a — سیاست پاک‌سازی جدول‌های فرعی (تابع cleanup؛ هنوز Job نیست)
- **`src/utils/dataCleanup.js`** ← `runCleanup({ now, dryRun = true, retention, log })`: سه جدول را پاک‌سازی می‌کند و برای هر کدام یک خط لاگ می‌نویسد. **پیش‌فرض dry-run است** (فقط شمارش، چیزی حذف نمی‌شود)؛ حذف واقعی فقط با `dryRun: false` صریح (Job در S2-7b). خطا در یک جدول بقیه را متوقف نمی‌کند و در پایان خطای تجمیعی پرتاب می‌شود.
  - **`job_runs`**: اجراهای تمام‌شده‌ی قدیمی‌تر از نگهداری. **هرگز پاک نمی‌شود:** ردیف `running` و **آخرین ردیفِ هر (job، وضعیت)** (آخرین success/error هر Job مبنای صفحه‌ی سلامت و watchdog است و Jobهای ماهانه نباید گم شوند).
  - **`monitor_alerts`**: فقط هشدارهای حل‌شده (`state='ok'`) با `updated_at` قدیمی. هشدار `firing` هرگز پاک نمی‌شود.
  - **`rate_limit_hits`**: ردیف‌های منقضی که `reset_at` آن‌ها قدیمی‌تر از نگهداری است (قبلاً فقط منقضی‌ها بلافاصله با `purgeExpired` پاک می‌شدند).
  - **`csp_reports`** ذخیره نمی‌شود (`routes/cspReport.js` فقط لاگ می‌کند) ⇒ سیاستی ندارد.
- **تنظیمات جدید** (همان `GET/PATCH /api/admin/settings`، عدد صحیح با بازه؛ نامعتبر نادیده، مقدار خراب در DB ⇒ پیش‌فرض): `jobRunsRetentionDays` (۱۸۰، بازه ۷ تا ۳۶۵۰)، `monitorAlertsRetentionDays` (۱۸۰، ۷ تا ۳۶۵۰)، `rateLimitRetentionDays` (۷، ۱ تا ۳۶۵). `settingsRepository.getCleanupRetention()`.
- **repositoryها** (SQL فقط آنجا): `jobRunsRepository.countPurgeable/purgeOlderThan`، `monitorRepository.countResolvedOlderThan/purgeResolvedOlderThan`، `rateLimitRepository.countExpired`.
- بدون migration، بدون Job/زمان‌بندی، بدون UI، بدون وابستگی جدید.
- تست: `test/dataCleanup.test.js` (۴ تست: dry-run بدون هیچ تغییر، اجرای واقعی با محافظت‌ها و «users/attendance_records/leave_requests/audit_log/settings دست‌نخورده» و اجرای دوباره، تنظیمات و اعتبارسنجی، خطای تجمیعی). `npm test`: ۲۶۸ سبز.

### S2-6c — انتقال واقعی آرشیو audit + `include_archive`
- **انتقال واقعی** (`runAuditArchive`): وقتی تنظیم `auditArchiveEnabled` **روشن** باشد، رکوردهای `audit_log` که قدیمی‌تر از `auditRetentionMonths` ماه‌اند (مرز باز، آستانه‌ی UTC که در شروع اجرا یک‌بار ثابت می‌شود) **batch‌به‌batch** به `audit_log_archive` منتقل می‌شوند؛ خاموش ⇒ همان dry-run قبلی (شمارش + لاگ، بدون هیچ تغییر). نتیجه‌ی Job اکنون `mode` (`dry-run` | `archive`)، `moved` و `batches` دارد. پس از اتمام، خودِ انتقال با اکشن `audit_archived` (تعداد، batch، آستانه) در audit ثبت می‌شود (فقط وقتی `moved > 0`؛ خطای این ثبت Job را خطا نمی‌کند). تأیید پایانی: اگر رکورد قدیمی‌ای در `audit_log` بماند Job خطا می‌دهد.
- **تراکنش و batch** (`auditRepository.archiveBatch(cutoff, batchSize)`): هر batch یک تراکنش است: انتخاب (قدیمی‌ترین‌ها اول) ← `INSERT … SELECT` با **همان id/ستون‌ها و زمان رویداد** ← `DELETE` از اصلی. اگر تعداد کپی/حذف با تعداد انتخاب‌شده نخواند یا id در آرشیو تکراری باشد، استثنا پرتاب و **کل batch برگردانده می‌شود**؛ batchهای قبلی سالم‌اند و خطا به `wrapJob` می‌رسد (`job_runs` = error). `cutoff` و `batchSize` (۱ تا ۱۰۰۰۰) اعتبارسنجی می‌شوند. این تنها استثنای «بدون update/delete» در `auditRepository` است و رکورد را حذف نمی‌کند، فقط جابه‌جا می‌کند.
- **تنظیم جدید env**: `AUDIT_ARCHIVE_BATCH_SIZE` (پیش‌فرض ۱۰۰۰؛ خراب/خارج از بازه ⇒ ۱۰۰۰) در `config.auditArchive.batchSize` و `.env.example`.
- **`include_archive`**: `GET /api/admin/audit-log` و `GET /api/admin/audit-log/export` (فقط ادمین کل) پارامتر `include_archive` می‌گیرند: `1|true` ⇒ اصلی + آرشیو (مرتب بر پایه‌ی زمان، فیلترها روی هر دو کار می‌کنند)؛ نبودن/`0|false` ⇒ فقط `audit_log` مثل قبل؛ هر مقدار دیگر یا تکراری ⇒ ۴۰۰. در JSON فقط با این پارامتر فیلد `archived` (boolean) اضافه می‌شود و در CSV ستون «منبع» (اصلی/آرشیو)؛ بدون پارامتر قالب خروجی کاملاً بدون تغییر است. `listRecent/listByUser/search` گزینه‌ی `includeArchive` گرفتند.
- بدون migration (ساختار از S2-6a)، بدون وابستگی جدید، بدون تغییر UI (چک‌باکس «شامل آرشیو» در پنل هنوز نیست).
- تست: `test/auditArchiveMove.test.js` (۶ تست: انتقال واقعی با حفظ id/ستون‌ها و **جمع اصلی+آرشیو قبل و بعد برابر**، مرز آستانه و اجرای دوباره، خاموش/آستانه‌ی دورتر ⇒ چیزی نمی‌رود و روشن‌شدن با `wrapJob`، rollback تراکنش با id تکراری + سلامت batch قبلی + ورودی نامعتبر، ۲۵۰۰ رکورد با ۳ batch، و API `include_archive` برای JSON/CSV/۴۰۰/۴۰۳)؛ تست dry-run در `auditArchiveJob.test.js` فقط برای حالت خاموش به‌روز شد. `npm test`: ۲۶۴ سبز.

### S2-6b — Job ماهانه‌ی آرشیو audit (فقط dry-run)
- **`src/bot/scheduler/auditArchive.js`**: `runAuditArchive()` تعداد رکوردهای `audit_log` را که **قدیمی‌تر از `auditRetentionMonths` ماه** (پیش‌فرض ۲۴) هستند می‌شمارد (به‌همراه قدیمی‌ترین/جدیدترین تاریخ آن‌ها) و یک خط لاگ می‌نویسد: تعداد، آستانه‌ی UTC، مقدار نگهداری و روشن/خاموش‌بودن آرشیو. **فقط SELECT** است: هیچ رکوردی منتقل/حذف/ویرایش نمی‌شود و `audit_log_archive` خالی می‌ماند، چه `auditArchiveEnabled` خاموش باشد چه روشن (روشن‌بودن فعلاً فقط در لاگ گزارش می‌شود؛ انتقال واقعی در S2-6c). مرز «قدیمی‌تر از» باز است (رکوردِ دقیقاً روی آستانه شمرده نمی‌شود).
- **آستانه** (`cutoffFor`): ماه‌ها از «الان» کم می‌شود و اگر روز در ماه مقصد نبود به آخر همان ماه می‌رود (۳۱ مارس − ۱ ماه = ۲۸/۲۹ فوریه)؛ قالب `YYYY-MM-DD HH:MM:SS` به وقت **UTC** مثل `occurred_at` که با `datetime('now')` ذخیره می‌شود، و مقایسه‌ی متنی مستقیم تا `idx_audit_occurred` (migration 007) استفاده شود.
- **repository**: `auditRepository.summarizeOlderThan(cutoff)` (فقط‌خواندنی؛ قالب `cutoff` اعتبارسنجی می‌شود).
- **زمان‌بندی**: کلید جدید `config.cron.auditArchive` (env `CRON_AUDIT_ARCHIVE`، پیش‌فرض `0 3 1 * *` یعنی روز اول هر ماه میلادی ۰۳:۰۰، بعد از بک‌آپ ۰۲:۳۰ و خارج از ساعت کاری) در `scheduler/index.js` با `wrapJob('auditArchive', …)` و `cron.validate` ثبت می‌شود (cron نامعتبر ⇒ فقط لاگ خطا و Job فعال نمی‌شود). اجرا و خطایش مثل بقیه‌ی Jobها در `job_runs` و صفحه‌ی «وضعیت سیستم» دیده می‌شود. در `.env.example` مستند شد.
- بدون migration، بدون API/UI جدید، بدون وابستگی جدید.
- تست: `test/auditArchiveJob.test.js` (۴ تست: محاسبه‌ی آستانه و clamp ماه/کبیسه، dry-run روی تاریخ‌های ساختگی با مرز و حالت خاموش/روشن و «audit_log دست‌نخورده و آرشیو خالی»، خواندن نگهداری از تنظیمات و مقدار خراب، `wrapJob` موفق/خطا و ثبت cron). `npm test`: ۲۵۸ سبز.

### S2-6a — ساختار آرشیو audit و تنظیمات آن (فقط ساختار؛ بدون Job)
- **migration `007_audit_archive`**: جدول `audit_log_archive` با **همان ستون‌های `audit_log`** (`id, user_id, action, occurred_at, ip_address, details`). `id` عمداً `AUTOINCREMENT` نیست (در S2-6c همان id اصلی کپی می‌شود) و `occurred_at` پیش‌فرض ندارد (زمان رویداد اصلی می‌ماند، نه زمان انتقال). ایندکس‌ها: `idx_audit_archive_occurred`, `idx_audit_archive_user` روی آرشیو، و `idx_audit_occurred` روی خود `audit_log` تا شمارش/انتقال «قدیمی‌تر از آستانه» در S2-6b/6c اسکن کامل جدول نباشد. هیچ داده‌ی موجودی تغییر نمی‌کند؛ پیش از اعمال، migrator طبق معمول بک‌آپ `pre-migration-*` می‌گیرد.
- **تنظیمات** (جدول `settings`، از همان `GET/PATCH /api/admin/settings` فقط‌ادمین و با audit `settings_updated`): `auditRetentionMonths` (کلید `audit_retention_months`، عدد صحیح ۱ تا ۲۴۰، **پیش‌فرض ۲۴**) و `auditArchiveEnabled` (کلید `audit_archive_enabled`، بولی، **پیش‌فرض خاموش**). مقدار نامعتبر/خارج از بازه هنگام ذخیره نادیده گرفته می‌شود و اگر مقدار خراب در DB باشد پیش‌فرض برمی‌گردد (هرگز NaN). `settingsRepository.getAuditRetentionMonths()` و `isAuditArchiveEnabled()` برای Jobهای بعدی (نبودن/خرابی ⇒ ۲۴ و خاموش). تنظیم‌های قبلی بدون تغییر؛ فیلدی در فرم پنل ندارد (UI تنظیمات در S3-9).
- **`usersRepository.deleteUserPermanently`**: چون آرشیو هم به `users` ارجاع (FK) دارد، علاوه بر `audit_log` ردیف‌های `audit_log_archive` هم با `user_id = NULL` از کاربر جدا می‌شوند (بدون این، حذف کاربری که ردیف آرشیو دارد با خطای FK شکست می‌خورد). رفتار فعلی (حذف نشدن ردیف‌های audit) حفظ شده.
- **هنوز هیچ Job یا انتقالی نیست**: روشن‌کردن `auditArchiveEnabled` فعلاً هیچ اثری ندارد (Job در S2-6b با dry-run، انتقال واقعی در S2-6c).
- تست: `test/auditArchive.test.js` (۴ تست: ساختار/ستون‌ها/ایندکس/idempotent، تنظیمات و اعتبارسنجی و «چیزی منتقل نمی‌شود»، حذف دائمی کاربر با ردیف آرشیو، API تنظیمات با ادمین/سرپرست) و `test/migrations.test.js` برای migration هفتم به‌روز شد. `npm test`: ۲۵۴ سبز.

### S2-5b — صفحه‌ی پنل «موارد مشکوک» + یادآوری در مرور شبانه
- **پنل** (`public-admin/js/views-ops.js`، view با شناسه‌ی `suspicious`، گروه «کارمندان و تردد»): فهرست نشانه‌ها با فیلتر وضعیت (بررسی‌نشده | بررسی‌شده | بی‌اهمیت | همه)، نوع قاعده به فارسی، کاربران درگیر (لینک به پروفایل)، رکوردهای مرتبط (باز شدن همان modal رکورد)، توضیح خوانایی از `details` و دکمه‌های «بررسی شد» / «بی‌اهمیت» (و تغییر وضعیت برای موارد بسته) که از `AP.askReason` **دلیل اجباری** می‌گیرند و به `POST /admin/suspicious/:id/review` (S2-5a) می‌روند. متن‌ها «نشانه» می‌گویند نه «اتهام»؛ بالای صفحه هم یادآوری شده که `device_id` قابل جعل/پاک‌شدن است. شناسه‌ی دستگاه فقط ۸ نویسه‌ی اول نمایش داده می‌شود و همه‌ی مقدارها `esc` می‌شوند. صفحه `employee:true`/`admin:true` ندارد: **ادمین و سرپرست** می‌بینند، کارمند نه (در نوار کناری نیست و روتر او را به خانه برمی‌گرداند؛ سرور هم ۴۰۳ می‌دهد).
- **شمارنده‌ی ناوبری** (`core.js` ← `refreshCounts`): تعداد نشانه‌های بررسی‌نشده فقط برای سرپرست/ادمین گرفته می‌شود؛ شکست آن شمارنده‌های مرخصی/اعتراض را خراب نمی‌کند (کارمند اصلاً صدا نمی‌زند چون ۴۰۳ می‌گیرد).
- **مرور شبانه‌ی تلگرام** (`nightlyReview.js`): اگر تیم سرپرست نشانه‌ی بازِ بررسی‌نشده داشته باشد (همان اسکوپ API: همه‌ی کاربران مورد در تیمش)، خط «🔎 N نشانه‌ی بررسی‌نشده … (فقط نشانه، نه اتهام) → پنل ‹ موارد مشکوک» اضافه می‌شود. شمارش ضدخطاست (خرابی ⇒ بدون خط، پیام همچنان می‌رود). ادمین کل مرور شبانه نمی‌گیرد، پس تغییری برایش نیست.
- **مستند**: `docs/SUSPICIOUS_EVENTS.md` (معنی هر قاعده، علت‌های بی‌گناه، محدودیت‌های `device_id` شامل جعل، پاک‌شدن، CloudStorage مشترک، IP مشترک، و جریان بررسی).
- بدون migration، بدون تغییر API/route، بدون وابستگی جدید. ⚠️ دلیل بررسی فقط در audit است و در کارت نمایش داده نمی‌شود (کارت فقط «چه کسی و کِی» را نشان می‌دهد)؛ اگر خواستید کنار کارت دیده شود، یک migration (ستون دلیل) در بخش بعد لازم است.
- تست: `test/suspiciousPanel.test.js` (۴ تست: شمارش و اسکوپ مرور شبانه، تحمل خرابی، رندر واقعی view با AP ساختگی شامل escape و لیبل‌ها، حالت خالی/بسته). تست مرورگر واقعی انجام نشده (فهرست تست دستی در گزارش). `npm test`: ۲۵۰ سبز.

### S2-5a — API موارد مشکوک (فقط API؛ UI در S2-5b)
- **`GET /api/admin/suspicious`**: فهرست موارد با فیلتر `status` (`open|reviewed|ignored`)، `from`/`to` (روی `event_date`، `YYYY-MM-DD`) و `limit` (پیش‌فرض ۲۰۰، حداکثر ۵۰۰)، مرتب از جدیدترین تاریخ. مقدار نامعتبر برای فیلترها ⇒ `400` (بی‌صدا نادیده گرفته نمی‌شود). هر مورد: `id, eventType, eventDate, status, details, recordIds, users[] (userBrief), reviewedBy, reviewedAt, createdAt`.
- **`POST /api/admin/suspicious/:id/review`** با بدنه‌ی `{ reason (اجباری), status: 'reviewed'|'ignored' (پیش‌فرض reviewed) }`: وضعیت و `reviewed_by/reviewed_at` را ثبت می‌کند و در `audit_log` رویداد `suspicious_reviewed` (با `eventId, eventType, eventDate, targetUserIds, previousStatus, newStatus, reason`) می‌نویسد. بدون دلیل یا وضعیت نامعتبر ⇒ `400`؛ همان وضعیتِ فعلی ⇒ `409`؛ ناموجود ⇒ `404`؛ خارج از اسکوپ ⇒ `403`. هدر CSRF (`X-Requested-With`) مثل بقیه‌ی routeهای نوشتنی لازم است.
- **اسکوپ**: admin همه؛ manager فقط مواردی که **همه‌ی** `user_ids` آن‌ها در تیمش‌اند (مورد مشترک با کاربر تیم دیگر برای او نه دیده می‌شود نه قابل بررسی است)؛ employee ممنوع — هم با لیست سفید `requireAdminAuth` (route در `EMPLOYEE_ALLOWED` نیامده) و هم با `requireStaff` روی خود route.
- **repository**: `suspiciousRepository.list({status, from, to, limit})` و `markReviewed(id, {status, reviewedBy})` (SQL فقط آنجا). بدون migration؛ جدول ستونِ «دلیل» ندارد، پس دلیل فقط در audit نگه‌داری می‌شود (برای نمایش در پنل S2-5b یا از audit خوانده شود یا ستون جدا با migration بعدی).
- ⚠️ هر مورد «نشانه» است نه اتهام. اسکوپ سرپرست پس از خواندن اعمال می‌شود (`user_ids` داخل JSON است)، برای حجم فعلی مشکلی ندارد. بازکردن دوباره‌ی مورد (`reviewed → open`) عمداً در این بخش نیست.
- تست: `test/suspiciousApi.test.js` (۴ تست HTTP واقعی: فهرست/اسکوپ/فیلتر، ثبت بررسی + audit + ۴۰۹، اسکوپ و ۴۰۳/۴۰۴/۴۰۰ ثبت بررسی، کارمند/بدون سشن/بدون CSRF) و ماتریس‌های `routesAccess.test.js` و `adminAccess.test.js` با مسیرهای جدید به‌روز شدند. `npm test`: ۲۴۶ سبز.

### S2-4e-3 — بلوک اختیاری device مشترک (پیش‌فرض خاموش) — پایان S2-4e
- **تنظیم `blockOnSharedDevice`** (کلید DB: `block_on_shared_device`، بولی، **پیش‌فرض خاموش**): در `settingsRepository` اضافه شد؛ از همان `GET/PATCH /api/admin/settings` (فقط ادمین کل، با audit `settings_updated`) خوانده/عوض می‌شود و مقدار نامعتبر نادیده گرفته می‌شود. ۵ تنظیم قبلی بدون تغییر. فیلدی در فرم پنل ندارد (رجیستری تنظیمات در S3-1؛ UI در S2-5b).
- **`fraudRunner.evaluateSharedDeviceBlock({ userId, deviceId, date })`**: وقتی تنظیم روشن است همان قاعده‌ی خالص الف را روی ردیف‌های امروز + ثبتِ فرضیِ همین درخواست اجرا می‌کند؛ **فقط قاعده‌ی الف** مسدود می‌کند (ب و ج هرگز). بدون device معتبر ⇒ هرگز مسدود نمی‌شود. **fail-open**: هر خطا (قاعده، تنظیم، DB) ⇒ `blocked:false` و ثبت ادامه می‌یابد.
- **`/miniapp/check-in` و `/check-out`**: بعد از اعتبارسنجی‌های قبلی و **قبل از نوشتن رکورد**، اگر مسدود شود پاسخ `403 { code: 'shared_device_blocked', error }` با پیام غیرتوهین‌آمیز برمی‌گردد، رکوردی ساخته/تغییر نمی‌کند، در `audit_log` رویداد `check_in_blocked`/`check_out_blocked` (با `otherUserIds` و `deviceId`) ثبت می‌شود و یک مورد `shared_device` با `details.blocked=true` در suspicious_events می‌نشیند (dedupe طبق معمول).
- ⚠️ خروجِ مسدودشده (کاربری که با device کاربر دیگر خروج بزند) رکورد بدون خروج می‌ماند؛ با دستگاه خودش دوباره می‌تواند خروج بزند، وگرنه `autoCloseIncomplete`/اصلاح دستی ادمین. چون `device_id` در localStorage ساخته می‌شود و قابل جعل/پاک‌شدن است، روشن‌کردن بلوک فقط با آگاهی از این محدودیت توصیه می‌شود؛ پیش‌فرض خاموش مانده.
- تست: `test/fraudBlock.test.js` (۴ تست: تنظیم و پیش‌فرض، خاموش ⇒ فقط نشانه، روشن ⇒ ورود/خروج/audit/نشانه و استثناها، فقط الف + fail-open). `npm test`: ۲۴۲ سبز.

### S2-4e-2 — اتصال تشخیص به ثبت ورود/خروج و nightlyReview (بدون block)
- **`fraudRunner.runFraudChecksSafe(options)`**: پوششِ ضدخطای `runFraudChecks`؛ حتی اگر خودِ runner استثنا بدهد فقط لاگ می‌شود و `{ ok:false, errors }` برمی‌گردد.
- **`/api/miniapp/check-in` و `/check-out`**: بعد از ثبت، audit و **ارسال پاسخ**، `runFraudChecksSafe({ date })` برای روز همان رکورد اجرا می‌شود؛ پس هیچ تأخیر یا تغییری در پاسخ/ثبت ایجاد نمی‌کند و خطای تشخیص هرگز ثبت را نمی‌شکند. بات و ثبت دستی ادمین از این مسیر نمی‌گذرند (device ندارند) و در جاروی شبانه پوشش داده می‌شوند.
- **`sendNightlyReview`**: ابتدای Job (داخل `wrapJob('nightlyReview')` موجود) یک جارو با `runFraudChecksSafe({ date: امروز })` اجرا می‌شود؛ شکستش ارسال مرور شبانه را مختل نمی‌کند. هنوز به سرپرست چیزی درباره‌ی موارد مشکوک گفته نمی‌شود (S2-5b).
- بدون migration، بدون کلید config جدید، بدون block (S2-4e-3). ⚠️ تشخیص روی هر ثبت کل روزِ جاری را دوباره می‌سنجد (dedupe از تکرار جلوگیری می‌کند)؛ برای اندازه‌ی فعلی شرکت ارزان است ولی اگر تعداد کاربر خیلی زیاد شد باید به ارزیابیِ فقط‌همان‌رکورد تبدیل شود.
- تست: `test/fraudWiring.test.js` (۴ تست HTTP/واقعی: ورود، خروج، خرابی عمدیِ قاعده/ثبت/runner با موفقیت ثبت‌ها، nightlyReview). `npm test`: ۲۳۸ سبز.

### S2-4e-1 — اجراکننده‌ی قاعده‌ها (هسته‌ی S2-4e؛ هنوز وصل نشده)
- S2-4e به سه بخش شکسته شد: **۱** اجراکننده‌ی قاعده‌ها و ثبت نتیجه (این بخش)، **۲** اتصال به ثبت ورود/خروج و nightlyReview با تضمین «خطا ثبت را نمی‌شکند»، **۳** تنظیم `block_on_shared_device` (پیش‌فرض خاموش؛ روشن ⇒ فقط قاعده‌ی الف مسدود کند + audit).
- **`src/utils/fraudRunner.js`**: `runFraudChecks({ date })` (پیش‌فرض: امروزِ سرور) ردیف‌های بازه‌ی `[date − lookbackDays, date]` را می‌خواند؛ قاعده‌ی الف و ب فقط روی ردیف‌های همان روز و قاعده‌ی ج روی کل بازه (با `targetDate`) اجرا می‌شود؛ آستانه‌ها از `config.fraud` (بدون کلید جدید). نتیجه با `suspiciousRepository.create` ثبت می‌شود (dedupe: اجرای دوباره‌ی همان روز مورد تکراری نمی‌سازد). خروجی: `{ ok, date, scanned, found, created[], duplicates, errors[] }`.
- **هرگز استثنا نمی‌دهد**: خطای بارگذاری، هر قاعده و ثبت هر مورد جدا گرفته و در `errors` (با `stage`) گزارش و در لاگ چاپ می‌شود؛ خرابی یک قاعده جلوی بقیه را نمی‌گیرد. ورودی نامعتبر (`date`) ⇒ `ok:false` بدون تغییر DB.
- **`attendanceRepository.listForFraud(from, to)`**: خواندنی؛ فقط ستون‌های id/user/تاریخ/زمان/IP/device ورود و خروج. بدون migration و بدون تغییر رفتار موجود.
- هنوز از هیچ مسیر ثبت تردد یا Job صدا زده نمی‌شود (S2-4e-2). ⚠️ اگر در یک روز کاربر سومی به یک device/IP مشترک اضافه شود، چون dedupe روی «مجموعه‌ی کاربران» است، یک مورد جدید (جدا از قبلی) ساخته می‌شود. خروجی فقط «نشانه» است نه مدرک.
- تست: `test/fraudRunner.test.js` (۴ تست: سه قاعده + dedupe، دامنه‌ی تاریخ و N از config، تحمل خطا در قاعده/ثبت/بارگذاری، ورودی نامعتبر). `npm test`: ۲۳۴ سبز.

### S2-4d — قاعده‌ی ج: تغییر ناگهانی دستگاه (تابع خالص)
- **`src/utils/fraudDetection.js`**: `detectDeviceChange(records, { lookbackDays, minHistoryDays, targetDate })` روی ردیف‌های `attendance_records` (`id, user_id, record_date, check_in_device, check_out_device`) کار می‌کند. برای هر کاربر و هر روز، «الگو» اجتماع `device_id`های معتبرِ او در `lookbackDays` روز تقویمیِ قبل است؛ اگر الگو حداقل `minHistoryDays` روزِ دارای device داشته باشد و در آن روز هیچ‌کدام از deviceهای کاربر در الگو نباشد، یک کاندیدای رویداد با نوع `device_change` و شکل ورودی `suspiciousRepository.create` برمی‌گرداند (`userIds` تک‌نفره، `details: {rule:'C', newDevices, baselineDevices, historyDays, lookbackDays, minHistoryDays}`).
- **رفتار**: استفاده‌ی همزمان از device قدیمی و جدید در همان روز نشانه نیست؛ فقط «اولین روزِ تغییر» گزارش می‌شود (روز بعد device جدید جزو الگو است)؛ ردیف بدون device (بات، ثبت دستی، کلاینت قدیمی) نه تاریخچه حساب می‌شود نه نشانه می‌سازد؛ کاربر تازه‌وارد یا با تاریخچه‌ی کم نشانه نمی‌گیرد. `targetDate` (اختیاری) فقط همان روز را ارزیابی می‌کند تا S2-4e بتواند هنگام ثبت/nightlyReview فقط امروز را بسنجد؛ فراخواننده باید ردیف‌های `lookbackDays` روز قبل را هم بدهد.
- **آستانه‌ها قابل‌تنظیم**: `config.fraud.deviceChangeLookbackDays` (env `FRAUD_DEVICE_CHANGE_LOOKBACK_DAYS`، پیش‌فرض ۷) و `config.fraud.deviceChangeMinHistoryDays` (env `FRAUD_DEVICE_CHANGE_MIN_HISTORY_DAYS`، پیش‌فرض ۳)، مقدار نامعتبر ⇒ پیش‌فرض؛ در `.env.example` آمده. خود تابع config را import نمی‌کند (خالص می‌ماند) و هنوز به جدول `settings`/پنل وصل نشده است.
- هنوز جایی صدا زده نمی‌شود و چیزی ثبت نمی‌کند (اتصال در S2-4e). ⚠️ `device_id` در localStorage ساخته می‌شود؛ پاک‌شدن داده‌ی مرورگر/تلگرام، تعویض گوشی یا نصب مجدد یک نشانه‌ی کاذبِ بی‌گناه می‌سازد، و از آن طرف قابل جعل است. خروجی فقط «نشانه» است نه مدرک.
- تست: `test/fraudDeviceChange.test.js` (۴ تست: مثبت، منفی، آستانه/مرز/targetDate/گزینه‌ی نامعتبر، ورودی خراب/عدم تغییر ورودی/ترتیب قطعی).

### S2-4c — قاعده‌ی ب: یک IP و فاصله‌ی کم (تابع خالص)
- **`src/utils/fraudDetection.js`**: `detectSameIpClose(records, { windowSeconds })` روی ردیف‌های `attendance_records` (`id, user_id, record_date, check_in_time, check_in_ip, check_out_time, check_out_ip`) کار می‌کند. اگر دو کاربر **متفاوت** در یک روز با یک IP ثبت (ورود یا خروج، هر ترکیبی) با فاصله‌ی **کمتر از N ثانیه** داشته باشند، یک کاندیدای رویداد با نوع `same_ip_close` و شکل ورودی `suspiciousRepository.create` برمی‌گرداند (`details: {rule:'B', ip, windowSeconds, minGapSeconds, userCount}`). فاصله‌ی دقیقاً برابر N نشانه نمی‌سازد (مرز باز). ثبت‌های نزدیکِ زنجیره‌ای (A-B و B-C) در یک رویداد جمع می‌شوند.
- **N قابل‌تنظیم**: `config.fraud.sameIpWindowSeconds` از env `FRAUD_SAME_IP_WINDOW_SECONDS` (پیش‌فرض ۶۰؛ مقدار نامعتبر/غیرمثبت ⇒ پیش‌فرض) و در `.env.example` آمده. خود تابع config را import نمی‌کند (خالص می‌ماند)؛ فراخواننده (S2-4e) مقدار را به `options.windowSeconds` می‌دهد و اگر ندهد ۶۰ است. هنوز به جدول `settings`/پنل وصل نشده است.
- IP با حذف فاصله و پیشوند `::ffff:` نرمال می‌شود. تابع خالص است (بدون DB/زمان سیستم، ورودی را تغییر نمی‌دهد، خروجی قطعی و مرتب)، ورودی خراب ⇒ `[]`، ثبت بدون IP/زمان معتبر نادیده گرفته می‌شود، و چند ثبت پشت‌سرهم از یک کاربر هرگز نشانه نمی‌سازد.
- هنوز جایی صدا زده نمی‌شود و چیزی ثبت نمی‌کند (اتصال در S2-4e). ⚠️ فرض: هر دستگاه در شبکه‌ی داخلی IP جدا دارد (سرور محلی بدون reverse proxy)؛ پشت NAT/هات‌اسپات مشترک یا DHCP که IP را سریع به دستگاه دیگر بدهد، نشانه‌ی کاذب ممکن است. خروجی فقط «نشانه» است نه مدرک.
- تست: `test/fraudSameIp.test.js` (۴ تست: مثبت، منفی، مرز و N سفارشی، ورودی خراب/عدم تغییر ورودی/ترتیب قطعی).

### S2-4b — قاعده‌ی الف: یک device برای دو کاربر در یک روز (تابع خالص)
- **`src/utils/fraudDetection.js`**: `detectSharedDevice(records)` روی ردیف‌های `attendance_records` (`id, user_id, record_date, check_in_device, check_out_device`) کار می‌کند؛ هر دو device ورود و خروج بررسی می‌شود. اگر یک `device_id` معتبر در یک روز برای ≥۲ کاربر متفاوت دیده شود، یک کاندیدای رویداد با نوع `shared_device` و همان شکل ورودی `suspiciousRepository.create` برمی‌گرداند (`details: {rule:'A', deviceId, userCount}`). تابع خالص است (بدون DB/زمان، ورودی را تغییر نمی‌دهد، خروجی قطعی و مرتب)، ورودی خراب ⇒ `[]`، و device خالی/نامعتبر (بات، ثبت دستی) هرگز نشانه نمی‌سازد.
- هنوز جایی صدا زده نمی‌شود و چیزی ثبت نمی‌کند (اتصال و block اختیاری در S2-4e). ⚠️ `device_id` قابل جعل است؛ خروجی فقط «نشانه» است.
- تست: `test/fraudSharedDevice.test.js` (۶ تست: مثبت ساده، مثبت ورود/خروج و سه کاربر، منفی یک کاربر، منفی deviceهای متفاوت/روز متفاوت، منفی device نامعتبر/خالی، ورودی خراب و عدم تغییر ورودی).

### S2-4a — جدول suspicious_events و ثبت‌کننده (فقط ساختار؛ بدون قاعده‌ی تشخیص)
- **migration `006_suspicious_events`**: جدول `suspicious_events` (`id, event_type, user_ids JSON, record_ids JSON, event_date, details JSON, status open|reviewed|ignored, reviewed_by, reviewed_at, created_at`) با ایندکس یکتای `(event_type, user_ids, event_date)` برای dedupe و ایندکس `(status, event_date)`. پیش از اعمال، migrator طبق معمول بک‌آپ `pre-migration-*` می‌گیرد.
- **`src/repositories/suspiciousRepository.js`**: `create({eventType, userIds, recordIds, eventDate, details})` ⇒ `{created, event}`؛ `userIds`/`recordIds` قبل از درج مرتب و یکتا می‌شوند (ترتیب ورودی روی تکراری‌بودن اثر ندارد)؛ مورد تکراری بازنویسی نمی‌شود و رکورد قبلی با `created:false` برمی‌گردد؛ ورودی نامعتبر خطا می‌دهد. `getById` هم هست. هنوز هیچ کدی این را صدا نمی‌زند (اتصال در S2-4e).
- تست: `test/suspiciousEvents.test.js` (۵ تست: ساخت و نرمال‌سازی، dedupe با ترتیب متفاوت، موارد متمایز، ورودی نامعتبر، CHECK وضعیت). `test/migrations.test.js` برای migration ششم به‌روز شد (جدول جدید جزو جدول‌های «عملیاتی» مقایسه‌ی داده). `npm test`: ۲۱۶ سبز.

### S2-3 — ثبت device_id (فقط جمع‌آوری، بدون قاعده‌ی تشخیص)
- **migration `005_attendance_devices`**: چهار ستون nullable روی `attendance_records`: `check_in_device`, `check_out_device`, `check_in_ua`, `check_out_ua` (idempotent؛ رکوردهای قدیمی، بات و ثبت دستی ادمین `NULL` می‌مانند). پیش از اعمال، migrator طبق معمول بک‌آپ `pre-migration-*` می‌گیرد.
- **Mini App** (`public/js/app.js`): یک `device_id` تصادفی پایدار (`crypto.randomUUID`، با fallback) در `localStorage` نگه داشته می‌شود و فقط همراه `/check-in` و `/check-out` به‌صورت `body.deviceId` می‌رود. اگر تلگرام `CloudStorage` داشت، پشتیبان آن است: وقتی `localStorage` خالی بود از ابر خوانده می‌شود و شناسه‌ی موجود در ابر هرگز بازنویسی نمی‌شود (انتظار حداکثر ۱٫۵ ثانیه، سپس بدون ابر ادامه می‌دهد). هر خطای ذخیره‌سازی نادیده گرفته می‌شود و ورود/خروج بدون device هم کار می‌کند.
- **سرور** (`src/utils/deviceInfo.js`، `miniapp.js`، `attendanceRepository.js`): `deviceId` فقط با فرمت `[A-Za-z0-9_-]{16,64}` پذیرفته می‌شود وگرنه نادیده گرفته می‌شود (`NULL`)؛ UA از هدر واقعی درخواست، با حذف نویسه‌های کنترلی و کوتاه‌شده به ۲۰۰ نویسه. `extractDeviceInfo` هرگز استثنا نمی‌دهد؛ زمان، IP و وضعیت ثبت مثل قبل فقط از سرور می‌آیند و device روی موفقیت/رد ثبت اثری ندارد.
- ⚠️ `device_id` سمت کلاینت ساخته می‌شود و **قابل جعل** است؛ فقط «نشانه» برای S2-4 است، نه مدرک. ⚠️ `CloudStorage` تلگرام بین دستگاه‌های یک حساب مشترک است؛ اگر بعداً قاعده‌ی «تغییر ناگهانی دستگاه» (S2-4d) روی چند دستگاه یک کاربر کم‌دقت بود، پشتیبان‌گیری ابری را خاموش کنید (`cloudAvailable()` در `app.js`).
- ستون‌های جدید در پاسخ‌هایی که `SELECT *` از `attendance_records` برمی‌گردانند (مثل `/api/miniapp/today` و جست‌وجوی رکوردهای پنل) هم دیده می‌شوند؛ CSVها ستون‌هایشان را صریح انتخاب می‌کنند و تغییری نکرده‌اند.
- تست: `test/deviceId.test.js` (۱۲ تست: فرمت معتبر/نامعتبر، UA، `extractDeviceInfo` با ورودی خراب، ستون‌های migration و اجرای دوباره، NULL برای مسیرهای بدون device، و HTTP واقعی ورود/خروج با device معتبر، نبودن device، فرمت‌های خراب، UA بلند، بی‌اثر بودن روی زمان/ورود تکراری، دو کاربر روی یک device). `test/migrations.test.js` برای migration پنجم به‌روز شد. `npm test`: ۲۱۱ سبز.

### S2-2b — مستند بازیابی و پاک‌سازی فایل قدیمی
- `docs/BACKUP_RESTORE.md` (فقط مستند، بدون تغییر کد): انواع فایل `data/backups/` (daily/monthly/pre-migration/pre-restore/.suspect/.partial)، تفاوت daily با pre-migration، مراحل `nssm stop` ← فهرست ← `--dry-run` ← restore ← `nssm start` ← تأیید، کدهای خروج، تمرین بازیابی روی کپی، و نکته‌ی نگهداری بیرونی.
- `data/attendance.backup.db` (قدیمی، خارج از چرخه‌ی بک‌آپ، هیچ کدی به آن ارجاع نمی‌دهد؛ با `data/*.db` در `.gitignore` و هرگز در git نبوده): صاحب پروژه دستی پاک کند و در zip تحویلی هم نگذارد.
- ⚠️ یادداشت: migrator فقط ۱۰ فایل `pre-migration-*` آخر را نگه می‌دارد (مستند شد)، در حالی‌که retention روزانه به آن‌ها دست نمی‌زند.

### S2-2a — اسکریپت بازیابی (restore)
- `scripts/restore-backup.js` (بدون وابستگی جدید، بدون migration): بدون آرگومان فهرست بک‌آپ‌ها؛ `node scripts/restore-backup.js <نام یا مسیر> [--dry-run] [--dir …] [--db …]`. فقط `.db` منتشرشده فهرست/پذیرفته می‌شود (`.suspect` و `.partial` رد می‌شوند).
- ترتیب ایمن: (۱) **تشخیص سرویس روشن** با گرفتن قفل انحصاری روی دیتابیس (اتصال باز ⇒ `SQLITE_BUSY` ⇒ خروج با کد ۳ و پیام `nssm stop`) (۲) کپی بک‌آپ به فایل موقت کنار دیتابیس + `integrity_check` + بررسی وجود جدول‌های `users`/`schema_migrations` (۳) اسنپ‌شات وضعیت فعلی در `BACKUP_DIR/pre-restore-YYYYMMDD-HHmmss.db` (با `db.backup()`؛ اگر دیتابیس فعلی خراب باشد کپی خام فایل‌ها + هشدار) (۴) `rename` اتمیک روی دیتابیس و **حذف `-wal/-shm` قدیمی** (وگرنه WAL قدیمی روی دیتابیس بازیابی‌شده اعمال می‌شد) (۵) `integrity_check` نهایی. شکست در مراحل ۱–۳ ⇒ دیتابیس فعلی بایت‌به‌بایت دست‌نخورده. `--dry-run` همه‌ی بررسی‌ها را انجام می‌دهد ولی هیچ فایلی را عوض نمی‌کند.
- کد خروج: ۰ موفق، ۱ خطا/فایل نامعتبر، ۲ آرگومان نادرست، ۳ سرویس روشن.
- `systemHealth.latestBackup` فایل‌های `pre-restore-*` را (مثل `pre-migration-*`) «آخرین بک‌آپ» حساب نمی‌کند. retention از قبل به آن‌ها دست نمی‌زد.
- تست: `test/restore.test.js` (۴ تست: سرویس روشن، dry-run + restore واقعی با pre-restore، بک‌آپ خراب/بی‌ربط/.suspect، CLI) و یک assert در `test/monitoring.test.js`. مستند کامل (مراحل nssm) در S2-2b.

### S2-1c (قسمت ۲ از ۲) — هشدار watchdog، سلامت و پیش‌فرض MONITOR_BACKUP_CHECK
- **هشدار جدید `backup_suspect`** (`watchdog.js`): وقتی فایل `daily-….db.suspect` **جدیدتر از آخرین بک‌آپ سالم** وجود دارد، به ادمین‌های فعال پیام تلگرام می‌رود (نام فایل `.suspect` + آخرین بک‌آپ سالم و سن آن). تکرار: هر ۲۴ ساعت (مثل `job_failed`، چون Job بک‌آپ روزی یک‌بار اجرا می‌شود). با اولین بک‌آپ سالمِ بعدی خودکار «✅ رفع شد» می‌شود؛ خودِ فایل `.suspect` پاک نمی‌شود. هشدار `backup_stale` فقط وقتی می‌آید که بک‌آپ سالم واقعاً قدیمی/ناموجود باشد (نه به‌خاطر `.suspect`).
- **`systemHealth.checks.backup`**: `lastBackupAt/lastBackupFile` = آخرین بک‌آپ **سالم** (`.suspect`/`.partial`/`pre-migration-*` حساب نمی‌شوند)؛ فیلد جدید `suspect` (`{file, at}` یا `null`) و `stale`؛ `ok=false` اگر `.suspect` حل‌نشده یا بک‌آپ قدیمی باشد. تابع جدید `latestSuspect()`. در صفحه‌ی «وضعیت سیستم» پنل ردیف «فایل بک‌آپ مشکوک» اضافه شد.
- ⚠️ **`MONITOR_BACKUP_CHECK` اکنون پیش‌فرض `true` است** (`config.js` و `.env.example`؛ فقط مقدار دقیق `false` خاموشش می‌کند). پیامد: تا وقتی اولین بک‌آپ روزانه ساخته نشده، `/api/health` برابر `degraded` و هشدار «هیچ بک‌آپ سالمی پیدا نشد» می‌آید ⇒ بعد از استقرار یک‌بار بک‌آپ را اجرا کنید (یا ۰۲:۳۰ صبر کنید). فایل `.env` واقعی این مقدار را نداشت، پس پیش‌فرض جدید اعمال می‌شود.
- بدون migration، بدون وابستگی جدید. `test/monitoring.test.js`: بررسی بک‌آپ در سطح فایل خاموش شد (تست‌های خودِ بک‌آپ آن را صریح روشن می‌کنند).
- تست (`test/backup.test.js`، ۵ تست جدید): پیش‌فرض config (true/true/false)، `systemHealth` با `.suspect` جدیدتر/قدیمی‌تر/بررسی خاموش، **سناریوی کامل با bot ماک** (بک‌آپ خرابِ عمدی از مسیر `wrapJob`+`runDailyBackup` ⇒ هشدار به ادمین ⇒ عدم تکرار ⇒ بک‌آپ سالم بعدی ⇒ رفع شد)، خاموش‌بودن هشدار با `MONITOR_BACKUP_CHECK=false` و نبودن توکن در متن. `npm test`: ۱۹۵ سبز.
- مستند: `docs/MONITORING.md` (نوع هشدار جدید، بخش «بک‌آپ سالم و فایل‌های .suspect»).

### S2-1c (قسمت ۱ از ۲) — تأیید سلامت فایل بک‌آپ
- `runDailyBackup` بعد از `db.backup()` و **قبل از** rename به نام نهایی، `PRAGMA integrity_check` کامل را روی همان فایل بک‌آپ اجرا می‌کند (`monitorRepository.integrityCheckFile`، اتصال جدا و فقط‌خواندنی؛ فایل خراب/غیر SQLite استثنا نمی‌دهد، نتیجه‌ی «ناسالم» می‌گیرد).
- شکست ⇒ فایل به `daily-YYYYMMDD-HHmm.db.suspect` منتقل می‌شود (بک‌آپ سالمِ هم‌نام بازنویسی نمی‌شود چون چک قبل از rename است)، کپی ماهانه و پاک‌سازی retention **اجرا نمی‌شود**، و Job با پیام شامل نتیجه‌ی integrity خطا می‌دهد ⇒ `wrapJob` آن را در `job_runs` با `status=error` ثبت می‌کند. موفق ⇒ `integrity: 'ok'` در خروجی و `status=success`. بدون migration جدید (ستون `error` موجود کافی است).
- فایل‌های جانبی `-wal/-shm` که باز کردن فقط‌خواندنیِ فایل بک‌آپ (هدر WAL) باقی می‌گذارد، فقط برای فایل موقت Job پاک می‌شوند.
- فایل‌های `.suspect` توسط retention دست‌نخورده می‌مانند (پاک‌کردنشان دستی است).
- تست: چهار تست جدید در `test/backup.test.js` (سالم، خرابیِ وسط فایل، فایل غیر SQLite + عدم بازنویسی/عدم retention، ثبت در job_runs). `npm test`: ۱۹۰ سبز.
- ✅ هشدار اختصاصی `.suspect`، `systemHealth` و پیش‌فرض `MONITOR_BACKUP_CHECK=true` در قسمت ۲ (بالا) انجام شد.

### S2-1b — سیاست نگهداری بک‌آپ
- `src/utils/backupRetention.js`، بعد از هر بک‌آپ روزانه از داخل `runDailyBackup` اجرا می‌شود: فقط **جدیدترین N بک‌آپ روزانه** (`BACKUP_KEEP_DAILY`، پیش‌فرض ۱۴) و **M کپی ماهانه** (`BACKUP_KEEP_MONTHLY`، پیش‌فرض ۶) می‌مانند.
- ماهانه: اولین بک‌آپ موفق هر ماه میلادی به‌صورت کپی مستقل `monthly-YYYYMM.db` ذخیره می‌شود (توجیه: قاعده‌ی پاک‌سازی دو دسته کاملاً جدا می‌ماند و فقط با ترتیب نام فایل کار می‌کند؛ هزینه: یک فایل هم‌اندازه‌ی دیتابیس به‌ازای هر ماه).
- ایمنی: فقط الگوی دقیق `daily-YYYYMMDD-HHmm.db` و `monthly-YYYYMM.db` دست‌کاری می‌شود؛ `pre-migration-*`، `pre-restore-*`، `*.suspect` و هر فایل دیگر هرگز پاک نمی‌شود. فایل تازه‌ساخته همیشه محافظت می‌شود. مقدار keep نامعتبر (۰/منفی/متن) در env ⇒ پیش‌فرض؛ در خود تابع ⇒ خطا بدون پاک‌کردن چیزی. خطای نگهداری Job را «خطا» ثبت می‌کند ولی بک‌آپ تازه سر جایش می‌ماند.
- تست: `test/backup.test.js` (تاریخ‌های ساختگی، ۴۰ روز پشت‌سرهم، ترتیب بر اساس نام نه mtime، مقادیر نامعتبر).

### S2-1a — Job بک‌آپ روزانه
- `src/bot/scheduler/backup.js`: `runDailyBackup()` با `db.backup()` (اسنپ‌شات سازگار با WAL، بدون توقف سرویس) فایل `BACKUP_DIR/daily-YYYYMMDD-HHmm.db` می‌سازد (ساعت محلی سرور). ابتدا در `*.partial` نوشته و بعد rename می‌شود تا بک‌آپ نیمه‌کاره هرگز با نام بک‌آپ معتبر دیده نشود؛ خطا ⇒ فایل موقت پاک و خطا throw می‌شود.
- ثبت در `scheduler/index.js` با `wrapJob('dailyBackup', ...)` (نتیجه در `job_runs`). زمان: `CRON_DAILY_BACKUP` (پیش‌فرض `30 2 * * *`؛ cron نامعتبر ⇒ فقط لاگ خطا و فعال‌نشدن Job، نه توقف سرور).
- تست: `test/backup.test.js`. retention، integrity_check و restore در S2-1b/c و S2-2.
- (تاریخچه) `MONITOR_BACKUP_CHECK` در این مرحله `false` بود؛ در S2-1c قسمت ۲ پیش‌فرضش `true` شد.

### ۲-ج۱ — مانیتورینگ و هشدار (بخش ۲-ج به دو قسمت تقسیم شد: ۲-ج۱ مانیتورینگ ✅، ۲-ج۲ بک‌آپ/بازیابی ⏭)
- **ثبت اجرای Jobها**: migration `004_monitoring` (جدول‌های `job_runs`، `monitor_alerts`، `monitor_state`؛ هیچ جدول موجودی تغییر نکرد) + `wrapJob` (`src/utils/jobRunner.js`). تمام Jobهای `scheduler/index.js` از آن عبور می‌کنند؛ شروع/پایان/موفق یا خطا/مدت ثبت می‌شود. اجراهای نیمه‌تمام پروسه‌ی قبلی هنگام بالا آمدن `interrupted` می‌شوند (خطا حساب نمی‌شوند). رفتار قبلی (خطا فقط در لاگ، بدون شکستن cron) حفظ شد؛ `lateCheckinCheck` همچنان هر دو کارش را مستقل اجرا می‌کند.
- **نبض polling**: `bot.getUpdates` پیچیده می‌شود (`src/utils/botHealth.js`) تا آخرین موفقیت/خطای واقعی long-poll معلوم باشد.
- **سلامت سیستم**: `src/utils/systemHealth.js` (دیتابیس با نوشتن/خواندن آزمایشی و `quick_check` اختیاری، polling، فضای دیسک، سن بک‌آپ، شکست Jobها).
- **Watchdog** (`src/bot/scheduler/watchdog.js`): هر ۵ دقیقه؛ هشدار تلگرامی به ادمین‌های فعال؛ throttle (ساعتی؛ برای شکست Job روزانه)؛ پیام «رفع شد»؛ وضعیت ماندگار در `monitor_alerts`؛ فقط وقتی «ارسال‌شده» حساب می‌شود که حداقل یک ادمین دریافت کرده؛ fallback حافظه هنگام خرابی دیتابیس.
- **`GET /api/health`**: عمومی، فقط `{status: ok|degraded, time}`، ۱۰ ثانیه کش، همیشه HTTP ۲۰۰ (سازگار با قبل). **`GET /api/admin/system/status`** (فقط ادمین): جزئیات کامل. صفحه‌ی «وضعیت سیستم» در پنل.
- **راز**: متن خطا قبل از ذخیره/ارسال از `sanitizeText` رد می‌شود (توکن بات داخل URL خطای شبکه حذف می‌شود).
- تنظیمات جدید `.env`: `WATCHDOG_ENABLED`، `CRON_WATCHDOG`، `ALERT_THROTTLE_MINUTES`، `MONITOR_*`، `BACKUP_DIR`. `MONITOR_BACKUP_CHECK` پیش‌فرض خاموش است تا ۲-ج۲ Job بک‌آپ را بسازد.
- تست: `test/monitoring.test.js` (۳۳ تست)؛ `test/migrations.test.js` و `test/routesAccess.test.js` و smoke به‌روز شدند. `npm test`: ۱۷۳ سبز.
- مستندات: `docs/MONITORING.md`.

### ۲-ب۲ — rate limit ماندگار
- **شمارنده‌ی ماندگار**: migration `003_rate_limits` (جدول `rate_limit_hits`) + `rateLimitRepository` (UPSERT اتمیک)؛ `src/middleware/rateLimiter.js` به‌جای Map حافظه از SQLite استفاده می‌کند، پس ری‌استارت/crash سرویس سقف تلاش ورود را صفر نمی‌کند. ردیف‌های منقضی هر ۱۰ دقیقه پاک می‌شوند. `RATE_LIMIT_STORE=memory` رفتار قبلی.
- **نام ثابت برای هر limiter** (`attendance-action`، `admin-login`، `panel-auto-login`، `miniapp-action`، `csp-report`) چون کلید ذخیره‌ی ماندگار است (قبلاً شماره‌ی ترتیبی در حافظه). سقف‌ها و کلیدها (آیدی تلگرام برای Mini App، IP برای ورود) بدون تغییر.
- **ثبت ۴۲۹ در audit**: `rate_limit_exceeded` با IP و جزئیات بدون query/body؛ فقط اولین مسدودی هر کلید در هر پنجره (ماندگار، بعد از ری‌استارت تکرار نمی‌شود) + سقف سراسری ۳۰ در دقیقه.
- **fallback**: خطای دیتابیس ⇒ شمارنده‌ی حافظه (نه fail-open کامل) + لاگ `[rate-limit]`.
- تست: `test/rateLimit.test.js` (۱۳ تست: repository، middleware، ماندگاری بین پروسه‌های جدا، audit/throttle، fallback، HTTP واقعی با «ری‌استارت»)؛ `test/migrations.test.js` برای ۰۰۳ به‌روز شد. ⚠️ جدول جدید `rate_limit_hits` در مقایسه‌ی «بدون تغییر داده» test migration کنار گذاشته می‌شود (داده‌ی کاربری نیست).

### ۲-ب۱ — مدیریت رازها
- **بسته‌ساز بدون راز**: `npm run package` (`scripts/package-release.js`) — حذف همیشگی `.env`/`.env.*` (به‌جز `.env.example`)، `.ssl/`، `data/`، `node_modules/`، `.git/`، لاگ‌ها، `*.pem/*.key/*.pfx/*.db`؛ بعد از ساخت، خودِ zip هم با فهرست ممنوعه‌ها و اسکنر رازها راستی‌آزمایی می‌شود و در صورت یافته فایل ساخته نمی‌شود (fail-closed). zip با `zlib` داخلی، بدون وابستگی جدید.
- **اسکنر رازها**: `npm run secret-scan` (`scripts/secret-scan.js`) — توکن بات (حتی داخل URL)، کلید خصوصی PEM، فایل‌های کلید سرگردان، انتساب مشکوک به SECRET/TOKEN/PASSWORD؛ کد خروج غیرصفر در صورت یافتن؛ مقدار راز چاپ نمی‌شود؛ استثنای عمدی با `// secret-scan:allow`. چهار مقدار ساختگی تست علامت‌گذاری شدند.
- **کنترل راه‌اندازی** (`src/utils/startupChecks.js`): در production، `ADMIN_SESSION_SECRET` خالی/کوتاه‌تر از ۳۲/نمونه/غیرتصادفی ⇒ سرور بالا نمی‌آید و **قبل از** `getDb()` متوقف می‌شود (بدون migration/بک‌آپ). `TELEGRAM_BOT_USERNAME` خالی ⇒ هشدار. جایگزین شرط ساده‌ی قبلی «راز خالی» در `server.js`.
- `.gitignore`: افزودن `.env.*` (به‌جز نمونه)، `*.pem/*.key/*.pfx/*.p12`، `*.log`، `logs/`، `dist/`، `data/attachments/`.
- مستندات: `docs/SECRETS.md` (چک‌لیست «اگر راز لو رفت»، دستورات `icacls`). رفع در حین کار: اسکنر ابتدا فایل `.env.production` را نمی‌دید (پسوند نامتعارف) — با تست پیدا و اصلاح شد.
- تست: `test/secrets.test.js` (۲۸ تست جدید، شامل اجرای واقعی `createApp` در production در پروسه‌ی جدا و ساخت zip از خود پروژه). ⚠️ `server.js` اکنون یک `require` و یک فراخوانی جدید دارد (CRLF حفظ شد).

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

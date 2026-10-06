# CHANGELOG

وضعیت و جزئیات کامل فازها: [`PROJECT_STATUS.md`](PROJECT_STATUS.md) — معماری: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

## [Unreleased] — بخش ۲ (امنیت، پایداری و عملیات)

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

# فاز ۱۰ — استقرار و چک‌لیست تست دستی

تصمیم‌ها و فرض‌ها: [`PHASE10_DECISIONS.md`](PHASE10_DECISIONS.md).

## ۱. پیش از استقرار (روی سیستم توسعه)

```powershell
npm install
npm test
npm run smoke
npm run secret-scan
```

هر سه باید سبز باشند (`secret-scan` کد خروج ۰ = بدون یافته). سپس `npm run package` برای zip تحویل بدون `.env`/`data`/`node_modules`.

## ۲. استقرار روی سرور (PowerShell، Administrator)

> یک بک‌آپ دستی از `data\attendance.db` بگیرید (`npm run migrate` هم پیش از اعمال، بک‌آپ سازگار با WAL می‌گیرد).

```powershell
cd "C:\path\to\Attendance System"
nssm stop FarazHonarAttendance          # نام پیش‌فرض install-service.ps1
Copy-Item data\attendance.db "data\backups\pre-phase10-$(Get-Date -Format yyyyMMdd-HHmm).db"
# جایگزینی کد (بدون دست‌زدن به .env و data\ و .ssl\)
npm install --omit=dev
npm run migrate                            # اعمال ۰۲۳ تا ۰۲۶
npm run migrate:status                     # همه باید applied باشند
nssm start FarazHonarAttendance
```

مقدارهای جدید `.env` (همه اختیاری‌اند):

| متغیر | پیش‌فرض | توضیح |
|---|---|---|
| `CRON_MORNING_DIGEST` | `0 8 * * *` | خلاصه‌ی صبحگاهی سرپرست |
| `ALLOW_DATA_RESET` | `false` | بعد از Go-Live فقط برای پاک‌سازی عمدی و موقت `true` شود |

تنظیمات جدید در پنل (همه با پیش‌فرض ایمن): `missionBackdateDays`، `missionAdvanceDays`، `allowCheckinWithPendingMission`، `weekStartDay`، `planSubmissionWeekday`، `planMinTasks`، `planGateMode` (**off**)، `planGateStartDate`، `dailyReportGateMode` (**off**)، `reportBackfillDays`، `encouragementsEnabled`، `systemGoLive` (**off**).

## ۳. چک‌لیست تست دستی (روی نسخه‌ی تست، تلگرام واقعی)

سناریوی کامل به ترتیب:

1. **استراحت:** «ثبت استراحت» ⇒ سه گزینه ⇒ شروع و پایان؛ خروج با استراحت باز باید رد شود.
2. **ثبت ماموریت:** از Mini App یک ماموریت (ساعتی و تمام‌روز) ثبت کنید؛ در «ماموریت‌های من» pending دیده شود و لغو کار کند.
3. **ورود با ماموریت pending:** از بیرون شبکه ورود کنید؛ مجاز است و «نشانه» ثبت می‌شود. سپس رد ماموریت ⇒ رکورد در مرور شبانه «نیازمند بررسی».
4. **تأیید شبانه:** پیام مرور شبانه سرپرست ⇒ `✅ تأیید` / `❌ رد (با علت)` / `✏️ اصلاح ساعت`؛ پیام نتیجه به کارمند برسد؛ بعد از تأیید ساعت مفید اجتماع حضور و ماموریت باشد (دوبار شمرده نشود).
5. **برنامه‌ی هفتگی:** `planGateMode=enforce` روی نسخه‌ی تست؛ در روز ثبت برنامه (پنجشنبه) خروج بدون برنامه ⇒ هدایت به ویزارد ⇒ ثبت ⇒ خروج موفق؛ دبل‌کلیک خروج فقط یک رکورد بسازد. معافیت یک‌باره توسط سرپرست امتحان شود.
6. **گزارش روز بعد:** `dailyReportGateMode=enforce`؛ خروج با تسک پاسخ‌نشده ⇒ ویزارد سؤال‌ها (انجام شد/نیمه‌کاره/انجام نشد + علت + انتقال) ⇒ پیام تشویقی ⇒ خروج.
7. **گزارش شبانه‌ی سرپرست:** بخش «📋 گزارش تسک‌های امروز»، «گزارش نداده»، «برنامه ثبت نشده»؛ دکمه‌ی «مشاهده شد» و کامنت؛ تسک سیستمی `review_team_reports` در خروج سرپرست. صبح بعد: خلاصه‌ی صبحگاهی.
8. **بات دکمه‌ای:** منوی هر سه نقش درست باشد؛ کارمند با ارسال دستی متن «➕ افزودن کارمند» اجرا نگیرد؛ منوی «/» خالی باشد و `/start` فقط منو را نشان دهد.
9. **ریست آزمایشی (فقط نسخه‌ی تست):** پنل ⇒ وضعیت سیستم ⇒ «ناحیه‌ی خطر» ⇒ پیش‌نمایش ⇒ تایپ عبارت تأیید + کد تلگرام ⇒ نتیجه (شمارش حذف‌ها + مسیر بک‌آپ). بررسی: کاربران/تنظیمات سالم، ورود تازه ممکن، اعلان به ادمین‌ها، رکورد audit `system_reset`. سپس `systemGoLive` را روشن کنید و ثابت شود ریست `403` می‌دهد.

## ۴. فعال‌سازی تدریجی در production
1. استقرار با گیت‌ها `off`.
2. `planGateStartDate` را روی اولین هفته‌ی دلخواه بگذارید.
3. یک هفته `soft`، سپس `enforce`.
4. بعد از تأیید نهایی داده‌ها، `systemGoLive` را روشن کنید.

## ۵. بازگشت (Rollback)
`nssm stop` ← بازگردانی کد قبلی و بک‌آپ `pre-phase10-*.db` (طبق `BACKUP_RESTORE.md`) ← `nssm start`. migrationهای ۰۲۳–۰۲۶ فقط افزایشی‌اند و کد قبلی با آن‌ها هم کار می‌کند، ولی بازگردانی بک‌آپ تمیزترین مسیر است.

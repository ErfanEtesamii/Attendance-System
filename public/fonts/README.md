# فونت‌های self-hosted (S5-8b)

پنل و Mini App فونت **Vazirmatn** (مجوز SIL OFL) را از همین دامنه می‌خوانند؛ هیچ درخواستی به Google Fonts یا CDN نمی‌رود
(`font-src 'self'` در CSP). فایل فونت **باید یک‌بار** کنار پروژه گذاشته شود:

1. فایل `Vazirmatn[wght].woff2` (نسخه‌ی variable) را از مخزن رسمی Vazirmatn یا بسته‌ی npm `vazirmatn` بگیرید.
2. `node scripts/install-fonts.js <پوشه‌ی-حاوی-woff2>` — فایل را با نام `Vazirmatn-Variable.woff2` در همین پوشه (`public/fonts/`) می‌گذارد.
3. فایل را commit کنید.

تا فایل نباشد، ابتدا `local("Vazirmatn")` (نصب روی دستگاه) و بعد Tahoma / فونت سیستم استفاده می‌شود (`font-display: swap`؛ متن هرگز نامرئی نمی‌ماند).

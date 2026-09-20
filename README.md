# سیستم حضور و غیاب تلگرامی فرازهنر — فاز ۱

این پوشه شامل **فاز ۱** پروژه است: زیرساخت پایه، دیتابیس، و اسکلت لایه API.
فازهای بعد (محدودیت شبکه، بات تلگرام، Mini App، موتور محاسبه، گزارش‌گیری، پنل وب) در قالب پرامپت‌های جداگانه روی همین اسکلت اضافه می‌شوند.

## چرا این تکنولوژی‌ها؟
- **Node.js + Express**: نصب و اجرا روی ویندوز ساده است و با NSSM (که برای OrderSync هم استفاده شده) به‌راحتی به‌صورت Windows Service درمی‌آید.
- **SQLite (better-sqlite3)**: نیازی به نصب و نگهداری یک سرویس دیتابیس جداگانه (مثل MySQL/Postgres) روی سرور محلی نیست؛ کل دیتابیس یک فایل است (`data/attendance.db`) که پشتیبان‌گیری از آن هم فقط کپی همان فایل است.

## نصب

```bash
npm install
copy .env.example .env    # در ویندوز؛ در لینوکس/مک: cp .env.example .env
npm run init-db           # ساخت اولیه فایل دیتابیس و جداول
npm start                 # اجرای سرور
```

بعد از اجرا، آدرس `http://localhost:3000/api/health` باید پاسخ `{"status":"ok", ...}` بدهد.

## ساختار پروژه

```
src/
  config.js               # خواندن تنظیمات از .env
  db/
    schema.js             # تعریف کامل ۶ جدول دیتابیس
    connection.js         # اتصال singleton به SQLite + اجرای اسکیما
    init.js               # اسکریپت مستقل ساخت اولیه دیتابیس
  repositories/           # لایه دسترسی به داده، یکی به‌ازای هر جدول
    usersRepository.js
    attendanceRepository.js
    breakRepository.js
    leaveRepository.js
    holidaysRepository.js
    auditRepository.js
  middleware/
    errorHandler.js
    networkRestriction.js # جای‌نگهدار برای فاز ۲ (فعلاً هیچ درخواستی را رد نمی‌کند)
  api/routes/
    health.js
    users.js
    attendance.js
    index.js
  server.js               # نقطه ورود برنامه
```

## جداول دیتابیس (طبق سند پروژه)

| جدول | توضیح |
|---|---|
| `users` | کارمندان/مدیران/ادمین‌ها و نگاشت `telegram_user_id` |
| `attendance_records` | رکورد روزانه ورود/خروج هر کاربر |
| `break_records` | استراحت‌های ناهار/کوتاه، وابسته به یک رکورد روزانه |
| `leave_requests` | درخواست‌های مرخصی و مأموریت |
| `holidays` | تقویم تعطیلات رسمی |
| `audit_log` | لاگ غیرقابل‌ویرایش رویدادهای حساس |

نکته حیاتی که در کد رعایت شده: تمام timestamp های ورود/خروج/استراحت **از ساعت سرور** گرفته می‌شوند (`src/utils/serverTime.js`)، نه از کلاینت، تا قابل دستکاری نباشند.

## مسیرهای API فعلی (اسکلت اولیه، بدون احراز هویت واقعی)

- `GET /api/health`
- `GET /api/users` و `GET /api/users/:id`
- `POST /api/users` — افزودن کارمند
- `PATCH /api/users/:id` — ویرایش
- `DELETE /api/users/:id` — غیرفعال‌سازی (soft delete)
- `GET /api/attendance/today?userId=...`
- `POST /api/attendance/check-in` — بدنه: `{ "userId": 1 }`
- `POST /api/attendance/check-out`
- `POST /api/attendance/break/start` — بدنه: `{ "userId": 1, "breakType": "lunch" }`
- `POST /api/attendance/break/end`

⚠️ این مسیرها **هنوز** چک IP شبکه داخلی را اعمال نمی‌کنند (`middleware/networkRestriction.js` فعلاً یک placeholder است) و احراز هویت واقعی (نقش‌ها، دسترسی مدیر/ادمین) هم ندارند. این‌ها دقیقاً موضوع فاز ۲ و فازهای بعدی هستند و روی همین اسکلت اضافه می‌شوند.

## قدم بعدی
فاز ۲: پیاده‌سازی واقعی middleware محدودسازی شبکه (`192.168.10.0/24`) به‌جای placeholder فعلی، به‌همراه ثبت تلاش‌های رد‌شده در `audit_log`.

// نگاشت کد خطای گزارش روزانه‌ی تسک‌ها به وضعیت HTTP — منبع واحد برای Mini App (`/miniapp/daily-*`) و پنل (`/admin/me/tasks/*`).
// کد ناشناخته ⇒ ۴۰۰. (کدهای تسک فوریِ شخصی: selfUrgentTaskService.statusOf منبع اصلی است؛ اینجا برای یکپارچگی نگاشت شده‌اند.)
const REPORT_ERROR_STATUS = {
  MONTH_CLOSED: 409, ALREADY_ANSWERED: 409, FULL_DAY_OFF: 409,
  BACKFILL_EXPIRED: 409, LATE_WINDOW_EXPIRED: 409, LATE_NOT_ALLOWED: 409, NO_RECORD: 404,
  CARRY_LIMIT: 400, TASK_NOT_FOUND: 404, REVIEW_TASK_LOCKED: 409, NOTE_ONLY_FOR_DONE: 409, // A1 (فاز ۱۵): واگرد و ویرایش توضیحِ انجام
  INVALID_WEEK: 400, NOTE_TOO_LONG: 400, // A4: نگاشت صریح (مقدار پیش‌فرض هم ۴۰۰ است)
  SELF_URGENT_DISABLED: 403, SELF_URGENT_LIMIT: 409, NOT_SELF_URGENT: 403, DATE_OUT_OF_WEEK: 400, HAS_ANSWERS: 409,
  SYSTEM_TASK_READONLY: 403, // M3: تسک سیستمی/واجب از پنل قابل تغییر نیست
};

const statusOfReportError = (code) => REPORT_ERROR_STATUS[code] || 400;

module.exports = { REPORT_ERROR_STATUS, statusOfReportError };

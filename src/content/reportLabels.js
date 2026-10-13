// برچسب‌های فارسی علت‌ها/وضعیت‌ها برای پیام‌های بات (کدها باید با REASON_CODES در taskReportService یکی باشند).
const REASON_LABELS = Object.freeze({
  no_time: 'وقت نشد', needs_more_time: 'زمان بیشتری لازم دارد', blocked_by_others: 'منتظر دیگران', priority_changed: 'اولویت عوض شد', technical_issue: 'مشکل فنی', other: 'سایر',
});
const STATUS_LABELS = Object.freeze({ done: 'انجام شد', partial: 'نیمه‌کاره', not_done: 'انجام نشد' });
module.exports = { REASON_LABELS, STATUS_LABELS };

// فاز B (بخش سرپرست‌ها): فهرست قابلیت‌های «قابل‌خاموش‌شدن» سرپرست‌ها.
// منبع واحد برای رجیستری تنظیمات (supervisorEnabledCapabilities) و middleware/permissions.js.
// مجوزهای پایه (me.read، notifications.*، attendance.read، users.read، *.read، reviews.read، team.week_view …)
// عمداً اینجا نیستند و هرگز خاموش نمی‌شوند. خالص است: بدون DB و بدون وابستگی.

const SUPERVISOR_TOGGLEABLE_CAPABILITIES = Object.freeze([
  'leave.approve',
  'leave.edit',
  'records.edit',
  'disputes.resolve',
  'overtime.approve',
  'suspicious.review',
  'plans.exempt',
  'reviews.write',
  'checkin_permissions.decide',
  'tasks.assign_urgent',
  'plan.edit_team',
  'remote_work.review',
  'schedule.manage',
  'broadcast.send',
  'users.message',
  'analytics.read',
]);

// برچسب فارسی هر قابلیت (برای صفحه‌ی تنظیمات و پیام‌ها)
const SUPERVISOR_CAPABILITY_LABELS = Object.freeze({
  'leave.approve': 'تأیید/رد مرخصی و ماموریت',
  'leave.edit': 'ثبت و ویرایش مرخصی برای کارمند',
  'records.edit': 'اصلاح رکورد تردد',
  'disputes.resolve': 'تصمیم درباره‌ی اعتراض‌ها',
  'overtime.approve': 'تأیید اضافه‌کاری',
  'suspicious.review': 'بررسی تردد مشکوک',
  'plans.exempt': 'معافیت از گیت برنامه‌ی هفتگی',
  'reviews.write': 'مشاهده و کامنت روی گزارش تیم',
  'checkin_permissions.decide': 'تصمیم درباره‌ی اجازه‌ی ورود',
  'tasks.assign_urgent': 'تعیین تسک فوری',
  'plan.edit_team': 'ویرایش برنامه‌ی هفته‌های آینده‌ی تیم',
  'remote_work.review': 'تأیید/رد ساعت دورکاری',
  'schedule.manage': 'مدیریت برنامه‌ی روزبه‌روز تیم',
  'broadcast.send': 'ارسال پیام گروهی به تیم',
  'users.message': 'ارسال پیام به کارمند',
  'analytics.read': 'تحلیل‌ها و روند تأخیر تیم',
});

module.exports = { SUPERVISOR_TOGGLEABLE_CAPABILITIES, SUPERVISOR_CAPABILITY_LABELS };

// منبع واحد برای دسته‌بندی نقش‌ها.
//
// owner = مالک سیستم: همه‌ی دسترسی‌های admin + بخش‌های «فقط owner» (مدیریت adminها، سیستم و امنیت).
// owner جزو کارمندان شرکت نیست: در فهرست کارمندان، حضور و غیاب، عملکرد و گزارش‌ها نمی‌آید
// (ولی می‌تواند برای تست ورود/خروج بزند؛ آن رکوردها در آمار شرکت حساب نمی‌شوند).
//
// هر جا قبلاً role === 'admin' بود، باید از isAdmin() استفاده شود تا owner هم همان دسترسی را داشته باشد.

const ADMIN_ROLES = Object.freeze(['admin', 'owner']);
const MANAGER_UP_ROLES = Object.freeze(['manager', 'admin', 'owner']);

const roleOf = (x) => (x && typeof x === 'object' ? x.role : x);

// admin یا owner
const isAdmin = (x) => ADMIN_ROLES.includes(roleOf(x));
const isOwner = (x) => roleOf(x) === 'owner';
// سرپرست، admin یا owner
const isManagerUp = (x) => MANAGER_UP_ROLES.includes(roleOf(x));

module.exports = { ADMIN_ROLES, MANAGER_UP_ROLES, isAdmin, isOwner, isManagerUp };

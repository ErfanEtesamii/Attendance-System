// S4-3a: ساختار مجوزها (نگاشت نقش → مجوز) و middleware requirePermission.
//
// فقط زیرساخت است؛ هنوز هیچ route ای از این فایل استفاده نمی‌کند (مهاجرت routeها در S4-3b/S4-3c).
// نگاشت عمداً دقیقاً با رفتار فعلی requireStaff / requireFullAdmin / لیست سفید کارمند برابر است
// تا بعد از مهاجرت، ماتریس تست قبلی (نقش × route) نتیجه‌ی یکسان بدهد.
//
// نکته‌ها:
//   - default-deny: نقش ناشناخته، مجوز ناشناخته یا نبودن نقش ⇒ همیشه رد.
//   - اسکوپ سرپرست (فقط تیم خودش) مجوز نیست؛ همچنان با scopedUserIds / canAccessUser در خود route اعمال می‌شود.
//   - لیست سفید کارمند (EMPLOYEE_ALLOWED در adminAuth.js) لایه‌ی بیرونی است و بدون تغییر می‌ماند؛
//     مجوزهای کارمند اینجا فقط همان خواندنی‌های «خود کارمند» هستند.
//   - اضافه‌شدن نقش جدید (مثل hr در S4-4a) فقط یک کلید تازه در ROLE_PERMISSIONS است (+ migration برای CHECK جدول users).

// فهرست کامل مجوزها (نام‌گذاری: «حوزه.عمل»).
const PERMISSIONS = Object.freeze([
  'me.read',
  'dashboard.read',
  'attendance.read',
  'records.edit', // ساخت/ویرایش/حذف رکورد تردد و استراحت
  'leave.read',
  'leave.approve', // تأیید/رد درخواست مرخصی
  'leave.edit', // ثبت/ویرایش/حذف مرخصی توسط مدیر
  'disputes.read',
  'disputes.resolve',
  'overtime.approve',
  'reports.read',
  'users.read', // فهرست/خروجی/پروفایل کاربران
  'users.details.read', // جزئیات یک کاربر (برای کارمند: فقط خودش)
  'users.write', // ساخت/ویرایش/حذف کاربر، ابطال نشست‌ها
  'users.message',
  'shifts.read',
  'shifts.edit',
  'suspicious.read',
  'suspicious.review',
  'settings.read', // تنظیمات و تعطیلات (خواندن)
  'settings.edit', // تنظیمات و تعطیلات (نوشتن، import)
  'audit.read',
  'system.read',
  'system.manage', // ارسال همگانی، ابطال همه‌ی نشست‌ها، بک‌آپ
  'notifications.read', // S4-5b: فهرست/شمارنده‌ی اعلان‌های «خود کاربر» (اسکوپ سمت سرور؛ پارامتر کاربر ندارد)
  'notifications.mark', // S4-5b: علامت خوانده‌شدنِ اعلان‌های «خود کاربر» (برای همه‌ی نقش‌ها از جمله hr؛ روی داده‌ی دیگران اثر ندارد)
  'leave.balance.read', // S4-9c: مانده‌ی مرخصی؛ اسکوپ در route (کارمند خودش، سرپرست خودش+تیم، admin/hr همه)
  'leave.balance.edit', // S4-9c: تعدیل دستی و ثبت استحقاق/انتقالی (فقط admin)
]);

// مجوزهای «خود کارمند»؛ هر چه خارج از اینجاست برای employee بسته است.
const EMPLOYEE_PERMISSIONS = [
  'me.read',
  'attendance.read',
  'leave.read',
  'disputes.read',
  'reports.read',
  'users.details.read',
  'notifications.read',
  'notifications.mark',
  'leave.balance.read',
];

// سرپرست: همه‌ی مجوزهای کارمند + عملیات مدیریتی روی تیم خودش (اسکوپ در route).
const MANAGER_PERMISSIONS = [
  ...EMPLOYEE_PERMISSIONS,
  'dashboard.read',
  'records.edit',
  'leave.approve',
  'leave.edit',
  'disputes.resolve',
  'overtime.approve',
  'users.read',
  'users.message',
  'shifts.read',
  'suspicious.read',
  'suspicious.review',
  'settings.read',
];

// منابع انسانی (S4-4a): فقط‌خواندنی روی همه‌ی کاربران (بدون اسکوپ تیم؛ scopedUserIds برای hr مثل admin همه را برمی‌گرداند).
// هیچ مجوز نوشتن/تأیید/تنظیمات/ممیزی/سیستم ندارد. «مانده»ی مرخصی: هنوز endpoint جدایی ندارد (leave.read فعلاً آن را می‌پوشاند).
const HR_PERMISSIONS = [
  ...EMPLOYEE_PERMISSIONS,
  'dashboard.read',
  'users.read',
];

const ROLE_PERMISSIONS = Object.freeze({
  employee: Object.freeze(new Set(EMPLOYEE_PERMISSIONS)),
  manager: Object.freeze(new Set(MANAGER_PERMISSIONS)),
  admin: Object.freeze(new Set(PERMISSIONS)),
  hr: Object.freeze(new Set(HR_PERMISSIONS)),
});

// فهرست نقش‌های معتبر (منبع واحد برای اعتبارسنجی نقش در route ها و middleware)
const ROLES = Object.freeze(Object.keys(ROLE_PERMISSIONS));

const PERMISSION_SET = new Set(PERMISSIONS);

// آیا این نقش این مجوز را دارد؟ ورودی نامعتبر ⇒ false (default-deny).
function hasPermission(role, permission) {
  if (typeof role !== 'string' || typeof permission !== 'string') return false;
  if (!Object.prototype.hasOwnProperty.call(ROLE_PERMISSIONS, role)) return false;
  return ROLE_PERMISSIONS[role].has(permission);
}

// فهرست مجوزهای یک نقش (نقش ناشناخته ⇒ آرایه‌ی خالی).
function permissionsFor(role) {
  if (typeof role !== 'string' || !Object.prototype.hasOwnProperty.call(ROLE_PERMISSIONS, role)) return [];
  return PERMISSIONS.filter((p) => ROLE_PERMISSIONS[role].has(p));
}

// middleware: همه‌ی مجوزهای داده‌شده لازم است. باید بعد از requireAdminAuth بیاید (req.adminUser).
// نام مجوز ناشناخته در زمان ثبت route خطا می‌دهد تا اشتباه تایپی بی‌صدا همه را رد/قبول نکند.
function requirePermission(...required) {
  if (required.length === 0) throw new Error('requirePermission: حداقل یک مجوز لازم است.');
  for (const p of required) {
    if (!PERMISSION_SET.has(p)) throw new Error(`requirePermission: مجوز ناشناخته «${p}».`);
  }
  return function permissionGuard(req, res, next) {
    const role = req.adminUser && req.adminUser.role;
    if (!required.every((p) => hasPermission(role, p))) {
      return res.status(403).json({ error: 'برای این عملیات مجوز لازم را ندارید.' });
    }
    next();
  };
}

module.exports = { PERMISSIONS, ROLES, ROLE_PERMISSIONS, hasPermission, permissionsFor, requirePermission };

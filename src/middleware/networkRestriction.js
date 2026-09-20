// این فایل جای‌نگهدار (placeholder) برای فاز ۲ است.
// در فاز ۲، اینجا منطق بررسی IP مبدأ درخواست در برابر ALLOWED_NETWORK_CIDR
// (به‌صورت پیش‌فرض 192.168.10.0/24) پیاده‌سازی و در مسیرهای ثبت تردد اعمال می‌شود،
// و هر تلاش رد‌شده در audit_log ثبت خواهد شد.
// فعلاً یک نسخه‌ی «رد نکن، فقط عبور بده» است تا فاز ۱ بدون وابستگی قفل نشود.

function networkRestrictionPlaceholder(req, res, next) {
  next();
}

module.exports = { networkRestrictionPlaceholder };

// نکته امنیتی حیاتی سند: هر timestamp باید از ساعت خود سرور گرفته شود، نه از کلاینت،
// تا کاربر نتواند با تغییر ساعت گوشی/سیستم خودش زمان ورود/خروج را دستکاری کند.
// در تمام لایه‌های بالاتر (repositories، routes) فقط از این تابع برای گرفتن زمان استفاده کنید؛
// هرگز زمانی که از بدنه‌ی درخواست (req.body) کلاینت می‌آید را مستقیماً ذخیره نکنید.

function nowIso() {
  return new Date().toISOString();
}

function todayDateString() {
  // فرمت YYYY-MM-DD بر اساس ساعت سرور
  return new Date().toISOString().slice(0, 10);
}

module.exports = { nowIso, todayDateString };

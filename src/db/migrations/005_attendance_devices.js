// migration شماره ۰۰۵ — ستون‌های «نشانه‌ی دستگاه» روی attendance_records (S2-3).
//
// فقط جمع‌آوری داده برای قاعده‌های تشخیص مورد مشکوک در S2-4 (بدون هیچ قاعده/مسدودسازی در این مرحله):
//   check_in_device / check_out_device — device_id تصادفی پایدار Mini App (فقط اگر معتبر بود؛ وگرنه NULL)
//   check_in_ua / check_out_ua         — User-Agent کوتاه‌شده‌ی همان درخواست
// هر چهار ستون nullable و بدون پیش‌فرض‌اند؛ رکوردهای قدیمی، ثبت‌های بات و ثبت دستی ادمین NULL می‌مانند.
// ⚠️ device_id قابل جعل است (سمت کلاینت تولید می‌شود)؛ فقط «نشانه» است نه «مدرک».

const COLUMNS = ['check_in_device', 'check_out_device', 'check_in_ua', 'check_out_ua'];

module.exports = {
  name: '005_attendance_devices',
  up(db) {
    // idempotent: اگر ستونی از قبل هست (مثلاً اجرای نیمه‌کاره‌ی دستی) دوباره اضافه نمی‌شود
    const existing = db.prepare("PRAGMA table_info('attendance_records')").all().map((c) => c.name);
    for (const col of COLUMNS) {
      if (!existing.includes(col)) db.exec(`ALTER TABLE attendance_records ADD COLUMN ${col} TEXT`);
    }
  },
};

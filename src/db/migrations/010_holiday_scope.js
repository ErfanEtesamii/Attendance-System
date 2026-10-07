// migration شماره ۰۱۰ — نوع و دامنه‌ی تعطیلی (S3-7b). بازسازی جدول holidays با helper رسمی migrator.
//
//   kind           'full' (پیش‌فرض) | 'half' (نیم‌روز؛ با half_end_time)
//   half_end_time  HH:MM؛ فقط برای kind='half' (و برای full باید NULL باشد)
//   scope          'all' (پیش‌فرض، همه‌ی کارکنان) | 'department' (فقط کاربرانی که department آن‌ها دقیقاً برابر است)
//   department     برای scope='all' همیشه '' (نه NULL، تا UNIQUE کار کند)؛ برای scope='department' غیرخالی
//   UNIQUE(holiday_date, scope, department) جایگزین UNIQUE(holiday_date) قبلی شد.
//
// ردیف‌های موجود بدون هیچ تغییری کپی می‌شوند و kind='full'، scope='all' می‌گیرند (= همان معنای قبلی)؛ id و شمارنده‌ی AUTOINCREMENT حفظ می‌شود.
// foreignKeys:false چون rebuildTable باید با PRAGMA foreign_keys=OFF اجرا شود (هیچ جدولی به holidays کلید خارجی ندارد). migrator قبلش بک‌آپ می‌گیرد.

module.exports = {
  name: '010_holiday_scope',
  foreignKeys: false,
  up(db, { rebuildTable }) {
    rebuildTable(
      db,
      'holidays',
      `CREATE TABLE holidays (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        holiday_date TEXT NOT NULL,
        title TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'full' CHECK (kind IN ('full', 'half')),
        half_end_time TEXT CHECK (half_end_time IS NULL OR half_end_time GLOB '[0-2][0-9]:[0-5][0-9]'),
        scope TEXT NOT NULL DEFAULT 'all' CHECK (scope IN ('all', 'department')),
        department TEXT NOT NULL DEFAULT '',
        CHECK ((kind = 'half') = (half_end_time IS NOT NULL)),
        CHECK ((scope = 'department') = (department <> '')),
        UNIQUE (holiday_date, scope, department)
      )`
    );
  },
};

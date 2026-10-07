// migration شماره ۰۱۱ — نقش «hr» (S4-4a). بازسازی جدول users با helper رسمی migrator تا CHECK نقش، مقدار 'hr' را بپذیرد.
//
//   role: 'employee' | 'manager' | 'admin' | 'hr'
//   hr = منابع انسانی؛ فقط‌خواندنی روی همه‌ی کاربران/گزارش‌ها/خروجی‌ها (مجوزها در src/middleware/permissions.js).
//
// همه‌ی ستون‌ها (از جمله session_version و shift_id)، ردیف‌ها، id ها، شمارنده‌ی AUTOINCREMENT و ایندکس idx_users_shift حفظ می‌شود
// (rebuildTable ایندکس‌ها را بازسازی می‌کند). foreignKeys:false چون rebuildTable باید با PRAGMA foreign_keys=OFF اجرا شود
// (چند جدول به users ارجاع دارند). migrator قبل از اجرا بک‌آپ می‌گیرد.

module.exports = {
  name: '011_hr_role',
  foreignKeys: false,
  up(db, { rebuildTable }) {
    rebuildTable(
      db,
      'users',
      `CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        telegram_user_id TEXT UNIQUE,        -- آیدی عددی تلگرام کاربر
        full_name TEXT NOT NULL,             -- نام و نام‌خانوادگی
        personnel_code TEXT UNIQUE,          -- کد پرسنلی
        department TEXT,                     -- واحد/دپارتمان
        role TEXT NOT NULL DEFAULT 'employee' -- 'employee' | 'manager' | 'admin' | 'hr'
          CHECK (role IN ('employee', 'manager', 'admin', 'hr')),
        manager_id INTEGER REFERENCES users(id), -- مدیر مستقیم
        is_active INTEGER NOT NULL DEFAULT 1, -- ۱=فعال، ۰=غیرفعال
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        session_version INTEGER NOT NULL DEFAULT 0,
        shift_id INTEGER REFERENCES work_shifts(id)
      )`
    );
  },
};

// migration شماره ۰۴۹ — نقش «owner» (مالک سیستم).
//   role: 'employee' | 'manager' | 'admin' | 'hr' | 'owner'
//
// CHECK نقش در جدول users باید مقدار 'owner' را بپذیرد. به‌جای نوشتن دوباره‌ی کل تعریف جدول (که با ستون‌های
// افزوده‌شده در migrationهای بعدی ناسازگار می‌شود)، SQL «فعلیِ» جدول از sqlite_master خوانده و فقط CHECK نقش تغییر می‌کند.

module.exports = {
  name: '049_owner_role',
  foreignKeys: false,
  up(db, { rebuildTable }) {
    const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get();
    if (!row || !row.sql) throw new Error('جدول users پیدا نشد.');
    if (/'owner'/.test(row.sql)) return; // قبلاً اعمال شده

    const next = row.sql.replace(
      /CHECK\s*\(\s*role\s+IN\s*\(([^)]*)\)\s*\)/i,
      (_m, list) => `CHECK (role IN (${list.trim()}, 'owner'))`
    );
    if (next === row.sql) throw new Error('CHECK نقش در تعریف جدول users پیدا نشد.');
    rebuildTable(db, 'users', next);
  },
};

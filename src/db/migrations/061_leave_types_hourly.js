// مرخصی و مأموریت: علاوه بر «روز»، نیم‌روز و ساعتی (از ساعت … تا …) هم مجاز می‌شود (فرم پنل، مینی‌اپ و ربات).
// فقط روی دیتابیسی که قبلاً هر دو نوع پیش‌فرض را فقط با واحد «روز» دارد اعمال می‌شود (تنظیم دستی ادمین دست‌نخورده می‌ماند).
module.exports = {
  name: '061_leave_types_hourly',
  up(db) {
    // نصب تازه/تست (بدون رکوردِ حضور) دست‌نخورده می‌ماند
    if (!db.prepare('SELECT 1 FROM attendance_records LIMIT 1').get()) return;
    db.prepare(`UPDATE leave_types SET allowed_units = '["day","half_day","hour"]', updated_at = datetime('now')
      WHERE code IN ('annual', 'mission') AND allowed_units = '["day"]'`).run();
  },
};

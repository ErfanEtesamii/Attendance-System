// migration شماره ۰۳۵ — زمان «دیده‌شدنِ برنامه توسط کارمند» (فاز ۱۳، A3-۲).
//
//   weekly_plans.employee_seen_at : آخرین باری که کارمند (در Mini App) با «متوجه شدم» اعلام کرده تغییرهای مدیر/سرپرست را دیده.
//     NULL = هرگز. مبنای بنر «سرپرست برنامه‌ی این هفته را تغییر داده»: تسکی با edited_at (migration ۰۳۳) جدیدتر از این زمان.
//
// نکته‌ی همزمانی: تریگر نسخه‌ی migration ۰۳۴ با هر UPDATE روی weekly_plans نسخه را زیاد می‌کند. «دیدنِ» کارمند محتوای برنامه را
// عوض نمی‌کند و نباید باعث PLAN_CONFLICT برای مدیرِ در حال ویرایش شود؛ پس تریگر دوباره ساخته می‌شود تا وقتی تنها
// employee_seen_at تغییر کرده نسخه را زیاد نکند. idempotent: ستون فقط در صورت نبودن اضافه می‌شود و تریگر DROP IF EXISTS + CREATE است.
// برنامه‌های موجود: employee_seen_at = NULL ⇒ بنر فقط برای تسک‌هایی که مدیر (از این فاز به بعد) علامت زده نشان داده می‌شود.

module.exports = {
  name: '035_plan_employee_seen',
  up(db) {
    const cols = new Set(db.prepare('PRAGMA table_info(weekly_plans)').all().map((c) => c.name));
    if (!cols.has('employee_seen_at')) db.exec('ALTER TABLE weekly_plans ADD COLUMN employee_seen_at TEXT;');
    db.exec('DROP TRIGGER IF EXISTS trg_weekly_plans_version;');
    db.exec(`CREATE TRIGGER trg_weekly_plans_version AFTER UPDATE ON weekly_plans
      WHEN NEW.version = OLD.version AND NEW.employee_seen_at IS OLD.employee_seen_at
      BEGIN UPDATE weekly_plans SET version = OLD.version + 1 WHERE id = NEW.id; END;`);
  },
};

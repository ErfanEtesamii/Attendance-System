// migration شماره ۰۳۴ — شمارنده‌ی نسخه‌ی برنامه‌ی هفتگی برای تشخیص همزمانی (فاز ۱۳، A2-۳).
//
// چرا شمارنده و نه updated_at: updated_at دقت میلی‌ثانیه دارد و دو نوشتن پشت‌سرهم در یک میلی‌ثانیه می‌توانند
// نسخه‌ی یکسان بدهند؛ شمارنده با هر تغییر دقیقاً یکی زیاد می‌شود.
//
//   weekly_plans.version : عدد صحیح، پیش‌فرض ۱ (برنامه‌های موجود نسخه‌ی ۱ می‌گیرند؛ رفتار قبلی دست‌نخورده).
//
// افزایش نسخه با تریگر انجام می‌شود تا «هر» نویسنده (کارمند در Mini App، سرپرست، تسک فوری، H5 و ...) بدون
// تغییر در کدشان شمرده شود:
//   • UPDATE روی weekly_plans (وضعیت، یادداشت سرپرست، touch)  ⇒ version + 1  (فقط وقتی خودِ UPDATE نسخه را عوض نکرده)
//   • INSERT/UPDATE/DELETE روی plan_tasks                      ⇒ version برنامه‌ی آن تسک + 1
// تریگرها idempotent‌اند (DROP IF EXISTS + CREATE) و ستون فقط در صورت نبودن اضافه می‌شود.

module.exports = {
  name: '034_weekly_plan_version',
  up(db) {
    const cols = new Set(db.prepare('PRAGMA table_info(weekly_plans)').all().map((c) => c.name));
    if (!cols.has('version')) db.exec('ALTER TABLE weekly_plans ADD COLUMN version INTEGER NOT NULL DEFAULT 1;');

    db.exec('DROP TRIGGER IF EXISTS trg_weekly_plans_version;');
    db.exec(`CREATE TRIGGER trg_weekly_plans_version AFTER UPDATE ON weekly_plans
      WHEN NEW.version = OLD.version
      BEGIN UPDATE weekly_plans SET version = OLD.version + 1 WHERE id = NEW.id; END;`);

    db.exec('DROP TRIGGER IF EXISTS trg_plan_tasks_version_ins;');
    db.exec(`CREATE TRIGGER trg_plan_tasks_version_ins AFTER INSERT ON plan_tasks
      BEGIN UPDATE weekly_plans SET version = version + 1 WHERE id = NEW.plan_id; END;`);

    db.exec('DROP TRIGGER IF EXISTS trg_plan_tasks_version_upd;');
    db.exec(`CREATE TRIGGER trg_plan_tasks_version_upd AFTER UPDATE ON plan_tasks
      BEGIN UPDATE weekly_plans SET version = version + 1 WHERE id = NEW.plan_id; END;`);

    db.exec('DROP TRIGGER IF EXISTS trg_plan_tasks_version_del;');
    db.exec(`CREATE TRIGGER trg_plan_tasks_version_del AFTER DELETE ON plan_tasks
      BEGIN UPDATE weekly_plans SET version = version + 1 WHERE id = OLD.plan_id; END;`);
  },
};

// migration شماره ۰۳۲ — تسک فوری (فاز ۱۲، E1). ستون‌های جدید روی plan_tasks:
//   is_urgent             : ۰/۱ — تسک فوریِ تعیین‌شده توسط مدیر/سرپرست (کارمند نمی‌تواند حذف/ویرایش کند)
//   assigned_by_user_id   : تعیین‌کننده (users.id)؛ با حذف کاربر NULL می‌شود
//   urgent_note           : یادداشت اختیاری (≤ ۵۰۰)
//   urgent_deadline_time  : مهلت ساعتی «HH:MM» به وقت شرکت (اختیاری)
// تسک‌های موجود: is_urgent=0 و بقیه NULL ⇒ رفتار قبلی دست‌نخورده. idempotent: ستونِ موجود دوباره اضافه نمی‌شود.

module.exports = {
  name: '032_urgent_tasks',
  up(db) {
    const cols = new Set(db.prepare('PRAGMA table_info(plan_tasks)').all().map((c) => c.name));
    if (!cols.has('is_urgent')) db.exec('ALTER TABLE plan_tasks ADD COLUMN is_urgent INTEGER NOT NULL DEFAULT 0 CHECK (is_urgent IN (0, 1));');
    if (!cols.has('assigned_by_user_id')) db.exec('ALTER TABLE plan_tasks ADD COLUMN assigned_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;');
    if (!cols.has('urgent_note')) db.exec('ALTER TABLE plan_tasks ADD COLUMN urgent_note TEXT CHECK (urgent_note IS NULL OR length(urgent_note) <= 500);');
    if (!cols.has('urgent_deadline_time')) db.exec("ALTER TABLE plan_tasks ADD COLUMN urgent_deadline_time TEXT CHECK (urgent_deadline_time IS NULL OR urgent_deadline_time GLOB '[0-2][0-9]:[0-5][0-9]');");
    db.exec('CREATE INDEX IF NOT EXISTS idx_plan_tasks_urgent ON plan_tasks(is_urgent, planned_date) WHERE is_urgent = 1;');
  },
};

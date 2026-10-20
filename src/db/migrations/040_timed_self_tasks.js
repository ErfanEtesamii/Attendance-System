// ساعت شروع اختیاریِ تسک؛ پایان در urgent_deadline_time موجود ذخیره می‌شود.
module.exports = {
  name: '040_timed_self_tasks',
  up(db) {
    const cols = new Set(db.prepare('PRAGMA table_info(plan_tasks)').all().map((c) => c.name));
    if (!cols.has('scheduled_start_time')) db.exec("ALTER TABLE plan_tasks ADD COLUMN scheduled_start_time TEXT CHECK (scheduled_start_time IS NULL OR scheduled_start_time GLOB '[0-2][0-9]:[0-5][0-9]');");
  },
};

// migration شماره ۰۳۳ — علامت‌گذاری تسک‌های اضافه/ویرایش‌شده توسط ادمین/سرپرست (فاز ۱۳، A1-۲).
//
// تصمیم (به‌جای بازاستفاده از assigned_by_user_id موجود در migration ۰۳۲):
//   assigned_by_user_id از قبل معنای مشخصی دارد: «تعیین‌کننده‌ی تسک فوری» و همیشه همراه urgent_note/
//   urgent_deadline_time/is_urgent در presentTask (weeklyPlanService.js) و taskReportService.js به کلاینت
//   می‌رود. اگر همین ستون برای تسک عادیِ ویرایش‌شده‌ی مدیر هم پر شود، UI/Mini App فعلی نمی‌تواند تشخیص دهد
//   که آیا تسک فوری است یا فقط «مدیر آن را اضافه/ویرایش کرده» و ممکن است فیلدهای فوری (مثل مهلت) را برای
//   تسکی که اصلاً فوری نیست نمایش دهد. برای رفع این ابهام، سه ستون مستقل اضافه می‌شود:
//
//   manager_locked    : ۰/۱ — تسک برای خودِ کارمند فقط‌خواندنی است چون مدیر/سرپرست آن را اضافه یا ویرایش
//                        کرده (A3 دقیقاً از همین ستون برای «🔒 از طرف سرپرست» و نادیده‌گرفتن در saveDraft
//                        استفاده می‌کند؛ ربطی به is_urgent ندارد).
//   edited_by_user_id : آخرین مدیر/سرپرستی که تسک را اضافه/ویرایش کرده (users.id)؛ با حذف کاربر NULL می‌شود.
//   edited_at         : زمان آخرین افزودن/ویرایش توسط مدیر — مبنای بنر «سرپرست برنامه را تغییر داد» در A3
//                        و محاسبه‌ی unnotifiedChanges/B1 در A2 (نه audit؛ audit جدا و کامل‌تر است).
//
// این سه ستون کاملاً مستقل از is_urgent/assigned_by_user_id‌اند: یک تسک یا فوری است یا «قفل‌شده‌ی مدیر»،
// هرگز هر دو هم‌زمان (weeklyPlanAdminService این دو مسیر را قاطی نمی‌کند؛ تسک فوری همچنان فقط از
// urgentTaskService می‌آید و از مسیر A1 دست‌نخورده می‌ماند).
//
// تسک‌های موجود: manager_locked = ۰ و بقیه NULL ⇒ رفتار قبلی کاملاً دست‌نخورده. idempotent: ستونِ موجود
// دوباره اضافه نمی‌شود.

module.exports = {
  name: '033_plan_task_manager_edit',
  up(db) {
    const cols = new Set(db.prepare('PRAGMA table_info(plan_tasks)').all().map((c) => c.name));
    if (!cols.has('manager_locked')) db.exec('ALTER TABLE plan_tasks ADD COLUMN manager_locked INTEGER NOT NULL DEFAULT 0 CHECK (manager_locked IN (0, 1));');
    if (!cols.has('edited_by_user_id')) db.exec('ALTER TABLE plan_tasks ADD COLUMN edited_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;');
    if (!cols.has('edited_at')) db.exec('ALTER TABLE plan_tasks ADD COLUMN edited_at TEXT;');
    db.exec('CREATE INDEX IF NOT EXISTS idx_plan_tasks_manager_locked ON plan_tasks(plan_id, manager_locked) WHERE manager_locked = 1;');
  },
};

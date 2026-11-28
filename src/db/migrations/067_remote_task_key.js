// migration شماره ۰۶۷ — برچسب «دورکاری» برای تسک‌هایی که پیش از افزودن system_key از گزارش پایان دورکاری ساخته شده‌اند.
// فقط ردیف‌های فوریِ شخصی با توضیحِ مخصوص این قابلیت و بدون system_key به‌روز می‌شوند؛ idempotent (اجرای دوباره چیزی را عوض نمی‌کند).
module.exports = {
  name: '067_remote_task_key',
  up(db) {
    db.exec("UPDATE plan_tasks SET system_key = 'remote_work' WHERE is_urgent = 1 AND is_system = 0 AND system_key IS NULL AND description LIKE '%ثبت‌شده هنگام پایان دورکاری%'");
  },
};

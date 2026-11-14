// migration شماره ۰۵۰ — تأیید تک‌مرحله‌ای مرخصی/ماموریت (سرپرست مستقیم یا ادمین؛ تصمیم اول نهایی است).
//   • مرحله‌ی تأیید اضافه و ارجاع خودکار به ادمین حذف شد؛ تنظیمات مربوط پاک می‌شوند.
//   • درخواست‌های pending که قبلاً زنجیره‌ی چندمرحله‌ای/گیرکرده روی «admin» داشتند تک‌مرحله‌ای می‌شوند:
//       - مرحله‌های pending بعد از مرحله‌ی فعال حذف می‌شود (مرحله‌ی فعال و تصمیم‌های قبلی ‑ تاریخچه ‑ می‌مانند)؛
//       - نقش نمایشی مرحله‌ی فعال از manager_id فعلی کارمند محاسبه می‌شود.
//     (مجوز تصمیم هم در کد «زنده» از manager_id محاسبه می‌شود؛ این migration فقط داده را تمیز می‌کند.)
//   • جدول leave_approvals و ستون‌هایش برای تاریخچه‌ی تصمیم می‌ماند. idempotent.
module.exports = {
  name: '050_single_step_leave_approval',
  up(db) {
    db.exec(`DELETE FROM leave_approvals
      WHERE status = 'pending'
        AND leave_request_id IN (SELECT id FROM leave_requests WHERE status = 'pending' AND current_step IS NOT NULL)
        AND step > (SELECT lr.current_step FROM leave_requests lr WHERE lr.id = leave_approvals.leave_request_id)`);
    db.exec(`UPDATE leave_approvals
      SET approver_role = CASE
        WHEN (SELECT u.manager_id FROM users u JOIN leave_requests lr ON lr.user_id = u.id WHERE lr.id = leave_approvals.leave_request_id) IS NOT NULL THEN 'manager'
        ELSE 'admin' END
      WHERE status = 'pending'
        AND leave_request_id IN (SELECT id FROM leave_requests WHERE status = 'pending')`);
    db.exec(`DELETE FROM settings WHERE key IN (
      'leave_approval_escalate_hours', 'leave_escalate_when_approver_on_leave',
      'leave_approval_extra_step_days', 'leave_approval_extra_step_types', 'leave_approval_extra_step_role')`);
  },
};

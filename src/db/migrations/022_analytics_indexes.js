// migration شماره ۰۲۲ — ایندکس‌های عملکرد تحلیل‌ها (S5-6c). فقط ایندکس؛ هیچ جدول/ستون/داده‌ای تغییر نمی‌کند (CREATE INDEX IF NOT EXISTS).
//
//   idx_break_records_attendance — break_records(attendance_record_id): موتور محاسبه برای «هر رکوردِ دارای ورود» استراحت‌هایش را
//     با WHERE attendance_record_id = ? می‌خواند (breakRepository.listByAttendanceRecord). تا اینجا این ستون ایندکس نداشت ⇒ هر خواندن
//     کل جدول را اسکن می‌کرد و هزینه‌ی گزارش/تحلیل با (تعداد رکورد × تعداد استراحت) یعنی «مجذوری» رشد می‌کرد.
//   idx_leave_user_status_dates — leave_requests(user_id, status, start_date, end_date): listApprovedOnDate / listApprovedInRange
//     (فیلتر user_id + status='approved' + هم‌پوشانی تاریخ) را بدون برگشت به جدول پاسخ می‌دهد.
//
// فهرست نام‌ها برای ابزار سنجش (scripts/bench-analytics.js --no-new-indexes) صادر می‌شود تا حالت «قبل از ایندکس» قابل بازتولید باشد.
// برگرداندن: DROP INDEX IF EXISTS <name>; (بی‌خطر؛ فقط سرعت برمی‌گردد به قبل.)
const INDEXES = ['idx_break_records_attendance', 'idx_leave_user_status_dates'];

module.exports = {
  name: '022_analytics_indexes',
  indexes: INDEXES,
  up(db) {
    db.exec('CREATE INDEX IF NOT EXISTS idx_break_records_attendance ON break_records(attendance_record_id);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_leave_user_status_dates ON leave_requests(user_id, status, start_date, end_date);');
  },
};
